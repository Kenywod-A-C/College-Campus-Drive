"""Staff-side applicant review: listing, bulk stage changes, exceptions, CSV export."""
import csv
import io

import pytest

from app.extensions import db
from app.models import (
    Application, ApplicationEligibilitySnapshot, ApplicationStatus as S, AuditLog, EligibilityState, Job, JobStatus, Notification, Student, User,
)

from .test_jobs_admin import strip


def L(client, h, **p):
    return client.get("/api/v1/applications", headers=h, query_string=p)


def stage(client, h, ids, status, **extra):
    return client.post("/api/v1/applications/stage", headers=h, json={"ids": ids, "status": status, **extra})


def status_of(app, aid):
    with app.app_context():
        return db.session.get(Application, aid).status.value


def audits(app, prefix=""):
    with app.app_context():
        return [(a.action, a.result.value, a.reason, a.resource) for a in db.session.query(AuditLog).order_by(AuditLog.id) if a.action.startswith(prefix)]


@pytest.fixture()
def world(make, auth):
    make.user("faculty", email="f@campus.test")
    make.user("admin", email="a@campus.test")
    ann = make.user("student", email="ann@campus.test", name="Ann Alpha", code="23CSE001", dept="CSE", cgpa=9.1, phone="+91 98400 12345")
    bob = make.user("student", email="bob@campus.test", name="Bob Beta", code="23IT002", dept="IT", cgpa=7.2)
    cy = make.user("student", email="cy@campus.test", name="Cy Gamma", code="23CSE003", dept="CSE", cgpa=8.0)
    zoho, tcs = make.company("Zoho"), make.company("TCS")
    j1, j2 = make.job(zoho, "Backend Dev", depts=()), make.job(tcs, "Analyst", depts=())
    return {
        "f": auth("f@campus.test"), "a": auth("a@campus.test"), "s": auth("ann@campus.test"),
        "ann": make.application(ann, j1), "bob": make.application(bob, j1), "cy": make.application(cy, j2), "j1": j1, "j2": j2, "zoho": zoho, "tcs": tcs,
    }


def make_ineligible(app, aid, state=EligibilityState.NOT_ELIGIBLE):
    with app.app_context():
        sn = db.session.query(ApplicationEligibilitySnapshot).filter_by(application_id=aid).one()
        sn.state, sn.summary = state, "Not eligible: minimum cgpa."
        db.session.commit()


# ================================================================== authorisation
def test_unauthenticated_and_students_cannot_use_any_review_endpoint(client, app, world):
    for h, want in (({}, 401), (world["s"], 403)):
        assert L(client, h).status_code == want
        assert stage(client, h, [world["ann"]], "shortlisted").status_code == want
        assert client.get("/api/v1/applications/export", headers=h).status_code == want
    assert status_of(app, world["ann"]) == "applied"


def test_role_escalation_through_the_stage_endpoint_changes_nothing_and_is_audited(client, world, app):
    assert stage(client, world["s"], [world["ann"], world["bob"]], "selected").status_code == 403
    assert status_of(app, world["bob"]) == "applied" and status_of(app, world["ann"]) == "applied"
    assert [r for _, r, _, _ in audits(app, "access.denied")] == ["denied"]


def test_faculty_and_admin_can_review(client, world):
    assert L(client, world["f"]).status_code == 200
    assert L(client, world["a"]).status_code == 200


def test_applications_review_permission_is_required_even_for_faculty(client, world, app):
    strip(app, "faculty", "applications.review")
    assert L(client, world["f"]).status_code == 403
    assert stage(client, world["f"], [world["ann"]], "shortlisted").status_code == 403
    assert status_of(app, world["ann"]) == "applied"


def test_export_needs_both_reports_view_and_applications_review(client, world, app):
    assert client.get("/api/v1/applications/export", headers=world["f"]).status_code == 200
    strip(app, "faculty", "reports.view")
    assert client.get("/api/v1/applications/export", headers=world["f"]).status_code == 403


# ================================================================== listing
def test_listing_masks_phone_for_faculty_not_admin_and_never_leaks_credentials(client, world):
    ann = next(r for r in L(client, world["f"]).get_json()["data"] if r["student"]["name"] == "Ann Alpha")
    assert "•" in ann["student"]["phone"] and "98400 12345" not in ann["student"]["phone"]
    full = next(r for r in L(client, world["a"]).get_json()["data"] if r["student"]["name"] == "Ann Alpha")
    assert full["student"]["phone"] == "+91 98400 12345"
    blob = L(client, world["a"]).get_data(as_text=True).lower()
    assert "password" not in blob and "scrypt" not in blob and "token" not in blob
    assert ann["application"]["eligibilitySnapshot"]["state"] == "eligible"


def test_pagination_meta_and_disjoint_pages(client, world):
    p1 = L(client, world["f"], pageSize=2, page=1).get_json()
    p2 = L(client, world["f"], pageSize=2, page=2).get_json()
    assert p1["meta"] == {"page": 1, "pageSize": 2, "total": 3, "totalPages": 2}
    ids = [r["application"]["id"] for r in p1["data"] + p2["data"]]
    assert len(ids) == 3 == len(set(ids))
    assert L(client, world["f"], page=9).get_json()["data"] == []


@pytest.mark.parametrize("params,expected", [
    ({"q": "ann"}, {"Ann Alpha"}), ({"q": "23IT"}, {"Bob Beta"}), ({"q": "tcs"}, {"Cy Gamma"}), ({"q": "analyst"}, {"Cy Gamma"}),
    ({"dept": "IT"}, {"Bob Beta"}), ({"status": "applied"}, {"Ann Alpha", "Bob Beta", "Cy Gamma"}), ({"status": "selected"}, set()),
    ({"status": "all"}, {"Ann Alpha", "Bob Beta", "Cy Gamma"}), ({"q": "%"}, set()), ({"q": "_"}, set()),
])
def test_filters(client, world, params, expected):
    if params.get("dept"):
        ref = client.get("/api/v1/reference/filters", headers=world["f"]).get_json()["data"]["departments"]
        params = {**params, "dept": next(d["value"] for d in ref if d["label"] == params["dept"])}
    assert {r["student"]["name"] for r in L(client, world["f"], **params).get_json()["data"]} == expected


def test_company_job_eligibility_filters_and_sorting(client, world, app):
    make_ineligible(app, world["bob"])
    names = lambda **p: [r["student"]["name"] for r in L(client, world["f"], **p).get_json()["data"]]  # noqa: E731
    assert names(companyId=world["tcs"]) == ["Cy Gamma"]
    assert set(names(jobId=world["j1"])) == {"Ann Alpha", "Bob Beta"}
    assert names(eligibility="not_eligible") == ["Bob Beta"]
    assert names(sort="cgpa") == ["Ann Alpha", "Cy Gamma", "Bob Beta"]
    assert names(sort="name") == ["Ann Alpha", "Bob Beta", "Cy Gamma"]


@pytest.mark.parametrize("bad", [{"page": 0}, {"pageSize": 101}, {"status": "hired"}, {"sort": "random"}, {"eligibility": "maybe"}, {"dept": "x"}, {"extra": "1"}])
def test_invalid_query_parameters_are_422(client, world, bad):
    assert L(client, world["f"], **bad).status_code == 422


# ================================================================== stage transitions
def test_forward_transition_records_history_notifies_the_student_and_audits(client, world, app):
    r = stage(client, world["f"], [world["ann"]], "shortlisted", note="Strong profile")
    assert r.status_code == 200 and r.get_json()["data"] == {"updated": [str(world["ann"])], "failed": []}
    with app.app_context():
        a = db.session.get(Application, world["ann"])
        assert a.status == S.SHORTLISTED and a.history[-1].note == "Strong profile" and a.history[-1].changed_by_name.startswith("Faculty")
        assert db.session.query(Notification).filter_by(user_id=a.student.user_id, link=f"/student/applications/{a.id}").count() == 1
    assert [x[:3] for x in audits(app, "application.shortlisted")] == [("application.shortlisted", "success", "applied -> shortlisted")]


def test_full_happy_path_and_forward_stage_skipping(client, world, app):
    for st in ("shortlisted", "interview", "selected"):
        assert stage(client, world["f"], [world["ann"]], st).get_json()["data"]["failed"] == []
    assert status_of(app, world["ann"]) == "selected"
    assert stage(client, world["f"], [world["bob"]], "selected").get_json()["data"]["updated"] == [str(world["bob"])]


@pytest.mark.parametrize("first,then", [("interview", "shortlisted"), ("selected", "interview"), ("shortlisted", "shortlisted"), ("selected", "selected")])
def test_backward_or_repeated_moves_are_refused_per_row(client, world, app, first, then):
    stage(client, world["f"], [world["ann"]], first)
    r = stage(client, world["f"], [world["ann"]], then).get_json()["data"]
    assert r["updated"] == [] and "already at or beyond" in r["failed"][0]["reason"]
    assert status_of(app, world["ann"]) == first


def test_rejected_withdrawn_and_offer_received_are_terminal(client, world, app):
    stage(client, world["f"], [world["ann"]], "rejected")
    assert "already rejected" in stage(client, world["f"], [world["ann"]], "shortlisted").get_json()["data"]["failed"][0]["reason"]
    with app.app_context():
        db.session.get(Application, world["bob"]).status = S.WITHDRAWN
        db.session.get(Application, world["cy"]).status = S.OFFER_RECEIVED
        db.session.commit()
    r = stage(client, world["f"], [world["bob"], world["cy"]], "rejected").get_json()["data"]
    assert r["updated"] == [] and {f["id"] for f in r["failed"]} == {str(world["bob"]), str(world["cy"])}


@pytest.mark.parametrize("target", ["offer_received", "withdrawn", "applied"])
def test_stages_that_are_not_reviewer_actions_are_rejected_by_validation(client, world, app, target):
    assert stage(client, world["f"], [world["ann"]], target).status_code == 422
    assert status_of(app, world["ann"]) == "applied"


def test_a_selected_applicant_with_an_offer_cannot_be_rejected(client, world, make, app):
    make.offer(world["ann"])
    with app.app_context():
        db.session.get(Application, world["ann"]).status = S.SELECTED
        db.session.commit()
    r = stage(client, world["f"], [world["ann"]], "rejected").get_json()["data"]
    assert "withdraw the offer" in r["failed"][0]["reason"] and status_of(app, world["ann"]) == "selected"


def test_cancelled_jobs_cannot_advance_applicants_but_can_reject_them(client, world, app):
    with app.app_context():
        db.session.get(Job, world["j1"]).status = JobStatus.CANCELLED
        db.session.commit()
    assert "cancelled" in stage(client, world["f"], [world["ann"]], "shortlisted").get_json()["data"]["failed"][0]["reason"]
    assert stage(client, world["f"], [world["ann"]], "rejected").get_json()["data"]["updated"] == [str(world["ann"])]


def test_bulk_requests_apply_valid_rows_report_the_rest_and_dedupe_ids(client, world, app):
    stage(client, world["f"], [world["bob"]], "interview")
    r = stage(client, world["f"], [world["ann"], world["bob"], 99999, world["ann"]], "shortlisted").get_json()["data"]
    assert r["updated"] == [str(world["ann"])]
    assert {f["id"] for f in r["failed"]} == {str(world["bob"]), "99999"}
    assert status_of(app, world["ann"]) == "shortlisted" and status_of(app, world["bob"]) == "interview"
    assert len(audits(app, "application.shortlisted")) == 1


def test_a_rejected_application_still_counts_as_in_process_history(client, world, app):
    stage(client, world["f"], [world["cy"]], "rejected")
    with app.app_context():
        assert db.session.query(Student).filter_by(student_code="23CSE003").one().placement_status.value == "in_process"


@pytest.mark.parametrize("body", [
    {"ids": [], "status": "shortlisted"}, {"ids": [1], "status": "nope"}, {"ids": ["x"], "status": "shortlisted"}, {"status": "shortlisted"},
    {"ids": list(range(1, 102)), "status": "shortlisted"}, {"ids": [1], "status": "shortlisted", "role": "admin"},
    {"ids": [1], "status": "shortlisted", "note": "x" * 300}, {"ids": [1], "status": "shortlisted", "exception": {"reason": "x"}},
])
def test_invalid_bodies_are_422_with_no_side_effects(client, world, app, body):
    assert client.post("/api/v1/applications/stage", headers=world["f"], json=body).status_code == 422
    assert audits(app, "application.") == []


def test_a_failure_part_way_through_a_bulk_change_rolls_everything_back(client, world, app, monkeypatch):
    from app.services import applications_review_service as svc

    calls, real = {"n": 0}, svc.notify

    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return real(*a, **k)

    monkeypatch.setattr(svc, "notify", flaky)
    r = stage(client, world["f"], [world["ann"], world["bob"]], "shortlisted")
    assert r.status_code == 500 and "boom" not in r.get_data(as_text=True)
    assert status_of(app, world["ann"]) == "applied" and status_of(app, world["bob"]) == "applied"
    assert audits(app, "application.") == []


# ================================================================== eligibility exceptions
def test_not_eligible_applicants_are_not_advanced_without_an_exception(client, world, app):
    make_ineligible(app, world["bob"])
    r = stage(client, world["f"], [world["bob"]], "shortlisted").get_json()["data"]
    assert r["updated"] == [] and "exception is required" in r["failed"][0]["reason"]
    assert status_of(app, world["bob"]) == "applied"


def test_a_recorded_exception_advances_stores_reason_and_approver_and_audits(client, world, app):
    make_ineligible(app, world["bob"], EligibilityState.NEEDS_VERIFICATION)
    r = stage(client, world["f"], [world["bob"]], "shortlisted", exception={"reason": "CGPA verification pending, approved by HOD", "approvedBy": "Dr. Rao"})
    assert r.get_json()["data"]["updated"] == [str(world["bob"])]
    detail = client.get(f"/api/v1/applications/{world['bob']}", headers=world["f"]).get_json()["data"]
    assert detail["application"]["eligibilitySnapshot"]["exceptionGranted"] == {"reason": "CGPA verification pending, approved by HOD", "approvedBy": "Dr. Rao"}
    assert any("Dr. Rao" in (why or "") for _, _, why, _ in audits(app, "eligibility.exception"))


def test_exceptions_are_not_needed_to_reject(client, world, app):
    make_ineligible(app, world["bob"])
    assert stage(client, world["f"], [world["bob"]], "rejected").get_json()["data"]["updated"] == [str(world["bob"])]
    assert audits(app, "eligibility.exception") == []


def test_an_exception_supplied_for_an_eligible_applicant_is_not_recorded(client, world, app):
    stage(client, world["f"], [world["ann"]], "shortlisted", exception={"reason": "not needed at all", "approvedBy": "Dr. Rao"})
    assert audits(app, "eligibility.exception") == []


# ================================================================== record-level access
def test_students_cannot_read_other_students_applications_and_unknown_ids_are_404(client, world):
    assert client.get(f"/api/v1/applications/{world['bob']}", headers=world["s"]).status_code == 403
    assert client.get(f"/api/v1/applications/{world['ann']}", headers=world["s"]).status_code == 200
    assert client.get("/api/v1/applications/99999", headers=world["f"]).status_code == 404


# ================================================================== export
def parse(r):
    return list(csv.reader(io.StringIO(r.get_json()["data"])))


def test_export_contains_filtered_rows_has_no_contact_columns_and_is_audited(client, world, app):
    rows = parse(client.get("/api/v1/applications/export", headers=world["f"], query_string={"companyId": world["zoho"]}))
    assert rows[0][:3] == ["Student ID", "Name", "Department"] and {r[1] for r in rows[1:]} == {"Ann Alpha", "Bob Beta"}
    assert not any("•" in c or "@" in c or "98400" in c for r in rows for c in r)
    assert [x[3] for x in audits(app, "report.export")] == ["Applications CSV (2 rows)"]


def test_export_neutralises_spreadsheet_formulas(client, world, app):
    with app.app_context():
        db.session.query(User).filter_by(email="ann@campus.test").one().name = '=HYPERLINK("http://evil","x")'
        db.session.commit()
    assert any(r[1].startswith("'=HYPERLINK") for r in parse(client.get("/api/v1/applications/export", headers=world["a"])))


def test_export_rejects_invalid_filters(client, world):
    assert client.get("/api/v1/applications/export", headers=world["f"], query_string={"status": "bogus"}).status_code == 422
