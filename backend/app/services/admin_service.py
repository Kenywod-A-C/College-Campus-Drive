"""Administrator configuration: placement policies, departments, programmes, academic years, audit-log reads.

Every write is audited. Policies are data (the eligibility engine reads them on every evaluation, nothing is hardcoded), so a change applies to the next
eligibility check or offer acceptance. Deleting configuration that is still referenced is refused rather than cascaded."""
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from ..errors import Conflict, NotFound, ValidationFailed
from ..extensions import db
from ..models import (
    AcademicYear, AuditLog, AuditResult, Course, Degree, Department, FacultyProfile, PlacementPolicy, PolicyKind, PolicyScope, Student, User, iso, job_departments, sid, utcnow,
)
from ..schemas.admin import AcademicYearIn, AuditQuery, CourseIn, DepartmentIn, PolicyIn
from . import audit
from .dashboards import audit_dict


# ====================================================================== policies
def policy_dict(p: PlacementPolicy) -> dict:
    d = {"id": sid(p.id), "name": p.name, "description": p.description, "kind": p.kind.value, "scope": p.scope.value, "scopeValue": p.scope_value,
         "params": dict(p.params or {}), "enabled": bool(p.enabled), "updatedAt": iso(p.updated_at), "updatedBy": p.updated_by}
    return {k: v for k, v in d.items() if v is not None}


def list_policies() -> list[dict]:
    return [policy_dict(p) for p in db.session.query(PlacementPolicy).order_by(PlacementPolicy.id)]


def _check_scope(data: PolicyIn) -> None:
    if data.scope == "department" and db.session.get(Department, int(data.scope_value)) is None:
        raise ValidationFailed("Choose a valid department.", details={"scopeValue": ["Unknown department"]})
    if data.scope == "academic_year" and not db.session.query(AcademicYear.id).filter_by(graduation_year=int(data.scope_value)).first():
        raise ValidationFailed("Choose a configured batch.", details={"scopeValue": ["Unknown graduation year"]})


def save_policy(actor: User, data: PolicyIn, policy_id: int | None = None) -> dict:
    _check_scope(data)
    dup = db.session.query(PlacementPolicy).filter(sa.func.lower(PlacementPolicy.name) == data.name.lower(), PlacementPolicy.id != (policy_id or 0)).first()
    if dup:
        raise Conflict("A policy with this name already exists.", details={"name": ["Already in use"]})
    try:
        if policy_id is None:
            p = PlacementPolicy()
            before = None
        else:
            p = db.session.query(PlacementPolicy).filter_by(id=policy_id).with_for_update().first()
            if p is None:
                raise NotFound("Policy")
            if p.kind != PolicyKind(data.kind):
                raise Conflict("The kind of an existing policy cannot be changed. Create a new policy instead.")
            before = policy_dict(p)
        p.name, p.description, p.kind, p.scope, p.scope_value = data.name, data.description, PolicyKind(data.kind), PolicyScope(data.scope), data.scope_value
        p.params, p.enabled, p.updated_by, p.updated_at = dict(data.params), data.enabled, actor.name, utcnow()
        db.session.add(p)
        db.session.flush()
        if before is None:
            audit.record("policy.create", f"Policy {p.name}", actor=actor, reason=f"{p.kind.value} {p.params}"[:400])
        else:
            after = policy_dict(p)
            changed = [k for k in ("name", "description", "scope", "scopeValue", "params", "enabled") if before.get(k) != after.get(k)]
            if changed:
                detail = ", ".join(f"{k}: {before.get(k)} -> {after.get(k)}" for k in changed if k not in ("description",)) or "description"
                audit.record("policy.update", f"Policy {p.name}", actor=actor, reason=("Changed " + detail)[:400])
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return policy_dict(p)


def delete_policy(actor: User, policy_id: int, reason: str) -> dict:
    p = db.session.query(PlacementPolicy).filter_by(id=policy_id).with_for_update().first()
    if p is None:
        raise NotFound("Policy")
    audit.record("policy.delete", f"Policy {p.name}", actor=actor, reason=f"{reason.strip()} ({p.kind.value} {p.params})"[:400])
    db.session.delete(p)
    db.session.commit()
    return {"ok": True}


# ====================================================================== academic configuration
def _dept_dict(d: Department, students: int, courses: int) -> dict:
    return {"id": sid(d.id), "code": d.code, "name": d.name, "headName": d.head_name or "", "students": students, "courses": courses}


def _course_dict(c: Course) -> dict:
    return {"id": sid(c.id), "code": c.code, "name": c.name, "degree": c.degree.value, "departmentId": sid(c.department_id), "durationYears": c.duration_years}


def _year_dict(a: AcademicYear) -> dict:
    return {"id": sid(a.id), "label": a.label, "graduationYear": a.graduation_year, "active": bool(a.active)}


def academic_overview() -> dict:
    students = dict(db.session.query(Student.department_id, sa.func.count()).group_by(Student.department_id).all())
    courses = dict(db.session.query(Course.department_id, sa.func.count()).group_by(Course.department_id).all())
    return {"departments": [_dept_dict(d, students.get(d.id, 0), courses.get(d.id, 0)) for d in db.session.query(Department).order_by(Department.code)],
            "courses": [_course_dict(c) for c in db.session.query(Course).order_by(Course.code)],
            "academicYears": [_year_dict(a) for a in db.session.query(AcademicYear).order_by(AcademicYear.graduation_year.desc())]}


def _unique(model, column, value, own_id, message: str, field: str) -> None:
    if db.session.query(model).filter(sa.func.lower(column) == value.lower(), model.id != (own_id or 0)).first():
        raise Conflict(message, details={field: ["Already in use"]})


def save_department(actor: User, data: DepartmentIn, dept_id: int | None = None) -> dict:
    _unique(Department, Department.code, data.code, dept_id, "Department code already exists.", "code")
    try:
        if dept_id is None:
            d = Department()
            db.session.add(d)
            action = "department.create"
        else:
            d = db.session.get(Department, dept_id)
            if d is None:
                raise NotFound("Department")
            action = "department.update"
        d.code, d.name, d.head_name = data.code, data.name, data.head_name or None
        db.session.flush()
        audit.record(action, f"Department {d.code}", actor=actor)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise Conflict("Department code already exists.", details={"code": ["Already in use"]})
    except Exception:
        db.session.rollback()
        raise
    return _dept_dict(d, db.session.query(Student).filter_by(department_id=d.id).count(), db.session.query(Course).filter_by(department_id=d.id).count())


def delete_department(actor: User, dept_id: int) -> dict:
    d = db.session.get(Department, dept_id)
    if d is None:
        raise NotFound("Department")
    uses = {
        "students": db.session.query(Student).filter_by(department_id=d.id).count(), "programmes": db.session.query(Course).filter_by(department_id=d.id).count(),
        "users": db.session.query(User).filter_by(department_id=d.id).count() + db.session.query(FacultyProfile).filter_by(department_id=d.id).count(),
        "jobs": db.session.execute(sa.select(sa.func.count()).select_from(job_departments).where(job_departments.c.department_id == d.id)).scalar(),
        "policies": db.session.query(PlacementPolicy).filter_by(scope=PolicyScope.DEPARTMENT, scope_value=str(d.id)).count(),
    }
    used = {k: v for k, v in uses.items() if v}
    if used:
        raise Conflict("This department is still in use (" + ", ".join(f"{v} {k}" for k, v in used.items()) + ") and cannot be deleted. Move or remove those first.")
    audit.record("department.delete", f"Department {d.code}", actor=actor)
    db.session.delete(d)
    db.session.commit()
    return {"ok": True}


def save_course(actor: User, data: CourseIn, course_id: int | None = None) -> dict:
    if db.session.get(Department, data.department_id) is None:
        raise ValidationFailed("Choose a valid department.", details={"departmentId": ["Unknown department"]})
    _unique(Course, Course.code, data.code, course_id, "A programme with this code already exists.", "code")
    try:
        if course_id is None:
            c = Course()
            db.session.add(c)
            action = "course.create"
        else:
            c = db.session.get(Course, course_id)
            if c is None:
                raise NotFound("Programme")
            action = "course.update"
        c.code, c.name, c.degree, c.department_id, c.duration_years = data.code, data.name, Degree(data.degree), data.department_id, data.duration_years
        db.session.flush()
        audit.record(action, f"Course {c.code}", actor=actor)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise Conflict("A programme with this code already exists.", details={"code": ["Already in use"]})
    except Exception:
        db.session.rollback()
        raise
    return _course_dict(c)


def delete_course(actor: User, course_id: int) -> dict:
    c = db.session.get(Course, course_id)
    if c is None:
        raise NotFound("Programme")
    audit.record("course.delete", f"Course {c.code}", actor=actor)
    db.session.delete(c)
    db.session.commit()
    return {"ok": True}


def save_academic_year(actor: User, data: AcademicYearIn, year_id: int | None = None) -> list[dict]:
    """Exactly one year is active: activating one deactivates the others in the same transaction."""
    _unique(AcademicYear, AcademicYear.label, data.label, year_id, "This academic year already exists.", "label")
    if db.session.query(AcademicYear).filter(AcademicYear.graduation_year == data.graduation_year, AcademicYear.id != (year_id or 0)).first():
        raise Conflict("A year for this graduation batch already exists.", details={"graduationYear": ["Already in use"]})
    try:
        if year_id is None:
            a = AcademicYear()
            db.session.add(a)
        else:
            a = db.session.query(AcademicYear).filter_by(id=year_id).with_for_update().first()
            if a is None:
                raise NotFound("Academic year")
            if a.active and not data.active:
                raise Conflict("Exactly one academic year must stay active. Activate another year instead.")
        a.label, a.graduation_year, a.active = data.label, data.graduation_year, data.active
        db.session.flush()  # the row must be complete (and have an id) before the bulk update below, which autoflushes
        if data.active:
            db.session.query(AcademicYear).filter(AcademicYear.id != a.id).update({AcademicYear.active: False})
        audit.record("academic_year.update" if year_id else "academic_year.create", f"Academic year {a.label}", actor=actor, reason="Set as active" if data.active else None)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise Conflict("This academic year already exists.")
    except Exception:
        db.session.rollback()
        raise
    return [_year_dict(x) for x in db.session.query(AcademicYear).order_by(AcademicYear.graduation_year.desc())]


# ====================================================================== audit logs (read-only: there is deliberately no write or delete path)
def _like(term: str) -> str:
    return "%" + term.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def list_audit(q: AuditQuery) -> tuple[list[dict], int, list[str]]:
    from datetime import datetime, time, timedelta

    query = db.session.query(AuditLog)
    if q.actor:
        query = query.filter(sa.func.lower(AuditLog.actor_name).like(_like(q.actor), escape="\\"))
    if q.action:
        query = query.filter(sa.func.lower(AuditLog.action).like(_like(q.action), escape="\\"))
    if q.resource:
        query = query.filter(sa.func.lower(AuditLog.resource).like(_like(q.resource), escape="\\"))
    if q.result and q.result != "all":
        query = query.filter(AuditLog.result == AuditResult(q.result))
    if q.from_:
        query = query.filter(AuditLog.created_at >= datetime.combine(q.from_, time.min))
    if q.to:
        query = query.filter(AuditLog.created_at < datetime.combine(q.to, time.min) + timedelta(days=1))
    total = query.count()
    rows = query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).offset((q.page - 1) * q.page_size).limit(q.page_size).all()
    actions = sorted({a.split(".")[0] for (a,) in db.session.query(AuditLog.action).distinct()})
    return [audit_dict(a) for a in rows], total, actions
