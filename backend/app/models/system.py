import enum

from sqlalchemy import event

from ..extensions import db
from .base import enum_col, utcnow


class PolicyKind(str, enum.Enum):
    MAX_OFFERS = "max_offers"
    TIER_RESTRICTION = "tier_restriction"
    APPLICATION_LIMIT = "application_limit"
    ACCEPTED_OFFER = "accepted_offer"
    EXCEPTION_APPROVAL = "exception_approval"


class PolicyScope(str, enum.Enum):
    COLLEGE = "college"
    DEPARTMENT = "department"
    ACADEMIC_YEAR = "academic_year"


class AuditResult(str, enum.Enum):
    SUCCESS = "success"
    DENIED = "denied"
    FAILED = "failed"


class PlacementPolicy(db.Model):
    """Configurable, auditable placement rules. No offer limit is hardcoded anywhere in the code base."""
    __tablename__ = "placement_policies"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    description = db.Column(db.String(400), nullable=False, default="")
    kind = db.Column(enum_col(PolicyKind), nullable=False)
    scope = db.Column(enum_col(PolicyScope), nullable=False, default=PolicyScope.COLLEGE)
    scope_value = db.Column(db.String(32))  # department id or graduation year
    params = db.Column(db.JSON, nullable=False, default=dict)
    enabled = db.Column(db.Boolean, nullable=False, default=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)
    updated_by = db.Column(db.String(120), nullable=False, default="")


class AuditLog(db.Model):
    """Append-only. The ORM listeners below refuse UPDATE/DELETE; the API exposes no mutating endpoint.
    (In production also revoke UPDATE/DELETE on this table from the application's DB user.)"""
    __tablename__ = "audit_logs"
    __table_args__ = (db.Index("ix_audit_logs_created", "created_at"),)
    id = db.Column(db.Integer, primary_key=True)
    actor_id = db.Column(db.Integer)  # deliberately not a FK: logs must outlive users
    actor_name = db.Column(db.String(120), nullable=False)
    actor_role = db.Column(db.String(16), nullable=False)
    action = db.Column(db.String(64), nullable=False, index=True)
    resource = db.Column(db.String(255), nullable=False)
    result = db.Column(enum_col(AuditResult), nullable=False, default=AuditResult.SUCCESS)
    reason = db.Column(db.String(400))
    ip_address = db.Column(db.String(45))
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


@event.listens_for(AuditLog, "before_update")
@event.listens_for(AuditLog, "before_delete")
def _audit_is_immutable(mapper, connection, target):
    raise PermissionError("Audit log entries are immutable.")
