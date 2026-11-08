"""Multi-user: admin-managed accounts, isolation, admin-only actions,
disable / reset / delete."""
from backend.security import ratelimit

TEMP_PW = "TempPass2026x"


def _login(client, username, password):
    ratelimit.reset()
    c = client.__class__(client.app)
    r = c.post("/api/auth/login", json={"username": username, "password": password})
    return c, r


def test_first_account_is_admin(api):
    me = api.get("/api/auth/me").json()
    assert me["is_admin"] is True and me["must_change_password"] is False


def test_admin_creates_user_with_own_profiles(api, client):
    r = api.post("/api/users", json={"username": "priya", "display_name": "Priya", "password": TEMP_PW})
    assert r.status_code == 200, r.text
    u = r.json()
    assert not u["is_admin"] and u["must_change_password"] and u["profiles"] == 3
    assert api.post("/api/users", json={"username": "PRIYA", "password": TEMP_PW}).status_code == 409
    assert api.post("/api/users", json={"username": "x y", "password": TEMP_PW}).status_code in (400, 422)

    c, r = _login(client, "priya", TEMP_PW)
    assert r.status_code == 200
    csrf = r.json()["csrf"]
    me = c.get("/api/auth/me").json()
    assert me["must_change_password"] and not me["is_admin"]
    mine = c.get("/api/profiles").json()
    assert {p["name"] for p in mine} == {"MBA Semester Examinations", "SSC Competitive Examinations", "Other Examinations"}
    admin_profiles = [p["id"] for p in api.get("/api/profiles").json()]
    assert not set(admin_profiles) & {p["id"] for p in mine}
    assert c.get(f"/api/profiles/{admin_profiles[0]}").status_code == 404  # cannot see the admin's data

    # user cannot do admin things
    h = {"X-CSRF-Token": csrf}
    assert c.get("/api/users").status_code == 403
    assert c.post("/api/users", json={"username": "evil", "password": TEMP_PW}, headers=h).status_code == 403
    assert c.patch("/api/settings", json={"context_length": 8192}, headers=h).status_code == 403
    assert c.post("/api/models/pull", json={"model": "qwen3:8b"}, headers=h).status_code == 403
    assert c.post("/api/models/delete", json={"model": "qwen3:4b", "confirm": "qwen3:4b"}, headers=h).status_code == 403
    assert c.get("/api/backups").status_code == 403
    assert c.post("/api/backups", headers=h).status_code == 403
    assert all(a.get("action") != "setup" for a in c.get("/api/audit").json())  # own audit entries only
    # cannot escalate via preferences
    c.patch("/api/auth/me", json={"preferences": {"must_change_password": False, "disabled": False, "theme": "dark"}}, headers=h)
    me = c.get("/api/auth/me").json()
    assert me["must_change_password"] and me["preferences"]["theme"] == "dark"

    # changing password clears the first-login flag
    assert c.post("/api/auth/change-password", json={"current_password": TEMP_PW, "new_password": "PriyaOwn2026x"}, headers=h).status_code == 200
    assert c.get("/api/auth/me").json()["must_change_password"] is False


def _uid(api, name):
    return next(u["id"] for u in api.get("/api/users").json() if u["username"] == name)


def test_disable_reset_delete(api, client):
    api.post("/api/users", json={"username": "rahul", "password": TEMP_PW})
    uid = _uid(api, "rahul")
    c, r = _login(client, "rahul", TEMP_PW)
    assert r.status_code == 200
    # disabling signs out immediately and blocks login
    assert api.patch(f"/api/users/{uid}", json={"disabled": True}).json()["disabled"]
    assert c.get("/api/profiles").status_code == 401
    assert _login(client, "rahul", TEMP_PW)[1].status_code == 403
    api.patch(f"/api/users/{uid}", json={"disabled": False})
    # admin password reset
    api.patch(f"/api/users/{uid}", json={"reset_password": "NewTemp2026xy"})
    assert _login(client, "rahul", TEMP_PW)[1].status_code == 401
    c2, r2 = _login(client, "rahul", "NewTemp2026xy")
    assert r2.status_code == 200 and c2.get("/api/auth/me").json()["must_change_password"]
    # delete needs exact confirmation, removes data
    assert api.delete(f"/api/users/{uid}").status_code == 400
    assert api.delete(f"/api/users/{uid}", params={"confirm": "rahul"}).status_code == 200
    assert _login(client, "rahul", "NewTemp2026xy")[1].status_code == 401


def test_admin_safety_rails(api):
    me = api.get("/api/auth/me").json()
    assert api.patch(f"/api/users/{me['id']}", json={"disabled": True}).status_code == 400
    assert api.patch(f"/api/users/{me['id']}", json={"is_admin": False}).status_code == 400
    assert api.delete(f"/api/users/{me['id']}", params={"confirm": me["username"]}).status_code == 400
    # a second admin can be appointed and removed again
    api.post("/api/users", json={"username": "coadmin", "password": TEMP_PW, "is_admin": True})
    uid = _uid(api, "coadmin")
    assert api.patch(f"/api/users/{uid}", json={"is_admin": False}).json()["is_admin"] is False
