from app.extensions import db
from app.models import JobStatus, Permission, Role, RoleName


def J(client, h, **params):
    return client.get("/api/v1/jobs", headers=h, query_string=params)


def titles(r):
    return [v["job"]["title"] for v in r.get_json()["data"]]


def test_jobs_require_authentication(client):
    assert client.get("/api/v1/jobs").status_code == 401
    assert client.get("/api/v1/jobs/1").status_code == 401


def test_student_sees_only_published_jobs_with_their_own_eligibility(client, make, auth):
    c = make.company("Zoho")
    make.user("student", email="s@campus.test", cgpa=8.0)
    make.job(c, "Open", min_cgpa=7.0)
    make.job(c, "Hard", min_cgpa=9.5)
    make.job(c, "Draft", status=JobStatus.DRAFT)
    make.job(c, "Closed", status=JobStatus.CLOSED)
    make.job(c, "Cancelled", status=JobStatus.CANCELLED)
    r = J(client, auth("s@campus.test"))
    assert sorted(titles(r)) == ["Hard", "Open"]
    by = {v["job"]["title"]: v for v in r.get_json()["data"]}
    assert by["Open"]["eligibility"]["state"] == "eligible" and by["Hard"]["eligibility"]["state"] == "not_eligible"
    assert by["Hard"]["eligibility"]["checks"][2]["detail"].startswith("Requires 9.5+")
    assert by["Open"]["company"]["name"] == "Zoho" and "applicantCount" not in by["Open"]  # applicant counts are staff-only
    assert r.get_json()["meta"] == {"page": 1, "pageSize": 9, "total": 2, "totalPages": 1}


def test_student_cannot_open_a_draft_even_with_its_id(client, make, auth):
    make.user("student", email="s@campus.test")
    draft = make.job(make.company(), "Secret", status=JobStatus.DRAFT)
    r = client.get(f"/api/v1/jobs/{draft}", headers=auth("s@campus.test"))
    assert r.status_code == 404 and r.get_json()["error"]["code"] == "not_found"
    assert client.get("/api/v1/jobs/999999", headers=auth("s@campus.test")).status_code == 404


def test_job_detail_shape_matches_the_ui_types(client, make, auth):
    make.user("student", email="s@campus.test")
    j = make.job(make.company("Bosch"), "Embedded", depts=("CSE", "ECE"), history=2, skills=("C", "RTOS"))
    v = client.get(f"/api/v1/jobs/{j}", headers=auth("s@campus.test")).get_json()["data"]
    job = v["job"]
    assert job["id"] == str(j) and job["type"] == "Full-time" and job["skills"] == ["C", "RTOS"] and job["status"] == "published"
    assert job["eligibility"]["maxArrearHistory"] == 2 and job["eligibility"]["graduationYears"] == [2027] and len(job["eligibility"]["departmentIds"]) == 2
    assert job["rounds"][0]["name"] == "Online Assessment" and "driveDate" in job and job["deadline"].endswith("Z")
    assert v["eligibleDepartments"] == ["CSE", "ECE"] and v["saved"] is False and v["eligibility"]["state"] == "eligible"


def test_filters_search_and_sorting(client, make, auth):
    zoho, tcs = make.company("Zoho"), make.company("TCS")
    make.user("student", email="s@campus.test")
    make.job(zoho, "Backend Developer", depts=("CSE",), min_cgpa=7.0, deadline_days=9, skills=("Python", "SQL"))
    make.job(tcs, "Digital", depts=("IT",), min_cgpa=8.5, deadline_days=3, skills=("Java",))
    h = auth("s@campus.test")
    assert titles(J(client, h, q="zoho")) == ["Backend Developer"]
    assert titles(J(client, h, q="java")) == ["Digital"]  # skill search
    assert titles(J(client, h, q="backend")) == ["Backend Developer"]
    assert titles(J(client, h, minCgpa=7.5)) == ["Backend Developer"]
    assert titles(J(client, h, dept=1)) in (["Backend Developer"], [])  # id filter accepted
    assert titles(J(client, h, deadlineDays=5)) == ["Digital"]
    assert titles(J(client, h, sort="deadline")) == ["Digital", "Backend Developer"]
    assert titles(J(client, h, q="%")) == []  # LIKE wildcards are escaped, not interpreted


def test_tabs_saved_applied_eligible(client, make, auth):
    c = make.company()
    u = make.user("student", email="s@campus.test", cgpa=8.0)
    a, b, hard = make.job(c, "A"), make.job(c, "B"), make.job(c, "Hard", min_cgpa=9.9)
    make.application(u, b)
    h = auth("s@campus.test")
    assert client.post(f"/api/v1/jobs/{a}/save", headers=h).get_json()["data"] == {"saved": True}
    assert titles(J(client, h, tab="saved")) == ["A"]
    assert sorted(titles(J(client, h, tab="eligible"))) == ["A", "B"]
    assert titles(J(client, h, tab="not_eligible")) == ["Hard"]
    assert titles(J(client, h, tab="applied")) == ["B"]
    assert client.post(f"/api/v1/jobs/{a}/save", headers=h).get_json()["data"] == {"saved": False}
    assert titles(J(client, h, tab="saved")) == []


def test_pagination_and_parameter_validation(client, make, auth):
    c = make.company()
    make.user("student", email="s@campus.test")
    for i in range(12):
        make.job(c, f"Job {i:02d}", deadline_days=i + 1)
    h = auth("s@campus.test")
    r = J(client, h, page=2, pageSize=5)
    assert r.get_json()["meta"] == {"page": 2, "pageSize": 5, "total": 12, "totalPages": 3} and len(r.get_json()["data"]) == 5
    assert len(J(client, h, page=99, pageSize=5).get_json()["data"]) == 0
    for bad in ({"pageSize": 1000}, {"page": 0}, {"minCgpa": 11}, {"sort": "random"}, {"tab": "nope"}, {"dept": "abc"}, {"bogus": 1}):
        r = J(client, h, **bad)
        assert r.status_code == 422 and r.get_json()["error"]["code"] == "validation_error", bad


def test_staff_see_drafts_counts_and_can_filter_by_status(client, make, auth):
    c = make.company()
    make.user("faculty", email="f@campus.test")
    u = make.user("student")
    pub, draft = make.job(c, "Pub"), make.job(c, "Draft", status=JobStatus.DRAFT)
    make.application(u, pub)
    h = auth("f@campus.test")
    r = J(client, h)
    assert sorted(titles(r)) == ["Draft", "Pub"]
    by = {v["job"]["title"]: v for v in r.get_json()["data"]}
    assert by["Pub"]["applicantCount"] == 1 and "eligibility" not in by["Pub"]
    assert titles(J(client, h, status="draft")) == ["Draft"]
    assert client.get(f"/api/v1/jobs/{draft}", headers=h).status_code == 200


def test_staff_without_any_job_permission_are_refused_immediately(client, make, auth, app):
    c = make.company()
    make.user("faculty", email="f@campus.test")
    make.job(c)
    h = auth("f@campus.test")
    assert J(client, h).status_code == 200
    with app.app_context():  # an admin strips the role's permissions; the SAME still-valid token must stop working at once
        role = db.session.query(Role).filter_by(name=RoleName.FACULTY).one()
        role.permissions = [p for p in role.permissions if p.key not in ("jobs.create", "applications.review", "students.view", "drives.publish")]
        db.session.commit()
    r = J(client, h)
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "forbidden"
