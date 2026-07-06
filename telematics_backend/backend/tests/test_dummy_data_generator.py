import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import dummy_data as dd  # noqa: E402
import dummy_data_generator as gen  # noqa: E402


def _dates(n=15, start=date(2026, 6, 19)):
    return [start + timedelta(days=i) for i in range(n)]


def test_deterministic_for_same_bus_and_date():
    cfg = dd.BUS_CONFIGS[0]
    d = date(2026, 6, 20)
    r1 = gen.generate_day_record(cfg, d)
    r2 = gen.generate_day_record(cfg, d)
    assert r1 == r2


def test_different_dates_can_diverge():
    cfg = dd.BUS_CONFIGS[0]
    records = [gen.generate_day_record(cfg, d) for d in _dates(15)]
    scenarios = {r["scenario_type"] for r in records}
    assert len(scenarios) > 1, "15 days of one bus should show scenario variety, not a single repeated value"


def test_historical_records_skip_sunday():
    cfg = dd.BUS_CONFIGS[0]
    dates = _dates(15)
    records = gen.generate_historical_records(cfg, dates)
    sundays = [d for d in dates if d.weekday() == 6]
    assert len(records) == len(dates) - len(sundays)


def test_values_within_realistic_ranges():
    cfg = dd.BUS_CONFIGS[0]
    records = gen.generate_historical_records(cfg, _dates(30, start=date(2026, 5, 1)))
    for r in records:
        if r["status"] == "Cancelled":
            continue
        assert 0 <= r["speed_kmh"] <= 60
        assert 0 <= r["eta_min"] <= 90  # allows BREAKDOWN/MAJOR_DELAY beyond the 60 baseline
        assert 0 <= r["distance_km"] <= 40


def test_all_buses_have_scenario_and_note():
    for cfg in dd.BUS_CONFIGS:
        r = gen.generate_day_record(cfg, date(2026, 6, 25))
        assert r["scenario_type"] in gen.ALL_SCENARIOS
        assert r["scenario_note"]


def test_forecast_records_cover_requested_weekday_span():
    cfg = dd.BUS_CONFIGS[0]
    hist = gen.generate_historical_records(cfg, _dates(15))
    future = [date(2026, 7, 5) + timedelta(days=i) for i in range(7)]
    preds = gen.generate_forecast_records(cfg, hist, future)
    non_sundays = [d for d in future if d.weekday() != 6]
    assert len(preds) == len(non_sundays)
    for p in preds:
        assert 0 <= p["delay_probability"] <= 100
        assert 0 <= p["route_confidence"] <= 100


def test_bus_personalities_differ():
    """Bus A (reliable) should show a materially higher on-time rate than
    Bus B (bottleneck) over the same 15-day window."""
    dates = _dates(15)
    bus_a = dd.BUS_BY_ID["DUMMY01"]
    bus_b = dd.BUS_BY_ID["DUMMY02"]
    rec_a = gen.generate_historical_records(bus_a, dates)
    rec_b = gen.generate_historical_records(bus_b, dates)
    on_time_a = len([r for r in rec_a if r["status"] == "On Time"]) / len(rec_a)
    on_time_b = len([r for r in rec_b if r["status"] == "On Time"]) / len(rec_b)
    assert on_time_a > on_time_b
