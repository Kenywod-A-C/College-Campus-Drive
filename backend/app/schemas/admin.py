"""Request models for the administrator area (users, roles, policies, academic configuration, audit)."""
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import Field, StrictBool, field_validator, model_validator

from ..validation import CamelModel, PageParams

EMAIL = r"^\S+@\S+\.\S+$"
Code = Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9][A-Za-z0-9._\-/]*$")]


class UserQuery(PageParams):
    q: Annotated[str, Field(max_length=100)] | None = None
    role: Literal["all", "admin", "faculty", "student"] | None = None
    status: Literal["all", "active", "inactive", "invited"] | None = None
    dept: int | None = None


class UserIn(CamelModel):
    id: str | None = None  # the URL is authoritative on edits
    name: Annotated[str, Field(min_length=1, max_length=120)]
    email: Annotated[str, Field(max_length=190, pattern=EMAIL)]
    user_code: Code
    role: Literal["admin", "faculty", "student"]
    department_id: int | None = None
    graduation_year: Annotated[int, Field(ge=2000, le=2100)] | None = None  # students only; defaults to the active academic year


class UserStatusIn(CamelModel):
    status: Literal["active", "inactive"]


class ImportRowIn(CamelModel):
    student_code: Annotated[str, Field(max_length=64)] = ""
    name: Annotated[str, Field(max_length=200)] = ""
    email: Annotated[str, Field(max_length=300)] = ""
    department_code: Annotated[str, Field(max_length=40)] = ""
    graduation_year: Annotated[str, Field(max_length=10)] = ""
    cgpa: Annotated[str, Field(max_length=10)] | None = None


class ImportIn(CamelModel):
    rows: Annotated[list[ImportRowIn], Field(min_length=1, max_length=500)]


class PermissionToggleIn(CamelModel):
    enabled: StrictBool


# ---------------------------------------------------------------- policies
PolicyKindL = Literal["max_offers", "tier_restriction", "application_limit", "accepted_offer", "exception_approval"]


class PolicyIn(CamelModel):
    id: str | None = None
    name: Annotated[str, Field(min_length=1, max_length=160)]
    description: Annotated[str, Field(max_length=400)] = ""
    kind: PolicyKindL
    scope: Literal["college", "department", "academic_year"] = "college"
    scope_value: Annotated[str, Field(max_length=32)] | None = None
    params: dict[str, Any] = {}
    enabled: StrictBool = True

    @field_validator("params")
    @classmethod
    def _small(cls, v: dict) -> dict:
        if len(v) > 10 or any(not isinstance(k, str) or len(k) > 40 for k in v):
            raise ValueError("Too many or too long parameters")
        for val in v.values():
            if not isinstance(val, (str, int, float, bool)) or (isinstance(val, str) and len(val) > 200):
                raise ValueError("Parameters must be simple values")
        return v

    @model_validator(mode="after")
    def _kind_rules(self):
        p, k = self.params, self.kind

        def whole(key, lo, hi):
            v = p.get(key)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or not (lo <= v <= hi):
                raise ValueError(f"{key} must be a whole number between {lo} and {hi}")
            p[key] = int(v)

        if k == "max_offers":
            whole("maxAcceptedOffers", 1, 20)
        elif k == "application_limit":
            whole("maxActiveApplications", 1, 100)
        elif k == "accepted_offer":
            whole("acceptanceWindowDays", 1, 90)
        elif k == "tier_restriction" and not isinstance(p.get("allowOnlyHigherTier", True), bool):
            raise ValueError("allowOnlyHigherTier must be true or false")
        elif k == "exception_approval":
            for key in ("requireReason", "requireApprover"):
                if not isinstance(p.get(key, True), bool):
                    raise ValueError(f"{key} must be true or false")
        if self.scope == "college":
            self.scope_value = None
        elif not self.scope_value:
            raise ValueError("Choose the department or academic year this policy applies to.")
        elif not self.scope_value.isdigit():
            raise ValueError("scopeValue must be a department id or a graduation year")
        return self


class PolicyDeleteIn(CamelModel):
    reason: Annotated[str, Field(min_length=3, max_length=300)]


# ---------------------------------------------------------------- academic configuration
class DepartmentIn(CamelModel):
    id: str | None = None
    code: Annotated[str, Field(min_length=1, max_length=16, pattern=r"^[A-Za-z0-9&\-]+$")]
    name: Annotated[str, Field(min_length=1, max_length=160)]
    head_name: Annotated[str, Field(max_length=120)] | None = None


class CourseIn(CamelModel):
    id: str | None = None
    code: Annotated[str, Field(min_length=1, max_length=24, pattern=r"^[A-Za-z0-9&\-]+$")]
    name: Annotated[str, Field(min_length=1, max_length=160)]
    degree: Literal["B.E.", "B.Tech", "M.E.", "M.Tech", "MBA", "MCA"]
    department_id: int
    duration_years: Annotated[int, Field(ge=1, le=8)] = 4


class AcademicYearIn(CamelModel):
    id: str | None = None
    label: Annotated[str, Field(pattern=r"^\d{4}-\d{2}$")]
    graduation_year: Annotated[int, Field(ge=2000, le=2100)]
    active: StrictBool = False

    @model_validator(mode="after")
    def _consistent(self):
        start = int(self.label[:4])
        if int(self.label[5:]) != (start + 1) % 100:
            raise ValueError("Label must be two consecutive years, e.g. 2026-27.")
        return self


# ---------------------------------------------------------------- audit and reports
class AuditQuery(PageParams):
    page_size: Annotated[int, Field(ge=1, le=100)] = 12
    actor: Annotated[str, Field(max_length=100)] | None = None
    action: Annotated[str, Field(max_length=64)] | None = None
    resource: Annotated[str, Field(max_length=100)] | None = None
    result: Literal["all", "success", "denied", "failed"] | None = None
    from_: date | None = Field(default=None, alias="from")
    to: date | None = None

    @model_validator(mode="after")
    def _range(self):
        if self.from_ and self.to and self.to < self.from_:
            raise ValueError("'to' must not be before 'from'")
        return self


class ReportQuery(CamelModel):
    academic_year: Annotated[int, Field(ge=2000, le=2100)] | None = None  # graduation year
    dept: int | None = None
    company_id: int | None = None
    job_id: int | None = None
    app_status: Literal["all", "applied", "shortlisted", "interview", "selected", "offer_received", "rejected", "withdrawn"] | None = None
    offer_status: Literal["all", "pending", "received", "accepted", "declined", "withdrawn"] | None = None
