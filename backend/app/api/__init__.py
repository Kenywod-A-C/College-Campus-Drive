from flask import Flask

PREFIX = "/api/v1"


def register_blueprints(app: Flask) -> None:
    from . import admin, applications, assistant, auth, companies, dashboards, health, interviews, jobs, notifications, offers, reminders, reports, student, students, users

    for bp, path in (
        (health.bp, ""), (auth.bp, "/auth"), (student.bp, "/student"), (students.bp, "/students"), (jobs.bp, "/jobs"), (applications.bp, "/applications"), (offers.bp, "/offers"), (interviews.bp, "/interviews"), (users.bp, "/users"), (admin.bp, "/admin"), (reports.bp, "/reports"),
        (notifications.bp, "/notifications"), (assistant.bp, "/assistant"), (reminders.bp, "/reminders"), (companies.bp, "/companies"), (dashboards.bp, ""),
    ):
        app.register_blueprint(bp, url_prefix=PREFIX + path)
