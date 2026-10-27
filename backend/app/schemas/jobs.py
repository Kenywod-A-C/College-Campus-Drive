from typing import Annotated, Literal

from pydantic import Field, StrictBool

from ..validation import CamelModel, PageParams


class JobQuery(PageParams):
    page_size: Annotated[int, Field(ge=1, le=100)] = 9
    q: Annotated[str, Field(max_length=100)] | None = None
    dept: int | None = None
    min_cgpa: Annotated[float, Field(ge=0, le=10)] | None = None
    location: Annotated[str, Field(max_length=100)] | None = None
    type: Literal["Full-time", "Internship", "Internship + PPO"] | None = None
    deadline_days: Annotated[int, Field(ge=1, le=365)] | None = None
    tab: Literal["all", "eligible", "not_eligible", "saved", "applied"] | None = None
    sort: Literal["deadline", "relevance", "recent"] = "deadline"
    status: Literal["all", "draft", "published", "closed", "cancelled"] | None = None
    company_id: int | None = None
    archived: Literal["exclude", "include", "only"] = "exclude"  # staff only; archived jobs are hidden by default


class ApplyIn(CamelModel):
    job_id: int


class ApplicationQuery(PageParams):
    q: Annotated[str, Field(max_length=100)] | None = None
    status: Literal["all", "applied", "shortlisted", "interview", "selected", "offer_received", "rejected", "withdrawn"] | None = None


class RespondIn(CamelModel):
    decision: Literal["accepted", "declined"]


# ---------------------------------------------------------------- staff: create / edit / lifecycle
from datetime import datetime  # noqa: E402

from pydantic import model_validator  # noqa: E402

from .content import to_naive_utc  # noqa: E402

Short = Annotated[str, Field(min_length=1, max_length=40)]


class RoundIn(CamelModel):
    id: str | None = None  # client-side key only; the server assigns real ids
    name: Annotated[str, Field(min_length=1, max_length=120)]
    mode: Literal["Online", "On-campus", "Virtual"] = "Online"
    date: datetime | None = None
    location: Annotated[str, Field(max_length=200)] | None = None


class EligibilityIn(CamelModel):
    min_cgpa: Annotated[float, Field(ge=0, le=10)]
    max_active_arrears: Annotated[int, Field(ge=0, le=30)] = 0
    max_arrear_history: Annotated[int, Field(ge=0, le=30)] | None = None
    department_ids: Annotated[list[int], Field(max_length=50)] = []  # empty = every department
    graduation_years: Annotated[list[Annotated[int, Field(ge=2000, le=2100)]], Field(max_length=10)] = []  # empty = every batch
    required_skills: Annotated[list[Short], Field(max_length=30)] = []


class JobIn(CamelModel):
    id: str | None = None  # present on edits; the URL is authoritative
    company_id: int
    title: Annotated[str, Field(min_length=1, max_length=160)]
    domain: Annotated[str, Field(min_length=1, max_length=80)] = "General"
    location: Annotated[str, Field(max_length=160)] = ""
    type: Literal["Full-time", "Internship", "Internship + PPO"] = "Full-time"
    description: Annotated[str, Field(max_length=8000)] = ""
    responsibilities: Annotated[list[Annotated[str, Field(min_length=1, max_length=300)]], Field(max_length=20)] = []
    skills: Annotated[list[Short], Field(max_length=30)] = []
    eligibility: EligibilityIn
    rounds: Annotated[list[RoundIn], Field(max_length=12)] = []
    ctc_lpa: Annotated[float, Field(ge=0, le=1000)] | None = None
    stipend_per_month: Annotated[int, Field(ge=0, le=10_000_000)] | None = None
    open_date: datetime
    deadline: datetime
    drive_date: datetime | None = None
    status: Literal["draft", "published"] = "draft"

    @model_validator(mode="after")
    def _normalise_and_check(self):
        self.open_date, self.deadline = to_naive_utc(self.open_date), to_naive_utc(self.deadline)
        if self.drive_date:
            self.drive_date = to_naive_utc(self.drive_date)
        for r in self.rounds:
            if r.date:
                r.date = to_naive_utc(r.date)
        if self.deadline <= self.open_date:
            raise ValueError("Deadline must be after the opening date.")
        return self


class JobStatusIn(CamelModel):
    status: Literal["draft", "published", "closed", "cancelled"]
    reason: Annotated[str, Field(max_length=400)] | None = None


class ArchiveIn(CamelModel):
    archived: StrictBool  # no 'yes'/1 coercion for flags in request bodies
