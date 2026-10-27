"""Staff-side applicant review: list, bulk stage changes, CSV export.

Stage rules (one table, enforced here and nowhere else):
  applied < shortlisted < interview < selected   forward moves only (a stage may be skipped, never reversed)
  any of those -> rejected                         (a SELECTED applicant with an offer must have the offer withdrawn first)
  offer_received / rejected / withdrawn            terminal for review: an offer is created or withdrawn from the Offers module, never by a stage change
A bulk request is processed row by row: every row is validated against the locked record, valid rows are applied and committed
together, invalid rows are reported with a reason. Advancing an applicant whose eligibility snapshot is not "eligible" needs a recorded exception."""
import sqlalchemy as sa

from ..extensions import db
from ..models import (
    AcademicRecord, Application, ApplicationStatus, ApplicationStatusHistory, Company, EligibilityState, Job, JobStatus, NotificationKind, PolicyKind, Student, User, utcnow,
)
from ..models import ApplicationEligibilitySnapshot as Snapshot
from ..schemas.review import ApplicationReviewQuery, StageIn
from . import audit, eligibility
from .csv_util import to_csv
from .notifications import notify
from .student_service import set_placement_status
from .views import application_view

A = ApplicationStatus
ORDER = [A.APPLIED, A.SHORTLISTED, A.INTERVIEW, A.SELECTED]
LABEL = {A.SHORTLISTED: "shortlisted", A.INTERVIEW: "moved to the interview stage", A.SELECTED: "selected", A.REJECTED: "not taken forward"}


def _like(term: str) -> str:
    return "%" + term.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _filtered(q: ApplicationReviewQuery):
    query = (db.session.query(Application).join(Student, Application.student_id == Student.id).join(User, Student.user_id == User.id)
             .join(Job, Application.job_id == Job.id).join(Company, Job.company_id == Company.id)
             .outerjoin(AcademicRecord, AcademicRecord.student_id == Student.id).join(Snapshot, Snapshot.application_id == Application.id))
    if q.status and q.status != "all":
        query = query.filter(Application.status == A(q.status))
    if q.company_id:
        query = query.filter(Job.company_id == q.company_id)
    if q.job_id:
        query = query.filter(Application.job_id == q.job_id)
    if q.dept:
        query = query.filter(Student.department_id == q.dept)
    if q.eligibility:
        query = query.filter(Snapshot.state == EligibilityState(q.eligibility))
    if q.q:
        pat = _like(q.q)
        query = query.filter(sa.or_(*[sa.func.lower(c).like(pat, escape="\\") for c in (User.name, Student.student_code, Company.name, Job.title)]))
    return query


def list_applications(viewer: User, q: ApplicationReviewQuery) -> tuple[list[dict], int]:
    query = _filtered(q)
    total = query.count()
    order = {"cgpa": [sa.desc(sa.func.coalesce(AcademicRecord.cgpa, -1)), Application.id], "name": [User.name, Application.id],
             "recent": [Application.applied_at.desc(), Application.id.desc()]}[q.sort]
    rows = query.order_by(*order).offset((q.page - 1) * q.page_size).limit(q.page_size).all()
    return [application_view(a, viewer) for a in rows], total


def _check_row(a: Application, new: ApplicationStatus, exc, policy_needs_both: bool) -> tuple[str | None, bool]:
    """-> (refusal reason or None, exception_used)."""
    who = f"{a.student.user.name} · {a.job.title}"
    if a.status in (A.WITHDRAWN, A.OFFER_RECEIVED, A.REJECTED):
        return f"{who}: already {a.status.value.replace('_', ' ')}", False
    if new == A.REJECTED:
        if a.offer is not None:
            return f"{who}: an offer exists for this application; withdraw the offer first", False
        return None, False
    if ORDER.index(new) <= ORDER.index(a.status):
        return f"{who}: already at or beyond {new.value}", False
    if a.job.status == JobStatus.CANCELLED:
        return f"{who}: the job was cancelled, applicants cannot advance", False
    if a.snapshot.state.value != "eligible":
        if exc is None:
            return f"{who}: not eligible ({a.snapshot.summary}). An approved exception is required.", False
        if policy_needs_both and (not exc.reason.strip() or not exc.approved_by.strip()):
            return f"{who}: exception needs a reason and an approver", False
        return None, True
    return None, False


def update_stage(actor: User, data: StageIn) -> dict:
    new = A(data.status)
    ids = list(dict.fromkeys(data.ids))
    policy = next((p for p in eligibility.active_policies() if p.kind == PolicyKind.EXCEPTION_APPROVAL), None)
    needs_both = bool(policy and (policy.params.get("requireReason", True) or policy.params.get("requireApprover", True)))
    found = {a.id: a for a in db.session.query(Application).filter(Application.id.in_(ids)).with_for_update().all()}
    updated: list[str] = []
    failed: list[dict] = []
    now = utcnow()
    try:
        for i in ids:
            a = found.get(i)
            if a is None:
                failed.append({"id": str(i), "reason": "Application not found"})
                continue
            why, used_exception = _check_row(a, new, data.exception, needs_both)
            if why:
                failed.append({"id": str(i), "reason": why})
                continue
            before = a.status
            a.status, a.updated_at = new, now
            note = (data.note or "").strip() or f"Moved to {new.value}"
            a.history.append(ApplicationStatusHistory(status=new, at=now, note=note, changed_by=actor.id, changed_by_name=actor.name))
            if used_exception:
                a.snapshot.exception_reason, a.snapshot.exception_approved_by = data.exception.reason.strip(), data.exception.approved_by.strip()
                audit.record("eligibility.exception", f"Application {a.id} · {a.student.student_code} · {a.job.title}", actor=actor,
                             reason=f"{data.exception.reason.strip()} (approved by {data.exception.approved_by.strip()})")
            audit.record(f"application.{new.value}", f"Application {a.id} · {a.student.student_code} · {a.job.title}", actor=actor, reason=f"{before.value} -> {new.value}")
            notify(a.student.user_id, f"Application update — {a.job.company.name}", f"Your application for {a.job.title} was {LABEL[new]}.", NotificationKind.APPLICATION, f"/student/applications/{a.id}")
            if new == A.REJECTED:
                db.session.flush()
                set_placement_status(a.student)
            updated.append(str(i))
        db.session.commit()
    except Exception:
        db.session.rollback()  # all valid rows or none: a crash half-way never leaves some students notified and others not
        raise
    return {"updated": updated, "failed": failed}


def export_csv(actor: User, q: ApplicationReviewQuery) -> str:
    query = _filtered(q)
    rows = query.order_by(Application.applied_at.desc(), Application.id.desc()).limit(5000).all()
    audit.record("report.export", f"Applications CSV ({len(rows)} rows)", actor=actor, commit=True)
    head = ["Student ID", "Name", "Department", "CGPA", "Company", "Job", "Eligibility", "Stage", "Applied on"]
    return to_csv(head, [[a.student.student_code, a.student.user.name, a.student.department.code, a.student.academic.cgpa if a.student.academic and a.student.academic.cgpa is not None else "",
                          a.job.company.name, a.job.title, a.snapshot.state.value, a.status.value, a.applied_at.date().isoformat()] for a in rows])
