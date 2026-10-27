import enum
from datetime import datetime, timezone

import sqlalchemy as sa

from ..extensions import db


def utcnow() -> datetime:
    """Naive UTC timestamps are stored (MySQL DATETIME has no tz); the API always serialises them with a 'Z'."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def enum_col(enum_cls: type[enum.Enum], **kw):
    """Portable enum: VARCHAR (not a native MySQL ENUM) so adding a value never needs an ALTER of a native type."""
    return sa.Enum(enum_cls, native_enum=False, length=32, validate_strings=True, values_callable=lambda e: [m.value for m in e], **kw)


class TimestampMixin:
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def sid(value) -> str | None:
    return None if value is None else str(value)


def to_epoch(dt: datetime) -> int:
    """Epoch seconds for a naive-UTC datetime (datetime.timestamp() would wrongly assume local time)."""
    return int(dt.replace(tzinfo=timezone.utc).timestamp())
