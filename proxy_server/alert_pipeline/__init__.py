"""Event-driven candle webhook alert pipeline (ingest → FIFO queue → sequential worker)."""

from .worker import get_pipeline_status, start_workers, stop_workers

__all__ = ["start_workers", "stop_workers", "get_pipeline_status"]
