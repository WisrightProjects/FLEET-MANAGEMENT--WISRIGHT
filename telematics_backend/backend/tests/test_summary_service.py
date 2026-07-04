import json
import sys
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import summary_service  # noqa: E402


def _hist_rows():
    today = date(2026, 7, 3)
    return [
        {"date": today - timedelta(days=i), "delay_min": 2, "status": "On Time",
         "scenario_type": "ON_TIME", "scenario_note": "Trip completed on schedule, no incidents."}
        for i in range(1, 16)
    ]


def _pred_rows():
    today = date(2026, 7, 3)
    return [
        {"date": today + timedelta(days=i), "delay_probability": 15, "route_confidence": 95,
         "avg_speed_kmh": 42.0, "expected_distance": 18.0}
        for i in range(1, 8)
    ]


def test_no_api_key_uses_fallback(monkeypatch):
    monkeypatch.delenv("KIMI_API_KEY", raising=False)
    summary_service._cache.clear()
    result = summary_service.get_historical_summary("DUMMY01", "Bus A", "Test Route", _hist_rows())
    assert result["source"] == "fallback"
    assert "summary" in result


def test_mocked_kimi_success_never_calls_real_api(monkeypatch):
    monkeypatch.setenv("KIMI_API_KEY", "fake-key-for-test")
    summary_service._cache.clear()
    fake_response = json.dumps({
        "summary": "Bus A is reliable.",
        "notableEvents": ["No major incidents."],
        "recommendation": "Keep current schedule.",
    })
    with patch("services.llm.kimi_provider.KimiProvider.generate_summary", return_value=fake_response) as mocked:
        result = summary_service.get_historical_summary("DUMMY01", "Bus A", "Test Route", _hist_rows())
        assert mocked.called
    assert result["source"] == "kimi"
    assert result["summary"] == "Bus A is reliable."


def test_kimi_failure_falls_back(monkeypatch):
    monkeypatch.setenv("KIMI_API_KEY", "fake-key-for-test")
    summary_service._cache.clear()
    with patch("services.llm.kimi_provider.KimiProvider.generate_summary", side_effect=TimeoutError("boom")):
        result = summary_service.get_historical_summary("DUMMY02", "Bus B", "Test Route", _hist_rows())
    assert result["source"] == "fallback"


def test_forecast_summary_uses_both_stats_blocks(monkeypatch):
    monkeypatch.delenv("KIMI_API_KEY", raising=False)
    summary_service._cache.clear()
    result = summary_service.get_forecast_summary(
        "DUMMY01", "Bus A", "Test Route", _hist_rows(), _pred_rows()
    )
    assert result["source"] == "fallback"
    assert "summary" in result


def test_cache_returns_same_object_without_recalling_llm(monkeypatch):
    monkeypatch.setenv("KIMI_API_KEY", "fake-key-for-test")
    summary_service._cache.clear()
    fake_response = json.dumps({"summary": "x", "notableEvents": [], "recommendation": "y"})
    with patch("services.llm.kimi_provider.KimiProvider.generate_summary", return_value=fake_response) as mocked:
        r1 = summary_service.get_historical_summary("DUMMY03", "Bus C", "Test Route", _hist_rows())
        r2 = summary_service.get_historical_summary("DUMMY03", "Bus C", "Test Route", _hist_rows())
        assert mocked.call_count == 1
    assert r1 == r2
