from datetime import timedelta

import pytest

from app.extensions import db
from app.models import ApplicationStatus, AuditLog, JobStatus, Notification, NotificationKind, OfferStatus, Role, RoleName, utcnow


# ---------------- notifications
def _note(app, user_id, title="Hello", read=False):
    with app.app_context():
        n = Notification(user_id=user_id, title=title, body="b", kind=NotificationKind.SYSTEM, is_read=read)
        db.session.add(n)
        db.session.commit()
        return n.id


def test_notifications_are_scoped_to_the_caller(client, make, auth, app):
    a, b = make.user("student", email="a@campus.test"), make.user("student", email="b@campus.test")
    na, nb = _note(app, a, "for A"), _note(app, b, "for B")
    ha = auth("a@campus.test")
    assert [n["title"] for n in client.get("/api/v1/notifications", headers=ha).get_json()["data"]] == ["for A"]
    assert client.post(f"/api/v1/notifications/{nb}/read", headers=ha).status_code == 404  # B's notification is invisible to A
    r = client.post(f"/api/v1/notifications/{na}/read", headers=ha)
    assert r.status_code == 200 and r.get_json()["data"]["read"] is True
    with app.app_context():
        assert db.session.get(Notification, nb).is_read is False


def test_mark_all_read_only_touches_own_rows(client, make, auth, app):
    a, b = make.user("student", email="a@campus.test"), make.user("student", email="b@campus.test")
    _note(app, a)
    _note(app, a)
    nb = _note(app, b)
    assert client.post("/api/v1/notifications/read-all", headers=auth("a@campus.test")).status_code == 200
    with app.app_context():
        assert db.session.query(Notification).filter_by(user_id=a, is_read=False).count() == 0
        assert db.session.get(Notification, nb).is_read is False


def test_notification_preferences_roundtrip_and_validation(client, make, auth):
    make.user("student", email="a@campus.test")
    h = auth("a@campus.test")
    d = client.get("/api/v1/notifications/preferences", headers=h).get_json()["data"]
    assert d == {"email": True, "push": False, "driveReminders": True, "deadlineReminders": True, "interviewAlerts": True, "offerUpdates": True}
    new = {**d, "email": False, "push": True}
    assert client.put("/api/v1/notifications/preferences", headers=h, json=new).get_json()["data"] == new
    assert client.get("/api/v1/notifications/preferences", headers=h).get_json()["data"] == new
    assert client.put("/api/v1/notifications/preferences", headers=h, json={"email": "yes"}).status_code == 422


# ---------------- reminders
def test_reminder_crud_and_ownership(client, make, auth):
    c = make.company("Zoho")
    make.user("student", email="a@campus.test")
    make.user("student", email="b@campus.test")
    job = make.job(c, "Dev")
    ha, hb = auth("a@campus.test"), auth("b@campus.test")
    when = (utcnow() + timedelta(days=3)).isoformat() + "Z"
    r = client.post("/api/v1/reminders", headers=ha, json={"title": "Update resume", "at": when, "jobId": job})
    assert r.status_code == 201
    rem = r.get_json()["data"]
    assert rem["kind"] == "drive" and rem["jobId"] == str(job) and rem["done"] is False
    listed = client.get("/api/v1/reminders", headers=ha).get_json()["data"]
    assert listed[0]["jobTitle"] == "Dev" and listed[0]["companyName"] == "Zoho"
    assert client.get("/api/v1/reminders", headers=hb).get_json()["data"] == []
    rid = rem["id"]
    assert client.post(f"/api/v1/reminders/{rid}/toggle", headers=hb).status_code == 404
    assert client.put(f"/api/v1/reminders/{rid}", headers=hb, json={"title": "x", "at": when}).status_code == 404
    assert client.delete(f"/api/v1/reminders/{rid}", headers=hb).status_code == 404
    assert client.post(f"/api/v1/reminders/{rid}/toggle", headers=ha).get_json()["data"]["done"] is True
    upd = client.put(f"/api/v1/reminders/{rid}", headers=ha, json={"title": "Renamed", "at": when}).get_json()["data"]
    assert upd["title"] == "Renamed" and upd["kind"] == "custom" and "jobId" not in upd
    assert client.delete(f"/api/v1/reminders/{rid}", headers=ha).status_code == 200
    assert client.get("/api/v1/reminders", headers=ha).get_json()["data"] == []


def test_reminder_validation(client, make, auth):
    make.user("student", email="a@campus.test")
    h = auth("a@campus.test")
    when = "2030-01-01T10:00:00Z"
    for bad in ({"title": "", "at": when}, {"title": "x", "at": "not-a-date"}, {"title": "x" * 201, "at": when}, {"title": "x", "at": when, "kind": "weird"}, {"title": "x", "at": when, "owner": 5}):
        assert client.post("/api/v1/reminders", headers=h, json=bad).status_code == 422, bad
    assert client.post("/api/v1/reminders", headers=h, json={"title": "x", "at": when, "jobId": 99999}).status_code == 422
    draft = make.job(make.company(), "Secret", status=JobStatus.DRAFT)
    assert client.post("/api/v1/reminders", headers=h, json={"title": "x", "at": when, "jobId": draft}).status_code == 422  # drafts are not linkable


def test_reminder_times_roundtrip_as_utc(client, make, auth):
    make.user("student", email="a@campus.test")
    h = auth("a@campus.test")
    r = client.post("/api/v1/reminders", headers=h, json={"title": "tz", "at": "2030-05-01T09:00:00+05:30"}).get_json()["data"]
    assert r["at"] == "2030-05-01T03:30:00Z"


# ---------------- companies
COMPANY = {"name": "Nimbus Labs", "website": "https://nimbus.example.com", "industry": "SaaS", "description": "d", "contactName": "A", "contactEmail": "hr@nimbus.example.com", "tier": "dream"}


def test_company_permissions_crud_and_duplicates(client, make, auth, app):
    make.user("faculty", email="f@campus.test")
    make.user("student", email="s@campus.test")
    hs, hf = auth("s@campus.test"), auth("f@campus.test")
    assert client.get("/api/v1/companies", headers=hs).status_code == 403
    assert client.post("/api/v1/companies", headers=hs, json=COMPANY).status_code == 403
    r = client.post("/api/v1/companies", headers=hf, json=COMPANY)
    assert r.status_code == 201 and r.get_json()["data"]["tier"] == "dream"
    cid = r.get_json()["data"]["id"]
    dup = client.post("/api/v1/companies", headers=hf, json={**COMPANY, "name": "nimbus labs"})  # case-insensitive duplicate
    assert dup.status_code == 409 and "Add a new job" in dup.get_json()["error"]["message"]
    up = client.put(f"/api/v1/companies/{cid}", headers=hf, json={**COMPANY, "industry": "Cloud"})
    assert up.status_code == 200 and up.get_json()["data"]["industry"] == "Cloud"
    page = client.get("/api/v1/companies?q=nimbus", headers=hf).get_json()
    assert page["meta"]["total"] == 1 and "Cloud" in page["meta"]["industries"] and page["data"][0]["company"]["name"] == "Nimbus Labs"
    d = client.get(f"/api/v1/companies/{cid}", headers=hf).get_json()["data"]
    assert d["company"]["id"] == cid and d["jobs"] == []
    with app.app_context():
        assert {a.action for a in db.session.query(AuditLog)} >= {"company.create", "company.update", "access.denied"}


@pytest.mark.parametrize("bad", [{"name": ""}, {"website": "ftp://x"}, {"website": "javascript:alert(1)"}, {"tier": "gold"}, {"contactEmail": "nope"}, {"color": "red"}, {"extra": 1}])
def test_company_validation(client, make, auth, bad):
    make.user("faculty", email="f@campus.test")
    assert client.post("/api/v1/companies", headers=auth("f@campus.test"), json={**COMPANY, **bad}).status_code == 422


def test_company_counts_and_one_company_many_jobs(client, make, auth):
    make.user("faculty", email="f@campus.test")
    c = make.company("Zoho")
    make.job(c, "A"), make.job(c, "B"), make.job(c, "C", status=JobStatus.CLOSED)
    row = client.get("/api/v1/companies", headers=auth("f@campus.test")).get_json()["data"][0]
    assert row["jobCount"] == 3 and row["activeJobs"] == 2


# ---------------- reference + dashboards
def test_reference_filters_hide_drafts_from_students(client, make, auth):
    c = make.company("Zoho")
    make.user("student", email="s@campus.test")
    make.user("faculty", email="f@campus.test")
    make.job(c, "Open"), make.job(c, "Draft", status=JobStatus.DRAFT)
    s = client.get("/api/v1/reference/filters", headers=auth("s@campus.test")).get_json()["data"]
    f = client.get("/api/v1/reference/filters", headers=auth("f@campus.test")).get_json()["data"]
    assert [j["label"] for j in s["jobs"]] == ["Zoho — Open"] and len(f["jobs"]) == 2
    assert {d["label"] for d in s["departments"]} >= {"CSE", "IT", "AI&DS"} and s["graduationYears"][0]["value"] in {"2028", "2027", "2026"}
    assert client.get("/api/v1/reference/filters").status_code == 401


def test_faculty_dashboard_numbers(client, make, auth):
    c = make.company()
    make.user("faculty", email="f@campus.test")
    a, b = make.user("student", cgpa=8.5), make.user("student", cgpa=5.0)
    j = make.job(c, "Role", min_cgpa=7.0)
    app_a = make.application(a, j)
    make.application(b, j, ApplicationStatus.SHORTLISTED)
    make.offer(app_a, status=OfferStatus.ACCEPTED)
    d = client.get("/api/v1/faculty/dashboard", headers=auth("f@campus.test")).get_json()["data"]
    m = d["metrics"]
    assert m["totalCompanies"] == 1 and m["activeJobs"] == 1 and m["totalApplications"] == 2 and m["shortlisted"] == 1 and m["offers"] == 1 and m["eligibleStudents"] == 1
    assert {s["status"]: s["count"] for s in d["statusDist"]}["Shortlisted"] == 1
    assert next(x for x in d["deptChart"] if x["dept"] == "CSE") == {"dept": "CSE", "placed": 1, "notPlaced": 1, "students": 2}
    assert d["nearingDeadline"] and d["upcomingDrives"] and len(d["recentApplications"]) == 2
    filtered = client.get("/api/v1/faculty/dashboard?dept=999", headers=auth("f@campus.test")).get_json()["data"]
    assert filtered["metrics"]["totalApplications"] == 0
    assert client.get("/api/v1/faculty/dashboard?days=0", headers=auth("f@campus.test")).status_code == 422


def test_dashboards_are_role_gated(client, make, auth):
    make.user("student", email="s@campus.test")
    make.user("faculty", email="f@campus.test")
    make.user("admin", email="a@campus.test")
    assert client.get("/api/v1/faculty/dashboard", headers=auth("s@campus.test")).status_code == 403
    assert client.get("/api/v1/admin/dashboard", headers=auth("f@campus.test")).status_code == 403
    assert client.get("/api/v1/admin/dashboard", headers=auth("s@campus.test")).status_code == 403
    d = client.get("/api/v1/admin/dashboard", headers=auth("a@campus.test")).get_json()["data"]
    assert d["metrics"]["totalUsers"] == 3 and d["metrics"]["activeStudents"] == 1 and d["metrics"]["facultyAccounts"] == 1
    assert d["placement"]["totalStudents"] == 1 and isinstance(d["alerts"], list) and isinstance(d["activity"], list)
    assert client.get("/api/v1/admin/dashboard").status_code == 401


# ---------------- audit log + RBAC internals
def test_audit_log_rows_cannot_be_modified_or_deleted(app):
    from app.models import AuditResult

    with app.app_context():
        row = AuditLog(actor_name="x", actor_role="system", action="t", resource="r", result=AuditResult.SUCCESS)
        db.session.add(row)
        db.session.commit()
        row.reason = "tampered"
        with pytest.raises(PermissionError):
            db.session.commit()
        db.session.rollback()
        db.session.delete(db.session.get(AuditLog, row.id))
        with pytest.raises(PermissionError):
            db.session.commit()
        db.session.rollback()


def test_denied_access_is_written_to_the_audit_log(client, make, auth, app):
    make.user("student", email="s@campus.test")
    assert client.get("/api/v1/companies", headers=auth("s@campus.test")).status_code == 403
    with app.app_context():
        row = db.session.query(AuditLog).filter_by(action="access.denied").one()
        assert row.result.value == "denied" and row.actor_role == "student"


def test_a_role_change_takes_effect_on_the_next_request(client, make, auth, app):
    make.user("faculty", email="f@campus.test")
    h = auth("f@campus.test")
    assert client.get("/api/v1/companies", headers=h).status_code == 200
    with app.app_context():
        role = db.session.query(Role).filter_by(name=RoleName.FACULTY).one()
        role.permissions = []
        db.session.commit()
    assert client.get("/api/v1/companies", headers=h).status_code == 403
    me = client.get("/api/v1/auth/me", headers=h).get_json()["data"]
    assert me["permissions"] == []


def test_unexpected_errors_do_not_leak_internals(client, make, auth, app, monkeypatch):
    make.user("student", email="s@campus.test")
    h = auth("s@campus.test")
    from app.services import jobs_service

    def boom(*a, **k):
        raise RuntimeError("SELECT secret FROM somewhere /home/user/app.py")

    monkeypatch.setattr(jobs_service, "list_jobs", boom)
    app.config["PROPAGATE_EXCEPTIONS"] = False
    r = client.get("/api/v1/jobs", headers=h)
    assert r.status_code == 500 and r.get_json()["error"]["code"] == "server_error"
    assert "secret" not in r.get_data(as_text=True) and "/home" not in r.get_data(as_text=True)
