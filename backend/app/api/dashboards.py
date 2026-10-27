from flask import Blueprint

from ..responses import ok
from ..schemas.content import DashboardQuery
from ..security import auth_required, current_user, permission_required, roles_required
from ..services import dashboards
from ..validation import parse_query

bp = Blueprint("dashboards", __name__)


@bp.get("/faculty/dashboard")
@permission_required("reports.view", "applications.review", "students.view", any_of=True)
def faculty():
    return ok(dashboards.faculty_dashboard(current_user(), parse_query(DashboardQuery)))


@bp.get("/admin/dashboard")
@roles_required("admin")
def admin():
    return ok(dashboards.admin_dashboard(current_user()))


@bp.get("/reference/filters")
@auth_required
def reference():
    return ok(dashboards.reference_filters(current_user()))
