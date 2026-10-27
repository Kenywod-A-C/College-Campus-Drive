import re
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import Field, StrictBool, field_validator

from ..validation import CamelModel


def to_naive_utc(v: str | datetime) -> datetime:
    dt = datetime.fromisoformat(v.replace("Z", "+00:00")) if isinstance(v, str) else v
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


class ReminderIn(CamelModel):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    at: datetime
    job_id: int | None = None
    kind: Literal["drive", "deadline", "interview", "custom"] | None = None

    @field_validator("at")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return to_naive_utc(v)


class PrefsIn(CamelModel):
    email: StrictBool
    push: StrictBool
    drive_reminders: StrictBool
    deadline_reminders: StrictBool
    interview_alerts: StrictBool
    offer_updates: StrictBool


class CompanyIn(CamelModel):
    name: Annotated[str, Field(min_length=1, max_length=160)]
    website: Annotated[str, Field(max_length=300, pattern=r"^https?://\S+\.\S+")]
    industry: Annotated[str, Field(min_length=1, max_length=120)]
    description: Annotated[str, Field(max_length=4000)] = ""
    contact_name: Annotated[str, Field(max_length=120)] = ""
    contact_email: Annotated[str, Field(max_length=190, pattern=r"^$|^\S+@\S+\.\S+$")] = ""
    contact_phone: Annotated[str, Field(max_length=40)] | None = None
    tier: Literal["regular", "dream", "super_dream"] = "regular"
    color: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")] | None = None


class CompanyQuery(CamelModel):
    q: Annotated[str, Field(max_length=100)] | None = None
    industry: Annotated[str, Field(max_length=120)] | None = None
    tier: Literal["regular", "dream", "super_dream"] | None = None
    archived: Literal["exclude", "include", "only"] = "exclude"
    page: Annotated[int, Field(ge=1)] = 1
    page_size: Annotated[int, Field(ge=1, le=100)] = 10


class DashboardQuery(CamelModel):
    dept: int | None = None
    graduation_year: Annotated[int, Field(ge=2000, le=2100)] | None = None
    company_id: int | None = None
    days: Annotated[int, Field(ge=1, le=3650)] | None = None
