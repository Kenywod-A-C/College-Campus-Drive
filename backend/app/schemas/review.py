"""Request models for staff-side application review, interviews and offers."""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from ..validation import CamelModel, PageParams
from .content import to_naive_utc


class ApplicationReviewQuery(PageParams):
    q: Annotated[str, Field(max_length=100)] | None = None
    status: Literal["all", "applied", "shortlisted", "interview", "selected", "offer_received", "rejected", "withdrawn"] | None = None
    company_id: int | None = None
    job_id: int | None = None
    dept: int | None = None
    eligibility: Literal["eligible", "not_eligible", "profile_incomplete", "needs_verification"] | None = None
    sort: Literal["recent", "cgpa", "name"] = "recent"


class ExceptionIn(CamelModel):
    reason: Annotated[str, Field(min_length=3, max_length=300)]
    approved_by: Annotated[str, Field(min_length=2, max_length=120)]


class StageIn(CamelModel):
    ids: Annotated[list[int], Field(min_length=1, max_length=100)]
    status: Literal["shortlisted", "interview", "selected", "rejected"]
    note: Annotated[str, Field(max_length=250)] | None = None
    exception: ExceptionIn | None = None


class InterviewQuery(PageParams):
    page_size: Annotated[int, Field(ge=1, le=100)] = 50
    job_id: int | None = None
    status: Literal["all", "scheduled", "completed", "cancelled", "no_show"] | None = None


class InterviewIn(CamelModel):
    id: str | None = None  # edits go to POST /interviews/{id}; the URL is authoritative
    job_id: int
    application_ids: Annotated[list[int], Field(min_length=1, max_length=200)]
    round: Annotated[str, Field(min_length=1, max_length=120)]
    at: datetime
    duration_mins: Annotated[int, Field(ge=5, le=600)] = 45
    location: Annotated[str, Field(min_length=1, max_length=300)]

    @field_validator("at")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return to_naive_utc(v)


class InterviewStatusIn(CamelModel):
    status: Literal["scheduled", "completed", "cancelled", "no_show"]


class OfferQuery(PageParams):
    q: Annotated[str, Field(max_length=100)] | None = None
    status: Literal["all", "pending", "received", "accepted", "declined", "withdrawn"] | None = None
    dept: int | None = None
    company_id: int | None = None


class OfferIn(CamelModel):
    application_id: int
    ctc_lpa: Annotated[float, Field(gt=0, le=1000)]
    accept_by: datetime

    @field_validator("accept_by")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return to_naive_utc(v)


class OfferStatusIn(CamelModel):
    status: Literal["received", "accepted", "declined", "withdrawn"]
    reason: Annotated[str, Field(max_length=300)] | None = None

    @model_validator(mode="after")
    def _reason(self):
        if self.status == "withdrawn" and len((self.reason or "").strip()) < 3:
            raise ValueError("A reason is required to withdraw an offer.")
        return self
