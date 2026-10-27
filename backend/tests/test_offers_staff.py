"""Placement-cell offer management: list, issue, status changes, policy enforcement."""
from datetime import timedelta

import pytest

from app.extensions import db
from app.models import (
    Application, ApplicationStatus as S, AuditLog, CompanyTier, Notification, Offer, OfferStatus as O, PlacementPolicy, PolicyKind, Student, utcnow,
)

from .test_jobs_admin import strip

URL = "/api/v1/offers"


def when(days=7):
    return (utcnow() + timedelta(days=days)).isoformat() + "Z"


def issue(client, h, aid, ctc=8.5, **over):
    return client.post(URL, headers=h, json={"applicationId": aid, "ctcLpa": ctc, "acceptBy": when(), **over})


def setst(client, h, oid, status, **extra):
    return client.post(f"{URL}/{oid}/status", headers=h, json={"status": status, **extra})


def actions(app, prefix="offer"):
    with app.app_context():
        return [(a.action, a.result.value) for a in db.session.query(AuditLog).order_by(AuditLog.id) if a.action.startswith(prefix)]


@pytest.fixture()
def world(make, auth):
    make.user("faculty", email="f@campus.test")
    make.user("admin", email="a@campus.test")
    ann = make.user("student", email="ann@campus.test", name="Ann Alpha", code="23CSE001", dept="CSE")
    bob = make.user("student", email="bob@campus.test", name="Bob Beta", code="23IT002", dept="IT")
    zoho, tcs = make.company("Zoho"), make.company("TCS")
    j1, j2, j3 = make.job(zoho, "Dev", depts=()), make.job(tcs, "Analyst", depts=()), make.job(make.company("Acme"), "QA", depts=())
    return {"f": auth("f@campus.test"), "a": auth("a@campus.test"), "s": auth("ann@campus.test"), "ann_u": ann, "bob_u": bob, "j1": j1, "j2": j2, "j3": j3,
            "ann": make.application(ann, j1, S.SELECTED), "bob": make.application(bob, j2, S.SELECTED), "ann2": make.application(ann, j2, S.SELECTED), "ann3": make.application(ann, j3, S.SELECTED)}


# ============================================================ authorisation
def test_unauthenticated_and_students_cannot_list_issue_or_change_offers(client, world, app):
    for h, want in (({}, 401), (world["s"], 403)):
        assert client.get(URL, headers=h).status_code == want
        assert issue(client, h, world["ann"]).status_code == want
        assert setst(client, h, 1, "accepted").status_code == want
    with app.app_context():
        assert db.session.query(Offer).count() == 0


def test_offers_manage_is_required_even_for_faculty(client, world, app):
    strip(app, "faculty", "offers.manage")
    assert client.get(URL, headers=world["f"]).status_code == 403
    assert issue(client, world["f"], world["ann"]).status_code == 403


def test_admin_can_issue(client, world):
    assert issue(client, world["a"], world["ann"]).status_code == 201


# ============================================================ issuing
def test_issuing_is_one_transaction_that_updates_everything_it_should(client, world, app):
    r = issue(client, world["f"], world["ann"], 9.25)
    d = r.get_json()["data"]
    assert r.status_code == 201 and d["offer"]["status"] == "received" and d["offer"]["ctcLpa"] == 9.25 and d["student"]["name"] == "Ann Alpha"
    assert d["offer"]["policyChecks"]  # checks are recorded on the offer
    with app.app_context():
        a = db.session.get(Application, world["ann"])
        assert a.status == S.OFFER_RECEIVED and a.history[-1].note == "Official offer issued"
        assert db.session.query(Notification).filter_by(user_id=world["ann_u"], link="/student/offers").count() == 1
    assert actions(app) == [("offer.create", "success")]
    assert client.get("/api/v1/offers/me", headers=world["s"]).get_json()["data"][0]["offer"]["id"] == d["offer"]["id"]


@pytest.mark.parametrize("st", [S.APPLIED, S.SHORTLISTED, S.INTERVIEW, S.REJECTED, S.WITHDRAWN])
def test_only_selected_applications_can_receive_an_offer(client, world, app, st):
    with app.app_context():
        db.session.get(Application, world["ann"]).status = st
        db.session.commit()
    assert issue(client, world["f"], world["ann"]).status_code == 409


def test_duplicate_offers_are_refused(client, world):
    assert issue(client, world["f"], world["ann"]).status_code == 201
    assert issue(client, world["f"], world["ann"]).status_code == 409


@pytest.mark.parametrize("over", [{"ctc": 0}, {"ctc": -3}, {"ctc": 5000}, {"acceptBy": "2001-01-01T00:00:00Z"}, {"acceptBy": "tomorrow"}, {"applicationId": "x"}, {"extra": 1}])
def test_invalid_inputs_are_rejected_without_side_effects(client, world, app, over):
    body = {"applicationId": world["ann"], "ctcLpa": 8, "acceptBy": when()}
    if "ctc" in over:
        body["ctcLpa"] = over["ctc"]
    else:
        body.update(over)
    assert client.post(URL, headers=world["f"], json=body).status_code == 422
    with app.app_context():
        assert db.session.query(Offer).count() == 0 and db.session.get(Application, world["ann"]).status == S.SELECTED


def test_unknown_application_is_404_and_cancelled_jobs_are_refused(client, world, app):
    assert issue(client, world["f"], 99999).status_code == 404
    from app.models import Job, JobStatus
    with app.app_context():
        db.session.get(Job, world["j1"]).status = JobStatus.CANCELLED
        db.session.commit()
    assert issue(client, world["f"], world["ann"]).status_code == 409


def test_policy_limit_blocks_issuing_an_offer_the_student_could_never_accept_and_audits_it(client, world, app):
    # default policy: at most 2 accepted offers
    for k in ("ann", "ann2"):
        oid = issue(client, world["f"], world[k]).get_json()["data"]["offer"]["id"]
        assert setst(client, world["f"], oid, "accepted").status_code == 200
    r = issue(client, world["f"], world["ann3"])
    assert r.status_code == 409 and "Policy check failed" in r.get_json()["error"]["message"]
    with app.app_context():
        assert db.session.get(Application, world["ann3"]).status == S.SELECTED and db.session.query(Offer).count() == 2
    assert ("offer.create", "denied") in actions(app)


def test_the_limit_is_read_from_policy_data_not_hardcoded(client, world, app):
    with app.app_context():
        p = db.session.query(PlacementPolicy).filter_by(kind=PolicyKind.MAX_OFFERS).one()
        p.params = {"maxAcceptedOffers": 1}
        db.session.commit()
    oid = issue(client, world["f"], world["ann"]).get_json()["data"]["offer"]["id"]
    setst(client, world["f"], oid, "accepted")
    assert issue(client, world["f"], world["ann2"]).status_code == 409


def test_a_failure_while_issuing_rolls_the_whole_operation_back(client, world, app, monkeypatch):
    from app.services import offers_service as svc

    def boom(*a, **k):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(svc, "notify", boom)
    r = issue(client, world["f"], world["ann"])
    assert r.status_code == 500 and "secret" not in r.get_data(as_text=True)
    with app.app_context():
        assert db.session.query(Offer).count() == 0 and db.session.get(Application, world["ann"]).status == S.SELECTED
    assert actions(app) == []


# ============================================================ status changes
def test_staff_status_graph(client, world, app):
    oid = issue(client, world["f"], world["ann"]).get_json()["data"]["offer"]["id"]
    assert setst(client, world["f"], oid, "received").status_code == 409  # received -> received
    assert setst(client, world["f"], oid, "accepted").status_code == 200
    with app.app_context():
        assert db.session.query(Student).filter_by(student_code="23CSE001").one().placement_status.value == "placed"
    assert setst(client, world["f"], oid, "declined").status_code == 409  # accepted -> declined not allowed
    assert setst(client, world["f"], oid, "withdrawn", reason="Company rescinded").status_code == 200
    with app.app_context():
        assert db.session.query(Student).filter_by(student_code="23CSE001").one().placement_status.value == "in_process"
    for st in ("accepted", "declined", "withdrawn", "received"):
        assert setst(client, world["f"], oid, st, reason="again please").status_code == 409  # withdrawn is final


def test_withdrawing_needs_a_reason_and_is_audited_and_notified(client, world, app):
    oid = issue(client, world["f"], world["bob"]).get_json()["data"]["offer"]["id"]
    assert setst(client, world["f"], oid, "withdrawn").status_code == 422
    assert setst(client, world["f"], oid, "withdrawn", reason="  ").status_code == 422
    assert setst(client, world["f"], oid, "withdrawn", reason="Headcount frozen").status_code == 200
    with app.app_context():
        log = db.session.query(AuditLog).filter_by(action="offer.withdrawn").one()
        assert log.reason == "Headcount frozen"
        assert db.session.query(Notification).filter(Notification.title.like("Offer update%")).count() == 1


def test_declined_is_final_and_invalid_values_are_422(client, world):
    oid = issue(client, world["f"], world["ann"]).get_json()["data"]["offer"]["id"]
    assert setst(client, world["f"], oid, "bogus").status_code == 422
    assert setst(client, world["f"], oid, "pending").status_code == 422
    assert setst(client, world["f"], oid, "declined").status_code == 200
    assert setst(client, world["f"], oid, "accepted").status_code == 409
    assert setst(client, world["f"], 99999, "accepted").status_code == 404


def test_staff_acceptance_is_policy_checked_and_may_follow_the_student_deadline(client, world, app):
    oid = issue(client, world["f"], world["ann"]).get_json()["data"]["offer"]["id"]
    with app.app_context():
        db.session.get(Offer, int(oid)).accept_by = utcnow() - timedelta(days=1)
        db.session.commit()
    assert client.post(f"{URL}/{oid}/respond", headers=world["s"], json={"decision": "accepted"}).status_code == 409  # student: too late
    assert setst(client, world["f"], oid, "accepted").status_code == 200  # placement cell may still record it


# ============================================================ listing
def test_listing_paginates_filters_and_carries_summaries(client, world):
    for k in ("ann", "bob"):
        issue(client, world["f"], world[k])
    r = client.get(URL, headers=world["f"], query_string={"pageSize": 1}).get_json()
    assert r["meta"]["total"] == 2 and r["meta"]["totalPages"] == 2 and len(r["data"]) == 1
    assert r["meta"]["totals"] == {"offers": 2, "accepted": 0, "placed": 0}
    assert {c["company"] for c in r["meta"]["byCompany"]} == {"Zoho", "TCS"}
    assert any(d["dept"] == "CSE" and d["offers"] == 1 for d in r["meta"]["byDept"])
    assert [x["student"]["name"] for x in client.get(URL, headers=world["f"], query_string={"q": "bob"}).get_json()["data"]] == ["Bob Beta"]
    assert client.get(URL, headers=world["f"], query_string={"status": "accepted"}).get_json()["data"] == []
    assert len(r["meta"]["selectedWithoutOffer"]) == 2  # ann2 and ann3 are still waiting
    for bad in ({"status": "x"}, {"page": 0}, {"pageSize": 101}, {"dept": "x"}):
        assert client.get(URL, headers=world["f"], query_string=bad).status_code == 422


def test_staff_listing_masks_phones_for_faculty_but_not_admin(client, world, app):
    with app.app_context():
        db.session.query(Student).filter_by(student_code="23CSE001").one().phone = "+91 98400 12345"
        db.session.commit()
    issue(client, world["f"], world["ann"])
    f = client.get(URL, headers=world["f"]).get_data(as_text=True)
    a = client.get(URL, headers=world["a"]).get_data(as_text=True)
    assert "98400 12345" not in f and "98400 12345" in a
    assert "password" not in a.lower()
