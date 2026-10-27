import sqlalchemy as sa

from ..errors import Conflict, NotFound, ValidationFailed
from ..extensions import db
from ..models import (
    Company, CompanyTier, Job, JobStatus, Notification, NotificationPreference, Offer, Reminder, ReminderKind, Student, User, utcnow,
)
from ..schemas.content import CompanyIn, CompanyQuery, PrefsIn, ReminderIn
from ..serializers import company_dict, notification_dict, reminder_dict
from . import audit
from .student_service import student_of

# ---------------- notifications
def list_notifications(user: User) -> list[dict]:
    return [notification_dict(n) for n in db.session.query(Notification).filter_by(user_id=user.id).order_by(Notification.created_at.desc(), Notification.id.desc()).limit(200)]


def mark_read(user: User, notification_id: int) -> dict:
    n = db.session.query(Notification).filter_by(id=notification_id, user_id=user.id).first()  # scoped to the caller: others' ids are simply 404
    if n is None:
        raise NotFound("Notification")
    n.is_read = True
    db.session.commit()
    return notification_dict(n)


def mark_all_read(user: User) -> None:
    db.session.query(Notification).filter_by(user_id=user.id, is_read=False).update({"is_read": True})
    db.session.commit()


def _prefs_dict(p: NotificationPreference) -> dict:
    return {"email": p.email, "push": p.push, "driveReminders": p.drive_reminders, "deadlineReminders": p.deadline_reminders, "interviewAlerts": p.interview_alerts, "offerUpdates": p.offer_updates}


def get_prefs(user: User) -> dict:
    p = db.session.get(NotificationPreference, user.id)
    if p is None:
        p = NotificationPreference(user_id=user.id, email=True, push=False, drive_reminders=True, deadline_reminders=True, interview_alerts=True, offer_updates=True)
        db.session.add(p)
        db.session.commit()
    return _prefs_dict(p)


def set_prefs(user: User, data: PrefsIn) -> dict:
    get_prefs(user)
    p = db.session.get(NotificationPreference, user.id)
    p.email, p.push, p.drive_reminders, p.deadline_reminders, p.interview_alerts, p.offer_updates = (
        data.email, data.push, data.drive_reminders, data.deadline_reminders, data.interview_alerts, data.offer_updates)
    db.session.commit()
    return _prefs_dict(p)


# ---------------- reminders (students only, always scoped to the caller)
def _visible_job(job_id: int | None) -> Job | None:
    if job_id is None:
        return None
    job = db.session.get(Job, job_id)
    if job is None or job.status == JobStatus.DRAFT:
        raise ValidationFailed("Choose a valid drive.", details={"jobId": ["Unknown job"]})
    return job


def list_reminders(user: User) -> list[dict]:
    s = student_of(user)
    rows = db.session.query(Reminder).filter_by(student_id=s.id).order_by(Reminder.remind_at).all()
    return [{"reminder": reminder_dict(r), **({"jobTitle": r.job.title, "companyName": r.job.company.name} if r.job else {})} for r in rows]


def save_reminder(user: User, data: ReminderIn, reminder_id: int | None = None) -> dict:
    s = student_of(user)
    job = _visible_job(data.job_id)
    if reminder_id:
        r = db.session.query(Reminder).filter_by(id=reminder_id, student_id=s.id).first()
        if r is None:
            raise NotFound("Reminder")
    else:
        r = Reminder(student_id=s.id)
        db.session.add(r)
    r.title, r.remind_at, r.job_id = data.title, data.at, job.id if job else None
    r.kind = ReminderKind(data.kind) if data.kind else (ReminderKind.DRIVE if job else ReminderKind.CUSTOM)
    db.session.commit()
    return reminder_dict(r)


def toggle_reminder(user: User, reminder_id: int) -> dict:
    s = student_of(user)
    r = db.session.query(Reminder).filter_by(id=reminder_id, student_id=s.id).first()
    if r is None:
        raise NotFound("Reminder")
    r.done = not r.done
    db.session.commit()
    return reminder_dict(r)


def delete_reminder(user: User, reminder_id: int) -> None:
    s = student_of(user)
    r = db.session.query(Reminder).filter_by(id=reminder_id, student_id=s.id).first()
    if r is None:
        raise NotFound("Reminder")
    db.session.delete(r)
    db.session.commit()


# ---------------- companies
def list_companies(q: CompanyQuery) -> tuple[list[dict], int, list[str]]:
    from ..models import Offer as O

    query = db.session.query(Company)
    if q.q:
        pat = "%" + q.q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.filter(sa.or_(sa.func.lower(Company.name).like(pat, escape="\\"), sa.func.lower(Company.industry).like(pat, escape="\\")))
    if q.industry:
        query = query.filter(Company.industry == q.industry)
    if q.tier:
        query = query.filter(Company.tier == CompanyTier(q.tier))
    if q.archived == "exclude":
        query = query.filter(Company.archived_at.is_(None))
    elif q.archived == "only":
        query = query.filter(Company.archived_at.is_not(None))
    total = query.count()
    rows = query.order_by(Company.name).offset((q.page - 1) * q.page_size).limit(q.page_size).all()
    ids = [c.id for c in rows]
    jobs = dict(db.session.query(Job.company_id, sa.func.count()).filter(Job.company_id.in_(ids)).group_by(Job.company_id).all()) if ids else {}
    active = dict(db.session.query(Job.company_id, sa.func.count()).filter(Job.company_id.in_(ids), Job.status == JobStatus.PUBLISHED).group_by(Job.company_id).all()) if ids else {}
    offers = dict(db.session.query(O.company_id, sa.func.count()).filter(O.company_id.in_(ids)).group_by(O.company_id).all()) if ids else {}
    items = [{"company": company_dict(c), "jobCount": jobs.get(c.id, 0), "activeJobs": active.get(c.id, 0), "offers": offers.get(c.id, 0)} for c in rows]
    industries = [r[0] for r in db.session.query(Company.industry).filter(Company.archived_at.is_(None)).distinct().order_by(Company.industry)]
    return items, total, industries


def get_company(company_id: int) -> dict:
    from ..models import Application, Interview
    from ..serializers import job_dict

    c = db.session.get(Company, company_id)
    if c is None:
        raise NotFound("Company")
    rows = []
    for j in db.session.query(Job).filter_by(company_id=c.id).order_by(Job.id).all():
        apps = db.session.query(Application).filter_by(job_id=j.id)
        rows.append({
            "job": job_dict(j), "applicants": apps.count(),
            "selected": apps.filter(Application.status.in_(("selected", "offer_received"))).count(),
            "offers": db.session.query(Offer).filter_by(job_id=j.id).count(),
        })
    ints = db.session.query(Interview).filter(Interview.job_id.in_([r["job"]["id"] for r in rows] or [0])).count() if rows else 0
    return {"company": company_dict(c), "jobs": rows, "interviews": ints}


def save_company(user: User, data: CompanyIn, company_id: int | None = None) -> dict:
    dup = db.session.query(Company).filter(sa.func.lower(Company.name) == data.name.lower(), Company.id != (company_id or 0)).first()
    if dup:
        raise Conflict("A company with this name already exists. Add a new job to it instead of duplicating the record.")
    c = db.session.get(Company, company_id) if company_id else Company()
    if c is None:
        raise NotFound("Company")
    if company_id and c.archived_at:
        raise Conflict("This company is archived. Restore it before editing.")
    c.name, c.website, c.industry, c.description = data.name, data.website, data.industry, data.description
    c.contact_name, c.contact_email, c.contact_phone, c.tier = data.contact_name, data.contact_email, data.contact_phone, CompanyTier(data.tier)
    if data.color:
        c.brand_color = data.color
    db.session.add(c)
    db.session.flush()
    audit.record("company.update" if company_id else "company.create", f"Company {c.name}", actor=user)
    db.session.commit()
    return company_dict(c)


def archive_company(user: User, company_id: int, archived: bool) -> dict:
    """Soft archive. History (jobs, applications, offers) is untouched; a company with live (published) jobs cannot be archived."""
    c = db.session.query(Company).filter(Company.id == company_id).with_for_update().first()
    if c is None:
        raise NotFound("Company")
    if archived and not c.archived_at:
        live = db.session.query(Job).filter(Job.company_id == c.id, Job.status == JobStatus.PUBLISHED).count()
        if live:
            raise Conflict(f"{c.name} has {live} published job(s). Close or cancel them before archiving the company.")
        c.archived_at = utcnow()
        audit.record("company.archive", f"Company {c.name}", actor=user)
    elif not archived and c.archived_at:
        c.archived_at = None
        audit.record("company.unarchive", f"Company {c.name}", actor=user)
    db.session.commit()
    return company_dict(c)
