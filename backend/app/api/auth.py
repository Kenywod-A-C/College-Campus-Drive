from datetime import datetime, timedelta

from flask import Blueprint, current_app, request
from flask_jwt_extended import create_access_token, create_refresh_token, decode_token, set_refresh_cookies, unset_jwt_cookies

from ..errors import Unauthenticated
from ..extensions import db, limiter
from ..models import User, UserStatus, to_epoch
from ..responses import ok
from ..schemas.auth import ChangePasswordIn, ForgotPasswordIn, LoginIn, ResetPasswordIn
from ..security import auth_required, current_user, is_refresh_revoked
from ..serializers import user_dict
from ..services import auth_service
from ..validation import parse_body

bp = Blueprint("auth", __name__)

NEUTRAL_RESET_MESSAGE = "If an account exists for that address, a reset link has been sent."


def _session_response(user: User, remember: bool):
    """Access token goes in the body (kept in memory by the SPA); the refresh token is an httpOnly cookie."""
    cfg = current_app.config
    access = create_access_token(identity=str(user.id), additional_claims={"role": user.role_name})
    ttl = cfg["JWT_REFRESH_TOKEN_EXPIRES"] if remember else timedelta(hours=12)
    refresh = create_refresh_token(identity=str(user.id), additional_claims={"remember": remember}, expires_delta=ttl)
    resp = ok({
        "user": user_dict(user), "permissions": user.permission_keys,
        "accessToken": access, "expiresIn": int(cfg["JWT_ACCESS_TOKEN_EXPIRES"].total_seconds()),
    })
    set_refresh_cookies(resp, refresh, max_age=int(ttl.total_seconds()) if remember else None)
    return resp


def _refresh_claims() -> dict:
    """Validate the refresh token from its cookie, explicitly. (verify_jwt_in_request would pick up an Authorization header
    first and reject the access token as 'not a refresh token', so clients sending both would fail.)
    Checks signature, expiry, token type, blocklist and the double-submit CSRF header."""
    token = request.cookies.get(current_app.config["JWT_REFRESH_COOKIE_NAME"])
    csrf = request.headers.get("X-CSRF-TOKEN")
    if not token or not csrf:
        raise Unauthenticated("Please sign in to continue.")
    try:
        claims = decode_token(token, csrf_value=csrf)
    except Exception:  # bad signature / expired / CSRF mismatch: say nothing more specific
        raise Unauthenticated("Your session has expired. Please sign in again.")
    if claims.get("type") != "refresh" or is_refresh_revoked(claims["jti"]):
        raise Unauthenticated("Your session has ended. Please sign in again.")
    return claims


@bp.post("/login")
@limiter.limit(lambda: current_app.config["LOGIN_RATE_LIMIT"])
def login():
    body = parse_body(LoginIn)
    user = auth_service.authenticate(body.identifier, body.password)
    return _session_response(user, body.remember)


@bp.post("/refresh")
@limiter.limit("60 per minute")
def refresh():
    claims = _refresh_claims()
    user = db.session.get(User, int(claims["sub"]))
    if user is None or user.status != UserStatus.ACTIVE:
        raise Unauthenticated("Your session has ended. Please sign in again.")
    if user.password_changed_at and claims["iat"] < to_epoch(user.password_changed_at):
        raise Unauthenticated("Your password was changed. Please sign in again.")
    auth_service.revoke_refresh(claims["jti"], user.id, datetime.utcfromtimestamp(claims["exp"]))  # rotation: each refresh token works once
    db.session.commit()
    return _session_response(user, bool(claims.get("remember")))


@bp.post("/logout")
def logout():
    """Always clears the cookies; revokes the refresh token when it can be authenticated (valid + CSRF header)."""
    try:
        claims = _refresh_claims()
        auth_service.revoke_refresh(claims["jti"], int(claims["sub"]), datetime.utcfromtimestamp(claims["exp"]))
        db.session.commit()
    except Unauthenticated:
        pass
    resp = ok({"ok": True})
    unset_jwt_cookies(resp)
    return resp


@bp.get("/me")
@auth_required
def me():
    u = current_user()
    return ok({"user": user_dict(u), "permissions": u.permission_keys})


@bp.post("/change-password")
@auth_required
@limiter.limit("10 per minute")
def change_password():
    body = parse_body(ChangePasswordIn)
    u = current_user()
    auth_service.change_password(u, body.current_password, body.new_password)
    # Other devices' refresh tokens are now invalid; give this browser a fresh one so the current session continues.
    refresh = create_refresh_token(identity=str(u.id), additional_claims={"remember": False}, expires_delta=timedelta(hours=12))
    resp = ok({"ok": True})
    set_refresh_cookies(resp, refresh)
    return resp


@bp.post("/forgot-password")
@limiter.limit("5 per minute")
def forgot_password():
    body = parse_body(ForgotPasswordIn)
    token = auth_service.request_password_reset(body.email)
    if token and current_app.debug:
        # Email delivery is not implemented. In development the link is logged so the flow can be exercised.
        current_app.logger.info("DEV password reset link: %s/reset-password?token=%s", current_app.config["FRONTEND_URL"], token)
    return ok({"message": NEUTRAL_RESET_MESSAGE})


@bp.post("/reset-password")
@limiter.limit("10 per minute")
def reset_password():
    body = parse_body(ResetPasswordIn)
    auth_service.reset_password(body.token, body.password)
    return ok({"ok": True})
