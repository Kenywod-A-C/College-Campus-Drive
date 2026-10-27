"""Joined view models (JobView, ApplicationView, OfferView ...) shared by several endpoints."""
from datetime import datetime

from ..extensions import db
from ..models import (
    Application, ApplicationStatus, Interview, InterviewStatus, Job, Notification, NotificationKind, Offer, OfferStatus, SavedJob, SkillKind, Student, User, iso,
    interview_candidates, utcnow,
)
from ..serializers import application_dict, company_dict, eligibility_dict, interview_dict, job_dict, notification_dict, offer_dict, student_dict
from . import eligibility


def _fmt(dt: datetime) -> str:
    return dt.strftime("%d %b, %H:%M").lstrip("0")


def latest_application(student_id: int, job_id: int) -> Application | None:
    return (db.session.query(Application).filter(Application.student_id == student_id, Application.job_id == job_id, Application.status != ApplicationStatus.WITHDRAWN)
            .order_by(Application.id.desc()).first())


def job_view(job: Job, user: User, *, student: Student | None = None, policies=None, accepted=None, saved: set[int] | None = None, apps: dict[int, Application] | None = None,
             applicant_counts: dict[int, int] | None = None) -> dict:
    v: dict = {"job": job_dict(job), "company": company_dict(job.company), "eligibleDepartments": sorted(d.code for d in job.departments)}
    if user.role_name == "student" and student is not None:
        res = eligibility.evaluate(student, job, policies=policies, accepted=accepted)
        v["eligibility"] = eligibility_dict(res)
        v["saved"] = (job.id in saved) if saved is not None else bool(db.session.get(SavedJob, (student.id, job.id)))
        app = apps.get(job.id) if apps is not None else latest_application(student.id, job.id)
        if app:
            v["applicationId"], v["applicationStatus"] = str(app.id), app.status.value
        overlap = len({s.lower() for s in (job.skills or [])} & {s.lower() for s in student.tags(SkillKind.SKILL)})
        v["relevance"] = overlap * 2 + (3 if res["state"].value == "eligible" else 0)
    else:
        v["applicantCount"] = applicant_counts.get(job.id, 0) if applicant_counts is not None else db.session.query(Application).filter(Application.job_id == job.id).count()
    return v


def next_action(app: Application) -> str | None:
    nxt = (db.session.query(Interview).join(interview_candidates, interview_candidates.c.interview_id == Interview.id)
           .filter(interview_candidates.c.application_id == app.id, Interview.status == InterviewStatus.SCHEDULED, Interview.scheduled_at > utcnow())
           .order_by(Interview.scheduled_at).first())
    if nxt:
        return f"{nxt.round_name} · {_fmt(nxt.scheduled_at)}"
    offer = app.offer
    if app.status == ApplicationStatus.OFFER_RECEIVED and offer and offer.status == OfferStatus.RECEIVED:
        return f"Respond to offer by {offer.accept_by.strftime('%d %b').lstrip('0')}"
    return {ApplicationStatus.SHORTLISTED: "Awaiting interview schedule", ApplicationStatus.APPLIED: "Awaiting screening", ApplicationStatus.SELECTED: "Offer being prepared"}.get(app.status)


def application_view(app: Application, viewer: User) -> dict:
    v = {"application": application_dict(app), "job": job_dict(app.job), "company": company_dict(app.job.company)}
    na = next_action(app)
    if na:
        v["nextAction"] = na
    if viewer.role_name != "student":
        v["student"] = student_dict(app.student, mask_phone=viewer.role_name != "admin")
    return v


def application_detail(app: Application, viewer: User) -> dict:
    v = application_view(app, viewer)
    ints = (db.session.query(Interview).join(interview_candidates, interview_candidates.c.interview_id == Interview.id)
            .filter(interview_candidates.c.application_id == app.id).order_by(Interview.scheduled_at).all())
    notes = (db.session.query(Notification).filter(Notification.user_id == app.student.user_id, Notification.kind.in_([NotificationKind.INTERVIEW, NotificationKind.APPLICATION, NotificationKind.OFFER]))
             .order_by(Notification.created_at.desc()).limit(5).all())
    v["interviews"] = [interview_dict(i) for i in ints]
    v["notifications"] = [notification_dict(n) for n in notes]
    if app.offer:
        v["offer"] = offer_dict(app.offer)
    return v


def offer_view(o: Offer, viewer: User) -> dict:
    v = {"offer": offer_dict(o), "job": job_dict(o.job), "company": company_dict(o.company)}
    if viewer.role_name != "student":
        v["student"] = student_dict(o.student, mask_phone=viewer.role_name != "admin")
    return v


__all__ = ["job_view", "application_view", "application_detail", "offer_view", "latest_application", "iso"]
