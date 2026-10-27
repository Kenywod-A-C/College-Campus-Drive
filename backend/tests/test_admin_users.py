"""Administrator: user accounts, invitations, bulk import, role-permission matrix, escalation guards."""
import hashlib
import secrets
from datetime import timedelta

import pytest

from app.extensions import db
from app.models import AuditLog, FacultyProfile, PasswordResetToken, Permission, Role, RoleName, Student, User, UserStatus, utcnow

from .conftest import PASSWORD, login
from .test_jobs_admin import strip

URL = "/api/v1/users"


def acts(app, prefix=""):
    with app.app_context():
        return [(a.action, a.result.value, a.reason) for a in db.session.query(AuditLog).order_by(AuditLog.id) if a.action.startswith(prefix)]


def new_user(**over):
    b = {"name": "Dr. Meena Rao", "email": "Meena@College.edu", "userCode": "FAC100", "role": "faculty", "departmentId": None}
    b.update(over)
    return b


def user_row(app, email):
    with app.app_context():
        return db.session.query(User).filter(db.func.lower(User.email) == email.lower()).one_or_none()


def same(app, uid, **over):
    """An edit payload that changes nothing, built from the stored record."""
    with app.app_context():
        u = db.session.get(User, uid)
        b = {"name": u.name, "email": u.email, "userCode": u.user_code, "role": u.role_name, "departmentId": u.department_id}
    b.update(over)
    return b


def grant(app, role, key):
    with app.app_context():
        r = db.session.query(Role).filter_by(name=RoleName(role)).one()
        r.permissions.append(db.session.query(Permission).filter_by(key=key).one())
        db.session.commit()


@pytest.fixture()
def world(make, auth):
    admin = make.user("admin", email="a@campus.test", name="Root Admin")
    make.user("admin", email="a2@campus.test", name="Second Admin")
    fac = make.user("faculty", email="f@campus.test", name="Fran Faculty")
    stu = make.user("student", email="s@campus.test", name="Sam Student", code="23CSE001")
    return {"a": auth("a@campus.test"), "a2": auth("a2@campus.test"), "f": auth("f@campus.test"), "s": auth("s@campus.test"), "admin_id": admin, "fac_id": fac, "stu_id": stu}


# ================================================================ authorisation
def test_unauthenticated_students_and_plain_faculty_cannot_touch_user_management(client, world):
    for h, want in (({}, 401), (world["s"], 403), (world["f"], 403)):
        assert client.get(URL, headers=h).status_code == want
        assert client.post(URL, headers=h, json=new_user()).status_code == want
        assert client.put(f"{URL}/{world['stu_id']}", headers=h, json=new_user()).status_code == want
        assert client.post(f"{URL}/{world['stu_id']}/status", headers=h, json={"status": "inactive"}).status_code == want
        assert client.post(f"{URL}/{world['stu_id']}/reset-password", headers=h).status_code == want
        assert client.post(f"{URL}/import", headers=h, json={"rows": [{}]}).status_code == want
        assert client.get("/api/v1/admin/roles", headers=h).status_code == want
        assert client.put("/api/v1/admin/roles/faculty/permissions/reports.view", headers=h, json={"enabled": False}).status_code == want


def test_users_manage_permission_is_checked_per_request_even_for_admin(client, world, app):
    assert client.get(URL, headers=world["a"]).status_code == 200
    strip(app, "admin", "users.manage")
    assert client.get(URL, headers=world["a"]).status_code == 403


# ================================================================ listing
def test_list_paginates_filters_and_never_exposes_credentials(client, world, make):
    for i in range(12):
        make.user("student", name=f"Extra {i:02d}")
    r = client.get(URL, headers=world["a"], query_string={"pageSize": 5, "page": 2}).get_json()
    assert r["meta"]["total"] == 16 and r["meta"]["totalPages"] == 4 and len(r["data"]) == 5
    assert {u["role"] for u in client.get(URL, headers=world["a"], query_string={"role": "faculty"}).get_json()["data"]} == {"faculty"}
    assert [u["name"] for u in client.get(URL, headers=world["a"], query_string={"q": "fran"}).get_json()["data"]] == ["Fran Faculty"]
    assert client.get(URL, headers=world["a"], query_string={"q": "%"}).get_json()["data"] == []
    blob = client.get(URL, headers=world["a"], query_string={"pageSize": 100}).get_data(as_text=True).lower()
    assert "password" not in blob and "scrypt" not in blob and "failedlogin" not in blob and "locked" not in blob
    for bad in ({"role": "root"}, {"status": "x"}, {"page": 0}, {"pageSize": 101}, {"dept": "x"}):
        assert client.get(URL, headers=world["a"], query_string=bad).status_code == 422


# ================================================================ create
def test_create_staff_account_is_invited_with_an_unusable_password_and_audited(client, world, app):
    r = client.post(URL, headers=world["a"], json=new_user())
    d = r.get_json()["data"]
    assert r.status_code == 201 and d["status"] == "invited" and d["email"] == "meena@college.edu" and d["role"] == "faculty" and "password" not in str(d).lower()
    with app.app_context():
        u = db.session.query(User).filter_by(user_code="FAC100").one()
        assert u.faculty_profile is not None and db.session.query(PasswordResetToken).filter_by(user_id=u.id).count() == 1
    assert acts(app, "user.create") == [("user.create", "success", "Invited FAC100")]
    assert login(client, "meena@college.edu", PASSWORD).status_code in (401, 403)  # cannot sign in before setting a password


def test_invited_user_activates_by_setting_a_password_through_the_one_time_link(client, world, app):
    client.post(URL, headers=world["a"], json=new_user())
    raw = secrets.token_urlsafe(32)
    with app.app_context():  # the API never returns the token (a mailer would hold it), so the test mints a known one for the same user
        u = db.session.query(User).filter_by(user_code="FAC100").one()
        db.session.add(PasswordResetToken(user_id=u.id, token_hash=hashlib.sha256(raw.encode()).hexdigest(), expires_at=utcnow() + timedelta(hours=1)))
        db.session.commit()
    assert client.post("/api/v1/auth/reset-password", json={"token": raw, "password": "BrandNew9Pass"}).status_code == 200
    assert user_row(app, "meena@college.edu").status == UserStatus.ACTIVE
    assert login(client, "meena@college.edu", "BrandNew9Pass").status_code == 200
    assert ("user.activate", "success", "Invitation accepted") in acts(app)


def test_create_student_creates_an_unverified_student_record(client, world, app):
    d = client.post(URL, headers=world["a"], json=new_user(role="student", userCode="23ECE777", email="n@college.edu", departmentId=1, graduationYear=2027)).get_json()["data"]
    with app.app_context():
        s = db.session.query(Student).filter_by(student_code="23ECE777").one()
        assert s.graduation_year == 2027 and s.academic.cgpa_verified is False and s.academic.cgpa is None
    assert d["role"] == "student" and d["onboardingComplete"] is False


def test_student_graduation_year_defaults_to_the_active_academic_year(client, world, app):
    client.post(URL, headers=world["a"], json=new_user(role="student", userCode="23ECE778", email="m@college.edu", departmentId=1))
    with app.app_context():
        assert db.session.query(Student).filter_by(student_code="23ECE778").one().graduation_year == 2027  # seeded active year 2026-27


@pytest.mark.parametrize("over", [
    {"name": ""}, {"email": "nope"}, {"email": "a@b"}, {"userCode": ""}, {"userCode": "bad code!"}, {"role": "superuser"}, {"role": "student"},  # student without department
    {"departmentId": 9999}, {"graduationYear": 2027}, {"password": "x"}, {"status": "active"}, {"name": "x" * 200},
])
def test_invalid_create_requests_are_rejected_without_side_effects(client, world, app, over):
    before = len(client.get(URL, headers=world["a"], query_string={"pageSize": 100}).get_json()["data"])
    assert client.post(URL, headers=world["a"], json=new_user(**over)).status_code == 422
    assert len(client.get(URL, headers=world["a"], query_string={"pageSize": 100}).get_json()["data"]) == before


def test_duplicate_email_and_code_are_409_case_insensitively(client, world):
    assert client.post(URL, headers=world["a"], json=new_user(email="F@CAMPUS.TEST", userCode="ZZZ1")).status_code == 409
    assert client.post(URL, headers=world["a"], json=new_user(email="new@college.edu", userCode="23cse001")).status_code == 409
    assert client.post(URL, headers=world["a"], json=new_user()).status_code == 201
    assert client.post(URL, headers=world["a"], json=new_user()).status_code == 409


def test_a_failure_while_creating_leaves_no_half_created_account(client, world, app, monkeypatch):
    from app.services import auth_service
    monkeypatch.setattr(auth_service, "issue_reset_token", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    assert client.post(URL, headers=world["a"], json=new_user()).status_code == 500
    assert user_row(app, "meena@college.edu") is None
    with app.app_context():
        assert db.session.query(FacultyProfile).count() == 0 and acts(app, "user.create") == []


# ================================================================ escalation guards
def test_a_delegated_users_manage_holder_cannot_create_or_touch_administrators(client, world, app):
    grant(app, "faculty", "users.manage")
    assert client.get(URL, headers=world["f"]).status_code == 200
    assert client.post(URL, headers=world["f"], json=new_user(role="admin")).status_code == 403
    assert client.post(URL, headers=world["f"], json=new_user()).status_code == 201  # staff accounts are fine
    assert client.put(f"{URL}/{world['admin_id']}", headers=world["f"], json=same(app, world["admin_id"], role="faculty")).status_code == 403
    assert client.post(f"{URL}/{world['admin_id']}/status", headers=world["f"], json={"status": "inactive"}).status_code == 403
    assert client.post(f"{URL}/{world['admin_id']}/reset-password", headers=world["f"]).status_code == 403
    # promoting an existing account to admin
    r = client.put(f"{URL}/{world['fac_id']}", headers=world["f"], json=same(app, world["fac_id"], role="admin"))
    assert r.status_code == 403
    with app.app_context():
        assert db.session.get(User, world["admin_id"]).status == UserStatus.ACTIVE and db.session.get(User, world["fac_id"]).role_name == "faculty"
    assert [r for _, r, _ in acts(app, "access.denied")].count("denied") >= 4


def test_nobody_can_change_their_own_role_or_deactivate_themselves(client, world, app):
    me = client.get(f"{URL}", headers=world["a"], query_string={"q": "Root"}).get_json()["data"][0]
    assert client.put(f"{URL}/{me['id']}", headers=world["a"], json=same(app, world["admin_id"], role="faculty")).status_code == 409
    assert client.post(f"{URL}/{me['id']}/status", headers=world["a"], json={"status": "inactive"}).status_code == 409


def test_administrators_cannot_lock_the_platform_out_of_admin_access(client, world, app):
    other = client.get(URL, headers=world["a"], query_string={"q": "Second"}).get_json()["data"][0]
    assert client.post(f"{URL}/{other['id']}/status", headers=world["a"], json={"status": "inactive"}).status_code == 200
    me = client.get(URL, headers=world["a"], query_string={"q": "Root"}).get_json()["data"][0]
    assert client.post(f"{URL}/{me['id']}/status", headers=world["a"], json={"status": "inactive"}).status_code == 409  # self-deactivation is refused
    # defence in depth: the service itself knows that no other active administrator remains
    from app.services import users_service as svc
    with app.app_context():
        assert svc._other_active_admins(db.session.get(User, world["admin_id"])) == 0


def test_role_changes_between_staff_roles_are_audited_and_student_conversion_is_refused(client, world, app):
    r = client.put(f"{URL}/{world['fac_id']}", headers=world["a"], json=same(app, world["fac_id"], role="admin"))
    assert r.status_code == 200 and r.get_json()["data"]["role"] == "admin"
    assert acts(app, "user.role_change")[0][2] == "Changed: role faculty -> admin"
    assert client.put(f"{URL}/{world['stu_id']}", headers=world["a"], json=same(app, world["stu_id"], role="faculty")).status_code == 409
    assert client.put(f"{URL}/{world['fac_id']}", headers=world["a"], json=same(app, world["fac_id"], role="student")).status_code == 409


def test_role_change_takes_effect_on_the_next_request_with_an_old_token(client, world, app):
    assert client.get("/api/v1/admin/dashboard", headers=world["a2"]).status_code == 200
    a2_id = int(client.get(URL, headers=world['a'], query_string={'q': 'Second'}).get_json()['data'][0]['id'])
    client.put(f"{URL}/{a2_id}", headers=world["a"], json=same(app, a2_id, role="faculty"))
    assert client.get("/api/v1/admin/dashboard", headers=world["a2"]).status_code == 403


# ================================================================ edit
def test_edit_updates_fields_and_keeps_student_onboarding_code(client, world, app):
    with app.app_context():
        db.session.query(Student).filter_by(user_id=world["stu_id"]).one().student_code = "ROLL-9"  # chosen by the student at onboarding
        db.session.commit()
    r = client.put(f"{URL}/{world['stu_id']}", headers=world["a"], json=same(app, world["stu_id"], name="Samuel S", departmentId=2))
    assert r.status_code == 200 and r.get_json()["data"]["name"] == "Samuel S"
    with app.app_context():
        s = db.session.query(Student).filter_by(user_id=world["stu_id"]).one()
        assert s.student_code == "ROLL-9" and s.department_id == 2
    assert acts(app, "user.update")[0][2] == "Changed: name, department"


def test_edit_conflicts_unknown_ids_and_no_op(client, world, app):
    assert client.put(f"{URL}/{world['fac_id']}", headers=world["a"], json=same(app, world["fac_id"], email="s@campus.test")).status_code == 409
    assert client.put(f"{URL}/{world['fac_id']}", headers=world["a"], json=same(app, world["fac_id"], userCode="23cse001")).status_code == 409
    assert client.put(f"{URL}/99999", headers=world["a"], json=new_user()).status_code == 404
    assert client.put(f"{URL}/abc", headers=world["a"], json=new_user()).status_code == 404
    r = client.put(f"{URL}/{world['fac_id']}", headers=world["a"], json=same(app, world["fac_id"]))
    assert r.status_code == 200 and acts(app, "user.update") == []


def test_url_id_is_authoritative_over_a_body_id(client, world, app):
    r = client.put(f"{URL}/{world['fac_id']}", headers=world["a"], json=same(app, world["fac_id"], id=str(world["stu_id"]), name="Renamed"))
    assert r.get_json()["data"]["id"] == str(world["fac_id"]) and r.get_json()["data"]["name"] == "Renamed"


# ================================================================ status and reset
def test_deactivation_blocks_existing_sessions_and_new_sign_ins_and_is_reversible(client, world, app):
    assert client.get("/api/v1/auth/me", headers=world["f"]).status_code == 200
    assert client.post(f"{URL}/{world['fac_id']}/status", headers=world["a"], json={"status": "inactive"}).status_code == 200
    assert client.get("/api/v1/auth/me", headers=world["f"]).status_code == 401
    assert login(client, "f@campus.test").status_code in (401, 403)
    assert client.post(f"{URL}/{world['fac_id']}/status", headers=world["a"], json={"status": "active"}).status_code == 200
    assert login(client, "f@campus.test").status_code == 200
    assert [a for a, _, _ in acts(app, "user.")] == ["user.deactivate", "user.activate"]


def test_status_is_idempotent_and_validated(client, world, app):
    assert client.post(f"{URL}/{world['fac_id']}/status", headers=world["a"], json={"status": "active"}).status_code == 200
    assert acts(app, "user.activate") == []
    for bad in ({"status": "invited"}, {"status": "deleted"}, {}):
        assert client.post(f"{URL}/{world['fac_id']}/status", headers=world["a"], json=bad).status_code == 422
    assert client.post(f"{URL}/99999/status", headers=world["a"], json={"status": "active"}).status_code == 404


def test_reset_password_issues_a_token_without_revealing_it_and_refuses_deactivated_accounts(client, world, app):
    r = client.post(f"{URL}/{world['fac_id']}/reset-password", headers=world["a"])
    assert r.status_code == 200 and "token" not in r.get_data(as_text=True).lower()
    with app.app_context():
        assert db.session.query(PasswordResetToken).filter_by(user_id=world["fac_id"]).count() == 1
    client.post(f"{URL}/{world['fac_id']}/status", headers=world["a"], json={"status": "inactive"})
    assert client.post(f"{URL}/{world['fac_id']}/reset-password", headers=world["a"]).status_code == 409
    assert client.post(f"{URL}/99999/reset-password", headers=world["a"]).status_code == 404


# ================================================================ import
def row(**o):
    r = {"studentCode": "23CSE101", "name": "Ira Nair", "email": "ira@college.edu", "departmentCode": "CSE", "graduationYear": "2027", "cgpa": "8.2"}
    r.update(o)
    return r


def test_import_creates_invited_unverified_students_in_one_commit(client, world, app):
    r = client.post(f"{URL}/import", headers=world["a"], json={"rows": [row(), row(studentCode="23CSE102", email="jay@college.edu", name="Jay Roy", cgpa="")]})
    assert r.get_json()["data"] == {"total": 2, "imported": 2, "errors": []}
    with app.app_context():
        s = db.session.query(Student).filter_by(student_code="23CSE101").one()
        assert float(s.academic.cgpa) == 8.2 and s.academic.cgpa_verified is False and s.user.status == UserStatus.INVITED and s.user.onboarding_complete is False
        assert db.session.query(PasswordResetToken).count() == 2
    assert acts(app, "user.import") == [("user.import", "success", None)]


@pytest.mark.parametrize("over,field", [
    ({"studentCode": ""}, "studentCode"), ({"studentCode": "bad code"}, "studentCode"), ({"studentCode": "23cse001"}, "studentCode"), ({"name": ""}, "name"),
    ({"email": "nope"}, "email"), ({"email": "S@campus.test"}, "email"), ({"departmentCode": "XYZ"}, "departmentCode"), ({"graduationYear": "27"}, "graduationYear"),
    ({"cgpa": "11"}, "cgpa"), ({"cgpa": "abc"}, "cgpa"), ({"cgpa": "nan"}, "cgpa"),
])
def test_import_validates_each_field_and_reports_row_numbers(client, world, over, field):
    r = client.post(f"{URL}/import", headers=world["a"], json={"rows": [row(**over)]}).get_json()["data"]
    assert r["imported"] == 0 and r["errors"][0]["field"] == field and r["errors"][0]["row"] == 2


def test_import_imports_valid_rows_reports_the_rest_and_catches_duplicates_inside_the_file(client, world, app):
    rows = [row(), row(), row(studentCode="23CSE103", email="kay@college.edu", departmentCode="NOPE")]
    r = client.post(f"{URL}/import", headers=world["a"], json={"rows": rows}).get_json()["data"]
    assert r["imported"] == 1 and {(e["row"], e["field"]) for e in r["errors"]} == {(3, "studentCode"), (3, "email"), (4, "departmentCode")}
    assert acts(app, "user.import")[0][2] == "3 validation error(s)"


@pytest.mark.parametrize("body", [{"rows": []}, {"rows": "x"}, {}, {"rows": [{"unknown": 1}]}, {"rows": [row()] * 501}])
def test_import_rejects_malformed_payloads(client, world, body):
    assert client.post(f"{URL}/import", headers=world["a"], json=body).status_code == 422


def test_import_is_atomic_if_the_database_fails_part_way(client, world, app, monkeypatch):
    from app.services import auth_service
    calls = {"n": 0}
    real = auth_service.issue_reset_token

    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return real(*a, **k)

    monkeypatch.setattr(auth_service, "issue_reset_token", flaky)
    assert client.post(f"{URL}/import", headers=world["a"], json={"rows": [row(), row(studentCode="23CSE102", email="jay@college.edu")]}).status_code == 500
    assert user_row(app, "ira@college.edu") is None and user_row(app, "jay@college.edu") is None


# ================================================================ roles & permissions
RP = "/api/v1/admin/roles"


def test_roles_overview_lists_permissions_matrix_and_counts(client, world):
    d = client.get(RP, headers=world["a"]).get_json()["data"]
    assert {p["key"] for p in d["permissions"]} >= {"students.view", "roles.manage", "audit.view"} and set(d["matrix"]) == {"admin", "faculty", "student"}
    assert d["matrix"]["student"] == [] and "reports.view" in d["matrix"]["faculty"] and d["userCounts"] == {"admin": 2, "faculty": 1, "student": 1}


def test_toggling_a_permission_changes_access_immediately_and_is_audited(client, world, app):
    assert client.get("/api/v1/students", headers=world["f"]).status_code == 200
    r = client.put(f"{RP}/faculty/permissions/students.view", headers=world["a"], json={"enabled": False})
    assert r.status_code == 200 and "students.view" not in r.get_json()["data"]
    assert client.get("/api/v1/students", headers=world["f"]).status_code == 403  # same token, new matrix
    client.put(f"{RP}/faculty/permissions/students.view", headers=world["a"], json={"enabled": True})
    assert client.get("/api/v1/students", headers=world["f"]).status_code == 200
    assert [r for _, _, r in acts(app, "role.permissions")] == ["Revoked students.view", "Granted students.view"]


def test_setting_a_permission_to_its_current_state_is_a_silent_no_op(client, world, app):
    assert client.put(f"{RP}/faculty/permissions/students.view", headers=world["a"], json={"enabled": True}).status_code == 200
    assert acts(app, "role.permissions") == []


def test_the_student_role_can_never_receive_staff_permissions(client, world, app):
    assert client.put(f"{RP}/student/permissions/students.view", headers=world["a"], json={"enabled": True}).status_code == 409
    assert client.get("/api/v1/students", headers=world["s"]).status_code == 403


@pytest.mark.parametrize("perm", ["roles.manage", "users.manage"])
def test_admin_cannot_remove_the_permissions_that_would_lock_administrators_out(client, world, perm):
    assert client.put(f"{RP}/admin/permissions/{perm}", headers=world["a"], json={"enabled": False}).status_code == 409
    assert client.get(RP, headers=world["a"]).status_code == 200


def test_roles_manage_can_never_be_delegated_and_a_delegate_cannot_edit_the_matrix(client, world, app):
    assert client.put(f"{RP}/faculty/permissions/roles.manage", headers=world["a"], json={"enabled": True}).status_code == 409
    grant(app, "faculty", "roles.manage")  # simulate a misconfigured database
    assert client.get(RP, headers=world["f"]).status_code == 200
    r = client.put(f"{RP}/faculty/permissions/users.manage", headers=world["f"], json={"enabled": True})
    assert r.status_code == 403  # not an administrator: cannot grant themselves anything
    assert "users.manage" not in client.get(RP, headers=world["a"]).get_json()["data"]["matrix"]["faculty"]


@pytest.mark.parametrize("path,body,want", [
    ("/nobody/permissions/students.view", {"enabled": False}, 404), ("/faculty/permissions/does.not.exist", {"enabled": False}, 404),
    ("/faculty/permissions/students.view", {"enabled": "yes"}, 422), ("/faculty/permissions/students.view", {}, 422), ("/faculty/permissions/students.view", {"enabled": True, "x": 1}, 422),
])
def test_matrix_edits_validate_input(client, world, path, body, want):
    assert client.put(RP + path, headers=world["a"], json=body).status_code == want


# ================================================================ dashboard audit data
def test_admin_dashboard_activity_requires_audit_view(client, world, app):
    assert len(client.get("/api/v1/admin/dashboard", headers=world["a"]).get_json()["data"]["activity"]) > 0
    strip(app, "admin", "audit.view")
    d = client.get("/api/v1/admin/dashboard", headers=world["a"]).get_json()["data"]
    assert d["activity"] == [] and not any("denied access" in a["text"] for a in d["alerts"])
