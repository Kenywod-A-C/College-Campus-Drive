from flask import Blueprint

from ..responses import ok
from ..schemas.admin import ReportQuery
from ..security import current_user, permission_required
from ..services import reports_service as svc
from ..validation import parse_query

bp = Blueprint("reports", __name__)


@bp.get("/placement")
@permission_required("reports.view")
def placement():
    return ok(svc.placement_report(parse_query(ReportQuery)))


@bp.get("/placement/export.csv")
@permission_required("reports.view")
def export():
    return ok(svc.export_offers_csv(current_user(), parse_query(ReportQuery)))
