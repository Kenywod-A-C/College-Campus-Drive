"""Placement reports: aggregates only, filtered, permission-gated; offers CSV is audited and formula-safe."""
import csv
import io

import pytest

from app.extensions import db
from app.models import ApplicationStatus as S, AuditLog, Offer, OfferStatus as O, User

from .test_jobs_admin import strip

R = "/api/v1/reports/placement"


@pytest.fixture()
def world(make, auth):
    make.user("admin", email="a@campus.test")
    make.user("faculty", email="f@campus.test")
    ann = make.user("student", email="ann@campus.test", name="Ann Alpha", code="23CSE001", dept="CSE", graduation_year=2027)
    bob = make.user("student", email="bob@campus.test", name="Bob Beta", code="23IT002", dept="IT", graduation_year=2027)
    cy = make.user("student", email="cy@campus.test", name="Cy Gamma", code="23CSE003", dept="CSE", graduation_year=2028)
    make.user("student", email="di@campus.test", name="Di Delta", code="23ECE004", dept="ECE", graduation_year=2027, cgpa=5.0)
    zoho, tcs = make.company("Zoho"), make.company("TCS")
    j1, j2 = make.job(zoho, "Dev", depts=(), min_cgpa=7.0, years=(2027, 2028)), make.job(tcs, "Analyst", depts=("CSE",), min_cgpa=7.0, years=(2027, 2028))
    a1, a2, a3 = make.application(ann, j1, S.SELECTED), make.application(bob, j1, S.SHORTLISTED), make.application(cy, j2, S.REJECTED)
    off = make.offer(a1)
    with make.app.app_context():
        db.session.get(Offer, off).status = O.ACCEPTED
        db.session.commit()
    return {"a": auth("a@campus.test"), "f": auth("f@campus.test"), "s": auth("ann@campus.test"), "zoho": zoho, "tcs": tcs, "j1": j1, "off": off}


def get(client, h, **q):
    return client.get(R, headers=h, query_string=q)


# ================================================================ authorisation
def test_only_reports_view_holders_can_read_reports_or_export(client, world, app):
    for path in (R, R + "/export.csv"):
        assert client.get(path).status_code == 401
        assert client.get(path, headers=world["s"]).status_code == 403
        assert client.get(path, headers=world["f"]).status_code == 200
        assert client.get(path, headers=world["a"]).status_code == 200
    strip(app, "faculty", "reports.view")
    assert get(client, world["f"]).status_code == 403
    assert client.get(R + "/export.csv", headers=world["f"]).status_code == 403


# ================================================================ numbers
def test_kpis_funnel_and_distribution_match_the_data(client, world):
    d = get(client, world["a"]).get_json()["data"]
    k = d["kpis"]
    assert (k["totalStudents"], k["appliedStudents"], k["uniqueStudentsPlaced"], k["totalOffers"], k["acceptedOffers"]) == (4, 3, 1, 1, 1) and k["placementPct"] == 25.0
    assert k["eligibleStudents"] == 3  # Ann, Bob and Cy can apply to the open Zoho job; Di (CGPA 5.0) cannot
    stages = {x["stage"]: x["count"] for x in d["funnel"]}
    assert stages["Eligible students"] == 3 and stages["Applied"] == 3 and stages["Offers"] == 1
    assert stages["Shortlisted"] == stages["Interviewed"] == stages["Selected"] == 0  # reached-stage counts come from the status history, which the fixtures do not write
    dist = {x["status"]: x["count"] for x in d["statusDist"]}
    assert dist["Offer received"] == 1 and dist["Shortlisted"] == 1 and dist["Rejected"] == 1 and sum(dist.values()) == 3
    assert {x["dept"] for x in d["offersByDept"]} >= {"CSE", "IT", "ECE"}
    cse = next(x for x in d["offersByDept"] if x["dept"] == "CSE")
    assert (cse["offers"], cse["accepted"], cse["placedStudents"], cse["students"]) == (1, 1, 1, 2)
    assert d["companyOffers"] == [{"company": "Zoho", "offers": 1, "accepted": 1}]
    assert sum(m["applications"] for m in d["monthly"]) == 3 and sum(m["offers"] for m in d["monthly"]) == 1


def test_funnel_reached_stages_come_from_status_history(client, world):
    bob = next(r["application"]["id"] for r in client.get("/api/v1/applications", headers=world["a"], query_string={"q": "Bob"}).get_json()["data"])
    client.post("/api/v1/applications/stage", headers=world["a"], json={"ids": [int(bob)], "status": "interview"})
    stages = {x["stage"]: x["count"] for x in get(client, world["a"]).get_json()["data"]["funnel"]}
    assert stages["Interviewed"] == 1 and stages["Shortlisted"] == 0  # a skipped stage is not claimed


def test_filters_narrow_the_scope(client, world):
    k = lambda **q: get(client, world["a"], **q).get_json()["data"]["kpis"]  # noqa: E731
    assert k(academicYear=2028)["totalStudents"] == 1 and k(academicYear=2028)["totalOffers"] == 0
    assert k(companyId=world["tcs"])["totalOffers"] == 0 and k(companyId=world["zoho"])["totalOffers"] == 1
    assert k(jobId=world["j1"])["appliedStudents"] == 2
    assert k(offerStatus="declined")["totalOffers"] == 0 and k(offerStatus="accepted")["totalOffers"] == 1
    assert k(appStatus="rejected")["appliedStudents"] == 1
    ref = client.get("/api/v1/reference/filters", headers=world["a"]).get_json()["data"]["departments"]
    cse = next(d["value"] for d in ref if d["label"] == "CSE")
    d = get(client, world["a"], dept=cse).get_json()["data"]
    assert d["kpis"]["totalStudents"] == 2 and [x["dept"] for x in d["offersByDept"]] == ["CSE"]


@pytest.mark.parametrize("bad", [{"academicYear": 1}, {"dept": "x"}, {"appStatus": "hired"}, {"offerStatus": "x"}, {"bogus": 1}])
def test_invalid_filters_are_422(client, world, bad):
    assert get(client, world["a"], **bad).status_code == 422


def test_an_empty_scope_returns_zeros_not_errors(client, world):
    d = get(client, world["a"], academicYear=2099).get_json()["data"]
    assert d["kpis"]["totalStudents"] == 0 and d["kpis"]["placementPct"] == 0 and d["monthly"] == [] and d["companyOffers"] == []


def test_the_report_contains_no_individual_student_data(client, world):
    blob = get(client, world["f"]).get_data(as_text=True)
    for needle in ("Ann Alpha", "ann@campus", "23CSE001", "phone", "password", "cgpa\""):
        assert needle not in blob


# ================================================================ export
def rows(r):
    return list(csv.reader(io.StringIO(r.get_json()["data"])))


def test_csv_lists_offers_is_filtered_and_audited(client, world, app):
    r = rows(client.get(R + "/export.csv", headers=world["f"]))
    assert r[0] == ["Student ID", "Name", "Department", "Company", "Job", "Package (LPA)", "Offer status", "Offer date"]
    assert r[1][:5] == ["23CSE001", "Ann Alpha", "CSE", "Zoho", "Dev"] and r[1][6] == "accepted" and len(r) == 2
    assert len(rows(client.get(R + "/export.csv", headers=world["f"], query_string={"companyId": world["tcs"]}))) == 1
    with app.app_context():
        assert [a.resource for a in db.session.query(AuditLog).filter_by(action="report.export").order_by(AuditLog.id)] == ["Placement CSV (1 rows)", "Placement CSV (0 rows)"]


def test_csv_neutralises_formulas_and_rejects_bad_filters(client, world, app):
    with app.app_context():
        db.session.query(User).filter_by(email="ann@campus.test").one().name = "@SUM(A1)"
        db.session.commit()
    assert rows(client.get(R + "/export.csv", headers=world["a"]))[1][1] == "'@SUM(A1)"
    assert client.get(R + "/export.csv", headers=world["a"], query_string={"offerStatus": "zzz"}).status_code == 422
