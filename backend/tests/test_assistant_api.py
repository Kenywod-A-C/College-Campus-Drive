"""AI assistant API: chat, conversation ownership and lifecycle, provider failures, bounds and rate limits (deterministic fake provider)."""
from datetime import timedelta

import pytest

from app.extensions import db
from app.models import AuditLog, Conversation, Message, utcnow
from app.services.assistant import llm as llm_mod
from app.services.assistant.conversations import purge_archived
from app.services.assistant.llm import LLMError

from .fake_llm import call, say

BASE = "/api/v1/assistant"


def chat(client, h, message="Hello", conversation_id=None):
    body = {"message": message}
    if conversation_id is not None:
        body["conversationId"] = conversation_id
    return client.post(f"{BASE}/chat", headers=h, json=body)


@pytest.fixture()
def student(make, auth):
    make.user("student", email="s@campus.test")
    return auth("s@campus.test")


@pytest.mark.parametrize("method,path", [
    ("get", "/status"), ("get", "/suggestions"), ("get", "/conversations"), ("post", "/conversations"), ("get", "/conversations/1"), ("delete", "/conversations/1"),
    ("post", "/chat"), ("post", "/actions/1/confirm"), ("post", "/actions/1/reject"),
])
def test_every_endpoint_requires_sign_in(client, method, path):
    r = getattr(client, method)(BASE + path, json={})
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "unauthenticated"


# ------------------------------------------------------------------ chat + persistence
def test_chat_creates_a_conversation_and_persists_both_messages(client, student, llm):
    llm(say("Hi! How can I help?"))
    r = chat(client, student, "  What is my status?  ")
    assert r.status_code == 200
    c = r.get_json()["data"]
    assert c["title"] == "What is my status?"
    assert [(m["role"], m["text"]) for m in c["messages"]] == [("user", "What is my status?"), ("assistant", "Hi! How can I help?")]
    listed = client.get(f"{BASE}/conversations", headers=student).get_json()["data"]
    assert listed == [{"id": c["id"], "title": "What is my status?", "updatedAt": c["updatedAt"], "count": 2}]
    got = client.get(f"{BASE}/conversations/{c['id']}", headers=student).get_json()["data"]
    assert got["messages"] == c["messages"]


def test_follow_up_replays_earlier_turns_to_the_model(client, student, llm):
    p = llm(say("First answer"), say("Second answer"))
    cid = chat(client, student, "first question").get_json()["data"]["id"]
    r = chat(client, student, "second question", int(cid))
    assert r.status_code == 200 and len(r.get_json()["data"]["messages"]) == 4
    second = p.requests[1]["turns"]
    assert [(t["role"], t["text"]) for t in second] == [("user", "first question"), ("assistant", "First answer"), ("user", "second question")]


def test_create_empty_conversation_then_chat_in_it(client, student, llm):
    llm(say("ok"))
    r = client.post(f"{BASE}/conversations", headers=student)
    assert r.status_code == 201 and r.get_json()["data"]["messages"] == [] and r.get_json()["data"]["title"] == "New conversation"
    cid = int(r.get_json()["data"]["id"])
    assert chat(client, student, "hi there", cid).get_json()["data"]["title"] == "hi there"


def test_suggestions_depend_on_the_server_side_role(client, make, auth):
    make.user("student", email="s@campus.test")
    make.user("admin", email="a@campus.test")
    s = client.get(f"{BASE}/suggestions", headers=auth("s@campus.test")).get_json()["data"]
    a = client.get(f"{BASE}/suggestions", headers=auth("a@campus.test")).get_json()["data"]
    assert any("eligible" in x for x in s) and not any("policies" in x for x in s)
    assert any("policies" in x for x in a) and any("denied" in x for x in a)


# ------------------------------------------------------------------ ownership
def test_other_users_conversations_are_invisible_and_untouchable(client, make, auth, llm, app):
    make.user("student", email="a@campus.test")
    make.user("student", email="b@campus.test")
    ha, hb = auth("a@campus.test"), auth("b@campus.test")
    p = llm(say("secret-a-answer"))
    cid = chat(client, ha, "my private question").get_json()["data"]["id"]

    assert client.get(f"{BASE}/conversations", headers=hb).get_json()["data"] == []
    assert client.get(f"{BASE}/conversations/{cid}", headers=hb).status_code == 404
    assert client.delete(f"{BASE}/conversations/{cid}", headers=hb).status_code == 404
    r = chat(client, hb, "let me in", int(cid))
    assert r.status_code == 404 and len(p.requests) == 1  # the model was never called with someone else's history
    assert client.get(f"{BASE}/conversations/{cid}", headers=ha).status_code == 200  # still intact for the owner
    with app.app_context():
        assert db.session.query(AuditLog).filter_by(action="assistant.conversation", result="denied").count() == 3
        assert db.session.query(Message).count() == 2


def test_unknown_conversation_is_404_not_500(client, student):
    assert client.get(f"{BASE}/conversations/999999", headers=student).status_code == 404
    assert client.get(f"{BASE}/conversations/abc", headers=student).status_code == 404


# ------------------------------------------------------------------ delete / retention
def test_delete_archives_then_purge_removes_after_retention(client, student, llm, app):
    llm(say("a"))
    cid = chat(client, student, "to be deleted").get_json()["data"]["id"]
    assert client.delete(f"{BASE}/conversations/{cid}", headers=student).get_json()["data"] == {"ok": True}
    assert client.get(f"{BASE}/conversations", headers=student).get_json()["data"] == []
    assert client.get(f"{BASE}/conversations/{cid}", headers=student).status_code == 404
    assert chat(client, student, "again", int(cid)).status_code == 404
    with app.app_context():
        assert purge_archived(30) == 0  # still inside the retention window
        assert db.session.query(Conversation).count() == 1
        c = db.session.get(Conversation, int(cid))
        c.archived_at = utcnow() - timedelta(days=31)
        db.session.commit()
        assert purge_archived(30) == 1
        assert db.session.query(Conversation).count() == 0 and db.session.query(Message).count() == 0
        assert db.session.query(AuditLog).filter_by(action="assistant.conversation.delete").count() == 1  # the audit trail outlives the content


def test_purge_cli_command_is_registered(app):
    out = app.test_cli_runner().invoke(args=["assistant-purge"])
    assert out.exit_code == 0 and "Purged 0" in out.output


# ------------------------------------------------------------------ provider availability and failures
def test_not_configured_is_reported_honestly_and_nothing_is_saved(client, student, app, monkeypatch):
    monkeypatch.setitem(app.config, "LLM_API_KEY", "")
    st = client.get(f"{BASE}/status", headers=student).get_json()["data"]
    assert st["available"] is False and "not configured" in st["reason"]
    r = chat(client, student, "hello")
    assert r.status_code == 503 and r.get_json()["error"]["code"] == "assistant_unavailable"
    assert client.get(f"{BASE}/conversations", headers=student).get_json()["data"] == []


def test_status_never_exposes_the_key(client, student, app, monkeypatch):
    monkeypatch.setitem(app.config, "LLM_API_KEY", "sk-ant-super-secret-0000")
    monkeypatch.setitem(app.config, "LLM_MODEL", "claude-test")
    r = client.get(f"{BASE}/status", headers=student)
    assert r.get_json()["data"] == {"available": True, "provider": "anthropic", "model": "claude-test"}
    assert "sk-ant" not in r.get_data(as_text=True)


@pytest.mark.parametrize("kind,status,code", [
    ("timeout", 504, "assistant_timeout"), ("rate_limit", 502, "assistant_upstream_error"), ("unavailable", 502, "assistant_upstream_error"),
    ("auth", 503, "assistant_unavailable"), ("refused", 502, "assistant_upstream_error"),
])
def test_provider_failures_map_to_safe_errors_and_persist_nothing(client, student, llm, kind, status, code):
    llm(LLMError(kind, "provider said something"))
    r = chat(client, student, "will fail")
    assert r.status_code == status and r.get_json()["error"]["code"] == code
    assert "Traceback" not in r.get_data(as_text=True)
    assert client.get(f"{BASE}/conversations", headers=student).get_json()["data"] == []


def test_failure_then_retry_with_the_same_message_works(client, student, llm):
    llm(LLMError("timeout", "slow"), say("Here you go"))
    assert chat(client, student, "same question").status_code == 504
    r = chat(client, student, "same question")
    assert r.status_code == 200 and [m["role"] for m in r.get_json()["data"]["messages"]] == ["user", "assistant"]


def test_empty_model_answer_is_an_error_not_a_blank_message(client, student, llm):
    llm(say("   "))
    r = chat(client, student, "hello")
    assert r.status_code == 502 and client.get(f"{BASE}/conversations", headers=student).get_json()["data"] == []


# ------------------------------------------------------------------ bounds
@pytest.mark.parametrize("body", [{"message": ""}, {"message": "   "}, {"message": "x" * 2001}, {}, {"message": "hi", "conversationId": 0}, {"message": "hi", "role": "admin"}, {"message": "hi", "studentId": 3}])
def test_invalid_requests_are_422_and_never_reach_the_model(client, student, llm, body):
    p = llm()
    r = client.post(f"{BASE}/chat", headers=student, json=body)
    assert r.status_code == 422 and p.requests == []


def test_input_limit_is_configurable(client, student, llm, app, monkeypatch):
    llm(say("ok"))
    monkeypatch.setitem(app.config, "ASSISTANT_MAX_INPUT_CHARS", 10)
    assert chat(client, student, "x" * 11).status_code == 422
    assert chat(client, student, "x" * 10).status_code == 200


def test_output_and_tool_rounds_are_bounded(client, student, llm, app, monkeypatch):
    monkeypatch.setitem(app.config, "ASSISTANT_MAX_TOOL_ROUNDS", 2)
    monkeypatch.setitem(app.config, "LLM_MAX_OUTPUT_TOKENS", 321)
    p = llm(call("get_my_offers"), call("get_my_offers"), say("done after two rounds"))
    r = chat(client, student, "loop forever")
    assert r.status_code == 200
    assert [len(x["tools"]) > 0 for x in p.requests] == [True, True, False]  # the final round is offered no tools, so the model must answer
    assert all(x["max_tokens"] == 321 for x in p.requests)


def test_conversation_size_is_capped(client, student, llm, app, monkeypatch):
    llm(say("1"), say("2"))
    monkeypatch.setitem(app.config, "ASSISTANT_MAX_MESSAGES_PER_CONVERSATION", 2)
    cid = chat(client, student, "one").get_json()["data"]["id"]
    r = chat(client, student, "two", int(cid))
    assert r.status_code == 409 and "full" in r.get_json()["error"]["message"]


# ------------------------------------------------------------------ rate limiting
def test_chat_is_rate_limited_per_user_not_per_ip(client, make, auth, llm, app, monkeypatch):
    make.user("student", email="a@campus.test")
    make.user("student", email="b@campus.test")
    ha, hb = auth("a@campus.test"), auth("b@campus.test")
    monkeypatch.setitem(app.config, "ASSISTANT_CHAT_RATE_LIMIT", "2 per minute")
    llm(say("1"), say("2"), say("3"))
    assert chat(client, ha, "q1").status_code == 200
    assert chat(client, ha, "q2").status_code == 200
    r = chat(client, ha, "q3")
    assert r.status_code == 429 and r.get_json()["error"]["code"] == "rate_limited"
    assert chat(client, hb, "other user, same IP").status_code == 200


def test_a_turn_has_a_wall_clock_budget(client, student, llm, app, monkeypatch):
    p = llm(call("get_my_offers"), say("never reached"))
    monkeypatch.setitem(app.config, "ASSISTANT_TURN_SECONDS", -1)
    r = chat(client, student, "slow question")
    assert r.status_code == 504 and r.get_json()["error"]["code"] == "assistant_timeout" and len(p.requests) == 1
    assert client.get(f"{BASE}/conversations", headers=student).get_json()["data"] == []


def test_stale_refusals_in_the_history_are_not_to_be_repeated(client, student, llm):
    p = llm(say("I cannot help with that."), say("ok"))
    cid = chat(client, student, "first").get_json()["data"]["id"]
    chat(client, student, "again", int(cid))
    assert "Never repeat an earlier refusal" in p.requests[1]["system"]


def test_assistant_check_command_reports_tools_per_role_without_the_key(app, make, monkeypatch):
    make.user("student", email="s@campus.test")
    make.user("admin", email="a@campus.test")
    monkeypatch.setitem(app.config, "LLM_API_KEY", "sk-must-not-be-printed")
    out = app.test_cli_runner().invoke(args=["assistant-check"])
    assert out.exit_code == 0 and "key_set=True" in out.output and "sk-must-not-be-printed" not in out.output
    assert "AVAILABLE" in out.output and "search_students" in out.output.split("admin (")[1] and "search_students" not in out.output.split("student (")[1].split("\n")[0]
