"""Administrator-side account and role management.

Escalation rules (enforced here, never in the UI):
  * only an administrator (role) may create, edit, activate or deactivate ADMIN accounts, or change the role-permission matrix; users.manage alone is not enough
  * nobody can change their own role or deactivate themselves; the last active administrator can never be demoted or deactivated
  * student accounts cannot be converted to staff (or back): a student carries profile, applications and offers
  * staff permissions can never be granted to the student role, and roles.manage / users.manage can never be removed from admin or granted to other roles
Accounts are created INVITED with an unusable password; the person sets one through a one-time emailed link (e-mail delivery is not implemented, so the link is logged in development only)."""
import re
from flask import current_app
from sqlalchemy.exc import IntegrityError
import sqlalchemy as sa

from ..errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..extensions import db
from ..models import (
    AcademicRecord, AcademicYear, AuditResult, Department, FacultyProfile, Permission, Role, RoleName, Student, User, UserStatus, utcnow,
)
from ..schemas.admin import ImportIn, UserIn, UserQuery
from ..security import unusable_password_hash
from ..serializers import user_dict
from . import audit, auth_service

INVITE_MINUTES = 3 * 24 * 60
PROTECTED_ADMIN_PERMS = {"roles.manage", "users.manage"}
NEVER_DELEGATED = {"roles.manage"}


def _like(term: str) -> str:
    return "%" + term.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _log_link(raw: str) -> None:
    if current_app.debug:
        current_app.logger.info("DEV set-password link: %s/reset-password?token=%s", current_app.config["FRONTEND_URL"], raw)


def _is_admin(u: User) -> bool:
    return u.role_name == "admin"


def _need_admin_actor(actor: User, target_role: str, what: str) -> None:
    if target_role == "admin" and not _is_admin(actor):
        audit.record("access.denied", what, result=AuditResult.DENIED, reason="Only administrators manage administrator accounts", actor=actor, commit=True)
        raise Forbidden("Only administrators can manage administrator accounts.")


def _get(user_id: int, *, lock: bool = False) -> User:
    q = db.session.query(User).filter(User.id == user_id)
    u = (q.with_for_update() if lock else q).first()
    if u is None:
        raise NotFound("User")
    return u


def _other_active_admins(excluding: User) -> int:
    admin_role = db.session.query(Role.id).filter_by(name=RoleName.ADMIN).scalar()
    return db.session.query(User).filter(User.role_id == admin_role, User.status == UserStatus.ACTIVE, User.id != excluding.id).count()


# ------------------------------------------------------------------ list
def list_users(q: UserQuery) -> tuple[list[dict], int]:
    query = db.session.query(User).join(Role, User.role_id == Role.id)
    if q.role and q.role != "all":
        query = query.filter(Role.name == RoleName(q.role))
    if q.status and q.status != "all":
        query = query.filter(User.status == UserStatus(q.status))
    if q.dept:
        query = query.filter(User.department_id == q.dept)
    if q.q:
        pat = _like(q.q)
        query = query.filter(sa.or_(*[sa.func.lower(c).like(pat, escape="\\") for c in (User.name, User.email, User.user_code)]))
    total = query.count()
    rows = query.order_by(User.name, User.id).offset((q.page - 1) * q.page_size).limit(q.page_size).all()
    return [user_dict(u) for u in rows], total


# ------------------------------------------------------------------ create / edit
def _validate_common(data: UserIn, *, existing: User | None):
    email = data.email.strip().lower()
    clash = db.session.query(User).filter(sa.func.lower(User.email) == email, User.id != (existing.id if existing else 0)).first()
    if clash:
        raise Conflict("A user with this email already exists.", details={"email": ["Already in use"]})
    clash = db.session.query(User).filter(sa.func.lower(User.user_code) == data.user_code.lower(), User.id != (existing.id if existing else 0)).first()
    if clash:
        raise Conflict("This user ID is already in use.", details={"userCode": ["Already in use"]})
    dept = None
    if data.department_id is not None:
        dept = db.session.get(Department, data.department_id)
        if dept is None:
            raise ValidationFailed("Choose a valid department.", details={"departmentId": ["Unknown department"]})
    if data.role == "student" and dept is None:
        raise ValidationFailed("Students need a department.", details={"departmentId": ["Required for students"]})
    return email, dept


def create_user(actor: User, data: UserIn) -> dict:
    _need_admin_actor(actor, data.role, f"create {data.role} account")
    email, dept = _validate_common(data, existing=None)
    if data.role != "student" and data.graduation_year is not None:
        raise ValidationFailed("Graduation year applies to students only.", details={"graduationYear": ["Students only"]})
    role = db.session.query(Role).filter_by(name=RoleName(data.role)).one()
    try:
        u = User(user_code=data.user_code, name=data.name, email=email, password_hash=unusable_password_hash(), role_id=role.id, department_id=dept.id if dept else None,
                 status=UserStatus.INVITED, onboarding_complete=False)
        db.session.add(u)
        db.session.flush()
        if data.role == "student":
            _new_student(u, dept, data.graduation_year, None)
        elif data.role == "faculty":
            db.session.add(FacultyProfile(user_id=u.id, department_id=dept.id if dept else None))
        raw = auth_service.issue_reset_token(u, minutes=INVITE_MINUTES)
        audit.record("user.create", f"User {u.name} ({data.role})", actor=actor, reason=f"Invited {u.user_code}")
        db.session.commit()
    except IntegrityError:  # unique indexes are the final guard against a concurrent duplicate
        db.session.rollback()
        raise Conflict("A user with this email or ID already exists.")
    except Exception:
        db.session.rollback()
        raise
    _log_link(raw)
    return user_dict(u)


def _active_graduation_year(explicit: int | None) -> int:
    if explicit:
        return explicit
    ay = db.session.query(AcademicYear).filter_by(active=True).first()
    if ay is None:
        raise ValidationFailed("Enter a graduation year (no active academic year is configured).", details={"graduationYear": ["Required"]})
    return ay.graduation_year


def _new_student(u: User, dept: Department, graduation_year: int | None, cgpa: float | None) -> Student:
    s = Student(user_id=u.id, student_code=u.user_code, department_id=dept.id, degree="", current_year=4, graduation_year=_active_graduation_year(graduation_year), profile_completion=0)
    s.academic = AcademicRecord(cgpa=cgpa, cgpa_verified=False, active_arrears=0, arrear_history=0)  # always unverified until the placement cell verifies it
    db.session.add(s)
    return s


def update_user(actor: User, user_id: int, data: UserIn) -> dict:
    try:
        u = _get(user_id, lock=True)
        _need_admin_actor(actor, u.role_name, f"edit user {u.user_code}")
        _need_admin_actor(actor, data.role, f"assign role {data.role}")
        email, dept = _validate_common(data, existing=u)
        changed = []
        if data.role != u.role_name:
            if u.id == actor.id:
                raise Conflict("You cannot change your own role.")
            if "student" in (data.role, u.role_name):
                raise Conflict("Student accounts cannot be converted to staff accounts (or the reverse). Create a new account instead.")
            if u.role_name == "admin" and u.status == UserStatus.ACTIVE and not _other_active_admins(u):
                raise Conflict("This is the last active administrator and cannot be demoted.")
            old_role = u.role_name
            u.role = db.session.query(Role).filter_by(name=RoleName(data.role)).one()
            if data.role == "faculty" and u.faculty_profile is None:
                db.session.add(FacultyProfile(user_id=u.id, department_id=dept.id if dept else None))
            changed.append(f"role {old_role} -> {data.role}")
        if data.graduation_year is not None and u.role_name != "student":
            raise ValidationFailed("Graduation year applies to students only.", details={"graduationYear": ["Students only"]})
        old_code = u.user_code
        for attr, val, label in (("name", data.name, "name"), ("email", email, "email"), ("user_code", data.user_code, "userCode")):
            if getattr(u, attr) != val:
                setattr(u, attr, val)
                changed.append(label)
        new_dept = dept.id if dept else None
        if u.department_id != new_dept:
            u.department_id = new_dept
            changed.append("department")
        if u.student:
            s = u.student
            if s.student_code == old_code and old_code != u.user_code:  # an ID the student chose at onboarding is never overwritten
                s.student_code = u.user_code
            if new_dept and s.department_id != new_dept:
                s.department_id = new_dept
            if data.graduation_year and s.graduation_year != data.graduation_year:
                s.graduation_year = data.graduation_year
                changed.append("graduationYear")
        if u.faculty_profile and u.faculty_profile.department_id != new_dept:
            u.faculty_profile.department_id = new_dept
        if changed:
            role_change = any(c.startswith("role") for c in changed)
            audit.record("user.role_change" if role_change else "user.update", f"User {u.name}", actor=actor, reason=("Changed: " + ", ".join(changed))[:400])
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise Conflict("A user with this email or ID already exists.")
    except Exception:
        db.session.rollback()
        raise
    return user_dict(u)


def set_status(actor: User, user_id: int, new: str) -> dict:
    u = _get(user_id, lock=True)
    _need_admin_actor(actor, u.role_name, f"change status of {u.user_code}")
    target = UserStatus(new)
    if u.id == actor.id:
        raise Conflict("You cannot deactivate your own account.")
    if target == UserStatus.INACTIVE and u.role_name == "admin" and u.status == UserStatus.ACTIVE and not _other_active_admins(u):
        raise Conflict("This is the last active administrator and cannot be deactivated.")
    if u.status == target:
        return user_dict(u)  # idempotent
    u.status = target
    if target == UserStatus.INACTIVE:
        u.password_changed_at = utcnow()  # refresh tokens issued before now stop working at once
    audit.record("user.activate" if target == UserStatus.ACTIVE else "user.deactivate", f"User {u.name}", actor=actor)
    db.session.commit()
    return user_dict(u)


def reset_password(actor: User, user_id: int) -> dict:
    u = _get(user_id, lock=True)
    _need_admin_actor(actor, u.role_name, f"reset password of {u.user_code}")
    if u.status == UserStatus.INACTIVE:
        raise Conflict("This account is deactivated. Activate it before sending a reset link.")
    raw = auth_service.issue_reset_token(u, minutes=INVITE_MINUTES if u.status == UserStatus.INVITED else None)
    audit.record("user.reset_password", f"User {u.name}", actor=actor)
    db.session.commit()
    _log_link(raw)
    return {"message": f"A one-time password link has been issued for {u.email}. E-mail delivery is not configured on this server, so nothing was sent."}


# ------------------------------------------------------------------ bulk import
def import_students(actor: User, data: ImportIn) -> dict:
    """Valid rows are imported in one transaction; invalid rows are reported (never partially written). Imported students are INVITED and unverified."""
    errors: list[dict] = []
    depts = {d.code.lower(): d for d in db.session.query(Department)}
    taken_codes = {c.lower() for (c,) in db.session.query(User.user_code)}
    taken_emails = {e.lower() for (e,) in db.session.query(User.email)}
    role = db.session.query(Role).filter_by(name=RoleName.STUDENT).one()
    imported = 0
    created: list[tuple[User, str]] = []
    try:
        for idx, r in enumerate(data.rows):
            n = idx + 2  # the CSV header is row 1
            before = len(errors)
            err = lambda field, msg, value="": errors.append({"row": n, "field": field, "message": msg, "value": value[:80]})  # noqa: E731
            code, name, email = r.student_code.strip(), r.name.strip(), r.email.strip().lower()
            if not code:
                err("studentCode", "Student ID is required")
            elif not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._\-/]{0,31}", code):
                err("studentCode", "Student ID may contain letters, digits and . _ - / only", code)
            elif code.lower() in taken_codes:
                err("studentCode", "Duplicate student ID", code)
            if not name:
                err("name", "Name is required")
            elif len(name) > 120:
                err("name", "Name is too long", name)
            if not re.fullmatch(r"\S+@\S+\.\S+", email) or len(email) > 190:
                err("email", "Invalid email address", email)
            elif email in taken_emails:
                err("email", "Email already registered", email)
            dept = depts.get(r.department_code.strip().lower())
            if dept is None:
                err("departmentCode", "Unknown department code", r.department_code)
            if not re.fullmatch(r"20\d{2}", r.graduation_year.strip()):
                err("graduationYear", "Graduation year must be a 4-digit year", r.graduation_year)
            cgpa = None
            if r.cgpa not in (None, ""):
                try:
                    cgpa = float(r.cgpa)
                    if not (0 <= cgpa <= 10) or cgpa != cgpa:
                        raise ValueError
                except ValueError:
                    err("cgpa", "CGPA must be between 0 and 10", r.cgpa)
            if len(errors) > before:
                continue
            taken_codes.add(code.lower())
            taken_emails.add(email)
            u = User(user_code=code, name=name, email=email, password_hash=unusable_password_hash(), role_id=role.id, department_id=dept.id, status=UserStatus.INVITED, onboarding_complete=False)
            db.session.add(u)
            db.session.flush()
            _new_student(u, dept, int(r.graduation_year), cgpa)
            created.append((u, auth_service.issue_reset_token(u, minutes=INVITE_MINUTES)))
            imported += 1
        audit.record("user.import", f"Student import ({imported}/{len(data.rows)} rows)", actor=actor, reason=f"{len(errors)} validation error(s)" if errors else None)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    for _u, raw in created:
        _log_link(raw)
    return {"total": len(data.rows), "imported": imported, "errors": errors}


# ------------------------------------------------------------------ roles and permissions
def roles_overview() -> dict:
    perms = db.session.query(Permission).order_by(Permission.module, Permission.key).all()
    matrix = {r.name.value: sorted(p.key for p in r.permissions) for r in db.session.query(Role)}
    counts = {name.value: db.session.query(User).join(Role, User.role_id == Role.id).filter(Role.name == name).count() for name in RoleName}
    return {"permissions": [{"key": p.key, "module": p.module, "label": p.label, "description": p.description or ""} for p in perms], "matrix": matrix, "userCounts": counts}


def set_permission(actor: User, role_name: str, perm_key: str, enabled: bool) -> list[str]:
    if not _is_admin(actor):
        audit.record("access.denied", "role-permission matrix", result=AuditResult.DENIED, reason="Only administrators edit the matrix", actor=actor, commit=True)
        raise Forbidden("Only administrators can change roles and permissions.")
    try:
        name = RoleName(role_name)
    except ValueError:
        raise NotFound("Role")
    role = db.session.query(Role).filter_by(name=name).with_for_update().one()
    perm = db.session.query(Permission).filter_by(key=perm_key).first()
    if perm is None:
        raise NotFound("Permission")
    if name == RoleName.STUDENT:
        raise Conflict("Student access is limited to their own records and cannot be extended with staff permissions.")
    if name == RoleName.ADMIN and not enabled and perm.key in PROTECTED_ADMIN_PERMS:
        raise Conflict("This permission cannot be removed from Admin: it would lock administrators out.")
    if name != RoleName.ADMIN and enabled and perm.key in NEVER_DELEGATED:
        raise Conflict("Only administrators can manage roles and permissions; this permission cannot be granted to another role.")
    have = perm in role.permissions
    if enabled and not have:
        role.permissions.append(perm)
    elif not enabled and have:
        role.permissions.remove(perm)
    else:
        return sorted(p.key for p in role.permissions)  # already in the requested state: nothing to record
    audit.record("role.permissions.update", f"Role {name.value}", actor=actor, reason=f"{'Granted' if enabled else 'Revoked'} {perm.key}")
    db.session.commit()
    return sorted(p.key for p in role.permissions)
