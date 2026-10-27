"""Test fixtures. Default DB is in-memory SQLite (fast). Set TEST_DATABASE_URL to a MySQL/MariaDB URL to run the
same suite against the real engine (the database named in the URL is wiped between tests: use a throwaway one)."""
import pytest
import sqlalchemy as sa
from sqlalchemy import event

from app import create_app
from app.extensions import db, limiter
from datetime import timedelta

from app.models import (
    AcademicRecord, Application, ApplicationEligibilitySnapshot, ApplicationStatus, ApplicationStatusHistory, Company, CompanyTier, Department, DriveEvent, HiringDrive, Job,
    JobEligibilityRule, JobStatus, Offer, OfferStatus, RoleName, Student, StudentSkill, User, UserStatus, utcnow,
)
from werkzeug.security import generate_password_hash
from app.seed import seed_reference

PASSWORD = "Str0ngPass1"  # test-only credential
# Test users get a cheap scrypt work factor (the parameters live inside the hash, so login verifies them normally).
# Production hashing (app.security.hash_password) keeps the full cost and is still exercised by the auth tests.
_FAST_HASH = lambda pw: generate_password_hash(pw, method="scrypt:1024:8:1")  # noqa: E731


@pytest.fixture(scope="session")
def _app():
    app = create_app("testing")
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
        @event.listens_for(sa.engine.Engine, "connect")
        def _fk_on(dbapi_conn, _):  # enforce FKs on SQLite so relationship mistakes surface in tests
            try:
                dbapi_conn.execute("PRAGMA foreign_keys=ON")
            except Exception:
                pass
    return app


def _reset(app):
    with app.app_context():
        db.session.remove()
        if db.engine.dialect.name == "mysql":
            with db.engine.begin() as c:
                c.execute(sa.text("SET FOREIGN_KEY_CHECKS=0"))
                for t in reversed(db.metadata.sorted_tables):
                    c.execute(sa.text(f"DROP TABLE IF EXISTS `{t.name}`"))
                c.execute(sa.text("SET FOREIGN_KEY_CHECKS=1"))
        else:
            db.drop_all()
        db.create_all()
        seed_reference()


@pytest.fixture()
def app(_app):
    _reset(_app)
    limiter.reset()
    yield _app
    with _app.app_context():
        db.session.remove()


@pytest.fixture()
def client(app):
    return app.test_client()


class Factory:
    def __init__(self, app):
        self.app = app
        self.n = 0

    def user(self, role="student", *, email=None, code=None, name=None, status=UserStatus.ACTIVE, password=PASSWORD, dept="CSE", onboarded=True, **student_kw) -> int:
        from app.models import Role

        self.n += 1
        with self.app.app_context():
            r = db.session.query(Role).filter_by(name=RoleName(role)).one()
            d = db.session.query(Department).filter_by(code=dept).one()
            u = User(user_code=code or f"{role[:3].upper()}{self.n:03d}", name=name or f"{role.title()} {self.n}", email=email or f"{role}{self.n}@campus.test",
                     password_hash=_FAST_HASH(password), role_id=r.id, department_id=d.id, status=status, onboarding_complete=onboarded)
            db.session.add(u)
            db.session.flush()
            if role == "student":
                s = Student(user_id=u.id, student_code=u.user_code, department_id=d.id, degree="B.E.", current_year=4, graduation_year=student_kw.pop("graduation_year", 2027),
                            profile_completion=student_kw.pop("profile_completion", 100), phone=student_kw.pop("phone", None), placement_status=student_kw.pop("placement", "unplaced"))
                s.academic = AcademicRecord(cgpa=student_kw.pop("cgpa", 8.4), cgpa_verified=student_kw.pop("verified", True),
                                            active_arrears=student_kw.pop("arrears", 0), arrear_history=student_kw.pop("arrear_history", 0))
                for sk in student_kw.pop("skills", ["Python", "SQL", "Java"]):
                    s.skills.append(StudentSkill(name=sk))
                db.session.add(s)
            db.session.commit()
            return u.id


    def company(self, name=None, tier=CompanyTier.REGULAR) -> int:
        self.n += 1
        with self.app.app_context():
            c = Company(name=name or f"Company {self.n}", website="https://example.com", industry="IT Services", tier=tier)
            db.session.add(c)
            db.session.commit()
            return c.id

    def job(self, company_id, title="Software Engineer", *, depts=("CSE",), min_cgpa=7.0, arrears=0, history=None, years=(2027,), status=JobStatus.PUBLISHED, deadline_days=5,
            skills=("Python",)) -> int:
        with self.app.app_context():
            now = utcnow()
            drive = HiringDrive(company_id=company_id, name=f"{title} drive", drive_date=now + timedelta(days=deadline_days + 4))
            drive.events.append(DriveEvent(sequence=1, name="Online Assessment"))
            j = Job(company_id=company_id, drive=drive, title=title, location="Chennai", ctc_lpa=6, skills=list(skills), open_date=now - timedelta(days=10),
                    deadline=now + timedelta(days=deadline_days), status=status, published_at=None if status == JobStatus.DRAFT else now - timedelta(days=10))
            j.rule = JobEligibilityRule(min_cgpa=min_cgpa, max_active_arrears=arrears, max_arrear_history=history, graduation_years=list(years))
            j.departments = db.session.query(Department).filter(Department.code.in_(depts)).all() if depts else db.session.query(Department).all()
            db.session.add(j)
            db.session.commit()
            return j.id

    def application(self, user_id, job_id, status=ApplicationStatus.APPLIED) -> int:
        with self.app.app_context():
            st = db.session.query(Student).filter_by(user_id=user_id).one()
            a = Application(student_id=st.id, job_id=job_id, status=status)
            a.snapshot = ApplicationEligibilitySnapshot(state="eligible", summary="ok", checks=[])
            a.history.append(ApplicationStatusHistory(status=ApplicationStatus.APPLIED, note="Application submitted", changed_by_name=st.user.name))
            db.session.add(a)
            db.session.commit()
            return a.id

    def offer(self, application_id, *, status=OfferStatus.RECEIVED, accept_days=7, ctc=6) -> int:
        with self.app.app_context():
            a = db.session.get(Application, application_id)
            o = Offer(application_id=a.id, student_id=a.student_id, job_id=a.job_id, company_id=a.job.company_id, ctc_lpa=ctc, accept_by=utcnow() + timedelta(days=accept_days), status=status)
            a.status = ApplicationStatus.OFFER_RECEIVED
            db.session.add(o)
            db.session.commit()
            return o.id


@pytest.fixture()
def make(app):
    return Factory(app)


def login(client, identifier, password=PASSWORD, remember=False):
    return client.post("/api/v1/auth/login", json={"identifier": identifier, "password": password, "remember": remember})


@pytest.fixture()
def auth(client):
    """auth(email) -> headers with a valid access token (and leaves the refresh cookie in the client jar)."""
    def _auth(identifier, password=PASSWORD):
        r = login(client, identifier, password)
        assert r.status_code == 200, r.get_json()
        return {"Authorization": f"Bearer {r.get_json()['data']['accessToken']}"}
    return _auth


def csrf_headers(client):
    c = client.get_cookie("csrf_refresh_token")
    return {"X-CSRF-TOKEN": c.value} if c else {}


@pytest.fixture()
def llm(monkeypatch):
    """llm(*steps) -> ScriptedProvider installed as THE provider for the assistant (see tests/fake_llm.py)."""
    from app.services.assistant import llm as llm_mod
    from tests.fake_llm import ScriptedProvider

    def _install(*steps):
        p = ScriptedProvider(*steps)
        monkeypatch.setattr(llm_mod, "get_provider", lambda: p)
        return p
    return _install
