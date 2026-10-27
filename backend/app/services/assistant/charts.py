"""Chart datasets for the assistant.

The model never supplies numbers. It picks a METRIC and a chart type; the server computes the dataset from real records through the
existing services, with the same permission the matching report/screen needs, and returns aggregates only (no individual student rows).
The UI renders the dataset and lets the user switch between the chart types that make sense for its shape.
"""
from dataclasses import dataclass, field
from typing import Callable

import sqlalchemy as sa

from ...errors import Forbidden, ValidationFailed
from ...extensions import db
from ...models import AcademicRecord, Application, Company, Department, Job, Offer, OfferStatus, PlacementStatus, Student, User
from ...schemas.admin import ReportQuery
from .. import reports_service

ALL_TYPES = ("pie", "donut", "bar", "hbar", "stacked", "line", "area")
SINGLE = ("pie", "donut", "bar", "hbar")            # one series, categories
MULTI = ("bar", "stacked", "hbar")                   # several series, categories
TREND = ("line", "area", "bar")                      # ordered categories (time)


@dataclass
class Dataset:
    title: str
    labels: list[str]
    series: list[dict]  # [{"name": str, "values": [number]}]
    default: str
    types: tuple[str, ...]
    unit: str = ""
    subtitle: str = ""

    def as_dict(self, chosen: str) -> dict:
        d = {"title": self.title, "type": chosen, "types": [t for t in self.types if len(self.series) == 1 or t not in ("pie", "donut")], "labels": self.labels, "series": self.series}
        if self.unit:
            d["unit"] = self.unit
        if self.subtitle:
            d["subtitle"] = self.subtitle
        return d


@dataclass(frozen=True)
class Metric:
    label: str
    perms: tuple[str, ...]  # any one of these is enough
    build: Callable[["Filters"], Dataset]


@dataclass
class Filters:
    user: User
    department_id: int | None = None
    department_code: str | None = None
    graduation_year: int | None = None
    _report: dict | None = field(default=None, repr=False)

    def scope_note(self) -> str:
        bits = [x for x in (f"department {self.department_code}" if self.department_code else "", f"batch {self.graduation_year}" if self.graduation_year else "") if x]
        return ("Filtered to " + ", ".join(bits)) if bits else ""

    def students(self):
        q = db.session.query(Student)
        if self.department_id:
            q = q.filter(Student.department_id == self.department_id)
        if self.graduation_year:
            q = q.filter(Student.graduation_year == self.graduation_year)
        return q

    def report(self) -> dict:
        if self._report is None:
            self._report = reports_service.placement_report(ReportQuery(dept=self.department_id, academic_year=self.graduation_year))
        return self._report


def _cap(rows: list, n: int = 12) -> list:
    return rows[:n]


# ---------------------------------------------------------------- metrics
def placement_status(f: Filters) -> Dataset:
    counts = dict(f.students().with_entities(Student.placement_status, sa.func.count()).group_by(Student.placement_status).all())
    order = [(PlacementStatus.PLACED, "Placed"), (PlacementStatus.IN_PROCESS, "In process"), (PlacementStatus.UNPLACED, "Unplaced"), (PlacementStatus.OPTED_OUT, "Opted out")]
    rows = [(label, int(counts.get(k, 0))) for k, label in order if counts.get(k, 0)]
    return Dataset("Students by placement status", [r[0] for r in rows], [{"name": "Students", "values": [r[1] for r in rows]}], "pie", SINGLE, subtitle=f.scope_note())


def students_by_department(f: Filters) -> Dataset:
    rows = f.students().join(Department, Student.department_id == Department.id).with_entities(Department.code, sa.func.count()).group_by(Department.code).order_by(Department.code).all()
    return Dataset("Students by department", [r[0] for r in rows], [{"name": "Students", "values": [int(r[1]) for r in rows]}], "bar", SINGLE, subtitle=f.scope_note())


def placed_vs_unplaced_by_department(f: Filters) -> Dataset:
    rows = [d for d in f.report()["offersByDept"] if d["students"]]
    return Dataset("Placed vs not placed by department", [d["dept"] for d in rows],
                   [{"name": "Placed", "values": [d["placedStudents"] for d in rows]}, {"name": "Not placed", "values": [d["students"] - d["placedStudents"] for d in rows]}], "stacked", MULTI, subtitle=f.scope_note())


def placement_rate_by_department(f: Filters) -> Dataset:
    rows = [d for d in f.report()["offersByDept"] if d["students"]]
    return Dataset("Placement rate by department", [d["dept"] for d in rows], [{"name": "Placed %", "values": [round(d["placedStudents"] / d["students"] * 100, 1) for d in rows]}], "bar", ("bar", "hbar", "line"), unit="%", subtitle=f.scope_note())


def offers_by_department(f: Filters) -> Dataset:
    rows = [d for d in f.report()["offersByDept"] if d["offers"] or d["students"]]
    return Dataset("Offers by department", [d["dept"] for d in rows], [{"name": "Offers", "values": [d["offers"] for d in rows]}, {"name": "Accepted", "values": [d["accepted"] for d in rows]}], "bar", MULTI, subtitle=f.scope_note())


COMPANY_CAP = 20


def company_stats() -> list[dict]:
    """EVERY active company with its job, application and offer counts (companies with no offers yet are included)."""
    comps = db.session.query(Company).filter(Company.archived_at.is_(None)).all()
    jobs = dict(db.session.query(Job.company_id, sa.func.count()).group_by(Job.company_id).all())
    apps = dict(db.session.query(Job.company_id, sa.func.count(Application.id)).join(Application, Application.job_id == Job.id).group_by(Job.company_id).all())
    offers = dict(db.session.query(Offer.company_id, sa.func.count()).group_by(Offer.company_id).all())
    accepted = dict(db.session.query(Offer.company_id, sa.func.count()).filter(Offer.status == OfferStatus.ACCEPTED).group_by(Offer.company_id).all())
    rows = [{"company": c.name, "jobs": jobs.get(c.id, 0), "applications": apps.get(c.id, 0), "offers": offers.get(c.id, 0), "accepted": accepted.get(c.id, 0)} for c in comps]
    return sorted(rows, key=lambda r: (-r["offers"], -r["applications"], -r["jobs"], r["company"].lower()))


def _company_subtitle(total: int) -> str:
    return f"Top {COMPANY_CAP} of {total} companies." if total > COMPANY_CAP else f"All {total} companies."


def offers_by_company(f: Filters) -> Dataset:
    all_ = company_stats()
    rows = all_[:COMPANY_CAP]
    return Dataset("Offers by company", [r["company"] for r in rows], [{"name": "Offers", "values": [r["offers"] for r in rows]}, {"name": "Accepted", "values": [r["accepted"] for r in rows]}], "bar", MULTI, subtitle=_company_subtitle(len(all_)))


def companies_overview(f: Filters) -> Dataset:
    all_ = company_stats()
    rows = all_[:COMPANY_CAP]
    return Dataset("Companies overview", [r["company"] for r in rows],
                   [{"name": "Jobs", "values": [r["jobs"] for r in rows]}, {"name": "Applications", "values": [r["applications"] for r in rows]}, {"name": "Offers", "values": [r["offers"] for r in rows]}], "bar", MULTI, subtitle=_company_subtitle(len(all_)))


def applications_by_stage(f: Filters) -> Dataset:
    rows = [r for r in f.report()["statusDist"] if r["count"]]
    return Dataset("Applications by stage", [r["status"] for r in rows], [{"name": "Applications", "values": [r["count"] for r in rows]}], "donut", SINGLE, subtitle=f.scope_note())


def placement_funnel(f: Filters) -> Dataset:
    rows = f.report()["funnel"]
    return Dataset("Placement funnel", [r["stage"] for r in rows], [{"name": "Students / applications", "values": [r["count"] for r in rows]}], "hbar", ("hbar", "bar", "area"), subtitle=f.scope_note())


def monthly_trend(f: Filters) -> Dataset:
    rows = f.report()["monthly"][-12:]
    return Dataset("Applications and offers by month", [r["month"] for r in rows], [{"name": "Applications", "values": [r["applications"] for r in rows]}, {"name": "Offers", "values": [r["offers"] for r in rows]}], "line", TREND, subtitle=f.scope_note())


def cgpa_distribution(f: Filters) -> Dataset:
    values = [row[0] for row in f.students().join(AcademicRecord, AcademicRecord.student_id == Student.id).with_entities(AcademicRecord.cgpa).all()]
    buckets = [("Below 6", lambda c: c < 6), ("6 – 7", lambda c: 6 <= c < 7), ("7 – 8", lambda c: 7 <= c < 8), ("8 – 9", lambda c: 8 <= c < 9), ("9 and above", lambda c: c >= 9)]
    counts = [sum(1 for v in values if v is not None and fn(float(v))) for _, fn in buckets]
    missing = f.students().count() - sum(1 for v in values if v is not None)
    labels, vals = [b[0] for b in buckets], counts
    if missing > 0:
        labels, vals = labels + ["No CGPA yet"], vals + [missing]
    return Dataset("CGPA distribution", labels, [{"name": "Students", "values": vals}], "bar", SINGLE, subtitle=f.scope_note())


STAFF_METRICS: dict[str, Metric] = {
    "placement_status": Metric("Students by placement status (placed / in process / unplaced)", ("students.view", "reports.view"), placement_status),
    "students_by_department": Metric("Students per department", ("students.view", "reports.view"), students_by_department),
    "cgpa_distribution": Metric("CGPA bands", ("students.view",), cgpa_distribution),
    "placed_vs_unplaced_by_department": Metric("Placed vs not placed per department", ("reports.view",), placed_vs_unplaced_by_department),
    "placement_rate_by_department": Metric("Placement percentage per department", ("reports.view",), placement_rate_by_department),
    "offers_by_department": Metric("Offers per department", ("reports.view",), offers_by_department),
    "offers_by_company": Metric("Offers per company (every company, including those with no offers yet)", ("reports.view",), offers_by_company),
    "companies_overview": Metric("All companies: jobs, applications and offers per company", ("reports.view", "companies.manage", "applications.review"), companies_overview),
    "applications_by_stage": Metric("Applications by stage", ("reports.view", "applications.review"), applications_by_stage),
    "placement_funnel": Metric("Eligible → applied → shortlisted → selected → offers", ("reports.view",), placement_funnel),
    "monthly_trend": Metric("Applications and offers per month", ("reports.view",), monthly_trend),
}


def build_staff_chart(user: User, metric: str, chart_type: str | None, department: str | None, graduation_year: int | None) -> tuple[dict, str]:
    """-> (chart dict for the UI, note for the model). Raises Forbidden if the caller lacks the metric's permission."""
    m = STAFF_METRICS[metric]
    if not any(user.has_permission(p) for p in m.perms):
        raise Forbidden("You do not have permission to chart this.")
    dept_id = None
    if department:
        d = db.session.query(Department).filter(sa.func.lower(Department.code) == department.lower()).first()
        if d is None:
            raise ValidationFailed(f"Unknown department '{department}'. Use a code such as CSE, IT, ECE.")
        dept_id = d.id
    ds = m.build(Filters(user, dept_id, department.upper() if department else None, graduation_year))
    return _finish(ds, chart_type)


def _finish(ds: Dataset, chart_type: str | None) -> tuple[dict, str]:
    if not ds.labels or not any(any(v for v in s["values"]) for s in ds.series):
        raise ValidationFailed("There is no data to chart for these filters.")
    allowed = [t for t in ds.types if len(ds.series) == 1 or t not in ("pie", "donut")]
    note = ""
    chosen = chart_type if chart_type in allowed else ds.default
    if chart_type and chart_type not in allowed:
        note = f"A {chart_type} chart does not suit this data, so a {chosen} chart is shown. The user can switch between: {', '.join(allowed)}."
    return ds.as_dict(chosen), note


# ---------------------------------------------------------------- the signed-in student's own charts
def my_applications_by_status(user: User) -> Dataset:
    from ...models import Application
    from .. import applications_service  # noqa: F401  (student_of lives in student_service)
    from ..student_service import student_of

    s = student_of(user)
    counts = dict(db.session.query(Application.status, sa.func.count()).filter(Application.student_id == s.id).group_by(Application.status).all())
    rows = [(k.value.replace("_", " ").capitalize(), int(v)) for k, v in counts.items() if v]
    return Dataset("My applications by status", [r[0] for r in rows], [{"name": "Applications", "values": [r[1] for r in rows]}], "donut", SINGLE)


def my_job_eligibility(user: User) -> Dataset:
    from ...schemas.jobs import JobQuery
    from .. import jobs_service

    views, _, _ = jobs_service.list_jobs(user, JobQuery(tab="all", page_size=100))
    names = {"eligible": "Eligible", "not_eligible": "Not eligible", "profile_incomplete": "Profile incomplete", "needs_verification": "Needs CGPA verification"}
    counts: dict[str, int] = {}
    for v in views:
        label = names.get(v["eligibility"]["state"], v["eligibility"]["state"])
        counts[label] = counts.get(label, 0) + 1
    return Dataset("Open jobs by my eligibility", list(counts), [{"name": "Jobs", "values": list(counts.values())}], "pie", SINGLE, subtitle="Computed by the college eligibility rules.")


STUDENT_METRICS = {"my_applications_by_status": my_applications_by_status, "my_job_eligibility": my_job_eligibility}


def build_student_chart(user: User, metric: str, chart_type: str | None) -> tuple[dict, str]:
    return _finish(STUDENT_METRICS[metric](user), chart_type)
