"""Consequential actions: the model only proposes; the owner confirms; the server re-validates through the normal service layer."""
from datetime import timedelta

import pytest

from app.extensions import db
from app.models import (
    Application, ApplicationStatus, AssistantAction, AuditLog, Company, JobStatus, Notification, Reminder, Role, Student, utcnow,
)

from .fake_llm import call, calls, say

BASE = "/api/v1/assistant"


def chat(client, h, message="Hello", conversation_id=None):
    body = {"message": message}
    if conversation_id is not None:
        body["conversationId"] = conversation_id
    return client.post(f"{BASE}/chat", headers=h, json=body)


def propose(client, h, llm, *prepare_calls, message="do it"):
    llm(*prepare_calls, say("I prepared that for you."))
    r = chat(client, h, message)
    assert r.status_code == 200, r.get_json()
    conv = r.get_json()["data"]
    return conv, conv["messages"][-1]["action"]


def confirm(client, h, aid):
    return client.post(f"{BASE}/actions/{aid}/confirm", headers=h)


def reject(client, h, aid):
    return client.post(f"{BASE}/actions/{aid}/reject", headers=h)


@pytest.fixture()
def setup(make, auth):
    make.user("student", email="s@campus.test", cgpa=8.4)
    c = make.company("Zoho")
    j = make.job(c, "Developer", min_cgpa=7.0)
    return auth("s@campus.test"), j


def counts(app):
    with app.app_context():
        return db.session.query(Application).count(), db.session.query(Reminder).count()


# ------------------------------------------------------------------ apply
def test_proposal_changes_nothing_until_confirmed(client, setup, llm, app):
    h, j = setup
    _, a = propose(client, h, llm, call("prepare_application", job_id=j))
    assert a["kind"] == "apply" and a["state"] == "awaiting_confirmation" and a["title"] == "Apply to Zoho — Developer"
    assert {"label": "Company", "value": "Zoho"} in a["details"] and "payload" not in a
    assert counts(app) == (0, 0)
    with app.app_context():
        assert db.session.query(Notification).count() == 0


def test_confirm_applies_through_the_service_layer_and_is_audited(client, setup, llm, app):
    h, j = setup
    conv, a = propose(client, h, llm, call("prepare_application", job_id=j))
    r = confirm(client, h, a["id"])
    assert r.status_code == 200
    d = r.get_json()["data"]
    assert d["state"] == "confirmed" and "Application submitted" in d["resultMessage"]
    with app.app_context():
        app_row = db.session.query(Application).one()
        assert app_row.job_id == j and app_row.status == ApplicationStatus.APPLIED and app_row.snapshot.state.value == "eligible"
        actions = {x.action for x in db.session.query(AuditLog)}
        assert {"application.create", "assistant.action.confirmed", "assistant.chat"} <= actions
    shown = client.get(f"{BASE}/conversations/{conv['id']}", headers=h).get_json()["data"]["messages"][-1]["action"]
    assert shown["state"] == "confirmed" and shown["resultMessage"] == d["resultMessage"]


def test_reject_cancels_and_nothing_changes(client, setup, llm, app):
    h, j = setup
    _, a = propose(client, h, llm, call("prepare_application", job_id=j))
    r = reject(client, h, a["id"])
    assert r.get_json()["data"]["state"] == "cancelled" and "Nothing was changed" in r.get_json()["data"]["resultMessage"]
    assert counts(app) == (0, 0)
    assert confirm(client, h, a["id"]).status_code == 409  # cancelled actions cannot be revived
    with app.app_context():
        assert db.session.query(AuditLog).filter_by(action="assistant.action.cancelled").count() == 1


def test_an_action_executes_at_most_once(client, setup, llm, app):
    h, j = setup
    _, a = propose(client, h, llm, call("prepare_application", job_id=j))
    assert confirm(client, h, a["id"]).status_code == 200
    again = confirm(client, h, a["id"])
    assert again.status_code == 409 and "already handled" in again.get_json()["error"]["message"]
    assert reject(client, h, a["id"]).status_code == 409
    assert counts(app) == (1, 0)


def test_only_the_owner_can_confirm_or_reject(client, make, setup, auth, llm, app):
    h, j = setup
    make.user("student", email="evil@campus.test")
    _, a = propose(client, h, llm, call("prepare_application", job_id=j))
    other = auth("evil@campus.test")
    assert confirm(client, other, a["id"]).status_code == 404
    assert reject(client, other, a["id"]).status_code == 404
    assert counts(app) == (0, 0)
    with app.app_context():
        assert db.session.get(AssistantAction, int(a["id"])).state.value == "awaiting_confirmation"
        assert db.session.query(AuditLog).filter_by(action="assistant.action", result="denied").count() == 2
    assert confirm(client, h, a["id"]).status_code == 200  # the owner still can


def test_unknown_action_is_404(client, setup):
    assert confirm(client, setup[0], 99999).status_code == 404


def test_the_model_never_sees_an_action_id_or_a_way_to_confirm(client, setup, llm):
    h, j = setup
    p = llm(call("prepare_application", job_id=j), say("ok"))
    chat(client, h, "apply please")
    result = [t for t in p.requests[1]["turns"] if t["role"] == "tool"][-1]["results"][0]["content"]
    assert '"id"' not in result and "awaiting_user_confirmation" in result
    assert not any("confirm" in t for t in p.requests[0]["tools"])


# ------------------------------------------------------------------ re-validation at confirmation time
def test_confirmation_revalidates_the_job_state(client, setup, llm, app):
    h, j = setup
    _, a = propose(client, h, llm, call("prepare_application", job_id=j))
    with app.app_context():
        from app.models import Job
        db.session.get(Job, j).status = JobStatus.CLOSED
        db.session.commit()
    d = confirm(client, h, a["id"]).get_json()["data"]
    assert d["state"] == "failed" and "closed" in d["resultMessage"] and "did not allow" in d["resultMessage"]
    assert counts(app) == (0, 0)
    with app.app_context():
        assert db.session.query(AuditLog).filter_by(action="assistant.action.failed", result="failed").count() == 1


def test_confirmation_revalidates_eligibility_with_current_data(client, setup, llm, app):
    h, j = setup
    _, a = propose(client, h, llm, call("prepare_application", job_id=j))
    with app.app_context():
        s = db.session.query(Student).one()
        s.academic.cgpa = 5.0  # the student's record changed after the proposal
        db.session.commit()
    d = confirm(client, h, a["id"]).get_json()["data"]
    assert d["state"] == "failed" and "Not eligible" in d["resultMessage"]
    assert counts(app) == (0, 0)


def test_confirmation_notices_a_duplicate_application(client, setup, llm, app):
    h, j = setup
    _, a = propose(client, h, llm, call("prepare_application", job_id=j))
    assert client.post("/api/v1/applications", headers=h, json={"jobId": j}).status_code == 201  # applied through the normal UI meanwhile
    d = confirm(client, h, a["id"]).get_json()["data"]
    assert d["state"] == "failed" and "already applied" in d["resultMessage"]
    assert counts(app) == (1, 0)


def test_confirmation_respects_the_application_limit_policy(client, setup, make, llm, app):
    h, j = setup
    _, a = propose(client, h, llm, call("prepare_application", job_id=j))
    from app.models import PlacementPolicy, PolicyKind
    with app.app_context():
        db.session.query(PlacementPolicy).filter_by(kind=PolicyKind.APPLICATION_LIMIT).one().params = {"maxActiveApplications": 0}
        db.session.commit()
    d = confirm(client, h, a["id"]).get_json()["data"]
    assert d["state"] == "failed" and "Policy limit" in d["resultMessage"]


def test_lost_permission_blocks_confirmation(client, make, auth, llm, app):
    make.user("faculty", email="f@campus.test")
    us = make.user("student", email="s@campus.test")
    app_id = make.application(us, make.job(make.company(), "Dev"))
    h = auth("f@campus.test")
    _, a = propose(client, h, llm, call("prepare_stage_change", application_ids=[app_id], status="shortlisted"))
    with app.app_context():
        r = db.session.query(Role).filter_by(name="faculty").one()
        r.permissions = [p for p in r.permissions if p.key != "applications.review"]
        db.session.commit()
    d = confirm(client, h, a["id"]).get_json()["data"]
    assert d["state"] == "failed" and "no longer have permission" in d["resultMessage"]
    with app.app_context():
        assert db.session.get(Application, app_id).status == ApplicationStatus.APPLIED
        assert db.session.query(AuditLog).filter_by(action="assistant.action", result="denied").count() == 1


def test_expired_proposals_cannot_be_confirmed(client, setup, llm, app):
    h, j = setup
    conv, a = propose(client, h, llm, call("prepare_application", job_id=j))
    with app.app_context():
        x = db.session.get(AssistantAction, int(a["id"]))
        x.expires_at = utcnow() - timedelta(minutes=1)
        db.session.commit()
    shown = client.get(f"{BASE}/conversations/{conv['id']}", headers=h).get_json()["data"]["messages"][-1]["action"]
    assert shown["state"] == "expired"
    r = confirm(client, h, a["id"])
    assert r.status_code == 409 and "expired" in r.get_json()["error"]["message"]
    assert counts(app) == (0, 0)


def test_deleting_the_conversation_cancels_pending_actions(client, setup, llm, app):
    h, j = setup
    conv, a = propose(client, h, llm, call("prepare_application", job_id=j))
    assert client.delete(f"{BASE}/conversations/{conv['id']}", headers=h).status_code == 200
    assert confirm(client, h, a["id"]).status_code == 409
    assert counts(app) == (0, 0)


def test_only_one_action_can_be_prepared_per_reply(client, make, auth, llm, app):
    make.user("student", email="s@campus.test")
    c = make.company()
    j1, j2 = make.job(c, "A"), make.job(c, "B")
    p = llm(calls(("prepare_application", {"job_id": j1}), ("prepare_application", {"job_id": j2})), say("done"))
    conv = chat(client, auth("s@campus.test"), "apply to both").get_json()["data"]
    res = [__import__("json").loads(r["content"]) for r in [t for t in p.requests[1]["turns"] if t["role"] == "tool"][-1]["results"]]
    assert res[0]["status"] == "awaiting_user_confirmation" and res[1]["error"] == "one_action_per_reply"
    with app.app_context():
        assert db.session.query(AssistantAction).count() == 1
    assert conv["messages"][-1]["action"]["details"][1]["value"] == "A"


def test_the_model_learns_what_became_of_its_proposal(client, setup, llm):
    h, j = setup
    conv, a = propose(client, h, llm, call("prepare_application", job_id=j))
    confirm(client, h, a["id"])
    p = llm(say("Glad that worked."))
    chat(client, h, "thanks", int(conv["id"]))
    assert 'Prepared action "Apply to Zoho — Developer": confirmed' in p.requests[0]["turns"][1]["text"]


# ------------------------------------------------------------------ reminders
def test_reminder_flow_stores_the_time_in_utc(client, setup, llm, app):
    h, j = setup
    _, a = propose(client, h, llm, call("prepare_reminder", title="Update resume", remind_at="2030-01-05T09:00:00+05:30", job_id=j))
    assert a["kind"] == "create_reminder" and counts(app) == (0, 0)
    assert confirm(client, h, a["id"]).get_json()["data"]["state"] == "confirmed"
    with app.app_context():
        r = db.session.query(Reminder).one()
        assert r.title == "Update resume" and r.job_id == j and r.remind_at.isoformat() == "2030-01-05T03:30:00"


def test_reminders_in_the_past_or_for_hidden_jobs_are_not_even_proposed(client, setup, make, llm, app):
    h, _ = setup
    draft = make.job(make.company("Hidden"), "Secret", status=JobStatus.DRAFT)
    llm(calls(("prepare_reminder", {"title": "x", "remind_at": "2020-01-01T00:00:00Z"}), ("prepare_reminder", {"title": "x", "remind_at": "2031-01-01T00:00:00Z", "job_id": draft})), say("sorry"))
    conv = chat(client, h, "remind me").get_json()["data"]
    assert "action" not in conv["messages"][-1] and counts(app) == (0, 0)


# ------------------------------------------------------------------ staff stage changes
def test_faculty_stage_change_runs_the_state_machine_on_confirm(client, make, auth, llm, app):
    make.user("faculty", email="f@campus.test")
    u1, u2 = make.user("student", email="s1@campus.test", name="One"), make.user("student", email="s2@campus.test", name="Two")
    j = make.job(make.company("Zoho"), "Dev")
    a1, a2 = make.application(u1, j), make.application(u2, j, ApplicationStatus.REJECTED)
    h = auth("f@campus.test")
    _, a = propose(client, h, llm, call("prepare_stage_change", application_ids=[a1, a2], status="shortlisted", note="Strong profile"))
    assert a["kind"] == "update_stage" and a["title"] == "Move 2 applicants to Shortlisted" and any("One" in d["label"] for d in a["details"])
    with app.app_context():
        assert db.session.get(Application, a1).status == ApplicationStatus.APPLIED  # untouched until confirmed
    d = confirm(client, h, a["id"]).get_json()["data"]
    assert d["state"] == "confirmed" and "Updated 1 applicant" in d["resultMessage"] and "1 could not be changed" in d["resultMessage"]
    with app.app_context():
        assert db.session.get(Application, a1).status == ApplicationStatus.SHORTLISTED
        assert db.session.get(Application, a2).status == ApplicationStatus.REJECTED  # the state machine refused to resurrect it
        assert db.session.query(Notification).filter_by(user_id=u1).count() == 1


def test_stage_change_that_the_rules_refuse_everywhere_is_reported_as_failed(client, make, auth, llm, app):
    make.user("faculty", email="f@campus.test")
    u = make.user("student", email="s@campus.test")
    a1 = make.application(u, make.job(make.company(), "Dev"), ApplicationStatus.SELECTED)
    h = auth("f@campus.test")
    _, a = propose(client, h, llm, call("prepare_stage_change", application_ids=[a1], status="shortlisted"))  # backwards move
    d = confirm(client, h, a["id"]).get_json()["data"]
    assert d["state"] == "failed" and "already at or beyond" in d["resultMessage"]
    with app.app_context():
        assert db.session.get(Application, a1).status == ApplicationStatus.SELECTED


def test_faculty_cannot_prepare_student_actions_and_students_cannot_prepare_stage_changes(client, make, auth, llm):
    make.user("faculty", email="f@campus.test")
    make.user("student", email="s@campus.test")
    j = make.job(make.company(), "Dev")
    p = llm(call("prepare_application", job_id=j), say("no"))
    conv = chat(client, auth("f@campus.test"), "apply for a student").get_json()["data"]
    assert "action" not in conv["messages"][-1] and conv["messages"][-1]["tools"][0]["status"] == "denied"
    p = llm(call("prepare_stage_change", application_ids=[1], status="selected"), say("no"))
    conv = chat(client, auth("s@campus.test"), "select me").get_json()["data"]
    assert "action" not in conv["messages"][-1] and conv["messages"][-1]["tools"][0]["status"] == "denied"
