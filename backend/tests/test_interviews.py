"""Interview scheduling, outcomes and notifications."""
from datetime import timedelta

import pytest

from app.extensions import db
from app.models import Application, ApplicationStatus as S, AuditLog, Interview, InterviewStatus, Job, JobStatus, Notification, utcnow

from .test_jobs_admin import strip

URL = "/api/v1/interviews"


def when(hours=48):
    return (utcnow() + timedelta(hours=hours)).isoformat() + "Z"


def body(world, apps=None, **over):
    b = {"jobId": world["j1"], "applicationIds": apps or [world["ann"], world["bob"]], "round": "Technical Round", "at": when(), "durationMins": 45, "location": "Block C, Room 4"}
    b.update(over)
    return b


def audit_actions(app, prefix="interview"):
    with app.app_context():
        return [a.action for a in db.session.query(AuditLog).order_by(AuditLog.id) if a.action.startswith(prefix)]


@pytest.fixture()
def world(make, auth):
    make.user("faculty", email="f@campus.test")
    make.user("admin", email="a@campus.test")
    ann = make.user("student", email="ann@campus.test", name="Ann Alpha", code="23CSE001")
    bob = make.user("student", email="bob@campus.test", name="Bob Beta", code="23CSE002")
    cy = make.user("student", email="cy@campus.test", name="Cy Gamma", code="23CSE003")
    co = make.company("Zoho")
    j1, j2 = make.job(co, "Backend Dev", depts=()), make.job(co, "Analyst", depts=())
    return {
        "f": auth("f@campus.test"), "a": auth("a@campus.test"), "ann_h": auth("ann@campus.test"), "cy_h": auth("cy@campus.test"), "j1": j1, "j2": j2,
        "ann": make.application(ann, j1, S.SHORTLISTED), "bob": make.application(bob, j1, S.SHORTLISTED), "cy": make.application(cy, j1, S.APPLIED),
        "ann_j2": make.application(ann, j2, S.SHORTLISTED), "co": co,
    }


def create(client, h, world, **over):
    return client.post(URL, headers=h, json=body(world, **over))


# ============================================================ authorisation
def test_unauthenticated_and_students_cannot_schedule_or_manage(client, world):
    for h, want in (({}, 401), (world["ann_h"], 403)):
        assert create(client, h, world).status_code == want
        assert client.put(f"{URL}/1", headers=h, json=body(world)).status_code == want
        assert client.post(f"{URL}/1/status", headers=h, json={"status": "cancelled"}).status_code == want
        assert client.post(f"{URL}/1/notify", headers=h).status_code == want
    assert client.get(URL).status_code == 401


def test_faculty_needs_applications_review_for_every_operation(client, world, app):
    iid = create(client, world["f"], world).get_json()["data"]["interview"]["id"]
    strip(app, "faculty", "applications.review")
    assert client.get(URL, headers=world["f"]).status_code == 403
    assert create(client, world["f"], world).status_code == 403
    assert client.post(f"{URL}/{iid}/notify", headers=world["f"]).status_code == 403


def test_admin_can_schedule(client, world):
    assert create(client, world["a"], world).status_code == 201


# ============================================================ create / validate
def test_create_persists_candidates_and_is_audited(client, world, app):
    r = create(client, world["f"], world)
    d = r.get_json()["data"]
    assert r.status_code == 201 and d["interview"]["status"] == "scheduled" and d["interview"]["notified"] is False
    assert {c["name"] for c in d["candidates"]} == {"Ann Alpha", "Bob Beta"} and d["job"]["id"] == str(world["j1"]) and d["company"]["name"] == "Zoho"
    assert audit_actions(app) == ["interview.create"]


@pytest.mark.parametrize("over", [
    {"applicationIds": []}, {"round": ""}, {"location": ""}, {"durationMins": 1}, {"durationMins": 9999}, {"at": "not-a-date"}, {"jobId": 99999}, {"extra": 1},
    {"at": "2001-01-01T00:00:00Z"}, {"applicationIds": [99999]},
])
def test_invalid_bodies_are_422_and_create_nothing(client, world, app, over):
    assert create(client, world["f"], world, **over).status_code == 422
    with app.app_context():
        assert db.session.query(Interview).count() == 0


def test_candidates_must_be_shortlisted_applicants_of_that_job(client, world, app):
    r = create(client, world["f"], world, applicationIds=[world["cy"]])  # only 'applied'
    assert r.status_code == 422 and "Cy Gamma" in str(r.get_json()["error"]["details"])
    r = create(client, world["f"], world, applicationIds=[world["ann_j2"]])  # other job
    assert r.status_code == 422 and "different job" in str(r.get_json()["error"]["details"])
    with app.app_context():
        db.session.get(Application, world["bob"]).status = S.REJECTED
        db.session.commit()
    assert create(client, world["f"], world, applicationIds=[world["bob"]]).status_code == 422


@pytest.mark.parametrize("status", [JobStatus.DRAFT, JobStatus.CANCELLED])
def test_cannot_schedule_for_draft_or_cancelled_jobs(client, world, app, status):
    with app.app_context():
        db.session.get(Job, world["j1"]).status = status
        db.session.commit()
    assert create(client, world["f"], world).status_code == 409


def test_closed_jobs_can_still_hold_interviews(client, world, app):
    with app.app_context():
        db.session.get(Job, world["j1"]).status = JobStatus.CLOSED
        db.session.commit()
    assert create(client, world["f"], world).status_code == 201


def test_a_student_cannot_be_double_booked(client, world):
    assert create(client, world["f"], world, at=when(48)).status_code == 201
    clash = create(client, world["f"], world, applicationIds=[world["ann_j2"]], jobId=world["j2"], at=(utcnow() + timedelta(hours=48, minutes=30)).isoformat() + "Z")
    assert clash.status_code == 409 and "Ann Alpha" in clash.get_json()["error"]["message"]
    ok = create(client, world["f"], world, applicationIds=[world["ann_j2"]], jobId=world["j2"], at=(utcnow() + timedelta(hours=49)).isoformat() + "Z")
    assert ok.status_code == 201  # back-to-back is fine


# ============================================================ edit
def test_edit_replaces_fields_and_candidates_clears_notified_and_audits(client, world, app):
    iid = create(client, world["f"], world).get_json()["data"]["interview"]["id"]
    client.post(f"{URL}/{iid}/notify", headers=world["f"])
    r = client.put(f"{URL}/{iid}", headers=world["f"], json=body(world, apps=[world["ann"]], round="HR Round", location="Zoom"))
    d = r.get_json()["data"]
    assert r.status_code == 200 and d["interview"]["round"] == "HR Round" and d["interview"]["notified"] is False and len(d["candidates"]) == 1
    assert audit_actions(app) == ["interview.create", "interview.notify", "interview.update"]


def test_editing_does_not_clash_with_itself_and_cannot_change_job(client, world):
    iid = create(client, world["f"], world).get_json()["data"]["interview"]["id"]
    assert client.put(f"{URL}/{iid}", headers=world["f"], json=body(world)).status_code == 200
    assert client.put(f"{URL}/{iid}", headers=world["f"], json=body(world, jobId=world["j2"], applicationIds=[world["ann_j2"]])).status_code == 409
    assert client.put(f"{URL}/99999", headers=world["f"], json=body(world)).status_code == 404


def test_only_scheduled_interviews_can_be_edited(client, world):
    iid = create(client, world["f"], world).get_json()["data"]["interview"]["id"]
    client.post(f"{URL}/{iid}/status", headers=world["f"], json={"status": "cancelled"})
    assert client.put(f"{URL}/{iid}", headers=world["f"], json=body(world)).status_code == 409


# ============================================================ status / outcome
def past_interview(app, world):
    with app.app_context():
        iv = Interview(job_id=world["j1"], round_name="Past", scheduled_at=utcnow() - timedelta(hours=3), duration_mins=30, location="x")
        iv.applications = [db.session.get(Application, world["ann"])]
        db.session.add(iv)
        db.session.commit()
        return iv.id


def test_completed_and_no_show_need_the_interview_to_have_started(client, world):
    iid = create(client, world["f"], world).get_json()["data"]["interview"]["id"]
    for st in ("completed", "no_show"):
        assert client.post(f"{URL}/{iid}/status", headers=world["f"], json={"status": st}).status_code == 409
    assert client.post(f"{URL}/{iid}/status", headers=world["f"], json={"status": "cancelled"}).status_code == 200


@pytest.mark.parametrize("st", ["completed", "no_show", "cancelled"])
def test_past_interviews_can_be_finished_and_every_final_state_is_final(client, world, app, st):
    iid = past_interview(app, world)
    r = client.post(f"{URL}/{iid}/status", headers=world["f"], json={"status": st})
    assert r.status_code == 200 and r.get_json()["data"]["interview"]["status"] == st
    for again in ("scheduled", "completed", "cancelled"):
        assert client.post(f"{URL}/{iid}/status", headers=world["f"], json={"status": again}).status_code == 409
    assert audit_actions(app) == [f"interview.{st}"]


def test_invalid_status_value_and_unknown_id(client, world):
    assert client.post(f"{URL}/1/status", headers=world["f"], json={"status": "done"}).status_code == 422
    assert client.post(f"{URL}/99999/status", headers=world["f"], json={"status": "cancelled"}).status_code == 404


def test_the_interview_result_is_recorded_on_the_applications_not_as_a_side_effect(client, world, app):
    iid = past_interview(app, world)
    client.post(f"{URL}/{iid}/status", headers=world["f"], json={"status": "completed"})
    with app.app_context():
        assert db.session.get(Application, world["ann"]).status == S.SHORTLISTED
    r = client.post("/api/v1/applications/stage", headers=world["f"], json={"ids": [world["ann"]], "status": "selected"})
    assert r.get_json()["data"]["updated"] == [str(world["ann"])]


# ============================================================ notify
def test_notify_sends_in_app_notifications_once_per_call_and_flags_it(client, world, app):
    iid = create(client, world["f"], world).get_json()["data"]["interview"]["id"]
    r = client.post(f"{URL}/{iid}/notify", headers=world["f"])
    assert r.get_json()["data"] == {"notified": 2}
    with app.app_context():
        assert db.session.query(Notification).filter(Notification.title.like("Interview scheduled%")).count() == 2
        assert db.session.get(Interview, int(iid)).notified is True


def test_cancelling_a_notified_interview_tells_the_candidates_but_an_unannounced_one_stays_quiet(client, world, app):
    a = create(client, world["f"], world).get_json()["data"]["interview"]["id"]
    client.post(f"{URL}/{a}/notify", headers=world["f"])
    client.post(f"{URL}/{a}/status", headers=world["f"], json={"status": "cancelled"})
    b = create(client, world["f"], world, applicationIds=[world["ann_j2"]], jobId=world["j2"], at=when(100)).get_json()["data"]["interview"]["id"]
    client.post(f"{URL}/{b}/status", headers=world["f"], json={"status": "cancelled"})
    with app.app_context():
        assert db.session.query(Notification).filter(Notification.title.like("Interview cancelled%")).count() == 2


def test_cannot_notify_for_a_finished_interview(client, world, app):
    iid = past_interview(app, world)
    client.post(f"{URL}/{iid}/status", headers=world["f"], json={"status": "completed"})
    assert client.post(f"{URL}/{iid}/notify", headers=world["f"]).status_code == 409


# ============================================================ listing and record-level access
def test_staff_list_is_paginated_filtered_and_ordered_by_time(client, world):
    create(client, world["f"], world, at=when(72))
    create(client, world["f"], world, applicationIds=[world["ann_j2"]], jobId=world["j2"], at=when(24))
    r = client.get(URL, headers=world["f"], query_string={"pageSize": 1}).get_json()
    assert r["meta"]["total"] == 2 and r["meta"]["totalPages"] == 2 and r["data"][0]["job"]["id"] == str(world["j2"])
    assert len(client.get(URL, headers=world["f"], query_string={"jobId": world["j1"]}).get_json()["data"]) == 1
    assert client.get(URL, headers=world["f"], query_string={"status": "bogus"}).status_code == 422
    assert client.get(URL, headers=world["f"], query_string={"pageSize": 500}).status_code == 422


def test_students_only_see_their_own_rounds_without_other_candidates(client, world):
    create(client, world["f"], world)  # ann + bob
    create(client, world["f"], world, applicationIds=[world["ann_j2"]], jobId=world["j2"], at=when(100))
    mine = client.get(URL, headers=world["ann_h"]).get_json()["data"]
    assert len(mine) == 2 and all(v["candidates"] == [] for v in mine)
    assert client.get(URL, headers=world["cy_h"]).get_json()["data"] == []
    assert "Bob" not in client.get(URL, headers=world["ann_h"]).get_data(as_text=True)
