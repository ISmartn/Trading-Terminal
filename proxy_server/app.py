"""HTTP server routes (aiohttp app)."""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

import aiohttp
from aiohttp import web

from . import alert_pipeline, cache, feed, fno_intelligence, handlers, live_scanner_feed, upstox_sdk
from .alert_pipeline import routes as alert_routes
from . import index_move_push_monitor, push_routes
from .live_scanner_feed import bootstrap_fno_scanner
from .config import (
    CORS_HEADERS,
    NSE_CONNECT_TIMEOUT_SEC,
    NSE_SOCK_READ_TIMEOUT_SEC,
    NSE_TOTAL_TIMEOUT_SEC,
    PORT,
    PROXY_DEBUG,
    get_access_token,
)
from .debug_log import debug_error, debug_log, debug_request, is_debug_enabled


def _json_response(data: Any, *, status: int = 200, cache_hit: bool | None = None) -> web.Response:
    headers = {**CORS_HEADERS, "Content-Type": "application/json"}
    if cache_hit is not None:
        headers["X-Cache"] = "HIT" if cache_hit else "MISS"
    return web.Response(text=json.dumps(data), status=status, headers=headers)


def _error_response(message: str, status: int = 500) -> web.Response:
    return _json_response({"error": message}, status=status)


async def options_handler(_request: web.Request) -> web.Response:
    return web.Response(status=204, headers=CORS_HEADERS)


async def upstox_proxy_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)
    user_token = request.headers.get("x-upstox-access-token") or request.headers.get("x-dhan-access-token")

    try:
        data, cache_hit = await handlers.handle_upstox_proxy(session, params, user_token)
        return _json_response(data, cache_hit=cache_hit)
    except RuntimeError as exc:
        debug_error(
            "upstox_proxy failed",
            exc,
            endpoint=params.get("endpoint"),
            symbol=params.get("symbol"),
            instrumentKey=params.get("instrumentKey"),
        )
        return _error_response(str(exc))
    except Exception as exc:
        debug_error("upstox_proxy unexpected error", exc, endpoint=params.get("endpoint"))
        return _error_response(str(exc))


async def index_universe_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)

    try:
        from .index_universe import handle_index_universe

        data, cache_hit = await handle_index_universe(session, params)
        return _json_response(data, cache_hit=cache_hit)
    except Exception as exc:
        debug_error("index_universe error", exc, tab=params.get("tab"))
        return _error_response(str(exc))


async def smallcap_universe_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)
    user_token = request.headers.get("x-upstox-access-token") or request.headers.get("x-dhan-access-token")

    try:
        from .smallcap_universe import handle_smallcap_universe

        cookies = await handlers.get_nse_session(session)
        data, cache_hit = await handle_smallcap_universe(session, params, cookies, user_token)
        return _json_response(data, cache_hit=cache_hit)
    except Exception as exc:
        debug_error("smallcap_universe error", exc, filter=params.get("filter"))
        return _error_response(str(exc))


async def nse_proxy_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)

    try:
        data, cache_hit = await handlers.handle_nse_proxy(session, params)
        return _json_response(data, cache_hit=cache_hit)
    except RuntimeError as exc:
        return _error_response(str(exc))
    except (asyncio.TimeoutError, TimeoutError):
        debug_log(
            "nse_proxy timeout (no cache)",
            endpoint=params.get("endpoint"),
            symbol=params.get("symbol"),
        )
        return _error_response("NSE request timed out — retry shortly", status=504)


async def tv_scan_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)

    try:
        data, cache_hit = await handlers.handle_tradingview_scan(session, params)
        return _json_response(data, cache_hit=cache_hit)
    except RuntimeError as exc:
        return _error_response(str(exc))


async def test_connection_handler(request: web.Request) -> web.Response:
    user_token = request.headers.get("x-upstox-access-token") or request.headers.get("x-dhan-access-token")

    try:
        result = await upstox_sdk.test_connection(user_token)
        return _json_response(result)
    except RuntimeError as exc:
        return _json_response({"status": "error", "message": str(exc)})


async def ta_indicators_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)
    user_token = request.headers.get("x-upstox-access-token") or request.headers.get("x-dhan-access-token")
    try:
        data, cache_hit = await handlers.handle_ta_indicators(session, params, user_token)
        return _json_response(data, cache_hit=cache_hit)
    except RuntimeError as exc:
        return _error_response(str(exc))


async def ta_snapshot_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)
    user_token = request.headers.get("x-upstox-access-token") or request.headers.get("x-dhan-access-token")
    try:
        data, cache_hit = await handlers.handle_ta_snapshot(session, params, user_token)
        return _json_response(data, cache_hit=cache_hit)
    except RuntimeError as exc:
        return _error_response(str(exc))


async def ta_scanner_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)
    user_token = request.headers.get("x-upstox-access-token") or request.headers.get("x-dhan-access-token")
    try:
        data, cache_hit = await handlers.handle_ta_scanner(session, params, user_token)
        return _json_response(data, cache_hit=cache_hit)
    except RuntimeError as exc:
        return _error_response(str(exc))


async def chart_pattern_scan_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)
    user_token = request.headers.get("x-upstox-access-token") or request.headers.get("x-dhan-access-token")
    try:
        from .chart_pattern_scan import handle_chart_pattern_scan

        data, cache_hit = await handle_chart_pattern_scan(session, params, user_token)
        return _json_response(data, cache_hit=cache_hit)
    except RuntimeError as exc:
        debug_error("chart_pattern_scan error", exc, tab=params.get("tab"))
        return _error_response(str(exc))


async def chart_pattern_detect_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)
    user_token = request.headers.get("x-upstox-access-token") or request.headers.get("x-dhan-access-token")
    try:
        from .chart_pattern_scan import handle_chart_pattern_detect

        data, cache_hit = await handle_chart_pattern_detect(session, params, user_token)
        return _json_response(data, cache_hit=cache_hit)
    except RuntimeError as exc:
        debug_error("chart_pattern_detect error", exc, symbol=params.get("symbol"))
        return _error_response(str(exc))


async def fno_symbols_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    refresh = request.query.get("refresh", "").lower() in ("1", "true", "yes")
    try:
        data, cache_hit = await handlers.handle_fno_symbols(session, refresh=refresh)
        return _json_response(data, cache_hit=cache_hit)
    except RuntimeError as exc:
        debug_error("fno_symbols failed", exc)
        return _error_response(str(exc))
    except Exception as exc:
        debug_error("fno_symbols unexpected error", exc)
        return _error_response(str(exc))


async def live_scanner_handler(request: web.Request) -> web.Response:
    params = dict(request.query)
    return _json_response(live_scanner_feed.get_scanner_response(params))


async def fno_intelligence_live_handler(request: web.Request) -> web.Response:
    params = dict(request.query)
    live_scanner_feed.ensure_scanner_universe(request.app["http_session"], params.get("universe") or "all")
    return _json_response(fno_intelligence.get_live_intelligence(params))


async def fno_intelligence_playbook_handler(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["http_session"]
    params = dict(request.query)
    token = request.headers.get("x-upstox-access-token") or get_access_token()
    try:
        data = await fno_intelligence.get_playbook_handler(session, params, token)
        return _json_response(data)
    except RuntimeError as exc:
        return _error_response(str(exc))


async def health_handler(request: web.Request) -> web.Response:
    has_token = bool(os.getenv("UPSTOX_ACCESS_TOKEN"))
    return _json_response(
        {
            "status": "ok",
            "uptime": time.time() - request.app["start_time"],
            "reachable": True,
            "proxy": "python",
            "sdk": "upstox-python-sdk",
            "websocket": feed.get_feed_stats(),
            "liveScanner": live_scanner_feed.engine.status(),
            "alertPipeline": alert_pipeline.get_pipeline_status(),
            "sources": {
                "upstox": has_token,
                "dhan": has_token,
                "tradingview": True,
                "nse": True,
            },
        }
    )


@web.middleware
async def debug_middleware(request: web.Request, handler):
    if not is_debug_enabled():
        return await handler(request)

    path = request.path
    method = request.method
    try:
        response = await handler(request)
        debug_request(method, path, status=response.status)
        return response
    except web.HTTPException as exc:
        debug_request(method, path, status=exc.status, error=str(exc))
        raise
    except Exception as exc:
        debug_error(f"{method} {path} failed", exc)
        debug_request(method, path, status=500, error=str(exc))
        return _error_response(str(exc))


@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        return await options_handler(request)
    try:
        response = await handler(request)
    except web.HTTPException as exc:
        response = exc
    response.headers.update(CORS_HEADERS)
    return response


async def on_startup(app: web.Application) -> None:
    http_timeout = aiohttp.ClientTimeout(
        total=NSE_TOTAL_TIMEOUT_SEC,
        connect=NSE_CONNECT_TIMEOUT_SEC,
        sock_read=NSE_SOCK_READ_TIMEOUT_SEC,
    )
    app["http_session"] = aiohttp.ClientSession(timeout=http_timeout)
    app["start_time"] = time.time()

    count = cache.rehydrate_from_disk()
    if count:
        print(f"  📦 Rehydrated {count} last-good cache entries from disk")

    asyncio.create_task(handlers.warm_nse_session(app["http_session"]))

    token = get_access_token()
    if token:
        feed.start_upstox_feed(token)

        async def _start_scanner_after_bind() -> None:
            await asyncio.sleep(1.0)
            await bootstrap_fno_scanner(app["http_session"], token)

        asyncio.create_task(_start_scanner_after_bind())
        asyncio.create_task(fno_intelligence.maybe_schedule_eod_playbook(app["http_session"], token))

    alert_pipeline.start_workers()
    index_move_push_monitor.start(app["http_session"])
    print(f"  ✅ Proxy ready — http://localhost:{PORT}")


async def on_cleanup(app: web.Application) -> None:
    index_move_push_monitor.stop()
    await alert_pipeline.stop_workers()
    feed.stop_upstox_feed()
    live_scanner_feed.stop_live_scanner()
    await app["http_session"].close()


def create_app() -> web.Application:
    middlewares = [debug_middleware, cors_middleware] if PROXY_DEBUG else [cors_middleware]
    app = web.Application(middlewares=middlewares)
    app.router.add_get("/api/upstox-proxy", upstox_proxy_handler)
    app.router.add_get("/api/dhan-proxy", upstox_proxy_handler)
    app.router.add_get("/api/nse-proxy", nse_proxy_handler)
    app.router.add_get("/api/smallcap-universe", smallcap_universe_handler)
    app.router.add_get("/api/index-universe", index_universe_handler)
    app.router.add_get("/api/tv-scan", tv_scan_handler)
    app.router.add_get("/api/fno-symbols", fno_symbols_handler)
    app.router.add_get("/api/test-connection", test_connection_handler)
    app.router.add_get("/api/ta/indicators", ta_indicators_handler)
    app.router.add_get("/api/ta/snapshot", ta_snapshot_handler)
    app.router.add_get("/api/ta/scanner", ta_scanner_handler)
    app.router.add_get("/api/chart-pattern/scan", chart_pattern_scan_handler)
    app.router.add_get("/api/chart-pattern/detect", chart_pattern_detect_handler)
    app.router.add_get("/api/live-scanner", live_scanner_handler)
    app.router.add_get("/api/fno-intelligence/live", fno_intelligence_live_handler)
    app.router.add_get("/api/fno-intelligence/playbook", fno_intelligence_playbook_handler)
    app.router.add_get("/health", health_handler)
    app.router.add_post("/api/market-webhook", alert_routes.market_webhook_handler)
    app.router.add_get("/api/alert-pipeline/status", alert_routes.alert_pipeline_status_handler)
    app.router.add_get("/api/push/status", push_routes.push_status_handler)
    app.router.add_post("/api/push/subscribe", push_routes.push_subscribe_handler)
    app.router.add_post("/api/push/unsubscribe", push_routes.push_unsubscribe_handler)
    app.router.add_post("/api/push/test", push_routes.push_test_handler)
    app.router.add_get("/ws", feed.websocket_handler)

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


def run() -> None:
    print("")
    print("  🚀 Mr. Chartist Proxy Server (Python + upstox-python-sdk)")
    print(f"  ├─ HTTP:       http://localhost:{PORT}")
    print(f"  ├─ WebSocket:  ws://localhost:{PORT}/ws (browser ← Upstox Market Feed V3)")
    print(f"  ├─ Health:     http://localhost:{PORT}/health")
    print(f"  ├─ Upstox (1°): http://localhost:{PORT}/api/upstox-proxy?endpoint=option-chain&symbol=NIFTY")
    print(f"  ├─ NSE  (2°):   http://localhost:{PORT}/api/nse-proxy?endpoint=indices")
    print(f"  ├─ TA Lib:     http://localhost:{PORT}/api/ta/indicators?symbol=NIFTY&indicators=rsi,macd,bbands")
    print(f"  ├─ TV Scanner:  http://localhost:{PORT}/api/tv-scan?type=stocks")
    print(f"  └─ Webhook:     POST http://localhost:{PORT}/api/market-webhook")
    print("")
    print("  Data Priority: Upstox → NSE → TradingView")
    token = get_access_token()
    print(
        "  Upstox credentials:",
        "✅ Loaded from .env" if token else "⚠️  Not set (configure in .env or Broker Settings)",
    )
    if PROXY_DEBUG:
        print("  🐛 PROXY_DEBUG=1 — verbose error logging enabled (stderr)")
    print("")

    app = create_app()
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)
