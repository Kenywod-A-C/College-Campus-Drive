"""Placement reports. Aggregates only: nothing here returns an individual student's profile. The CSV export lists offers
(student ID, name, department, company, package) and is therefore restricted to reports.view holders and audited."""
import sqlalchemy as sa

from ..extensions import db
from ..models import Application, ApplicationStatus, ApplicationStatusHistory, Company, Department, Job, JobStatus, Offer, OfferStatus, Student, User
from ..schemas.admin import ReportQuery
from . import audit, eligibility
from .csv_util import to_csv

A = ApplicationStatus
STAGES = [A.APPLIED, A.SHORTLISTED, A.INTERVIEW, A.SELECTED, A.OFFER_RECEIVED]
LABEL = lambda st: st.value.replace("_", " ").capitalize()  # noqa: E731


def _scope(q: ReportQuery):
    sq = db.session.query(Student)
    if q.dept:
        sq = sq.filter(Student.department_id == q.dept)
    if q.academic_year:
        sq = sq.filter(Student.graduation_year == q.academic_year)
    students = sq.all()
    ids = [s.id for s in students]
    aq = db.session.query(Application).join(Job, Application.job_id == Job.id).filter(Application.student_id.in_(ids or [0]))
    oq = db.session.query(Offer).filter(Offer.student_id.in_(ids or [0]))
    if q.company_id:
        aq, oq = aq.filter(Job.company_id == q.company_id), oq.filter(Offer.company_id == q.company_id)
    if q.job_id:
        aq, oq = aq.filter(Application.job_id == q.job_id), oq.filter(Offer.job_id == q.job_id)
    if q.app_status and q.app_status != "all":
        aq = aq.filter(Application.status == A(q.app_status))
    if q.offer_status and q.offer_status != "all":
        oq = oq.filter(Offer.status == OfferStatus(q.offer_status))
    return students, aq.all(), oq.all()


def placement_report(q: ReportQuery) -> dict:
    students, apps, offers = _scope(q)
    placed_ids = {o.student_id for o in offers if o.status == OfferStatus.ACCEPTED}
    depts = db.session.query(Department).filter(Department.id == q.dept).all() if q.dept else db.session.query(Department).order_by(Department.code).all()
    by_student = {s.id: s for s in students}

    # eligible = could apply to at least one currently published job (the same engine that gates real applications)
    policies = eligibility.active_policies()
    accepted: dict[int, list[Offer]] = {}
    for o in eligibility.all_accepted_offers():
        accepted.setdefault(o.student_id, []).append(o)
    open_jobs = db.session.query(Job).filter(Job.status == JobStatus.PUBLISHED, Job.archived_at.is_(None)).all()
    eligible = [s for s in students if any(eligibility.evaluate(s, j, policies=policies, accepted=accepted.get(s.id, []))["state"].value == "eligible" for j in open_jobs)]
    applied_ids = {a.student_id for a in apps}

    app_ids = [a.id for a in apps]
    reached = {st: 0 for st in (A.SHORTLISTED, A.INTERVIEW, A.SELECTED)}
    if app_ids:
        for st, n in (db.session.query(ApplicationStatusHistory.status, sa.func.count(sa.distinct(ApplicationStatusHistory.application_id)))
                      .filter(ApplicationStatusHistory.application_id.in_(app_ids), ApplicationStatusHistory.status.in_(list(reached))).group_by(ApplicationStatusHistory.status)):
            reached[st] = n

    months: dict[tuple[int, int], dict] = {}
    for dt, key in [(a.applied_at, "applications") for a in apps] + [(o.offered_at, "offers") for o in offers]:
        m = months.setdefault((dt.year, dt.month), {"month": dt.strftime("%b %y"), "applications": 0, "offers": 0})
        m[key] += 1

    companies = {c.id: c.name for c in db.session.query(Company)}
    company_rows = {}
    for o in offers:
        r = company_rows.setdefault(o.company_id, {"company": companies.get(o.company_id, "?"), "offers": 0, "accepted": 0})
        r["offers"] += 1
        r["accepted"] += o.status == OfferStatus.ACCEPTED

    return {
        "kpis": {"totalStudents": len(students), "eligibleStudents": len(eligible), "appliedStudents": len(applied_ids), "uniqueStudentsPlaced": len(placed_ids), "totalOffers": len(offers),
                 "acceptedOffers": sum(o.status == OfferStatus.ACCEPTED for o in offers), "placementPct": round(len(placed_ids) / len(students) * 1000) / 10 if students else 0},
        "offersByDept": [{"dept": d.code, "offers": sum(by_student[o.student_id].department_id == d.id for o in offers), "accepted": sum(o.status == OfferStatus.ACCEPTED and by_student[o.student_id].department_id == d.id for o in offers),
                          "placedStudents": sum(by_student[i].department_id == d.id for i in placed_ids), "students": sum(s.department_id == d.id for s in students)} for d in depts],
        "companyOffers": sorted(company_rows.values(), key=lambda r: r["company"]),
        "eligibleVsApplied": [{"dept": d.code, "eligible": sum(s.department_id == d.id for s in eligible), "applied": sum(by_student[i].department_id == d.id for i in applied_ids)} for d in depts],
        "funnel": [{"stage": "Eligible students", "count": len(eligible)}, {"stage": "Applied", "count": len(apps)}, {"stage": "Shortlisted", "count": reached[A.SHORTLISTED]},
                   {"stage": "Interviewed", "count": reached[A.INTERVIEW]}, {"stage": "Selected", "count": reached[A.SELECTED]}, {"stage": "Offers", "count": len(offers)}],
        "monthly": [months[k] for k in sorted(months)],
        "statusDist": [{"status": LABEL(st), "count": sum(a.status == st for a in apps)} for st in [*STAGES, A.REJECTED, A.WITHDRAWN]],
    }


def export_offers_csv(actor: User, q: ReportQuery) -> str:
    _, _, offers = _scope(q)
    offers = sorted(offers, key=lambda o: (o.offered_at, o.id), reverse=True)[:5000]
    audit.record("report.export", f"Placement CSV ({len(offers)} rows)", actor=actor, commit=True)
    head = ["Student ID", "Name", "Department", "Company", "Job", "Package (LPA)", "Offer status", "Offer date"]
    return to_csv(head, [[o.student.student_code, o.student.user.name, o.student.department.code, o.company.name, o.job.title, f"{float(o.ctc_lpa):g}", o.status.value, o.offered_at.date().isoformat()] for o in offers])
