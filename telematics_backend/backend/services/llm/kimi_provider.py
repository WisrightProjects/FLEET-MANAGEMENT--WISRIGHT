"""Kimi (Moonshot AI) implementation of LLMProvider — plain HTTP via
`requests` against the OpenAI-compatible chat completions endpoint. No SDK
dependency needed."""

from __future__ import annotations

import os

import requests

from services.llm.llm_provider import LLMProvider

DEFAULT_BASE_URL = "https://api.moonshot.ai/v1"
DEFAULT_MODEL = "moonshot-v1-8k"


class KimiProvider(LLMProvider):
    def __init__(self):
        self.api_key = os.environ.get("KIMI_API_KEY", "").strip()
        self.base_url = os.environ.get("KIMI_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
        self.model = os.environ.get("KIMI_MODEL", DEFAULT_MODEL)

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def generate_summary(self, prompt: str, timeout: float = 8.0) -> str:
        resp = requests.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": "You are a fleet operations analyst. Be concise and factual."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.4,
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
