"""HTTP routes for Web Push subscription management."""

from __future__ import annotations

import json
from typing import Any

from aiohttp import web

from . import web_push
from .config import CORS_HEADERS


def _json(data: Any, *, status: int = 200) -> web.Response:
    return web.Response(
        text=json.dumps(data),
        status=status,
        headers={**CORS_HEADERS, "Content-Type": "application/json"},
    )


async def push_status_handler(_request: web.Request) -> web.Response:
    return _json(web_push.status_payload())


async def push_subscribe_handler(request: web.Request) -> web.Response:
    if not web_push.is_configured():
        return _json(
            {
                "error": "Web Push not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env",
                **web_push.status_payload(),
            },
            status=503,
        )
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return _json({"error": "Invalid JSON"}, status=400)

    web_push.add_subscription(body)
    return _json({"ok": True, "subscriptionCount": web_push.subscription_count()})


async def push_unsubscribe_handler(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return _json({"error": "Invalid JSON"}, status=400)

    endpoint = (body.get("endpoint") or "").strip()
    if endpoint:
        web_push.remove_subscription(endpoint)
    return _json({"ok": True, "subscriptionCount": web_push.subscription_count()})


async def push_test_handler(_request: web.Request) -> web.Response:
    if not web_push.is_configured():
        return _json({"error": "Web Push not configured"}, status=503)
    sent = web_push.broadcast_push(
        title="Test alert",
        body="Mobile push is working. You can close the browser and still receive index alerts.",
        tag="test",
        url="/index-move-alerts",
    )
    return _json({"ok": True, "sent": sent, "subscriptionCount": web_push.subscription_count()})
