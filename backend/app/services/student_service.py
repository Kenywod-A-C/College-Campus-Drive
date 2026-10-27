from sqlalchemy.exc import IntegrityError

from ..errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..extensions import db
from ..models import (
    AcademicRecord, Application, ApplicationStatus, AuditResult, Company, Department, Interview, InterviewStatus, Job, JobStatus, Offer, PlacementStatus, SavedJob, SkillKind,
    Student, StudentSkill, User, OfferStatus, iso, interview_candidates, sid, utcnow,
)
from ..schemas.student import CONTROLLED_FIELDS, OnboardingIn, ProfilePatch
from ..serializers import student_dict
from . import audit, eligibility
from .views import job_view


def student_of(user: User) -> Student:
    if user.role_name != "student" or user.student is None:
        raise Forbidden("This area is only available to students.")
    return user.student


def completion(s: Student) -> int:
    a = s.academic
    parts = [bool(s.phone), a is not None and a.cgpa is not None, len(s.tags(SkillKind.SKILL)) >= 3, bool(s.tags(SkillKind.INTEREST)), bool(s.tags(SkillKind.PREFERRED_ROLE)),
             bool(s.resume_file), bool(s.portfolio_url), bool(s.degree), bool(s.student_code)]
    return round(sum(parts) / len(parts) * 100)


def _set_tags(s: Student, kind: SkillKind, names: list[str]) -> None:
    """Replace the whole list, preserving the submitted order. Deletes are flushed first so re-adding a name cannot trip the unique index."""
    wanted = list(dict.fromkeys(n.strip() for n in names if n.strip()))  # de-duplicated, order kept
    for existing in [x for x in s.skills if x.kind == kind]:
        s.skills.remove(existing)
    db.session.flush()
    for n in wanted:
        s.skills.append(StudentSkill(kind=kind, name=n))


def update_profile(user: User, raw: dict, patch: ProfilePatch) -> Student:
    s = student_of(user)
    bad = sorted(set(raw) & CONTROLLED_FIELDS)
    if bad:
        audit.record("student.update", f"Profile fields {', '.join(bad)}", result=AuditResult.DENIED, reason="Controlled fields", actor=user, commit=True)
        raise Forbidden(f"{', '.join(bad)} can only be changed by the placement cell.")
    sent = patch.model_fields_set
    for field, attr in (("phone", "phone"), ("portfolio_url", "portfolio_url"), ("resume_file", "resume_file"), ("degree", "degree"), ("current_year", "current_year")):
        if field in sent:
            setattr(s, attr, getattr(patch, field) or (None if attr in ("phone", "portfolio_url", "resume_file") else getattr(s, attr)))
    for field, kind in (("skills", SkillKind.SKILL), ("interests", SkillKind.INTEREST), ("preferred_roles", SkillKind.PREFERRED_ROLE)):
        if field in sent and getattr(patch, field) is not None:
            _set_tags(s, kind, getattr(patch, field))
    a = s.academic or AcademicRecord(student=s)
    changed = False
    if "cgpa" in sent and patch.cgpa is not None:
        changed |= a.cgpa is None or float(a.cgpa) != patch.cgpa
        a.cgpa = patch.cgpa
    if "active_arrears" in sent and patch.active_arrears is not None:
        changed |= a.active_arrears != patch.active_arrears
        a.active_arrears = patch.active_arrears
    if "arrear_history" in sent and patch.arrear_history is not None:
        a.arrear_history = patch.arrear_history
    if changed:
        a.cgpa_verified = False  # self-reported academics must be re-verified by the placement cell
        a.verified_by = a.verified_at = None
    db.session.add(a)
    db.session.flush()
    s.profile_completion = completion(s)
    audit.record("student.update", f"Own profile {s.student_code}", actor=user)
    db.session.commit()
    return s


def onboard(user: User, data: OnboardingIn) -> User:
    s = student_of(user)
    if user.onboarding_complete:
        raise Conflict("Your profile has already been set up. Edit it from My Profile.")
    dept = db.session.get(Department, data.department_id)
    if dept is None:
        raise ValidationFailed("Choose a valid department.", details={"departmentId": ["Unknown department"]})
    taken = db.session.query(Student.id).filter(Student.student_code == data.student_code, Student.id != s.id).first()
    if taken:
        raise Conflict("That student ID is already registered.", details={"studentCode": ["Already in use"]})
    s.student_code, s.department_id, s.degree = data.student_code, dept.id, data.degree
    s.current_year, s.graduation_year, s.resume_file, s.portfolio_url = data.current_year, data.graduation_year, data.resume_file, data.portfolio_url or None
    _set_tags(s, SkillKind.SKILL, data.skills)
    _set_tags(s, SkillKind.INTEREST, data.interests)
    _set_tags(s, SkillKind.PREFERRED_ROLE, data.preferred_roles)
    a = s.academic or AcademicRecord(student=s)
    a.cgpa, a.active_arrears, a.arrear_history, a.cgpa_verified = data.cgpa, data.active_arrears, data.arrear_history, False  # always UNVERIFIED until staff verify
    db.session.add(a)
    user.department_id = dept.id
    user.onboarding_complete = True
    try:
        db.session.flush()
        s.profile_completion = completion(s)
        audit.record("student.onboarding", f"Student {s.student_code}", actor=user)
        db.session.commit()
    except IntegrityError:  # lost a race with another request using the same ID: the DB unique index is the real guard
        db.session.rollback()
        raise Conflict("That student ID is already registered.", details={"studentCode": ["Already in use"]})
    return user


def set_placement_status(student: Student) -> None:
    if student.placement_status == PlacementStatus.OPTED_OUT:
        return
    if db.session.query(Offer.id).filter_by(student_id=student.id, status=OfferStatus.ACCEPTED).first():
        student.placement_status = PlacementStatus.PLACED
    elif db.session.query(Application.id).filter_by(student_id=student.id).first():
        student.placement_status = PlacementStatus.IN_PROCESS
    else:
        student.placement_status = PlacementStatus.UNPLACED


def dashboard(user: User) -> dict:
    s = student_of(user)
    now = utcnow()
    policies, accepted = eligibility.active_policies(), eligibility.accepted_offers(s.id)
    mine = db.session.query(Application).filter_by(student_id=s.id).all()
    apps = {a.job_id: a for a in sorted(mine, key=lambda x: x.id) if a.status != ApplicationStatus.WITHDRAWN}
    saved = {r.job_id for r in db.session.query(SavedJob).filter_by(student_id=s.id)}
    published = db.session.query(Job).filter(Job.status == JobStatus.PUBLISHED, Job.deadline > now).all()
    views = [job_view(j, user, student=s, policies=policies, accepted=accepted, saved=saved, apps=apps) for j in published]

    my_ids = [a.id for a in mine]
    ints = []
    if my_ids:
        ints = (db.session.query(Interview).join(interview_candidates, interview_candidates.c.interview_id == Interview.id)
                .filter(interview_candidates.c.application_id.in_(my_ids), Interview.status == InterviewStatus.SCHEDULED, Interview.scheduled_at > now).distinct().all())
    events = [{"id": sid(i.id), "title": f"{i.round_name} — {i.job.title}", "sub": i.job.company.name, "at": iso(i.scheduled_at), "kind": "interview"} for i in ints]
    for a in mine:
        j = a.job
        if a.status not in (ApplicationStatus.REJECTED, ApplicationStatus.WITHDRAWN) and j.drive and j.drive.drive_date and j.drive.drive_date > now:
            events.append({"id": f"d_{j.id}", "title": f"{j.title} placement drive", "sub": j.company.name, "at": iso(j.drive.drive_date), "kind": "drive"})
    events.sort(key=lambda e: e["at"])

    active = (ApplicationStatus.APPLIED, ApplicationStatus.SHORTLISTED, ApplicationStatus.INTERVIEW, ApplicationStatus.SELECTED)
    activity = sorted(({"at": h.at, "status": h.status.value, "text": f"{a.job.title} · {a.job.company.name}", "note": h.note, "applicationId": sid(a.id)} for a in mine for h in a.history),
                      key=lambda x: x["at"], reverse=True)[:6]
    for x in activity:
        x["at"] = iso(x["at"])
    return {
        "student": student_dict(s),
        "metrics": {
            "eligibleJobs": sum(1 for v in views if v["eligibility"]["state"] == "eligible"), "activeApplications": sum(1 for a in mine if a.status in active),
            "offers": db.session.query(Offer).filter_by(student_id=s.id).count(), "upcoming": len(events[:5]),
        },
        "events": events[:5],
        "deadlines": sorted((v for v in views if "applicationId" not in v and v["eligibility"]["state"] != "not_eligible"), key=lambda v: v["job"]["deadline"])[:4],
        "recommended": sorted((v for v in views if "applicationId" not in v and v["eligibility"]["state"] == "eligible"), key=lambda v: -v["relevance"])[:3],
        "activity": activity,
    }
