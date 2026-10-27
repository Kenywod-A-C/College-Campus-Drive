from flask import Blueprint

from ..responses import ok, paginated
from ..schemas.review import InterviewIn, InterviewQuery, InterviewStatusIn
from ..security import auth_required, current_user, permission_required
from ..services import interviews_service as svc
from ..validation import parse_body, parse_query

bp = Blueprint("interviews", __name__)


@bp.get("")
@auth_required  # students see only their own rounds, staff need applications.review (decided in the service)
def list_():
    q = parse_query(InterviewQuery)
    items, total = svc.list_interviews(current_user(), q)
    return paginated(items, page=q.page, page_size=q.page_size, total=total)


@bp.post("")
@permission_required("applications.review")
def create():
    return ok(svc.save_interview(current_user(), parse_body(InterviewIn)), 201)


@bp.put("/<int:interview_id>")
@permission_required("applications.review")
def update(interview_id: int):
    return ok(svc.save_interview(current_user(), parse_body(InterviewIn), interview_id))


@bp.post("/<int:interview_id>/status")
@permission_required("applications.review")
def status(interview_id: int):
    return ok(svc.set_status(current_user(), interview_id, parse_body(InterviewStatusIn).status))


@bp.post("/<int:interview_id>/notify")
@permission_required("applications.review")
def notify(interview_id: int):
    return ok(svc.notify_candidates(current_user(), interview_id))
