from app.extensions import db
from app.models import AuditLog, Student, User


def H(auth, email):
    return auth(email)


def test_profile_requires_a_student(client, make, auth):
    make.user("faculty", email="f@campus.test")
    make.user("student", email="s@campus.test")
    assert client.get("/api/v1/student/profile").status_code == 401
    assert client.get("/api/v1/student/profile", headers=auth("f@campus.test")).status_code == 403
    d = client.get("/api/v1/student/profile", headers=auth("s@campus.test")).get_json()["data"]
    assert d["email"] == "s@campus.test" and d["academic"]["cgpa"] == 8.4 and d["academic"]["cgpaVerified"] is True
    assert d["skills"] == ["Python", "SQL", "Java"] and d["placementStatus"] == "unplaced"
    assert "password" not in str(d).lower() and "hash" not in str(d).lower()


def test_patch_allowed_fields_and_completion(client, make, auth):
    make.user("student", email="s@campus.test", profile_completion=0)
    h = auth("s@campus.test")
    r = client.patch("/api/v1/student/profile", headers=h, json={"phone": "+91 98400 12345", "skills": ["Go", "Go", "Rust", "SQL"], "interests": ["Cloud"], "portfolioUrl": "https://github.com/x"})
    d = r.get_json()["data"]
    assert r.status_code == 200 and d["skills"] == ["Go", "Rust", "SQL"] and d["interests"] == ["Cloud"] and d["phone"] == "+91 98400 12345"
    assert d["profileCompletion"] > 0


def test_cgpa_edit_resets_verification(client, make, auth):
    make.user("student", email="s@campus.test")
    h = auth("s@campus.test")
    same = client.patch("/api/v1/student/profile", headers=h, json={"cgpa": 8.4}).get_json()["data"]
    assert same["academic"]["cgpaVerified"] is True  # unchanged value keeps verification
    changed = client.patch("/api/v1/student/profile", headers=h, json={"cgpa": 9.1}).get_json()["data"]
    assert changed["academic"]["cgpa"] == 9.1 and changed["academic"]["cgpaVerified"] is False


def test_controlled_fields_are_refused_and_audited(client, make, auth, app):
    make.user("student", email="s@campus.test")
    h = auth("s@campus.test")
    for field, value in (("role", "admin"), ("placementStatus", "placed"), ("departmentId", "1"), ("studentCode", "X1"), ("graduationYear", 2030), ("academic", {"cgpaVerified": True})):
        r = client.patch("/api/v1/student/profile", headers=h, json={field: value})
        assert r.status_code == 403, field
    with app.app_context():
        assert db.session.query(AuditLog).filter_by(action="student.update").count() == 6
        s = db.session.query(Student).one()
        assert s.placement_status.value == "unplaced" and s.user.role_name == "student"


def test_profile_validation(client, make, auth):
    make.user("student", email="s@campus.test")
    h = auth("s@campus.test")
    for bad in ({"phone": "abc"}, {"cgpa": 11}, {"cgpa": -1}, {"portfolioUrl": "javascript:alert(1)"}, {"skills": ["x"] * 31}, {"activeArrears": -1}, {"unknown": 1}):
        r = client.patch("/api/v1/student/profile", headers=h, json=bad)
        assert r.status_code in (403, 422), bad
        if r.status_code == 422:
            assert r.get_json()["error"]["code"] == "validation_error"


ONBOARD = {"studentCode": "23IT201", "departmentId": None, "degree": "B.Tech", "currentYear": 4, "graduationYear": 2027, "cgpa": 7.9, "activeArrears": 0, "arrearHistory": 1,
           "skills": ["Python", "SQL", "Java"], "interests": ["Cloud"], "preferredRoles": ["Software Engineer"], "portfolioUrl": ""}


def _dept(client, h, code="IT"):
    return next(d["value"] for d in client.get("/api/v1/reference/filters", headers=h).get_json()["data"]["departments"] if d["label"] == code)


def test_onboarding_marks_cgpa_unverified_and_cannot_repeat(client, make, auth):
    make.user("student", email="new@campus.test", onboarded=False, code="NEW001")
    h = auth("new@campus.test")
    body = {**ONBOARD, "departmentId": int(_dept(client, h))}
    r = client.post("/api/v1/student/onboarding", headers=h, json=body)
    assert r.status_code == 200 and r.get_json()["data"]["onboardingComplete"] is True
    prof = client.get("/api/v1/student/profile", headers=h).get_json()["data"]
    assert prof["studentCode"] == "23IT201" and prof["academic"]["cgpa"] == 7.9 and prof["academic"]["cgpaVerified"] is False
    assert client.post("/api/v1/student/onboarding", headers=h, json=body).status_code == 409


def test_onboarding_duplicate_student_code_and_validation(client, make, auth):
    make.user("student", email="a@campus.test", code="23IT201")
    make.user("student", email="new@campus.test", onboarded=False, code="NEW001")
    h = auth("new@campus.test")
    dept = int(_dept(client, h))
    assert client.post("/api/v1/student/onboarding", headers=h, json={**ONBOARD, "departmentId": dept}).status_code == 409
    for bad in ({"studentCode": "x"}, {"cgpa": 12}, {"degree": "PhD"}, {"departmentId": 9999}):
        r = client.post("/api/v1/student/onboarding", headers=h, json={**ONBOARD, "departmentId": dept, **bad})
        assert r.status_code == 422, bad


def test_dashboard_shape_for_the_logged_in_student(client, make, auth):
    c = make.company()
    u = make.user("student", email="s@campus.test")
    ok = make.job(c, "Eligible Role", min_cgpa=7.0)
    make.job(c, "Too Hard", min_cgpa=9.9)
    make.application(u, make.job(c, "Applied Role"))
    d = client.get("/api/v1/student/dashboard", headers=auth("s@campus.test")).get_json()["data"]
    assert set(d) == {"student", "metrics", "events", "deadlines", "recommended", "activity"}
    assert d["metrics"]["eligibleJobs"] == 2 and d["metrics"]["activeApplications"] == 1
    assert [v["job"]["title"] for v in d["recommended"]] == ["Eligible Role"]  # applied + ineligible jobs are not recommended
    assert ok


def test_staff_cannot_use_the_student_dashboard(client, make, auth):
    make.user("faculty", email="f@campus.test")
    assert client.get("/api/v1/student/dashboard", headers=auth("f@campus.test")).status_code == 403
