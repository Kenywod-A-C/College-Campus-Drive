from flask import Blueprint

from ..extensions import db
from ..models import RoleName
from ..responses import ok, paginated
from ..schemas.jobs import ArchiveIn, JobIn, JobQuery, JobStatusIn
from ..security import auth_required, current_user, permission_required, roles_required
from ..services import jobs_admin_service as admin
from ..services import jobs_service
from ..validation import parse_body, parse_query

bp = Blueprint("jobs", __name__)


@bp.get("")
@auth_required
def list_jobs():
    q = parse_query(JobQuery)
    items, total, extra = jobs_service.list_jobs(current_user(), q)
    return paginated(items, page=q.page, page_size=q.page_size, total=total, **extra)


@bp.get("/<int:job_id>")
@auth_required
def get_job(job_id: int):
    return ok(jobs_service.get_job(current_user(), job_id))


@bp.post("/<int:job_id>/save")
@roles_required("student")
def save_job(job_id: int):
    return ok({"saved": jobs_service.toggle_save(current_user(), job_id)})


# ---------------------------------------------------------------- staff
@bp.post("")
@permission_required("jobs.create")
def create_job():
    return ok(admin.save_job(current_user(), parse_body(JobIn)), 201)


@bp.put("/<int:job_id>")
@permission_required("jobs.create")
def update_job(job_id: int):
    return ok(admin.save_job(current_user(), parse_body(JobIn), job_id))


@bp.post("/<int:job_id>/status")
@permission_required("drives.publish")
def set_status(job_id: int):
    body = parse_body(JobStatusIn)
    return ok(admin.set_status(current_user(), job_id, body.status, body.reason))


@bp.post("/<int:job_id>/archive")
@permission_required("drives.publish")
def archive(job_id: int):
    return ok(admin.archive_job(current_user(), job_id, parse_body(ArchiveIn).archived))


@bp.get("/<int:job_id>/drive")
@permission_required("jobs.create", "drives.publish", "applications.review", any_of=True)
def drive(job_id: int):
    return ok(admin.drive_detail(current_user(), job_id))
