from flask import Blueprint

from ..responses import ok, paginated
from ..schemas.jobs import RespondIn
from ..schemas.review import OfferIn, OfferQuery, OfferStatusIn
from ..security import auth_required, current_user, permission_required, roles_required
from ..services import offers_service
from ..validation import parse_body, parse_query

bp = Blueprint("offers", __name__)


@bp.get("/me")
@roles_required("student")
def mine():
    return ok(offers_service.list_mine(current_user()))


@bp.get("/policies")
@auth_required
def policies():
    return ok(offers_service.policy_summary())


@bp.post("/<int:offer_id>/respond")
@roles_required("student")
def respond(offer_id: int):
    return ok(offers_service.respond(current_user(), offer_id, parse_body(RespondIn).decision))


# ---------------------------------------------------------------- placement cell (offers.manage)
@bp.get("")
@permission_required("offers.manage")
def list_all():
    q = parse_query(OfferQuery)
    items, total, extra = offers_service.list_offers(current_user(), q)
    return paginated(items, page=q.page, page_size=q.page_size, total=total, **extra)


@bp.post("")
@permission_required("offers.manage")
def create():
    return ok(offers_service.create_offer(current_user(), parse_body(OfferIn)), 201)


@bp.post("/<int:offer_id>/status")
@permission_required("offers.manage")
def set_status(offer_id: int):
    return ok(offers_service.set_offer_status(current_user(), offer_id, parse_body(OfferStatusIn)))
