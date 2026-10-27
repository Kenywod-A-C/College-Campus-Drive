"""Eligibility engine: pure rules, every outcome explained. Policies are data, not code."""
from datetime import timedelta

import pytest

from app.extensions import db
from app.models import CompanyTier, JobStatus, OfferStatus, PlacementPolicy, PolicyKind, Student, utcnow
from app.security import validate_new_password
from app.errors import ValidationFailed
from app.services import eligibility


def _ev(app, user_id, job_id, **kw):
    with app.app_context():
        s = db.session.query(Student).filter_by(user_id=user_id).one()
        from app.models import Job
        return eligibility.evaluate(s, db.session.get(Job, job_id), **kw)


def _check(res, key):
    return next(c for c in res["checks"] if c["key"] == key)


def test_eligible_when_every_rule_passes(app, make):
    u = make.user("student", cgpa=8.4)
    j = make.job(make.company(), min_cgpa=7.0)
    r = _ev(app, u, j)
    assert r["state"].value == "eligible" and all(c["passed"] for c in r["checks"])


def test_department_mismatch_is_explained(app, make):
    u = make.user("student", dept="MECH")
    r = _ev(app, u, make.job(make.company(), depts=("CSE", "IT")))
    assert r["state"].value == "not_eligible"
    assert "Open to CSE, IT" in _check(r, "department")["detail"] and "MECH" in _check(r, "department")["detail"]


def test_cgpa_below_minimum(app, make):
    r = _ev(app, make.user("student", cgpa=6.5), make.job(make.company(), min_cgpa=7.5))
    assert r["state"].value == "not_eligible" and "Requires 7.5+; your CGPA is 6.50." == _check(r, "cgpa")["detail"]


def test_missing_cgpa_is_profile_incomplete_not_a_guess(app, make):
    with app.app_context():
        pass
    u = make.user("student", cgpa=None)
    r = _ev(app, u, make.job(make.company()))
    assert r["state"].value == "profile_incomplete" and _check(r, "cgpa")["passed"] is None


def test_unverified_cgpa_needs_verification(app, make):
    r = _ev(app, make.user("student", verified=False), make.job(make.company()))
    assert r["state"].value == "needs_verification"


def test_failing_rule_beats_unverified_state(app, make):
    r = _ev(app, make.user("student", verified=False, cgpa=5.0), make.job(make.company(), min_cgpa=7.0))
    assert r["state"].value == "not_eligible"


def test_arrears_and_history(app, make):
    c = make.company()
    assert _ev(app, make.user("student", arrears=1), make.job(c, arrears=0))["state"].value == "not_eligible"
    assert _ev(app, make.user("student", arrears=1), make.job(c, arrears=1))["state"].value == "eligible"
    assert _ev(app, make.user("student", arrear_history=3), make.job(c, history=2))["state"].value == "not_eligible"


def test_graduation_year(app, make):
    r = _ev(app, make.user("student", graduation_year=2028), make.job(make.company(), years=(2027,)))
    assert _check(r, "graduationYear")["passed"] is False


@pytest.mark.parametrize("status,days,reason", [(JobStatus.CLOSED, 5, "closed"), (JobStatus.DRAFT, 5, "draft"), (JobStatus.PUBLISHED, -1, "deadline has passed")])
def test_closed_draft_or_expired_jobs_are_not_open(app, make, status, days, reason):
    r = _ev(app, make.user("student"), make.job(make.company(), status=status, deadline_days=days))
    assert _check(r, "open")["passed"] is False and reason in _check(r, "open")["detail"]


def _accepted_offer(make, user_id, tier):
    j = make.job(make.company(tier=tier))
    return make.offer(make.application(user_id, j), status=OfferStatus.ACCEPTED)


def test_max_offers_policy_is_read_from_data_not_hardcoded(app, make):
    u = make.user("student")
    _accepted_offer(make, u, CompanyTier.REGULAR)
    target = make.job(make.company())
    assert _ev(app, u, target)["state"].value == "eligible"  # 1 of 2 used
    with app.app_context():  # an admin lowers the limit: the SAME code now blocks the SAME student
        p = db.session.query(PlacementPolicy).filter_by(kind=PolicyKind.MAX_OFFERS).one()
        p.params = {"maxAcceptedOffers": 1}
        db.session.commit()
        pid = p.id
    r = _ev(app, u, target)
    assert r["state"].value == "not_eligible" and "limit 1" in _check(r, f"policy:{pid}")["detail"]


def test_disabled_policy_is_ignored(app, make):
    u = make.user("student")
    _accepted_offer(make, u, CompanyTier.REGULAR)
    with app.app_context():
        for p in db.session.query(PlacementPolicy).filter_by(kind=PolicyKind.MAX_OFFERS):
            p.params, p.enabled = {"maxAcceptedOffers": 1}, False
        db.session.commit()
    assert _ev(app, u, make.job(make.company()))["state"].value == "eligible"


def test_tier_rule_requires_a_higher_tier_after_an_offer(app, make):
    u = make.user("student")
    _accepted_offer(make, u, CompanyTier.DREAM)
    assert _ev(app, u, make.job(make.company(tier=CompanyTier.REGULAR)))["state"].value == "not_eligible"
    assert _ev(app, u, make.job(make.company(tier=CompanyTier.SUPER_DREAM)))["state"].value == "eligible"


def test_department_scoped_policy_only_applies_to_that_department(app, make):
    cse, mech = make.user("student", dept="CSE"), make.user("student", dept="MECH")
    for u in (cse, mech):
        _accepted_offer(make, u, CompanyTier.REGULAR)
    with app.app_context():
        from app.models import Department, PolicyScope
        d = db.session.query(Department).filter_by(code="MECH").one()
        db.session.add(PlacementPolicy(name="MECH limit", kind=PolicyKind.MAX_OFFERS, scope=PolicyScope.DEPARTMENT, scope_value=str(d.id), params={"maxAcceptedOffers": 1}))
        db.session.commit()
    j = make.job(make.company(), depts=("CSE", "MECH"))
    assert _ev(app, cse, j)["state"].value == "eligible"
    assert _ev(app, mech, j)["state"].value == "not_eligible"


def test_password_policy_ignores_tiny_identifiers():
    class U:  # noqa: N801
        email, user_code = "s@campus.test", "S1"
    validate_new_password("NewPassw0rd", user=U())
    with pytest.raises(ValidationFailed):
        validate_new_password("alllowercase1")
    with pytest.raises(ValidationFailed):
        validate_new_password("x" * 200 + "A1")
    class V:  # noqa: N801
        email, user_code = "aarav.menon@campus.test", "23CSE101"
    with pytest.raises(ValidationFailed):
        validate_new_password("Aarav.menon123", user=V())


# ---------------------------------------------------------------- required skills
def _require(app, job_id, skills):
    from app.models import Job
    with app.app_context():
        db.session.get(Job, job_id).rule.required_skills = skills
        db.session.commit()


def test_required_skills_are_enforced_case_insensitively(app, make):
    c = make.company()
    j = make.job(c)
    _require(app, j, ["python", "SQL"])
    ok = make.user("student", skills=["Python", "sql"])
    res = _ev(app, ok, j)
    assert res["state"].value == "eligible" and _check(res, "skills")["passed"] is True


def test_missing_required_skill_makes_the_student_not_eligible_and_names_it(app, make):
    c = make.company()
    j = make.job(c)
    _require(app, j, ["Python", "Kubernetes"])
    u = make.user("student", skills=["Python"])
    res = _ev(app, u, j)
    assert res["state"].value == "not_eligible"
    assert "Kubernetes" in _check(res, "skills")["detail"] and "required skills" in res["summary"]


def test_a_student_with_no_skills_fails_a_skill_gated_job_but_not_an_ungated_one(app, make):
    c = make.company()
    gated, open_ = make.job(c, "Gated"), make.job(c, "Open")
    _require(app, gated, ["Python"])
    u = make.user("student", skills=[])
    assert _ev(app, u, gated)["state"].value == "not_eligible"
    assert _ev(app, u, open_)["state"].value == "eligible"
    assert not [c for c in _ev(app, u, open_)["checks"] if c["key"] == "skills"]


def test_apply_is_refused_server_side_when_a_required_skill_is_missing(client, app, make, auth):
    c = make.company()
    j = make.job(c)
    _require(app, j, ["Rust"])
    make.user("student", email="s@campus.test", skills=["Python"])
    r = client.post("/api/v1/applications", headers=auth("s@campus.test"), json={"jobId": j})
    assert r.status_code == 403 and "required skills" in r.get_json()["error"]["message"]
