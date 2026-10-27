"""Import every model so Alembic and db.create_all() see the full metadata."""
from .academic import AcademicRecord, AcademicYear, Course, Degree, Department, PlacementStatus, SkillKind, Student, StudentSkill
from .applications import (
    Application, ApplicationEligibilitySnapshot, ApplicationStatus, ApplicationStatusHistory, EligibilityState, Interview, InterviewStatus, Offer,
    OfferStatus, interview_candidates,
)
from .base import iso, sid, to_epoch, utcnow
from .companies import Company, CompanyTier, DriveEvent, HiringDrive, Job, JobEligibilityRule, JobStatus, JobType, RoundMode, job_departments
from .content import (
    AssistantAction, AssistantActionState, Conversation, Document, DocumentChunk, DocumentType, Message, MessageRole, Notification, NotificationKind, NotificationPreference, ProcessingStatus,
    Reminder, ReminderKind, SavedJob,
)
from .system import AuditLog, AuditResult, PlacementPolicy, PolicyKind, PolicyScope
from .users import FacultyProfile, PasswordResetToken, Permission, RevokedToken, Role, RoleName, User, UserStatus, role_permissions

__all__ = [n for n in dir() if not n.startswith("_")]
