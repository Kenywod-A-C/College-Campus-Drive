import pytest

from app.extensions import db
from app.models import ApplicationStatus, AuditLog, Notification, OfferStatus, Permission, Role, RoleName, Student, User, utcnow


def L(client, h, **params):
    return client.get("/api/v1/students", headers=h, query_string=params)


def names(r):
    return [s["name"] for s in r.get_json()["data"]]


@pytest.fixture()
def roster(make):
    """Four students with distinct attributes + one faculty + one admin."""
    make.user("faculty", email="f@campus.test")
    make.user("admin", email="a@campus.test")
    return {
        "ann": make.user("student", email="ann@campus.test", name="Ann Alpha", code="23CSE001", dept="CSE", cgpa=9.1, skills=["Python", "React"], graduation_year=2027, phone="+91 98400 12345"),
        "bob": make.user("student", email="bob@campus.test", name="Bob Beta", code="23IT002", dept="IT", cgpa=7.2, skills=["Java"], graduation_year=2027, placement="placed"),
        "cy": make.user("student", email="cy@campus.test", name="Cy Gamma", code="23CSE003", dept="CSE", cgpa=None, skills=[], graduation_year=2028),
        "di": make.user("student", email="di@campus.test", name="Di Delta", code="23ECE004", dept="ECE", cgpa=8.0, skills=["Python"], graduation_year=2027, placement="in_process"),
    }


# ------------------------------------------------------------------ authorisation
def test_directory_requires_authentication_and_the_students_view_permission(client, make, auth, roster):
    assert L(client, {}).status_code == 401
    r = L(client, auth("ann@campus.test"))
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "forbidden"  # students cannot browse other students
    assert L(client, auth("f@campus.test")).status_code == 200
    assert L(client, auth("a@campus.test")).status_code == 200


def test_denied_directory_access_is_audited(client, auth, roster, app):
    L(client, auth("ann@campus.test"))
    with app.app_context():
        row = db.session.query(AuditLog).filter_by(action="access.denied").one()
        assert row.actor_role == "student" and "students.view" in row.resource


def test_revoking_students_view_takes_effect_on_the_next_request(client, auth, roster, app):
    h = auth("f@campus.test")
    assert L(client, h).status_code == 200
    with app.app_context():
        role = db.session.query(Role).filter_by(name=RoleName.FACULTY).one()
        role.permissions = [p for p in role.permissions if p.key != "students.view"]
        db.session.commit()
    assert L(client, h).status_code == 403
    assert client.get("/api/v1/students/1", headers=h).status_code == 403


# ------------------------------------------------------------------ listing
def test_listing_is_paginated_and_sorted_by_name(client, auth, roster):
    h = auth("f@campus.test")
    r = L(client, h, pageSize=3)
    assert names(r) == ["Ann Alpha", "Bob Beta", "Cy Gamma"]
    assert r.get_json()["meta"] == {"page": 1, "pageSize": 3, "total": 4, "totalPages": 2}
    assert names(L(client, h, pageSize=3, page=2)) == ["Di Delta"]
    assert names(L(client, h, page=9)) == []


@pytest.mark.parametrize("params,expected", [
    ({"q": "alpha"}, ["Ann Alpha"]),
    ({"q": "23it002"}, ["Bob Beta"]),                      # by student id, case-insensitive
    ({"q": "cy@campus"}, ["Cy Gamma"]),                    # by e-mail
    ({"year": 2028}, ["Cy Gamma"]),
    ({"minCgpa": 8.0}, ["Ann Alpha", "Di Delta"]),         # boundary included; a student with no CGPA never matches
    ({"skill": "python"}, ["Ann Alpha", "Di Delta"]),
    ({"placement": "placed"}, ["Bob Beta"]),
    ({"q": "a", "minCgpa": 8.5}, ["Ann Alpha"]),           # filters combine (AND)
    ({"q": "%"}, []),                                      # LIKE wildcards are escaped, not interpreted
    ({"q": "'; DROP TABLE students; --"}, []),
])
def test_filters(client, auth, roster, params, expected):
    r = L(client, auth("f@campus.test"), **params)
    assert r.status_code == 200 and names(r) == expected


def test_department_filter(client, auth, roster):
    h = auth("f@campus.test")
    ref = client.get("/api/v1/reference/filters", headers=h).get_json()["data"]["departments"]
    cse = next(d["value"] for d in ref if d["label"] == "CSE")
    assert names(L(client, h, dept=cse)) == ["Ann Alpha", "Cy Gamma"]


@pytest.mark.parametrize("bad", [{"pageSize": 500}, {"page": 0}, {"year": 1900}, {"minCgpa": 11}, {"placement": "hired"}, {"dept": "abc"}, {"sort": "x"}, {"q": "x" * 101}])
def test_invalid_parameters_are_422(client, auth, roster, bad):
    r = L(client, auth("f@campus.test"), **bad)
    assert r.status_code == 422 and r.get_json()["error"]["code"] == "validation_error"


def test_row_counts_and_shape(client, make, auth, roster):
    c = make.company()
    j1, j2 = make.job(c, "A"), make.job(c, "B")
    a1 = make.application(roster["ann"], j1)
    make.application(roster["ann"], j2)
    make.offer(a1, status=OfferStatus.ACCEPTED)
    row = L(client, auth("f@campus.test"), q="ann").get_json()["data"][0]
    assert row["applicationCount"] == 2 and row["offerCount"] == 1
    assert row["academic"] == {"cgpa": 9.1, "cgpaVerified": True, "activeArrears": 0, "arrearHistory": 0}
    assert row["skills"] == ["Python", "React"] and row["studentCode"] == "23CSE001" and row["profileCompletion"] == 100


# ------------------------------------------------------------------ data minimisation
def test_phone_is_masked_for_faculty_but_not_admin(client, auth, roster):
    fac = L(client, auth("f@campus.test"), q="ann").get_json()["data"][0]
    adm = L(client, auth("a@campus.test"), q="ann").get_json()["data"][0]
    assert adm["phone"] == "+91 98400 12345"
    assert "98400" not in fac["phone"] and fac["phone"].endswith("45") and "•" in fac["phone"]


def test_no_credentials_or_internals_are_ever_serialised(client, auth, roster):
    raw = L(client, auth("a@campus.test")).get_data(as_text=True).lower() + client.get("/api/v1/students/1", headers=auth("a@campus.test")).get_data(as_text=True).lower()
    for forbidden in ("password", "hash", "scrypt", "token", "failed_login", "locked_until"):
        assert forbidden not in raw


# ------------------------------------------------------------------ detail
def test_detail_returns_profile_applications_and_offers_and_is_audited(client, make, auth, roster, app):
    c = make.company("Zoho")
    app_id = make.application(roster["ann"], make.job(c, "Dev"))
    make.offer(app_id, status=OfferStatus.RECEIVED)
    make.application(roster["bob"], make.job(c, "Other"))
    sid = L(client, auth("f@campus.test"), q="ann").get_json()["data"][0]["id"]
    d = client.get(f"/api/v1/students/{sid}", headers=auth("f@campus.test")).get_json()["data"]
    assert d["student"]["name"] == "Ann Alpha" and d["student"]["applicationCount"] == 1 and d["student"]["offerCount"] == 1
    assert [a["job"]["title"] for a in d["applications"]] == ["Dev"]  # never Bob's application
    assert d["offers"][0]["company"]["name"] == "Zoho" and d["offers"][0]["student"]["name"] == "Ann Alpha"
    assert "98400" not in d["applications"][0]["student"].get("phone", "")
    with app.app_context():
        row = db.session.query(AuditLog).filter_by(action="student.view").one()
        assert row.actor_role == "faculty" and "23CSE001" in row.resource


def test_detail_unknown_or_malformed_id(client, auth, roster):
    h = auth("f@campus.test")
    assert client.get("/api/v1/students/999999", headers=h).status_code == 404
    assert client.get("/api/v1/students/abc", headers=h).status_code == 404


def test_students_cannot_read_any_student_through_the_staff_endpoint(client, auth, roster, app):
    h = auth("ann@campus.test")
    with app.app_context():
        mine = db.session.query(Student).join(User).filter(User.email == "ann@campus.test").one().id
        theirs = db.session.query(Student).join(User).filter(User.email == "bob@campus.test").one().id
    assert client.get(f"/api/v1/students/{mine}", headers=h).status_code == 403  # even their own: they use /student/profile
    assert client.get(f"/api/v1/students/{theirs}", headers=h).status_code == 403
    assert client.post(f"/api/v1/students/{mine}/verify-cgpa", headers=h, json={}).status_code == 403


# ------------------------------------------------------------------ CGPA verification
def _sid(app, email):
    with app.app_context():
        return db.session.query(Student).join(User).filter(User.email == email).one().id


def test_verify_cgpa_confirms_audits_and_notifies(client, make, auth, app):
    make.user("faculty", email="f@campus.test")
    make.user("student", email="s@campus.test", verified=False, cgpa=8.1)
    sid = _sid(app, "s@campus.test")
    r = client.post(f"/api/v1/students/{sid}/verify-cgpa", headers=auth("f@campus.test"), json={})
    assert r.status_code == 200 and r.get_json()["data"]["academic"] == {"cgpa": 8.1, "cgpaVerified": True, "activeArrears": 0, "arrearHistory": 0}
    with app.app_context():
        s = db.session.get(Student, sid)
        assert s.academic.verified_by is not None and s.academic.verified_at is not None
        a = db.session.query(AuditLog).filter_by(action="student.verify_cgpa").one()
        assert a.result.value == "success" and a.reason is None
        assert db.session.query(Notification).filter_by(user_id=s.user_id, title="Your CGPA has been verified").count() == 1


def test_verify_cgpa_can_correct_the_value_and_records_before_and_after(client, make, auth, app):
    make.user("faculty", email="f@campus.test")
    make.user("student", email="s@campus.test", verified=False, cgpa=9.9)
    sid = _sid(app, "s@campus.test")
    r = client.post(f"/api/v1/students/{sid}/verify-cgpa", headers=auth("f@campus.test"), json={"cgpa": 8.25})
    assert r.get_json()["data"]["academic"]["cgpa"] == 8.25
    with app.app_context():
        assert db.session.query(AuditLog).filter_by(action="student.verify_cgpa").one().reason == "CGPA corrected 9.90 -> 8.25"


def test_verify_requires_a_cgpa_and_valid_input(client, make, auth, app):
    make.user("faculty", email="f@campus.test")
    make.user("student", email="s@campus.test", cgpa=None, verified=False)
    sid = _sid(app, "s@campus.test")
    h = auth("f@campus.test")
    assert client.post(f"/api/v1/students/{sid}/verify-cgpa", headers=h, json={}).status_code == 422
    for bad in ({"cgpa": 10.5}, {"cgpa": -1}, {"cgpa": "high"}, {"cgpa": 8, "cgpaVerified": True}, {"academic": {"cgpaVerified": True}}):
        assert client.post(f"/api/v1/students/{sid}/verify-cgpa", headers=h, json=bad).status_code == 422, bad
    assert client.post(f"/api/v1/students/999999/verify-cgpa", headers=h, json={"cgpa": 8}).status_code == 404
    assert client.post(f"/api/v1/students/{sid}/verify-cgpa", headers=h, json={"cgpa": 8}).status_code == 200  # a value can be supplied by staff


def test_verify_needs_students_edit_not_just_students_view(client, make, auth, app):
    """Role-escalation attempt: a viewer must not be able to verify."""
    make.user("faculty", email="f@campus.test")
    make.user("student", email="s@campus.test", verified=False)
    sid = _sid(app, "s@campus.test")
    with app.app_context():
        role = db.session.query(Role).filter_by(name=RoleName.FACULTY).one()
        role.permissions = [p for p in role.permissions if p.key != "students.edit"]
        db.session.commit()
    h = auth("f@campus.test")
    assert client.get(f"/api/v1/students/{sid}", headers=h).status_code == 200  # can still view
    r = client.post(f"/api/v1/students/{sid}/verify-cgpa", headers=h, json={})
    assert r.status_code == 403
    with app.app_context():
        assert db.session.get(Student, sid).academic.cgpa_verified is False


def test_a_user_can_never_verify_their_own_record_even_if_misconfigured(client, make, auth, app):
    make.user("student", email="s@campus.test", verified=False)
    sid = _sid(app, "s@campus.test")
    with app.app_context():  # defence in depth: pretend someone wrongly granted the student role students.edit
        role = db.session.query(Role).filter_by(name=RoleName.STUDENT).one()
        role.permissions = [db.session.query(Permission).filter_by(key="students.edit").one()]
        db.session.commit()
    r = client.post(f"/api/v1/students/{sid}/verify-cgpa", headers=auth("s@campus.test"), json={})
    assert r.status_code == 403 and "own" in r.get_json()["error"]["message"]


def test_verification_unblocks_applying(client, make, auth, app):
    make.user("faculty", email="f@campus.test")
    make.user("student", email="s@campus.test", verified=False, cgpa=8.0)
    job = make.job(make.company(), min_cgpa=7.0)
    hs = auth("s@campus.test")
    assert client.post("/api/v1/applications", headers=hs, json={"jobId": job}).status_code == 403  # awaiting verification
    assert client.post(f"/api/v1/students/{_sid(app, 's@campus.test')}/verify-cgpa", headers=auth("f@campus.test"), json={}).status_code == 200
    assert client.post("/api/v1/applications", headers=hs, json={"jobId": job}).status_code == 201


def test_a_students_cgpa_edit_after_verification_requires_reverification(client, make, auth, app):
    make.user("student", email="s@campus.test", verified=True, cgpa=8.0)
    h = auth("s@campus.test")
    client.patch("/api/v1/student/profile", headers=h, json={"cgpa": 9.5})
    make.user("faculty", email="f@campus.test")
    row = L(client, auth("f@campus.test"), q="s@campus").get_json()["data"][0]
    assert row["academic"]["cgpa"] == 9.5 and row["academic"]["cgpaVerified"] is False
