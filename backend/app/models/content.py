import enum

from sqlalchemy.orm import relationship

from ..extensions import db
from .base import enum_col, utcnow


class DocumentType(str, enum.Enum):
    RESUME = "resume"
    CERTIFICATE = "certificate"
    BROCHURE = "brochure"
    CIRCULAR = "circular"
    ELIGIBILITY = "eligibility"


class ProcessingStatus(str, enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    INDEXED = "indexed"
    FAILED = "failed"


class ReminderKind(str, enum.Enum):
    DRIVE = "drive"
    DEADLINE = "deadline"
    INTERVIEW = "interview"
    CUSTOM = "custom"


class NotificationKind(str, enum.Enum):
    DRIVE = "drive"
    DEADLINE = "deadline"
    INTERVIEW = "interview"
    OFFER = "offer"
    SYSTEM = "system"
    APPLICATION = "application"


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"


class Document(db.Model):
    __tablename__ = "documents"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(190), nullable=False)
    doc_type = db.Column(enum_col(DocumentType), nullable=False)
    uploaded_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    owner_student_id = db.Column(db.Integer, db.ForeignKey("students.id", ondelete="CASCADE"), index=True)
    company_id = db.Column(db.Integer, db.ForeignKey("companies.id", ondelete="SET NULL"))
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id", ondelete="SET NULL"))
    access_roles = db.Column(db.JSON, nullable=False, default=list)  # roles allowed to read it
    size_kb = db.Column(db.Integer, nullable=False, default=0)
    storage_key = db.Column(db.String(255))  # object-store key; file bytes are never kept in MySQL
    processing = db.Column(enum_col(ProcessingStatus), nullable=False, default=ProcessingStatus.QUEUED)
    pages = db.Column(db.SmallInteger)
    version = db.Column(db.SmallInteger, nullable=False, default=1)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(db.Model):
    """Extracted text split for retrieval; page numbers let the assistant cite sources."""
    __tablename__ = "document_chunks"
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    page = db.Column(db.SmallInteger, nullable=False)
    chunk_index = db.Column(db.SmallInteger, nullable=False, default=0)
    text = db.Column(db.Text, nullable=False)
    document = relationship("Document", back_populates="chunks")


class AssistantActionState(str, enum.Enum):
    AWAITING = "awaiting_confirmation"
    EXECUTING = "executing"  # claimed by exactly one confirm request; never shown to the UI as such
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    FAILED = "failed"
    EXPIRED = "expired"


class Conversation(db.Model):
    """Always owned by exactly one user. archived_at is the soft delete: archived rows are invisible to the API and purged by `flask assistant-purge`."""
    __tablename__ = "conversations"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(120), nullable=False, default="New conversation")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)
    archived_at = db.Column(db.DateTime)
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan", order_by="Message.id")


class Message(db.Model):
    __tablename__ = "messages"
    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = db.Column(enum_col(MessageRole), nullable=False)
    text = db.Column(db.Text, nullable=False)
    payload = db.Column(db.JSON)  # jobIds, sources, tool-call trace, pending action
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    conversation = relationship("Conversation", back_populates="messages")


class AssistantAction(db.Model):
    """A change to application data proposed by the assistant. It does nothing until its owner confirms it; the payload is
    re-validated and executed through the normal service layer at confirmation time."""
    __tablename__ = "assistant_actions"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id = db.Column(db.Integer, db.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = db.Column(db.String(32), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.String(500), nullable=False, default="")
    details = db.Column(db.JSON, nullable=False, default=list)  # [{label, value}] shown on the confirmation card
    payload = db.Column(db.JSON, nullable=False, default=dict)  # validated arguments; never contains identity or permissions
    state = db.Column(enum_col(AssistantActionState), nullable=False, default=AssistantActionState.AWAITING)
    result_message = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    resolved_at = db.Column(db.DateTime)


class Reminder(db.Model):
    __tablename__ = "reminders"
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    remind_at = db.Column(db.DateTime, nullable=False, index=True)
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id", ondelete="SET NULL"))
    kind = db.Column(enum_col(ReminderKind), nullable=False, default=ReminderKind.CUSTOM)
    done = db.Column(db.Boolean, nullable=False, default=False)
    job = relationship("Job")


class Notification(db.Model):
    __tablename__ = "notifications"
    __table_args__ = (db.Index("ix_notifications_user_created", "user_id", "created_at"),)
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.String(500), nullable=False, default="")
    kind = db.Column(enum_col(NotificationKind), nullable=False, default=NotificationKind.SYSTEM)
    link = db.Column(db.String(200))
    is_read = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class NotificationPreference(db.Model):
    __tablename__ = "notification_preferences"
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    email = db.Column(db.Boolean, nullable=False, default=True)
    push = db.Column(db.Boolean, nullable=False, default=False)
    drive_reminders = db.Column(db.Boolean, nullable=False, default=True)
    deadline_reminders = db.Column(db.Boolean, nullable=False, default=True)
    interview_alerts = db.Column(db.Boolean, nullable=False, default=True)
    offer_updates = db.Column(db.Boolean, nullable=False, default=True)


class SavedJob(db.Model):
    __tablename__ = "saved_jobs"
    student_id = db.Column(db.Integer, db.ForeignKey("students.id", ondelete="CASCADE"), primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
