from flask import Blueprint

from ..responses import ok, paginated
from ..schemas.students import StudentQuery, VerifyCgpaIn
from ..security import current_user, permission_required
from ..services import students_service as svc
from ..validation import parse_body, parse_query

bp = Blueprint("students", __name__)


@bp.get("")
@permission_required("students.view")
def list_():
    q = parse_query(StudentQuery)
    items, total = svc.list_students(current_user(), q)
    return paginated(items, page=q.page, page_size=q.page_size, total=total)


@bp.get("/<int:student_id>")
@permission_required("students.view")
def detail(student_id: int):
    return ok(svc.get_student(current_user(), student_id))


@bp.post("/<int:student_id>/verify-cgpa")
@permission_required("students.edit")
def verify_cgpa(student_id: int):
    return ok(svc.verify_cgpa(current_user(), student_id, parse_body(VerifyCgpaIn)))
