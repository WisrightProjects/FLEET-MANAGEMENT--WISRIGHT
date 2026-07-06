"""Pure, deterministic-but-varied generator for the dummy fleet's historical
and forecast records. No I/O, no DB, no Flask — testable in isolation.

Scenario model
--------------
Each historical day-record for a bus is assigned one SCENARIO (weighted by
that bus's "personality" — see dummy_data.BUS_PERSONALITIES) which drives the
realistic ranges for speed/delay/status and a human-readable scenario_note.

Determinism
-----------
generate_historical_records(cfg, dates) and generate_forecast_records(...)
never call the global `random` module — every record is derived from a
`random.Random(seed)` instance seeded from (dev_id, date), so calling the
generator twice for the same bus+date always returns identical output.
"""

from __future__ import annotations

import random
from datetime import date as date_cls, timedelta

# ---------------------------------------------------------------------------
# Scenario catalogue
# ---------------------------------------------------------------------------
ON_TIME             = "ON_TIME"
MINOR_DELAY         = "MINOR_DELAY"
MAJOR_DELAY         = "MAJOR_DELAY"
EARLY_ARRIVAL       = "EARLY_ARRIVAL"
ROUTE_DEVIATION     = "ROUTE_DEVIATION"
BREAKDOWN           = "BREAKDOWN"
DRIVER_CHANGE       = "DRIVER_CHANGE"
WEATHER_SLOWDOWN    = "WEATHER_SLOWDOWN"
LOW_RIDERSHIP_SKIP  = "LOW_RIDERSHIP_SKIP"
CANCELLED           = "CANCELLED"
GPS_SIGNAL_LOSS     = "GPS_SIGNAL_LOSS"

ALL_SCENARIOS = [
    ON_TIME, MINOR_DELAY, MAJOR_DELAY, EARLY_ARRIVAL, ROUTE_DEVIATION,
    BREAKDOWN, DRIVER_CHANGE, WEATHER_SLOWDOWN, LOW_RIDERSHIP_SKIP,
    CANCELLED, GPS_SIGNAL_LOSS,
]

# Baseline weights — overridden per-bus by BUS_PERSONALITIES in dummy_data.py.
# CANCELLED is deliberately rare (~1 in 30 -> weight kept low relative to total).
DEFAULT_WEIGHTS = {
    ON_TIME:            40,
    MINOR_DELAY:        22,
    MAJOR_DELAY:        6,
    EARLY_ARRIVAL:      10,
    ROUTE_DEVIATION:    4,
    BREAKDOWN:          1,
    DRIVER_CHANGE:      3,
    WEATHER_SLOWDOWN:   8,
    LOW_RIDERSHIP_SKIP: 4,
    CANCELLED:          1,
    GPS_SIGNAL_LOSS:    3,
}

_ALT_PATHS = [
    "diverted via Anna Nagar 2nd Ave (main road blocked)",
    "diverted via Poonamallee bypass (water-logging)",
    "diverted via inner ring road (protest march on main route)",
]
_BREAKDOWN_CAUSES = ["engine overheating", "flat tyre", "brake fluid leak", "alternator fault"]
_TRAFFIC_SPOTS = ["Koyambedu junction", "Anna Nagar roundabout", "Porur signal", "Tambaram bridge",
                   "Ambattur estate road", "Guindy flyover", "Red Hills junction"]
_WEATHER = ["heavy rain", "dense morning fog", "waterlogged underpass", "thunderstorm"]


def _seeded_rng(dev_id: str, on_date: date_cls, salt: str = "") -> random.Random:
    """One RNG per (bus, date[, salt]) — same inputs always produce the same
    record, different inputs (any bus, any date) diverge."""
    key = f"{dev_id}:{on_date.isoformat()}:{salt}"
    return random.Random(hash(key) & 0xFFFFFFFF)


def pick_scenario(rng: random.Random, weights: dict, *, is_weekend: bool) -> str:
    w = dict(weights)
    if is_weekend:
        # Lighter traffic on Saturday — delays are less likely, ON_TIME more likely.
        w[ON_TIME] = w.get(ON_TIME, 0) + 15
        w[MINOR_DELAY] = max(1, w.get(MINOR_DELAY, 0) - 8)
        w[MAJOR_DELAY] = max(0, w.get(MAJOR_DELAY, 0) - 3)
    scenarios = list(w.keys())
    tally = [max(0, w[s]) for s in scenarios]
    return rng.choices(scenarios, weights=tally, k=1)[0]


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _build_scenario_values(scenario: str, rng: random.Random, base_speed: float,
                            base_eta: int, base_distance: float):
    """Returns (speed_kmh, eta_min, delay_min, status, note, distance_km)."""
    speed, eta, distance = base_speed, base_eta, base_distance
    delay = 0
    note = ""
    status = "On Time"

    if scenario == ON_TIME:
        delay = rng.randint(0, 1)
        status = "On Time"
        note = "Trip completed on schedule, no incidents."

    elif scenario == MINOR_DELAY:
        delay = rng.randint(2, 10)
        spot = rng.choice(_TRAFFIC_SPOTS)
        speed = _clamp(speed - rng.uniform(3, 8), 25, 60)
        status = "Delayed"
        note = f"{delay} min delay due to traffic near {spot}."

    elif scenario == MAJOR_DELAY:
        delay = rng.randint(15, 30)
        cause = rng.choice(["roadwork", "accident ahead", "VIP movement diversion", "protest blocking main road"])
        speed = _clamp(speed - rng.uniform(10, 20), 15, 60)
        status = "Delayed"
        note = f"{delay} min delay due to {cause}."

    elif scenario == EARLY_ARRIVAL:
        delay = -rng.randint(2, 6)
        speed = _clamp(speed + rng.uniform(3, 8), 25, 60)
        status = "Early"
        note = f"Arrived {abs(delay)} min early — light traffic throughout."

    elif scenario == ROUTE_DEVIATION:
        delay = rng.randint(5, 15)
        alt = rng.choice(_ALT_PATHS)
        distance = round(distance + rng.uniform(1.5, 4.0), 1)
        status = "Delayed"
        note = f"Route deviation — {alt}."

    elif scenario == BREAKDOWN:
        delay = rng.randint(25, 45)
        cause = rng.choice(_BREAKDOWN_CAUSES)
        downtime = rng.randint(15, 35)
        speed = 0.0
        status = "Breakdown"
        note = (f"Breakdown ({cause}) — stopped for {downtime} min, "
                f"replacement bus dispatched, total delay {delay} min.")

    elif scenario == DRIVER_CHANGE:
        delay = rng.randint(3, 12)
        handover_min = rng.randint(5, 10)
        status = "Delayed" if delay > 5 else "On Time"
        note = f"Substitute driver handover at midpoint stop, {handover_min} min changeover."

    elif scenario == WEATHER_SLOWDOWN:
        delay = rng.randint(8, 20)
        weather = rng.choice(_WEATHER)
        speed = _clamp(speed - rng.uniform(12, 22), 15, 60)
        status = "Delayed"
        note = f"Reduced speed due to {weather}, {delay} min delay."

    elif scenario == LOW_RIDERSHIP_SKIP:
        delay = -rng.randint(1, 4)
        skipped = rng.choice(["Mid-route optional stop", "Secondary stop", "Loop-road stop"])
        status = "Early" if delay < 0 else "On Time"
        note = f"{skipped} skipped — no passengers waiting, saved {abs(delay)} min."

    elif scenario == CANCELLED:
        delay = 0
        speed = 0.0
        eta = 0
        distance = 0.0
        status = "Cancelled"
        cause = rng.choice(["mechanical inspection failure", "driver unavailability", "route flooding"])
        note = f"Trip cancelled — {cause}."

    elif scenario == GPS_SIGNAL_LOSS:
        delay = rng.randint(1, 6)
        gap_min = rng.randint(3, 8)
        status = "Delayed" if delay > 2 else "On Time"
        note = f"GPS signal lost for {gap_min} min (tunnel/multi-level flyover), tracking resumed automatically."

    else:  # pragma: no cover - defensive
        note = "Unclassified scenario."

    eta = max(0, eta + delay) if scenario != CANCELLED else 0
    return round(speed, 1), eta, delay, status, note, round(distance, 1)


def generate_day_record(cfg: dict, on_date: date_cls) -> dict:
    """cfg needs: dev_id, number, route_name, driver, base_speed, base_eta,
    base_distance, base_departure ('HH:MM'), weights (scenario -> weight)."""
    rng = _seeded_rng(cfg["dev_id"], on_date)
    is_weekend = on_date.weekday() == 5  # Saturday (Sunday has no service)

    scenario = pick_scenario(rng, cfg.get("weights", DEFAULT_WEIGHTS), is_weekend=is_weekend)
    speed, eta, delay, status, note, distance = _build_scenario_values(
        scenario, rng, cfg["base_speed"], cfg["base_eta"], cfg["base_distance"]
    )

    dep_h, dep_m = (int(x) for x in cfg["base_departure"].split(":"))
    departure_min_offset = rng.randint(-1, 2) if scenario != CANCELLED else 0
    dep_total = dep_h * 60 + dep_m + departure_min_offset
    arr_total = dep_total + eta if scenario != CANCELLED else dep_total

    driver = cfg["driver"]
    if scenario == DRIVER_CHANGE:
        driver = cfg.get("substitute_driver", "Substitute Driver")

    lat, lon = cfg["waypoints"][-1]["lat"], cfg["waypoints"][-1]["lon"]

    return {
        "dev_id": cfg["dev_id"],
        "bus_number": cfg["number"],
        "route_name": cfg["route_name"],
        "driver": driver,
        "date": on_date,
        "lat": lat,
        "lon": lon,
        "speed_kmh": speed,
        "distance_km": distance if distance else cfg["base_distance"],
        "eta_min": eta,
        "delay_min": delay,
        "departure_time": f"{dep_total // 60:02d}:{dep_total % 60:02d}",
        "arrival_time": f"{arr_total // 60:02d}:{arr_total % 60:02d}" if scenario != CANCELLED else "--:--",
        "status": status,
        "scenario_type": scenario,
        "scenario_note": note,
    }


def generate_historical_records(cfg: dict, dates: list[date_cls]) -> list[dict]:
    """Skips Sundays (no service) — mirrors the homepage's Sunday-leave rule."""
    return [generate_day_record(cfg, d) for d in dates if d.weekday() != 6]


# ---------------------------------------------------------------------------
# Forecast (next 5-10 days) — simple statistical projection from history
# ---------------------------------------------------------------------------
def generate_forecast_records(cfg: dict, historical: list[dict], future_dates: list[date_cls]) -> list[dict]:
    usable = [r for r in historical if r["status"] != "Cancelled"]
    avg_delay = sum(r["delay_min"] for r in usable) / len(usable) if usable else 2.0
    avg_speed = sum(r["speed_kmh"] for r in usable) / len(usable) if usable else cfg["base_speed"]
    on_time_pct = (len([r for r in usable if r["status"] in ("On Time", "Early")]) / len(usable) * 100
                   ) if usable else 90.0
    delay_scenarios = len([r for r in historical if r["scenario_type"] in
                            (MINOR_DELAY, MAJOR_DELAY, WEATHER_SLOWDOWN, ROUTE_DEVIATION, BREAKDOWN)])
    delay_probability_base = _clamp(round((delay_scenarios / max(1, len(historical))) * 100), 5, 90)

    out = []
    for i, d in enumerate(future_dates):
        if d.weekday() == 6:  # no Sunday service
            continue
        rng = _seeded_rng(cfg["dev_id"], d, salt="forecast")
        drift = rng.uniform(-1.5, 1.5)
        predicted_delay = max(0, round(avg_delay + drift, 1))
        predicted_speed = _clamp(round(avg_speed + rng.uniform(-2, 2), 1), 25, 60)
        delay_prob = _clamp(round(delay_probability_base + rng.uniform(-8, 8)), 3, 95)
        # Confidence decays slightly the further out the forecast, plus per-bus reliability
        confidence = _clamp(round(on_time_pct - i * 1.5 + rng.uniform(-3, 3)), 55, 99)

        dep_h, dep_m = (int(x) for x in cfg["base_departure"].split(":"))
        dep_total = dep_h * 60 + dep_m
        eta = max(cfg["base_eta"] - 5, cfg["base_eta"] + int(predicted_delay))
        arr_total = dep_total + eta

        out.append({
            "dev_id": cfg["dev_id"],
            "date": d,
            "predicted_departure": f"{dep_total // 60:02d}:{dep_total % 60:02d}",
            "predicted_arrival": f"{arr_total // 60:02d}:{arr_total % 60:02d}",
            "predicted_eta_min": eta,
            "travel_duration_min": eta,
            "avg_speed_kmh": predicted_speed,
            "delay_probability": delay_prob,
            "expected_distance": cfg["base_distance"],
            "route_confidence": confidence,
        })
    return out
