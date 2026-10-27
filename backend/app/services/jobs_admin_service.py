"""Staff-side job and drive management.

Status changes (whether requested through POST /jobs/{id}/status or through the `status` field of a save) all go through ONE
transition function, so a form can never sneak past the rules. A save is a single transaction: the job, its drive and rounds,
its eligibility rule and its departments are written together or not at all."""
import sqlalchemy as sa

from ..errors import Conflict, NotFound, ValidationFailed
from ..extensions import db
from ..models import (
    Application, ApplicationStatus, Company, Department, Document, DriveEvent, HiringDrive, Interview, Job, JobEligibilityRule, JobStatus, JobType, NotificationKind, Offer,
    RoundMode, Student, User, sid, utcnow,
)
from ..schemas.jobs import JobIn
from ..security import ensure_permission
from ..serializers import document_dict, interview_dict, job_dict
from . import audit, eligibility
from .notifications import notify
from .views import job_view

S = JobStatus
TRANSITIONS: dict[JobStatus, set[JobStatus]] = {
    S.DRAFT: {S.PUBLISHED, S.CANCELLED},
    S.PUBLISHED: {S.DRAFT, S.CLOSED, S.CANCELLED},  # DRAFT = unpublish (only while nobody has applied)
    S.CLOSED: {S.PUBLISHED},  # reopen
    S.CANCELLED: set(),
}
ACTION = {(S.DRAFT, S.PUBLISHED): "publish", (S.PUBLISHED, S.DRAFT): "unpublish", (S.PUBLISHED, S.CLOSED): "close", (S.CLOSED, S.PUBLISHED): "reopen"}
ARCHIVABLE = (S.DRAFT, S.CLOSED, S.CANCELLED)
ACTIVE_APP = (ApplicationStatus.APPLIED, ApplicationStatus.SHORTLISTED, ApplicationStatus.INTERVIEW, ApplicationStatus.SELECTED)


def _job_or_404(job_id: int, *, lock: bool = False) -> Job:
    q = db.session.query(Job).filter(Job.id == job_id)
    job = (q.with_for_update() if lock else q).first()
    if job is None:
        raise NotFound("Job")
    return job


def _diff(before: dict, after: dict) -> list[str]:
    """Names of the fields that changed, for the audit trail (values are not logged: descriptions can be long)."""
    skip = {"updatedAt", "publishedAt", "archivedAt", "status", "id", "createdBy"}
    out = []
    for k in sorted(set(before) | set(after)):
        if k in skip:
            continue
        b, a = before.get(k), after.get(k)
        if isinstance(b, dict) or isinstance(a, dict):
            out += [f"{k}.{kk}" for kk in sorted(set(b or {}) | set(a or {})) if (b or {}).get(kk) != (a or {}).get(kk)]
        elif k == "rounds":
            if [(r["name"], r["mode"], r.get("date"), r.get("location")) for r in b or []] != [(r["name"], r["mode"], r.get("date"), r.get("location")) for r in a or []]:
                out.append("rounds")
        elif b != a:
            out.append(k)
    return out


# ------------------------------------------------------------------ lifecycle
def _transition(user: User, job: Job, new: JobStatus, reason: str | None = None) -> None:
    """The single place where Job.status changes. Caller commits."""
    if new == job.status:
        return  # nothing to change, so nothing to authorise (saving a draft as a draft needs only jobs.create)
    ensure_permission(user, "drives.publish", f"job {job.id}")
    if job.archived_at:
        raise Conflict("This job is archived. Restore it before changing its status.")
    if new not in TRANSITIONS[job.status]:
        raise Conflict(f"A {job.status.value} job cannot become {new.value}.")
    now = utcnow()
    if new == S.CANCELLED and len((reason or "").strip()) < 3:
        raise ValidationFailed("A reason is required to cancel a job.", details={"reason": ["Required to cancel a job"]})
    if new == S.PUBLISHED:
        if job.deadline <= now:
            raise ValidationFailed("Extend the application deadline before publishing.", details={"deadline": ["Must be in the future"]})
        if job.company.archived_at:
            raise Conflict("This company is archived. Restore it before publishing its jobs.")
    if new == S.DRAFT:
        n = db.session.query(Application).filter_by(job_id=job.id).count()
        if n:
            raise Conflict(f"This job already has {n} application(s), so it cannot be unpublished. Close it instead.")
    before = job.status
    job.status = new
    if new == S.PUBLISHED:
        job.published_at = job.published_at or now
    job.updated_at = now
    if new == S.CANCELLED:
        for a in db.session.query(Application).filter(Application.job_id == job.id, Application.status.in_(ACTIVE_APP)):
            notify(a.student.user_id, f"{job.company.name} drive cancelled", f"{job.title} has been cancelled. {reason.strip()}", NotificationKind.DRIVE)
    action = "cancel" if new == S.CANCELLED else ACTION[(before, new)]
    audit.record(f"job.{action}", f"Job {job.title} ({job.company.name})", actor=user, reason=(reason or None) and reason.strip())


def set_status(user: User, job_id: int, new: str, reason: str | None) -> dict:
    ensure_permission(user, "drives.publish", f"job {job_id}")
    job = _job_or_404(job_id, lock=True)
    try:
        _transition(user, job, JobStatus(new), reason)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return job_dict(job)


def archive_job(user: User, job_id: int, archived: bool) -> dict:
    ensure_permission(user, "drives.publish", f"job {job_id}")
    job = _job_or_404(job_id, lock=True)
    if archived and job.status not in ARCHIVABLE:
        raise Conflict("A published job cannot be archived. Close or cancel it first.")
    if archived and not job.archived_at:
        job.archived_at = utcnow()
        audit.record("job.archive", f"Job {job.title} ({job.company.name})", actor=user)
    elif not archived and job.archived_at:
        job.archived_at = None
        audit.record("job.unarchive", f"Job {job.title} ({job.company.name})", actor=user)
    db.session.commit()
    return job_dict(job)


# ------------------------------------------------------------------ create / edit
def _sync_drive(job: Job, data: JobIn, user: User) -> None:
    drive = job.drive
    if drive is None or db.session.query(Job).filter(Job.drive_id == drive.id, Job.id != (job.id or 0)).count():
        # copy-on-write: never let an edit of this job change a drive another job shares
        drive = HiringDrive(company_id=job.company_id, name=data.title, created_by=user.id)
        job.drive = drive
    drive.company_id, drive.name, drive.drive_date = job.company_id, f"{data.title} — campus drive", data.drive_date
    for i, r in enumerate(data.rounds):
        ev = drive.events[i] if i < len(drive.events) else None
        if ev is None:
            ev = DriveEvent(sequence=i + 1)
            drive.events.append(ev)
        ev.sequence, ev.name, ev.mode, ev.scheduled_at, ev.location = i + 1, r.name, RoundMode(r.mode), r.date, r.location or None
    for extra in drive.events[len(data.rounds):]:
        drive.events.remove(extra)  # delete-orphan


def save_job(user: User, data: JobIn, job_id: int | None = None) -> dict:
    ensure_permission(user, "jobs.create", "job")
    if data.status == "published":
        ensure_permission(user, "drives.publish", "job")

    company = db.session.get(Company, data.company_id)
    if company is None:
        raise ValidationFailed("Select a company.", details={"companyId": ["Unknown company"]})
    wanted = list(dict.fromkeys(data.eligibility.department_ids))
    depts = db.session.query(Department).filter(Department.id.in_(wanted)).all() if wanted else []
    if len(depts) != len(wanted):
        unknown = sorted(set(wanted) - {d.id for d in depts})
        raise ValidationFailed("Choose valid departments.", details={"eligibility.departmentIds": [f"Unknown department id(s): {unknown}"]})

    try:
        if job_id is None:
            if company.archived_at:
                raise ValidationFailed("This company is archived. Restore it to add jobs.", details={"companyId": ["Company is archived"]})
            job = Job(company_id=company.id, status=S.DRAFT, created_by=user.id, open_date=data.open_date, deadline=data.deadline)
            job.rule = JobEligibilityRule()
            db.session.add(job)
            before = None
        else:
            job = _job_or_404(job_id, lock=True)
            if job.archived_at:
                raise Conflict("This job is archived. Restore it before editing.")
            if job.status in (S.CLOSED, S.CANCELLED):
                raise Conflict(f"A {job.status.value} job cannot be edited.")
            before = job_dict(job)
            if job.company_id != company.id:
                if job.status != S.DRAFT or db.session.query(Application).filter_by(job_id=job.id).count():
                    raise Conflict("The company of a published job, or one that has applications, cannot be changed.")
                if company.archived_at:
                    raise ValidationFailed("This company is archived.", details={"companyId": ["Company is archived"]})
                job.company_id = company.id
                job.company = company

        job.title, job.domain, job.location, job.job_type, job.description = data.title, data.domain, data.location, JobType(data.type), data.description
        job.responsibilities, job.skills, job.ctc_lpa, job.stipend_per_month = list(data.responsibilities), list(data.skills), data.ctc_lpa, data.stipend_per_month
        job.open_date, job.deadline = data.open_date, data.deadline
        r, e = job.rule, data.eligibility
        r.min_cgpa, r.max_active_arrears, r.max_arrear_history = e.min_cgpa, e.max_active_arrears, e.max_arrear_history
        r.graduation_years, r.required_skills = sorted(set(e.graduation_years)), list(dict.fromkeys(e.required_skills))
        job.departments = depts
        job.updated_at = utcnow()
        db.session.flush()
        _sync_drive(job, data, user)
        db.session.flush()

        if before is None:
            audit.record("job.create", f"Job {job.title} ({company.name})", actor=user)
        else:
            changed = _diff(before, job_dict(job))
            if changed:
                audit.record("job.update", f"Job {job.title} ({company.name})", actor=user, reason=("Changed: " + ", ".join(changed))[:400])
        _transition(user, job, JobStatus(data.status))  # publish / unpublish requested through the form: same rules as the status endpoint
        db.session.commit()
    except Exception:
        db.session.rollback()  # all-or-nothing: no half-created job, drive or rounds
        raise
    return job_dict(job)


# ------------------------------------------------------------------ drive details
def drive_detail(user: User, job_id: int) -> dict:
    job = _job_or_404(job_id)
    apps = db.session.query(Application.status, sa.func.count()).filter(Application.job_id == job.id).group_by(Application.status).all()
    by = {st: n for st, n in apps}
    count = lambda *sts: sum(by.get(s, 0) for s in sts)  # noqa: E731
    policies = eligibility.active_policies()
    accepted: dict[int, list[Offer]] = {}
    for o in eligibility.all_accepted_offers():
        accepted.setdefault(o.student_id, []).append(o)
    eligible = sum(1 for s in db.session.query(Student).all()
                   if eligibility.evaluate(s, job, policies=policies, accepted=accepted.get(s.id, []), ignore_open=True)["state"].value != "not_eligible")
    A = ApplicationStatus
    return {
        "view": job_view(job, user),
        "eligibleStudents": eligible,
        "counts": {"applied": sum(by.values()), "shortlisted": count(A.SHORTLISTED), "interview": count(A.INTERVIEW), "selected": count(A.SELECTED), "offers": count(A.OFFER_RECEIVED), "rejected": count(A.REJECTED)},
        "interviews": [interview_dict(i) for i in db.session.query(Interview).filter_by(job_id=job.id).order_by(Interview.scheduled_at)],
        "documents": [document_dict(d) for d in db.session.query(Document).filter(sa.or_(Document.job_id == job.id, sa.and_(Document.company_id == job.company_id, Document.job_id.is_(None))))],
    }
