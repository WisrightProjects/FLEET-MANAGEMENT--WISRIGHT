"""Provider-agnostic LLM interface. Swap providers by implementing this
class and pointing services.summary_service.get_provider() at it — a
one-line change, no caller changes needed."""

from __future__ import annotations

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    @abstractmethod
    def is_configured(self) -> bool:
        """True if credentials are present (no network call)."""

    @abstractmethod
    def generate_summary(self, prompt: str, timeout: float = 8.0) -> str:
        """Returns the raw text completion. Raises on failure/timeout —
        callers are responsible for retry/fallback handling."""
