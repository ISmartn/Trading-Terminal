"""
Multi-bar chart formations: head & shoulders, inverse H&S, cup & handle.

TA-Lib CDL* does not include these; detection uses pivot highs/lows on daily OHLCV.
"""

from __future__ import annotations

from typing import Any, Literal

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore

StructuralPatternId = Literal[
    "HEAD_AND_SHOULDERS",
    "INVERSE_HEAD_AND_SHOULDERS",
    "CUP_AND_HANDLE",
]

STRUCTURAL_PATTERN_IDS: tuple[str, ...] = (
    "HEAD_AND_SHOULDERS",
    "INVERSE_HEAD_AND_SHOULDERS",
    "CUP_AND_HANDLE",
)

# Pattern completion must fall within this many bars of the series end (scanner).
STRUCTURAL_SIGNAL_LOOKBACK = 5

PatternDirection = Literal["bullish", "bearish", "neutral"]


def _require_numpy() -> None:
    if np is None:
        raise RuntimeError("numpy is required for structural chart patterns")


def _pivot_indices(
    values: np.ndarray,
    *,
    kind: str,
    order: int = 2,
) -> list[int]:
    """Local extrema indices with `order` bars on each side."""
    n = len(values)
    if n < order * 2 + 3:
        return []
    pivots: list[int] = []
    for i in range(order, n - order):
        window = values[i - order : i + order + 1]
        v = values[i]
        if kind == "high" and v >= np.max(window) - 1e-9:
            if v > values[i - 1] and v > values[i + 1]:
                pivots.append(i)
        elif kind == "low" and v <= np.min(window) + 1e-9:
            if v < values[i - 1] and v < values[i + 1]:
                pivots.append(i)
    return pivots


def _detect_head_and_shoulders(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    times: list[int],
    *,
    min_span: int = 35,
    max_span: int = 100,
) -> dict[str, Any] | None:
    """Bearish H&S: three peaks — head highest, shoulders similar height."""
    n = len(closes)
    if n < min_span:
        return None

    start = max(0, n - max_span)
    seg_h = highs[start:n]
    pivots = _pivot_indices(seg_h, kind="high", order=2)
    if len(pivots) < 3:
        return None

    # Last three pivot highs in the window (indices into seg_h).
    i0, i1, i2 = pivots[-3], pivots[-2], pivots[-1]
    p0, p1, p2 = start + i0, start + i1, start + i2
    h0, h1, h2 = float(highs[p0]), float(highs[p1]), float(highs[p2])
    if not (p0 < p1 < p2):
        return None

    head = h1
    if head <= h0 or head <= h2:
        return None
    shoulder_avg = (h0 + h2) / 2
    if shoulder_avg < head * 0.88 or shoulder_avg > head * 0.99:
        return None
    if abs(h0 - h2) / head > 0.12:
        return None

    neckline = float(np.min(lows[p0 : p2 + 1]))
    if neckline <= 0:
        return None

    # Completion: right shoulder formed recently; price near/below neckline.
    if n - 1 - p2 > STRUCTURAL_SIGNAL_LOOKBACK:
        return None
    if float(closes[-1]) > neckline * 1.03:
        return None

    return {
        "time": int(times[p2]),
        "name": "HEAD_AND_SHOULDERS",
        "direction": "bearish",
        "strength": int(round((head - neckline) / neckline * 100)),
        "meta": {"neckline": neckline, "head": head},
        "overlay": {
            "points": [
                {"time": int(times[p0]), "price": h0, "label": "L shoulder"},
                {"time": int(times[p1]), "price": h1, "label": "Head"},
                {"time": int(times[p2]), "price": h2, "label": "R shoulder"},
            ],
            "lines": [
                {
                    "timeStart": int(times[p0]),
                    "timeEnd": int(times[-1]),
                    "price": neckline,
                    "color": "#dc2626",
                    "title": "Neckline",
                },
            ],
        },
    }


def _detect_inverse_head_and_shoulders(
    lows: np.ndarray,
    highs: np.ndarray,
    closes: np.ndarray,
    times: list[int],
    *,
    min_span: int = 35,
    max_span: int = 100,
) -> dict[str, Any] | None:
    """Bullish inverse H&S: three troughs — head lowest."""
    n = len(closes)
    if n < min_span:
        return None

    start = max(0, n - max_span)
    seg_l = lows[start:n]
    pivots = _pivot_indices(seg_l, kind="low", order=2)
    if len(pivots) < 3:
        return None

    i0, i1, i2 = pivots[-3], pivots[-2], pivots[-1]
    p0, p1, p2 = start + i0, start + i1, start + i2
    l0, l1, l2 = float(lows[p0]), float(lows[p1]), float(lows[p2])
    if not (p0 < p1 < p2):
        return None

    head = l1
    if head >= l0 or head >= l2:
        return None
    shoulder_avg = (l0 + l2) / 2
    if shoulder_avg > head * 1.12 or shoulder_avg < head * 1.01:
        return None
    if abs(l0 - l2) / abs(head) > 0.12:
        return None

    neckline = float(np.max(highs[p0 : p2 + 1]))
    if n - 1 - p2 > STRUCTURAL_SIGNAL_LOOKBACK:
        return None
    if float(closes[-1]) < neckline * 0.97:
        return None

    return {
        "time": int(times[p2]),
        "name": "INVERSE_HEAD_AND_SHOULDERS",
        "direction": "bullish",
        "strength": int(round((neckline - head) / abs(head) * 100)),
        "meta": {"neckline": neckline, "head": head},
        "overlay": {
            "points": [
                {"time": int(times[p0]), "price": l0, "label": "L shoulder"},
                {"time": int(times[p1]), "price": l1, "label": "Head"},
                {"time": int(times[p2]), "price": l2, "label": "R shoulder"},
            ],
            "lines": [
                {
                    "timeStart": int(times[p0]),
                    "timeEnd": int(times[-1]),
                    "price": neckline,
                    "color": "#16a34a",
                    "title": "Neckline",
                },
            ],
        },
    }


def _detect_cup_and_handle(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    times: list[int],
    *,
    min_cup: int = 28,
    max_cup: int = 90,
    max_handle: int = 15,
) -> dict[str, Any] | None:
    """Bullish cup & handle: U-shaped base + shallow pullback before latest bar."""
    n = len(closes)
    if n < min_cup + 5:
        return None

    end = n - 1
    # Handle = last few bars (shallow dip).
    handle_len = min(max_handle, max(3, n // 10))
    handle_start = end - handle_len
    if handle_start < min_cup:
        return None

    cup_end = handle_start
    cup_start = max(0, cup_end - max_cup)
    cup_slice = slice(cup_start, cup_end)
    if cup_end - cup_start < min_cup:
        return None

    cup_closes = closes[cup_slice]
    cup_lows = lows[cup_slice]
    cup_highs = highs[cup_slice]

    left_rim = float(cup_closes[0])
    right_rim = float(cup_closes[-1])
    cup_bottom = float(np.min(cup_lows))
    if cup_bottom <= 0:
        return None

    depth = max(left_rim, right_rim) - cup_bottom
    if depth <= 0:
        return None

    # U-shape: rim recovery (right rim at least 85% of left).
    if right_rim < left_rim * 0.85:
        return None
    # Bottom in middle 70% of cup (not V-bottom at edge).
    bottom_idx = int(np.argmin(cup_lows))
    cup_len = len(cup_lows)
    if bottom_idx < cup_len * 0.15 or bottom_idx > cup_len * 0.85:
        return None

    handle_low = float(np.min(lows[handle_start : end + 1]))
    handle_high = float(np.max(highs[handle_start : end + 1]))
    handle_depth = right_rim - handle_low
    if handle_depth > depth * 0.45:
        return None
    if handle_depth < depth * 0.05:
        return None

    # Breakout / completion near rim on latest bar.
    if float(closes[end]) < right_rim * 0.92:
        return None

    bottom_global = cup_start + bottom_idx
    return {
        "time": int(times[end]),
        "name": "CUP_AND_HANDLE",
        "direction": "bullish",
        "strength": int(round((float(closes[end]) - cup_bottom) / cup_bottom * 100)),
        "meta": {"rim": right_rim, "cup_bottom": cup_bottom},
        "overlay": {
            "points": [
                {"time": int(times[cup_start]), "price": left_rim, "label": "L rim"},
                {"time": int(times[bottom_global]), "price": cup_bottom, "label": "Cup low"},
                {"time": int(times[cup_end - 1]), "price": right_rim, "label": "R rim"},
                {"time": int(times[end]), "price": float(closes[end]), "label": "Handle"},
            ],
            "lines": [
                {
                    "timeStart": int(times[cup_start]),
                    "timeEnd": int(times[end]),
                    "price": right_rim,
                    "color": "#16a34a",
                    "title": "Rim",
                },
            ],
        },
    }


def detect_structural_patterns(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    _require_numpy()
    if len(candles) < 40:
        return []

    highs = np.array([float(c["high"]) for c in candles], dtype=float)
    lows = np.array([float(c["low"]) for c in candles], dtype=float)
    closes = np.array([float(c["close"]) for c in candles], dtype=float)
    times = [int(c["time"]) for c in candles]

    hits: list[dict[str, Any]] = []
    for detector in (
        lambda: _detect_head_and_shoulders(highs, lows, closes, times),
        lambda: _detect_inverse_head_and_shoulders(lows, highs, closes, times),
        lambda: _detect_cup_and_handle(highs, lows, closes, times),
    ):
        try:
            hit = detector()
            if hit:
                hits.append(hit)
        except (TypeError, ValueError, IndexError):
            continue
    return hits
