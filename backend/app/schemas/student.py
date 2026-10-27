import re
from typing import Annotated, Literal

from pydantic import Field, HttpUrl, field_validator

from ..validation import CamelModel

Tag = Annotated[str, Field(min_length=1, max_length=40)]
TagList = Annotated[list[Tag], Field(max_length=30)]
Cgpa = Annotated[float, Field(ge=0, le=10)]
Arrears = Annotated[int, Field(ge=0, le=30)]

# Fields a student must never change through the API (they are managed by the placement cell).
CONTROLLED_FIELDS = {"id", "userId", "role", "placementStatus", "departmentId", "studentCode", "graduationYear", "profileCompletion", "email", "name", "status", "academic"}


def _phone(v: str | None) -> str | None:
    if v in (None, ""):
        return None
    if not re.fullmatch(r"\+?[0-9 ()-]{7,20}", v):
        raise ValueError("Enter a valid phone number")
    return v


class _WithPortfolio(CamelModel):
    portfolio_url: str | None = None

    @field_validator("portfolio_url")
    @classmethod
    def _url(cls, v):
        if v in (None, ""):
            return None
        HttpUrl(v)  # raises on invalid URLs
        if not v.startswith(("http://", "https://")):
            raise ValueError("Enter a full URL starting with https://")
        return v


class ProfilePatch(_WithPortfolio):
    phone: str | None = None
    skills: TagList | None = None
    interests: TagList | None = None
    preferred_roles: TagList | None = None
    resume_file: Annotated[str, Field(max_length=255)] | None = None
    degree: Annotated[str, Field(max_length=16)] | None = None
    current_year: Annotated[int, Field(ge=1, le=6)] | None = None
    cgpa: Cgpa | None = None
    active_arrears: Arrears | None = None
    arrear_history: Arrears | None = None

    _p = field_validator("phone")(_phone)


class OnboardingIn(_WithPortfolio):
    student_code: Annotated[str, Field(pattern=r"^[A-Za-z0-9-]{5,16}$")]
    department_id: int
    degree: Literal["B.E.", "B.Tech", "M.E.", "M.Tech", "MBA", "MCA"]
    current_year: Annotated[int, Field(ge=1, le=6)]
    graduation_year: Annotated[int, Field(ge=2000, le=2100)]
    cgpa: Cgpa
    active_arrears: Arrears = 0
    arrear_history: Arrears = 0
    skills: TagList = []
    interests: TagList = []
    preferred_roles: TagList = []
    resume_file: Annotated[str, Field(max_length=255)] | None = None
