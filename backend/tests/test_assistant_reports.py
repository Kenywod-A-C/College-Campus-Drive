"""Reports generated inside the chat: built by the server from the services under the caller's permissions."""
import json

import pytest

from app.extensions import db
from app.models import ApplicationStatus, AuditLog, OfferStatus

from .fake_llm import call, calls, say
from .test_assistant_charts import chart_of, populate
from .test_assistant_tools import revoke, run

BASE = "/api/v1/assistant"


def report_of(data):
    return data["messages"][-1]["reports"]


def kpis(r):
    return {k["label"]: k["value"] for k in r["kpis"]}


def section(r, heading):
    return next(s for s in r["sections"] if s["heading"] == heading)


def world(make):
    ids = populate(make)
    c = make.company("Zoho")
    j1 = make.job(c, "Dev")
    j2 = make.job(c, "QA", depts=("IT",))
    make.offer(make.application(ids["p1"], j1), status=OfferStatus.ACCEPTED)
    make.application(ids["p2"], j2, ApplicationStatus.SHORTLISTED)
    return ids, c, j1, j2


def test_placement_summary_report_has_real_kpis_tables_and_charts(client, make, auth, llm, app):
    world(make)
    h = auth("a@campus.test")
    p, spy, data = run(client, h, llm, call("generate_report", report_type="placement_summary"), message="generate placement report")
    r = report_of(data)[0]
    assert r["title"] == "Placement summary report" and r["generatedAt"].endswith("Z")
    k = kpis(r)
    assert k["Students"] == "5" and k["Placed"] == "1" and k["Offers"] == "1" and k["Accepted offers"] == "1"
    dep = section(r, "Placement by department")
    assert dep["table"]["columns"] == ["Department", "Students", "Placed", "Offers", "Accepted", "Placement %"]
    assert ["CSE", 3, 1, 1, 1, 33.3] in dep["table"]["rows"]
    assert dep["chart"]["type"] == "stacked" and section(r, "Placement funnel")["chart"]["type"] == "hbar"
    co = section(r, "Companies")
    assert co["table"]["columns"] == ["Company", "Jobs", "Applications", "Offers", "Accepted"] and co["table"]["rows"] == [["Zoho", 2, 2, 1, 1]] and co["chart"]["title"] == "Companies overview"
    # the model gets a compact preview to write its summary from, not the whole report
    pv = spy.first
    assert pv["status"] == "report_shown_to_user" and pv["kpis"]["Placed"] == "1" and "generate_report" in p.requests[0]["tools"]
    assert all(len(s.get("firstRows", [])) <= 5 for s in pv["sections"])
    saved = client.get(f"{BASE}/conversations/{data['id']}", headers=h).get_json()["data"]["messages"][-1]["reports"]
    assert saved == [r]
    with app.app_context():
        assert db.session.query(AuditLog).filter_by(action="report.generate").count() == 1


def test_filters_narrow_the_report(client, make, auth, llm):
    world(make)
    _, _, data = run(client, auth("a@campus.test"), llm, call("generate_report", report_type="placement_summary", department="IT"))
    r = report_of(data)[0]
    assert kpis(r)["Students"] == "2" and r["subtitle"] == "Filtered to department IT"
    assert [row[0] for row in section(r, "Placement by department")["table"]["rows"]] == ["IT"]


def test_student_directory_report_filters_caps_rows_and_says_so(client, make, auth, llm, monkeypatch):
    world(make)
    from app.services.assistant import report_builders
    monkeypatch.setattr(report_builders, "ROW_CAP", 2)
    _, _, data = run(client, auth("a@campus.test"), llm, calls(("generate_report", {"report_type": "student_directory", "min_cgpa": 8}), ("generate_report", {"report_type": "student_directory"})))
    high, everyone = report_of(data)
    assert [r[1] for r in section(high, "Students")["table"]["rows"]] == ["Placed One", "Placed Two"] and kpis(high)["Students matching"] == "2" and "truncated" not in high
    assert len(section(everyone, "Students")["table"]["rows"]) == 2 and everyone["truncated"] is True and "first 2 of 5" in section(everyone, "Students")["note"]
    assert section(high, "Students")["table"]["columns"][:3] == ["Student ID", "Name", "Department"] and "Phone" not in section(high, "Students")["table"]["columns"]


def test_applicants_offers_and_eligible_reports(client, make, auth, llm):
    ids, c, j1, j2 = world(make)
    _, _, data = run(client, auth("a@campus.test"), llm, calls(("generate_report", {"report_type": "applicants", "job_id": j2, "status": "shortlisted"}), ("generate_report", {"report_type": "offers"})))
    app_r, off_r = report_of(data)
    row = section(app_r, "Applicants")["table"]["rows"][0]
    assert row[1] == "Placed Two" and row[6] == "shortlisted" and app_r["subtitle"] == "Zoho — QA"
    assert section(off_r, "Offers")["table"]["rows"][0][1:4] == ["Placed One", "Zoho", "Dev"] and kpis(off_r)["Students placed"] == "1"
    _, _, data = run(client, auth("a@campus.test"), llm, call("generate_report", report_type="eligible_students", job_id=j2))
    el = report_of(data)[0]
    assert kpis(el)["Eligible"] == "1" and [r[1] for r in section(el, "Eligible students")["table"]["rows"]] == ["Placed Two"]  # only the IT student with CGPA above the bar
    _, spy, _ = run(client, auth("a@campus.test"), llm, calls(("generate_report", {"report_type": "eligible_students"}), ("generate_report", {"report_type": "applicants", "job_id": 99999})))
    assert [x["error"] for x in spy.results[-1]] == ["validation_error", "not_found"]


def test_user_accounts_audit_companies_and_interview_reports(client, make, auth, llm):
    world(make)
    _, _, data = run(client, auth("a@campus.test"), llm, calls(("generate_report", {"report_type": "user_accounts", "account_type": "faculty"}), ("generate_report", {"report_type": "audit_summary"})))
    ua, au = report_of(data)
    assert [r[0] for r in section(ua, "Accounts")["table"]["rows"]] == ["Faculty 2"]
    cols = section(ua, "Accounts")["table"]["columns"]
    assert "Email" in cols and not {"Password", "Phone", "Password hash"} & set(cols)  # contact email is part of the admin screen; credentials never are
    assert "scrypt" not in json.dumps(ua).lower()
    assert section(au, "Latest entries")["table"]["columns"][0] == "When"
    _, _, data = run(client, auth("a@campus.test"), llm, calls(("generate_report", {"report_type": "companies"}), ("generate_report", {"report_type": "interviews"})))
    co, iv = report_of(data)
    assert section(co, "Companies")["table"]["rows"][0][0] == "Zoho" and iv["title"] == "Interview schedule report" and section(iv, "Interviews")["table"]["rows"] == []


def test_report_types_follow_the_same_permissions_as_their_screens(client, make, auth, llm, app):
    world(make)
    h = auth("f@campus.test")
    _, spy, _ = run(client, h, llm, calls(("generate_report", {"report_type": "user_accounts"}), ("generate_report", {"report_type": "audit_summary"}), ("generate_report", {"report_type": "placement_summary"}), ("generate_report", {"report_type": "offers"})))
    assert [x.get("status") or x["error"] for x in spy.results[-1]] == ["not_permitted", "not_permitted", "report_shown_to_user", "report_shown_to_user"]  # faculty hold reports.view and offers.manage by default
    revoke(app, "faculty", "reports.view")
    revoke(app, "faculty", "offers.manage")
    _, spy, _ = run(client, h, llm, calls(("generate_report", {"report_type": "placement_summary"}), ("generate_report", {"report_type": "offers"}), ("generate_report", {"report_type": "student_directory"})))
    assert [x.get("status") or x["error"] for x in spy.results[-1]] == ["not_permitted", "not_permitted", "report_shown_to_user"]


def test_students_get_only_their_own_report(client, make, auth, llm):
    ids, c, j1, j2 = world(make)
    ua = make.user("student", email="alice@campus.test", name="Alice A", code="23CSE900")
    make.application(ua, make.job(c, "Intern"), ApplicationStatus.SHORTLISTED)
    p, spy, data = run(client, auth("alice@campus.test"), llm, calls(("generate_report", {"report_type": "placement_summary"}), ("generate_my_report", {})))
    assert spy.results[-1][0]["error"] == "not_permitted" and "generate_report" not in p.requests[0]["tools"] and "generate_my_report" in p.requests[0]["tools"]
    r = report_of(data)[0]
    assert r["title"] == "My placement report" and r["subtitle"] == "Alice A · 23CSE900" and kpis(r)["Applications"] == "1"
    assert [row[1] for row in section(r, "My applications")["table"]["rows"]] == ["Intern"]
    assert "Placed One" not in json.dumps(r) and "Placed Two" not in json.dumps(r)


def test_at_most_two_reports_per_reply(client, make, auth, llm):
    world(make)
    _, spy, data = run(client, auth("a@campus.test"), llm, calls(*[("generate_report", {"report_type": "companies"})] * 3))
    assert [x.get("status") or x["error"] for x in spy.results[-1]] == ["report_shown_to_user"] * 2 + ["too_many_reports"] and len(report_of(data)) == 2


def test_a_report_and_a_chart_can_share_one_reply(client, make, auth, llm):
    world(make)
    _, _, data = run(client, auth("a@campus.test"), llm, calls(("generate_report", {"report_type": "companies"}), ("show_chart", {"metric": "placement_status"})))
    assert len(report_of(data)) == 1 and len(chart_of(data)) == 1
