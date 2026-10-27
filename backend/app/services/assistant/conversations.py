"""Conversation persistence. Every read and write is scoped to the owning user; someone else's conversation is simply "not found"
(and the attempt is audited), so ids cannot be probed."""
from datetime import timedelta

from ...errors import NotFound
from ...extensions import db
from ...models import AssistantAction, AssistantActionState, AuditResult, Conversation, Message, iso, sid, utcnow
from .. import audit
from . import actions as action_svc

LIST_LIMIT = 100


def message_dict(m: Message, action: AssistantAction | None = None) -> dict:
    p = m.payload or {}
    d = {"id": sid(m.id), "role": m.role.value, "text": m.text, "at": iso(m.created_at), "jobIds": p.get("jobIds"), "sources": p.get("sources"), "charts": p.get("charts"), "reports": p.get("reports"), "tools": p.get("tools"),
         "action": action_svc.action_dict(action) if action else None}
    return {k: v for k, v in d.items() if v}


def conversation_dict(c: Conversation) -> dict:
    ids = [m.id for m in c.messages]
    actions = {a.message_id: a for a in db.session.query(AssistantAction).filter(AssistantAction.message_id.in_(ids or [0]), AssistantAction.user_id == c.user_id)}
    return {"id": sid(c.id), "title": c.title, "updatedAt": iso(c.updated_at), "messages": [message_dict(m, actions.get(m.id)) for m in c.messages]}


def list_for(user) -> list[dict]:
    rows = (db.session.query(Conversation).filter(Conversation.user_id == user.id, Conversation.archived_at.is_(None))
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc()).limit(LIST_LIMIT).all())
    return [{"id": sid(c.id), "title": c.title, "updatedAt": iso(c.updated_at), "count": len(c.messages)} for c in rows]


def get_owned(user, conversation_id: int) -> Conversation:
    c = db.session.get(Conversation, conversation_id)
    if c is None or c.archived_at is not None:
        raise NotFound("Conversation")
    if c.user_id != user.id:
        audit.record("assistant.conversation", f"Conversation {conversation_id}", result=AuditResult.DENIED, reason="Not the owner", actor=user, commit=True)
        raise NotFound("Conversation")
    return c


def create(user) -> dict:
    c = Conversation(user_id=user.id)
    db.session.add(c)
    db.session.commit()
    return conversation_dict(c)


def archive(user, conversation_id: int) -> None:
    """Retention policy: deleting hides the conversation immediately and cancels anything still awaiting confirmation;
    the rows are hard-deleted by `flask assistant-purge` after ASSISTANT_RETENTION_DAYS. Audit entries are kept."""
    c = get_owned(user, conversation_id)
    now = utcnow()
    c.archived_at = now
    db.session.query(AssistantAction).filter(AssistantAction.conversation_id == c.id, AssistantAction.state == AssistantActionState.AWAITING).update(
        {"state": AssistantActionState.CANCELLED, "result_message": "The conversation was deleted. Nothing was changed.", "resolved_at": now}, synchronize_session=False)
    audit.record("assistant.conversation.delete", f"Conversation {c.id}", actor=user)
    db.session.commit()


def purge_archived(days: int) -> int:
    cutoff = utcnow() - timedelta(days=days)
    rows = db.session.query(Conversation).filter(Conversation.archived_at.is_not(None), Conversation.archived_at < cutoff).all()
    for c in rows:
        db.session.delete(c)  # messages and actions cascade
    db.session.commit()
    return len(rows)
