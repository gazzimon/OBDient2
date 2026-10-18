#!/usr/bin/env python3
"""Creates the new-api service user for obdient-auth (ADR-0008 §2) and the
service's config file. Idempotent. Prints no secret.

    python3 server/auth/setup-app-user.py

- User "obdient2app" in new-api. Its quota must cover every account token
  (tokens spend from their owner's quota); new-api asks for a verification to
  change a quota, so that is set in the panel and the script only checks it. Its password goes to
  ~/.config/obdient/newapi-app.env (0600), for logging in to the panel once.
- ~/.config/obdient/auth.env (0600), the service's config, with the user id
  filled in. Two values are left for you: FIREBASE_PROJECT_ID and
  NEWAPI_APP_ACCESS_TOKEN (panel → log in as obdient2app → Security → access
  token; new-api asks for a verification there, so it cannot be scripted).
- Shows new-api's per-user request limit: all accounts share this user.

Needs ~/.config/obdient/newapi.env (admin), like server/newapi/setup-chat.py.
"""

import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

NEWAPI = "http://127.0.0.1:3000"
USERNAME = "obdient2app"
# Units of new-api quota: 500000 = 1 USD equivalent. Each account token has its own cap.
APP_QUOTA = 500_000_000
CONF = Path.home() / ".config" / "obdient"


def read_env(path: Path) -> dict:
    if not path.exists():
        return {}
    if path.stat().st_mode & 0o077:
        sys.exit(f"{path} tiene que ser privado: chmod 600 {path}")
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def write_private(path: Path, text: str) -> None:
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(text)


def admin_headers() -> dict:
    env = read_env(CONF / "newapi.env")
    user_id, token = env.get("NEWAPI_ADMIN_USER_ID", ""), env.get("NEWAPI_ADMIN_TOKEN", "")
    if not user_id or not token:
        sys.exit(f"Completá NEWAPI_ADMIN_USER_ID y NEWAPI_ADMIN_TOKEN en {CONF / 'newapi.env'}.")
    return {"Authorization": f"Bearer {token}", "New-Api-User": user_id, "Content-Type": "application/json"}


def api(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(NEWAPI + path, method=method, headers=admin_headers(),
                                 data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path}: HTTP {e.code}")
    if not out.get("success", False):
        sys.exit(f"{method} {path}: {out.get('message')}")
    return out


def find_user() -> dict | None:
    data = api("GET", f"/api/user/search?keyword={USERNAME}").get("data")
    users = data.get("items", []) if isinstance(data, dict) else (data or [])
    return next((u for u in users if u.get("username") == USERNAME), None)


def ensure_user() -> int:
    user = find_user()
    if user:
        print(f"usuario {USERNAME}: ya existe (id {user['id']})")
    else:
        password = secrets.token_urlsafe(18)
        api("POST", "/api/user/", {"username": USERNAME, "password": password, "display_name": "OBDient2 app"})
        write_private(CONF / "newapi-app.env", f"# Login del panel de new-api como {USERNAME}\n"
                                               f"APP_USERNAME={USERNAME}\nAPP_PASSWORD={password}\n")
        user = find_user()
        if not user:
            sys.exit("No se encontró el usuario recién creado.")
        print(f"usuario {USERNAME}: creado (id {user['id']}); contraseña en {CONF / 'newapi-app.env'}")
    quota = api("GET", f"/api/user/{user['id']}").get("data", {}).get("quota", 0)
    if quota < APP_QUOTA:
        # Changing a quota needs new-api's security verification: done in the panel.
        print(f"cuota de {USERNAME}: {quota}. Asignale {APP_QUOTA} en el panel "
              f"(Usuarios → {USERNAME} → Editar → Cuota); new-api pide verificación.")
    else:
        print(f"cuota de {USERNAME}: {quota}")
    return int(user["id"])


def ensure_auth_env(user_id: int) -> None:
    path = CONF / "auth.env"
    env = read_env(path)
    if env.get("NEWAPI_APP_USER_ID") == str(user_id):
        print(f"{path}: ya existe")
    else:
        lines = [
            "# obdient-auth (server/auth). Privado: chmod 600.",
            f"FIREBASE_PROJECT_ID={env.get('FIREBASE_PROJECT_ID', '')}",
            f"NEWAPI_URL={NEWAPI}",
            f"NEWAPI_APP_USER_ID={user_id}",
            f"NEWAPI_APP_ACCESS_TOKEN={env.get('NEWAPI_APP_ACCESS_TOKEN', '')}",
            "MODEL=obdient-chat",
            "TOKEN_QUOTA=5000000",
            "PUBLIC_LLM_URL=https://obdient.duckdns.org/llm/v1",
            "PORT=8790",
        ]
        write_private(path, "\n".join(lines) + "\n")
        print(f"{path}: escrito")
    env = read_env(path)
    missing = [k for k in ("FIREBASE_PROJECT_ID", "NEWAPI_APP_ACCESS_TOKEN") if not env.get(k)]
    if missing:
        print(f"falta completar en {path}: {', '.join(missing)}")


def show_rate_limit() -> None:
    options = {o["key"]: o["value"] for o in api("GET", "/api/option/").get("data", [])}
    keys = [k for k in options if k.startswith("ModelRequestRateLimit")]
    print("límite de pedidos de new-api (por usuario, compartido por todas las cuentas):")
    for k in sorted(keys):
        print(f"  {k} = {options[k]}")


if __name__ == "__main__":
    CONF.mkdir(parents=True, exist_ok=True)
    uid = ensure_user()
    ensure_auth_env(uid)
    show_rate_limit()
