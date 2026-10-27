"""Assistant charts: the server computes every number from real records; the model only picks a metric and a style."""
import json

from app.extensions import db
from app.models import ApplicationStatus, OfferStatus, Role

from .fake_llm import call, calls, say
from .test_assistant_tools import Spy, revoke, run

BASE = "/api/v1/assistant"


def populate(make):
    make.user("admin", email="a@campus.test", name="Ada Admin")
    make.user("faculty", email="f@campus.test")
    ids = {}
    ids["p1"] = make.user("student", email="p1@campus.test", name="Placed One", cgpa=9.2, placement="placed")
    ids["p2"] = make.user("student", email="p2@campus.test", name="Placed Two", cgpa=8.5, placement="placed", dept="IT")
    make.user("student", email="u1@campus.test", name="Unplaced One", cgpa=6.5)
    make.user("student", email="u2@campus.test", name="Unplaced Two", cgpa=5.5, dept="IT")
    make.user("student", email="u3@campus.test", name="Unplaced Three", cgpa=7.5, placement="in_process")
    return ids


def chart_of(data):
    return data["messages"][-1]["charts"]


def test_placement_status_chart_uses_real_counts_and_is_saved_with_the_message(client, make, auth, llm):
    populate(make)
    h = auth("a@campus.test")
    p, spy, data = run(client, h, llm, call("show_chart", metric="placement_status"), message="can you show pie graph by placed and unplaced")
    c = chart_of(data)[0]
    assert c["type"] == "pie" and c["labels"] == ["Placed", "In process", "Unplaced"] and c["series"] == [{"name": "Students", "values": [2, 1, 2]}]
    assert set(c["types"]) == {"pie", "donut", "bar", "hbar"}
    assert spy.first["status"] == "chart_shown_to_user" and "show_chart" in p.requests[0]["tools"]
    saved = client.get(f"{BASE}/conversations/{data['id']}", headers=h).get_json()["data"]["messages"][-1]["charts"]
    assert saved == [c]  # persisted, so it is still there after a reload


def test_the_model_can_choose_a_style_and_unsuitable_styles_fall_back_with_an_explanation(client, make, auth, llm):
    ids = populate(make)
    make.offer(make.application(ids["p1"], make.job(make.company("Zoho"), "Dev")), status=OfferStatus.ACCEPTED)
    h = auth("a@campus.test")
    _, spy, data = run(client, h, llm, calls(("show_chart", {"metric": "placement_status", "chart_type": "hbar"}), ("show_chart", {"metric": "offers_by_department", "chart_type": "pie"})))
    one, two = chart_of(data)
    assert one["type"] == "hbar"
    assert two["type"] == "bar" and "pie" not in two["types"] and set(two["types"]) == {"bar", "stacked", "hbar"}  # two series cannot be a pie
    assert "does not suit this data" in spy.results[-1][1]["note"]


def test_department_and_batch_filters_apply(client, make, auth, llm):
    populate(make)
    _, spy, data = run(client, auth("a@campus.test"), llm, calls(("show_chart", {"metric": "placement_status", "department": "it"}), ("show_chart", {"metric": "students_by_department"}),
                                                                 ("show_chart", {"metric": "placement_status", "department": "XYZ"}), ("show_chart", {"metric": "placement_status", "graduation_year": 2099})))
    it, depts, bad, empty = spy.results[-1]
    assert [it["labels"], it["series"][0]["values"]] == [["Placed", "Unplaced"], [1, 1]]
    assert dict(zip(depts["labels"], depts["series"][0]["values"])) == {"CSE": 3, "IT": 2}
    assert bad["error"] == "validation_error" and "Unknown department" in bad["message"]
    assert empty["error"] == "validation_error" and "no data" in empty["message"]
    assert chart_of(data)[0]["subtitle"] == "Filtered to department IT"


def test_cgpa_distribution_buckets(client, make, auth, llm):
    populate(make)
    _, _, data = run(client, auth("a@campus.test"), llm, call("show_chart", metric="cgpa_distribution"))
    c = chart_of(data)[0]
    assert dict(zip(c["labels"], c["series"][0]["values"])) == {"Below 6": 1, "6 – 7": 1, "7 – 8": 1, "8 – 9": 1, "9 and above": 1}


def test_report_based_charts_match_the_reports_service(client, make, auth, llm):
    ids = populate(make)
    c = make.company("Zoho")
    j = make.job(c, "Dev")
    make.offer(make.application(ids["p1"], j), status=OfferStatus.ACCEPTED)
    make.offer(make.application(ids["p2"], make.job(c, "QA", depts=("IT",))), status=OfferStatus.RECEIVED)
    _, spy, data = run(client, auth("a@campus.test"), llm, calls(("show_chart", {"metric": "placed_vs_unplaced_by_department"}), ("show_chart", {"metric": "offers_by_company"}), ("show_chart", {"metric": "placement_rate_by_department"})))
    pv, oc, rate = chart_of(data)
    cse = pv["labels"].index("CSE")
    assert pv["type"] == "stacked" and pv["series"][0]["name"] == "Placed" and pv["series"][0]["values"][cse] == 1
    assert oc["labels"] == ["Zoho"] and [s["values"] for s in oc["series"]] == [[2], [1]]
    assert rate["unit"] == "%" and rate["series"][0]["values"][rate["labels"].index("CSE")] == 33.3


def test_trend_and_funnel_charts(client, make, auth, llm):
    ids = populate(make)
    make.application(ids["p1"], make.job(make.company("Zoho"), "Dev"), ApplicationStatus.SHORTLISTED)
    _, _, data = run(client, auth("a@campus.test"), llm, calls(("show_chart", {"metric": "monthly_trend"}), ("show_chart", {"metric": "placement_funnel"}), ("show_chart", {"metric": "applications_by_stage", "chart_type": "bar"})))
    trend, funnel, stages = chart_of(data)
    assert trend["type"] == "line" and [s["name"] for s in trend["series"]] == ["Applications", "Offers"] and set(trend["types"]) == {"line", "area", "bar"}
    assert funnel["type"] == "hbar" and funnel["labels"][0] == "Eligible students"
    assert stages["labels"] == ["Shortlisted"] and stages["type"] == "bar"


def test_charts_are_aggregates_only(client, make, auth, llm):
    populate(make)
    _, spy, data = run(client, auth("a@campus.test"), llm, calls(*[("show_chart", {"metric": m}) for m in ("placement_status", "students_by_department", "cgpa_distribution", "placed_vs_unplaced_by_department")]))
    blob = json.dumps(chart_of(data)) + json.dumps(spy.results)
    assert not any(n in blob for n in ("Placed One", "Unplaced Two", "@campus.test", "23CSE"))


# ------------------------------------------------------------------ permissions
def test_chart_metrics_follow_the_same_permissions_as_the_reports(client, make, auth, llm, app):
    ids = populate(make)
    make.application(ids["p1"], make.job(make.company("Zoho"), "Dev"))
    revoke(app, "faculty", "reports.view")  # faculty keeps students.view and applications.review
    p, spy, _ = run(client, auth("f@campus.test"), llm, calls(("show_chart", {"metric": "placement_status"}), ("show_chart", {"metric": "offers_by_company"}), ("show_chart", {"metric": "monthly_trend"}),
                                                              ("show_chart", {"metric": "applications_by_stage"})), message="charts please")
    ok_, denied1, denied2, ok2 = spy.results[-1]
    assert ok_["status"] == "chart_shown_to_user" and ok2["status"] == "chart_shown_to_user"
    assert denied1["error"] == "not_permitted" and denied2["error"] == "not_permitted"


def test_no_chart_tool_without_any_relevant_permission(client, make, auth, llm, app):
    populate(make)
    for perm in ("students.view", "reports.view", "applications.review"):
        revoke(app, "faculty", perm)
    p, spy, _ = run(client, auth("f@campus.test"), llm, call("show_chart", metric="placement_status"))
    assert spy.first["error"] == "not_permitted" and "show_chart" not in p.requests[0]["tools"]


def test_students_cannot_use_the_staff_chart_tool_and_only_see_their_own_data(client, make, auth, llm):
    populate(make)
    ua = make.user("student", email="alice@campus.test", name="Alice")
    ub = make.user("student", email="bob@campus.test", name="Bob")
    c = make.company("Zoho")
    make.application(ub, make.job(c, "Dev"), ApplicationStatus.SHORTLISTED)
    make.application(ub, make.job(c, "QA"), ApplicationStatus.REJECTED)
    p, spy, data = run(client, auth("alice@campus.test"), llm, calls(("show_chart", {"metric": "placement_status"}), ("show_my_chart", {"metric": "my_applications_by_status"}), ("show_my_chart", {"metric": "my_job_eligibility"})))
    staff, mine, elig = spy.results[-1]
    assert staff["error"] == "not_permitted" and "show_chart" not in p.requests[0]["tools"] and "show_my_chart" in p.requests[0]["tools"]
    assert mine["error"] == "validation_error"  # Alice has no applications; Bob's two never leak into her chart
    assert elig["status"] == "chart_shown_to_user" and dict(zip(elig["labels"], elig["series"][0]["values"])) == {"Eligible": 2}
    _, spy, data = run(client, auth("bob@campus.test"), llm, call("show_my_chart", metric="my_applications_by_status", chart_type="bar"))
    c = chart_of(data)[0]
    assert dict(zip(c["labels"], c["series"][0]["values"])) == {"Shortlisted": 1, "Rejected": 1} and c["type"] == "bar"


def test_at_most_three_charts_per_reply_and_bad_arguments_are_rejected(client, make, auth, llm):
    populate(make)
    _, spy, data = run(client, auth("a@campus.test"), llm, calls(*[("show_chart", {"metric": "placement_status"})] * 4, ("show_chart", {"metric": "made_up"}), ("show_chart", {"metric": "placement_status", "chart_type": "radar"})))
    r = spy.results[-1]
    assert [x.get("status") or x["error"] for x in r] == ["chart_shown_to_user"] * 3 + ["too_many_charts", "invalid_arguments", "invalid_arguments"]
    assert len(chart_of(data)) == 3


def test_company_charts_include_every_company_even_with_no_offers(client, make, auth, llm):
    ids = populate(make)
    tcs, zoho, infy = make.company("TCS"), make.company("Zoho"), make.company("Infosys")
    j = make.job(tcs, "Digital")
    make.offer(make.application(ids["p1"], j), status=OfferStatus.ACCEPTED)
    make.application(ids["p2"], make.job(zoho, "Dev", depts=("IT",)))
    make.job(infy, "Analyst")
    _, spy, data = run(client, auth("a@campus.test"), llm, calls(("show_chart", {"metric": "offers_by_company"}), ("show_chart", {"metric": "companies_overview"})))
    offers, overview = chart_of(data)
    assert offers["labels"] == ["TCS", "Zoho", "Infosys"] and [s["values"] for s in offers["series"]] == [[1, 0, 0], [1, 0, 0]]  # companies without offers are shown, not dropped
    assert offers["subtitle"] == "All 3 companies."
    assert overview["labels"] == ["TCS", "Zoho", "Infosys"] and {s["name"]: s["values"] for s in overview["series"]} == {"Jobs": [1, 1, 1], "Applications": [1, 1, 0], "Offers": [1, 0, 0]}
    assert set(overview["types"]) == {"bar", "stacked", "hbar"}


def test_company_charts_are_capped_and_say_so(client, make, auth, llm, monkeypatch):
    populate(make)
    for i in range(5):
        make.job(make.company(f"Co {i}"), "Dev")
    from app.services.assistant import charts as charts_mod
    monkeypatch.setattr(charts_mod, "COMPANY_CAP", 3)
    _, _, data = run(client, auth("a@campus.test"), llm, call("show_chart", metric="companies_overview"))
    c = chart_of(data)[0]
    assert len(c["labels"]) == 3 and c["subtitle"] == "Top 3 of 5 companies."


def test_the_companies_overview_follows_report_permissions(client, make, auth, llm, app):
    populate(make)
    make.company("Zoho")
    for perm in ("reports.view", "companies.manage", "applications.review"):
        revoke(app, "faculty", perm)
    p, spy, _ = run(client, auth("f@campus.test"), llm, call("show_chart", metric="companies_overview"))
    assert spy.first["error"] == "not_permitted"
