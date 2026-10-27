import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from ..errors import Conflict, NotFound, ValidationFailed
from ..extensions import db
from ..models import (
    Application, ApplicationStatus, ApplicationStatusHistory, AuditResult, Company, Department, JobStatus, NotificationKind, Offer, OfferStatus, PolicyKind, Student, User, utcnow,
)
from ..schemas.review import OfferIn, OfferQuery, OfferStatusIn
from . import audit, eligibility
from .notifications import notify
from .student_service import set_placement_status, student_of
from .views import application_view, offer_view


def list_mine(user: User) -> list[dict]:
    s = student_of(user)
    rows = db.session.query(Offer).filter_by(student_id=s.id).order_by(Offer.offered_at.desc()).all()
    return [offer_view(o, user) for o in rows]


def policy_summary() -> list[dict]:
    keep = (PolicyKind.MAX_OFFERS, PolicyKind.TIER_RESTRICTION, PolicyKind.ACCEPTED_OFFER)
    return [{"id": str(p.id), "name": p.name, "description": p.description, "params": p.params, "scope": p.scope.value} for p in eligibility.active_policies() if p.kind in keep]


def respond(user: User, offer_id: int, decision: str) -> dict:
    """A student may only respond to their own RECEIVED offer; no other field of the record can change."""
    s = student_of(user)
    offer = db.session.query(Offer).filter_by(id=offer_id, student_id=s.id).with_for_update().first()
    if offer is None:
        raise NotFound("Offer")
    if offer.status != OfferStatus.RECEIVED:
        raise Conflict(f"This offer is {offer.status.value} and can no longer be changed.")
    if offer.accept_by < utcnow():
        raise Conflict("The acceptance deadline has passed. Contact the placement cell.")
    if decision == "accepted":
        failed = [c for c in eligibility.offer_policy_checks(s, offer.company, offer.id) if not c["passed"]]
        if failed:
            raise Conflict("Policy check failed: " + " ".join(c["detail"] for c in failed))
    offer.status = OfferStatus(decision)
    db.session.flush()
    set_placement_status(s)
    audit.record(f"offer.{decision}", f"Offer {offer.company.name}", actor=user)
    db.session.commit()
    return offer_view(offer, user)


# ====================================================================== placement cell (offers.manage)
# Staff-side status graph. A student's own accept/decline goes through respond() above; staff can record the same outcome on the
# student's behalf (offline acceptance) and can withdraw an offer. declined and withdrawn are final.
OS = OfferStatus
STAFF_NEXT = {OS.PENDING: {OS.RECEIVED, OS.WITHDRAWN}, OS.RECEIVED: {OS.ACCEPTED, OS.DECLINED, OS.WITHDRAWN}, OS.ACCEPTED: {OS.WITHDRAWN}, OS.DECLINED: set(), OS.WITHDRAWN: set()}


def _like(term: str) -> str:
    return "%" + term.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _summaries() -> dict:
    """College-wide aggregates for the summary tab (counts only; no personal data)."""
    by_dept = []
    for d in db.session.query(Department).order_by(Department.code):
        offers_n = db.session.query(Offer).join(Student, Offer.student_id == Student.id).filter(Student.department_id == d.id).count()
        placed = (db.session.query(Offer.student_id).join(Student, Offer.student_id == Student.id).filter(Student.department_id == d.id, Offer.status == OS.ACCEPTED).distinct().count())
        students = db.session.query(Student).filter_by(department_id=d.id).count()
        if students or offers_n:
            by_dept.append({"dept": d.code, "offers": offers_n, "placed": placed, "students": students})
    by_company = [{"company": name, "offers": n, "accepted": int(acc or 0)} for name, n, acc in
                  db.session.query(Company.name, sa.func.count(Offer.id), sa.func.sum(sa.case((Offer.status == OS.ACCEPTED, 1), else_=0))).join(Offer, Offer.company_id == Company.id).group_by(Company.id, Company.name).order_by(Company.name)]
    return {"byDept": by_dept, "byCompany": by_company,
            "totals": {"offers": db.session.query(Offer).count(), "accepted": db.session.query(Offer).filter_by(status=OS.ACCEPTED).count(),
                       "placed": db.session.query(Offer.student_id).filter_by(status=OS.ACCEPTED).distinct().count()}}


def list_offers(viewer: User, q: OfferQuery) -> tuple[list[dict], int, dict]:
    query = db.session.query(Offer).join(Student, Offer.student_id == Student.id).join(User, Student.user_id == User.id).join(Company, Offer.company_id == Company.id)
    if q.status and q.status != "all":
        query = query.filter(Offer.status == OS(q.status))
    if q.dept:
        query = query.filter(Student.department_id == q.dept)
    if q.company_id:
        query = query.filter(Offer.company_id == q.company_id)
    if q.q:
        pat = _like(q.q)
        query = query.filter(sa.or_(*[sa.func.lower(c).like(pat, escape="\\") for c in (User.name, Student.student_code, Company.name)]))
    total = query.count()
    rows = query.order_by(Offer.offered_at.desc(), Offer.id.desc()).offset((q.page - 1) * q.page_size).limit(q.page_size).all()
    awaiting = (db.session.query(Application).outerjoin(Offer, Offer.application_id == Application.id)
                .filter(Application.status == ApplicationStatus.SELECTED, Offer.id.is_(None)).order_by(Application.updated_at.desc(), Application.id.desc()).limit(100).all())
    return [offer_view(o, viewer) for o in rows], total, {**_summaries(), "selectedWithoutOffer": [application_view(a, viewer) for a in awaiting]}


def create_offer(actor: User, data: OfferIn) -> dict:
    """SELECTED application -> official offer, in one transaction: offer + application stage + history + notification + audit + placement status."""
    try:
        app = db.session.query(Application).filter_by(id=data.application_id).with_for_update().first()
        if app is None:
            raise NotFound("Application")
        if app.status != ApplicationStatus.SELECTED:
            raise Conflict("Only applications in the Selected stage can receive an offer.")
        if db.session.query(Offer.id).filter_by(application_id=app.id).first():
            raise Conflict("An offer already exists for this application.")
        if app.job.status == JobStatus.CANCELLED:
            raise Conflict("This job was cancelled; no offer can be issued.")
        now = utcnow()
        if data.accept_by <= now:
            raise ValidationFailed("Choose an acceptance deadline in the future.", details={"acceptBy": ["Must be in the future"]})
        checks = eligibility.offer_policy_checks(app.student, app.job.company)
        failed = [c for c in checks if not c["passed"]]
        if failed:  # an offer the student could never accept is not issued; the cell must resolve the policy conflict first
            audit.record("offer.create", f"Offer {app.job.company.name} → {app.student.student_code}", result=AuditResult.DENIED, reason="Policy: " + " ".join(c["detail"] for c in failed), actor=actor)
            db.session.commit()
            raise Conflict("Policy check failed: " + " ".join(c["detail"] for c in failed))
        offer = Offer(application_id=app.id, student_id=app.student_id, job_id=app.job_id, company_id=app.job.company_id, ctc_lpa=data.ctc_lpa, offered_at=now,
                      accept_by=data.accept_by, status=OS.RECEIVED, policy_checks=checks)
        db.session.add(offer)
        app.status, app.updated_at = ApplicationStatus.OFFER_RECEIVED, now
        app.history.append(ApplicationStatusHistory(status=ApplicationStatus.OFFER_RECEIVED, at=now, note="Official offer issued", changed_by=actor.id, changed_by_name=actor.name))
        db.session.flush()
        set_placement_status(app.student)
        notify(app.student.user_id, f"Offer received — {app.job.company.name}", f"Respond before {data.accept_by.strftime('%d %b').lstrip('0')}.", NotificationKind.OFFER, "/student/offers")
        audit.record("offer.create", f"Offer {app.job.company.name} → {app.student.student_code}", actor=actor, reason=f"{data.ctc_lpa:g} LPA")
        db.session.commit()
    except IntegrityError:  # the unique constraint on offers.application_id is the final guard against a concurrent double-issue
        db.session.rollback()
        raise Conflict("An offer already exists for this application.")
    except Exception:
        db.session.rollback()
        raise
    return offer_view(offer, actor)


def set_offer_status(actor: User, offer_id: int, data: OfferStatusIn) -> dict:
    offer = db.session.query(Offer).filter_by(id=offer_id).with_for_update().first()
    if offer is None:
        raise NotFound("Offer")
    new = OS(data.status)
    if new not in STAFF_NEXT[offer.status]:
        raise Conflict(f"An offer that is {offer.status.value} cannot become {new.value}.")
    if new == OS.ACCEPTED:
        failed = [c for c in eligibility.offer_policy_checks(offer.student, offer.company, offer.id) if not c["passed"]]
        if failed:
            raise Conflict("Policy check failed: " + " ".join(c["detail"] for c in failed))
    offer.status = new
    db.session.flush()
    set_placement_status(offer.student)
    notify(offer.student.user_id, f"Offer update — {offer.company.name}", f"Your offer is now {new.value}." + (f" Reason: {data.reason.strip()}" if data.reason else ""), NotificationKind.OFFER, "/student/offers")
    audit.record(f"offer.{new.value}", f"Offer {offer.company.name} → {offer.student.student_code}", actor=actor, reason=(data.reason or None) and data.reason.strip())
    db.session.commit()
    return offer_view(offer, actor)
