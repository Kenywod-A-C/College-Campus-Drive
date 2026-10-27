"""Request validation with Pydantic. Bodies and query strings are parsed into typed models; failures become 422s."""
from typing import Annotated, Any, TypeVar

from flask import request
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .errors import ApiError

T = TypeVar("T", bound=BaseModel)


class CamelModel(BaseModel):
    """Accepts and emits camelCase; unknown fields are rejected so typos and mass-assignment attempts fail loudly."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid", str_strip_whitespace=True)


class PageParams(CamelModel):
    page: Annotated[int, Field(ge=1, le=100000)] = 1
    page_size: Annotated[int, Field(ge=1, le=100)] = 10


def parse_body(model: type[T]) -> T:
    data: Any = request.get_json(silent=True)
    if data is None:
        if request.content_length:
            raise ApiError("Request body must be valid JSON.")
        data = {}
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object.")
    return model.model_validate(data)


def parse_query(model: type[T]) -> T:
    return model.model_validate({k: v for k, v in request.args.items() if v != ""})
