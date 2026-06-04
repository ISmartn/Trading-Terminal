"""Phase 5: POST formatted alerts to execution / notification webhook."""

from __future__ import annotations

import aiohttp

from .config import ALERT_OUTBOUND_WEBHOOK_URL, ALERT_WEBHOOK_SECRET
from .models import OutboundAlert

_last_alert_by_asset: dict[str, int] = {}


async def dispatch_alert(session: aiohttp.ClientSession, alert: OutboundAlert) -> bool:
    if not ALERT_OUTBOUND_WEBHOOK_URL:
        print(
            f"  📣 Alert (dry-run): {alert.ticker} {alert.action} "
            f"entry={alert.entry_price} SL={alert.stop_loss}"
        )
        return False

    headers = {"Content-Type": "application/json"}
    if ALERT_WEBHOOK_SECRET:
        headers["X-Alert-Secret"] = ALERT_WEBHOOK_SECRET

    try:
        async with session.post(
            ALERT_OUTBOUND_WEBHOOK_URL,
            json=alert.to_payload(),
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status >= 400:
                body = await resp.text()
                print(f"  ⚠️ Outbound alert webhook {resp.status}: {body[:200]}")
                return False
            return True
    except Exception as exc:
        print(f"  ⚠️ Outbound alert webhook failed: {exc}")
        return False
