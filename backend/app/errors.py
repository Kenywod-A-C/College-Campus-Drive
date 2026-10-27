"""Centralised error handling. Every error leaves the API in one envelope:
{"error": {"code": "...", "message": "...", "details": {...}}}. No stack traces or SQL ever reach the client."""
import logging

from flask import Flask, jsonify
from pydantic import ValidationError
from werkzeug.exceptions import HTTPException

log = logging.getLogger(__name__)


class ApiError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, message: str, *, details: dict | None = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.details = details
        if code:
            self.code = code


class Unauthenticated(ApiError):
    status, code = 401, "unauthenticated"


class Forbidden(ApiError):
    status, code = 403, "forbidden"


class NotFound(ApiError):
    status, code = 404, "not_found"

    def __init__(self, what: str = "Resource"):
        super().__init__(f"{what} not found.")


class Conflict(ApiError):
    status, code = 409, "conflict"


class ValidationFailed(ApiError):
    status, code = 422, "validation_error"


class AssistantUnavailable(ApiError):
    """The model provider is not configured or cannot be reached; nothing was changed."""
    status, code = 503, "assistant_unavailable"


class AssistantUpstreamError(ApiError):
    status, code = 502, "assistant_upstream_error"


class AssistantTimeout(ApiError):
    status, code = 504, "assistant_timeout"


class NotImplementedYet(ApiError):
    status, code = 501, "not_implemented"


def error_response(status: int, code: str, message: str, details: dict | None = None):
    body = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    resp = jsonify(body)
    resp.status_code = status
    return resp


def _pydantic_details(exc: ValidationError) -> dict:
    out: dict[str, list[str]] = {}
    for err in exc.errors():
        loc = ".".join(str(p) for p in err["loc"]) or "_"
        msg = err["msg"].removeprefix("Value error, ")
        out.setdefault(loc, []).append(msg)
    return out


def register_error_handlers(app: Flask) -> None:
    from flask_jwt_extended.exceptions import JWTExtendedException
    from jwt.exceptions import PyJWTError

    @app.errorhandler(ApiError)
    def _api(e: ApiError):
        return error_response(e.status, e.code, e.message, e.details)

    @app.errorhandler(ValidationError)
    def _validation(e: ValidationError):
        details = _pydantic_details(e)
        first = next(iter(details.items()))
        return error_response(422, "validation_error", f"{first[0]}: {first[1][0]}" if first[0] != "_" else first[1][0], details)

    @app.errorhandler(JWTExtendedException)
    def _jwt(e):
        return error_response(401, "unauthenticated", "Your session has expired. Please sign in again.")

    @app.errorhandler(PyJWTError)
    def _pyjwt(e):
        return error_response(401, "unauthenticated", "Your session has expired. Please sign in again.")

    @app.errorhandler(HTTPException)
    def _http(e: HTTPException):
        codes = {404: "not_found", 405: "method_not_allowed", 413: "payload_too_large", 429: "rate_limited"}
        msg = "Too many attempts. Please wait and try again." if e.code == 429 else (e.description or e.name)
        return error_response(e.code or 500, codes.get(e.code or 500, "bad_request"), msg)

    @app.errorhandler(Exception)
    def _unexpected(e: Exception):
        log.exception("Unhandled error")
        from .extensions import db

        db.session.rollback()
        return error_response(500, "server_error", "Something went wrong on our side. Please try again.")
