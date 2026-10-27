"""Reports generated inside the chat. Like charts, the data comes from the existing services under the caller's permissions: the model
only picks a report type and filters, and writes a short summary. A report is a title, KPI tiles and sections of table and/or chart,
shown in the conversation with CSV download and print/PDF. Tables are capped (ROW_CAP) and say so when truncated; the full exports
stay on the Reports page."""
from datetime import datetime

import sqlalchemy as sa

from ...errors import Forbidden, NotFound, ValidationFailed
from ...extensions import db
from ...models import Department, EligibilityState, Job, JobStatus, Student, User, iso, utcnow
from ...schemas.admin import AuditQuery, ReportQuery, UserQuery
from ...schemas.content import CompanyQuery
from ...schemas.jobs import ApplicationQuery
from ...schemas.review import ApplicationReviewQuery, InterviewQuery, OfferQuery
from ...schemas.students import StudentQuery
from .. import admin_service, applications_review_service as review, applications_service, content_service, eligibility, interviews_service, offers_service, students_service, users_service
from . import charts

ROW_CAP = 100


def _date(v: str | None) -> str:
    return v[:10] if v else ""


def _table(columns: list[str], rows: list[list]) -> dict:
    return {"columns": columns, "rows": rows}


def _section(heading: str, *, table: dict | None = None, chart: dict | None = None, note: str = "") -> dict:
    return {k: v for k, v in (("heading", heading), ("table", table), ("chart", chart), ("note", note)) if v}


def _chart_from(ds: charts.Dataset) -> dict:
    return ds.as_dict(ds.default)


def _count_chart(title: str, counts: dict[str, int], default: str = "donut") -> dict | None:
    rows = [(k, v) for k, v in counts.items() if v]
    return _chart_from(charts.Dataset(title, [r[0] for r in rows], [{"name": "Count", "values": [r[1] for r in rows]}], default, charts.SINGLE)) if rows else None


def _report(title: str, kpis: list[tuple[str, object]], sections: list[dict], subtitle: str = "", truncated: bool = False) -> dict:
    d = {"title": title, "generatedAt": iso(utcnow()), "kpis": [{"label": k, "value": str(v)} for k, v in kpis], "sections": sections}
    if subtitle:
        d["subtitle"] = subtitle
    if truncated:
        d["truncated"] = True
    return d


def eligible_students(job: Job) -> tuple[list[Student], int]:
    """Students who satisfy the job's rules right now (ignoring whether it is still open), best CGPA first, plus how many were evaluated."""
    q = db.session.query(Student)
    allowed = [d.id for d in job.departments]
    if allowed:
        q = q.filter(Student.department_id.in_(allowed))
    years = job.rule.graduation_years or []
    if years:
        q = q.filter(Student.graduation_year.in_(years))
    students = q.all()
    policies = eligibility.active_policies()
    accepted: dict[int, list] = {}
    for o in eligibility.all_accepted_offers():
        accepted.setdefault(o.student_id, []).append(o)
    out = [s for s in students if eligibility.evaluate(s, job, policies=policies, accepted=accepted.get(s.id, []), ignore_open=True)["state"] == EligibilityState.ELIGIBLE]
    out.sort(key=lambda s: -(float(s.academic.cgpa) if s.academic and s.academic.cgpa is not None else 0))
    return out, len(students)


def _dept_id(code: str | None) -> tuple[int | None, str | None]:
    if not code:
        return None, None
    d = db.session.query(Department).filter(sa.func.lower(Department.code) == code.lower()).first()
    if d is None:
        raise ValidationFailed(f"Unknown department '{code}'. Use a code such as CSE, IT, ECE.")
    return d.id, d.code


def _need(user: User, *perms: str) -> None:
    if not any(user.has_permission(p) for p in perms):
        raise Forbidden("You do not have permission to generate this report.")


# ------------------------------------------------------------------ report types
def placement_summary(user: User, f: dict) -> dict:
    _need(user, "reports.view")
    dept_id, dept = _dept_id(f.get("department"))
    r = reports_report(dept_id, f.get("graduation_year"))
    k = r["kpis"]
    flt = charts.Filters(user, dept_id, dept, f.get("graduation_year"), _report=r)
    depts = [d for d in r["offersByDept"] if d["students"]]
    sections = [
        _section("Placement by department", table=_table(["Department", "Students", "Placed", "Offers", "Accepted", "Placement %"],
                                                          [[d["dept"], d["students"], d["placedStudents"], d["offers"], d["accepted"], round(d["placedStudents"] / d["students"] * 100, 1)] for d in depts]),
                 chart=_chart_from(charts.placed_vs_unplaced_by_department(flt)) if depts else None),
        _section("Placement funnel", chart=_chart_from(charts.placement_funnel(flt))),
    ]
    stats = charts.company_stats()
    if stats:  # every company, including those with no offers yet
        sections.append(_section("Companies", table=_table(["Company", "Jobs", "Applications", "Offers", "Accepted"], [[c["company"], c["jobs"], c["applications"], c["offers"], c["accepted"]] for c in stats[:ROW_CAP]]),
                                 chart=_chart_from(charts.companies_overview(flt)), note="Counts cover all periods and departments." if (dept_id or f.get("graduation_year")) else ""))
    if r["monthly"]:
        sections.append(_section("Monthly trend", chart=_chart_from(charts.monthly_trend(flt))))
    stages = [x for x in r["statusDist"] if x["count"]]
    if stages:
        sections.append(_section("Applications by stage", table=_table(["Stage", "Applications"], [[x["status"], x["count"]] for x in stages]), chart=_chart_from(charts.applications_by_stage(flt))))
    sub = flt.scope_note()
    return _report("Placement summary report", [("Students", k["totalStudents"]), ("Eligible now", k["eligibleStudents"]), ("Applied", k["appliedStudents"]), ("Placed", k["uniqueStudentsPlaced"]),
                                               ("Placement %", f"{k['placementPct']}%"), ("Offers", k["totalOffers"]), ("Accepted offers", k["acceptedOffers"])], sections, sub)


def reports_report(dept_id, year):
    from .. import reports_service
    return reports_service.placement_report(ReportQuery(dept=dept_id, academic_year=year))


def student_directory(user: User, f: dict) -> dict:
    _need(user, "students.view")
    dept_id, dept = _dept_id(f.get("department"))
    q = StudentQuery(dept=dept_id, year=f.get("graduation_year"), min_cgpa=f.get("min_cgpa"), placement=f.get("placement_status"), page_size=ROW_CAP)
    rows, total = students_service.list_students(user, q)
    depts = {str(d.id): d.code for d in db.session.query(Department)}
    table = _table(["Student ID", "Name", "Department", "Batch", "CGPA", "CGPA verified", "Placement", "Applications", "Offers"],
                   [[r["studentCode"], r["name"], depts.get(r.get("departmentId", ""), ""), r.get("graduationYear"), r.get("academic", {}).get("cgpa", ""), "Yes" if r.get("academic", {}).get("cgpaVerified") else "No",
                     r.get("placementStatus", "").replace("_", " "), r.get("applicationCount", 0), r.get("offerCount", 0)] for r in rows])
    counts: dict[str, int] = {}
    for r in rows:
        counts[r.get("placementStatus", "").replace("_", " ").capitalize()] = counts.get(r.get("placementStatus", "").replace("_", " ").capitalize(), 0) + 1
    cg = [r["academic"]["cgpa"] for r in rows if r.get("academic", {}).get("cgpa") is not None]
    flt = charts.Filters(user, dept_id, dept, f.get("graduation_year"))
    bits = [x for x in (flt.scope_note(), f"CGPA ≥ {f['min_cgpa']}" if f.get("min_cgpa") is not None else "", f"placement: {f['placement_status']}" if f.get("placement_status") else "") if x]
    return _report("Student directory report", [("Students matching", total), ("Shown", len(rows)), ("Average CGPA", round(sum(cg) / len(cg), 2) if cg else "n/a"), ("Placed (shown)", counts.get("Placed", 0))],
                   [_section("Students", table=table, note=f"Showing the first {ROW_CAP} of {total}. Narrow the filters for the rest." if total > len(rows) else ""), _section("By placement status", chart=_count_chart("Students by placement status", counts, "pie"))],
                   "; ".join(bits), truncated=total > len(rows))


def applicants(user: User, f: dict) -> dict:
    _need(user, "applications.review")
    job_id = f.get("job_id")
    if job_id and db.session.get(Job, job_id) is None:
        raise NotFound("Job")
    views, total = review.list_applications(user, ApplicationReviewQuery(job_id=job_id, status=f.get("status") or "all", page_size=ROW_CAP))
    depts = {str(d.id): d.code for d in db.session.query(Department)}
    table = _table(["Student ID", "Name", "Dept", "CGPA", "Company", "Role", "Stage", "Eligibility at apply", "Applied"],
                   [[v["student"]["studentCode"], v["student"]["name"], depts.get(v["student"].get("departmentId", ""), ""), v["student"].get("academic", {}).get("cgpa", ""), v["company"]["name"], v["job"]["title"],
                     v["application"]["status"].replace("_", " "), v["application"]["eligibilitySnapshot"]["state"].replace("_", " "), _date(v["application"]["appliedAt"])] for v in views])
    counts: dict[str, int] = {}
    for v in views:
        k = v["application"]["status"].replace("_", " ").capitalize()
        counts[k] = counts.get(k, 0) + 1
    job = db.session.get(Job, job_id) if job_id else None
    return _report("Applicants report", [("Applications matching", total), ("Shown", len(views))],
                   [_section("Applicants", table=table, note=f"Showing the first {ROW_CAP} of {total}." if total > len(views) else ""), _section("By stage", chart=_count_chart("Applications by stage", counts))],
                   f"{job.company.name} — {job.title}" if job else "All jobs", truncated=total > len(views))


def offers(user: User, f: dict) -> dict:
    _need(user, "offers.manage")
    dept_id, _ = _dept_id(f.get("department"))
    items, total, extra = offers_service.list_offers(user, OfferQuery(status=f.get("status") or "all", dept=dept_id, page_size=ROW_CAP))
    table = _table(["Student ID", "Name", "Company", "Role", "Package (LPA)", "Status", "Offered", "Respond by"],
                   [[v["student"]["studentCode"], v["student"]["name"], v["company"]["name"], v["job"]["title"], v["offer"]["ctcLpa"], v["offer"]["status"], _date(v["offer"]["offeredAt"]), _date(v["offer"]["acceptBy"])] for v in items])
    t = extra["totals"]
    comp = {c["company"]: c["offers"] for c in sorted(extra["byCompany"], key=lambda c: -c["offers"])[:12]}
    return _report("Offers report", [("Offers", t["offers"]), ("Accepted", t["accepted"]), ("Students placed", t["placed"]), ("Selected, no offer yet", len(extra["selectedWithoutOffer"]))],
                   [_section("Offers", table=table, note=f"Showing the first {ROW_CAP} of {total}." if total > len(items) else ""), _section("Offers by company", chart=_count_chart("Offers by company", comp, "bar")),
                    _section("By department", table=_table(["Department", "Students", "Offers", "Placed"], [[d["dept"], d["students"], d["offers"], d["placed"]] for d in extra["byDept"]]))], truncated=total > len(items))


def interviews(user: User, f: dict) -> dict:
    _need(user, "applications.review")
    items, total = interviews_service.list_interviews(user, InterviewQuery(job_id=f.get("job_id"), status=f.get("status") or "scheduled", page_size=ROW_CAP))
    table = _table(["When", "Company", "Role", "Round", "Where", "Status", "Candidates"],
                   [[v["interview"]["at"][:16].replace("T", " "), v["company"]["name"], v["job"]["title"], v["interview"]["round"], v["interview"]["location"], v["interview"]["status"], len(v["candidates"])] for v in items])
    return _report("Interview schedule report", [("Interviews", total), ("Candidates scheduled", sum(len(v["candidates"]) for v in items))], [_section("Interviews", table=table)], f"Status: {f.get('status') or 'scheduled'}", truncated=total > len(items))


def eligible_report(user: User, f: dict) -> dict:
    _need(user, "students.view")
    if not f.get("job_id"):
        raise ValidationFailed("Which job? Give its jobId.")
    job = db.session.get(Job, f["job_id"])
    if job is None:
        raise NotFound("Job")
    from .. import jobs_service
    jobs_service.get_job(user, job.id)
    ok, evaluated = eligible_students(job)
    depts = {d.id: d.code for d in db.session.query(Department)}
    table = _table(["Student ID", "Name", "Department", "Batch", "CGPA"], [[s.student_code or "", s.user.name, depts.get(s.department_id, ""), s.graduation_year, float(s.academic.cgpa) if s.academic and s.academic.cgpa is not None else ""] for s in ok[:ROW_CAP]])
    by_dept: dict[str, int] = {}
    for s in ok:
        by_dept[depts.get(s.department_id, "?")] = by_dept.get(depts.get(s.department_id, "?"), 0) + 1
    return _report("Eligible students report", [("Students evaluated", evaluated), ("Eligible", len(ok)), ("Job accepting applications", "Yes" if job.status == JobStatus.PUBLISHED and job.deadline > utcnow() else "No")],
                   [_section("Eligible students", table=table, note="Evaluated by the college eligibility rules (department, batch, CGPA, arrears, skills, policies). Job open/deadline is ignored." + (f" Showing the first {ROW_CAP} of {len(ok)}." if len(ok) > ROW_CAP else "")),
                    _section("By department", chart=_count_chart("Eligible students by department", by_dept, "bar"))], f"{job.company.name} — {job.title}", truncated=len(ok) > ROW_CAP)


def user_accounts(user: User, f: dict) -> dict:
    _need(user, "users.manage")
    dept_id, _ = _dept_id(f.get("department"))
    rows, total = users_service.list_users(UserQuery(role=f.get("account_type") or "all", dept=dept_id, page_size=ROW_CAP))
    depts = {str(d.id): d.code for d in db.session.query(Department)}
    table = _table(["Name", "User ID", "Email", "Role", "Status", "Department", "Last sign-in"], [[u["name"], u["userCode"], u["email"], u["role"], u["status"], depts.get(u.get("departmentId", ""), ""), _date(u.get("lastLoginAt"))] for u in rows])
    roles: dict[str, int] = {}
    status: dict[str, int] = {}
    for u in rows:
        roles[u["role"].capitalize()] = roles.get(u["role"].capitalize(), 0) + 1
        status[u["status"].capitalize()] = status.get(u["status"].capitalize(), 0) + 1
    return _report("User accounts report", [("Accounts matching", total), ("Shown", len(rows)), ("Active", status.get("Active", 0)), ("Invited", status.get("Invited", 0)), ("Inactive", status.get("Inactive", 0))],
                   [_section("Accounts", table=table, note=f"Showing the first {ROW_CAP} of {total}." if total > len(rows) else ""), _section("By role", chart=_count_chart("Accounts by role", roles, "pie")), _section("By status", chart=_count_chart("Accounts by status", status, "donut"))],
                   truncated=total > len(rows))


def companies(user: User, f: dict) -> dict:
    _need(user, "companies.manage", "jobs.create", "applications.review", "students.view")
    items, total, _ = content_service.list_companies(CompanyQuery(page_size=ROW_CAP))
    table = _table(["Company", "Tier", "Industry", "Contact", "Jobs", "Active jobs", "Offers"], [[i["company"]["name"], i["company"]["tier"], i["company"]["industry"], i["company"].get("contactName", ""), i["jobCount"], i["activeJobs"], i["offers"]] for i in items])
    tiers: dict[str, int] = {}
    for i in items:
        tiers[i["company"]["tier"].replace("_", " ").capitalize()] = tiers.get(i["company"]["tier"].replace("_", " ").capitalize(), 0) + 1
    return _report("Companies report", [("Companies", total), ("With active jobs", sum(1 for i in items if i["activeJobs"])), ("Total offers", sum(i["offers"] for i in items))],
                   [_section("Companies", table=table, note=f"Showing the first {ROW_CAP} of {total}." if total > len(items) else ""), _section("By tier", chart=_count_chart("Companies by tier", tiers, "pie"))], truncated=total > len(items))


def audit_summary(user: User, f: dict) -> dict:
    _need(user, "audit.view")
    items, total, _ = admin_service.list_audit(AuditQuery(page_size=50, result=f.get("result") or "all"))
    table = _table(["When", "Actor", "Role", "Action", "Resource", "Result"], [[x["at"][:16].replace("T", " "), x["actor"], x["actorRole"], x["action"], x["resource"], x["result"]] for x in items])
    by_action: dict[str, int] = {}
    by_result: dict[str, int] = {}
    for x in items:
        by_action[x["action"].split(".")[0]] = by_action.get(x["action"].split(".")[0], 0) + 1
        by_result[x["result"].capitalize()] = by_result.get(x["result"].capitalize(), 0) + 1
    return _report("Audit activity report", [("Entries in the log", total), ("Shown (latest)", len(items)), ("Denied (shown)", by_result.get("Denied", 0))],
                   [_section("Latest entries", table=table), _section("By area", chart=_count_chart("Audit entries by area", by_action, "bar")), _section("By result", chart=_count_chart("Audit entries by result", by_result, "pie"))], truncated=total > len(items))


STAFF_REPORTS = {"placement_summary": placement_summary, "student_directory": student_directory, "applicants": applicants, "offers": offers, "interviews": interviews, "eligible_students": eligible_report,
                 "user_accounts": user_accounts, "companies": companies, "audit_summary": audit_summary}


def build_staff_report(user: User, report_type: str, filters: dict) -> dict:
    return STAFF_REPORTS[report_type](user, filters)


def my_report(user: User) -> dict:
    from ..student_service import student_of
    s = student_of(user)
    apps, total = applications_service.list_mine(user, ApplicationQuery(page_size=ROW_CAP))
    offs = offers_service.list_mine(user)
    ints, _ = interviews_service.list_interviews(user, InterviewQuery(status="all", page_size=50))
    counts: dict[str, int] = {}
    for v in apps:
        k = v["application"]["status"].replace("_", " ").capitalize()
        counts[k] = counts.get(k, 0) + 1
    a = s.academic
    sections = [
        _section("My applications", table=_table(["Company", "Role", "Status", "Next step", "Applied", "Job deadline"],
                                                   [[v["company"]["name"], v["job"]["title"], v["application"]["status"].replace("_", " "), v.get("nextAction", ""), _date(v["application"]["appliedAt"]), _date(v["job"]["deadline"])] for v in apps]),
                 chart=_count_chart("My applications by status", counts)),
        _section("My offers", table=_table(["Company", "Role", "Package (LPA)", "Status", "Respond by"], [[v["company"]["name"], v["job"]["title"], v["offer"]["ctcLpa"], v["offer"]["status"], _date(v["offer"]["acceptBy"])] for v in offs])) if offs else None,
        _section("My interviews", table=_table(["When", "Company", "Round", "Where", "Status"], [[v["interview"]["at"][:16].replace("T", " "), v["company"]["name"], v["interview"]["round"], v["interview"]["location"], v["interview"]["status"]] for v in ints])) if ints else None,
    ]
    kp = [("Applications", total), ("Active", sum(1 for v in apps if v["application"]["status"] in ("applied", "shortlisted", "interview", "selected"))), ("Offers", len(offs)), ("Placement status", s.placement_status.value.replace("_", " ")),
          ("CGPA", f"{float(a.cgpa):.2f}{'' if a.cgpa_verified else ' (unverified)'}" if a and a.cgpa is not None else "not entered")]
    return _report("My placement report", kp, [x for x in sections if x], f"{user.name} · {s.student_code or ''}".strip(" ·"))
