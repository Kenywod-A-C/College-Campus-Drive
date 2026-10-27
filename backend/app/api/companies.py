from flask import Blueprint

from ..responses import ok, paginated
from ..schemas.content import CompanyIn, CompanyQuery
from ..schemas.jobs import ArchiveIn
from ..security import current_user, permission_required
from ..services import content_service as svc
from ..validation import parse_body, parse_query

bp = Blueprint("companies", __name__)
READ = ("companies.manage", "jobs.create", "applications.review", "students.view")


@bp.get("")
@permission_required(*READ, any_of=True)
def list_():
    q = parse_query(CompanyQuery)
    items, total, industries = svc.list_companies(q)
    return paginated(items, page=q.page, page_size=q.page_size, total=total, industries=industries)


@bp.get("/<int:company_id>")
@permission_required(*READ, any_of=True)
def get(company_id: int):
    return ok(svc.get_company(company_id))


@bp.post("")
@permission_required("companies.manage")
def create():
    return ok(svc.save_company(current_user(), parse_body(CompanyIn)), 201)


@bp.put("/<int:company_id>")
@permission_required("companies.manage")
def update(company_id: int):
    return ok(svc.save_company(current_user(), parse_body(CompanyIn), company_id))


@bp.post("/<int:company_id>/archive")
@permission_required("companies.manage")
def archive(company_id: int):
    return ok(svc.archive_company(current_user(), company_id, parse_body(ArchiveIn).archived))
