"""Confirmation of consequential actions proposed by the assistant.

The model can only *propose* (tools.prepare_*). Nothing runs until the OWNER confirms; then, at confirmation time:
  1. the action is atomically claimed (awaiting -> executing) so a double click or two tabs cannot execute it twice;
  2. the caller's role/permission is re-checked against the database (they may have lost it since the proposal);
  3. the change runs through the SAME validated service function the normal UI uses, which re-applies every business rule
     (eligibility, deadlines, policy limits, stage state machine) with whatever the data looks like NOW;
  4. success is reported only after that service call has committed; otherwise the reason is returned and nothing is claimed.
Every outcome is written to the audit log.
"""
import logging
from datetime import timedelta

from flask import current_app

from ...errors import ApiError, Conflict, NotFound
from ...extensions import db
from ...models import AssistantAction, AssistantActionState, AuditResult, User, utcnow
from ...schemas.admin import ImportIn, PolicyIn, UserIn
from ...schemas.content import CompanyIn, ReminderIn
from ...schemas.review import StageIn
from ...schemas.students import VerifyCgpaIn
from .. import admin_service, applications_review_service, applications_service, audit, content_service, students_service, users_service

log = logging.getLogger(__name__)
S = AssistantActionState


def _run_apply(user: User, p: dict) -> str:
    v = applications_service.apply(user, int(p["jobId"]))
    return f"Application submitted (status: {v['application']['status']}). Track it in My Applications."


def _run_reminder(user: User, p: dict) -> str:
    content_service.save_reminder(user, ReminderIn(title=p["title"], at=p["at"], job_id=p.get("jobId")))
    return "Reminder created. You can edit it under Reminders & Notifications."


def _run_stage(user: User, p: dict) -> str:
    r = applications_review_service.update_stage(user, StageIn(ids=p["ids"], status=p["status"], note=p.get("note")))
    if not r["updated"]:
        raise Conflict("No applicant was changed: " + "; ".join(f["reason"] for f in r["failed"][:3]))
    msg = f"Updated {len(r['updated'])} applicant(s)."
    if r["failed"]:
        msg += f" {len(r['failed'])} could not be changed: " + "; ".join(f["reason"] for f in r["failed"][:3])
    return msg


def _run_user_create(user: User, p: dict) -> str:
    v = users_service.create_user(user, UserIn.model_validate(p["user"]))
    return (f"Created the {v['role']} account for {v['name']} ({v['userCode']}) as 'invited'. E-mail delivery is not configured on this server, so no invitation was sent: "
            "use Reset password in User Management to get their set-password link.")


def _run_user_update(user: User, p: dict) -> str:
    v = users_service.update_user(user, int(p["userId"]), UserIn.model_validate(p["user"]))
    return f"Updated {v['name']} ({v['userCode']})."


def _run_user_status(user: User, p: dict) -> str:
    v = users_service.set_status(user, int(p["userId"]), p["status"])
    return f"{v['name']} is now {v['status']}." + (" They can no longer sign in." if v["status"] == "inactive" else "")


def _run_student_import(user: User, p: dict) -> str:
    r = users_service.import_students(user, ImportIn.model_validate({"rows": p["rows"]}))
    if not r["imported"]:
        raise Conflict("No student was created: " + "; ".join(f"row {e['row']} {e['field']}: {e['message']}" for e in r["errors"][:4]))
    msg = f"Created {r['imported']} of {r['total']} student account(s) as 'invited' (no e-mail is sent; use Reset password for their links)."
    if r["errors"]:
        msg += " Skipped: " + "; ".join(f"row {e['row']} {e['field']}: {e['message']}" for e in r["errors"][:4])
    return msg


def _run_company_save(user: User, p: dict) -> str:
    v = content_service.save_company(user, CompanyIn.model_validate(p["company"]), int(p["companyId"]) if p.get("companyId") else None)
    return f"{'Updated' if p.get('companyId') else 'Created'} company {v['name']}."


def _run_company_archive(user: User, p: dict) -> str:
    v = content_service.archive_company(user, int(p["companyId"]), bool(p["archived"]))
    return f"{v['name']} is now {'archived' if p['archived'] else 'active again'}."


def _run_policy_save(user: User, p: dict) -> str:
    v = admin_service.save_policy(user, PolicyIn.model_validate(p["policy"]), int(p["policyId"]) if p.get("policyId") else None)
    return f"{'Updated' if p.get('policyId') else 'Created'} the policy \"{v['name']}\". It applies to new checks immediately."


def _run_policy_delete(user: User, p: dict) -> str:
    admin_service.delete_policy(user, int(p["policyId"]), p["reason"])
    return f"Deleted the policy \"{p.get('name', '')}\"."


def _run_verify_cgpa(user: User, p: dict) -> str:
    r = students_service.verify_cgpa(user, int(p["studentId"]), VerifyCgpaIn(cgpa=p.get("cgpa")))
    return f"Verified the CGPA of {r['name']} ({r.get('academic', {}).get('cgpa')})."


STAFF_R = {"faculty", "admin"}
# kind -> (roles allowed to confirm, permissions required, executor)
SPECS = {
    "apply": ({"student"}, (), _run_apply),
    "create_reminder": ({"student"}, (), _run_reminder),
    "update_stage": (STAFF_R, ("applications.review",), _run_stage),
    "user_create": (STAFF_R, ("users.manage",), _run_user_create),
    "user_update": (STAFF_R, ("users.manage",), _run_user_update),
    "user_status": (STAFF_R, ("users.manage",), _run_user_status),
    "student_import": (STAFF_R, ("users.manage",), _run_student_import),
    "company_save": (STAFF_R, ("companies.manage",), _run_company_save),
    "company_archive": (STAFF_R, ("companies.manage",), _run_company_archive),
    "policy_save": (STAFF_R, ("policies.manage",), _run_policy_save),
    "policy_delete": (STAFF_R, ("policies.manage",), _run_policy_delete),
    "verify_cgpa": (STAFF_R, ("students.edit",), _run_verify_cgpa),
}


def is_destructive(a: AssistantAction) -> bool:
    """Deactivating an account, archiving a company or deleting a policy gets a warning style on the confirmation card."""
    p = a.payload or {}
    return (a.kind == "user_status" and p.get("status") == "inactive") or (a.kind == "company_archive" and bool(p.get("archived"))) or a.kind == "policy_delete"


def effective_state(a: AssistantAction) -> str:
    if a.state in (S.AWAITING, S.EXECUTING):
        return "expired" if a.state == S.AWAITING and a.expires_at < utcnow() else "awaiting_confirmation"
    return a.state.value


def action_dict(a: AssistantAction) -> dict:
    d = {"id": str(a.id), "kind": a.kind, "title": a.title, "description": a.description, "details": list(a.details or []), "state": effective_state(a)}
    if is_destructive(a):
        d["destructive"] = True
    if a.result_message:
        d["resultMessage"] = a.result_message
    elif d["state"] == "expired":
        d["resultMessage"] = "This proposal expired. Ask the assistant to prepare it again."
    return d


def create_from_proposal(user: User, conversation_id: int, message_id: int, p) -> AssistantAction:
    a = AssistantAction(user_id=user.id, conversation_id=conversation_id, message_id=message_id, kind=p.kind, title=p.title[:200], description=p.description[:500],
                        details=p.details, payload=p.payload, state=S.AWAITING, expires_at=utcnow() + timedelta(minutes=current_app.config["ASSISTANT_ACTION_TTL_MINUTES"]))
    db.session.add(a)
    return a


def _owned(user: User, action_id: int) -> AssistantAction:
    a = db.session.get(AssistantAction, action_id)
    if a is None or a.user_id != user.id:
        if a is not None:
            audit.record("assistant.action", f"Action {action_id}", result=AuditResult.DENIED, reason="Not the owner", actor=user, commit=True)
        raise NotFound("Action")
    return a


def _claim(user: User, action_id: int, to: AssistantActionState, message: str | None = None) -> AssistantAction:
    """Atomic awaiting -> `to`. Exactly one concurrent request wins."""
    a = _owned(user, action_id)
    now = utcnow()
    if a.state == S.AWAITING and a.expires_at < now:
        a.state, a.result_message, a.resolved_at = S.EXPIRED, "This proposal expired. Ask the assistant to prepare it again.", now
        db.session.commit()
        raise Conflict("This proposal expired. Ask the assistant to prepare it again.")
    won = db.session.query(AssistantAction).filter(AssistantAction.id == a.id, AssistantAction.user_id == user.id, AssistantAction.state == S.AWAITING).update(
        {"state": to, **({"result_message": message, "resolved_at": now} if message else {})}, synchronize_session=False)
    db.session.commit()
    if not won:
        raise Conflict("This action was already handled.")
    db.session.refresh(a)
    return a


def _finish(a_id: int, user: User, state: AssistantActionState, message: str) -> AssistantAction:
    now = utcnow()
    db.session.query(AssistantAction).filter(AssistantAction.id == a_id).update({"state": state, "result_message": message[:500], "resolved_at": now}, synchronize_session=False)
    a = db.session.get(AssistantAction, a_id)
    audit.record(f"assistant.action.{state.value}", f"Action {a_id} · {a.kind} · {a.title}", actor=user, result=AuditResult.SUCCESS if state != S.FAILED else AuditResult.FAILED, reason=message[:400])
    db.session.commit()
    db.session.refresh(a)
    return a


def reject(user: User, action_id: int) -> dict:
    a = _claim(user, action_id, S.CANCELLED, "Cancelled. Nothing was changed.")
    audit.record("assistant.action.cancelled", f"Action {a.id} · {a.kind} · {a.title}", actor=user)
    db.session.commit()
    return action_dict(a)


def confirm(user: User, action_id: int) -> dict:
    a = _claim(user, action_id, S.EXECUTING)
    roles, perms, run = SPECS.get(a.kind, (set(), (), None))
    kind, payload, aid = a.kind, dict(a.payload or {}), a.id
    if run is None or user.role_name not in roles or not all(user.has_permission(p) for p in perms):
        audit.record("assistant.action", f"Action {aid} · {kind}", result=AuditResult.DENIED, reason="Role or permission no longer allows this", actor=user)
        return action_dict(_finish(aid, user, S.FAILED, "You no longer have permission to do this. Nothing was changed."))
    try:
        message = run(user, payload)  # the service commits on success
    except ApiError as e:  # business rules are re-applied now; the reason is shown to the user, nothing was changed
        db.session.rollback()
        return action_dict(_finish(aid, user, S.FAILED, f"The server did not allow this: {e.message}"))
    except Exception:  # noqa: BLE001
        log.exception("assistant action %s failed", aid)
        db.session.rollback()
        return action_dict(_finish(aid, user, S.FAILED, "Something went wrong and nothing was changed. Please try again."))
    return action_dict(_finish(aid, user, S.CONFIRMED, message))
