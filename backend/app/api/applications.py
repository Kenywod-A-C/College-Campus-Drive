from flask import Blueprint

from ..responses import ok, paginated
from ..schemas.jobs import ApplicationQuery, ApplyIn
from ..schemas.review import ApplicationReviewQuery, StageIn
from ..security import auth_required, current_user, permission_required, roles_required
from ..services import applications_review_service as review
from ..services import applications_service
from ..validation import parse_body, parse_query

bp = Blueprint("applications", __name__)


@bp.post("")
@roles_required("student")
def apply():
    return ok(applications_service.apply(current_user(), parse_body(ApplyIn).job_id), 201)


# ---------------------------------------------------------------- staff review (applications.review)
@bp.get("")
@permission_required("applications.review")
def list_all():
    q = parse_query(ApplicationReviewQuery)
    items, total = review.list_applications(current_user(), q)
    return paginated(items, page=q.page, page_size=q.page_size, total=total)


@bp.post("/stage")
@permission_required("applications.review")
def stage():
    return ok(review.update_stage(current_user(), parse_body(StageIn)))


@bp.get("/export")
@permission_required("reports.view", "applications.review")
def export():
    return ok(review.export_csv(current_user(), parse_query(ApplicationReviewQuery)))


@bp.get("/me")
@roles_required("student")
def mine():
    q = parse_query(ApplicationQuery)
    items, total = applications_service.list_mine(current_user(), q)
    return paginated(items, page=q.page, page_size=q.page_size, total=total)


@bp.get("/<int:application_id>")
@auth_required
def detail(application_id: int):
    return ok(applications_service.get_detail(current_user(), application_id))


@bp.post("/<int:application_id>/withdraw")
@roles_required("student")
def withdraw(application_id: int):
    return ok(applications_service.withdraw(current_user(), application_id))
