import hashlib
import secrets
from datetime import timedelta

from flask import current_app

from ..errors import Forbidden, Unauthenticated, ValidationFailed
from ..extensions import db
from ..models import AuditResult, PasswordResetToken, RevokedToken, User, UserStatus, utcnow
from ..security import hash_password, validate_new_password, verify_password
from . import audit

GENERIC_LOGIN_ERROR = "Incorrect email/ID or password, or the account is temporarily locked."


def authenticate(identifier: str, password: str) -> User:
    ident = identifier.strip().lower()
    user = db.session.query(User).filter(db.func.lower(User.email) == ident).first() or db.session.query(User).filter(db.func.lower(User.user_code) == ident).first()
    password_ok = verify_password(user.password_hash if user else None, password)  # always hash-compare: constant-ish time

    if user is None or user.is_locked() or not password_ok:
        if user is not None and not user.is_locked():
            user.failed_login_count += 1
            if user.failed_login_count >= current_app.config["MAX_FAILED_LOGINS"]:
                user.locked_until = utcnow() + timedelta(minutes=current_app.config["LOCKOUT_MINUTES"])
                user.failed_login_count = 0
                audit.record("auth.lockout", f"User {user.user_code}", result=AuditResult.DENIED, reason="Too many failed sign-ins", actor=user)
        audit.record("auth.login", f"Session ({identifier[:60]})", result=AuditResult.DENIED, reason="Invalid credentials or locked", actor=None, actor_label=identifier[:60])
        db.session.commit()
        raise Unauthenticated(GENERIC_LOGIN_ERROR)

    if user.status != UserStatus.ACTIVE:
        audit.record("auth.login", f"User {user.user_code}", result=AuditResult.DENIED, reason=f"Account {user.status.value}", actor=user)
        db.session.commit()
        raise Forbidden("This account is not active. Contact the placement office.")

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    audit.record("auth.login", "Session", actor=user)
    db.session.commit()
    return user


def revoke_refresh(jti: str, user_id: int, expires_at) -> None:
    if not db.session.query(RevokedToken.id).filter_by(jti=jti).first():
        db.session.add(RevokedToken(jti=jti, user_id=user_id, expires_at=expires_at))


def change_password(user: User, current: str, new: str) -> None:
    if not verify_password(user.password_hash, current):
        audit.record("auth.password_change", "Own account", result=AuditResult.DENIED, reason="Wrong current password", actor=user, commit=True)
        raise Unauthenticated("Current password is incorrect.")
    if verify_password(user.password_hash, new):
        raise ValidationFailed("Choose a password you have not used before.", details={"newPassword": ["Choose a password you have not used before."]})
    validate_new_password(new, user=user)
    user.password_hash = hash_password(new)
    user.password_changed_at = utcnow()
    audit.record("auth.password_change", "Own account", actor=user)
    db.session.commit()


def issue_reset_token(user: User, *, minutes: int | None = None) -> str:
    """Creates a one-time token (only its SHA-256 is stored) and returns the raw value for the mailer. Caller commits."""
    raw = secrets.token_urlsafe(32)
    db.session.add(PasswordResetToken(user_id=user.id, token_hash=hashlib.sha256(raw.encode()).hexdigest(),
                                      expires_at=utcnow() + timedelta(minutes=minutes or current_app.config["PASSWORD_RESET_MINUTES"])))
    return raw


def request_password_reset(email: str) -> str | None:
    """Returns the raw token (for dev logging / a mailer) or None. Callers must NOT reveal whether the account exists."""
    user = db.session.query(User).filter(db.func.lower(User.email) == email.strip().lower(), User.status == UserStatus.ACTIVE).first()
    if user is None:
        return None
    raw = issue_reset_token(user)
    audit.record("auth.password_reset_requested", f"User {user.user_code}", actor=user)
    db.session.commit()
    return raw


def reset_password(raw_token: str, new_password: str) -> None:
    row = db.session.query(PasswordResetToken).filter_by(token_hash=hashlib.sha256(raw_token.encode()).hexdigest()).first()
    if row is None or row.used_at is not None or row.expires_at < utcnow():
        raise ValidationFailed("This reset link is invalid or has expired. Request a new one.", details={"token": ["Invalid or expired"]})
    user = db.session.get(User, row.user_id)
    validate_new_password(new_password, user=user)
    user.password_hash = hash_password(new_password)
    user.password_changed_at = utcnow()
    user.failed_login_count, user.locked_until = 0, None
    row.used_at = utcnow()
    if user.status == UserStatus.INVITED:  # first password set through an emailed one-time link activates an invited account
        user.status = UserStatus.ACTIVE
        audit.record("user.activate", f"User {user.user_code}", actor=user, reason="Invitation accepted")
    audit.record("auth.password_reset", f"User {user.user_code}", actor=user)
    db.session.commit()
