from datetime import timedelta

from app.extensions import db
from app.models import Application, ApplicationStatus, AuditLog, Job, JobStatus, Notification, PlacementPolicy, PolicyKind, utcnow


def apply(client, h, job_id):
    return client.post("/api/v1/applications", headers=h, json={"jobId": job_id})


def test_apply_success_creates_everything_atomically(client, make, auth, app):
    c = make.company("Zoho")
    make.user("student", email="s@campus.test", cgpa=8.0)
    j = make.job(c, "Dev", min_cgpa=7.0)
    r = apply(client, auth("s@campus.test"), j)
    assert r.status_code == 201
    v = r.get_json()["data"]
    a = v["application"]
    assert a["status"] == "applied" and a["jobId"] == str(j) and a["history"][0]["note"] == "Application submitted"
    assert a["eligibilitySnapshot"]["state"] == "eligible" and a["eligibilitySnapshot"]["checks"]
    assert v["job"]["title"] == "Dev" and v["company"]["name"] == "Zoho" and v["nextAction"] == "Awaiting screening"
    assert "student" not in v  # students never get the staff-only student block
    with app.app_context():
        assert db.session.query(Notification).filter_by(title="Application submitted — Zoho").count() == 1
        assert db.session.query(AuditLog).filter_by(action="application.create", result="success").count() == 1
        assert db.session.query(Application).count() == 1


def test_apply_twice_is_a_conflict(client, make, auth):
    make.user("student", email="s@campus.test")
    j = make.job(make.company())
    h = auth("s@campus.test")
    assert apply(client, h, j).status_code == 201
    r = apply(client, h, j)
    assert r.status_code == 409 and "already applied" in r.get_json()["error"]["message"]


def test_reapply_after_withdrawal_is_allowed(client, make, auth):
    make.user("student", email="s@campus.test")
    j = make.job(make.company())
    h = auth("s@campus.test")
    app_id = apply(client, h, j).get_json()["data"]["application"]["id"]
    assert client.post(f"/api/v1/applications/{app_id}/withdraw", headers=h).status_code == 200
    assert apply(client, h, j).status_code == 201


def test_server_revalidates_closed_expired_cancelled_and_draft_jobs(client, make, auth):
    make.user("student", email="s@campus.test")
    c = make.company()
    h = auth("s@campus.test")
    closed = apply(client, h, make.job(c, "Closed", status=JobStatus.CLOSED))
    assert closed.status_code == 409 and "closed" in closed.get_json()["error"]["message"]
    assert apply(client, h, make.job(c, "Cancelled", status=JobStatus.CANCELLED)).status_code == 409
    expired = apply(client, h, make.job(c, "Expired", deadline_days=-1))
    assert expired.status_code == 409 and "deadline" in expired.get_json()["error"]["message"]
    assert apply(client, h, make.job(c, "Draft", status=JobStatus.DRAFT)).status_code == 404
    assert apply(client, h, 424242).status_code == 404


def test_ineligible_applicants_are_refused_with_reasons_and_audited(client, make, auth, app):
    make.user("student", email="s@campus.test", cgpa=6.0)
    j = make.job(make.company(), min_cgpa=8.0)
    r = apply(client, auth("s@campus.test"), j)
    assert r.status_code == 403 and "cgpa" in r.get_json()["error"]["message"].lower()
    with app.app_context():
        assert db.session.query(Application).count() == 0
        assert db.session.query(AuditLog).filter_by(action="application.create", result="denied").count() == 1


def test_unverified_or_incomplete_profiles_cannot_apply(client, make, auth):
    make.user("student", email="v@campus.test", verified=False)
    make.user("student", email="n@campus.test", cgpa=None)
    j = make.job(make.company())
    v = apply(client, auth("v@campus.test"), j)
    assert v.status_code == 403 and "awaiting verification" in v.get_json()["error"]["message"]
    n = apply(client, auth("n@campus.test"), j)
    assert n.status_code == 403 and "Profile incomplete" in n.get_json()["error"]["message"]


def test_only_students_can_apply_and_unauthenticated_cannot(client, make, auth):
    make.user("faculty", email="f@campus.test")
    j = make.job(make.company())
    assert client.post("/api/v1/applications", json={"jobId": j}).status_code == 401
    assert apply(client, auth("f@campus.test"), j).status_code == 403


def test_request_body_validation(client, make, auth):
    make.user("student", email="s@campus.test")
    h = auth("s@campus.test")
    for body in ({}, {"jobId": "abc"}, {"jobId": 1, "studentId": 2}, {"jobId": -1, "status": "selected"}):
        assert client.post("/api/v1/applications", headers=h, json=body).status_code == 422


def test_application_limit_policy(client, make, auth, app):
    c = make.company()
    make.user("student", email="s@campus.test")
    with app.app_context():
        p = db.session.query(PlacementPolicy).filter_by(kind=PolicyKind.APPLICATION_LIMIT).one()
        p.params = {"maxActiveApplications": 2}
        db.session.commit()
    h = auth("s@campus.test")
    assert apply(client, h, make.job(c, "A")).status_code == 201
    assert apply(client, h, make.job(c, "B")).status_code == 201
    r = apply(client, h, make.job(c, "C"))
    assert r.status_code == 409 and "at most 2" in r.get_json()["error"]["message"]


def test_my_applications_listing_filters_and_isolation(client, make, auth):
    c = make.company("Zoho")
    a, b = make.user("student", email="a@campus.test"), make.user("student", email="b@campus.test")
    ja, jb = make.job(c, "Alpha"), make.job(make.company("TCS"), "Beta")
    make.application(a, ja)
    make.application(a, jb, ApplicationStatus.SHORTLISTED)
    make.application(b, ja)
    ha = auth("a@campus.test")
    r = client.get("/api/v1/applications/me", headers=ha).get_json()
    assert r["meta"]["total"] == 2 and {v["job"]["title"] for v in r["data"]} == {"Alpha", "Beta"}
    assert [v["job"]["title"] for v in client.get("/api/v1/applications/me?status=shortlisted", headers=ha).get_json()["data"]] == ["Beta"]
    assert [v["job"]["title"] for v in client.get("/api/v1/applications/me?q=zoho", headers=ha).get_json()["data"]] == ["Alpha"]
    assert client.get("/api/v1/applications/me?status=hacked", headers=ha).status_code == 422


def test_idor_other_students_application_is_forbidden_and_audited(client, make, auth, app):
    a, b = make.user("student", email="a@campus.test"), make.user("student", email="b@campus.test")
    app_a = make.application(a, make.job(make.company()))
    hb = auth("b@campus.test")
    r = client.get(f"/api/v1/applications/{app_a}", headers=hb)
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "forbidden"
    assert "Alpha" not in str(r.get_json())  # nothing about the record leaks
    assert client.post(f"/api/v1/applications/{app_a}/withdraw", headers=hb).status_code == 404  # cannot even confirm it exists
    with app.app_context():
        assert db.session.query(AuditLog).filter_by(action="application.read", result="denied").count() == 1
        assert db.session.get(Application, app_a).status == ApplicationStatus.APPLIED


def test_owner_gets_full_detail(client, make, auth):
    a = make.user("student", email="a@campus.test")
    app_a = make.application(a, make.job(make.company("Zoho"), "Dev"))
    d = client.get(f"/api/v1/applications/{app_a}", headers=auth("a@campus.test")).get_json()["data"]
    assert set(d) >= {"application", "job", "company", "interviews", "notifications"} and d["company"]["name"] == "Zoho"


def test_staff_with_review_permission_can_read_any_application_and_see_masked_phone(client, make, auth):
    a = make.user("student", email="a@campus.test")
    make.user("faculty", email="f@campus.test")
    app_a = make.application(a, make.job(make.company()))
    d = client.get(f"/api/v1/applications/{app_a}", headers=auth("f@campus.test")).get_json()["data"]
    assert d["student"]["email"] == "a@campus.test" and "phone" not in d["student"]  # no phone on file in the factory => omitted, never a stray value


def test_withdraw_rules(client, make, auth):
    a = make.user("student", email="a@campus.test")
    c = make.company()
    h = auth("a@campus.test")
    ok_app = make.application(a, make.job(c, "X"))
    r = client.post(f"/api/v1/applications/{ok_app}/withdraw", headers=h)
    assert r.status_code == 200 and r.get_json()["data"]["application"]["status"] == "withdrawn"
    assert client.post(f"/api/v1/applications/{ok_app}/withdraw", headers=h).status_code == 409  # already withdrawn
    selected = make.application(a, make.job(c, "Y"), ApplicationStatus.SELECTED)
    assert client.post(f"/api/v1/applications/{selected}/withdraw", headers=h).status_code == 409  # cannot walk away after selection through this path
