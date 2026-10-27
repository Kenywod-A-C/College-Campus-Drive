from typing import Annotated

from pydantic import Field, StrictBool

from ..validation import CamelModel

Text = Annotated[str, Field(min_length=1, max_length=190)]


class LoginIn(CamelModel):
    identifier: Text
    password: Annotated[str, Field(min_length=1, max_length=128)]
    remember: StrictBool = False


class ChangePasswordIn(CamelModel):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Annotated[str, Field(min_length=1, max_length=256)]  # real bounds enforced by validate_new_password


class ForgotPasswordIn(CamelModel):
    email: Annotated[str, Field(min_length=3, max_length=190, pattern=r"^\S+@\S+\.\S+$")]


class ResetPasswordIn(CamelModel):
    token: Annotated[str, Field(min_length=10, max_length=200)]
    password: Annotated[str, Field(min_length=1, max_length=256)]
