"""Data models for candle webhook ingestion and outbound alerts."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class Candle:
    timestamp: int
    ticker: str
    open: float
    high: float
    low: float
    close: float
    volume: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Candle":
        return cls(
            timestamp=int(raw["timestamp"]),
            ticker=str(raw["ticker"]).strip().upper(),
            open=float(raw["open"]),
            high=float(raw["high"]),
            low=float(raw["low"]),
            close=float(raw["close"]),
            volume=float(raw.get("volume", 0)),
        )


@dataclass
class OutboundAlert:
    ticker: str
    action: str
    strike_price: int
    entry_price: float
    stop_loss: float
    direction: str
    timestamp: int
    anomaly_range: float
    atr_baseline: float
    volume_baseline: float
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_payload(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "action": self.action,
            "strikePrice": self.strike_price,
            "entryPrice": round(self.entry_price, 2),
            "stopLoss": round(self.stop_loss, 2),
            "direction": self.direction,
            "timestamp": self.timestamp,
            "anomalyRange": round(self.anomaly_range, 4),
            "atrBaseline": round(self.atr_baseline, 4),
            "volumeBaseline": round(self.volume_baseline, 2),
            **self.metadata,
        }


@dataclass
class ProcessResult:
    accepted: bool
    alert_fired: bool
    reason: str
    alert: OutboundAlert | None = None
