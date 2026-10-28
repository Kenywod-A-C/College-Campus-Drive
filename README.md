# Campus Assistant: College Placement Management

A website that helps a college manage campus placements (jobs, companies and hiring drives). It has three kinds of users:

- **Student**: fills in a profile, sees jobs they are eligible for, applies, tracks offers and reminders.
- **Faculty / Placement Officer**: manages students, companies, jobs and hiring drives, reviews applicants, schedules interviews, records offers and views reports.
- **Admin**: manages users, roles, placement rules, departments and the audit log (a record of who changed what).

Every role also has an **AI Assistant** that can answer questions, draw charts and make changes (only after you confirm).

## How the project is built

Think of three parts that talk to each other:

```
 Browser  ──►  Front end (React)  ──►  Back end (Flask, Python)  ──►  Database (MySQL)
 what you see   screens and buttons     the rules and the logic        where everything is saved
```

| Part | Technology | Folder |
|---|---|---|
| Front end | React + TypeScript + Material UI | `src/` |
| Back end | Flask + SQLAlchemy (Python) | `backend/` |
| Database | MySQL 8 or MariaDB | runs on your computer |

## Words you will see

| Word | Meaning |
|---|---|
| **Terminal** | The window where you type commands (Terminal on Linux/macOS, Command Prompt or PowerShell on Windows, or the terminal inside VS Code). |
| **Virtual environment (venv)** | A private folder of Python packages for this project only, so it does not mix with other projects. Ours is `backend/.venv`. |
| **Migration** | A script that creates or changes the database tables. `flask db upgrade` runs them. |
| **Seeding** | Putting starting data into the empty database (roles, departments, demo users). |
| **`.env` file** | A text file with your private settings (database password, secret keys). It is never uploaded to Git. Each computer has its own. |

---

## 1. Install these first

| Tool | Version | Used for | Check it with |
|---|---|---|---|
| [Node.js](https://nodejs.org) (includes npm) | 20 or newer | front end | `node -v` |
| [Python](https://www.python.org/downloads/) | 3.11 or newer | back end | `python3 --version` (Windows: `python --version`) |
| [MySQL](https://dev.mysql.com/downloads/mysql/) 8 or [MariaDB](https://mariadb.org/download/) 10.6+ | 8 / 10.6+ | database | `mysql --version` |
| An LLM API key (optional) | any supported provider | AI Assistant only | not needed to run the app |

Quick install:

- **Ubuntu / Debian:** `sudo apt install python3 python3-venv python3-pip mysql-server` (get Node.js from nodejs.org)
- **macOS (Homebrew):** `brew install node python mysql && brew services start mysql`
- **Windows:** use the installers from the links above. On the Python installer, tick **"Add Python to PATH"**. During the MySQL install, remember the **root password** you set.

> You do **not** need Docker. The database is a normal MySQL installed on your computer.

Only want to look at the screens? You need just Node.js: go to [Quick look](#quick-look-no-back-end-no-database).

---

## Quick look (no back end, no database)

```bash
npm install
npm run dev:mock     # fictional data, fake login, resets when you reload
```

Open the address it prints (usually http://localhost:5173). Nothing is saved, so this is only for exploring the screens.

---

## 2. Full setup (front end + back end + database)

Do the steps **in order**. Each step needs the one before it.

### Step 1. Install the front-end packages
Run this in the project folder (the one that contains `package.json`):
```bash
npm install
```

### Step 2. Create the database and a database user
Choose your own password instead of `CHANGE_ME`. Remember it, because you need it in Step 4.

**Linux / macOS:**
```bash
mysql -u root -p <<'SQL'
CREATE DATABASE campus_assistant CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'campus_app'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON campus_assistant.* TO 'campus_app'@'localhost';
SQL
```

**Windows:** the `<<'SQL'` trick does not work. Start MySQL with `mysql -u root -p`, then paste these three lines at the `mysql>` prompt:
```sql
CREATE DATABASE campus_assistant CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'campus_app'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON campus_assistant.* TO 'campus_app'@'localhost';
```

This creates an **empty** database. It has no tables and no users yet. That is normal. Steps 5 and 6 fill it.

### Step 3. Create the Python environment
```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
```

After activating, your terminal line starts with `(.venv)`. That means the venv is on.

> **Every new terminal** needs `cd backend` and the activate line again. If you see `flask: command not found`, you forgot to activate the venv.

### Step 4. Configure the back end
```bash
cp .env.example .env          # Windows: copy .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # run this twice
```
Open `backend/.env` in your editor and fill in:

| Setting | What to put |
|---|---|
| `DATABASE_URL` | The line from the template, but replace `CHANGE_ME` with your password from Step 2. |
| `SECRET_KEY` | The first long random text the command printed. |
| `JWT_SECRET_KEY` | The second long random text (it must be different from the first). |
| `SEED_DEMO_PASSWORD` | The password you want for all demo accounts (see the rules below). |

**Password rules** (for `SEED_DEMO_PASSWORD` and for any admin you create): enough length, at least **one capital letter** and **one number**. If it is too weak, the command stops and tells you why.

**Never share or upload `backend/.env`.** It holds your passwords.

If your MySQL uses a different port than 3306 (for example, it runs in Docker), change the number in `DATABASE_URL` too. The part `...@127.0.0.1:3306/...` is host and port.

### Step 5. Create the tables and the base data
Still inside `backend` with the venv on:
```bash
export FLASK_APP=wsgi.py      # Windows (Command Prompt): set FLASK_APP=wsgi.py
                              # Windows (PowerShell):     $env:FLASK_APP="wsgi.py"
flask db upgrade
flask seed-reference
```

What these do:

- `flask db upgrade` creates all the tables (users, jobs, applications and so on) inside the empty database.
- `flask seed-reference` adds the starting data every installation needs: the 3 roles (admin, faculty, student), permissions, departments, academic years and the default placement rules. You can run it again safely; it only adds what is missing.

### Step 6. Add users
Nobody can sign in until at least one user exists. Pick **one** option.

**Option A, demo data** (fictional students, faculty, companies and jobs; best for learning):
```bash
flask seed-demo
```
This uses the `SEED_DEMO_PASSWORD` from your `.env`. It is for development only and refuses to run if `APP_ENV=production`.

**Option B, your own first admin** (you will be asked to type a password):
```bash
flask create-user --role admin --email you@college.edu --name "Your Name" --code ADM001
```

### Step 7. Start the API (back end)
```bash
flask run --port 5000
```
Leave this terminal open. If you close it, the website stops working.

### Step 8. Start the front end
Open a **second terminal**, go to the **project folder** (the one with `package.json`, not `backend`) and run:
```bash
npm run dev
```
Open the address it prints (usually http://localhost:5173).

### Step 9. Sign in
Use one of these accounts with your `SEED_DEMO_PASSWORD`, or the admin you made in Step 6:

| Role | Email |
|---|---|
| Student | `student@campus.demo` |
| New student (goes through the first-time setup) | `newstudent@campus.demo` |
| Faculty / Placement Officer | `faculty@campus.demo` |
| Admin | `admin@campus.demo` |

---

## What to run every day after the first setup

Once Steps 1 to 6 are done, you never repeat them. To work on the project later:

1. Make sure MySQL is running.
2. Terminal 1: `cd backend`, activate the venv, then `flask run --port 5000`.
3. Terminal 2: in the project folder, `npm run dev`.

---

## 3. Turn on the AI Assistant (optional)

Add these lines to `backend/.env`, then restart Flask. Keep the key in this file only. Never put it in a `VITE_*` variable, because those go to the browser where anyone can read them.
```
LLM_PROVIDER=anthropic     # or openai | gemini | mistral | groq | deepseek | openrouter | together | ollama | openai_compatible
LLM_API_KEY=<your key>
LLM_MODEL=claude-opus-5-5  # required for every provider except anthropic, e.g. gpt-4o-mini for openai
```
Open it from the sidebar (**AI Assistant**). Without a key, the page says it is not configured; the rest of the app still works.
Details and security design: [backend/README.md](backend/README.md#ai-assistant-apiv1assistant).

---

## Common problems

| What you see | Why it happens | What to do |
|---|---|---|
| `flask: command not found` | The venv is not active in this terminal. | `cd backend`, then activate it (Step 3). |
| `Access denied for user 'campus_app'` | The password in `DATABASE_URL` is not the one you chose in Step 2. | Fix `DATABASE_URL` in `backend/.env`, then restart Flask. |
| `Can't connect to MySQL server` | MySQL is not running, or the host or port in `DATABASE_URL` is wrong. | Start MySQL. Check the port number in `DATABASE_URL`. |
| `Table '...' doesn't exist`, or the database shows no tables | You skipped `flask db upgrade`, or you are looking at a different MySQL server than the one in `DATABASE_URL`. | Run `flask db upgrade`. Check that the host and port match. |
| `Run flask seed-reference first` | The roles are not in the database yet. | Run `flask seed-reference`, then try again. |
| `seed-demo` says the password is weak, or `SEED_DEMO_PASSWORD` is missing | The password is empty or does not follow the rules. | Set a stronger `SEED_DEMO_PASSWORD` in `backend/.env` (capital letter + number). |
| Login says the email or password is wrong | You did Step 5 but not Step 6, or the password is not your `SEED_DEMO_PASSWORD`. | Run `flask seed-demo` (or `create-user`) and use that password. |
| **Port 5000 is already in use** | Another program is using it. | Run Flask on another port (`flask run --port 5055`) and start the front end with `VITE_DEV_PROXY_TARGET=http://127.0.0.1:5055 npm run dev` (Windows: set that variable first, then run `npm run dev`). |
| **"Not available on the server yet" (501)** | Documents, system settings and e-mail are not built on the server yet. | Nothing is wrong. This is expected. |
| You changed `backend/.env` and nothing happened | Settings are read only when Flask starts. | Stop Flask (Ctrl+C) and start it again. |

---

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
cd backend && pytest                       # back-end tests
```
The back-end tests use a temporary in-memory database, so they never touch your real data. If your `backend/.env` leaves `TEST_DATABASE_URL` empty and `pytest` fails, run it as `TEST_DATABASE_URL=sqlite:// pytest` (Windows Command Prompt: `set TEST_DATABASE_URL=sqlite://` first).

## Notes
- All demo data is fictional.
- Not implemented yet: document upload and text extraction, system settings, e-mail delivery.
- More back-end detail (security rules, eligibility engine, production deployment): [backend/README.md](backend/README.md) and [docs/API_CONTRACT.md](docs/API_CONTRACT.md).
