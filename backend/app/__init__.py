"""Campus Assistant API — Flask application factory."""
import logging

from flask import Flask

from .config import get_config
from .errors import register_error_handlers
from .extensions import cors, db, jwt, limiter, migrate


def create_app(config_name: str | None = None) -> Flask:
    app = Flask(__name__)
    config = get_config(config_name)
    config.validate()
    app.config.from_object(config)
    app.json.sort_keys = False
    logging.basicConfig(level=logging.INFO if not app.debug else logging.DEBUG, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    db.init_app(app)
    from . import models  # noqa: F401  (register tables for Alembic)

    migrate.init_app(app, db)
    jwt.init_app(app)
    limiter.init_app(app)
    if app.config["CORS_ORIGINS"]:
        cors.init_app(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}}, supports_credentials=True, allow_headers=["Authorization", "Content-Type", "X-CSRF-TOKEN"])

    register_error_handlers(app)
    from .api import register_blueprints
    from .cli import register_cli

    register_blueprints(app)
    register_cli(app)

    @app.after_request
    def _secure_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault("Cache-Control", "no-store")  # API responses can contain personal data
        return resp

    return app
