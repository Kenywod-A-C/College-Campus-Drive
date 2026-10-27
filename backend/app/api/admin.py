"""Administrator area. Every route needs a permission or the admin role; writes are audited in the service layer."""
from flask import Blueprint

from ..responses import ok, paginated
from ..schemas.admin import AcademicYearIn, AuditQuery, CourseIn, DepartmentIn, PermissionToggleIn, PolicyDeleteIn, PolicyIn
from ..security import current_user, permission_required, roles_required
from ..services import admin_service as svc
from ..services import users_service
from ..validation import parse_body, parse_query

bp = Blueprint("admin", __name__)


# ---------------------------------------------------------------- roles & permissions (roles.manage + administrator role)
@bp.get("/roles")
@permission_required("roles.manage")
def roles():
    return ok(users_service.roles_overview())


@bp.put("/roles/<string:role>/permissions/<string:perm>")
@permission_required("roles.manage")
def set_permission(role: str, perm: str):
    return ok(users_service.set_permission(current_user(), role, perm, parse_body(PermissionToggleIn).enabled))


# ---------------------------------------------------------------- placement policies (policies.manage)
@bp.get("/policies")
@permission_required("policies.manage")
def policies():
    return ok(svc.list_policies())


@bp.post("/policies")
@permission_required("policies.manage")
def create_policy():
    return ok(svc.save_policy(current_user(), parse_body(PolicyIn)), 201)


@bp.put("/policies/<int:policy_id>")
@permission_required("policies.manage")
def update_policy(policy_id: int):
    return ok(svc.save_policy(current_user(), parse_body(PolicyIn), policy_id))


@bp.delete("/policies/<int:policy_id>")
@permission_required("policies.manage")
def delete_policy(policy_id: int):
    return ok(svc.delete_policy(current_user(), policy_id, parse_body(PolicyDeleteIn).reason))


# ---------------------------------------------------------------- academic configuration (administrator role)
@bp.get("/academic")
@roles_required("admin")
def academic():
    return ok(svc.academic_overview())


@bp.post("/departments")
@roles_required("admin")
def create_department():
    return ok(svc.save_department(current_user(), parse_body(DepartmentIn)), 201)


@bp.put("/departments/<int:dept_id>")
@roles_required("admin")
def update_department(dept_id: int):
    return ok(svc.save_department(current_user(), parse_body(DepartmentIn), dept_id))


@bp.delete("/departments/<int:dept_id>")
@roles_required("admin")
def delete_department(dept_id: int):
    return ok(svc.delete_department(current_user(), dept_id))


@bp.post("/courses")
@roles_required("admin")
def create_course():
    return ok(svc.save_course(current_user(), parse_body(CourseIn)), 201)


@bp.put("/courses/<int:course_id>")
@roles_required("admin")
def update_course(course_id: int):
    return ok(svc.save_course(current_user(), parse_body(CourseIn), course_id))


@bp.delete("/courses/<int:course_id>")
@roles_required("admin")
def delete_course(course_id: int):
    return ok(svc.delete_course(current_user(), course_id))


@bp.post("/academic-years")
@roles_required("admin")
def create_year():
    return ok(svc.save_academic_year(current_user(), parse_body(AcademicYearIn)), 201)


@bp.put("/academic-years/<int:year_id>")
@roles_required("admin")
def update_year(year_id: int):
    return ok(svc.save_academic_year(current_user(), parse_body(AcademicYearIn), year_id))


# ---------------------------------------------------------------- audit log (audit.view; read-only by design)
@bp.get("/audit-logs")
@permission_required("audit.view")
def audit_logs():
    q = parse_query(AuditQuery)
    items, total, actions = svc.list_audit(q)
    return paginated(items, page=q.page, page_size=q.page_size, total=total, actions=actions)
