#!/usr/bin/env python3
"""Configures new-api (K16) for the OBDient2 assistant (ADR-0007/0008, milestone M0).

    python3 server/newapi/setup-chat.py

Idempotent: creates what is missing and leaves the rest alone. Prints no secret.

- Channel "z440-qwen3.8": OpenAI-compatible, the Z440's vLLM (llm-chat), with the
  model exposed under the alias "obdient-chat" (the app never names the real model).
- Token "obdient2-beta": only that model, with a quota. Its key is written to
  ~/.config/obdient/llm-token (0600) for tests; the app gets per-account tokens
  later (ADR-0008).

Needs:
- ~/.config/obdient/newapi.env (0600) with NEWAPI_ADMIN_USER_ID and
  NEWAPI_ADMIN_TOKEN (new-api → Security & Access → System Access Token).
- ssh access to the Z440 (the vLLM key is read there and never shown).
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

NEWAPI = os.environ.get("NEWAPI_URL", "http://127.0.0.1:3000")
Z440 = "fiui-pss@192.168.100.210"
VLLM_URL = "http://192.168.100.210:8000"
SERVED_MODEL = "qwen3.8-27b"
ALIAS = "obdient-chat"
CHANNEL_NAME = "z440-qwen3.8"
TOKEN_NAME = "obdient2-beta"
# new-api quota units: 500000 = 1 USD equivalent. Generous for the beta, but bounded.
TOKEN_QUOTA = 50_000_000
# Price of the alias, as new-api ratios (1 = 0.002 USD per 1k prompt tokens). Our own
# GPU, so it only exists to make quotas count; output tokens count double.
MODEL_RATIO = 0.05
COMPLETION_RATIO = 2
CONF = Path.home() / ".config" / "obdient"


def admin_headers() -> dict:
    f = CONF / "newapi.env"
    if not f.exists():
        sys.exit(f"Falta {f} con NEWAPI_ADMIN_USER_ID y NEWAPI_ADMIN_TOKEN.")
    if f.stat().st_mode & 0o077:
        sys.exit(f"{f} tiene que ser privado: chmod 600 {f}")
    env = {}
    for line in f.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    user_id, token = env.get("NEWAPI_ADMIN_USER_ID", ""), env.get("NEWAPI_ADMIN_TOKEN", "")
    if not user_id or not token:
        sys.exit(f"Completá NEWAPI_ADMIN_USER_ID y NEWAPI_ADMIN_TOKEN en {f}.")
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


def items(out: dict) -> list:
    data = out.get("data")
    if isinstance(data, dict):
        data = data.get("items", [])
    return data or []


def vllm_key() -> str:
    cmd = "grep -E '^VLLM_API_KEY=' ~/obdient-stack/.env | cut -d= -f2- | tr -d '\"\\r'"
    key = subprocess.run(["ssh", Z440, cmd], capture_output=True, text=True, check=True).stdout.strip()
    if not key:
        sys.exit("No se pudo leer VLLM_API_KEY en la Z440.")
    return key


def ensure_channel() -> None:
    found = [c for c in items(api("GET", f"/api/channel/search?keyword={CHANNEL_NAME}")) if c.get("name") == CHANNEL_NAME]
    if found:
        print(f"canal {CHANNEL_NAME}: ya existe (id {found[0]['id']})")
        return
    api("POST", "/api/channel/", {
        "mode": "single",
        "channel": {
            "name": CHANNEL_NAME,
            "type": 1,  # OpenAI-compatible
            "base_url": VLLM_URL,
            "key": vllm_key(),
            "models": ALIAS,
            "model_mapping": json.dumps({ALIAS: SERVED_MODEL}),
            "group": "default",
            "status": 1,
        },
    })
    print(f"canal {CHANNEL_NAME}: creado ({ALIAS} → {SERVED_MODEL})")


def ensure_price() -> None:
    """Adds the alias to the model price tables, leaving every other entry untouched."""
    options = {o["key"]: o["value"] for o in api("GET", "/api/option/").get("data", [])}
    for key, value in (("ModelRatio", MODEL_RATIO), ("CompletionRatio", COMPLETION_RATIO)):
        table = json.loads(options.get(key) or "{}")
        if table.get(ALIAS) == value:
            print(f"precio {key}[{ALIAS}]: ya configurado")
            continue
        table[ALIAS] = value
        api("PUT", "/api/option/", {"key": key, "value": json.dumps(table)})
        print(f"precio {key}[{ALIAS}] = {value}")


def ensure_token() -> None:
    found = [t for t in items(api("GET", f"/api/token/search?keyword={TOKEN_NAME}")) if t.get("name") == TOKEN_NAME]
    if not found:
        api("POST", "/api/token/", {
            "name": TOKEN_NAME,
            "remain_quota": TOKEN_QUOTA,
            "unlimited_quota": False,
            "expired_time": -1,
            "model_limits_enabled": True,
            "model_limits": ALIAS,
        })
        found = [t for t in items(api("GET", f"/api/token/search?keyword={TOKEN_NAME}")) if t.get("name") == TOKEN_NAME]
        print(f"token {TOKEN_NAME}: creado")
    else:
        print(f"token {TOKEN_NAME}: ya existe")
    token = found[0]
    key = token.get("key", "")
    if not key or "*" in key:
        # Newer versions mask keys in listings; the full key has its own endpoint.
        key = api("POST", f"/api/token/{token['id']}/key").get("data", {}).get("key", "")
    if not key or "*" in key:
        sys.exit("No se pudo obtener la clave completa del token: copiala desde el panel.")
    out = CONF / "llm-token"
    out.write_text(("sk-" + key if not key.startswith("sk-") else key) + "\n")
    out.chmod(0o600)
    print(f"clave del token guardada en {out} (no se muestra)")


if __name__ == "__main__":
    CONF.mkdir(parents=True, exist_ok=True)
    ensure_channel()
    ensure_price()
    ensure_token()
