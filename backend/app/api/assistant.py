"""AI assistant API. Every route needs a signed-in, active user; every record is scoped to that user (conversations, actions)."""
from flask import Blueprint, current_app, g

from ..extensions import limiter
from ..responses import ok
from ..schemas.assistant import ChatIn
from ..security import auth_required, current_user
from ..services.assistant import actions, conversations, llm, orchestrator, suggestions
from ..validation import parse_body

bp = Blueprint("assistant", __name__)


@bp.get("/status")
@auth_required
def status():
    return ok(llm.provider_status())


@bp.get("/suggestions")
@auth_required
def suggested():
    return ok(suggestions.for_user(current_user()))


@bp.get("/conversations")
@auth_required
def list_conversations():
    return ok(conversations.list_for(current_user()))


@bp.post("/conversations")
@auth_required
def create_conversation():
    return ok(conversations.create(current_user()), 201)


@bp.get("/conversations/<int:conversation_id>")
@auth_required
def get_conversation(conversation_id: int):
    return ok(conversations.conversation_dict(conversations.get_owned(current_user(), conversation_id)))


@bp.delete("/conversations/<int:conversation_id>")
@auth_required
def delete_conversation(conversation_id: int):
    conversations.archive(current_user(), conversation_id)
    return ok({"ok": True})


@bp.post("/chat")
@auth_required
@limiter.limit(lambda: current_app.config["ASSISTANT_CHAT_RATE_LIMIT"], key_func=lambda: f"assistant:{g.current_user.id}")  # per user, not per IP (campus NAT)
def chat():
    body = parse_body(ChatIn)
    return ok(orchestrator.chat(current_user(), body.conversation_id, body.message))


@bp.post("/actions/<int:action_id>/confirm")
@auth_required
def confirm_action(action_id: int):
    return ok(actions.confirm(current_user(), action_id))


@bp.post("/actions/<int:action_id>/reject")
@auth_required
def reject_action(action_id: int):
    return ok(actions.reject(current_user(), action_id))
