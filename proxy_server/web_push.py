"""Web Push (VAPID) — notify phones when the browser tab is closed."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from .config import CACHE_DIR, ROOT_DIR

try:
    from pywebpush import WebPushException, webpush
except ImportError:
    webpush = None  # type: ignore
    WebPushException = Exception  # type: ignore

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "").strip()
VAPID_CLAIMS_SUB = os.getenv("VAPID_CLAIMS_SUB", "mailto:alerts@localhost").strip()

SUBS_PATH = CACHE_DIR / "push_subscriptions.json"


def is_configured() -> bool:
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and webpush is not None)


def _load_subs() -> list[dict[str, Any]]:
    if not SUBS_PATH.exists():
        return []
    try:
        raw = json.loads(SUBS_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save_subs(subs: list[dict[str, Any]]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    SUBS_PATH.write_text(json.dumps(subs, indent=0), encoding="utf-8")


def subscription_count() -> int:
    return len(_load_subs())


def add_subscription(sub: dict[str, Any]) -> None:
    endpoint = (sub.get("endpoint") or "").strip()
    if not endpoint:
        return
    keys = sub.get("keys") or {}
    if not keys.get("p256dh") or not keys.get("auth"):
        return

    entry = {
        "endpoint": endpoint,
        "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
        "createdAt": int(time.time() * 1000),
    }
    subs = [s for s in _load_subs() if s.get("endpoint") != endpoint]
    subs.append(entry)
    _save_subs(subs)


def remove_subscription(endpoint: str) -> None:
    ep = endpoint.strip()
    subs = [s for s in _load_subs() if s.get("endpoint") != ep]
    _save_subs(subs)


def _send_one(sub: dict[str, Any], payload: dict[str, Any]) -> bool:
    if not is_configured():
        return False
    try:
        webpush(
            subscription_info=sub,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CLAIMS_SUB},
        )
        return True
    except WebPushException as exc:
        status = getattr(exc, "response", None)
        code = getattr(status, "status_code", None) if status else None
        if code in (404, 410):
            remove_subscription(sub.get("endpoint", ""))
        return False
    except Exception:
        return False


def broadcast_push(
    *,
    title: str,
    body: str = "",
    tag: str = "alert",
    url: str = "/index-move-alerts",
) -> int:
    """Send push to all registered devices. Returns delivery count."""
    if not is_configured():
        return 0
    payload = {"title": title, "body": body, "tag": tag, "url": url}
    sent = 0
    for sub in list(_load_subs()):
        if _send_one(sub, payload):
            sent += 1
    return sent


def status_payload() -> dict[str, Any]:
    return {
        "configured": is_configured(),
        "pywebpushInstalled": webpush is not None,
        "publicKey": VAPID_PUBLIC_KEY or None,
        "subscriptionCount": subscription_count(),
        "claimsSub": VAPID_CLAIMS_SUB if is_configured() else None,
    }
