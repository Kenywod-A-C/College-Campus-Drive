"""Deterministic eligibility engine. The single source of truth: the LLM assistant and the UI only ever read its output.

Pure function over structured rules (department, batch, CGPA, arrears, job open/deadline, configurable policies).
Every check carries a human-readable reason. Missing academic data yields profile_incomplete, unverified CGPA yields
needs_verification — never a guess."""
from dataclasses import dataclass
from datetime import datetime

from ..extensions import db
from ..models import ApplicationStatus, EligibilityState, JobStatus, Offer, OfferStatus, PlacementPolicy, PolicyKind, PolicyScope, SkillKind, Student, utcnow

TIER_RANK = {"regular": 0, "dream": 1, "super_dream": 2}


@dataclass
class Check:
    key: str
    label: str
    passed: bool | None  # None = cannot be determined
    detail: str

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "passed": self.passed, "detail": self.detail}


def _in_scope(p: PlacementPolicy, student: Student) -> bool:
    if p.scope == PolicyScope.COLLEGE:
        return True
    if p.scope == PolicyScope.DEPARTMENT:
        return p.scope_value == str(student.department_id)
    return p.scope_value == str(student.graduation_year)  # academic_year


def accepted_offers(student_id: int, exclude_offer_id: int | None = None) -> list[Offer]:
    q = db.session.query(Offer).filter(Offer.student_id == student_id, Offer.status == OfferStatus.ACCEPTED)
    if exclude_offer_id:
        q = q.filter(Offer.id != exclude_offer_id)
    return q.all()


def all_accepted_offers() -> list[Offer]:
    return db.session.query(Offer).filter(Offer.status == OfferStatus.ACCEPTED).all()


def active_policies() -> list[PlacementPolicy]:
    return db.session.query(PlacementPolicy).filter_by(enabled=True).all()


def evaluate(student: Student, job, *, policies: list[PlacementPolicy] | None = None, now: datetime | None = None, ignore_open: bool = False,
             accepted: list[Offer] | None = None) -> dict:
    now = now or utcnow()
    rule = job.rule
    acad = student.academic
    checks: list[Check] = []
    dept_code = lambda d: d.code  # noqa: E731

    # 1. department
    allowed = job.departments
    ok = not allowed or any(d.id == student.department_id for d in allowed)
    mine = student.department.code
    checks.append(Check("department", "Department", ok,
                        f"{mine} is an eligible department." if ok else f"Open to {', '.join(dept_code(d) for d in allowed)}; your department is {mine}."))

    # 2. graduation year
    years = rule.graduation_years or []
    ok = not years or student.graduation_year in years
    checks.append(Check("graduationYear", "Graduation year", ok,
                        f"Batch {student.graduation_year} is eligible." if ok else f"Open to batch {', '.join(str(y) for y in years)}; your batch is {student.graduation_year}."))

    # 3. CGPA
    min_cgpa = float(rule.min_cgpa)
    if acad is None or acad.cgpa is None:
        checks.append(Check("cgpa", "Minimum CGPA", None, f"Requires {min_cgpa:.1f}+. Your CGPA is not on your profile yet."))
    else:
        cg = float(acad.cgpa)
        ok = cg >= min_cgpa
        checks.append(Check("cgpa", "Minimum CGPA", ok, f"Your CGPA {cg:.2f} meets the {min_cgpa:.1f} requirement." if ok else f"Requires {min_cgpa:.1f}+; your CGPA is {cg:.2f}."))

    # 4. arrears
    active = acad.active_arrears if acad else 0
    ok = active <= rule.max_active_arrears
    checks.append(Check("arrears", "Active arrears", ok,
                        f"{active} active arrear(s); up to {rule.max_active_arrears} allowed." if ok else f"{active} active arrear(s); only {rule.max_active_arrears} allowed."))
    if rule.max_arrear_history is not None:
        hist = acad.arrear_history if acad else 0
        ok = hist <= rule.max_arrear_history
        checks.append(Check("arrearHistory", "Arrear history", ok,
                            f"{hist} cleared arrear(s) in history; up to {rule.max_arrear_history} allowed." if ok else f"{hist} arrear(s) in history; only {rule.max_arrear_history} allowed."))

    # 5. required skills (case-insensitive; every listed skill must be on the profile)
    wanted = [s for s in (rule.required_skills or []) if s.strip()]
    if wanted:
        have = {s.lower() for s in student.tags(SkillKind.SKILL)}
        missing = [s for s in wanted if s.lower() not in have]
        checks.append(Check("skills", "Required skills", not missing,
                            f"You have all required skills ({', '.join(wanted)})." if not missing else f"Missing required skill(s): {', '.join(missing)}. Add them to your profile if you have them."))

    # 6. applications open
    if not ignore_open:
        is_open = job.status == JobStatus.PUBLISHED and job.deadline > now
        if is_open:
            detail = "This job is accepting applications."
        elif job.status != JobStatus.PUBLISHED:
            detail = f"This job is {job.status.value} and not accepting applications."
        else:
            detail = "The application deadline has passed."
        checks.append(Check("open", "Applications open", is_open, detail))

    # 7. configurable placement policies (nothing hardcoded)
    mine_accepted = accepted if accepted is not None else accepted_offers(student.id)
    for p in (policies if policies is not None else active_policies()):
        if not _in_scope(p, student):
            continue
        if p.kind == PolicyKind.MAX_OFFERS:
            mx = int(p.params.get("maxAcceptedOffers", 0))
            ok = len(mine_accepted) < mx
            checks.append(Check(f"policy:{p.id}", "Placement policy", ok,
                                f"{p.name}: {len(mine_accepted)} of {mx} accepted offers used." if ok else f"{p.name}: you already hold {len(mine_accepted)} accepted offer(s) (limit {mx})."))
        elif p.kind == PolicyKind.TIER_RESTRICTION and mine_accepted:
            best = max(TIER_RANK[o.company.tier.value] for o in mine_accepted)
            ok = False if best >= 2 else True if best == 0 else TIER_RANK[job.company.tier.value] > best
            checks.append(Check(f"policy:{p.id}", "Placement policy", ok,
                                f"{p.name}: this company tier is permitted." if ok else f"{p.name}: with an accepted offer you may only apply to a higher company tier."))

    hard = [c for c in checks if c.passed is False]
    unknown = [c for c in checks if c.passed is None]
    if hard:
        state, summary = EligibilityState.NOT_ELIGIBLE, f"Not eligible: {', '.join(c.label.lower() for c in hard)}."
    elif unknown:
        state, summary = EligibilityState.PROFILE_INCOMPLETE, "Profile incomplete: add your CGPA and academic details so eligibility can be evaluated."
    elif not (acad and acad.cgpa_verified):
        state, summary = EligibilityState.NEEDS_VERIFICATION, "Your CGPA is awaiting verification by the placement cell. You can apply once verified."
    else:
        state, summary = EligibilityState.ELIGIBLE, "You meet all eligibility criteria."
    return {"state": state, "summary": summary, "checks": [c.as_dict() for c in checks], "evaluatedAt": now}


def offer_policy_checks(student: Student, company, exclude_offer_id: int | None = None) -> list[dict]:
    """Policy checks evaluated when an offer is accepted or issued."""
    accepted = accepted_offers(student.id, exclude_offer_id)
    out: list[dict] = []
    limits = [int(p.params.get("maxAcceptedOffers", 0)) for p in active_policies()
              if p.kind == PolicyKind.MAX_OFFERS and _in_scope(p, student) and p.scope in (PolicyScope.COLLEGE, PolicyScope.DEPARTMENT)]
    if limits:
        mx = max(limits)
        out.append({"label": "Within accepted-offer limit", "passed": len(accepted) < mx, "detail": f"{len(accepted)} of {mx} accepted offers used."})
    tier = next((p for p in active_policies() if p.kind == PolicyKind.TIER_RESTRICTION), None)
    if tier and accepted:
        best = max(TIER_RANK[o.company.tier.value] for o in accepted)
        ok = best == 0 or TIER_RANK[company.tier.value] > best
        out.append({"label": "Company tier rule", "passed": ok,
                    "detail": "Tier rule satisfied." if ok else "Student may only hold offers from a higher tier than existing accepted offers."})
    return out


ACTIVE_APPLICATION_STATUSES = (ApplicationStatus.APPLIED, ApplicationStatus.SHORTLISTED, ApplicationStatus.INTERVIEW, ApplicationStatus.SELECTED)
