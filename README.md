# Campus Assistant — College Placement Management

A web app for managing campus placements, with three kinds of users:

- **Student**: profile, eligible jobs, applications, offers, reminders.
- **Faculty / Placement Officer**: students, companies, jobs and drives, applicant review, interviews, offers, reports.
- **Admin**: users, roles, placement policies, departments, audit log.

Every role also has an **AI Assistant** that can answer questions, draw charts and make changes (after you confirm).

**Tech:** React + TypeScript + Material UI (front end), Flask + SQLAlchemy + MySQL (back end).

## 1. What to install first

| Tool | Version | Used for | Check it with |
|---|---|---|---|
| [Node.js](https://nodejs.org) (includes npm) | 20 or newer | front end | `node -v` |
| [Python](https://www.python.org/downloads/) | 3.11 or newer | back end | `python3 --version` |
| [MySQL](https://dev.mysql.com/downloads/mysql/) 8 or [MariaDB](https://mariadb.org/download/) 10.6+ | 8 / 10.6+ | database | `mysql --version` |
| An LLM API key (optional) | any supported provider | AI Assistant only | n/a |

Quick install:

- **Ubuntu / Debian:** `sudo apt install python3 python3-venv python3-pip mysql-server` (get Node.js from nodejs.org)
- **macOS (Homebrew):** `brew install node python mysql && brew services start mysql`
- **Windows:** use the installers from the links above (tick "Add Python to PATH").

Only want to look at the screens? You need just Node.js: go to [Quick look](#quick-look-no-back-end).

## Quick look (no back end)
```bash
npm install
npm run dev:mock     # fictional data, fake login, resets on reload
```
Open the URL it prints (usually http://localhost:5173).

## 2. Full setup (front end + back end + database)

**Step 1. Install front-end packages** (from the project folder):
```bash
npm install
```

**Step 2. Create the database and an app user** (pick your own password instead of `CHANGE_ME`):
```bash
mysql -u root -p <<'SQL'
CREATE DATABASE campus_assistant CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'campus_app'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON campus_assistant.* TO 'campus_app'@'localhost';
SQL
```

**Step 3. Create the Python environment:**
```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
```

**Step 4. Configure the back end:**
```bash
cp .env.example .env          # Windows: copy .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # run this twice
```
Open `backend/.env` and fill in:

| Setting | Value |
|---|---|
| `DATABASE_URL` | same as the template, with your password from Step 2 |
| `SECRET_KEY` | first generated value |
| `JWT_SECRET_KEY` | second generated value |
| `SEED_DEMO_PASSWORD` | the password you want for the demo accounts |

**Step 5. Create the tables and base data:**
```bash
export FLASK_APP=wsgi.py      # Windows: set FLASK_APP=wsgi.py
flask db upgrade
flask seed-reference
```

**Step 6. Add users.** Either demo data (fictional students, faculty, admin):
```bash
flask seed-demo
```
or your own first admin (you will be asked for a password):
```bash
flask create-user --role admin --email you@college.edu --name "Your Name" --code ADM001
```

**Step 7. Start the API** and leave this terminal open:
```bash
flask run --port 5000
```

**Step 8. Start the front end** in a second terminal, from the project folder:
```bash
npm run dev
```
Open the URL it prints (usually http://localhost:5173).

**Step 9. Sign in** with one of the demo accounts and your `SEED_DEMO_PASSWORD`, or the admin from Step 6:

| Role | Email |
|---|---|
| Student | `student@campus.demo` |
| New student (goes through onboarding) | `newstudent@campus.demo` |
| Faculty / Placement Officer | `faculty@campus.demo` |
| Admin | `admin@campus.demo` |

## 3. Turn on the AI Assistant (optional)
Add these to `backend/.env`, then restart Flask. Keep the key in this file only, never in a `VITE_*` variable.
```
LLM_PROVIDER=anthropic     # or openai | gemini | mistral | groq | deepseek | openrouter | together | ollama | openai_compatible
LLM_API_KEY=<your key>
LLM_MODEL=claude-opus-5-5  # required for every provider except anthropic, e.g. gpt-4o-mini for openai
```
Open it from the sidebar (**AI Assistant**). Without a key the page says it is not configured.
Details and security design: [backend/README.md](backend/README.md#ai-assistant-apiv1assistant).

## Common problems
- **Port 5000 is already in use:** run Flask on another port (`flask run --port 5055`) and start the front end with `VITE_DEV_PROXY_TARGET=http://127.0.0.1:5055 npm run dev`.
- **"Not available on the server yet" (501):** documents, system settings and e-mail are not built on the server yet. This is expected.
- **Changed `backend/.env`:** restart Flask.

## Project layout
```
src/        front end (pages, components, services/ for API calls, mock/ for the fake back end)
backend/    Flask API, database migrations, tests (see backend/README.md)
docs/       API documentation (API_CONVENTIONS.md, API_CONTRACT.md)
```

## Tests
```bash
npm test                                   # front-end tests
npm run build                              # type-check + production build
cd backend && pytest                       # back-end tests (set TEST_DATABASE_URL=sqlite:// if your .env leaves it empty)
```

## Notes
- All demo data is fictional.
- Not implemented yet: document upload and text extraction, system settings, e-mail delivery.
- More back-end detail (security rules, eligibility engine, production deployment): [backend/README.md](backend/README.md) and [docs/API_CONTRACT.md](docs/API_CONTRACT.md).
