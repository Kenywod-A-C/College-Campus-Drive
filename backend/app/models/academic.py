import enum

from sqlalchemy.orm import relationship

from ..extensions import db
from .base import TimestampMixin, enum_col


class Degree(str, enum.Enum):
    BE = "B.E."
    BTECH = "B.Tech"
    ME = "M.E."
    MTECH = "M.Tech"
    MBA = "MBA"
    MCA = "MCA"


class PlacementStatus(str, enum.Enum):
    UNPLACED = "unplaced"
    IN_PROCESS = "in_process"
    PLACED = "placed"
    OPTED_OUT = "opted_out"


class SkillKind(str, enum.Enum):
    SKILL = "skill"
    INTEREST = "interest"
    PREFERRED_ROLE = "preferred_role"


class Department(db.Model):
    __tablename__ = "departments"
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(16), nullable=False, unique=True)
    name = db.Column(db.String(160), nullable=False)
    head_name = db.Column(db.String(120))


class Course(db.Model):
    __tablename__ = "courses"
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(24), nullable=False, unique=True)
    name = db.Column(db.String(160), nullable=False)
    degree = db.Column(enum_col(Degree), nullable=False)
    department_id = db.Column(db.Integer, db.ForeignKey("departments.id"), nullable=False)
    duration_years = db.Column(db.SmallInteger, nullable=False, default=4)
    department = relationship("Department")


class AcademicYear(db.Model):
    __tablename__ = "academic_years"
    id = db.Column(db.Integer, primary_key=True)
    label = db.Column(db.String(16), nullable=False, unique=True)  # 2026-27
    graduation_year = db.Column(db.SmallInteger, nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=False)


class Student(TimestampMixin, db.Model):
    __tablename__ = "students"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    student_code = db.Column(db.String(32), unique=True)  # null until onboarding collects it
    phone = db.Column(db.String(32))
    department_id = db.Column(db.Integer, db.ForeignKey("departments.id"), nullable=False)
    degree = db.Column(db.String(16), nullable=False, default="")
    current_year = db.Column(db.SmallInteger, nullable=False, default=4)
    graduation_year = db.Column(db.SmallInteger, nullable=False)
    resume_file = db.Column(db.String(255))
    portfolio_url = db.Column(db.String(300))
    placement_status = db.Column(enum_col(PlacementStatus), nullable=False, default=PlacementStatus.UNPLACED)
    profile_completion = db.Column(db.SmallInteger, nullable=False, default=0)

    user = relationship("User", back_populates="student")
    department = relationship("Department")
    academic = relationship("AcademicRecord", back_populates="student", uselist=False, cascade="all, delete-orphan", lazy="joined")
    skills = relationship("StudentSkill", back_populates="student", cascade="all, delete-orphan", lazy="selectin", order_by="StudentSkill.id")

    def tags(self, kind: SkillKind) -> list[str]:
        return [s.name for s in self.skills if s.kind == kind]


class AcademicRecord(db.Model):
    """Official academic data. cgpa_verified can only be set by staff holding students.edit."""
    __tablename__ = "academic_records"
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("students.id", ondelete="CASCADE"), nullable=False, unique=True)
    cgpa = db.Column(db.Numeric(4, 2))
    cgpa_verified = db.Column(db.Boolean, nullable=False, default=False)
    active_arrears = db.Column(db.SmallInteger, nullable=False, default=0)
    arrear_history = db.Column(db.SmallInteger, nullable=False, default=0)
    verified_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    verified_at = db.Column(db.DateTime)
    student = relationship("Student", back_populates="academic")


class StudentSkill(db.Model):
    __tablename__ = "student_skills"
    __table_args__ = (db.UniqueConstraint("student_id", "kind", "name", name="uq_student_skills_student_kind_name"),)
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    kind = db.Column(enum_col(SkillKind), nullable=False, default=SkillKind.SKILL)
    name = db.Column(db.String(80), nullable=False)
    student = relationship("Student", back_populates="skills")
