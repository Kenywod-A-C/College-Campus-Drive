from typing import Annotated

from pydantic import Field

from ..validation import CamelModel


class ChatIn(CamelModel):
    conversation_id: Annotated[int, Field(ge=1)] | None = None  # omitted = start a new conversation
    message: Annotated[str, Field(max_length=20000)]  # the real bound (ASSISTANT_MAX_INPUT_CHARS) is applied in the service so it stays configurable
