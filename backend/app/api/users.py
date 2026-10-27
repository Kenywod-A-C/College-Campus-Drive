from flask import Blueprint

from ..responses import ok, paginated
from ..schemas.admin import ImportIn, UserIn, UserQuery, UserStatusIn
from ..security import current_user, permission_required
from ..services import users_service as svc
from ..validation import parse_body, parse_query

bp = Blueprint("users", __name__)


@bp.get("")
@permission_required("users.manage")
def list_():
    q = parse_query(UserQuery)
    items, total = svc.list_users(q)
    return paginated(items, page=q.page, page_size=q.page_size, total=total)


@bp.post("")
@permission_required("users.manage")
def create():
    return ok(svc.create_user(current_user(), parse_body(UserIn)), 201)


@bp.post("/import")
@permission_required("users.manage")
def import_():
    return ok(svc.import_students(current_user(), parse_body(ImportIn)))


@bp.put("/<int:user_id>")
@permission_required("users.manage")
def update(user_id: int):
    return ok(svc.update_user(current_user(), user_id, parse_body(UserIn)))


@bp.post("/<int:user_id>/status")
@permission_required("users.manage")
def status(user_id: int):
    return ok(svc.set_status(current_user(), user_id, parse_body(UserStatusIn).status))


@bp.post("/<int:user_id>/reset-password")
@permission_required("users.manage")
def reset_password(user_id: int):
    return ok(svc.reset_password(current_user(), user_id))
