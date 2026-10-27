import enum

from sqlalchemy.orm import relationship

from ..extensions import db
from .base import enum_col, utcnow


class ApplicationStatus(str, enum.Enum):
    APPLIED = "applied"
    SHORTLISTED = "shortlisted"
    INTERVIEW = "interview"
    SELECTED = "selected"
    OFFER_RECEIVED = "offer_received"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class EligibilityState(str, enum.Enum):
    ELIGIBLE = "eligible"
    NOT_ELIGIBLE = "not_eligible"
    PROFILE_INCOMPLETE = "profile_incomplete"
    NEEDS_VERIFICATION = "needs_verification"


class InterviewStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class OfferStatus(str, enum.Enum):
    PENDING = "pending"
    RECEIVED = "received"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    WITHDRAWN = "withdrawn"


class Application(db.Model):
    """Applications, interview results, selections and offers are separate records by design."""
    __tablename__ = "applications"
    __table_args__ = (db.Index("ix_applications_student_status", "student_id", "status"),)
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id"), nullable=False, index=True)
    status = db.Column(enum_col(ApplicationStatus), nullable=False, default=ApplicationStatus.APPLIED)
    current_round = db.Column(db.String(120))
    applied_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    student = relationship("Student")
    job = relationship("Job")
    history = relationship("ApplicationStatusHistory", back_populates="application", cascade="all, delete-orphan", order_by="ApplicationStatusHistory.at, ApplicationStatusHistory.id", lazy="selectin")
    snapshot = relationship("ApplicationEligibilitySnapshot", back_populates="application", uselist=False, cascade="all, delete-orphan", lazy="joined")
    offer = relationship("Offer", back_populates="application", uselist=False)


class ApplicationStatusHistory(db.Model):
    __tablename__ = "application_status_history"
    id = db.Column(db.Integer, primary_key=True)
    application_id = db.Column(db.Integer, db.ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True)
    status = db.Column(enum_col(ApplicationStatus), nullable=False)
    at = db.Column(db.DateTime, nullable=False, default=utcnow)
    note = db.Column(db.String(255))
    changed_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    changed_by_name = db.Column(db.String(120), nullable=False, default="")
    application = relationship("Application", back_populates="history")


class ApplicationEligibilitySnapshot(db.Model):
    """The exact eligibility result at submission time, kept for audit even if rules or profile later change."""
    __tablename__ = "application_eligibility_snapshots"
    id = db.Column(db.Integer, primary_key=True)
    application_id = db.Column(db.Integer, db.ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, unique=True)
    state = db.Column(enum_col(EligibilityState), nullable=False)
    summary = db.Column(db.String(400), nullable=False, default="")
    checks = db.Column(db.JSON, nullable=False, default=list)
    evaluated_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    exception_reason = db.Column(db.String(400))
    exception_approved_by = db.Column(db.String(120))
    application = relationship("Application", back_populates="snapshot")


interview_candidates = db.Table(
    "interview_candidates",
    db.Column("interview_id", db.Integer, db.ForeignKey("interviews.id", ondelete="CASCADE"), primary_key=True),
    db.Column("application_id", db.Integer, db.ForeignKey("applications.id", ondelete="CASCADE"), primary_key=True),
)


class Interview(db.Model):
    __tablename__ = "interviews"
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id"), nullable=False, index=True)
    round_name = db.Column(db.String(120), nullable=False)
    scheduled_at = db.Column(db.DateTime, nullable=False, index=True)
    duration_mins = db.Column(db.SmallInteger, nullable=False, default=45)
    location = db.Column(db.String(300), nullable=False)
    status = db.Column(enum_col(InterviewStatus), nullable=False, default=InterviewStatus.SCHEDULED)
    notified = db.Column(db.Boolean, nullable=False, default=False)
    job = relationship("Job")
    applications = relationship("Application", secondary=interview_candidates)


class Offer(db.Model):
    __tablename__ = "offers"
    id = db.Column(db.Integer, primary_key=True)
    application_id = db.Column(db.Integer, db.ForeignKey("applications.id"), nullable=False, unique=True)
    student_id = db.Column(db.Integer, db.ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id"), nullable=False)
    company_id = db.Column(db.Integer, db.ForeignKey("companies.id"), nullable=False, index=True)
    ctc_lpa = db.Column(db.Numeric(6, 2), nullable=False)
    offered_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    accept_by = db.Column(db.DateTime, nullable=False)
    status = db.Column(enum_col(OfferStatus), nullable=False, default=OfferStatus.RECEIVED)
    policy_checks = db.Column(db.JSON, nullable=False, default=list)
    application = relationship("Application", back_populates="offer")
    student = relationship("Student")
    job = relationship("Job")
    company = relationship("Company")
