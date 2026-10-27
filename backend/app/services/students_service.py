"""Staff-facing student directory. Data minimisation rules:
  * only holders of students.view can list/read students; students themselves use /student/* instead
  * phone numbers are masked for everyone except admins (the student sees their own via /student/profile)
  * password hashes, lock counters and tokens are never part of any serializer
  * reading one student's full placement profile is written to the audit log"""
import sqlalchemy as sa

from ..errors import Forbidden, NotFound, ValidationFailed
from ..extensions import db
from ..models import AcademicRecord, Application, NotificationKind, Offer, PlacementStatus, SkillKind, Student, StudentSkill, User, utcnow
from ..schemas.students import StudentQuery, VerifyCgpaIn
from ..serializers import student_dict
from . import audit
from .notifications import notify
from .student_service import completion
from .views import application_view, offer_view


def _mask(viewer: User) -> bool:
    return viewer.role_name != "admin"


def _like(term: str) -> str:
    return "%" + term.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _row(s: Student, viewer: User, apps: dict[int, int], offers: dict[int, int]) -> dict:
    return {**student_dict(s, mask_phone=_mask(viewer)), "applicationCount": apps.get(s.id, 0), "offerCount": offers.get(s.id, 0)}


def list_students(viewer: User, q: StudentQuery) -> tuple[list[dict], int]:
    query = db.session.query(Student).join(User, Student.user_id == User.id).outerjoin(AcademicRecord, AcademicRecord.student_id == Student.id)
    if q.q:
        pat = _like(q.q)
        query = query.filter(sa.or_(sa.func.lower(User.name).like(pat, escape="\\"), sa.func.lower(Student.student_code).like(pat, escape="\\"), sa.func.lower(User.email).like(pat, escape="\\")))
    if q.dept:
        query = query.filter(Student.department_id == q.dept)
    if q.year:
        query = query.filter(Student.graduation_year == q.year)
    if q.min_cgpa is not None:
        query = query.filter(AcademicRecord.cgpa >= q.min_cgpa)  # students without a CGPA never satisfy a CGPA filter
    if q.skill:
        query = query.filter(Student.id.in_(sa.select(StudentSkill.student_id).where(StudentSkill.kind == SkillKind.SKILL, sa.func.lower(StudentSkill.name).like(_like(q.skill), escape="\\"))))
    if q.placement:
        query = query.filter(Student.placement_status == PlacementStatus(q.placement))
    total = query.count()
    rows = query.order_by(User.name, Student.id).offset((q.page - 1) * q.page_size).limit(q.page_size).all()
    ids = [s.id for s in rows]
    apps = dict(db.session.query(Application.student_id, sa.func.count()).filter(Application.student_id.in_(ids)).group_by(Application.student_id).all()) if ids else {}
    offers = dict(db.session.query(Offer.student_id, sa.func.count()).filter(Offer.student_id.in_(ids)).group_by(Offer.student_id).all()) if ids else {}
    return [_row(s, viewer, apps, offers) for s in rows], total


def get_student(viewer: User, student_id: int) -> dict:
    s = db.session.get(Student, student_id)
    if s is None:
        raise NotFound("Student")
    apps = db.session.query(Application).filter_by(student_id=s.id).order_by(Application.applied_at.desc(), Application.id.desc()).all()
    offers = db.session.query(Offer).filter_by(student_id=s.id).order_by(Offer.offered_at.desc(), Offer.id.desc()).all()
    audit.record("student.view", f"Student {s.student_code or s.id}", actor=viewer, commit=True)
    return {
        "student": _row(s, viewer, {s.id: len(apps)}, {s.id: len(offers)}),
        "applications": [application_view(a, viewer) for a in apps],
        "offers": [offer_view(o, viewer) for o in offers],
    }


def verify_cgpa(actor: User, student_id: int, data: VerifyCgpaIn) -> dict:
    """Confirms (or corrects) the CGPA. Only students.edit holders reach this; students can never verify their own."""
    s = db.session.get(Student, student_id)
    if s is None:
        raise NotFound("Student")
    if s.user_id == actor.id:
        raise Forbidden("You cannot verify your own academic record.")
    a = s.academic or AcademicRecord(student=s)
    before = float(a.cgpa) if a.cgpa is not None else None
    if data.cgpa is None and before is None:
        raise ValidationFailed("This student has not entered a CGPA yet.", details={"cgpa": ["Required: the student has no CGPA on file"]})
    if data.cgpa is not None:
        a.cgpa = data.cgpa
    a.cgpa_verified, a.verified_by, a.verified_at = True, actor.id, utcnow()
    db.session.add(a)
    db.session.flush()
    s.profile_completion = completion(s)
    corrected = data.cgpa is not None and before is not None and abs(before - data.cgpa) > 1e-9
    audit.record("student.verify_cgpa", f"Student {s.student_code or s.id}", actor=actor, reason=f"CGPA corrected {before:.2f} -> {data.cgpa:.2f}" if corrected else None)
    notify(s.user_id, "Your CGPA has been verified", "You can now apply to jobs you are eligible for." + (" The placement cell corrected the value." if corrected else ""), NotificationKind.SYSTEM, "/student/profile")
    db.session.commit()
    return _row(s, actor, {}, {})
