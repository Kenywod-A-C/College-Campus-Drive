from flask import Blueprint

from ..responses import ok
from ..schemas.content import ReminderIn
from ..security import current_user, roles_required
from ..services import content_service as svc
from ..validation import parse_body

bp = Blueprint("reminders", __name__)


@bp.get("")
@roles_required("student")
def list_():
    return ok(svc.list_reminders(current_user()))


@bp.post("")
@roles_required("student")
def create():
    return ok(svc.save_reminder(current_user(), parse_body(ReminderIn)), 201)


@bp.put("/<int:reminder_id>")
@roles_required("student")
def update(reminder_id: int):
    return ok(svc.save_reminder(current_user(), parse_body(ReminderIn), reminder_id))


@bp.post("/<int:reminder_id>/toggle")
@roles_required("student")
def toggle(reminder_id: int):
    return ok(svc.toggle_reminder(current_user(), reminder_id))


@bp.delete("/<int:reminder_id>")
@roles_required("student")
def delete(reminder_id: int):
    svc.delete_reminder(current_user(), reminder_id)
    return ok({"ok": True})
