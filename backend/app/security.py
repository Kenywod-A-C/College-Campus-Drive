"""Authentication helpers and server-side authorisation decorators.

Authority is ALWAYS re-read from the database on every request (active flag, role, permissions); JWT claims are never
trusted for access decisions, so deactivating a user or changing a role takes effect immediately.
"""
import re
import secrets
from functools import wraps

from flask import g
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request
from werkzeug.security import check_password_hash, generate_password_hash

from .errors import Forbidden, Unauthenticated, ValidationFailed
from .extensions import db, jwt
from .models import AuditResult, RevokedToken, User, UserStatus
from .services import audit

PASSWORD_MIN, PASSWORD_MAX = 8, 128  # upper bound prevents hashing-cost abuse
_DUMMY_HASH = generate_password_hash("not-a-real-password")  # burn the same time for unknown users (no timing oracle)
_UNUSABLE_HASH = generate_password_hash(secrets.token_urlsafe(48))  # nobody knows the secret: accounts that have not set a password yet cannot sign in


def hash_password(password: str) -> str:
    return generate_password_hash(password)  # werkzeug default: scrypt with per-hash random salt


def unusable_password_hash() -> str:
    """Placeholder hash for invited accounts. Verification costs the same as for real users, so invited accounts are not distinguishable by timing."""
    return _UNUSABLE_HASH


def verify_password(password_hash: str | None, password: str) -> bool:
    return check_password_hash(password_hash or _DUMMY_HASH, password) and password_hash is not None


def validate_new_password(password: str, *, user: User | None = None) -> None:
    problems = []
    if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
        problems.append(f"Use {PASSWORD_MIN}–{PASSWORD_MAX} characters")
    if not re.search(r"[A-Z]", password) or not re.search(r"\d", password):
        problems.append("Include an uppercase letter and a number")
    if user:  # only meaningful identifiers (4+ chars) are compared, otherwise "s@..." would reject nearly every password
        low = password.lower()
        if any(len(token) >= 4 and token in low for token in (user.email.split("@")[0].lower(), user.user_code.lower())):
            problems.append("Do not include your email name or user ID")
    if problems:
        raise ValidationFailed(problems[0], details={"password": problems})


# ---- JWT plumbing ----
@jwt.token_in_blocklist_loader
def _is_revoked(_header, payload) -> bool:
    if payload.get("type") != "refresh":
        return False
    return is_refresh_revoked(payload["jti"])


def is_refresh_revoked(jti: str) -> bool:
    return db.session.query(RevokedToken.id).filter_by(jti=jti).first() is not None


@jwt.unauthorized_loader
def _missing(reason):
    return _auth_error("Please sign in to continue.")


@jwt.invalid_token_loader
def _invalid(reason):
    return _auth_error("Your session is invalid. Please sign in again.")


@jwt.expired_token_loader
def _expired(_header, _payload):
    return _auth_error("Your session has expired. Please sign in again.")


@jwt.revoked_token_loader
def _revoked(_header, _payload):
    return _auth_error("Your session has ended. Please sign in again.")


def _auth_error(message: str):
    from .errors import error_response

    return error_response(401, "unauthenticated", message)


def load_user_from_token() -> User:
    user = db.session.get(User, int(get_jwt_identity()))
    if user is None or user.status != UserStatus.ACTIVE:
        raise Unauthenticated("Your session has ended. Please sign in again.")
    return user


def current_user() -> User:
    return g.current_user


def auth_required(fn):
    """Requires a valid ACCESS token and an active account."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        g.current_user = load_user_from_token()
        g.jwt = get_jwt()
        return fn(*args, **kwargs)
    return wrapper


def _deny(user: User, what: str, why: str):
    audit.record("access.denied", what, result=AuditResult.DENIED, reason=why, actor=user, commit=True)
    raise Forbidden("You do not have permission to do this.")


def ensure_permission(user: User, key: str, what: str = "resource") -> None:
    """Inline check for rules that depend on the payload (e.g. creating a job is jobs.create, but creating it *published* also needs drives.publish)."""
    if not user.has_permission(key):
        _deny(user, f"{key} on {what}", "Missing permission")


def permission_required(*keys: str, any_of: bool = False):
    """@permission_required('students.view') — all listed permissions (or any, with any_of=True)."""
    def deco(fn):
        @wraps(fn)
        @auth_required
        def wrapper(*args, **kwargs):
            u = current_user()
            ok = any(u.has_permission(k) for k in keys) if any_of else all(u.has_permission(k) for k in keys)
            if not ok:
                _deny(u, "|".join(keys), "Missing permission")
            return fn(*args, **kwargs)
        return wrapper
    return deco


def roles_required(*roles: str):
    def deco(fn):
        @wraps(fn)
        @auth_required
        def wrapper(*args, **kwargs):
            u = current_user()
            if u.role_name not in roles:
                _deny(u, f"role:{'|'.join(roles)}", "Role not allowed")
            return fn(*args, **kwargs)
        return wrapper
    return deco
