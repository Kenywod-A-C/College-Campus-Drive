import sqlalchemy as sa
from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from ..errors import Forbidden, NotFound
from ..extensions import db
from ..models import Application, ApplicationStatus, Company, Job, JobStatus, SavedJob, Student, User, job_departments, utcnow
from ..schemas.jobs import JobQuery
from . import eligibility
from .student_service import student_of
from .views import job_view

STAFF_JOB_PERMS = ("jobs.create", "applications.review", "students.view", "drives.publish")


def _like(term: str) -> str:
    return "%" + term.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _filtered_query(q: JobQuery):
    query = db.session.query(Job).join(Company, Job.company_id == Company.id)
    if q.q:
        pat = _like(q.q)
        query = query.filter(or_(sa.func.lower(Job.title).like(pat, escape="\\"), sa.func.lower(Company.name).like(pat, escape="\\"), sa.func.lower(Job.domain).like(pat, escape="\\"),
                                 sa.func.lower(sa.cast(Job.skills, sa.Text)).like(pat, escape="\\")))
    if q.dept:
        query = query.filter(Job.id.in_(sa.select(job_departments.c.job_id).where(job_departments.c.department_id == q.dept)))
    if q.min_cgpa is not None:  # jobs whose requirement the student can meet
        from ..models import JobEligibilityRule
        query = query.filter(Job.id.in_(sa.select(JobEligibilityRule.job_id).where(JobEligibilityRule.min_cgpa <= q.min_cgpa)))
    if q.location:
        query = query.filter(sa.func.lower(Job.location).like(_like(q.location), escape="\\"))
    if q.type:
        query = query.filter(Job.job_type == q.type)
    if q.deadline_days:
        query = query.filter(Job.deadline > utcnow())
    if q.company_id:
        query = query.filter(Job.company_id == q.company_id)
    return query


def list_jobs(user: User, q: JobQuery) -> tuple[list[dict], int, dict]:
    from datetime import timedelta

    query = _filtered_query(q)
    if q.deadline_days:
        query = query.filter(Job.deadline <= utcnow() + timedelta(days=q.deadline_days))

    if user.role_name != "student":
        if not any(user.has_permission(p) for p in STAFF_JOB_PERMS):
            raise Forbidden("You do not have permission to view this.")
        if q.status and q.status != "all":
            query = query.filter(Job.status == JobStatus(q.status))
        if q.archived == "exclude":
            query = query.filter(Job.archived_at.is_(None))
        elif q.archived == "only":
            query = query.filter(Job.archived_at.is_not(None))
        order = {"recent": sa.func.coalesce(Job.published_at, Job.open_date).desc(), "relevance": Job.deadline.asc(), "deadline": Job.deadline.asc()}[q.sort]
        total = query.count()
        jobs = query.order_by(order, Job.id).options(joinedload(Job.company)).offset((q.page - 1) * q.page_size).limit(q.page_size).all()
        ids = [j.id for j in jobs]
        counts = dict(db.session.query(Application.job_id, sa.func.count()).filter(Application.job_id.in_(ids)).group_by(Application.job_id).all()) if ids else {}
        return [job_view(j, user, applicant_counts=counts) for j in jobs], total, {}

    # ---- student: visibility is enforced here, never trusted from the client
    student = student_of(user)
    applied_job_ids = [a.job_id for a in db.session.query(Application).filter_by(student_id=student.id)]
    tab = q.tab or "all"
    if tab == "applied":
        query = query.filter(Job.id.in_(applied_job_ids or [0]), Job.status != JobStatus.DRAFT)
    else:
        query = query.filter(Job.status == JobStatus.PUBLISHED)
    jobs = query.options(joinedload(Job.company)).all()

    policies, accepted = eligibility.active_policies(), eligibility.accepted_offers(student.id)
    saved = {r.job_id for r in db.session.query(SavedJob).filter_by(student_id=student.id)}
    apps = {a.job_id: a for a in db.session.query(Application).filter_by(student_id=student.id).order_by(Application.id) if a.status != ApplicationStatus.WITHDRAWN}
    views = [job_view(j, user, student=student, policies=policies, accepted=accepted, saved=saved, apps=apps) for j in jobs]
    if tab == "eligible":
        views = [v for v in views if v["eligibility"]["state"] == "eligible"]
    elif tab == "not_eligible":
        views = [v for v in views if v["eligibility"]["state"] == "not_eligible"]
    elif tab == "saved":
        views = [v for v in views if v["saved"]]
    elif tab == "applied":
        views = [v for v in views if "applicationId" in v]
    keys = {"relevance": lambda v: (-v["relevance"], v["job"]["deadline"]), "recent": lambda v: v["job"].get("publishedAt", v["job"]["openDate"]), "deadline": lambda v: v["job"]["deadline"]}
    views.sort(key=keys[q.sort], reverse=(q.sort == "recent"))
    total = len(views)
    start = (q.page - 1) * q.page_size
    return views[start:start + q.page_size], total, {}


def get_job(user: User, job_id: int) -> dict:
    job = db.session.get(Job, job_id)
    if job is None:
        raise NotFound("Job")
    if user.role_name == "student":
        if job.status == JobStatus.DRAFT:
            raise NotFound("Job")  # drafts do not exist as far as students are concerned
        return job_view(job, user, student=student_of(user))
    if not any(user.has_permission(p) for p in STAFF_JOB_PERMS):
        raise Forbidden("You do not have permission to view this.")
    return job_view(job, user)


def toggle_save(user: User, job_id: int) -> bool:
    student = student_of(user)
    job = db.session.get(Job, job_id)
    if job is None or job.status == JobStatus.DRAFT:
        raise NotFound("Job")
    row = db.session.get(SavedJob, (student.id, job_id))
    if row:
        db.session.delete(row)
    else:
        db.session.add(SavedJob(student_id=student.id, job_id=job_id))
    db.session.commit()
    return row is None
