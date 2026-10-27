"""Demo data for local development ONLY (fictional people, companies and numbers). Never run in production."""
import random
from datetime import timedelta

from .extensions import db
from .models import (
    AcademicRecord, Application, ApplicationEligibilitySnapshot, ApplicationStatus, ApplicationStatusHistory, Company, CompanyTier, Department, DriveEvent, FacultyProfile, HiringDrive,
    Interview, Job, JobEligibilityRule, JobStatus, JobType, Notification, NotificationKind, Offer, OfferStatus, PlacementStatus, Reminder, ReminderKind, Role, RoleName, RoundMode,
    SkillKind, Student, StudentSkill, User, UserStatus, utcnow,
)
from .security import hash_password
from .services import eligibility
from .services.student_service import completion

FIRST = ["Ishaan", "Diya", "Rohan", "Ananya", "Karthik", "Priya", "Vihaan", "Sneha", "Arjun", "Kavya", "Nikhil", "Lakshmi", "Siddharth", "Pooja"]
LAST = ["Sharma", "Iyer", "Reddy", "Pillai", "Kumar", "Subramanian", "Das", "Gupta", "Natarajan", "Raman"]
CS = ["CSE", "IT", "AI&DS"]
COMPANIES = [  # name, industry, tier, colour
    ("TCS", "IT Services", CompanyTier.REGULAR, "#1d4ed8"), ("Zoho", "Software Products", CompanyTier.DREAM, "#b91c1c"), ("Infosys", "IT Services", CompanyTier.REGULAR, "#0f766e"),
    ("Wipro", "IT Services", CompanyTier.REGULAR, "#7c3aed"), ("Accenture", "Consulting", CompanyTier.REGULAR, "#9333ea"), ("Bosch", "Engineering & Automotive", CompanyTier.DREAM, "#dc2626"),
    ("L&T", "Construction & Engineering", CompanyTier.REGULAR, "#d97706"), ("Freshworks", "SaaS", CompanyTier.SUPER_DREAM, "#0891b2"),
]
# company, title, ctc, min_cgpa, arrears, history, depts, skills, deadline_days, drive_days, status
JOBS = [
    ("TCS", "TCS Ninja", 3.6, 6.0, 1, None, None, ["Aptitude", "Programming Basics"], -20, -12, JobStatus.CLOSED),
    ("TCS", "TCS Digital", 7.0, 7.5, 0, 2, CS + ["ECE"], ["Java", "Python", "SQL"], 4, 9, JobStatus.PUBLISHED),
    ("TCS", "TCS Prime", 9.0, 8.0, 0, 0, CS, ["Java", "System Design", "Cloud"], 6, 13, JobStatus.PUBLISHED),
    ("Zoho", "Software Developer", 8.5, 7.0, 0, None, CS + ["ECE", "EEE"], ["C++", "Data Structures", "Algorithms"], 3, 8, JobStatus.PUBLISHED),
    ("Infosys", "Systems Engineer", 3.8, 6.0, 0, None, None, ["Aptitude", "Java", "SQL"], 12, 17, JobStatus.PUBLISHED),
    ("Infosys", "Specialist Programmer", 9.5, 7.5, 0, None, CS, ["Algorithms", "Python", "Java"], 14, 20, JobStatus.PUBLISHED),
    ("Wipro", "Turbo Hiring", 6.5, 7.0, 0, None, CS, ["Java", "Cloud"], 16, 22, JobStatus.PUBLISHED),
    ("Accenture", "Associate Software Engineer", 4.5, 6.5, 1, None, ["CSE", "IT", "AI&DS", "ECE", "EEE", "MECH"], ["Programming Basics", "Communication"], 9, 15, JobStatus.PUBLISHED),
    ("Accenture", "Advanced App Engineering Analyst", 6.5, 7.5, 0, None, CS, ["Cloud", "Java"], 25, 30, JobStatus.DRAFT),
    ("Bosch", "Embedded Software Engineer", 7.2, 7.5, 0, None, ["ECE", "EEE", "CSE"], ["C", "Embedded Systems", "RTOS"], 7, 12, JobStatus.PUBLISHED),
    ("L&T", "Graduate Engineer Trainee", 5.5, 7.0, 0, None, ["MECH", "CIVIL", "EEE"], ["AutoCAD", "Project Management"], 11, 18, JobStatus.PUBLISHED),
    ("Freshworks", "Software Development Engineer", 14.0, 8.0, 0, 0, CS, ["React", "TypeScript", "Node.js"], 5, 11, JobStatus.PUBLISHED),
]


def _make_user(role: RoleName, code: str, name: str, email: str, password_hash: str, dept: Department | None, *, status=UserStatus.ACTIVE, onboarded=True) -> User:
    r = db.session.query(Role).filter_by(name=role).one()
    u = User(user_code=code, name=name, email=email, password_hash=password_hash, role_id=r.id, department_id=dept.id if dept else None, status=status, onboarding_complete=onboarded,
             last_login_at=utcnow() - timedelta(days=1))
    db.session.add(u)
    db.session.flush()
    return u


def _make_student(u: User, dept: Department, code: str, cgpa: float | None, *, verified=True, arrears=0, history=0, skills=("Python", "SQL", "Java"), year=2027, resume=True) -> Student:
    s = Student(user_id=u.id, student_code=code or None, department_id=dept.id, degree="B.E." if code else "", current_year=4, graduation_year=year, phone="+91 98400 12345" if code else None,
                resume_file=f"{u.name.split()[0].lower()}_resume.pdf" if resume else None, portfolio_url="https://github.com/example" if code else None)
    s.academic = AcademicRecord(cgpa=cgpa, cgpa_verified=verified, active_arrears=arrears, arrear_history=history)
    for sk in skills:
        s.skills.append(StudentSkill(kind=SkillKind.SKILL, name=sk))
    if code:
        s.skills.append(StudentSkill(kind=SkillKind.INTEREST, name="Web Development"))
        s.skills.append(StudentSkill(kind=SkillKind.PREFERRED_ROLE, name="Software Engineer"))
    db.session.add(s)
    db.session.flush()
    s.profile_completion = completion(s)
    return s


def seed_demo(password: str, seed: int = 42) -> dict:
    rnd = random.Random(seed)
    now = utcnow()
    day = lambda n, h=10: (now + timedelta(days=n)).replace(hour=h, minute=0, second=0, microsecond=0)  # noqa: E731
    pw = hash_password(password)
    depts = {d.code: d for d in db.session.query(Department)}

    if db.session.query(User).filter_by(email="admin@campus.demo").first():
        return {"skipped": "demo data already present"}

    admin = _make_user(RoleName.ADMIN, "ADM001", "Rahul Verma", "admin@campus.demo", pw, None)
    fac = _make_user(RoleName.FACULTY, "FAC101", "Dr. Priya Raman", "faculty@campus.demo", pw, depts["CSE"])
    db.session.add(FacultyProfile(user_id=fac.id, department_id=depts["CSE"].id, designation="Placement Officer"))
    _make_user(RoleName.FACULTY, "FAC102", "Prof. Manoj Bhat", "manoj.bhat@campus.demo", pw, depts["ECE"])
    _make_user(RoleName.FACULTY, "FAC105", "Dr. Latha Menon", "latha.menon@campus.demo", pw, depts["EEE"], status=UserStatus.INVITED)

    companies = {}
    for name, industry, tier, color in COMPANIES:
        c = Company(name=name, industry=industry, tier=tier, brand_color=color, website=f"https://www.{name.lower().replace('&', '')}.example.com",
                    description=f"{name} campus hiring (illustrative demo data).", contact_name="Campus Relations", contact_email=f"campus@{name.lower().replace('&', '')}.example.com")
        db.session.add(c)
        companies[name] = c
    db.session.flush()

    jobs = {}
    for comp, title, ctc, cgpa, arr, hist, dnames, skills, dl, dv, status in JOBS:
        drive = HiringDrive(company_id=companies[comp].id, name=f"{comp} campus drive — {title}", drive_date=day(dv), venue="Placement Cell, Block C", created_by=fac.id)
        for i, (rname, mode) in enumerate((("Online Assessment", RoundMode.ONLINE), ("Technical Interview", RoundMode.ON_CAMPUS), ("HR Interview", RoundMode.ON_CAMPUS)), 1):
            drive.events.append(DriveEvent(sequence=i, name=rname, mode=mode))
        j = Job(company_id=companies[comp].id, drive=drive, title=title, domain="Software", location="Chennai", job_type=JobType.FULL_TIME, ctc_lpa=ctc, skills=skills,
                description="Join the graduate programme and work with experienced engineers on real projects. Illustrative demo data.",
                responsibilities=["Contribute to production code and reviews", "Learn through structured onboarding and mentoring"],
                open_date=day(-14), deadline=day(dl), status=status, published_at=None if status == JobStatus.DRAFT else day(-14), created_by=fac.id)
        j.rule = JobEligibilityRule(min_cgpa=cgpa, max_active_arrears=arr, max_arrear_history=hist, graduation_years=[2027], required_skills=[])
        j.departments = list(depts.values()) if dnames is None else [depts[d] for d in dnames]
        db.session.add(j)
        jobs[title] = j
    db.session.flush()

    # ---- personas
    aarav_user = _make_user(RoleName.STUDENT, "23CSE101", "Aarav Menon", "student@campus.demo", pw, depts["CSE"])
    aarav = _make_student(aarav_user, depts["CSE"], "23CSE101", 8.42, skills=("React", "TypeScript", "Python", "SQL", "Data Structures", "Java"))
    meera_user = _make_user(RoleName.STUDENT, "NEW002", "Meera Nair", "newstudent@campus.demo", pw, depts["IT"], onboarded=False)
    _make_student(meera_user, depts["IT"], "", None, verified=False, skills=(), resume=False)
    others = []
    for i in range(12):
        d = depts[rnd.choice(list(depts))]
        name = f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"
        code = f"23{d.code.replace('&', '')[:3]}{110 + i}"
        u = _make_user(RoleName.STUDENT, code, name, f"{name.split()[0].lower()}.{i}@campus.demo", pw, d)
        others.append(_make_student(u, d, code, round(rnd.uniform(6.2, 9.4), 2), verified=rnd.random() > 0.15, arrears=1 if rnd.random() < 0.1 else 0, skills=tuple(rnd.sample(["Python", "Java", "SQL", "C++", "React", "Cloud"], 3))))
    db.session.flush()

    def add_app(student: Student, job: Job, status: ApplicationStatus, days_ago: int, round_name: str | None = None) -> Application:
        a = Application(student_id=student.id, job_id=job.id, status=status, applied_at=day(-days_ago, 11), current_round=round_name)
        res = eligibility.evaluate(student, job, now=a.applied_at - timedelta(minutes=1) if job.status == JobStatus.CLOSED else None, ignore_open=True)
        a.snapshot = ApplicationEligibilitySnapshot(state=res["state"], summary=res["summary"], checks=res["checks"], evaluated_at=a.applied_at)
        chain = [ApplicationStatus.APPLIED, ApplicationStatus.SHORTLISTED, ApplicationStatus.INTERVIEW, ApplicationStatus.SELECTED, ApplicationStatus.OFFER_RECEIVED]
        steps = chain[: chain.index(status) + 1] if status in chain else [ApplicationStatus.APPLIED, status]
        for k, st in enumerate(steps):
            a.history.append(ApplicationStatusHistory(status=st, at=day(-days_ago + 2 * k, 12), note="Application submitted" if k == 0 else f"Moved to {st.value}", changed_by_name=student.user.name if k == 0 else "Placement Cell"))
        db.session.add(a)
        db.session.flush()
        return a

    a1 = add_app(aarav, jobs["TCS Ninja"], ApplicationStatus.OFFER_RECEIVED, 30)
    a2 = add_app(aarav, jobs["TCS Digital"], ApplicationStatus.INTERVIEW, 8, "Technical Interview")
    add_app(aarav, jobs["Software Developer"], ApplicationStatus.SHORTLISTED, 6, "Technical Interview")
    add_app(aarav, jobs["Systems Engineer"], ApplicationStatus.APPLIED, 2)
    db.session.add(Offer(application_id=a1.id, student_id=aarav.id, job_id=jobs["TCS Ninja"].id, company_id=companies["TCS"].id, ctc_lpa=3.6, offered_at=day(-24), accept_by=day(10), status=OfferStatus.RECEIVED,
                         policy_checks=[{"label": "Within accepted-offer limit", "passed": True, "detail": "Within the college limit at the time of issue."}]))
    iv = Interview(job_id=jobs["TCS Digital"].id, round_name="Technical Interview", scheduled_at=day(2), duration_mins=45, location="Placement Cell, Block C — Room 204", notified=True)
    iv.applications = [a2]
    db.session.add(iv)

    for s in others[:6]:
        for title in rnd.sample(["TCS Digital", "Software Developer", "Systems Engineer", "Embedded Software Engineer"], 2):
            if eligibility.evaluate(s, jobs[title], ignore_open=True)["state"].value != "not_eligible":
                add_app(s, jobs[title], rnd.choice([ApplicationStatus.APPLIED, ApplicationStatus.SHORTLISTED, ApplicationStatus.INTERVIEW]), rnd.randint(1, 10))
    closed = [s for s in others[6:] if s.academic.cgpa and float(s.academic.cgpa) >= 6.0]
    for s in closed[:4]:  # historical placements so reports have substance
        a = add_app(s, jobs["TCS Ninja"], ApplicationStatus.OFFER_RECEIVED, 35)
        db.session.add(Offer(application_id=a.id, student_id=s.id, job_id=a.job_id, company_id=companies["TCS"].id, ctc_lpa=3.6, offered_at=day(-28), accept_by=day(-14), status=OfferStatus.ACCEPTED))
        s.placement_status = PlacementStatus.PLACED
    db.session.flush()

    for title, body, kind, link, ago in (
        ("Interview scheduled — TCS Digital", "Technical Interview is scheduled. Check the interview schedule on your application.", NotificationKind.INTERVIEW, "/student/applications", 0),
        ("Offer received from TCS", "You have an official offer for TCS Ninja. Respond before the acceptance deadline.", NotificationKind.OFFER, "/student/offers", 1),
        ("Deadline approaching — Zoho Software Developer", "Applications for Zoho close in 3 days.", NotificationKind.DEADLINE, "/student/jobs", 1),
    ):
        db.session.add(Notification(user_id=aarav_user.id, title=title, body=body, kind=kind, link=link, created_at=now - timedelta(days=ago)))
    db.session.add(Notification(user_id=meera_user.id, title="Welcome to Campus Assistant", body="Complete your profile so we can evaluate your eligibility for jobs.", kind=NotificationKind.SYSTEM))
    db.session.add(Notification(user_id=fac.id, title="3 hiring drives need attention", body="Deadlines close within 5 days for TCS Digital, Zoho and Freshworks.", kind=NotificationKind.DEADLINE, link="/faculty/jobs"))
    db.session.add(Reminder(student_id=aarav.id, title="Update resume before the Zoho drive", remind_at=day(6, 9), job_id=jobs["Software Developer"].id, kind=ReminderKind.DRIVE))
    db.session.commit()
    return {"users": db.session.query(User).count(), "jobs": db.session.query(Job).count(), "applications": db.session.query(Application).count(), "offers": db.session.query(Offer).count()}
