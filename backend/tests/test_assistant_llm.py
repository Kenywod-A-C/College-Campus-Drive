"""Provider layer: configuration, what actually goes over the wire (real Anthropic SDK against a mock HTTP transport, no network),
and how provider failures are classified."""
import json
from types import SimpleNamespace

import anthropic
import httpx2
import openai
import pytest

from app.services.assistant import llm as llm_mod
from app.services.assistant.llm import AnthropicProvider, LLMError, OpenAICompatibleProvider, ToolCall, ToolSpec

BASE = "/api/v1/assistant"
KEY = "sk-ant-test-key-never-leaves-the-backend"
REQ = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def message(content, stop="end_turn"):
    return {"id": "msg_1", "type": "message", "role": "assistant", "model": "m", "content": content, "stop_reason": stop, "stop_sequence": None, "usage": {"input_tokens": 3, "output_tokens": 4}}


def provider_with(handler, **kw) -> AnthropicProvider:
    p = AnthropicProvider(api_key=KEY, model="claude-test", timeout=5, max_retries=0, **kw)
    p._client = anthropic.Anthropic(api_key=KEY, http_client=httpx2.Client(transport=httpx2.MockTransport(handler)), max_retries=0)
    return p


TOOL = ToolSpec("search_jobs", "Search jobs", {"type": "object", "properties": {"query": {"type": "string"}}})


# ------------------------------------------------------------------ configuration
def test_unconfigured_when_key_missing_or_provider_unknown(app, monkeypatch):
    with app.app_context():
        monkeypatch.setitem(app.config, "LLM_API_KEY", "")
        assert llm_mod.get_provider() is None and llm_mod.provider_status()["available"] is False
        monkeypatch.setitem(app.config, "LLM_API_KEY", KEY)
        monkeypatch.setitem(app.config, "LLM_PROVIDER", "mystery-ai")
        assert llm_mod.get_provider() is None and llm_mod.provider_status()["available"] is False


def test_configured_provider_uses_the_configured_model_and_timeouts(app, monkeypatch):
    with app.app_context():
        for k, v in {"LLM_API_KEY": KEY, "LLM_PROVIDER": "anthropic", "LLM_MODEL": "claude-test", "LLM_TIMEOUT_SECONDS": 12.5, "LLM_MAX_RETRIES": 3}.items():
            monkeypatch.setitem(app.config, k, v)
        p = llm_mod.get_provider()
        assert isinstance(p, AnthropicProvider) and p.model == "claude-test"
        assert p._client.timeout == 12.5 and p._client.max_retries == 3 and p._client.api_key == KEY
        assert llm_mod.provider_status() == {"available": True, "provider": "anthropic", "model": "claude-test"}


def test_production_code_contains_no_fake_provider():
    assert not any(n in llm_mod.PROVIDERS for n in ("fake", "test", "mock", "demo"))


# ------------------------------------------------------------------ the wire format
def test_request_carries_system_tools_and_tool_results_and_the_key_only_as_a_header():
    seen = {}

    def handler(request: httpx2.Request):
        seen["headers"], seen["body"] = dict(request.headers), json.loads(request.content)
        return httpx2.Response(200, json=message([{"type": "text", "text": "Hello"}]))

    p = provider_with(handler, effort="low")
    turns = [
        {"role": "user", "text": "find jobs"},
        {"role": "assistant", "text": "", "tool_calls": [ToolCall("toolu_1", "search_jobs", {"query": "python"})],
         "raw": [{"type": "tool_use", "id": "toolu_1", "name": "search_jobs", "input": {"query": "python"}}]},
        {"role": "tool", "results": [{"id": "toolu_1", "content": '{"jobs": []}', "is_error": False}]},
    ]
    reply = p.complete("SYSTEM PROMPT", turns, [TOOL], 777)
    b = seen["body"]
    assert reply.text == "Hello" and reply.tool_calls == []
    assert seen["headers"]["authorization"] == f"Bearer {KEY}"
    assert KEY not in json.dumps(b)  # the key is a transport header only; never part of the prompt
    assert b["model"] == "claude-test" and b["max_tokens"] == 777 and b["system"] == "SYSTEM PROMPT" and b["output_config"] == {"effort": "low"}
    assert b["tools"] == [{"name": "search_jobs", "description": "Search jobs", "input_schema": TOOL.input_schema}]
    assert b["messages"][0] == {"role": "user", "content": "find jobs"}
    assert b["messages"][1]["content"][0]["type"] == "tool_use"
    assert b["messages"][2] == {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": '{"jobs": []}', "is_error": False}]}


def test_no_tools_or_effort_are_sent_when_not_configured():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx2.Response(200, json=message([{"type": "text", "text": "x"}]))

    provider_with(handler).complete("s", [{"role": "user", "text": "hi"}], [], 100)
    assert "tools" not in seen["body"] and "output_config" not in seen["body"]


def test_tool_use_response_is_parsed_into_tool_calls():
    p = provider_with(lambda r: httpx2.Response(200, json=message([{"type": "text", "text": "Let me check."}, {"type": "tool_use", "id": "toolu_9", "name": "search_jobs", "input": {"query": "ai"}}], "tool_use")))
    r = p.complete("s", [{"role": "user", "text": "hi"}], [TOOL], 100)
    assert r.text == "Let me check." and r.tool_calls == [ToolCall("toolu_9", "search_jobs", {"query": "ai"})] and r.raw


def test_truncated_and_refused_answers_are_handled():
    cut = provider_with(lambda r: httpx2.Response(200, json=message([{"type": "text", "text": "Partial"}], "max_tokens")))
    assert "cut short" in cut.complete("s", [{"role": "user", "text": "hi"}], [], 5).text
    refused = provider_with(lambda r: httpx2.Response(200, json=message([], "refusal")))
    with pytest.raises(LLMError) as e:
        refused.complete("s", [{"role": "user", "text": "hi"}], [], 5)
    assert e.value.kind == "refused"


# ------------------------------------------------------------------ failure classification
def _resp(status):
    return httpx2.Response(status, request=REQ, json={"type": "error", "error": {"type": "x", "message": f"secret provider detail {KEY}"}})


@pytest.mark.parametrize("status,kind", [(401, "auth"), (403, "auth"), (429, "rate_limit"), (500, "unavailable"), (503, "unavailable"), (529, "unavailable"), (400, "unavailable")])
def test_http_errors_are_classified_without_leaking_provider_detail(status, kind):
    p = provider_with(lambda r: _resp(status))
    with pytest.raises(LLMError) as e:
        p.complete("s", [{"role": "user", "text": "hi"}], [], 10)
    assert e.value.kind == kind and KEY not in e.value.message and "secret provider detail" not in e.value.message


def test_timeouts_and_connection_failures_are_classified():
    def boom_timeout(r):
        raise httpx2.ReadTimeout("slow", request=r)

    def boom_connect(r):
        raise httpx2.ConnectError("down", request=r)

    with pytest.raises(LLMError) as t:
        provider_with(boom_timeout).complete("s", [{"role": "user", "text": "hi"}], [], 10)
    assert t.value.kind == "timeout"
    with pytest.raises(LLMError) as c:
        provider_with(boom_connect).complete("s", [{"role": "user", "text": "hi"}], [], 10)
    assert c.value.kind == "unavailable"


# ------------------------------------------------------------------ the whole stack over the real SDK
def test_full_chat_with_a_tool_round_trip_over_the_sdk(client, make, auth, monkeypatch):
    make.user("student", email="s@campus.test")
    bodies = []
    replies = [message([{"type": "tool_use", "id": "toolu_a", "name": "get_my_offers", "input": {}}], "tool_use"), message([{"type": "text", "text": "You have no offers yet."}])]

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx2.Response(200, json=replies[len(bodies) - 1])

    monkeypatch.setattr(llm_mod, "get_provider", lambda: provider_with(handler))
    r = client.post(f"{BASE}/chat", headers=auth("s@campus.test"), json={"message": "Do I have offers?"})
    data = r.get_json()["data"]
    assert r.status_code == 200 and data["messages"][-1]["text"] == "You have no offers yet." and data["messages"][-1]["tools"] == [{"tool": "get_my_offers", "args": {}, "status": "ok"}]
    second = bodies[1]["messages"]
    assert second[-1]["content"][0] == {"type": "tool_result", "tool_use_id": "toolu_a", "content": '{"offers": []}', "is_error": False}
    names = {t["name"] for t in bodies[0]["tools"]}
    assert "get_my_offers" in names and "get_audit_activity" not in names and "You are the Campus Assistant" in bodies[0]["system"]
    assert KEY not in json.dumps(bodies)


# ====================================================================== any OpenAI-compatible service (OpenAI, Gemini, Groq, Ollama, ...)
OKEY = "sk-proj-openai-test-key-never-leaves-the-backend"


def completion(message, finish="stop"):
    return {"id": "c1", "object": "chat.completion", "created": 1, "model": "m", "choices": [{"index": 0, "finish_reason": finish, "message": {"role": "assistant", **message}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7}}


def oa_provider(handler, *, base_url="", **kw) -> OpenAICompatibleProvider:
    p = OpenAICompatibleProvider(api_key=OKEY, model="gpt-test", timeout=5, max_retries=0, base_url=base_url, **kw)
    p._client = openai.OpenAI(api_key=OKEY, base_url=base_url or "https://api.openai.com/v1", http_client=httpx2.Client(transport=httpx2.MockTransport(handler)), max_retries=0)
    return p


def cfg(app, monkeypatch, **values):
    base = {"LLM_PROVIDER": "openai", "LLM_API_KEY": OKEY, "LLM_MODEL": "gpt-test", "LLM_BASE_URL": "", "LLM_TIMEOUT_SECONDS": 5, "LLM_MAX_RETRIES": 0, "LLM_EFFORT": ""}
    for k, v in {**base, **values}.items():
        monkeypatch.setitem(app.config, k, v)


def test_openai_provider_is_built_from_configuration(app, monkeypatch):
    with app.app_context():
        cfg(app, monkeypatch)
        p = llm_mod.get_provider()
        assert isinstance(p, OpenAICompatibleProvider) and p.model == "gpt-test" and p._client.api_key == OKEY
        assert llm_mod.provider_status() == {"available": True, "provider": "openai", "model": "gpt-test"}


@pytest.mark.parametrize("name,host", [("gemini", "generativelanguage.googleapis.com"), ("groq", "api.groq.com"), ("mistral", "api.mistral.ai"), ("deepseek", "api.deepseek.com"),
                                      ("openrouter", "openrouter.ai"), ("together", "api.together.xyz"), ("ollama", "localhost")])
def test_vendor_presets_choose_the_right_endpoint(app, monkeypatch, name, host):
    with app.app_context():
        cfg(app, monkeypatch, LLM_PROVIDER=name)
        assert host in str(llm_mod.get_provider()._client.base_url)


def test_base_url_overrides_the_preset_and_enables_any_compatible_endpoint(app, monkeypatch):
    with app.app_context():
        cfg(app, monkeypatch, LLM_PROVIDER="openai_compatible", LLM_BASE_URL="http://vllm.internal:8000/v1")
        assert str(llm_mod.get_provider()._client.base_url).startswith("http://vllm.internal:8000/v1")
        cfg(app, monkeypatch, LLM_PROVIDER="groq", LLM_BASE_URL="https://gateway.example.com/v1")
        assert "gateway.example.com" in str(llm_mod.get_provider()._client.base_url)


@pytest.mark.parametrize("values,why", [
    ({"LLM_API_KEY": ""}, "key missing"), ({"LLM_MODEL": ""}, "model missing for a non-anthropic provider"), ({"LLM_PROVIDER": "openai_compatible"}, "generic endpoint needs a base URL"),
    ({"LLM_PROVIDER": "skynet"}, "unsupported provider"),
])
def test_incomplete_configuration_means_not_configured(app, monkeypatch, values, why):
    with app.app_context():
        cfg(app, monkeypatch, **values)
        assert llm_mod.get_provider() is None and llm_mod.provider_status()["available"] is False, why


def test_local_ollama_needs_no_key_and_anthropic_defaults_its_model(app, monkeypatch):
    with app.app_context():
        cfg(app, monkeypatch, LLM_PROVIDER="ollama", LLM_API_KEY="", LLM_MODEL="llama3.1")
        assert llm_mod.get_provider() is not None
        cfg(app, monkeypatch, LLM_PROVIDER="anthropic", LLM_MODEL="")
        assert llm_mod.provider_status()["model"] == "claude-opus-5-5"


def test_openai_request_format_system_tools_and_tool_results():
    seen = {}

    def handler(request):
        seen["headers"], seen["body"], seen["url"] = dict(request.headers), json.loads(request.content), str(request.url)
        return httpx2.Response(200, json=completion({"content": "Hello"}))

    p = oa_provider(handler, effort="low")
    turns = [
        {"role": "user", "text": "find jobs"},
        {"role": "assistant", "text": "", "tool_calls": [ToolCall("call_1", "search_jobs", {"query": "python"})], "raw": None},
        {"role": "tool", "results": [{"id": "call_1", "content": '{"jobs": []}', "is_error": False}]},
    ]
    reply = p.complete("SYSTEM PROMPT", turns, [TOOL], 777)
    b = seen["body"]
    assert reply.text == "Hello" and seen["url"].endswith("/chat/completions") and seen["headers"]["authorization"] == f"Bearer {OKEY}"
    assert OKEY not in json.dumps(b)
    assert b["model"] == "gpt-test" and b["max_completion_tokens"] == 777 and "max_tokens" not in b and b["reasoning_effort"] == "low"
    assert b["tools"] == [{"type": "function", "function": {"name": "search_jobs", "description": "Search jobs", "parameters": TOOL.input_schema}}]
    assert b["messages"][0] == {"role": "system", "content": "SYSTEM PROMPT"} and b["messages"][1] == {"role": "user", "content": "find jobs"}
    assert b["messages"][2]["tool_calls"] == [{"id": "call_1", "type": "function", "function": {"name": "search_jobs", "arguments": '{"query": "python"}'}}]
    assert b["messages"][3] == {"role": "tool", "tool_call_id": "call_1", "content": '{"jobs": []}'}


def test_compatible_servers_get_max_tokens_and_no_tools_when_none_offered():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx2.Response(200, json=completion({"content": "x"}))

    oa_provider(handler, base_url="http://localhost:11434/v1").complete("s", [{"role": "user", "text": "hi"}], [], 100)
    assert seen["body"]["max_tokens"] == 100 and "max_completion_tokens" not in seen["body"] and "tools" not in seen["body"] and "reasoning_effort" not in seen["body"]


def test_openai_tool_calls_are_parsed_and_malformed_arguments_are_flagged():
    tcs = [{"id": "call_a", "type": "function", "function": {"name": "search_jobs", "arguments": '{"query": "ai"}'}},
           {"id": "call_b", "type": "function", "function": {"name": "get_my_offers", "arguments": "{not json"}},
           {"id": "", "type": "function", "function": {"name": "get_my_profile", "arguments": ""}}]
    p = oa_provider(lambda r: httpx2.Response(200, json=completion({"content": None, "tool_calls": tcs}, "tool_calls")))
    r = p.complete("s", [{"role": "user", "text": "hi"}], [TOOL], 100)
    assert r.tool_calls == [ToolCall("call_a", "search_jobs", {"query": "ai"}), ToolCall("call_b", "get_my_offers", {"_unparseable_arguments": True}), ToolCall("call_2", "get_my_profile", {})]


def test_openai_truncation_filter_and_empty_responses():
    cut = oa_provider(lambda r: httpx2.Response(200, json=completion({"content": "Partial"}, "length")))
    assert "cut short" in cut.complete("s", [{"role": "user", "text": "hi"}], [], 5).text
    with pytest.raises(LLMError) as e:
        oa_provider(lambda r: httpx2.Response(200, json=completion({"content": None}, "content_filter"))).complete("s", [{"role": "user", "text": "hi"}], [], 5)
    assert e.value.kind == "refused"
    with pytest.raises(LLMError) as e2:
        oa_provider(lambda r: httpx2.Response(200, json={**completion({"content": "x"}), "choices": []})).complete("s", [{"role": "user", "text": "hi"}], [], 5)
    assert e2.value.kind == "bad_response"


@pytest.mark.parametrize("status,kind", [(401, "auth"), (403, "auth"), (429, "rate_limit"), (500, "unavailable"), (503, "unavailable"), (404, "unavailable"), (400, "unavailable")])
def test_openai_http_errors_are_classified_without_leaking_provider_detail(status, kind):
    p = oa_provider(lambda r: httpx2.Response(status, json={"error": {"message": f"secret provider detail {OKEY}", "type": "x"}}))
    with pytest.raises(LLMError) as e:
        p.complete("s", [{"role": "user", "text": "hi"}], [], 10)
    assert e.value.kind == kind and OKEY not in e.value.message and "secret provider detail" not in e.value.message


def test_openai_timeouts_and_connection_failures_are_classified():
    def boom_timeout(r):
        raise httpx2.ReadTimeout("slow", request=r)

    def boom_connect(r):
        raise httpx2.ConnectError("down", request=r)

    with pytest.raises(LLMError) as t:
        oa_provider(boom_timeout).complete("s", [{"role": "user", "text": "hi"}], [], 10)
    assert t.value.kind == "timeout"
    with pytest.raises(LLMError) as c:
        oa_provider(boom_connect).complete("s", [{"role": "user", "text": "hi"}], [], 10)
    assert c.value.kind == "unavailable"


def test_tool_schemas_are_plain_enough_for_strict_compatible_servers():
    from app.services.assistant import tools as tools_mod

    def walk(node):
        if isinstance(node, dict):
            assert "anyOf" not in node and ("title" not in node or isinstance(node["title"], dict)), node  # a *property* may be called "title"
            for k, v in node.items():
                if k == "properties":
                    for prop in v.values():
                        walk(prop)
                else:
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for t in tools_mod.TOOLS.values():
        walk(tools_mod._plain_schema(t.args))
    sj = tools_mod._plain_schema(tools_mod.TOOLS["search_jobs"].args)["properties"]
    assert sj["query"]["type"] == "string" and "default" not in sj["query"] and sj["limit"]["maximum"] == 10


def test_full_chat_with_tool_round_trip_over_the_openai_protocol(client, make, auth, monkeypatch):
    make.user("student", email="s@campus.test")
    bodies = []
    replies = [completion({"content": None, "tool_calls": [{"id": "call_z", "type": "function", "function": {"name": "get_my_offers", "arguments": "{}"}}]}, "tool_calls"), completion({"content": "No offers yet."})]

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx2.Response(200, json=replies[len(bodies) - 1])

    monkeypatch.setattr(llm_mod, "get_provider", lambda: oa_provider(handler))
    r = client.post(f"{BASE}/chat", headers=auth("s@campus.test"), json={"message": "Do I have offers?"})
    data = r.get_json()["data"]
    assert r.status_code == 200 and data["messages"][-1]["text"] == "No offers yet." and data["messages"][-1]["tools"][0]["tool"] == "get_my_offers"
    assert bodies[1]["messages"][-1] == {"role": "tool", "tool_call_id": "call_z", "content": '{"offers": []}'}
    names = {t["function"]["name"] for t in bodies[0]["tools"]}
    assert "get_my_offers" in names and "get_audit_activity" not in names  # the same permissioned tool set as with any provider
    assert OKEY not in json.dumps(bodies)
