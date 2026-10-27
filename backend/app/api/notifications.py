from flask import Blueprint

from ..responses import ok
from ..schemas.content import PrefsIn
from ..security import auth_required, current_user
from ..services import content_service as svc
from ..validation import parse_body

bp = Blueprint("notifications", __name__)


@bp.get("")
@auth_required
def list_():
    return ok(svc.list_notifications(current_user()))


@bp.post("/read-all")
@auth_required
def read_all():
    svc.mark_all_read(current_user())
    return ok({"ok": True})


@bp.get("/preferences")
@auth_required
def get_prefs():
    return ok(svc.get_prefs(current_user()))


@bp.put("/preferences")
@auth_required
def put_prefs():
    return ok(svc.set_prefs(current_user(), parse_body(PrefsIn)))


@bp.post("/<int:notification_id>/read")
@auth_required
def read(notification_id: int):
    return ok(svc.mark_read(current_user(), notification_id))
