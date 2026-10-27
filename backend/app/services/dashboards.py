import sqlalchemy as sa

from ..extensions import db
from ..models import (
    AcademicRecord, Application, ApplicationStatus, AuditLog, AuditResult, Company, Department, Document, Interview, InterviewStatus, Job, JobStatus, Offer, OfferStatus, ProcessingStatus, Role,
    RoleName, Student, User, UserStatus, AcademicYear, iso, sid, utcnow,
)
from ..schemas.content import DashboardQuery
from . import eligibility
from .views import application_view, job_view

STATUSES = ["applied", "shortlisted", "interview", "selected", "offer_received", "rejected", "withdrawn"]
LABEL = lambda s: s.replace("_", " ").capitalize()  # noqa: E731


def faculty_dashboard(user: User, q: DashboardQuery) -> dict:
    from datetime import timedelta

    now = utcnow()
    sq = db.session.query(Student)
    if q.dept:
        sq = sq.filter(Student.department_id == q.dept)
    if q.graduation_year:
        sq = sq.filter(Student.graduation_year == q.graduation_year)
    students = sq.all()
    sids = [s.id for s in students] or [0]
    aq = db.session.query(Application).filter(Application.student_id.in_(sids))
    if q.company_id:
        aq = aq.join(Job, Application.job_id == Job.id).filter(Job.company_id == q.company_id)
    if q.days:
        aq = aq.filter(Application.applied_at >= now - timedelta(days=q.days))
    apps = aq.all()
    oq = db.session.query(Offer).filter(Offer.student_id.in_(sids))
    if q.company_id:
        oq = oq.filter(Offer.company_id == q.company_id)
    offers = oq.all()

    jq = db.session.query(Job)
    if q.company_id:
        jq = jq.filter(Job.company_id == q.company_id)
    jobs = jq.all()
    published = [j for j in jobs if j.status == JobStatus.PUBLISHED]
    counts = dict(db.session.query(Application.job_id, sa.func.count()).group_by(Application.job_id).all())
    jv = lambda j: job_view(j, user, applicant_counts=counts)  # noqa: E731

    policies = eligibility.active_policies()
    eligible = 0
    for s in students:
        acc = eligibility.accepted_offers(s.id)
        if any(eligibility.evaluate(s, j, policies=policies, accepted=acc)["state"].value == "eligible" for j in published if j.deadline > now):
            eligible += 1

    depts = db.session.query(Department).filter(*( [Department.id == q.dept] if q.dept else [])).order_by(Department.id).all()
    by_id = {s.id: s for s in students}
    dept_chart = []
    for d in depts:
        ds = [s for s in students if s.department_id == d.id]
        placed = len({o.student_id for o in offers if o.status == OfferStatus.ACCEPTED and by_id[o.student_id].department_id == d.id})
        dept_chart.append({"dept": d.code, "placed": placed, "notPlaced": max(len(ds) - placed, 0), "students": len(ds)})

    ints = (db.session.query(Interview).filter(Interview.status == InterviewStatus.SCHEDULED, Interview.scheduled_at > now).order_by(Interview.scheduled_at).limit(5).all())
    from ..serializers import company_dict, interview_dict, job_dict

    history = sorted(({"at": h.at, "status": h.status.value, "student": a.student.user.name, "job": a.job.title, "company": a.job.company.name} for a in apps for h in a.history if h.status != ApplicationStatus.APPLIED),
                     key=lambda x: x["at"], reverse=True)[:6]
    for h in history:
        h["at"] = iso(h["at"])
    return {
        "metrics": {
            "totalCompanies": 1 if q.company_id else db.session.query(Company).filter(Company.archived_at.is_(None)).count(), "activeJobs": len(published), "totalApplications": len(apps), "eligibleStudents": eligible,
            "shortlisted": sum(1 for a in apps if a.status == ApplicationStatus.SHORTLISTED), "selected": sum(1 for a in apps if a.status in (ApplicationStatus.SELECTED, ApplicationStatus.OFFER_RECEIVED)),
            "offers": len(offers),
        },
        "deptChart": dept_chart,
        "statusDist": [{"status": LABEL(st), "count": sum(1 for a in apps if a.status.value == st)} for st in STATUSES],
        "upcomingDrives": [jv(j) for j in sorted((j for j in published if j.drive and j.drive.drive_date and j.drive.drive_date > now), key=lambda j: j.drive.drive_date)[:5]],
        "nearingDeadline": [jv(j) for j in sorted((j for j in published if now < j.deadline < now + timedelta(days=6)), key=lambda j: j.deadline)],
        "upcomingInterviews": [{"interview": interview_dict(i), "job": job_dict(i.job), "company": company_dict(i.job.company)} for i in ints],
        "recentApplications": [application_view(a, user) for a in sorted(apps, key=lambda a: a.applied_at, reverse=True)[:6]],
        "activity": history,
        "graduationYears": sorted({y for (y,) in db.session.query(Student.graduation_year).distinct()}),
    }


def audit_dict(a: AuditLog) -> dict:
    d = {"id": sid(a.id), "actor": a.actor_name, "actorRole": a.actor_role, "action": a.action, "resource": a.resource, "at": iso(a.created_at), "result": a.result.value, "reason": a.reason}
    return {k: v for k, v in d.items() if v is not None}


def admin_dashboard(viewer: User) -> dict:
    can_audit = viewer.has_permission("audit.view")  # the activity feed and denied-access counts are audit data
    users = db.session.query(User)
    placed = db.session.query(Offer.student_id).filter(Offer.status == OfferStatus.ACCEPTED).distinct().count()
    total_students = db.session.query(Student).count()
    role_id = lambda n: db.session.query(Role.id).filter_by(name=n).scalar()  # noqa: E731
    unverified = (db.session.query(Student).outerjoin(AcademicRecord, AcademicRecord.student_id == Student.id)
                  .filter(sa.or_(AcademicRecord.id.is_(None), AcademicRecord.cgpa_verified.is_(False))).count())
    alerts = [{"level": "error", "text": f"Document processing failed: {d.title}", "link": "/admin/documents"} for d in db.session.query(Document).filter_by(processing=ProcessingStatus.FAILED)]
    alerts += [{"level": "warning", "text": f"{u.name}'s account is {u.status.value}", "link": "/admin/users"}
               for u in users.filter(User.role_id == role_id(RoleName.FACULTY), User.status != UserStatus.ACTIVE)]
    denied = db.session.query(AuditLog).filter_by(result=AuditResult.DENIED).count() if can_audit else 0
    if denied:
        alerts.append({"level": "info", "text": f"{denied} denied access attempt(s) recorded", "link": "/admin/audit-logs"})
    if unverified:
        alerts.append({"level": "warning", "text": f"{unverified} student CGPAs await verification", "link": "/admin/students"})
    return {
        "metrics": {
            "totalUsers": users.count(), "activeStudents": users.filter(User.role_id == role_id(RoleName.STUDENT), User.status == UserStatus.ACTIVE).count(),
            "facultyAccounts": users.filter(User.role_id == role_id(RoleName.FACULTY)).count(), "companies": db.session.query(Company).filter(Company.archived_at.is_(None)).count(),
            "activeJobs": db.session.query(Job).filter_by(status=JobStatus.PUBLISHED).count(), "applications": db.session.query(Application).count(), "offers": db.session.query(Offer).count(),
        },
        "placement": {"totalStudents": total_students, "placed": placed, "pct": round(placed / total_students * 1000) / 10 if total_students else 0,
                      "accepted": db.session.query(Offer).filter_by(status=OfferStatus.ACCEPTED).count(), "offers": db.session.query(Offer).count()},
        "activity": [audit_dict(a) for a in db.session.query(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(7)] if can_audit else [],
        "alerts": alerts,
    }


def reference_filters(user: User) -> dict:
    jobs_q = db.session.query(Job).join(Company).filter(Job.archived_at.is_(None), Company.archived_at.is_(None))
    if user.role_name == "student":
        jobs_q = jobs_q.filter(Job.status == JobStatus.PUBLISHED)
    return {
        "graduationYears": [{"value": str(a.graduation_year), "label": f"{a.label} (batch {a.graduation_year})"} for a in db.session.query(AcademicYear).order_by(AcademicYear.graduation_year.desc())],
        "departments": [{"value": sid(d.id), "label": d.code, "name": d.name} for d in db.session.query(Department).order_by(Department.id)],
        "companies": [{"value": sid(c.id), "label": c.name} for c in db.session.query(Company).filter(Company.archived_at.is_(None)).order_by(Company.name)],
        "jobs": [{"value": sid(j.id), "label": f"{j.company.name} — {j.title}", "companyId": sid(j.company_id)} for j in jobs_q.order_by(Company.name, Job.title)],
    }
