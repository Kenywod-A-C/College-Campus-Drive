"""Deterministic stand-in for the model provider. Lives under tests/ on purpose: production code has no fake provider,
so it can never answer with canned text. A script is a list of steps; each step is an LLMReply, an exception to raise, or a
callable (system, turns, tools) -> LLMReply | Exception for replies that depend on earlier tool results."""
import json

from app.services.assistant.llm import LLMProvider, LLMReply, ToolCall


def say(text: str) -> LLMReply:
    return LLMReply(text=text)


def call(tool_name: str, /, **args) -> LLMReply:  # positional-only so tool arguments may themselves be called "name"
    return LLMReply(tool_calls=[ToolCall(id=f"toolu_{tool_name}", name=tool_name, args=args)])


def calls(*cs: tuple[str, dict]) -> LLMReply:
    return LLMReply(tool_calls=[ToolCall(id=f"toolu_{i}_{n}", name=n, args=a) for i, (n, a) in enumerate(cs)])


def last_tool_result(turns: list[dict]) -> dict:
    """The JSON payload of the first tool result in the latest tool turn."""
    t = [x for x in turns if x["role"] == "tool"][-1]
    return json.loads(t["results"][0]["content"])


class ScriptedProvider(LLMProvider):
    name = "fake"
    model = "fake-model"

    def __init__(self, *steps):
        self.steps = list(steps)
        self.requests: list[dict] = []  # everything the "model" was ever shown

    def complete(self, system, turns, tools, max_tokens):
        self.requests.append({"system": system, "turns": [dict(t) for t in turns], "tools": [t.name for t in tools], "tool_specs": tools, "max_tokens": max_tokens})
        assert self.steps, "script exhausted: the orchestrator made an unexpected extra model call"
        step = self.steps.pop(0)
        if callable(step):
            step = step(system, turns, tools)
        if isinstance(step, Exception):
            raise step
        return step

    def everything_sent(self) -> str:
        """All text the model was given, as one string (system prompt, history, tool schemas and tool results)."""
        parts = []
        for r in self.requests:
            parts.append(r["system"])
            parts += [t.name + t.description + json.dumps(t.input_schema) for t in r["tool_specs"]]
            for t in r["turns"]:
                parts.append(t.get("text", ""))
                parts += [x["content"] for x in t.get("results", [])]
        return "\n".join(parts)
