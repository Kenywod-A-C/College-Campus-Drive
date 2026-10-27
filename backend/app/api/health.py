import sqlalchemy as sa
from flask import Blueprint

from ..extensions import db
from ..responses import ok

bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    """Liveness + database reachability. Returns no configuration details."""
    db.session.execute(sa.text("SELECT 1"))
    return ok({"status": "ok"})
