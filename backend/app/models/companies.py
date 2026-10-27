import enum

from sqlalchemy.orm import relationship

from ..extensions import db
from .base import TimestampMixin, enum_col


class CompanyTier(str, enum.Enum):
    REGULAR = "regular"
    DREAM = "dream"
    SUPER_DREAM = "super_dream"


class JobStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CLOSED = "closed"
    CANCELLED = "cancelled"


class JobType(str, enum.Enum):
    FULL_TIME = "Full-time"
    INTERNSHIP = "Internship"
    INTERNSHIP_PPO = "Internship + PPO"


class RoundMode(str, enum.Enum):
    ONLINE = "Online"
    ON_CAMPUS = "On-campus"
    VIRTUAL = "Virtual"


class Company(TimestampMixin, db.Model):
    __tablename__ = "companies"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False, unique=True)
    website = db.Column(db.String(300), nullable=False)
    industry = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=False, default="")
    contact_name = db.Column(db.String(120), nullable=False, default="")
    contact_email = db.Column(db.String(190), nullable=False, default="")
    contact_phone = db.Column(db.String(40))
    tier = db.Column(enum_col(CompanyTier), nullable=False, default=CompanyTier.REGULAR)
    brand_color = db.Column(db.String(9), nullable=False, default="#2563eb")
    archived_at = db.Column(db.DateTime)  # soft archive: hidden from default lists/pickers, history is kept
    jobs = relationship("Job", back_populates="company")
    drives = relationship("HiringDrive", back_populates="company")


class HiringDrive(TimestampMixin, db.Model):
    """A campus visit by a company. One company -> many drives; one drive -> many jobs and many rounds (DriveEvents)."""
    __tablename__ = "hiring_drives"
    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("companies.id"), nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False)
    drive_date = db.Column(db.DateTime)
    venue = db.Column(db.String(200))
    created_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    company = relationship("Company", back_populates="drives")
    events = relationship("DriveEvent", back_populates="drive", cascade="all, delete-orphan", order_by="DriveEvent.sequence", lazy="selectin")
    jobs = relationship("Job", back_populates="drive")


class DriveEvent(db.Model):
    """One hiring round of a drive (online test, technical interview, HR ...)."""
    __tablename__ = "drive_events"
    id = db.Column(db.Integer, primary_key=True)
    drive_id = db.Column(db.Integer, db.ForeignKey("hiring_drives.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = db.Column(db.SmallInteger, nullable=False, default=1)
    name = db.Column(db.String(120), nullable=False)
    mode = db.Column(enum_col(RoundMode), nullable=False, default=RoundMode.ONLINE)
    scheduled_at = db.Column(db.DateTime)
    location = db.Column(db.String(200))
    drive = relationship("HiringDrive", back_populates="events")


job_departments = db.Table(
    "job_departments",
    db.Column("job_id", db.Integer, db.ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True),
    db.Column("department_id", db.Integer, db.ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True),
)


class Job(TimestampMixin, db.Model):
    __tablename__ = "jobs"
    __table_args__ = (db.Index("ix_jobs_status_deadline", "status", "deadline"),)
    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("companies.id"), nullable=False, index=True)
    drive_id = db.Column(db.Integer, db.ForeignKey("hiring_drives.id", ondelete="SET NULL"), index=True)
    title = db.Column(db.String(160), nullable=False)
    domain = db.Column(db.String(80), nullable=False, default="Software")
    location = db.Column(db.String(160), nullable=False, default="")
    job_type = db.Column(enum_col(JobType), nullable=False, default=JobType.FULL_TIME)
    description = db.Column(db.Text, nullable=False, default="")
    responsibilities = db.Column(db.JSON, nullable=False, default=list)
    skills = db.Column(db.JSON, nullable=False, default=list)
    ctc_lpa = db.Column(db.Numeric(6, 2))
    stipend_per_month = db.Column(db.Integer)
    open_date = db.Column(db.DateTime, nullable=False)
    deadline = db.Column(db.DateTime, nullable=False)
    status = db.Column(enum_col(JobStatus), nullable=False, default=JobStatus.DRAFT)
    published_at = db.Column(db.DateTime)
    archived_at = db.Column(db.DateTime)  # soft archive, independent of status (only draft/closed/cancelled jobs can be archived)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))

    company = relationship("Company", back_populates="jobs", lazy="joined")
    drive = relationship("HiringDrive", back_populates="jobs", lazy="joined")
    rule = relationship("JobEligibilityRule", back_populates="job", uselist=False, cascade="all, delete-orphan", lazy="joined")
    departments = relationship("Department", secondary=job_departments, lazy="selectin")


class JobEligibilityRule(db.Model):
    """Structured eligibility. Evaluated only by app.services.eligibility (never by the LLM or the client)."""
    __tablename__ = "job_eligibility_rules"
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, unique=True)
    min_cgpa = db.Column(db.Numeric(4, 2), nullable=False, default=0)
    max_active_arrears = db.Column(db.SmallInteger, nullable=False, default=0)
    max_arrear_history = db.Column(db.SmallInteger)
    graduation_years = db.Column(db.JSON, nullable=False, default=list)
    required_skills = db.Column(db.JSON, nullable=False, default=list)
    job = relationship("Job", back_populates="rule")
