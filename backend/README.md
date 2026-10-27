# Campus Assistant API (Flask)

REST backend for the Campus Assistant placement platform: **Flask 3 · SQLAlchemy 2 · Flask-Migrate (Alembic) · MySQL/MariaDB**.
Conventions every endpoint follows (envelopes, errors, auth, pagination): [../docs/API_CONVENTIONS.md](../docs/API_CONVENTIONS.md).
What is implemented vs. still mock-only: [../docs/API_CONTRACT.md](../docs/API_CONTRACT.md).

## Layout
```
backend/
  wsgi.py                 entry point (gunicorn wsgi:app / flask run)
  app/
    __init__.py           application factory, security headers
    config.py             env-driven config; production refuses weak/missing secrets
    extensions.py         db, migrate, jwt, limiter, cors (+ deterministic constraint names)
    errors.py             ApiError hierarchy + ONE error envelope; no stack traces leak
    responses.py          {"data"} / {"data","meta"} envelopes
    validation.py         Pydantic request parsing (camelCase, unknown fields rejected)
    security.py           password hashing/policy, JWT plumbing, @auth_required / @permission_required / @roles_required
    models/               35 tables, one module per domain (users, academic, companies, applications, content, system)
    schemas/              Pydantic request models
    serializers.py        model -> JSON shapes the React app expects
    services/             business rules: eligibility engine, applications, offers, student, jobs, dashboards, audit ...
    api/                  thin Flask blueprints (parse -> service -> envelope): auth, students, jobs, applications, interviews, offers, users, admin, reports ...
    seed.py / seed_demo.py / cli.py   reference data, fictional demo data, CLI commands
  migrations/             Alembic (initial schema)
  tests/                  pytest (478 tests)
  scripts/gen_api_contract.py   regenerates docs/API_CONTRACT.md
```

## Data model (MySQL)
`users` → `roles` ⇄ `permissions` (`role_permissions`) · `students` (1:1 user) → `academic_records`, `student_skills` · `faculty_profiles` ·
`departments` → `courses`, `academic_years` · `companies` → `hiring_drives` → `drive_events` (rounds) · `jobs` (→ company, → drive) with
`job_eligibility_rules` (1:1) and `job_departments` (m:n) · `applications` → `application_status_history`, `application_eligibility_snapshots` ·
`interviews` ⇄ applications (`interview_candidates`) · `offers` (1:1 application) · `placement_policies` · `documents` → `document_chunks` ·
`conversations` → `messages` · `reminders` · `notifications`, `notification_preferences` · `saved_jobs` · `audit_logs` (append-only) ·
`revoked_tokens`, `password_reset_tokens`.
Applications, interview results, selections and offers are separate records. A company owns many jobs and drives without duplicating its master row.

## Setup
Prerequisites: Python 3.11+, MySQL 8 or MariaDB 10.6+.

```bash
# 1. database + a least-privilege application user (run as a MySQL admin; choose your own password)
mysql -u root -p <<'SQL'
CREATE DATABASE campus_assistant CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'campus_app'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON campus_assistant.* TO 'campus_app'@'localhost';
SQL

# 2. Python environment
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt

# 3. configuration (copy, then fill in DATABASE_URL + the two secrets; nothing is committed)
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # run twice: SECRET_KEY and JWT_SECRET_KEY

# 4. schema + reference data
export FLASK_APP=wsgi.py
flask db upgrade
flask seed-reference                  # roles, permissions, departments, academic years, default policies

# 5a. local demo data (fictional; needs SEED_DEMO_PASSWORD in .env, refused in production)
flask seed-demo
# 5b. or create your first real admin (password is prompted, never a CLI argument)
flask create-user --role admin --email you@college.edu --name "Your Name" --code ADM001

# 6. run
flask run --port 5000
```
Then start the frontend (`npm run dev` in the repo root). Its Vite dev server proxies `/api` to this server, so the browser sees one origin.

Demo accounts created by `seed-demo` (all use `SEED_DEMO_PASSWORD`): `student@campus.demo`, `newstudent@campus.demo` (goes through onboarding), `faculty@campus.demo`, `admin@campus.demo`.

## Tests
```bash
pytest                                              # in-memory SQLite, ~20 s
TEST_DATABASE_URL='mysql+pymysql://user:pw@127.0.0.1:3306/campus_assistant_test?charset=utf8mb4' pytest   # real MySQL/MariaDB
```
**The database in `TEST_DATABASE_URL` has every table dropped between tests: use a throwaway one.** The suite is meant to pass identically on both engines.
Migrations: `flask db upgrade && flask db downgrade base && flask db upgrade && flask db check` must succeed and report no drift.

## Job lifecycle rules (server-enforced)
`draft → published → closed → published (reopen)`; `published → draft` (**unpublish**, only while nobody has applied); `draft|published → cancelled` (reason required, active applicants notified).
Every other transition is a 409, whether it arrives through `POST /jobs/{id}/status` or the `status` field of a save: both use one function. Publishing/reopening needs a future deadline and an
un-archived company. **Archive** is a separate soft flag (`archived_at`) for draft/closed/cancelled jobs and for companies without published jobs; archived records are hidden by default (`?archived=include|only`)
and read-only until restored. Saving a job (job + drive + rounds + eligibility rule + departments) is one transaction. Permissions: `jobs.create` to create/edit; `drives.publish` to publish, change status or archive
(creating a job *already published* needs both); `companies.manage` for companies.

## Security design
- **Passwords**: scrypt (Werkzeug) with per-hash salt; policy 8–128 chars, upper-case + digit, no email/ID fragments. Never logged or serialised.
- **Sessions**: 15-minute access JWT held **in memory** by the SPA; refresh token in an `httpOnly`, `SameSite`, path-scoped cookie with **double-submit CSRF**, **rotation on every use**, a DB blocklist, and invalidation on password change / deactivation.
- **Brute force**: per-IP rate limits on login/forgot/reset/refresh plus per-account lockout (default 5 failures → 15 min). Login errors are identical for unknown user, wrong password and locked account (no enumeration); password-reset replies are always the same.
- **Authorisation is server-side and DB-backed on every request** (active flag, role, permission matrix); JWT claims are never trusted. Record-level checks stop URL-id tampering (other students' applications → 403 + audit entry; other users' notifications/reminders/offers → 404).
- **Validation**: Pydantic on every body/query; unknown fields rejected (mass-assignment); controlled student fields (role, department, ID, batch, placement status, CGPA verification) cannot be set through the API; LIKE wildcards escaped; SQL only through SQLAlchemy.
- **Business rules re-validated at the server**: application submission re-checks job status, deadline, duplicates, eligibility and policy limits; offers can only be accepted within policy.
- **Audit log** is append-only (ORM refuses UPDATE/DELETE; no mutating endpoint). In production also `REVOKE UPDATE, DELETE ON campus_assistant.audit_logs` from the application's DB user.
- Errors use one envelope; unexpected errors return a generic 500 with nothing internal. Responses are `Cache-Control: no-store` and carry `nosniff` / `X-Frame-Options`.
- **Production** (`APP_ENV=production`) refuses to start without a ≥32-char `SECRET_KEY`/`JWT_SECRET_KEY`, `COOKIE_SECURE=true` and a shared `RATELIMIT_STORAGE_URI` (e.g. Redis). Serve behind HTTPS with `gunicorn wsgi:app`, put the SPA and `/api` on one origin, and schedule a purge of expired `revoked_tokens` / `password_reset_tokens`.

## Staff workflows (server-enforced)
**Applicant review** (`applications.review`): `GET /applications` is paginated/filterable server-side. `POST /applications/stage` is a bulk, per-row, forward-only state machine
(`applied < shortlisted < interview < selected`, `rejected` from any active stage; `offer_received`, `rejected` and `withdrawn` are terminal for review; an offer is only created or withdrawn in the Offers module).
Each changed application gets its own history entry, student notification and audit event. Advancing an applicant whose eligibility snapshot is not *eligible* requires a recorded exception
(reason + approver, stored on the snapshot and audited). Rows are locked while checked; all valid rows commit together or none do.
**Interviews**: candidates must be shortlisted/interview applicants *of that job*; no student can be double-booked; `scheduled → completed | no_show` only once started, `→ cancelled` any time, all else final;
editing re-arms notification. The result of a round is recorded on the applications, never as a side effect.
**Offers** (`offers.manage`): only a *selected* application, one offer each; policy checks (accepted-offer limit, tier rule) run at issue time and are stored on the offer; an offer the student could never accept is refused (and the denial audited).
Issuing = offer + application stage + history + notification + audit + placement status in one transaction. Staff status changes: `received → accepted | declined | withdrawn`, `accepted → withdrawn` (reason required); declined/withdrawn are final.
**Reports** (`reports.view`): aggregates only; the CSV exports (applications, offers) are audited and neutralise spreadsheet formulas.

## Administrator workflows (server-enforced)
- **Users** (`users.manage`): created as *invited* with an unusable password and a one-time set-password token (accepting it activates the account). E-mail delivery is not implemented, so the link is logged in development only and never returned by the API.
- **Escalation guards**: only the administrator *role* may create/edit/activate/deactivate administrator accounts or edit the role-permission matrix (holding `users.manage`/`roles.manage` is not enough); nobody can change their own role or deactivate themselves; the last active administrator is protected; student accounts cannot be converted to staff and back;
  the student role can never receive staff permissions; `roles.manage`/`users.manage` cannot be removed from admin and `roles.manage` cannot be granted to another role. Permission changes apply to already-issued tokens on the next request.
- **Placement policies** (`policies.manage`): validated per kind (offer limit 1–20, application limit, acceptance window, tier rule, exception approval), scoped to college / department / batch; changes apply to the next eligibility check or offer; deletion needs a reason and is audited.
- **Academic configuration** (administrator role): departments, programmes, academic years (exactly one active). Deleting a department that still has students, programmes, staff, jobs or policies is refused.
- **Audit log** (`audit.view`): read-only, filterable, paginated; IP addresses are not exposed. The admin dashboard's activity feed obeys the same permission.

## AI assistant (`/api/v1/assistant/*`)
Code: `app/api/assistant.py`, `app/services/assistant/` (`llm.py` provider, `tools.py`, `documents.py`, `actions.py`, `conversations.py`, `orchestrator.py`). Tables: `conversations`, `messages`, `assistant_actions`.
- **Provider** (`LLM_PROVIDER`, key in `LLM_API_KEY`, backend environment only): two adapters on the vendors' official SDKs cover practically any LLM. `anthropic` (Claude) uses the `anthropic` SDK. `openai`, `gemini`, `mistral`, `groq`, `deepseek`, `openrouter`, `together`, `ollama` (local, no key) and the generic `openai_compatible` (+ `LLM_BASE_URL`: vLLM, LM Studio, a company gateway…) use the `openai` SDK over the OpenAI chat-completions protocol. `LLM_MODEL` is required except for `anthropic`. Tools, confirmations and permissions are identical for every provider. Only the OpenAI and Anthropic wire formats are tested (against mock transports); the vendor preset URLs are conveniences, so verify one with a real key before relying on it. Incomplete or unsupported settings (the reason is logged) mean "not configured". Without a key `GET /assistant/status` says `available: false` and `POST /assistant/chat` answers **503 `assistant_unavailable`**; nothing is saved. Provider timeouts/overload/refusals map to 504/502 with a safe message and persist nothing (the UI offers Retry). Production code has no fake provider; tests inject one (`tests/fake_llm.py`).
- **The model never touches the database.** It can only call the narrow tools in `tools.py` (no SQL, no user-id/role/permission parameters; unknown arguments are rejected). Each tool declares the roles and permissions it needs, is enforced **at call time**, returns an allow-listed set of fields and reuses the service layer (`eligibility.evaluate` is the single source of eligibility). Denied attempts are audited.
  Student: profile, jobs, eligibility explanation, own applications / offers / interviews, policies, documents, prepare application / reminder. Staff (each tool needs the same permission as the matching screen): student directory and student details (`students.view`; reading a profile is audited, phones masked except for admins), companies, applicants, find eligible students, interview schedule, offers (`offers.manage`), placement stats, recruitment activity, prepare stage change. Administrator: system overview and alerts, user accounts (`users.manage`), academic structure, roles & permissions (`roles.manage`), audit activity (`audit.view`). All of it is read-only except the three `prepare_*` proposals.
  **Charts**: `show_chart` (staff) and `show_my_chart` (students) let the model pick a *metric* and a style (pie, donut, bar, horizontal bar, stacked, line, area). The server computes the numbers from the services with the same permission as the matching report (`app/services/assistant/charts.py`), aggregates only, and attaches them to the message as `charts`; the model cannot supply data. The UI renders them with a style switcher, a table view and CSV export.
- **Changes need confirmation.** `prepare_*` tools only create a pending `assistant_actions` row. `POST /assistant/actions/{id}/confirm` (owner only) atomically claims it, re-checks the caller's role/permission, runs the normal service function (`applications_service.apply`, `content_service.save_reminder`, `applications_review_service.update_stage`) which re-validates every rule against current data, reports success only after it commits, and audits the outcome. Business-rule refusals come back as `200` with `state: "failed"` and the reason. Proposals expire (`ASSISTANT_ACTION_TTL_MINUTES`). Offers, interviews and messages are deliberately **not** exposed to the assistant.
  **Managing records** (all proposals, run on confirmation through the existing admin services, which re-validate everything): `prepare_user_change` (create / edit / deactivate / re-activate a student or faculty account, `users.manage`), `prepare_student_import` (up to 25 students), `prepare_company_change` (add / edit / archive / restore, `companies.manage`), `prepare_policy_change` (create / edit / enable-disable / delete with a reason, `policies.manage`), `prepare_cgpa_verification` (`students.edit`). Following the app's own rules, accounts are *deactivated* and companies *archived* (never hard-deleted), and the assistant **cannot create or edit administrator accounts, change roles or edit the permission matrix**. Deactivate / archive / delete proposals are flagged `destructive` and shown with a warning.
  **Reports**: `generate_report` (placement summary, student directory, applicants, offers, interviews, eligible students for a job, user accounts, companies, audit summary; each needs the permission of the matching screen) and `generate_my_report` (students). The server builds KPI tiles, tables (first 100 rows, flagged when cut) and charts (`app/services/assistant/report_builders.py`); the model gets a compact preview and writes the executive summary. The report is saved with the message (`reports`) and shown in the chat with per-table CSV and print / save-as-PDF.
- **Documents**: retrieval reads `document_chunks` filtered by the caller's role / ownership; excerpts are labelled untrusted for the model, and no action can be prepared in a turn that read document text. **Dependency:** the backend has no upload / text-extraction pipeline yet, so `document_chunks` is empty and document questions honestly return "no matching documents" until that exists.
- **Limits**: input length, tool rounds, output tokens, per-turn wall-clock budget, model timeout, history window, conversation size, and a per-user rate limit (`ASSISTANT_CHAT_RATE_LIMIT`). Set the WSGI worker timeout above `ASSISTANT_TURN_SECONDS`.
- **Retention**: `DELETE /assistant/conversations/{id}` archives (hidden at once, pending actions cancelled); `flask assistant-purge` hard-deletes conversations archived longer than `ASSISTANT_RETENTION_DAYS` (schedule daily). Audit entries are kept.

## Not implemented yet
Document upload + storage + text extraction, system settings (needs a settings table), and e-mail delivery
(password-reset and invitation links are logged in development only). The frontend shows a clear "not available on the server yet" message for these in real mode.
