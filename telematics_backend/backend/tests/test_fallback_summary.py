import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.fallback_summary import fallback_forecast_summary, fallback_historical_summary  # noqa: E402


HIST_STATS = {
    "bus_number": "Bus A",
    "route_name": "Mogappair - Anna Nagar - Koyambedu - College",
    "days": 15,
    "on_time_pct": 90,
    "avg_delay_min": 2.1,
    "worst_day": {"date": "2026-06-20", "delay_min": 8, "scenario_note": "Minor traffic delay"},
    "scenario_counts": {"ON_TIME": 12, "MINOR_DELAY": 3},
    "avg_delay_by_scenario": {"ON_TIME": 0.0, "MINOR_DELAY": 6.0},
}

PRED_STATS = {
    "days": 7,
    "avg_delay_probability": 20,
    "avg_confidence": 92,
    "avg_speed_kmh": 42.5,
    "avg_distance_km": 15.2,
}


def test_fallback_historical_summary_no_api_key_needed():
    result = fallback_historical_summary(HIST_STATS)
    assert "summary" in result and result["summary"]
    assert isinstance(result["notableEvents"], list)
    assert "recommendation" in result and result["recommendation"]


def test_fallback_historical_summary_reflects_low_reliability():
    bad_stats = dict(HIST_STATS, on_time_pct=40, avg_delay_min=15.0)
    result = fallback_historical_summary(bad_stats)
    assert "inconsistent" in result["summary"]


def test_fallback_forecast_summary_no_api_key_needed():
    result = fallback_forecast_summary(HIST_STATS, PRED_STATS)
    assert "summary" in result and result["summary"]
    assert isinstance(result["notableEvents"], list)
    assert "recommendation" in result and result["recommendation"]


def test_fallback_forecast_summary_flags_high_delay_probability():
    risky_pred = dict(PRED_STATS, avg_delay_probability=70)
    result = fallback_forecast_summary(HIST_STATS, risky_pred)
    assert "bottleneck" in result["recommendation"].lower() or "review" in result["recommendation"].lower()
