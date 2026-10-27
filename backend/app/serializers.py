"""Model -> JSON. Shapes mirror the TypeScript types in src/types so the UI needs no adapters.
Never serialise password hashes, lock counters or other internals."""
from .models import (
    AcademicRecord, Application, Company, Document, Interview, Job, Notification, Offer, Reminder, SkillKind, Student, User, iso, sid,
)


def user_dict(u: User) -> dict:
    d = {
        "id": sid(u.id), "userCode": u.user_code, "name": u.name, "email": u.email, "role": u.role_name,
        "departmentId": sid(u.department_id), "status": u.status.value, "createdAt": iso(u.created_at), "lastLoginAt": iso(u.last_login_at),
    }
    if u.role_name == "student":
        d["onboardingComplete"] = bool(u.onboarding_complete)
    return {k: v for k, v in d.items() if v is not None}


def academic_dict(a: AcademicRecord | None) -> dict:
    if a is None:
        return {"cgpaVerified": False, "activeArrears": 0, "arrearHistory": 0}
    d = {"cgpaVerified": bool(a.cgpa_verified), "activeArrears": a.active_arrears, "arrearHistory": a.arrear_history}
    if a.cgpa is not None:
        d["cgpa"] = float(a.cgpa)
    return d


def _f(v):
    return None if v is None else float(v)


def student_dict(s: Student, *, mask_phone: bool = False) -> dict:
    phone = s.phone
    if phone and mask_phone:
        phone = "".join("•" if i < len(phone) - 2 and c.isdigit() else c for i, c in enumerate(phone))
    d = {
        "id": sid(s.id), "userId": sid(s.user_id), "studentCode": s.student_code or "", "name": s.user.name, "email": s.user.email, "phone": phone,
        "departmentId": sid(s.department_id), "degree": s.degree, "currentYear": s.current_year, "graduationYear": s.graduation_year,
        "academic": academic_dict(s.academic),
        "skills": s.tags(SkillKind.SKILL), "interests": s.tags(SkillKind.INTEREST), "preferredRoles": s.tags(SkillKind.PREFERRED_ROLE),
        "resumeFile": s.resume_file, "portfolioUrl": s.portfolio_url, "profileCompletion": s.profile_completion, "placementStatus": s.placement_status.value,
    }
    return {k: v for k, v in d.items() if v is not None}


def company_dict(c: Company) -> dict:
    d = {
        "id": sid(c.id), "name": c.name, "website": c.website, "industry": c.industry, "description": c.description, "contactName": c.contact_name,
        "contactEmail": c.contact_email, "contactPhone": c.contact_phone, "tier": c.tier.value, "color": c.brand_color, "createdAt": iso(c.created_at),
        "archivedAt": iso(c.archived_at),
    }
    return {k: v for k, v in d.items() if v is not None}


def job_dict(j: Job) -> dict:
    r = j.rule
    rounds = [{"id": sid(e.id), "name": e.name, "mode": e.mode.value, **({"date": iso(e.scheduled_at)} if e.scheduled_at else {}), **({"location": e.location} if e.location else {})}
              for e in (j.drive.events if j.drive else [])]
    elig = {
        "minCgpa": float(r.min_cgpa), "maxActiveArrears": r.max_active_arrears, "departmentIds": sorted(sid(d.id) for d in j.departments),
        "graduationYears": list(r.graduation_years or []), "requiredSkills": list(r.required_skills or []),
    }
    if r.max_arrear_history is not None:
        elig["maxArrearHistory"] = r.max_arrear_history
    d = {
        "id": sid(j.id), "companyId": sid(j.company_id), "title": j.title, "domain": j.domain, "location": j.location, "type": j.job_type.value,
        "description": j.description, "responsibilities": list(j.responsibilities or []), "skills": list(j.skills or []), "eligibility": elig, "rounds": rounds,
        "ctcLpa": _f(j.ctc_lpa), "stipendPerMonth": j.stipend_per_month, "openDate": iso(j.open_date), "deadline": iso(j.deadline),
        "driveDate": iso(j.drive.drive_date) if j.drive else None, "status": j.status.value, "publishedAt": iso(j.published_at), "archivedAt": iso(j.archived_at),
        "createdBy": sid(j.created_by) or "", "updatedAt": iso(j.updated_at),
    }
    return {k: v for k, v in d.items() if v is not None}


def eligibility_dict(result: dict, *, exception: tuple[str, str] | None = None) -> dict:
    d = {"state": result["state"].value if hasattr(result["state"], "value") else result["state"], "checks": result["checks"], "summary": result["summary"], "evaluatedAt": iso(result["evaluatedAt"])}
    if exception:
        d["exceptionGranted"] = {"reason": exception[0], "approvedBy": exception[1]}
    return d


def snapshot_dict(a: Application) -> dict:
    s = a.snapshot
    return eligibility_dict({"state": s.state, "checks": s.checks, "summary": s.summary, "evaluatedAt": s.evaluated_at},
                            exception=(s.exception_reason, s.exception_approved_by) if s.exception_reason else None)


def application_dict(a: Application) -> dict:
    d = {
        "id": sid(a.id), "studentId": sid(a.student_id), "jobId": sid(a.job_id), "status": a.status.value, "appliedAt": iso(a.applied_at), "updatedAt": iso(a.updated_at),
        "history": [{"status": h.status.value, "at": iso(h.at), "note": h.note, "by": h.changed_by_name} for h in a.history],
        "eligibilitySnapshot": snapshot_dict(a), "currentRound": a.current_round,
    }
    return {k: v for k, v in d.items() if v is not None}


def interview_dict(i: Interview) -> dict:
    return {"id": sid(i.id), "jobId": sid(i.job_id), "applicationIds": [sid(a.id) for a in i.applications], "round": i.round_name, "at": iso(i.scheduled_at),
            "durationMins": i.duration_mins, "location": i.location, "status": i.status.value, "notified": i.notified}


def offer_dict(o: Offer) -> dict:
    return {"id": sid(o.id), "studentId": sid(o.student_id), "jobId": sid(o.job_id), "applicationId": sid(o.application_id), "companyId": sid(o.company_id),
            "ctcLpa": float(o.ctc_lpa), "offeredAt": iso(o.offered_at), "acceptBy": iso(o.accept_by), "status": o.status.value, "policyChecks": list(o.policy_checks or [])}


def notification_dict(n: Notification) -> dict:
    d = {"id": sid(n.id), "userId": sid(n.user_id), "title": n.title, "body": n.body, "kind": n.kind.value, "at": iso(n.created_at), "read": bool(n.is_read), "link": n.link}
    return {k: v for k, v in d.items() if v is not None}


def reminder_dict(r: Reminder) -> dict:
    d = {"id": sid(r.id), "studentId": sid(r.student_id), "title": r.title, "at": iso(r.remind_at), "jobId": sid(r.job_id), "kind": r.kind.value, "done": bool(r.done)}
    return {k: v for k, v in d.items() if v is not None}


def document_dict(d: Document) -> dict:
    out = {
        "id": sid(d.id), "title": d.title, "type": d.doc_type.value, "uploadedAt": iso(d.created_at), "uploadedBy": "", "ownerStudentId": sid(d.owner_student_id),
        "companyId": sid(d.company_id), "jobId": sid(d.job_id), "access": list(d.access_roles or []), "sizeKb": d.size_kb, "processing": d.processing.value,
        "pages": d.pages, "version": d.version,
    }
    return {k: v for k, v in out.items() if v is not None}
