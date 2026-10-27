import enum

import sqlalchemy as sa
from sqlalchemy.orm import relationship

from ..extensions import db
from .base import TimestampMixin, enum_col, utcnow


class RoleName(str, enum.Enum):
    ADMIN = "admin"
    FACULTY = "faculty"
    STUDENT = "student"


class UserStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    INVITED = "invited"


role_permissions = db.Table(
    "role_permissions",
    db.Column("role_id", db.Integer, db.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    db.Column("permission_id", db.Integer, db.ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


class Role(db.Model):
    __tablename__ = "roles"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(enum_col(RoleName), nullable=False, unique=True)
    description = db.Column(db.String(255))
    permissions = relationship("Permission", secondary=role_permissions, back_populates="roles", lazy="selectin")


class Permission(db.Model):
    __tablename__ = "permissions"
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(64), nullable=False, unique=True)  # e.g. students.view
    module = db.Column(db.String(64), nullable=False)
    label = db.Column(db.String(120), nullable=False)
    description = db.Column(db.String(255))
    roles = relationship("Role", secondary=role_permissions, back_populates="permissions")


class User(TimestampMixin, db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    user_code = db.Column(db.String(32), nullable=False, unique=True)  # roll number / staff id
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(190), nullable=False, unique=True)
    password_hash = db.Column(db.String(255), nullable=False)  # never serialised
    role_id = db.Column(db.Integer, db.ForeignKey("roles.id"), nullable=False)
    department_id = db.Column(db.Integer, db.ForeignKey("departments.id", ondelete="SET NULL"))
    status = db.Column(enum_col(UserStatus), nullable=False, default=UserStatus.ACTIVE)
    onboarding_complete = db.Column(db.Boolean, nullable=False, default=False)
    failed_login_count = db.Column(db.Integer, nullable=False, default=0)
    locked_until = db.Column(db.DateTime)
    last_login_at = db.Column(db.DateTime)
    password_changed_at = db.Column(db.DateTime)  # refresh tokens issued before this are rejected

    role = relationship("Role", lazy="joined")
    department = relationship("Department")
    student = relationship("Student", back_populates="user", uselist=False)
    faculty_profile = relationship("FacultyProfile", back_populates="user", uselist=False)

    @property
    def role_name(self) -> str:
        return self.role.name.value

    @property
    def permission_keys(self) -> list[str]:
        return sorted(p.key for p in self.role.permissions)

    def has_permission(self, key: str) -> bool:
        return any(p.key == key for p in self.role.permissions)

    def is_locked(self) -> bool:
        return self.locked_until is not None and self.locked_until > utcnow()


class FacultyProfile(db.Model):
    __tablename__ = "faculty_profiles"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    department_id = db.Column(db.Integer, db.ForeignKey("departments.id", ondelete="SET NULL"))
    designation = db.Column(db.String(120))
    phone = db.Column(db.String(32))
    user = relationship("User", back_populates="faculty_profile")


class RevokedToken(db.Model):
    """Refresh-token blocklist (logout / rotation). Rows can be purged once expires_at has passed."""
    __tablename__ = "revoked_tokens"
    id = db.Column(db.Integer, primary_key=True)
    jti = db.Column(db.String(64), nullable=False, unique=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)
    revoked_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class PasswordResetToken(db.Model):
    """Only the SHA-256 of the emailed token is stored."""
    __tablename__ = "password_reset_tokens"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = db.Column(db.String(64), nullable=False, unique=True)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


__all__ = ["Role", "Permission", "User", "FacultyProfile", "RevokedToken", "PasswordResetToken", "RoleName", "UserStatus", "role_permissions", "sa"]
