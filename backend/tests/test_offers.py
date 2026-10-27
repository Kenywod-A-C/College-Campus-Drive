from app.extensions import db
from app.models import AuditLog, CompanyTier, Offer, OfferStatus, PlacementPolicy, PolicyKind, Student


def _setup(make, tier=CompanyTier.REGULAR, **offer_kw):
    u = make.user("student", email="s@campus.test")
    job = make.job(make.company(tier=tier))
    app_id = make.application(u, job)
    return u, make.offer(app_id, **offer_kw)


def respond(client, h, offer_id, decision):
    return client.post(f"/api/v1/offers/{offer_id}/respond", headers=h, json={"decision": decision})


def test_list_my_offers_and_policy_summary(client, make, auth):
    _, off = _setup(make)
    h = auth("s@campus.test")
    d = client.get("/api/v1/offers/me", headers=h).get_json()["data"]
    assert len(d) == 1 and d[0]["offer"]["id"] == str(off) and d[0]["offer"]["status"] == "received" and d[0]["company"]["name"]
    pol = client.get("/api/v1/offers/policies", headers=h).get_json()["data"]
    assert {p["name"] for p in pol} >= {"Maximum accepted offers", "Offer acceptance window"} and all("params" in p for p in pol)


def test_accept_and_decline(client, make, auth, app):
    _, off = _setup(make)
    h = auth("s@campus.test")
    r = respond(client, h, off, "accepted")
    assert r.status_code == 200 and r.get_json()["data"]["offer"]["status"] == "accepted"
    with app.app_context():
        assert db.session.query(Student).one().placement_status.value == "placed"  # derived, never set by the client
        assert db.session.query(AuditLog).filter_by(action="offer.accepted").count() == 1
    assert respond(client, h, off, "declined").status_code == 409  # a final decision cannot be flipped


def test_cannot_respond_to_someone_elses_offer(client, make, auth, app):
    _, off = _setup(make)
    make.user("student", email="other@campus.test")
    assert respond(client, auth("other@campus.test"), off, "accepted").status_code == 404
    with app.app_context():
        assert db.session.query(Offer).one().status == OfferStatus.RECEIVED


def test_respond_after_deadline_and_invalid_decision(client, make, auth):
    _, off = _setup(make, accept_days=-1)
    h = auth("s@campus.test")
    assert respond(client, h, off, "accepted").status_code == 409
    for bad in ("withdrawn", "pending", "", None):
        assert respond(client, h, off, bad).status_code == 422  # students can only accept or decline


def test_accept_is_blocked_by_the_configured_offer_limit(client, make, auth, app):
    u, first = _setup(make)
    second = make.offer(make.application(u, make.job(make.company())))
    with app.app_context():
        p = db.session.query(PlacementPolicy).filter_by(kind=PolicyKind.MAX_OFFERS).one()
        p.params = {"maxAcceptedOffers": 1}
        db.session.commit()
    h = auth("s@campus.test")
    assert respond(client, h, first, "accepted").status_code == 200
    r = respond(client, h, second, "accepted")
    assert r.status_code == 409 and "Policy check failed" in r.get_json()["error"]["message"]
    assert respond(client, h, second, "declined").status_code == 200  # declining is always allowed


def test_students_cannot_create_or_edit_offers_through_any_route(client, make, auth):
    _, off = _setup(make)
    h = auth("s@campus.test")
    assert client.post("/api/v1/offers", headers=h, json={"applicationId": 1, "ctcLpa": 99, "acceptBy": "2099-01-01T00:00:00Z"}).status_code == 403  # route exists now: students are refused
    assert client.put(f"/api/v1/offers/{off}", headers=h, json={"ctcLpa": 99}).status_code in (404, 405)
    assert client.patch(f"/api/v1/offers/{off}", headers=h, json={"status": "accepted"}).status_code in (404, 405)
    assert client.post(f"/api/v1/offers/{off}/status", headers=h, json={"status": "accepted"}).status_code == 403
