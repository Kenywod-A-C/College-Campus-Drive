import sqlalchemy as sa

from ..errors import Conflict, Forbidden, NotFound
from ..extensions import db
from ..models import (
    Application, ApplicationEligibilitySnapshot, ApplicationStatus, ApplicationStatusHistory, AuditResult, Company, EligibilityState, Job, JobStatus, NotificationKind, PolicyKind,
    Student, User, utcnow,
)
from ..schemas.jobs import ApplicationQuery
from . import audit, eligibility
from .notifications import notify
from .student_service import set_placement_status, student_of
from .views import application_detail, application_view, latest_application

WITHDRAWABLE = (ApplicationStatus.APPLIED, ApplicationStatus.SHORTLISTED, ApplicationStatus.INTERVIEW)


def apply(user: User, job_id: int) -> dict:
    """Everything is re-validated here, at submission time, regardless of what the UI showed."""
    student = student_of(user)
    db.session.query(Student).filter_by(id=student.id).with_for_update().one()  # serialise concurrent applies by the same student
    job = db.session.get(Job, job_id)
    if job is None or job.status == JobStatus.DRAFT:
        raise NotFound("Job")
    now = utcnow()
    if job.status != JobStatus.PUBLISHED:
        raise Conflict(f"This job is {job.status.value} and is not accepting applications.")
    if job.deadline < now:
        raise Conflict("The application deadline has passed.")
    if latest_application(student.id, job.id):
        raise Conflict("You have already applied to this job.")

    result = eligibility.evaluate(student, job, now=now)
    if result["state"] != EligibilityState.ELIGIBLE:
        audit.record("application.create", f"Application {job.title}", result=AuditResult.DENIED, reason=result["summary"], actor=user, commit=True)
        raise Forbidden(result["summary"])

    limit = next((p for p in eligibility.active_policies() if p.kind == PolicyKind.APPLICATION_LIMIT), None)
    if limit:
        active = db.session.query(Application).filter(Application.student_id == student.id, Application.status.in_(eligibility.ACTIVE_APPLICATION_STATUSES)).count()
        if active >= int(limit.params.get("maxActiveApplications", 10**6)):
            raise Conflict(f"Policy limit reached: at most {limit.params['maxActiveApplications']} active applications.")

    app = Application(student_id=student.id, job_id=job.id, status=ApplicationStatus.APPLIED, applied_at=now)
    app.snapshot = ApplicationEligibilitySnapshot(state=result["state"], summary=result["summary"], checks=result["checks"], evaluated_at=now)
    app.history.append(ApplicationStatusHistory(status=ApplicationStatus.APPLIED, at=now, note="Application submitted", changed_by=user.id, changed_by_name=user.name))
    db.session.add(app)
    set_placement_status(student)
    notify(user.id, f"Application submitted — {job.company.name}", f"Your application for {job.title} was received.", NotificationKind.APPLICATION, "/student/applications")
    audit.record("application.create", f"Application {job.title} ({job.company.name})", actor=user)
    db.session.commit()
    return application_view(app, user)


def list_mine(user: User, q: ApplicationQuery) -> tuple[list[dict], int]:
    student = student_of(user)
    query = db.session.query(Application).join(Job, Application.job_id == Job.id).join(Company, Job.company_id == Company.id).filter(Application.student_id == student.id)
    if q.status and q.status != "all":
        query = query.filter(Application.status == ApplicationStatus(q.status))
    if q.q:
        pat = "%" + q.q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.filter(sa.or_(sa.func.lower(Job.title).like(pat, escape="\\"), sa.func.lower(Company.name).like(pat, escape="\\")))
    total = query.count()
    rows = query.order_by(Application.updated_at.desc(), Application.id.desc()).offset((q.page - 1) * q.page_size).limit(q.page_size).all()
    return [application_view(a, user) for a in rows], total


def _owned_or_403(user: User, app: Application) -> None:
    if user.role_name == "student" and app.student.user_id != user.id:  # record-level check: changing the id in the URL gets nowhere
        audit.record("application.read", f"Application {app.id}", result=AuditResult.DENIED, reason="Not the owner", actor=user, commit=True)
        raise Forbidden("You do not have access to this application.")


def get_detail(user: User, application_id: int) -> dict:
    app = db.session.get(Application, application_id)
    if app is None:
        raise NotFound("Application")
    _owned_or_403(user, app)
    if user.role_name != "student" and not (user.has_permission("applications.review") or user.has_permission("students.view")):
        raise Forbidden("You do not have permission to view this.")
    return application_detail(app, user)


def withdraw(user: User, application_id: int) -> dict:
    student = student_of(user)
    app = db.session.query(Application).filter_by(id=application_id, student_id=student.id).first()
    if app is None:
        raise NotFound("Application")
    if app.status not in WITHDRAWABLE:
        raise Conflict("This application can no longer be withdrawn.")
    now = utcnow()
    app.status = ApplicationStatus.WITHDRAWN
    app.history.append(ApplicationStatusHistory(status=ApplicationStatus.WITHDRAWN, at=now, note="Withdrawn by student", changed_by=user.id, changed_by_name=user.name))
    audit.record("application.withdraw", f"Application {app.job.title}", actor=user)
    db.session.commit()
    return application_view(app, user)
