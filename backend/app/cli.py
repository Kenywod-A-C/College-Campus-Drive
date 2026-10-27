import os
import re

import click
from flask import Flask
from flask.cli import with_appcontext

from .extensions import db


def register_cli(app: Flask) -> None:
    @app.cli.command("seed-reference")
    @with_appcontext
    def seed_reference_cmd():
        """Create roles, permissions, departments, academic years and default policies (idempotent)."""
        from .seed import seed_reference

        click.echo(f"Reference data ready: {seed_reference()}")

    @app.cli.command("seed-demo")
    @with_appcontext
    def seed_demo_cmd():
        """Load fictional demo users/jobs for local development. Needs SEED_DEMO_PASSWORD in the environment."""
        from .security import validate_new_password
        from .seed import seed_reference
        from .seed_demo import seed_demo

        if os.environ.get("APP_ENV", "development").lower() == "production":
            raise click.ClickException("Refusing to load demo data in production.")
        pw = os.environ.get("SEED_DEMO_PASSWORD", "")
        if not pw:
            raise click.ClickException("Set SEED_DEMO_PASSWORD (a password for all demo accounts) in the environment or backend/.env.")
        validate_new_password(pw)
        seed_reference()
        click.echo(f"Demo data: {seed_demo(pw)}")

    @app.cli.command("create-user")
    @click.option("--role", type=click.Choice(["admin", "faculty", "student"]), required=True)
    @click.option("--email", required=True)
    @click.option("--name", required=True)
    @click.option("--code", required=True, help="User ID / roll number")
    @click.option("--department", "dept", default=None, help="Department code, e.g. CSE (required for students)")
    @click.password_option(confirmation_prompt=True)
    @with_appcontext
    def create_user_cmd(role, email, name, code, dept, password):
        """Create an account. The password is prompted (never passed on the command line)."""
        from .models import Department, Role, RoleName, User, UserStatus
        from .security import hash_password, validate_new_password

        if not re.fullmatch(r"\S+@\S+\.\S+", email):
            raise click.ClickException("Invalid email address.")
        validate_new_password(password)
        d = db.session.query(Department).filter_by(code=dept).first() if dept else None
        if dept and not d:
            raise click.ClickException(f"Unknown department {dept!r}.")
        r = db.session.query(Role).filter_by(name=RoleName(role)).first()
        if r is None:
            raise click.ClickException("Run `flask seed-reference` first.")
        if role == "student":
            raise click.ClickException("Student accounts are created by the bulk import (not implemented yet) or seed-demo.")
        db.session.add(User(user_code=code, name=name, email=email.lower(), password_hash=hash_password(password), role_id=r.id, department_id=d.id if d else None, status=UserStatus.ACTIVE))
        db.session.commit()
        click.echo(f"Created {role} {email}.")

    @app.cli.command("assistant-purge")
    @with_appcontext
    def assistant_purge_cmd():
        """Permanently delete AI-assistant conversations that users deleted more than ASSISTANT_RETENTION_DAYS ago. Schedule daily (cron)."""
        from flask import current_app

        from .services.assistant.conversations import purge_archived

        days = current_app.config["ASSISTANT_RETENTION_DAYS"]
        click.echo(f"Purged {purge_archived(days)} archived conversation(s) older than {days} days.")

    @app.cli.command("assistant-check")
    @click.option("--ping", is_flag=True, help="Also send one tiny test message to the model (uses a few tokens).")
    @with_appcontext
    def assistant_check_cmd(ping):
        """Show how the AI assistant is configured and which tools each role gets. Never prints the key."""
        from flask import current_app

        from .models import Role, User, UserStatus
        from .services.assistant import llm, tools

        cfg = current_app.config
        st = llm.provider_status()
        click.echo(f"provider={cfg.get('LLM_PROVIDER')!r} model={cfg.get('LLM_MODEL') or '(provider default)'!r} base_url={cfg.get('LLM_BASE_URL') or '(provider default)'!r} key_set={bool(cfg.get('LLM_API_KEY'))}")
        click.echo(f"status: {'AVAILABLE' if st['available'] else 'NOT CONFIGURED (see the log line above for what is missing)'}")
        for role in ("student", "faculty", "admin"):
            u = db.session.query(User).join(Role, User.role_id == Role.id).filter(Role.name == role, User.status == UserStatus.ACTIVE).first()
            if u is None:
                click.echo(f"{role}: no active user")
                continue
            names = [t.name for t in tools.tools_for(u)]
            click.echo(f"{role} ({u.email}): {len(names)} tools: {', '.join(names)}")
        if ping:
            provider = llm.get_provider()
            if provider is None:
                raise click.ClickException("Not configured: nothing to ping.")
            try:
                r = provider.complete("Reply with the single word OK.", [{"role": "user", "text": "ping"}], [], 20)
                click.echo(f"model replied: {r.text[:80]!r}")
            except llm.LLMError as e:
                raise click.ClickException(f"Model call failed ({e.kind}): {e.message}")
