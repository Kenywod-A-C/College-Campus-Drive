"""Administrator configuration: placement policies, academic config, audit-log reads."""
from datetime import timedelta

import pytest

from app.extensions import db
from app.models import AcademicYear, ApplicationStatus as S, AuditLog, Course, Department, PlacementPolicy, PolicyKind, User, utcnow

from .test_jobs_admin import strip

AD = "/api/v1/admin"


def acts(app, prefix=""):
    with app.app_context():
        return [(a.action, a.result.value, a.reason) for a in db.session.query(AuditLog).order_by(AuditLog.id) if a.action.startswith(prefix)]


@pytest.fixture()
def world(make, auth):
    make.user("admin", email="a@campus.test", name="Root Admin")
    make.user("faculty", email="f@campus.test")
    make.user("student", email="s@campus.test")
    return {"a": auth("a@campus.test"), "f": auth("f@campus.test"), "s": auth("s@campus.test")}


def pol(**o):
    b = {"name": "Offer cap", "description": "Cap offers", "kind": "max_offers", "scope": "college", "params": {"maxAcceptedOffers": 3}, "enabled": True}
    b.update(o)
    return b


# ================================================================ authorisation (every endpoint, every role)
ENDPOINTS = [
    ("get", "/policies", None), ("post", "/policies", pol()), ("put", "/policies/1", pol()), ("delete", "/policies/1", {"reason": "cleanup"}),
    ("get", "/academic", None), ("post", "/departments", {"code": "X1", "name": "X"}), ("put", "/departments/1", {"code": "X1", "name": "X"}), ("delete", "/departments/1", None),
    ("post", "/courses", {"code": "C1", "name": "C", "degree": "B.E.", "departmentId": 1}), ("put", "/courses/1", {"code": "C1", "name": "C", "degree": "B.E.", "departmentId": 1}), ("delete", "/courses/1", None),
    ("post", "/academic-years", {"label": "2030-31", "graduationYear": 2031}), ("put", "/academic-years/1", {"label": "2030-31", "graduationYear": 2031}),
    ("get", "/audit-logs", None),
]


@pytest.mark.parametrize("method,path,body", ENDPOINTS)
def test_every_admin_endpoint_refuses_anonymous_students_and_faculty(client, world, app, method, path, body):
    for h, want in (({}, 401), (world["s"], 403), (world["f"], 403)):
        r = getattr(client, method)(AD + path, headers=h, json=body) if body is not None else getattr(client, method)(AD + path, headers=h)
        assert r.status_code == want, (h and "role", r.status_code)
    with app.app_context():
        assert db.session.query(PlacementPolicy).count() == 5 and db.session.query(Department).count() == 7


def test_policy_and_audit_endpoints_follow_the_permission_matrix_not_just_the_role(client, world, app):
    for key, path in (("policies.manage", "/policies"), ("audit.view", "/audit-logs")):
        assert client.get(AD + path, headers=world["a"]).status_code == 200
        strip(app, "admin", key)
        assert client.get(AD + path, headers=world["a"]).status_code == 403


# ================================================================ policies
def test_list_returns_every_policy_with_params_and_no_internal_fields(client, world):
    d = client.get(AD + "/policies", headers=world["a"]).get_json()["data"]
    assert len(d) == 5 and {p["kind"] for p in d} == {k.value for k in PolicyKind}
    assert all(set(p) >= {"id", "name", "kind", "scope", "params", "enabled", "updatedAt", "updatedBy"} for p in d)


def test_create_policy_persists_audits_and_records_the_actor(client, world, app):
    r = client.post(AD + "/policies", headers=world["a"], json=pol())
    d = r.get_json()["data"]
    assert r.status_code == 201 and d["params"] == {"maxAcceptedOffers": 3} and d["updatedBy"] == "Root Admin" and "scopeValue" not in d
    assert acts(app, "policy.create")[0][:2] == ("policy.create", "success")


@pytest.mark.parametrize("kind,params", [
    ("max_offers", {"maxAcceptedOffers": 0}), ("max_offers", {"maxAcceptedOffers": 21}), ("max_offers", {"maxAcceptedOffers": "3"}), ("max_offers", {"maxAcceptedOffers": 1.5}),
    ("max_offers", {"maxAcceptedOffers": True}), ("max_offers", {}), ("application_limit", {"maxActiveApplications": 0}), ("accepted_offer", {"acceptanceWindowDays": 91}),
    ("tier_restriction", {"allowOnlyHigherTier": "yes"}), ("exception_approval", {"requireReason": 1}), ("max_offers", {"maxAcceptedOffers": 2, "a": {"nested": 1}}),
    ("max_offers", {"maxAcceptedOffers": 2, **{f"k{i}": 1 for i in range(11)}}),
])
def test_invalid_policy_parameters_are_422_and_change_nothing(client, world, app, kind, params):
    assert client.post(AD + "/policies", headers=world["a"], json=pol(kind=kind, params=params)).status_code == 422
    with app.app_context():
        assert db.session.query(PlacementPolicy).count() == 5


@pytest.mark.parametrize("over", [
    {"name": ""}, {"kind": "bogus"}, {"scope": "planet"}, {"scope": "department"}, {"scope": "department", "scopeValue": "abc"}, {"scope": "department", "scopeValue": "9999"},
    {"scope": "academic_year", "scopeValue": "1999"}, {"enabled": "yes"}, {"extra": 1}, {"name": "x" * 200},
])
def test_invalid_policy_bodies_are_rejected(client, world, over):
    assert client.post(AD + "/policies", headers=world["a"], json=pol(**over)).status_code == 422


def test_department_and_batch_scoped_policies_validate_their_target(client, world):
    ids = {d["code"]: d["id"] for d in client.get(AD + "/academic", headers=world["a"]).get_json()["data"]["departments"]}
    assert client.post(AD + "/policies", headers=world["a"], json=pol(name="CSE cap", scope="department", scopeValue=ids["CSE"])).status_code == 201
    assert client.post(AD + "/policies", headers=world["a"], json=pol(name="Batch cap", scope="academic_year", scopeValue="2027")).status_code == 201
    assert client.post(AD + "/policies", headers=world["a"], json=pol(name="College cap", scope="college", scopeValue="12")).get_json()["data"].get("scopeValue") is None  # ignored for college scope


def test_duplicate_policy_names_are_409_case_insensitively(client, world):
    assert client.post(AD + "/policies", headers=world["a"], json=pol(name="Maximum accepted offers")).status_code == 409
    assert client.post(AD + "/policies", headers=world["a"], json=pol(name="MAXIMUM ACCEPTED OFFERS")).status_code == 409


def test_update_records_the_before_and_after_and_toggling_works_as_the_ui_does_it(client, world, app):
    p = next(x for x in client.get(AD + "/policies", headers=world["a"]).get_json()["data"] if x["kind"] == "max_offers")
    body = {k: v for k, v in p.items() if k not in ("id", "updatedAt", "updatedBy")}
    r = client.put(f"{AD}/policies/{p['id']}", headers=world["a"], json={**body, "enabled": False, "params": {"maxAcceptedOffers": 5}})
    assert r.status_code == 200 and r.get_json()["data"]["enabled"] is False
    reason = acts(app, "policy.update")[0][2]
    assert "enabled: True -> False" in reason and "5" in reason
    assert client.put(f"{AD}/policies/{p['id']}", headers=world["a"], json={**body, "enabled": False, "params": {"maxAcceptedOffers": 5}}).status_code == 200
    assert len(acts(app, "policy.update")) == 1  # no-op saves are not audited


def test_a_policys_kind_cannot_change_and_unknown_ids_are_404(client, world):
    p = client.get(AD + "/policies", headers=world["a"]).get_json()["data"][0]
    assert client.put(f"{AD}/policies/{p['id']}", headers=world["a"], json=pol(name=p["name"], kind="application_limit", params={"maxActiveApplications": 3})).status_code == 409
    assert client.put(AD + "/policies/99999", headers=world["a"], json=pol(name="Ghost")).status_code == 404
    assert client.delete(AD + "/policies/99999", headers=world["a"], json={"reason": "cleanup"}).status_code == 404


def test_delete_needs_a_reason_audits_it_and_removes_the_policy(client, world, app):
    p = client.get(AD + "/policies", headers=world["a"]).get_json()["data"][0]
    for bad in ({}, {"reason": ""}, {"reason": "x"}, {"reason": "ok reason", "extra": 1}):
        assert client.delete(f"{AD}/policies/{p['id']}", headers=world["a"], json=bad).status_code == 422
    assert client.delete(f"{AD}/policies/{p['id']}", headers=world["a"], json={"reason": "Superseded by new rule"}).status_code == 200
    with app.app_context():
        assert db.session.query(PlacementPolicy).count() == 4
    assert "Superseded by new rule" in acts(app, "policy.delete")[0][2]


def test_policy_changes_take_effect_on_the_very_next_application(client, world, make, auth):
    u = make.user("student", email="ann@campus.test")
    co = make.company()
    j1, j2 = make.job(co, "A", depts=()), make.job(co, "B", depts=())
    h = auth("ann@campus.test")
    p = next(x for x in client.get(AD + "/policies", headers=world["a"]).get_json()["data"] if x["kind"] == "application_limit")
    body = {k: v for k, v in p.items() if k not in ("id", "updatedAt", "updatedBy")}
    client.put(f"{AD}/policies/{p['id']}", headers=world["a"], json={**body, "params": {"maxActiveApplications": 1}})
    assert client.post("/api/v1/applications", headers=h, json={"jobId": j1}).status_code == 201
    r = client.post("/api/v1/applications", headers=h, json={"jobId": j2})
    assert r.status_code == 409 and "at most 1" in r.get_json()["error"]["message"]


# ================================================================ academic configuration
def test_overview_counts_students_and_programmes(client, world, make):
    make.user("student", dept="CSE")
    d = client.get(AD + "/academic", headers=world["a"]).get_json()["data"]
    cse = next(x for x in d["departments"] if x["code"] == "CSE")
    assert cse["students"] == 2 and cse["courses"] == 1 and cse["headName"]  # the fixture's own student plus the one added here
    assert any(y["active"] and y["label"] == "2026-27" for y in d["academicYears"]) and d["courses"][0]["durationYears"] == 4


def test_department_create_update_audit_and_duplicate_codes(client, world, app):
    r = client.post(AD + "/departments", headers=world["a"], json={"code": "BIO", "name": "Biotechnology", "headName": "Dr. X"})
    d = r.get_json()["data"]
    assert r.status_code == 201 and d["students"] == 0
    assert client.post(AD + "/departments", headers=world["a"], json={"code": "bio", "name": "Dup"}).status_code == 409
    assert client.put(f"{AD}/departments/{d['id']}", headers=world["a"], json={"code": "BIO", "name": "Biotech"}).get_json()["data"]["name"] == "Biotech"
    assert client.put(f"{AD}/departments/{d['id']}", headers=world["a"], json={"code": "CSE", "name": "x"}).status_code == 409
    assert [a for a, _, _ in acts(app, "department.")] == ["department.create", "department.update"]


@pytest.mark.parametrize("body", [{"code": "", "name": "x"}, {"code": "has space", "name": "x"}, {"code": "X" * 17, "name": "x"}, {"code": "OK", "name": ""}, {"code": "OK", "name": "x", "extra": 1}])
def test_invalid_departments_are_422(client, world, body):
    assert client.post(AD + "/departments", headers=world["a"], json=body).status_code == 422


def test_deleting_a_department_in_use_is_refused_with_the_reason_and_an_unused_one_is_deleted(client, world, make, app):
    make.user("student", dept="CSE")
    cse = next(x for x in client.get(AD + "/academic", headers=world["a"]).get_json()["data"]["departments"] if x["code"] == "CSE")
    r = client.delete(f"{AD}/departments/{cse['id']}", headers=world["a"])
    assert r.status_code == 409 and "student" in r.get_json()["error"]["message"] and "programme" in r.get_json()["error"]["message"]
    new = client.post(AD + "/departments", headers=world["a"], json={"code": "TMP", "name": "Temp"}).get_json()["data"]
    client.post(AD + "/policies", headers=world["a"], json=pol(name="Tmp policy", scope="department", scopeValue=new["id"]))
    assert "policies" in client.delete(f"{AD}/departments/{new['id']}", headers=world["a"]).get_json()["error"]["message"]
    pid = next(p["id"] for p in client.get(AD + "/policies", headers=world["a"]).get_json()["data"] if p["name"] == "Tmp policy")
    client.delete(f"{AD}/policies/{pid}", headers=world["a"], json={"reason": "no longer needed"})
    assert client.delete(f"{AD}/departments/{new['id']}", headers=world["a"]).status_code == 200
    assert client.delete(f"{AD}/departments/{new['id']}", headers=world["a"]).status_code == 404
    assert [a for a, _, _ in acts(app, "department.delete")] == ["department.delete"]


def test_a_department_with_staff_or_jobs_attached_cannot_be_deleted(client, world, make, app):
    d = client.post(AD + "/departments", headers=world["a"], json={"code": "TMP", "name": "Temp"}).get_json()["data"]
    make.company()
    with app.app_context():
        dept = db.session.get(Department, int(d["id"]))
        db.session.get(User, 1).department_id = dept.id
        db.session.commit()
    assert "users" in client.delete(f"{AD}/departments/{d['id']}", headers=world["a"]).get_json()["error"]["message"]


def test_courses_crud_validation_and_duplicates(client, world, app):
    dept = client.get(AD + "/academic", headers=world["a"]).get_json()["data"]["departments"][0]["id"]
    body = {"code": "NEW-PG", "name": "New programme", "degree": "M.E.", "departmentId": int(dept), "durationYears": 2}
    r = client.post(AD + "/courses", headers=world["a"], json=body)
    c = r.get_json()["data"]
    assert r.status_code == 201 and c["degree"] == "M.E." and c["departmentId"] == dept
    assert client.post(AD + "/courses", headers=world["a"], json={**body, "code": "new-pg"}).status_code == 409
    for bad in ({"departmentId": 9999}, {"degree": "PhD"}, {"durationYears": 0}, {"durationYears": 9}, {"code": ""}):
        assert client.post(AD + "/courses", headers=world["a"], json={**body, "code": "OTHER", **bad}).status_code == 422
    assert client.put(f"{AD}/courses/{c['id']}", headers=world["a"], json={**body, "name": "Renamed"}).get_json()["data"]["name"] == "Renamed"
    assert client.delete(f"{AD}/courses/{c['id']}", headers=world["a"]).status_code == 200
    assert client.delete(f"{AD}/courses/{c['id']}", headers=world["a"]).status_code == 404
    assert [a for a, _, _ in acts(app, "course.")] == ["course.create", "course.update", "course.delete"]


def test_academic_years_keep_exactly_one_active(client, world, app):
    r = client.post(AD + "/academic-years", headers=world["a"], json={"label": "2028-29", "graduationYear": 2029, "active": True})
    years = r.get_json()["data"]
    assert r.status_code == 201 and [y["label"] for y in years if y["active"]] == ["2028-29"]
    old = next(y for y in years if y["label"] == "2026-27")
    assert client.put(f"{AD}/academic-years/{old['id']}", headers=world["a"], json={"label": "2026-27", "graduationYear": 2027, "active": True}).status_code == 200
    now = client.get(AD + "/academic", headers=world["a"]).get_json()["data"]["academicYears"]
    assert [y["label"] for y in now if y["active"]] == ["2026-27"]
    assert client.put(f"{AD}/academic-years/{old['id']}", headers=world["a"], json={"label": "2026-27", "graduationYear": 2027, "active": False}).status_code == 409


@pytest.mark.parametrize("body,want", [
    ({"label": "2026-27", "graduationYear": 2040}, 409), ({"label": "2030-31", "graduationYear": 2027}, 409), ({"label": "2030/31", "graduationYear": 2031}, 422),
    ({"label": "2030-35", "graduationYear": 2031}, 422), ({"label": "2030-31", "graduationYear": 1990}, 422), ({"label": "2030-31", "graduationYear": 2031, "active": "yes"}, 422),
])
def test_academic_year_validation(client, world, body, want):
    assert client.post(AD + "/academic-years", headers=world["a"], json=body).status_code == want


# ================================================================ audit log
def test_audit_log_is_paginated_filtered_newest_first_and_hides_ip_addresses(client, world, app):
    r = client.get(AD + "/audit-logs", headers=world["a"], query_string={"pageSize": 3}).get_json()
    assert len(r["data"]) == 3 and r["meta"]["total"] >= 3 and "auth" in r["meta"]["actions"]
    ats = [x["at"] for x in r["data"]]
    assert ats == sorted(ats, reverse=True)
    assert "ip" not in client.get(AD + "/audit-logs", headers=world["a"]).get_data(as_text=True).lower()
    client.get("/api/v1/students", headers=world["s"])  # a denied access attempt
    denied = client.get(AD + "/audit-logs", headers=world["a"], query_string={"result": "denied"}).get_json()["data"]
    assert denied and all(x["result"] == "denied" for x in denied)
    assert all("student" in x["actor"].lower() for x in client.get(AD + "/audit-logs", headers=world["a"], query_string={"actor": "STUDENT", "result": "denied"}).get_json()["data"])
    assert client.get(AD + "/audit-logs", headers=world["a"], query_string={"action": "nothing.like.this"}).get_json()["data"] == []
    assert client.get(AD + "/audit-logs", headers=world["a"], query_string={"action": "%"}).get_json()["data"] == []


def test_audit_log_date_range_is_inclusive_of_the_end_day(client, world, app):
    with app.app_context():
        db.session.add(AuditLog(actor_name="Old", actor_role="system", action="test.old", resource="r", created_at=utcnow() - timedelta(days=40)))
        db.session.commit()
    today = utcnow().date().isoformat()
    long_ago = (utcnow() - timedelta(days=41)).date().isoformat()
    assert [x["actor"] for x in client.get(AD + "/audit-logs", headers=world["a"], query_string={"action": "test.old", "from": long_ago, "to": today}).get_json()["data"]] == ["Old"]
    assert client.get(AD + "/audit-logs", headers=world["a"], query_string={"action": "test.old", "from": today}).get_json()["data"] == []
    end_of_that_day = (utcnow() - timedelta(days=40)).date().isoformat()
    assert len(client.get(AD + "/audit-logs", headers=world["a"], query_string={"action": "test.old", "to": end_of_that_day}).get_json()["data"]) == 1


@pytest.mark.parametrize("bad", [{"result": "x"}, {"page": 0}, {"pageSize": 101}, {"from": "yesterday"}, {"from": "2026-05-02", "to": "2026-05-01"}, {"bogus": 1}])
def test_audit_log_query_validation(client, world, bad):
    assert client.get(AD + "/audit-logs", headers=world["a"], query_string=bad).status_code == 422


def test_the_audit_log_cannot_be_written_or_deleted_through_the_api_or_the_orm(client, world, app):
    for method in ("post", "put", "patch", "delete"):
        assert getattr(client, method)(AD + "/audit-logs", headers=world["a"], json={}).status_code == 405
        assert getattr(client, method)(AD + "/audit-logs/1", headers=world["a"], json={}).status_code == 404
    with app.app_context():
        row = db.session.query(AuditLog).first()
        row.reason = "tampered"
        with pytest.raises(PermissionError):
            db.session.commit()
        db.session.rollback()
        db.session.delete(db.session.query(AuditLog).first())
        with pytest.raises(PermissionError):
            db.session.commit()
        db.session.rollback()
