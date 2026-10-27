from flask import Blueprint, request

from ..responses import ok
from ..schemas.student import CONTROLLED_FIELDS, OnboardingIn, ProfilePatch
from ..security import current_user, roles_required
from ..serializers import student_dict, user_dict
from ..services import student_service
from ..validation import parse_body

bp = Blueprint("student", __name__)


@bp.get("/profile")
@roles_required("student")
def get_profile():
    return ok(student_dict(student_service.student_of(current_user())))


@bp.patch("/profile")
@roles_required("student")
def patch_profile():
    raw = request.get_json(silent=True) or {}
    # Controlled fields are rejected (and audited) before generic validation so the denial is explicit.
    if isinstance(raw, dict) and set(raw) & CONTROLLED_FIELDS:
        student_service.update_profile(current_user(), raw, ProfilePatch())
    patch = parse_body(ProfilePatch)
    return ok(student_dict(student_service.update_profile(current_user(), raw, patch)))


@bp.post("/onboarding")
@roles_required("student")
def onboarding():
    return ok(user_dict(student_service.onboard(current_user(), parse_body(OnboardingIn))))


@bp.get("/dashboard")
@roles_required("student")
def dashboard():
    return ok(student_service.dashboard(current_user()))
