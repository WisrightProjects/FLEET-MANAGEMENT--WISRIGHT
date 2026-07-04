"""Orchestrates AI-insight generation for the dummy fleet:
- Compresses raw historical/prediction rows into a compact stats block
  (token-efficient — never dumps raw JSON rows into the prompt).
- Builds the two prompt templates (historical / forecast).
- Calls the configured LLMProvider with retry+backoff and an explicit
  timeout, caches results per (dev_id, kind, data-hash) for 24h, falls back
  to the rule-based generator on any failure, and staggers/limits
  concurrent calls so a page-load burst for 10 buses doesn't fire 10
  simultaneous requests.
"""

import hashlib
import json
import logging
import threading
import time

from services.fallback_summary import fallback_forecast_summary, fallback_historical_summary
from services.llm.kimi_provider import KimiProvider
from services.llm.llm_provider import LLMProvider

log = logging.getLogger("summary_service")

_CACHE_TTL_SECONDS = 24 * 60 * 60
_cache: dict = {}
_cache_lock = threading.Lock()

# Limits how many Kimi calls run at once; extra callers queue briefly rather
# than firing simultaneously (protects against a 10-bus page-load burst).
_MAX_CONCURRENT_CALLS = 3
_call_semaphore = threading.Semaphore(_MAX_CONCURRENT_CALLS)
_STAGGER_SECONDS = 0.2

_RETRIES = 2
_BACKOFF_BASE = 0.6  # seconds; exponential: 0.6, 1.2


def get_provider() -> LLMProvider:
    """Factory — swap to a different provider here (one-line change)."""
    return KimiProvider()


# ---------------------------------------------------------------------------
# Stats compression
# ---------------------------------------------------------------------------
def build_historical_stats(rows: list, bus_number: str, route_name: str) -> dict:
    usable = [r for r in rows if r["status"] != "Cancelled"]
    total = len(rows)
    on_time = len([r for r in usable if r["status"] in ("On Time", "Early")])
    on_time_pct = round((on_time / total) * 100) if total else 0
    avg_delay = round(sum(r["delay_min"] for r in usable) / len(usable), 1) if usable else 0.0

    scenario_counts: dict = {}
    delay_by_scenario: dict = {}
    for r in rows:
        st = r.get("scenario_type") or "ON_TIME"
        scenario_counts[st] = scenario_counts.get(st, 0) + 1
        delay_by_scenario.setdefault(st, []).append(r["delay_min"])

    worst = max(rows, key=lambda r: r["delay_min"], default=None)
    worst_day = {
        "date": str(worst["date"]) if worst else None,
        "delay_min": worst["delay_min"] if worst else 0,
        "scenario_note": worst.get("scenario_note") or "" if worst else "",
    }

    return {
        "bus_number": bus_number,
        "route_name": route_name,
        "days": total,
        "on_time_pct": on_time_pct,
        "avg_delay_min": avg_delay,
        "worst_day": worst_day,
        "scenario_counts": scenario_counts,
        "avg_delay_by_scenario": {
            k: round(sum(v) / len(v), 1) for k, v in delay_by_scenario.items()
        },
    }


def build_prediction_stats(rows: list) -> dict:
    total = len(rows)
    avg_delay_prob = round(sum(r["delay_probability"] for r in rows) / total) if total else 0
    avg_conf = round(sum(r["route_confidence"] for r in rows) / total) if total else 0
    avg_speed = round(sum(r["avg_speed_kmh"] for r in rows) / total, 1) if total else 0.0
    avg_distance = round(sum(r["expected_distance"] for r in rows) / total, 1) if total else 0.0
    return {
        "days": total,
        "avg_delay_probability": avg_delay_prob,
        "avg_confidence": avg_conf,
        "avg_speed_kmh": avg_speed,
        "avg_distance_km": avg_distance,
    }


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------
_JSON_SCHEMA_NOTE = (
    'Respond with ONLY a JSON object of exactly this shape (no markdown, no commentary): '
    '{"summary": "2-4 sentence narrative", "notableEvents": ["short bullet", ...], '
    '"recommendation": "one actionable sentence"}'
)


def build_historical_prompt(stats: dict) -> str:
    return (
        f"Fleet bus {stats['bus_number']} on route \"{stats['route_name']}\" over the last "
        f"{stats['days']} days:\n"
        f"- On-time rate: {stats['on_time_pct']}%\n"
        f"- Average delay: {stats['avg_delay_min']} min\n"
        f"- Worst day: {stats['worst_day']['date']} ({stats['worst_day']['delay_min']} min delay, "
        f"{stats['worst_day']['scenario_note']})\n"
        f"- Scenario counts: {json.dumps(stats['scenario_counts'])}\n"
        f"- Avg delay by scenario: {json.dumps(stats['avg_delay_by_scenario'])}\n\n"
        "Write a concise reliability narrative for a fleet operations dashboard. "
        + _JSON_SCHEMA_NOTE
    )


def build_forecast_prompt(stats: dict, pred_stats: dict) -> str:
    return (
        f"Fleet bus {stats['bus_number']} on route \"{stats['route_name']}\". "
        f"Historical context (last {stats['days']} days): on-time rate {stats['on_time_pct']}%, "
        f"avg delay {stats['avg_delay_min']} min, scenario counts {json.dumps(stats['scenario_counts'])}.\n"
        f"Forecast for the next {pred_stats['days']} days: avg delay probability "
        f"{pred_stats['avg_delay_probability']}%, avg route confidence {pred_stats['avg_confidence']}%, "
        f"avg speed {pred_stats['avg_speed_kmh']} km/h, avg distance {pred_stats['avg_distance_km']} km.\n\n"
        "Write a forward-looking narrative with a clear recommendation for a fleet operations dashboard. "
        + _JSON_SCHEMA_NOTE
    )


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
def _cache_key(dev_id: str, kind: str, stats: dict, pred_stats) -> str:
    payload = json.dumps({"stats": stats, "pred_stats": pred_stats}, sort_keys=True, default=str)
    digest = hashlib.sha256(payload.encode()).hexdigest()[:16]
    return f"{dev_id}:{kind}:{digest}"


def _get_cached(key: str):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and entry["expires_at"] > time.time():
            return entry["value"]
        return None


def _set_cached(key: str, value: dict):
    with _cache_lock:
        _cache[key] = {"value": value, "expires_at": time.time() + _CACHE_TTL_SECONDS}


# ---------------------------------------------------------------------------
# LLM call with retry/backoff, semaphore-limited concurrency, JSON parsing
# ---------------------------------------------------------------------------
def _call_llm_with_retry(prompt: str):
    provider = get_provider()
    if not provider.is_configured():
        return None

    acquired = _call_semaphore.acquire(timeout=10)
    if not acquired:
        log.warning("LLM call queue full — falling back to rule-based summary")
        return None
    try:
        time.sleep(_STAGGER_SECONDS)  # small stagger even once a slot is free
        last_err = None
        for attempt in range(_RETRIES + 1):
            try:
                raw = provider.generate_summary(prompt, timeout=8.0)
                cleaned = raw.strip()
                if cleaned.startswith("```"):
                    cleaned = cleaned.strip("`")
                    if cleaned.lower().startswith("json"):
                        cleaned = cleaned[4:]
                parsed = json.loads(cleaned)
                if all(k in parsed for k in ("summary", "notableEvents", "recommendation")):
                    return parsed
                log.warning("Kimi response missing expected keys: %s", list(parsed.keys()))
                return None
            except Exception as e:  # noqa: BLE001 — deliberately broad: network/timeout/parse errors all fall back
                last_err = e
                if attempt < _RETRIES:
                    time.sleep(_BACKOFF_BASE * (2 ** attempt))
        log.warning("Kimi summary generation failed after %d attempt(s): %s", _RETRIES + 1, last_err)
        return None
    finally:
        _call_semaphore.release()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def get_historical_summary(dev_id: str, bus_number: str, route_name: str, rows: list,
                            force_regenerate: bool = False) -> dict:
    stats = build_historical_stats(rows, bus_number, route_name)
    key = _cache_key(dev_id, "historical", stats, None)

    if not force_regenerate:
        cached = _get_cached(key)
        if cached:
            return cached

    prompt = build_historical_prompt(stats)
    result = _call_llm_with_retry(prompt)
    if result is None:
        result = fallback_historical_summary(stats)
        result["source"] = "fallback"
    else:
        result["source"] = "kimi"

    _set_cached(key, result)
    return result


def get_forecast_summary(dev_id: str, bus_number: str, route_name: str, hist_rows: list,
                          pred_rows: list, force_regenerate: bool = False) -> dict:
    stats = build_historical_stats(hist_rows, bus_number, route_name)
    pred_stats = build_prediction_stats(pred_rows)
    key = _cache_key(dev_id, "forecast", stats, pred_stats)

    if not force_regenerate:
        cached = _get_cached(key)
        if cached:
            return cached

    prompt = build_forecast_prompt(stats, pred_stats)
    result = _call_llm_with_retry(prompt)
    if result is None:
        result = fallback_forecast_summary(stats, pred_stats)
        result["source"] = "fallback"
    else:
        result["source"] = "kimi"

    _set_cached(key, result)
    return result
