"""Interview scheduling and outcomes.

Rules:
  * candidates must be SHORTLISTED or INTERVIEW applicants of the interview's own job (never another job's, never a rejected/withdrawn one)
  * a student cannot be booked into two overlapping scheduled interviews
  * scheduled -> completed | no_show (only once it has started) | cancelled (any time); every other status is final
  * only a scheduled interview can be edited or announced; editing clears the "notified" flag so students are told about the change
The result of a round is expressed on the applications themselves (POST /applications/stage); interviews never change a stage as a side effect."""
from datetime import timedelta

import sqlalchemy as sa

from ..errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..extensions import db
from ..models import Application, ApplicationStatus, Interview, InterviewStatus, Job, JobStatus, NotificationKind, User, interview_candidates, utcnow
from ..schemas.review import InterviewIn, InterviewQuery
from ..serializers import company_dict, interview_dict, job_dict
from . import audit
from .notifications import notify
from .student_service import student_of

SCHEDULABLE = (ApplicationStatus.SHORTLISTED, ApplicationStatus.INTERVIEW)
IS = InterviewStatus
FINAL = {IS.COMPLETED, IS.CANCELLED, IS.NO_SHOW}


def _fmt(dt) -> str:
    return dt.strftime("%d %b, %H:%M").lstrip("0")


def interview_view(i: Interview, *, candidates: bool) -> dict:
    v = {"interview": interview_dict(i), "job": job_dict(i.job), "company": company_dict(i.job.company), "candidates": []}
    if candidates:
        v["candidates"] = [{"applicationId": str(a.id), "name": a.student.user.name, "studentCode": a.student.student_code or "", "status": a.status.value} for a in sorted(i.applications, key=lambda x: x.id)]
    return v


def _get(interview_id: int, *, lock: bool = False) -> Interview:
    q = db.session.query(Interview).filter(Interview.id == interview_id)
    i = (q.with_for_update() if lock else q).first()
    if i is None:
        raise NotFound("Interview")
    return i


def list_interviews(user: User, q: InterviewQuery) -> tuple[list[dict], int]:
    query = db.session.query(Interview)
    if user.role_name == "student":  # a student only ever sees rounds they are a candidate for, without the other candidates
        s = student_of(user)
        query = query.filter(Interview.id.in_(sa.select(interview_candidates.c.interview_id).join(Application, Application.id == interview_candidates.c.application_id).where(Application.student_id == s.id)))
        staff = False
    else:
        if not user.has_permission("applications.review"):
            raise Forbidden("You do not have permission to view this.")
        staff = True
    if q.job_id:
        query = query.filter(Interview.job_id == q.job_id)
    if q.status and q.status != "all":
        query = query.filter(Interview.status == IS(q.status))
    total = query.count()
    rows = query.order_by(Interview.scheduled_at, Interview.id).offset((q.page - 1) * q.page_size).limit(q.page_size).all()
    return [interview_view(i, candidates=staff) for i in rows], total


def _load_candidates(job: Job, ids: list[int]) -> list[Application]:
    ids = list(dict.fromkeys(ids))
    apps = db.session.query(Application).filter(Application.id.in_(ids)).all()
    if len(apps) != len(ids):
        raise ValidationFailed("Choose valid candidates.", details={"applicationIds": [f"Unknown application id(s): {sorted(set(ids) - {a.id for a in apps})}"]})
    wrong_job = [a for a in apps if a.job_id != job.id]
    if wrong_job:
        raise ValidationFailed("Candidates must have applied to this job.", details={"applicationIds": [f"Application {a.id} belongs to a different job" for a in wrong_job]})
    bad = [a for a in apps if a.status not in SCHEDULABLE]
    if bad:
        raise ValidationFailed("Only shortlisted applicants can be scheduled.", details={"applicationIds": [f"{a.student.user.name} is {a.status.value.replace('_', ' ')}" for a in bad]})
    return apps


def _check_clashes(apps: list[Application], at, mins: int, *, ignore_id: int | None) -> None:
    end = at + timedelta(minutes=mins)
    student_ids = {a.student_id for a in apps}
    others = (db.session.query(Interview).join(interview_candidates, interview_candidates.c.interview_id == Interview.id).join(Application, Application.id == interview_candidates.c.application_id)
              .filter(Application.student_id.in_(student_ids), Interview.status == IS.SCHEDULED, Interview.scheduled_at < end, Interview.scheduled_at > at - timedelta(hours=10))
              .distinct().all())
    clashes = []
    for o in others:
        if o.id == ignore_id or o.scheduled_at + timedelta(minutes=o.duration_mins) <= at:
            continue
        for a in o.applications:
            if a.student_id in student_ids:
                clashes.append(f"{a.student.user.name} already has {o.round_name} at {_fmt(o.scheduled_at)}")
    if clashes:
        raise Conflict("Time clash: " + "; ".join(sorted(set(clashes))))


def save_interview(actor: User, data: InterviewIn, interview_id: int | None = None) -> dict:
    job = db.session.get(Job, data.job_id)
    if job is None:
        raise ValidationFailed("Select a job.", details={"jobId": ["Unknown job"]})
    now = utcnow()
    try:
        if interview_id is None:
            if job.status not in (JobStatus.PUBLISHED, JobStatus.CLOSED) or job.archived_at:
                raise Conflict(f"Interviews cannot be scheduled for a {'archived' if job.archived_at else job.status.value} job.")
            if data.at <= now:
                raise ValidationFailed("Choose a time in the future.", details={"at": ["Must be in the future"]})
            iv = Interview(job_id=job.id, status=IS.SCHEDULED, notified=False)
            before = None
        else:
            iv = _get(interview_id, lock=True)
            if iv.status != IS.SCHEDULED:
                raise Conflict(f"A {iv.status.value.replace('_', ' ')} interview cannot be edited.")
            if iv.job_id != job.id:
                raise Conflict("The job of an interview cannot be changed. Cancel it and schedule a new one.")
            if data.at != iv.scheduled_at and data.at <= now:
                raise ValidationFailed("Choose a time in the future.", details={"at": ["Must be in the future"]})
            before = (iv.scheduled_at, iv.round_name, iv.location, iv.duration_mins, sorted(a.id for a in iv.applications))
        apps = _load_candidates(job, data.application_ids)
        _check_clashes(apps, data.at, data.duration_mins, ignore_id=iv.id)
        iv.round_name, iv.scheduled_at, iv.duration_mins, iv.location = data.round, data.at, data.duration_mins, data.location
        iv.applications = apps
        iv.notified = False
        db.session.add(iv)
        db.session.flush()
        what = f"Interview {iv.round_name} ({job.title})"
        if before is None:
            audit.record("interview.create", what, actor=actor, reason=f"{len(apps)} candidate(s) at {_fmt(iv.scheduled_at)}")
        else:
            audit.record("interview.update", what, actor=actor, reason=f"{len(apps)} candidate(s) at {_fmt(iv.scheduled_at)}")
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return interview_view(iv, candidates=True)


def set_status(actor: User, interview_id: int, new: str) -> dict:
    iv = _get(interview_id, lock=True)
    new_s = IS(new)
    if iv.status in FINAL or new_s == IS.SCHEDULED:
        raise Conflict(f"This interview is {iv.status.value.replace('_', ' ')} and cannot become {new_s.value.replace('_', ' ')}.")
    if new_s in (IS.COMPLETED, IS.NO_SHOW) and iv.scheduled_at > utcnow():
        raise Conflict("This interview has not started yet. Cancel it instead, or wait until it has taken place.")
    iv.status = new_s
    if new_s == IS.CANCELLED and iv.notified:
        for a in iv.applications:
            notify(a.student.user_id, f"Interview cancelled — {iv.job.company.name}", f"{iv.round_name} on {_fmt(iv.scheduled_at)} has been cancelled.", NotificationKind.INTERVIEW, f"/student/applications/{a.id}")
    audit.record(f"interview.{new_s.value}", f"Interview {iv.round_name} ({iv.job.title})", actor=actor)
    db.session.commit()
    return interview_view(iv, candidates=True)


def notify_candidates(actor: User, interview_id: int) -> dict:
    iv = _get(interview_id, lock=True)
    if iv.status != IS.SCHEDULED:
        raise Conflict(f"This interview is {iv.status.value.replace('_', ' ')}; there is nothing to announce.")
    for a in iv.applications:
        notify(a.student.user_id, f"Interview scheduled — {iv.job.company.name}", f"{iv.round_name} on {_fmt(iv.scheduled_at)} at {iv.location}.", NotificationKind.INTERVIEW, f"/student/applications/{a.id}")
    iv.notified = True
    audit.record("interview.notify", f"Interview {iv.round_name} ({len(iv.applications)} students)", actor=actor)
    db.session.commit()
    return {"notified": len(iv.applications)}
