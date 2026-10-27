"""LLM provider abstraction.

The orchestrator only knows `LLMProvider.complete()`. A provider turns our neutral turns into one model call and returns
text and/or tool calls. The API key is read from the backend configuration here and nowhere else: it never reaches the
browser, the prompt, a tool result or a log line.

Two adapters, each on its vendor's official SDK, cover practically every service:
  * `anthropic`: Claude models;
  * `openai` and the presets below: anything that speaks the OpenAI chat-completions protocol (OpenAI, Gemini, Mistral, Groq, DeepSeek,
    OpenRouter, Together, Ollama, vLLM, LM Studio, ...). Use `openai_compatible` + `LLM_BASE_URL` for any other endpoint.
To add a different protocol, subclass `LLMProvider` and register it in PROVIDERS.
There is deliberately no "fake" provider in this module: tests inject their own (tests/fake_llm.py) so production code can
never answer with canned text.
"""
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable

from flask import current_app

log = logging.getLogger(__name__)

NOT_CONFIGURED_MESSAGE = "The AI assistant is not configured yet. Ask an administrator to set up the language-model credentials on the server."


class LLMError(Exception):
    """kind: not_configured | timeout | rate_limit | auth | unavailable | refused | bad_response"""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind
        self.message = message


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    args: dict


@dataclass
class LLMReply:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw: Any = None  # provider-specific content kept only to replay inside the same turn (e.g. thinking blocks)


# A turn is a plain dict:
#   {"role": "user", "text": str}
#   {"role": "assistant", "text": str, "tool_calls": [ToolCall], "raw": Any}
#   {"role": "tool", "results": [{"id": str, "content": str, "is_error": bool}]}
Turn = dict


class LLMProvider(ABC):
    name = "base"
    model = ""

    @abstractmethod
    def complete(self, system: str, turns: list[Turn], tools: list[ToolSpec], max_tokens: int) -> LLMReply: ...


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, *, api_key: str, model: str, timeout: float, max_retries: int, base_url: str = "", effort: str = ""):
        import anthropic

        self._sdk = anthropic
        kwargs: dict = {"api_key": api_key, "timeout": timeout, "max_retries": max_retries}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = anthropic.Anthropic(**kwargs)
        self.model = model
        self._effort = effort

    def _messages(self, turns: list[Turn]) -> list[dict]:
        out: list[dict] = []
        for t in turns:
            if t["role"] == "user":
                out.append({"role": "user", "content": t["text"]})
            elif t["role"] == "assistant":
                out.append({"role": "assistant", "content": t["raw"] if t.get("raw") is not None else t["text"]})
            else:  # tool results travel in ONE user message, as the API requires for parallel tool calls
                out.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": r["id"], "content": r["content"], "is_error": bool(r.get("is_error"))} for r in t["results"]]})
        return out

    def complete(self, system: str, turns: list[Turn], tools: list[ToolSpec], max_tokens: int) -> LLMReply:
        sdk = self._sdk
        params: dict = {"model": self.model, "max_tokens": max_tokens, "system": system, "messages": self._messages(turns)}
        if tools:
            params["tools"] = [{"name": t.name, "description": t.description, "input_schema": t.input_schema} for t in tools]
        if self._effort:
            params["output_config"] = {"effort": self._effort}
        try:
            resp = self._client.messages.create(**params)
        except sdk.APITimeoutError as e:  # before APIConnectionError: it is a subclass
            raise LLMError("timeout", "The AI service took too long to answer. Please try again.") from e
        except (sdk.AuthenticationError, sdk.PermissionDeniedError) as e:
            log.error("LLM provider rejected the configured credentials (%s)", type(e).__name__)  # never log the key or the response body
            raise LLMError("auth", "The AI service is misconfigured. Please tell an administrator.") from e
        except sdk.RateLimitError as e:
            raise LLMError("rate_limit", "The AI service is busy right now. Please try again in a minute.") from e
        except (sdk.APIConnectionError, sdk.InternalServerError, sdk.OverloadedError, sdk.ServiceUnavailableError) as e:
            raise LLMError("unavailable", "The AI service is temporarily unreachable. Please try again.") from e
        except sdk.APIStatusError as e:
            log.error("LLM provider returned HTTP %s", getattr(e, "status_code", "?"))
            raise LLMError("unavailable", "The AI service could not process this request.") from e

        if resp.stop_reason == "refusal":
            raise LLMError("refused", "The AI service declined to answer this request. Try rephrasing your question.")
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        calls = [ToolCall(id=b.id, name=b.name, args=b.input if isinstance(b.input, dict) else {}) for b in resp.content if b.type == "tool_use"]
        if resp.stop_reason == "max_tokens" and not calls:
            text = (text + "\n\n_(The answer was cut short. Ask me to continue or narrow the question.)_").strip()
        return LLMReply(text=text, tool_calls=calls, raw=resp.content)


class OpenAICompatibleProvider(LLMProvider):
    """OpenAI chat-completions protocol through the official `openai` SDK; `base_url` selects the vendor."""
    name = "openai"

    def __init__(self, *, api_key: str, model: str, timeout: float, max_retries: int, base_url: str = "", effort: str = ""):
        import openai

        self._sdk = openai
        kwargs: dict = {"api_key": api_key, "timeout": timeout, "max_retries": max_retries}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = openai.OpenAI(**kwargs)
        self.model = model
        self._effort = effort
        # api.openai.com's newer models reject `max_tokens`; most other compatible servers only know `max_tokens`.
        self._max_param = "max_tokens" if base_url else "max_completion_tokens"

    def _messages(self, system: str, turns: list[Turn]) -> list[dict]:
        out: list[dict] = [{"role": "system", "content": system}]
        for t in turns:
            if t["role"] == "user":
                out.append({"role": "user", "content": t["text"]})
            elif t["role"] == "assistant":
                m: dict = {"role": "assistant", "content": t["text"] or None}
                if t.get("tool_calls"):
                    m["tool_calls"] = [{"id": c.id, "type": "function", "function": {"name": c.name, "arguments": json.dumps(c.args)}} for c in t["tool_calls"]]
                elif not t["text"]:
                    m["content"] = ""
                out.append(m)
            else:  # one message per tool result in this protocol
                out += [{"role": "tool", "tool_call_id": r["id"], "content": r["content"]} for r in t["results"]]
        return out

    def complete(self, system: str, turns: list[Turn], tools: list[ToolSpec], max_tokens: int) -> LLMReply:
        sdk = self._sdk
        params: dict = {"model": self.model, "messages": self._messages(system, turns), self._max_param: max_tokens}
        if tools:
            params["tools"] = [{"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.input_schema}} for t in tools]
        if self._effort:
            params["reasoning_effort"] = self._effort
        try:
            resp = self._client.chat.completions.create(**params)
        except sdk.APITimeoutError as e:  # before APIConnectionError: it is a subclass
            raise LLMError("timeout", "The AI service took too long to answer. Please try again.") from e
        except (sdk.AuthenticationError, sdk.PermissionDeniedError) as e:
            log.error("LLM provider rejected the configured credentials (%s)", type(e).__name__)
            raise LLMError("auth", "The AI service is misconfigured. Please tell an administrator.") from e
        except sdk.RateLimitError as e:
            raise LLMError("rate_limit", "The AI service is busy right now. Please try again in a minute.") from e
        except (sdk.APIConnectionError, sdk.InternalServerError) as e:
            raise LLMError("unavailable", "The AI service is temporarily unreachable. Please try again.") from e
        except sdk.APIStatusError as e:
            log.error("LLM provider returned HTTP %s (check LLM_MODEL and LLM_BASE_URL)", getattr(e, "status_code", "?"))
            raise LLMError("unavailable", "The AI service could not process this request.") from e

        if not resp.choices:
            raise LLMError("bad_response", "The AI service returned an empty response. Please try again.")
        choice = resp.choices[0]
        if choice.finish_reason == "content_filter":
            raise LLMError("refused", "The AI service declined to answer this request. Try rephrasing your question.")
        msg = choice.message
        text = (msg.content or "").strip()
        calls: list[ToolCall] = []
        for i, tc in enumerate(msg.tool_calls or []):
            fn = getattr(tc, "function", None)
            if fn is None:
                continue
            try:
                args = json.loads(fn.arguments or "{}")
                if not isinstance(args, dict):
                    raise ValueError
            except ValueError:
                args = {"_unparseable_arguments": True}  # rejected by the tool's schema; the model is told and can retry
            calls.append(ToolCall(id=tc.id or f"call_{i}", name=fn.name, args=args))
        if choice.finish_reason == "length" and not calls:
            text = (text + "\n\n_(The answer was cut short. Ask me to continue or narrow the question.)_").strip()
        return LLMReply(text=text, tool_calls=calls)


@dataclass(frozen=True)
class ProviderSpec:
    factory: Callable[..., LLMProvider]
    base_url: str = ""  # default endpoint; LLM_BASE_URL overrides it
    needs_key: bool = True
    needs_base_url: bool = False  # generic endpoints have no default
    default_model: str = ""  # empty = LLM_MODEL is required


_A, _O = AnthropicProvider, OpenAICompatibleProvider
PROVIDERS: dict[str, ProviderSpec] = {
    "anthropic": ProviderSpec(_A, default_model="claude-opus-5-5"),
    "openai": ProviderSpec(_O),
    "openai_compatible": ProviderSpec(_O, needs_base_url=True),  # any other OpenAI-protocol endpoint (vLLM, LM Studio, Azure gateways, ...)
    "gemini": ProviderSpec(_O, base_url="https://generativelanguage.googleapis.com/v1beta/openai/"),
    "mistral": ProviderSpec(_O, base_url="https://api.mistral.ai/v1"),
    "groq": ProviderSpec(_O, base_url="https://api.groq.com/openai/v1"),
    "deepseek": ProviderSpec(_O, base_url="https://api.deepseek.com"),
    "openrouter": ProviderSpec(_O, base_url="https://openrouter.ai/api/v1"),
    "together": ProviderSpec(_O, base_url="https://api.together.xyz/v1"),
    "ollama": ProviderSpec(_O, base_url="http://localhost:11434/v1", needs_key=False),  # local models, no key
}


def _resolve():
    """-> (spec, model, base_url) when the configuration is usable, else None. Reasons are logged for the operator, never shown to users."""
    cfg = current_app.config
    name = cfg.get("LLM_PROVIDER", "anthropic")
    spec = PROVIDERS.get(name)
    if spec is None:
        log.warning("LLM_PROVIDER=%r is not supported. Use one of: %s", name, ", ".join(PROVIDERS))
        return None
    model = cfg.get("LLM_MODEL") or spec.default_model
    base_url = cfg.get("LLM_BASE_URL") or spec.base_url
    problems = [p for p, bad in (("LLM_API_KEY", spec.needs_key and not cfg.get("LLM_API_KEY")), ("LLM_MODEL", not model), ("LLM_BASE_URL", spec.needs_base_url and not base_url)) if bad]
    if problems:
        log.warning("AI assistant not configured for provider %r: set %s", name, ", ".join(problems))
        return None
    return spec, model, base_url


def provider_status() -> dict:
    """What the UI may know: whether the assistant works and which service it uses. Never the key."""
    name = current_app.config.get("LLM_PROVIDER", "anthropic")
    resolved = _resolve()
    if resolved is None:
        return {"available": False, "provider": name, "reason": NOT_CONFIGURED_MESSAGE}
    return {"available": True, "provider": name, "model": resolved[1]}


def get_provider() -> LLMProvider | None:
    """The configured provider, or None when the assistant is not configured."""
    resolved = _resolve()
    if resolved is None:
        return None
    spec, model, base_url = resolved
    cfg = current_app.config
    p = spec.factory(api_key=cfg.get("LLM_API_KEY") or "not-needed", model=model, timeout=cfg["LLM_TIMEOUT_SECONDS"], max_retries=cfg["LLM_MAX_RETRIES"], base_url=base_url, effort=cfg.get("LLM_EFFORT", ""))
    return p
