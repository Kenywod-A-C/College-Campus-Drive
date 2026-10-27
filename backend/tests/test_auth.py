from datetime import timedelta

from app.extensions import db
from app.models import AuditLog, PasswordResetToken, User, UserStatus, utcnow
from app.services import auth_service

from .conftest import PASSWORD, csrf_headers, login


def test_login_success_shape_and_cookies(client, make):
    make.user("student", email="aarav@campus.test", name="Aarav")
    r = login(client, "aarav@campus.test", remember=True)
    assert r.status_code == 200
    d = r.get_json()["data"]
    assert d["user"]["role"] == "student" and d["user"]["email"] == "aarav@campus.test"
    assert d["permissions"] == []  # students hold no staff permissions
    assert d["accessToken"] and d["expiresIn"] == 900
    assert "password" not in str(d).lower()
    cookies = r.headers.getlist("Set-Cookie")
    refresh = next(c for c in cookies if c.startswith("refresh_token_cookie="))
    assert "HttpOnly" in refresh and "Path=/api/v1/auth" in refresh and "SameSite=Lax" in refresh
    csrf = next(c for c in cookies if c.startswith("csrf_refresh_token="))
    assert "HttpOnly" not in csrf and "Path=/;" in csrf + ";"  # the SPA must be able to read it from any page
    assert "Max-Age" in refresh  # remember me => persistent cookie
    assert not any(c.startswith("access_token_cookie") for c in cookies)  # access token is never a cookie


def test_login_without_remember_is_a_session_cookie(client, make):
    make.user("student", email="a@campus.test")
    refresh = next(c for c in login(client, "a@campus.test").headers.getlist("Set-Cookie") if c.startswith("refresh_token_cookie="))
    assert "Max-Age" not in refresh and "Expires" not in refresh


def test_login_by_user_code_is_case_insensitive(client, make):
    make.user("faculty", code="FAC101")
    assert login(client, "fac101").status_code == 200


def test_bad_credentials_are_indistinguishable(client, make):
    make.user("student", email="real@campus.test")
    a = login(client, "real@campus.test", "Wrong1234")
    b = login(client, "nobody@campus.test", "Wrong1234")
    assert a.status_code == b.status_code == 401
    assert a.get_json() == b.get_json()
    assert a.get_json()["error"]["code"] == "unauthenticated"


def test_failed_logins_are_audited_without_secrets(client, make, app):
    make.user("student", email="real@campus.test")
    login(client, "real@campus.test", "Wrong1234")
    with app.app_context():
        row = db.session.query(AuditLog).filter_by(action="auth.login").one()
        assert row.result.value == "denied"
        assert "Wrong1234" not in f"{row.resource}{row.reason}"


def test_lockout_after_repeated_failures_even_with_right_password(client, make):
    make.user("student", email="lock@campus.test")
    for _ in range(5):
        assert login(client, "lock@campus.test", "Wrong1234").status_code == 401
    r = login(client, "lock@campus.test", PASSWORD)
    assert r.status_code == 401  # locked: correct password no longer works


def test_lock_expires(client, make, app):
    uid = make.user("student", email="lock@campus.test")
    for _ in range(5):
        login(client, "lock@campus.test", "Wrong1234")
    with app.app_context():
        db.session.get(User, uid).locked_until = utcnow() - timedelta(minutes=1)
        db.session.commit()
    assert login(client, "lock@campus.test").status_code == 200


def test_inactive_account_cannot_sign_in(client, make):
    make.user("student", email="off@campus.test", status=UserStatus.INACTIVE)
    r = login(client, "off@campus.test")
    assert r.status_code == 403 and "not active" in r.get_json()["error"]["message"]


def test_me_requires_a_token(client):
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "unauthenticated"
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_me_returns_permissions_from_the_database(client, make, auth):
    make.user("faculty", email="f@campus.test")
    d = client.get("/api/v1/auth/me", headers=auth("f@campus.test")).get_json()["data"]
    assert d["user"]["role"] == "faculty" and "students.view" in d["permissions"] and "users.manage" not in d["permissions"]


def test_deactivating_a_user_kills_their_access_token_immediately(client, make, auth, app):
    uid = make.user("student", email="s@campus.test")
    h = auth("s@campus.test")
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200
    with app.app_context():
        db.session.get(User, uid).status = UserStatus.INACTIVE
        db.session.commit()
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401


def test_refresh_requires_csrf_and_rotates(client, make):
    make.user("student", email="s@campus.test")
    login(client, "s@campus.test")
    assert client.post("/api/v1/auth/refresh").status_code == 401  # cookie but no CSRF header
    old_cookie = client.get_cookie("refresh_token_cookie", path="/api/v1/auth").value
    r = client.post("/api/v1/auth/refresh", headers=csrf_headers(client))
    assert r.status_code == 200 and r.get_json()["data"]["accessToken"]
    new_cookie = client.get_cookie("refresh_token_cookie", path="/api/v1/auth").value
    assert new_cookie != old_cookie
    # replaying the old (rotated) refresh token must fail
    client.set_cookie("refresh_token_cookie", old_cookie, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh", headers=csrf_headers(client)).status_code == 401


def test_refresh_without_any_session_is_401(client):
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_logout_revokes_refresh_token(client, make):
    make.user("student", email="s@campus.test")
    login(client, "s@campus.test")
    cookie = client.get_cookie("refresh_token_cookie", path="/api/v1/auth").value
    csrf = csrf_headers(client)
    assert client.post("/api/v1/auth/logout", headers=csrf).status_code == 200
    client.set_cookie("refresh_token_cookie", cookie, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh", headers=csrf).status_code == 401


def test_access_token_cannot_be_used_as_refresh_and_vice_versa(client, make):
    make.user("student", email="s@campus.test")
    token = login(client, "s@campus.test").get_json()["data"]["accessToken"]
    client.set_cookie("refresh_token_cookie", token, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh", headers=csrf_headers(client)).status_code == 401


def test_change_password_flow(client, make, auth):
    make.user("student", email="s@campus.test")
    h = auth("s@campus.test")
    assert client.post("/api/v1/auth/change-password", headers=h, json={"currentPassword": "nope", "newPassword": "NewPassw0rd"}).status_code == 401
    weak = client.post("/api/v1/auth/change-password", headers=h, json={"currentPassword": PASSWORD, "newPassword": "short"})
    assert weak.status_code == 422 and weak.get_json()["error"]["code"] == "validation_error"
    same = client.post("/api/v1/auth/change-password", headers=h, json={"currentPassword": PASSWORD, "newPassword": PASSWORD})
    assert same.status_code == 422
    assert client.post("/api/v1/auth/change-password", headers=h, json={"currentPassword": PASSWORD, "newPassword": "NewPassw0rd"}).status_code == 200
    assert login(client, "s@campus.test", PASSWORD).status_code == 401
    assert login(client, "s@campus.test", "NewPassw0rd").status_code == 200


def test_password_change_invalidates_other_sessions_refresh_tokens(make, app):
    make.user("student", email="s@campus.test")
    other, mine = app.test_client(), app.test_client()
    login(other, "s@campus.test")
    stale_refresh, stale_csrf = other.get_cookie("refresh_token_cookie", path="/api/v1/auth").value, csrf_headers(other)
    token = login(mine, "s@campus.test").get_json()["data"]["accessToken"]
    import time; time.sleep(1.1)  # token iat has 1-second resolution
    mine.post("/api/v1/auth/change-password", headers={"Authorization": f"Bearer {token}"}, json={"currentPassword": PASSWORD, "newPassword": "NewPassw0rd"})
    assert other.post("/api/v1/auth/refresh", headers=stale_csrf).status_code == 401
    assert mine.post("/api/v1/auth/refresh", headers=csrf_headers(mine)).status_code == 200  # the changing browser stays signed in


def test_forgot_password_is_neutral(client, make):
    make.user("student", email="real@campus.test")
    a = client.post("/api/v1/auth/forgot-password", json={"email": "real@campus.test"})
    b = client.post("/api/v1/auth/forgot-password", json={"email": "ghost@campus.test"})
    assert a.status_code == b.status_code == 200 and a.get_json() == b.get_json()


def test_reset_password_token_is_single_use_and_expires(client, make, app):
    uid = make.user("student", email="real@campus.test")
    with app.app_context():
        raw = auth_service.request_password_reset("real@campus.test")
        assert raw and db.session.query(PasswordResetToken).filter_by(token_hash=raw).first() is None  # only the hash is stored
    assert client.post("/api/v1/auth/reset-password", json={"token": raw, "password": "weak"}).status_code == 422
    ok = client.post("/api/v1/auth/reset-password", json={"token": raw, "password": "BrandNew123"})
    assert ok.status_code == 200
    assert client.post("/api/v1/auth/reset-password", json={"token": raw, "password": "BrandNew456"}).status_code == 422  # already used
    assert login(client, "real@campus.test", "BrandNew123").status_code == 200
    with app.app_context():
        raw2 = auth_service.request_password_reset("real@campus.test")
        row = db.session.query(PasswordResetToken).filter_by(used_at=None).one()
        row.expires_at = utcnow() - timedelta(minutes=1)
        db.session.commit()
    assert client.post("/api/v1/auth/reset-password", json={"token": raw2, "password": "BrandNew789"}).status_code == 422
    assert uid


def test_validation_errors_use_the_envelope(client):
    r = client.post("/api/v1/auth/login", json={"identifier": "x"})
    e = r.get_json()["error"]
    assert r.status_code == 422 and e["code"] == "validation_error" and "password" in e["details"]
    r = client.post("/api/v1/auth/login", json={"identifier": "x", "password": "y", "role": "admin"})  # unknown field (mass assignment)
    assert r.status_code == 422
    r = client.post("/api/v1/auth/login", data="not json", content_type="application/json")
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "bad_request"


def test_unknown_route_and_wrong_method_use_the_envelope(client):
    assert client.get("/api/v1/nope").get_json()["error"]["code"] == "not_found"
    r = client.get("/api/v1/auth/login")
    assert r.status_code == 405 and r.get_json()["error"]["code"] == "method_not_allowed"


def test_security_headers_and_no_caching(client):
    h = client.get("/api/v1/health").headers
    assert h["X-Content-Type-Options"] == "nosniff" and h["X-Frame-Options"] == "DENY" and h["Cache-Control"] == "no-store"


def test_login_rate_limit_returns_429_envelope(client, app, monkeypatch):
    monkeypatch.setitem(app.config, "LOGIN_RATE_LIMIT", "3 per minute")
    codes = [login(client, "nobody@campus.test", "Wrong1234") for _ in range(5)]
    assert [r.status_code for r in codes[:3]] == [401, 401, 401]
    assert codes[3].status_code == 429 and codes[3].get_json()["error"]["code"] == "rate_limited"


def test_refresh_and_logout_work_when_the_access_header_is_sent_too(client, make):
    """The SPA sends Authorization on most calls; the refresh cookie must still be honoured explicitly."""
    make.user("student", email="s@campus.test")
    token = login(client, "s@campus.test").get_json()["data"]["accessToken"]
    h = {**csrf_headers(client), "Authorization": f"Bearer {token}"}
    r = client.post("/api/v1/auth/refresh", headers=h)
    assert r.status_code == 200 and r.get_json()["data"]["accessToken"]
    cookie = client.get_cookie("refresh_token_cookie", path="/api/v1/auth").value
    out = client.post("/api/v1/auth/logout", headers={**csrf_headers(client), "Authorization": f"Bearer {token}"})
    assert out.status_code == 200
    assert any(c.startswith("refresh_token_cookie=;") for c in out.headers.getlist("Set-Cookie"))  # cookie cleared
    client.set_cookie("refresh_token_cookie", cookie, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh", headers=csrf_headers(client)).status_code == 401  # and the token was revoked server-side


def test_logout_without_csrf_clears_cookies_but_cannot_revoke(client, make, app):
    make.user("student", email="s@campus.test")
    login(client, "s@campus.test")
    cookie = client.get_cookie("refresh_token_cookie", path="/api/v1/auth").value
    csrf = csrf_headers(client)
    out = client.post("/api/v1/auth/logout")  # forged/cross-site style request: no CSRF header
    assert out.status_code == 200
    with app.app_context():
        from app.models import RevokedToken
        assert db.session.query(RevokedToken).count() == 0  # unauthenticated callers cannot revoke tokens
    client.set_cookie("refresh_token_cookie", cookie, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh", headers=csrf).status_code == 200  # the real session was unaffected


def test_refresh_with_wrong_csrf_is_rejected(client, make):
    make.user("student", email="s@campus.test")
    login(client, "s@campus.test")
    assert client.post("/api/v1/auth/refresh", headers={"X-CSRF-TOKEN": "forged"}).status_code == 401


def test_refresh_after_deactivation_is_rejected(client, make, app):
    from app.models import UserStatus

    uid = make.user("student", email="s@campus.test")
    login(client, "s@campus.test")
    with app.app_context():
        db.session.get(User, uid).status = UserStatus.INACTIVE
        db.session.commit()
    assert client.post("/api/v1/auth/refresh", headers=csrf_headers(client)).status_code == 401
