from typing import Annotated, Literal

from pydantic import Field

from ..validation import CamelModel, PageParams


class StudentQuery(PageParams):
    q: Annotated[str, Field(max_length=100)] | None = None
    dept: int | None = None
    year: Annotated[int, Field(ge=2000, le=2100)] | None = None
    min_cgpa: Annotated[float, Field(ge=0, le=10)] | None = None
    skill: Annotated[str, Field(max_length=60)] | None = None
    placement: Literal["unplaced", "in_process", "placed", "opted_out"] | None = None


class VerifyCgpaIn(CamelModel):
    """With no value the student's self-reported CGPA is confirmed as is; with a value the placement cell corrects it."""
    cgpa: Annotated[float, Field(ge=0, le=10)] | None = None
