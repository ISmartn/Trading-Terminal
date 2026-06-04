"""
Upstox API client using the official upstox-python-sdk.

Docs: https://upstox.com/developer/api-documentation/open-api
SDK:  https://github.com/upstox/upstox-python
"""

from __future__ import annotations

import asyncio
import os
from datetime import date, datetime
from typing import Any

import upstox_client
from upstox_client.rest import ApiException

from .config import get_access_token
from .debug_log import debug_error, debug_log

UPSTOX_API_HOST = "https://api.upstox.com"

_api_cache: dict[str, tuple[upstox_client.OptionsApi, upstox_client.MarketQuoteV3Api, upstox_client.HistoryV3Api]] = {}


def _use_sandbox() -> bool:
    return os.getenv("UPSTOX_SANDBOX", "").strip().lower() in ("1", "true", "yes")


def _create_configuration(access_token: str) -> upstox_client.Configuration:
    configuration = upstox_client.Configuration(sandbox=_use_sandbox())
    configuration.access_token = access_token
    configuration.host = UPSTOX_API_HOST
    return configuration


def _get_apis(access_token: str | None) -> tuple[upstox_client.OptionsApi, upstox_client.MarketQuoteV3Api, upstox_client.HistoryV3Api]:
    token = get_access_token(access_token)
    if not token:
        raise RuntimeError("UPSTOX_ACCESS_TOKEN not configured. Add it to .env or pass via headers.")

    if token not in _api_cache:
        api_client = upstox_client.ApiClient(_create_configuration(token))
        _api_cache[token] = (
            upstox_client.OptionsApi(api_client),
            upstox_client.MarketQuoteV3Api(api_client),
            upstox_client.HistoryV3Api(api_client),
        )
    return _api_cache[token]


def sdk_to_dict(obj: Any) -> Any:
    """Convert swagger SDK model objects to plain JSON-compatible dicts."""
    if obj is None:
        return None
    if isinstance(obj, datetime):
        return obj.strftime("%Y-%m-%d") if obj.hour == 0 and obj.minute == 0 and obj.second == 0 else obj.isoformat()
    if isinstance(obj, date):
        return obj.strftime("%Y-%m-%d")
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, list):
        return [sdk_to_dict(item) for item in obj]
    if isinstance(obj, dict):
        return {key: sdk_to_dict(value) for key, value in obj.items()}
    if hasattr(obj, "to_dict"):
        return sdk_to_dict(obj.to_dict())
    return obj


def _raise_api_error(exc: ApiException) -> None:
    status = getattr(exc, "status", None) or "unknown"
    body = getattr(exc, "body", None) or str(exc)
    body_text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body)
    if status == 400 and "Invalid Instrument key" in body_text:
        debug_log("Upstox invalid instrument key", status=status, body=body_text)
    else:
        debug_error("Upstox API error", exc, status=status, body=body_text)
    raise RuntimeError(f"Upstox API error [{status}]: {body_text}") from exc


async def _run_sdk(callable_fn, *args, **kwargs) -> Any:
    try:
        return await asyncio.to_thread(callable_fn, *args, **kwargs)
    except ApiException as exc:
        _raise_api_error(exc)


def _get_option_contracts_sync(access_token: str | None, instrument_key: str) -> dict[str, Any]:
    options_api, _, _ = _get_apis(access_token)
    response = options_api.get_option_contracts(instrument_key)
    return sdk_to_dict(response)


def _get_put_call_option_chain_sync(
    access_token: str | None,
    instrument_key: str,
    expiry_date: str,
) -> dict[str, Any]:
    options_api, _, _ = _get_apis(access_token)
    response = options_api.get_put_call_option_chain(instrument_key, expiry_date)
    return sdk_to_dict(response)


def _get_ltp_sync(access_token: str | None, instrument_key: str) -> dict[str, Any]:
    _, market_api, _ = _get_apis(access_token)
    response = market_api.get_ltp(instrument_key=instrument_key)
    return sdk_to_dict(response)


def _get_historical_candles_sync(
    access_token: str | None,
    instrument_key: str,
    unit: str,
    interval: str,
    to_date: str,
    from_date: str,
) -> dict[str, Any]:
    _, _, history_api = _get_apis(access_token)
    response = history_api.get_historical_candle_data1(
        instrument_key,
        unit,
        interval,
        to_date,
        from_date,
    )
    return sdk_to_dict(response)


async def get_option_contracts(access_token: str | None, instrument_key: str) -> dict[str, Any]:
    return await _run_sdk(_get_option_contracts_sync, access_token, instrument_key)


async def get_put_call_option_chain(
    access_token: str | None,
    instrument_key: str,
    expiry_date: str,
) -> dict[str, Any]:
    return await _run_sdk(_get_put_call_option_chain_sync, access_token, instrument_key, expiry_date)


async def get_ltp(access_token: str | None, instrument_key: str) -> dict[str, Any]:
    return await _run_sdk(_get_ltp_sync, access_token, instrument_key)


async def get_historical_candles(
    access_token: str | None,
    instrument_key: str,
    unit: str,
    interval: str,
    to_date: str,
    from_date: str,
) -> dict[str, Any]:
    return await _run_sdk(
        _get_historical_candles_sync,
        access_token,
        instrument_key,
        unit,
        interval,
        to_date,
        from_date,
    )


async def test_connection(access_token: str | None) -> dict[str, Any]:
    result = await get_option_contracts(access_token, "NSE_INDEX|Nifty 50")
    return {"status": "success", "message": "Upstox API connected", "data": result}
