"""Reference data every environment needs: roles, permissions, role->permission grants, departments, academic years, policies.
Idempotent: running it again only adds what is missing. Admin-edited grants are NOT overwritten."""
from .extensions import db
from .models import AcademicYear, Course, Degree, Department, Permission, PlacementPolicy, PolicyKind, PolicyScope, Role, RoleName

PERMISSIONS = [
    ("students.view", "Students", "View student records", "See placement profiles, applications and offers of students in scope. Sensitive personal data stays hidden."),
    ("students.edit", "Students", "Edit student records", "Verify CGPA and update academic records. Students cannot do this themselves."),
    ("companies.manage", "Placements", "Manage companies", "Create and edit company master records."),
    ("jobs.create", "Placements", "Create jobs", "Create and edit job postings and eligibility rules."),
    ("drives.publish", "Placements", "Publish drives", "Publish, close or cancel jobs and hiring drives."),
    ("applications.review", "Placements", "Review applications", "Shortlist applicants, update stages and record eligibility exceptions."),
    ("offers.manage", "Placements", "Manage offers", "Create and update official offer records."),
    ("documents.upload", "Documents", "Upload documents", "Upload circulars, brochures and eligibility documents."),
    ("reports.view", "Reports", "View reports", "Access placement analytics and CSV exports."),
    ("users.manage", "Administration", "Manage users", "Create users, assign roles, reset passwords and import students."),
    ("roles.manage", "Administration", "Manage roles & permissions", "Change the role-permission matrix."),
    ("policies.manage", "Administration", "Manage placement policies", "Configure offer limits and exception rules."),
    ("audit.view", "Administration", "View audit logs", "Read the immutable audit trail."),
]
FACULTY_DEFAULTS = {"students.view", "students.edit", "companies.manage", "jobs.create", "drives.publish", "applications.review", "offers.manage", "documents.upload", "reports.view"}

DEPARTMENTS = [
    ("CSE", "Computer Science & Engineering", "Dr. Lakshmi Narayanan"), ("IT", "Information Technology", "Dr. S. Karthikeyan"),
    ("AI&DS", "Artificial Intelligence & Data Science", "Dr. Anita Joseph"), ("ECE", "Electronics & Communication", "Dr. Mohan Raj"),
    ("EEE", "Electrical & Electronics", "Dr. R. Sundaram"), ("MECH", "Mechanical Engineering", "Dr. Vikram Iyer"), ("CIVIL", "Civil Engineering", "Dr. Farah Khan"),
]

POLICIES = [
    dict(name="Maximum accepted offers", description="A student may hold at most this many accepted offers at any time.", kind=PolicyKind.MAX_OFFERS, scope=PolicyScope.COLLEGE, params={"maxAcceptedOffers": 2}),
    dict(name="Dream / Super Dream tier rule", description="After accepting an offer, students may only apply to companies in a higher tier.", kind=PolicyKind.TIER_RESTRICTION, scope=PolicyScope.COLLEGE, params={"allowOnlyHigherTier": True}),
    dict(name="Concurrent application limit", description="Maximum number of simultaneously active applications per student.", kind=PolicyKind.APPLICATION_LIMIT, scope=PolicyScope.COLLEGE, params={"maxActiveApplications": 8}),
    dict(name="Offer acceptance window", description="Students must respond to an official offer within this many days unless extended by the placement cell.", kind=PolicyKind.ACCEPTED_OFFER, scope=PolicyScope.COLLEGE, params={"acceptanceWindowDays": 14}),
    dict(name="Eligibility exception approval", description="Any eligibility exception needs a written reason and an approving faculty member; it is recorded in the audit log.", kind=PolicyKind.EXCEPTION_APPROVAL, scope=PolicyScope.COLLEGE, params={"requireReason": True, "requireApprover": True}),
]


def seed_reference() -> dict:
    perms = {}
    for key, module, label, desc in PERMISSIONS:
        p = db.session.query(Permission).filter_by(key=key).first() or Permission(key=key, module=module, label=label, description=desc)
        db.session.add(p)
        perms[key] = p
    roles = {}
    for name, desc in ((RoleName.ADMIN, "Administrator"), (RoleName.FACULTY, "Faculty / Placement Officer"), (RoleName.STUDENT, "Student")):
        r = db.session.query(Role).filter_by(name=name).first()
        if r is None:  # grants are only initialised for new roles, never overwritten
            r = Role(name=name, description=desc)
            if name == RoleName.ADMIN:
                r.permissions = list(perms.values())
            elif name == RoleName.FACULTY:
                r.permissions = [p for k, p in perms.items() if k in FACULTY_DEFAULTS]
            db.session.add(r)
        roles[name.value] = r
    for code, name, head in DEPARTMENTS:
        if not db.session.query(Department).filter_by(code=code).first():
            d = Department(code=code, name=name, head_name=head)
            db.session.add(d)
            db.session.flush()
            db.session.add(Course(code=f"{code.replace('&', '')}-UG", name=name, degree=Degree.BE, department_id=d.id, duration_years=4))
    for label, gy, active in (("2026-27", 2027, True), ("2025-26", 2026, False), ("2027-28", 2028, False)):
        if not db.session.query(AcademicYear).filter_by(label=label).first():
            db.session.add(AcademicYear(label=label, graduation_year=gy, active=active))
    for p in POLICIES:
        if not db.session.query(PlacementPolicy).filter_by(name=p["name"]).first():
            db.session.add(PlacementPolicy(updated_by="system", **p))
    db.session.commit()
    return {"roles": len(roles), "permissions": len(perms)}
