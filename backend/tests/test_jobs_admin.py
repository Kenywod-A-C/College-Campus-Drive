from datetime import timedelta

import pytest

from app.extensions import db
from app.models import (
    Application, ApplicationStatus, AuditLog, Company, Department, DriveEvent, HiringDrive, Job, JobEligibilityRule, JobStatus, Notification, Role, RoleName, utcnow,
)


def iso(days=0):
    return (utcnow() + timedelta(days=days)).isoformat() + "Z"


def payload(company_id, **over):
    base = {
        "companyId": company_id, "title": "Software Engineer", "domain": "Software", "location": "Chennai", "type": "Full-time", "description": "Build things.",
        "responsibilities": ["Write code", "Review code"], "skills": ["Python", "SQL"],
        "eligibility": {"minCgpa": 7.0, "maxActiveArrears": 0, "departmentIds": [], "graduationYears": [2027], "requiredSkills": ["Python"]},
        "rounds": [{"name": "Online Assessment", "mode": "Online"}, {"name": "Technical Interview", "mode": "On-campus", "location": "Block C"}],
        "ctcLpa": 8.5, "openDate": iso(-1), "deadline": iso(10), "driveDate": iso(15), "status": "draft",
    }
    base.update(over)
    return base


def strip(app, role, *keys):
    with app.app_context():
        r = db.session.query(Role).filter_by(name=RoleName(role)).one()
        r.permissions = [p for p in r.permissions if p.key not in keys]
        db.session.commit()


def dept_ids(client, h, *codes):
    ref = client.get("/api/v1/reference/filters", headers=h).get_json()["data"]["departments"]
    return [int(d["value"]) for d in ref if d["label"] in codes]


@pytest.fixture()
def staff(make, auth):
    make.user("faculty", email="f@campus.test")
    make.user("admin", email="a@campus.test")
    make.user("student", email="s@campus.test")
    return {"company": make.company("Zoho"), "f": auth("f@campus.test"), "s": auth("s@campus.test"), "a": auth("a@campus.test")}


def post(client, h, body):
    return client.post("/api/v1/jobs", headers=h, json=body)


def audit_actions(app):
    with app.app_context():
        return [(a.action, a.result.value) for a in db.session.query(AuditLog).order_by(AuditLog.id)]


# ================================================================== authorisation
def test_unauthenticated_and_students_cannot_manage_jobs(client, staff, make):
    j = make.job(staff["company"])
    body = payload(staff["company"])
    assert client.post("/api/v1/jobs", json=body).status_code == 401
    for method, url, kw in (("post", "/api/v1/jobs", {"json": body}), ("put", f"/api/v1/jobs/{j}", {"json": body}), ("post", f"/api/v1/jobs/{j}/status", {"json": {"status": "closed"}}),
                            ("post", f"/api/v1/jobs/{j}/archive", {"json": {"archived": True}}), ("get", f"/api/v1/jobs/{j}/drive", {})):
        assert getattr(client, method)(url, headers=staff["s"], **kw).status_code == 403, url


def test_creating_a_draft_needs_jobs_create_but_publishing_also_needs_drives_publish(client, staff, app):
    strip(app, "faculty", "drives.publish")
    assert post(client, staff["f"], payload(staff["company"])).status_code == 201
    r = post(client, staff["f"], payload(staff["company"], status="published"))
    assert r.status_code == 403
    with app.app_context():
        assert db.session.query(Job).count() == 1  # nothing was created by the refused request
    assert ("access.denied", "denied") in audit_actions(app)


def test_status_changes_and_archive_need_drives_publish(client, staff, make, app):
    j = make.job(staff["company"], status=JobStatus.DRAFT)
    strip(app, "faculty", "drives.publish")
    assert client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={"status": "closed"}).status_code == 403
    assert client.post(f"/api/v1/jobs/{j}/archive", headers=staff["f"], json={"archived": True}).status_code == 403
    assert client.put(f"/api/v1/jobs/{j}", headers=staff["f"], json=payload(staff["company"], status="draft")).status_code == 200  # but can edit


def test_without_jobs_create_editing_is_refused_even_with_drives_publish(client, staff, make, app):
    j = make.job(staff["company"])
    strip(app, "faculty", "jobs.create")
    assert post(client, staff["f"], payload(staff["company"])).status_code == 403
    assert client.put(f"/api/v1/jobs/{j}", headers=staff["f"], json=payload(staff["company"], status="published")).status_code == 403
    assert client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={"status": "closed"}).status_code == 200


def test_revoking_a_permission_applies_to_an_already_issued_token(client, staff, app):
    assert post(client, staff["f"], payload(staff["company"])).status_code == 201
    strip(app, "faculty", "jobs.create")
    assert post(client, staff["f"], payload(staff["company"])).status_code == 403


# ================================================================== create
def test_create_draft_persists_job_drive_rounds_rule_departments_and_audits(client, staff, app):
    cse_it = dept_ids(client, staff["f"], "CSE", "IT")
    body = payload(staff["company"], eligibility={"minCgpa": 7.5, "maxActiveArrears": 1, "maxArrearHistory": 2, "departmentIds": cse_it, "graduationYears": [2027, 2028], "requiredSkills": ["Python"]})
    r = post(client, staff["f"], body)
    assert r.status_code == 201
    job = r.get_json()["data"]
    assert job["status"] == "draft" and job["title"] == "Software Engineer" and job["companyId"] == str(staff["company"]) and "publishedAt" not in job
    assert job["eligibility"] == {"minCgpa": 7.5, "maxActiveArrears": 1, "maxArrearHistory": 2, "departmentIds": sorted(str(i) for i in cse_it), "graduationYears": [2027, 2028], "requiredSkills": ["Python"]}
    assert [x["name"] for x in job["rounds"]] == ["Online Assessment", "Technical Interview"] and job["rounds"][1]["location"] == "Block C" and job["driveDate"]
    assert client.get(f"/api/v1/jobs/{job['id']}", headers=staff["f"]).get_json()["data"]["job"]["rounds"] == job["rounds"]
    with app.app_context():
        assert db.session.query(HiringDrive).count() == 1 and db.session.query(DriveEvent).count() == 2 and db.session.query(JobEligibilityRule).count() == 1
    assert ("job.create", "success") in audit_actions(app)


def test_drafts_are_invisible_to_students(client, staff):
    j = post(client, staff["f"], payload(staff["company"])).get_json()["data"]["id"]
    assert client.get(f"/api/v1/jobs/{j}", headers=staff["s"]).status_code == 404
    assert client.get("/api/v1/jobs", headers=staff["s"]).get_json()["data"] == []


def test_create_published_is_visible_to_students_with_eligibility(client, staff, app):
    r = post(client, staff["f"], payload(staff["company"], status="published"))
    job = r.get_json()["data"]
    assert r.status_code == 201 and job["status"] == "published" and job["publishedAt"]
    v = client.get(f"/api/v1/jobs/{job['id']}", headers=staff["s"]).get_json()["data"]
    assert v["eligibility"]["state"] == "eligible"
    assert [a for a, _ in audit_actions(app)] == ["auth.login", "auth.login", "auth.login", "job.create", "job.publish"]


def test_a_company_can_have_many_jobs_each_with_its_own_drive(client, staff, app):
    for title in ("Backend", "Frontend", "Backend"):  # duplicate titles are allowed: they are different requisitions
        assert post(client, staff["f"], payload(staff["company"], title=title)).status_code == 201
    with app.app_context():
        assert db.session.query(Job).filter_by(company_id=staff["company"]).count() == 3
        assert db.session.query(HiringDrive).count() == 3 and db.session.query(Company).count() == 1


@pytest.mark.parametrize("patch", [
    {"title": ""}, {"title": "x" * 161}, {"deadline": iso(-5)}, {"eligibility": {"minCgpa": 11}}, {"eligibility": {"minCgpa": -1}},
    {"eligibility": {"minCgpa": 7, "maxActiveArrears": 99}}, {"eligibility": {"minCgpa": 7, "graduationYears": [1999]}}, {"eligibility": {"minCgpa": 7, "extra": 1}},
    {"ctcLpa": -1}, {"ctcLpa": "lots"}, {"rounds": [{"name": ""}]}, {"rounds": [{"name": "x", "mode": "Telepathy"}]}, {"rounds": [{"name": "r"}] * 13},
    {"status": "closed"}, {"status": "archived"}, {"type": "Gig"}, {"openDate": "yesterday"}, {"skills": ["x" * 41]}, {"description": "d" * 8001}, {"unknownField": 1}, {"createdBy": 1},
])
def test_create_validation_rejects_bad_input_without_side_effects(client, staff, app, patch):
    r = post(client, staff["f"], payload(staff["company"], **patch))
    assert r.status_code == 422 and r.get_json()["error"]["code"] == "validation_error", patch
    with app.app_context():
        assert db.session.query(Job).count() == 0 and db.session.query(HiringDrive).count() == 0


def test_unknown_company_or_department_is_422(client, staff):
    assert post(client, staff["f"], payload(99999)).status_code == 422
    r = post(client, staff["f"], payload(staff["company"], eligibility={"minCgpa": 7, "departmentIds": [99999]}))
    assert r.status_code == 422 and "departmentIds" in str(r.get_json()["error"]["details"])


def test_publishing_with_a_past_deadline_is_refused(client, staff, app):
    r = post(client, staff["f"], payload(staff["company"], status="published", openDate=iso(-10), deadline=iso(-1)))
    assert r.status_code == 422 and "deadline" in r.get_json()["error"]["message"].lower()
    with app.app_context():
        assert db.session.query(Job).count() == 0  # the draft that was being created was rolled back with it


def test_creation_is_atomic_when_a_later_step_fails(client, staff, app, monkeypatch):
    from app.services import jobs_admin_service as svc

    def boom(*a, **k):
        raise RuntimeError("disk full")
    monkeypatch.setattr(svc, "_sync_drive", boom)
    app.config["PROPAGATE_EXCEPTIONS"] = False
    r = post(client, staff["f"], payload(staff["company"]))
    assert r.status_code == 500 and r.get_json()["error"]["code"] == "server_error" and "disk full" not in r.get_data(as_text=True)
    with app.app_context():
        assert db.session.query(Job).count() == 0 and db.session.query(JobEligibilityRule).count() == 0 and db.session.query(HiringDrive).count() == 0


# ================================================================== update
def _create(client, staff, **over):
    return post(client, staff["f"], payload(staff["company"], **over)).get_json()["data"]


def test_update_changes_fields_and_audits_which_fields_changed(client, staff, app):
    job = _create(client, staff)
    body = payload(staff["company"], title="Senior Engineer", eligibility={"minCgpa": 8.0, "maxActiveArrears": 0, "departmentIds": [], "graduationYears": [2027], "requiredSkills": ["Python"]}, ctcLpa=12)
    r = client.put(f"/api/v1/jobs/{job['id']}", headers=staff["f"], json=body)
    assert r.status_code == 200 and r.get_json()["data"]["title"] == "Senior Engineer" and r.get_json()["data"]["eligibility"]["minCgpa"] == 8.0
    with app.app_context():
        a = db.session.query(AuditLog).filter_by(action="job.update").one()
        assert a.reason.startswith("Changed:") and all(f in a.reason for f in ("title", "ctcLpa", "eligibility.minCgpa"))
        assert "Build things" not in a.reason  # field names only: values (long descriptions, etc.) are not copied into the log


def test_a_save_with_no_changes_writes_no_update_audit(client, staff, app):
    job = _create(client, staff)
    client.put(f"/api/v1/jobs/{job['id']}", headers=staff["f"], json=payload(staff["company"], openDate=job["openDate"], deadline=job["deadline"], driveDate=job["driveDate"]))
    assert "job.update" not in [a for a, _ in audit_actions(app)]


def test_rounds_can_be_added_removed_and_reordered(client, staff):
    job = _create(client, staff)
    ids = [r["id"] for r in job["rounds"]]
    three = payload(staff["company"], rounds=[{"name": "A"}, {"name": "B", "mode": "Virtual"}, {"name": "C"}])
    got = client.put(f"/api/v1/jobs/{job['id']}", headers=staff["f"], json=three).get_json()["data"]["rounds"]
    assert [r["name"] for r in got] == ["A", "B", "C"] and got[1]["mode"] == "Virtual" and got[0]["id"] == ids[0]  # existing positions keep their ids
    one = client.put(f"/api/v1/jobs/{job['id']}", headers=staff["f"], json=payload(staff["company"], rounds=[{"name": "Only"}])).get_json()["data"]["rounds"]
    assert [r["name"] for r in one] == ["Only"]
    assert client.put(f"/api/v1/jobs/{job['id']}", headers=staff["f"], json=payload(staff["company"], rounds=[])).get_json()["data"]["rounds"] == []


def test_url_is_authoritative_over_a_body_id(client, staff, make):
    mine, other = _create(client, staff), _create(client, staff, title="Other")
    client.put(f"/api/v1/jobs/{mine['id']}", headers=staff["f"], json={**payload(staff["company"], title="Edited"), "id": other["id"]})
    assert client.get(f"/api/v1/jobs/{other['id']}", headers=staff["f"]).get_json()["data"]["job"]["title"] == "Other"
    assert client.get(f"/api/v1/jobs/{mine['id']}", headers=staff["f"]).get_json()["data"]["job"]["title"] == "Edited"


def test_unknown_or_malformed_job_ids(client, staff):
    assert client.put("/api/v1/jobs/99999", headers=staff["f"], json=payload(staff["company"])).status_code == 404
    assert client.put("/api/v1/jobs/abc", headers=staff["f"], json=payload(staff["company"])).status_code == 404
    assert client.post("/api/v1/jobs/99999/status", headers=staff["f"], json={"status": "closed"}).status_code == 404


def test_published_jobs_stay_editable_and_students_see_new_rules_immediately(client, staff, make):
    job = _create(client, staff, status="published")
    hs = staff["s"]
    assert client.post("/api/v1/applications", headers=hs, json={"jobId": int(job["id"])}).status_code == 201
    stricter = payload(staff["company"], status="published", eligibility={"minCgpa": 9.9, "maxActiveArrears": 0, "departmentIds": [], "graduationYears": [2027], "requiredSkills": []})
    assert client.put(f"/api/v1/jobs/{job['id']}", headers=staff["f"], json=stricter).status_code == 200
    v = client.get(f"/api/v1/jobs/{job['id']}", headers=hs).get_json()["data"]
    assert v["eligibility"]["state"] == "not_eligible"  # eligibility is always evaluated against the current rule...
    app_snapshot = client.get("/api/v1/applications/me", headers=hs).get_json()["data"][0]["application"]["eligibilitySnapshot"]
    assert app_snapshot["state"] == "eligible"  # ...while the existing application keeps the snapshot taken when they applied


def test_closed_cancelled_and_archived_jobs_cannot_be_edited(client, staff, make):
    c = staff["company"]
    for status in (JobStatus.CLOSED, JobStatus.CANCELLED):
        j = make.job(c, status=status)
        r = client.put(f"/api/v1/jobs/{j}", headers=staff["f"], json=payload(c))
        assert r.status_code == 409 and status.value in r.get_json()["error"]["message"]
    d = make.job(c, status=JobStatus.DRAFT)
    client.post(f"/api/v1/jobs/{d}/archive", headers=staff["f"], json={"archived": True})
    assert client.put(f"/api/v1/jobs/{d}", headers=staff["f"], json=payload(c)).status_code == 409


def test_company_of_a_job_can_change_only_while_it_is_an_untouched_draft(client, staff, make):
    other = make.company("TCS")
    draft = _create(client, staff)
    assert client.put(f"/api/v1/jobs/{draft['id']}", headers=staff["f"], json=payload(other)).get_json()["data"]["companyId"] == str(other)
    pub = _create(client, staff, status="published")
    assert client.put(f"/api/v1/jobs/{pub['id']}", headers=staff["f"], json=payload(other, status="published")).status_code == 409


def test_editing_a_shared_drive_never_changes_the_other_jobs_drive(client, staff, make, app):
    a, b = _create(client, staff, title="A"), _create(client, staff, title="B")
    with app.app_context():  # force two jobs onto one drive (the model allows it)
        ja, jb = db.session.get(Job, int(a["id"])), db.session.get(Job, int(b["id"]))
        jb.drive_id = ja.drive_id
        db.session.commit()
    new_date = iso(40)
    client.put(f"/api/v1/jobs/{a['id']}", headers=staff["f"], json=payload(staff["company"], title="A", driveDate=new_date, rounds=[{"name": "Solo"}]))
    got_b = client.get(f"/api/v1/jobs/{b['id']}", headers=staff["f"]).get_json()["data"]["job"]
    assert got_b["driveDate"] == a["driveDate"] and [r["name"] for r in got_b["rounds"]] == ["Online Assessment", "Technical Interview"]


# ================================================================== lifecycle (state machine)
ALL = [JobStatus.DRAFT, JobStatus.PUBLISHED, JobStatus.CLOSED, JobStatus.CANCELLED]
VALID = {(JobStatus.DRAFT, JobStatus.PUBLISHED), (JobStatus.DRAFT, JobStatus.CANCELLED), (JobStatus.PUBLISHED, JobStatus.DRAFT), (JobStatus.PUBLISHED, JobStatus.CLOSED),
         (JobStatus.PUBLISHED, JobStatus.CANCELLED), (JobStatus.CLOSED, JobStatus.PUBLISHED)}


@pytest.mark.parametrize("src", ALL)
@pytest.mark.parametrize("dst", ALL)
def test_every_status_transition(client, staff, make, src, dst):
    j = make.job(staff["company"], status=src)
    r = client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={"status": dst.value, "reason": "company withdrew"})
    if src == dst:
        assert r.status_code == 200  # no-op
    elif (src, dst) in VALID:
        assert r.status_code == 200 and r.get_json()["data"]["status"] == dst.value
    else:
        assert r.status_code == 409 and "cannot become" in r.get_json()["error"]["message"]


def test_cancel_requires_a_reason_notifies_only_active_applicants_and_audits_it(client, staff, make, app):
    j = make.job(staff["company"])
    active, rejected, withdrawn = make.user("student", email="a1@campus.test"), make.user("student", email="a2@campus.test"), make.user("student", email="a3@campus.test")
    make.application(active, j), make.application(rejected, j, ApplicationStatus.REJECTED), make.application(withdrawn, j, ApplicationStatus.WITHDRAWN)
    for bad in ({"status": "cancelled"}, {"status": "cancelled", "reason": "  "}, {"status": "cancelled", "reason": "x"}):
        assert client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json=bad).status_code == 422
    r = client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={"status": "cancelled", "reason": "Company froze hiring"})
    assert r.status_code == 200
    with app.app_context():
        notes = db.session.query(Notification).filter(Notification.title.like("%drive cancelled")).all()
        assert len(notes) == 1 and "Company froze hiring" in notes[0].body
        assert db.session.query(AuditLog).filter_by(action="job.cancel").one().reason == "Company froze hiring"


def test_publish_and_reopen_need_a_future_deadline_and_an_active_company(client, staff, make, app):
    c = staff["company"]
    expired_draft = make.job(c, status=JobStatus.DRAFT, deadline_days=-1)
    r = client.post(f"/api/v1/jobs/{expired_draft}/status", headers=staff["f"], json={"status": "published"})
    assert r.status_code == 422 and "deadline" in r.get_json()["error"]["message"].lower()
    expired_closed = make.job(c, status=JobStatus.CLOSED, deadline_days=-1)
    assert client.post(f"/api/v1/jobs/{expired_closed}/status", headers=staff["f"], json={"status": "published"}).status_code == 422
    fine = make.job(c, status=JobStatus.DRAFT)
    with app.app_context():
        db.session.get(Company, c).archived_at = utcnow()
        db.session.commit()
    r = client.post(f"/api/v1/jobs/{fine}/status", headers=staff["f"], json={"status": "published"})
    assert r.status_code == 409 and "archived" in r.get_json()["error"]["message"]


def test_unpublish_is_refused_once_anyone_has_applied_and_is_atomic_with_the_edit(client, staff, make, app):
    job = _create(client, staff, status="published")
    make.application(make.user("student", email="x@campus.test"), int(job["id"]), ApplicationStatus.WITHDRAWN)  # even a withdrawn application counts
    r = client.post(f"/api/v1/jobs/{job['id']}/status", headers=staff["f"], json={"status": "draft"})
    assert r.status_code == 409 and "Close it instead" in r.get_json()["error"]["message"]
    # the same rule applies when the form asks for it, and the other edits in that request are rolled back too
    r = client.put(f"/api/v1/jobs/{job['id']}", headers=staff["f"], json=payload(staff["company"], title="Renamed", status="draft"))
    assert r.status_code == 409
    assert client.get(f"/api/v1/jobs/{job['id']}", headers=staff["f"]).get_json()["data"]["job"]["title"] == "Software Engineer"


def test_unpublish_without_applications_returns_the_job_to_draft_and_hides_it(client, staff):
    job = _create(client, staff, status="published")
    r = client.post(f"/api/v1/jobs/{job['id']}/status", headers=staff["f"], json={"status": "draft"})
    assert r.status_code == 200 and r.get_json()["data"]["status"] == "draft"
    assert client.get(f"/api/v1/jobs/{job['id']}", headers=staff["s"]).status_code == 404  # students can no longer see it


def test_status_validation_and_audit_trail(client, staff, make, app):
    j = make.job(staff["company"])
    assert client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={"status": "archived"}).status_code == 422
    assert client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={}).status_code == 422
    assert client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={"status": "closed", "extra": 1}).status_code == 422
    client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={"status": "closed"})
    client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={"status": "published"})
    assert [a for a, _ in audit_actions(app) if a.startswith("job.")] == ["job.close", "job.reopen"]


def test_closing_a_job_stops_new_applications(client, staff):
    job = _create(client, staff, status="published")
    client.post(f"/api/v1/jobs/{job['id']}/status", headers=staff["f"], json={"status": "closed"})
    r = client.post("/api/v1/applications", headers=staff["s"], json={"jobId": int(job["id"])})
    assert r.status_code == 409


# ================================================================== archive
def test_only_non_live_jobs_can_be_archived_and_archived_jobs_are_hidden_by_default(client, staff, make):
    c = staff["company"]
    pub, closed = make.job(c, "Live"), make.job(c, "Done", status=JobStatus.CLOSED)
    assert client.post(f"/api/v1/jobs/{pub}/archive", headers=staff["f"], json={"archived": True}).status_code == 409
    r = client.post(f"/api/v1/jobs/{closed}/archive", headers=staff["f"], json={"archived": True})
    assert r.status_code == 200 and r.get_json()["data"]["archivedAt"]
    names = lambda **q: sorted(v["job"]["title"] for v in client.get("/api/v1/jobs", headers=staff["f"], query_string=q).get_json()["data"])  # noqa: E731
    assert names() == ["Live"] and names(archived="include") == ["Done", "Live"] and names(archived="only") == ["Done"]
    assert client.get("/api/v1/jobs?archived=maybe", headers=staff["f"]).status_code == 422
    assert client.post(f"/api/v1/jobs/{closed}/status", headers=staff["f"], json={"status": "published"}).status_code == 409  # archived: restore first
    r = client.post(f"/api/v1/jobs/{closed}/archive", headers=staff["f"], json={"archived": False})
    assert r.status_code == 200 and "archivedAt" not in r.get_json()["data"] and names() == ["Done", "Live"]


def test_archive_is_audited_and_idempotent(client, staff, make, app):
    j = make.job(staff["company"], status=JobStatus.CANCELLED)
    for _ in range(2):
        assert client.post(f"/api/v1/jobs/{j}/archive", headers=staff["f"], json={"archived": True}).status_code == 200
    assert [a for a, _ in audit_actions(app) if a.startswith("job.")] == ["job.archive"]
    assert client.post(f"/api/v1/jobs/{j}/archive", headers=staff["f"], json={"archived": "yes"}).status_code == 422


def test_students_keep_seeing_their_own_archived_history_but_cannot_apply(client, staff, make):
    u = make.user("student", email="h@campus.test")
    j = make.job(staff["company"], status=JobStatus.CLOSED)
    make.application(u, j)
    client.post(f"/api/v1/jobs/{j}/archive", headers=staff["f"], json={"archived": True})
    h = staff["s"]  # a different student: sees nothing
    assert client.get("/api/v1/jobs", headers=h).get_json()["data"] == []
    mine = client.post("/api/v1/auth/login", json={"identifier": "h@campus.test", "password": "Str0ngPass1"}).get_json()["data"]["accessToken"]
    assert len(client.get("/api/v1/jobs?tab=applied", headers={"Authorization": f"Bearer {mine}"}).get_json()["data"]) == 1


def test_company_archive_rules(client, staff, make):
    c = staff["company"]
    j = make.job(c)
    r = client.post(f"/api/v1/companies/{c}/archive", headers=staff["f"], json={"archived": True})
    assert r.status_code == 409 and "published job" in r.get_json()["error"]["message"]
    client.post(f"/api/v1/jobs/{j}/status", headers=staff["f"], json={"status": "closed"})
    assert client.post(f"/api/v1/companies/{c}/archive", headers=staff["f"], json={"archived": True}).status_code == 200
    listed = lambda **q: [r["company"]["name"] for r in client.get("/api/v1/companies", headers=staff["f"], query_string=q).get_json()["data"]]  # noqa: E731
    assert listed() == [] and listed(archived="only") == ["Zoho"] and listed(archived="include") == ["Zoho"]
    assert post(client, staff["f"], payload(c)).status_code == 422  # cannot add jobs to an archived company
    body = {"name": "Zoho", "website": "https://zoho.example.com", "industry": "SaaS"}
    assert client.put(f"/api/v1/companies/{c}", headers=staff["f"], json=body).status_code == 409
    ref = client.get("/api/v1/reference/filters", headers=staff["f"]).get_json()["data"]
    assert ref["companies"] == [] and ref["jobs"] == []
    assert client.post(f"/api/v1/companies/{c}/archive", headers=staff["f"], json={"archived": False}).status_code == 200
    assert listed() == ["Zoho"]


def test_company_archive_permission_and_audit(client, staff, app):
    c = staff["company"]
    assert client.post(f"/api/v1/companies/{c}/archive", headers=staff["s"], json={"archived": True}).status_code == 403
    strip(app, "faculty", "companies.manage")
    assert client.post(f"/api/v1/companies/{c}/archive", headers=staff["f"], json={"archived": True}).status_code == 403
    assert client.post(f"/api/v1/companies/{c}/archive", headers=staff["a"], json={"archived": True}).status_code == 200
    assert ("company.archive", "success") in audit_actions(app)


# ================================================================== drive details
def test_drive_detail_aggregates_without_exposing_students(client, staff, make):
    c = staff["company"]
    j = make.job(c, "Drive", min_cgpa=7.0)
    eligible_student, weak = make.user("student", cgpa=9.0), make.user("student", cgpa=5.0)
    for st, status in ((ApplicationStatus.APPLIED), (ApplicationStatus.SHORTLISTED)), :
        pass
    make.application(eligible_student, j, ApplicationStatus.SHORTLISTED)
    make.application(weak, j, ApplicationStatus.REJECTED)
    d = client.get(f"/api/v1/jobs/{j}/drive", headers=staff["f"]).get_json()["data"]
    assert d["counts"] == {"applied": 2, "shortlisted": 1, "interview": 0, "selected": 0, "offers": 0, "rejected": 1}
    assert d["eligibleStudents"] == 2  # the seeded 'student@' (8.4) and eligible_student (9.0); weak (5.0) is not
    assert d["view"]["job"]["title"] == "Drive" and d["view"]["applicantCount"] == 2 and d["interviews"] == [] and d["documents"] == []
    assert "email" not in str(d) and "@campus.test" not in str(d)  # aggregate only: no student identities


def test_drive_detail_404_and_archived_jobs_are_readable(client, staff, make):
    assert client.get("/api/v1/jobs/99999/drive", headers=staff["f"]).status_code == 404
    j = make.job(staff["company"], status=JobStatus.CLOSED)
    client.post(f"/api/v1/jobs/{j}/archive", headers=staff["f"], json={"archived": True})
    assert client.get(f"/api/v1/jobs/{j}/drive", headers=staff["f"]).status_code == 200
