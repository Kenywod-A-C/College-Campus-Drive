"""Configuration. Everything secret comes from environment variables; nothing is hardcoded.

APP_ENV selects the class: development (default) | testing | production.
Production refuses to start with missing or weak secrets.
"""
import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()  # backend/.env for local development; real environment variables always win


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str) -> list[str]:
    return [v.strip() for v in os.environ.get(name, "").split(",") if v.strip()]


class BaseConfig:
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True, "pool_recycle": 280}
    JSON_SORT_KEYS = False
    MAX_CONTENT_LENGTH = 6 * 1024 * 1024  # request bodies; uploads are capped at 5 MB + overhead

    # Auth
    ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "15"))
    REFRESH_TOKEN_DAYS = int(os.environ.get("REFRESH_TOKEN_DAYS", "14"))
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=ACCESS_TOKEN_MINUTES)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=REFRESH_TOKEN_DAYS)
    JWT_TOKEN_LOCATION = ["headers", "cookies"]  # access: Authorization header; refresh: httpOnly cookie
    JWT_COOKIE_CSRF_PROTECT = True  # double-submit CSRF for cookie-borne tokens (the refresh token)
    JWT_CSRF_IN_COOKIES = True
    JWT_REFRESH_COOKIE_PATH = "/api/v1/auth"
    # The CSRF token must be readable by the SPA via document.cookie, which only exposes cookies whose path matches the PAGE url.
    # It is not a secret from same-origin JS (that is the point of double-submit); the refresh token itself stays httpOnly + path-restricted.
    JWT_REFRESH_CSRF_COOKIE_PATH = "/"
    JWT_COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "Lax")
    JWT_COOKIE_SECURE = _bool("COOKIE_SECURE", False)
    JWT_ERROR_MESSAGE_KEY = "message"
    MAX_FAILED_LOGINS = int(os.environ.get("MAX_FAILED_LOGINS", "5"))
    LOCKOUT_MINUTES = int(os.environ.get("LOCKOUT_MINUTES", "15"))
    PASSWORD_RESET_MINUTES = int(os.environ.get("PASSWORD_RESET_MINUTES", "30"))
    # Where to build the reset link that is logged/emailed. Email delivery is NOT implemented.
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

    # Rate limiting (in-memory by default; use redis:// in production with several workers)
    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")
    RATELIMIT_ENABLED = True
    LOGIN_RATE_LIMIT = os.environ.get("LOGIN_RATE_LIMIT", "10 per minute")

    # AI assistant. The provider key lives ONLY in the backend environment; it is never sent to the browser or to the model.
    # No key = the assistant reports itself unavailable (there is no canned-answer fallback).
    LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "anthropic").strip().lower()
    LLM_API_KEY = os.environ.get("LLM_API_KEY", "").strip()
    LLM_MODEL = os.environ.get("LLM_MODEL", "").strip()  # required except for anthropic (defaults to claude-opus-5-5)
    LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "").strip()  # optional gateway/proxy URL
    LLM_TIMEOUT_SECONDS = float(os.environ.get("LLM_TIMEOUT_SECONDS", "45"))
    LLM_MAX_RETRIES = int(os.environ.get("LLM_MAX_RETRIES", "1"))
    LLM_MAX_OUTPUT_TOKENS = int(os.environ.get("LLM_MAX_OUTPUT_TOKENS", "4000"))  # per model call, includes thinking
    LLM_EFFORT = os.environ.get("LLM_EFFORT", "").strip().lower()  # low | medium | high | xhigh | max; empty = model default
    ASSISTANT_MAX_INPUT_CHARS = int(os.environ.get("ASSISTANT_MAX_INPUT_CHARS", "2000"))
    ASSISTANT_TURN_SECONDS = float(os.environ.get("ASSISTANT_TURN_SECONDS", "90"))  # wall-clock budget for one chat turn across all model calls
    ASSISTANT_MAX_TOOL_ROUNDS = int(os.environ.get("ASSISTANT_MAX_TOOL_ROUNDS", "5"))
    ASSISTANT_HISTORY_MESSAGES = int(os.environ.get("ASSISTANT_HISTORY_MESSAGES", "20"))  # prior messages replayed to the model
    ASSISTANT_MAX_MESSAGES_PER_CONVERSATION = int(os.environ.get("ASSISTANT_MAX_MESSAGES_PER_CONVERSATION", "200"))
    ASSISTANT_ACTION_TTL_MINUTES = int(os.environ.get("ASSISTANT_ACTION_TTL_MINUTES", "60"))  # a proposed action expires if not confirmed
    ASSISTANT_RETENTION_DAYS = int(os.environ.get("ASSISTANT_RETENTION_DAYS", "30"))  # archived conversations are purged after this
    ASSISTANT_CHAT_RATE_LIMIT = os.environ.get("ASSISTANT_CHAT_RATE_LIMIT", "12 per minute;200 per day")  # per signed-in user

    CORS_ORIGINS = _csv("CORS_ORIGINS")  # empty = same-origin only (use the Vite proxy in dev)

    SECRET_KEY = os.environ.get("SECRET_KEY", "")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "")
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "")

    @classmethod
    def validate(cls) -> None:  # hook for subclasses
        pass


class DevelopmentConfig(BaseConfig):
    DEBUG = True

    @classmethod
    def validate(cls) -> None:
        if not cls.SQLALCHEMY_DATABASE_URI:
            raise RuntimeError("DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in.")
        for name in ("SECRET_KEY", "JWT_SECRET_KEY"):
            if not getattr(cls, name):
                raise RuntimeError(f"{name} is not set. Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\"")


class TestingConfig(BaseConfig):
    TESTING = True
    SECRET_KEY = "test-only-secret-key-not-for-use-0123456789"
    JWT_SECRET_KEY = "test-only-jwt-secret-key-not-for-use-0123456789"
    SQLALCHEMY_DATABASE_URI = os.environ.get("TEST_DATABASE_URL", "sqlite://")
    SQLALCHEMY_ENGINE_OPTIONS = {}
    LOGIN_RATE_LIMIT = "1000 per minute"  # individual tests lower it to exercise the 429 path
    ASSISTANT_CHAT_RATE_LIMIT = "1000 per minute"
    # tests never see a developer's real LLM settings (backend/.env or exported variables); they inject a fake provider instead
    LLM_PROVIDER = "anthropic"
    LLM_API_KEY = ""
    LLM_MODEL = ""
    LLM_BASE_URL = ""
    LLM_EFFORT = ""
    PASSWORD_RESET_MINUTES = 30


class ProductionConfig(BaseConfig):
    DEBUG = False
    JWT_COOKIE_SECURE = _bool("COOKIE_SECURE", True)

    @classmethod
    def validate(cls) -> None:
        problems = []
        if not cls.SQLALCHEMY_DATABASE_URI:
            problems.append("DATABASE_URL is required")
        for name in ("SECRET_KEY", "JWT_SECRET_KEY"):
            val = getattr(cls, name)
            if len(val) < 32:
                problems.append(f"{name} must be set to a random value of at least 32 characters")
        if not cls.JWT_COOKIE_SECURE:
            problems.append("COOKIE_SECURE must be true in production (HTTPS)")
        if cls.RATELIMIT_STORAGE_URI.startswith("memory://"):
            problems.append("RATELIMIT_STORAGE_URI must point at a shared store (e.g. redis://) in production")
        if problems:
            raise RuntimeError("Refusing to start in production: " + "; ".join(problems))


CONFIGS = {"development": DevelopmentConfig, "testing": TestingConfig, "production": ProductionConfig}


def get_config(name: str | None = None):
    return CONFIGS[(name or os.environ.get("APP_ENV", "development")).lower()]
