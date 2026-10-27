"""Audit trail helper. Writes are append-only (see AuditLog)."""
from flask import has_request_context, request

from ..extensions import db
from ..models import AuditLog, AuditResult, User


def record(action: str, resource: str, *, result: AuditResult = AuditResult.SUCCESS, reason: str | None = None, actor: User | None = None,
           actor_label: str | None = None, commit: bool = False) -> AuditLog:
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        actor_name=(actor.name if actor else actor_label) or "anonymous",
        actor_role=actor.role_name if actor else "system",
        action=action, resource=resource[:255], result=result, reason=(reason or None) and reason[:400],
        ip_address=(request.remote_addr or None) if has_request_context() else None,
    )
    db.session.add(entry)
    if commit:
        db.session.commit()
    return entry
