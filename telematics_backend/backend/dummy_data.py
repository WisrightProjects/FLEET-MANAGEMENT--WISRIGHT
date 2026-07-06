"""Dummy fleet — 5 morning + 5 evening simulated buses (PRD: Bus Tracking &
Fleet Management). Fully isolated dev_id namespace (DUMMY01..DUMMY10), own
MySQL tables (dummy_history / dummy_predictions). Never reads/writes
`telemetry`, `stops_config`, `routes_config`, or any real-device table —
the real ESP32 bus (dev_id="BUS01") and the Bus Test panel are untouched.
"""

from __future__ import annotations

import time
from datetime import date, timedelta

import mysql.connector

import dummy_data_generator as gen

HIST_DAYS = 15
FORECAST_DAYS = 7

# ---------------------------------------------------------------------------
# Chennai suburb waypoints (approximate real-world coordinates)
# ---------------------------------------------------------------------------
PTS = {
    "Mogappair":      (13.0645, 80.1809),
    "Anna Nagar":      (13.0850, 80.2101),
    "Koyambedu":       (13.0694, 80.1948),
    "College":         (13.0108, 80.2338),
    "Avadi":           (13.1147, 80.0995),
    "Ambattur":        (13.1143, 80.1548),
    "Padi":            (13.1006, 80.1699),
    "Tambaram":        (12.9249, 80.1000),
    "Chromepet":       (12.9516, 80.1462),
    "Guindy":          (13.0067, 80.2206),
    "Poonamallee":     (13.0505, 80.0997),
    "Porur":           (13.0382, 80.1565),
    "Red Hills":       (13.1943, 80.1839),
    "Madhavaram":      (13.1489, 80.2273),
}


def _wp(*names):
    return [{"name": n, "lat": PTS[n][0], "lon": PTS[n][1]} for n in names]


# ---------------------------------------------------------------------------
# Bus personalities — scenario weight overrides layered on gen.DEFAULT_WEIGHTS
# ---------------------------------------------------------------------------
def _weights(**overrides):
    w = dict(gen.DEFAULT_WEIGHTS)
    w.update(overrides)
    return w

RELIABLE      = _weights(ON_TIME=65, MINOR_DELAY=15, MAJOR_DELAY=1, EARLY_ARRIVAL=12,
                          ROUTE_DEVIATION=1, BREAKDOWN=0, DRIVER_CHANGE=1,
                          WEATHER_SLOWDOWN=3, LOW_RIDERSHIP_SKIP=1, CANCELLED=0, GPS_SIGNAL_LOSS=1)
BOTTLENECK    = _weights(ON_TIME=15, MINOR_DELAY=42, MAJOR_DELAY=14, EARLY_ARRIVAL=3,
                          ROUTE_DEVIATION=5, BREAKDOWN=1, DRIVER_CHANGE=2,
                          WEATHER_SLOWDOWN=8, LOW_RIDERSHIP_SKIP=2, CANCELLED=1, GPS_SIGNAL_LOSS=6)
AVERAGE_PLUS_BREAKDOWN = _weights(ON_TIME=38, MINOR_DELAY=22, MAJOR_DELAY=6, EARLY_ARRIVAL=9,
                          ROUTE_DEVIATION=4, BREAKDOWN=6, DRIVER_CHANGE=4,
                          WEATHER_SLOWDOWN=6, LOW_RIDERSHIP_SKIP=3, CANCELLED=1, GPS_SIGNAL_LOSS=1)
WEATHER_SENSITIVE = _weights(ON_TIME=30, MINOR_DELAY=14, MAJOR_DELAY=5, EARLY_ARRIVAL=6,
                          ROUTE_DEVIATION=3, BREAKDOWN=1, DRIVER_CHANGE=2,
                          WEATHER_SLOWDOWN=32, LOW_RIDERSHIP_SKIP=3, CANCELLED=1, GPS_SIGNAL_LOSS=3)
MIXED_BAG     = _weights(ON_TIME=28, MINOR_DELAY=20, MAJOR_DELAY=8, EARLY_ARRIVAL=10,
                          ROUTE_DEVIATION=6, BREAKDOWN=3, DRIVER_CHANGE=5,
                          WEATHER_SLOWDOWN=8, LOW_RIDERSHIP_SKIP=5, CANCELLED=3, GPS_SIGNAL_LOSS=4)

BUS_COLORS = ["#3fb950", "#d29922", "#f85149", "#a5b4fc", "#ec4899",
              "#58a6ff", "#f97316", "#34d399", "#e879f9", "#facc15"]

BUS_CONFIGS = [
    # ── Morning (8am) — College-bound ──
    {"dev_id": "DUMMY01", "number": "Bus A", "trip": "8am", "route_name": "Mogappair - Anna Nagar - Koyambedu - College",
     "driver": "R. Selvam", "substitute_driver": "K. Bala",
     "waypoints": _wp("Mogappair", "Anna Nagar", "Koyambedu", "College"),
     "base_speed": 38.0, "base_eta": 35, "base_distance": 18.4, "base_departure": "07:45",
     "weights": RELIABLE},
    {"dev_id": "DUMMY02", "number": "Bus B", "trip": "8am", "route_name": "Avadi - Ambattur - Padi - College",
     "driver": "M. Karthik", "substitute_driver": "S. Ravi",
     "waypoints": _wp("Avadi", "Ambattur", "Padi", "College"),
     "base_speed": 32.0, "base_eta": 48, "base_distance": 26.1, "base_departure": "07:30",
     "weights": BOTTLENECK},
    {"dev_id": "DUMMY03", "number": "Bus C", "trip": "8am", "route_name": "Tambaram - Chromepet - Guindy - College",
     "driver": "P. Elango", "substitute_driver": "V. Suresh",
     "waypoints": _wp("Tambaram", "Chromepet", "Guindy", "College"),
     "base_speed": 40.0, "base_eta": 32, "base_distance": 20.7, "base_departure": "07:50",
     "weights": AVERAGE_PLUS_BREAKDOWN},
    {"dev_id": "DUMMY04", "number": "Bus D", "trip": "8am", "route_name": "Poonamallee - Porur - Koyambedu - College",
     "driver": "A. Ganesan", "substitute_driver": "T. Muthu",
     "waypoints": _wp("Poonamallee", "Porur", "Koyambedu", "College"),
     "base_speed": 36.0, "base_eta": 40, "base_distance": 22.3, "base_departure": "07:40",
     "weights": WEATHER_SENSITIVE},
    {"dev_id": "DUMMY05", "number": "Bus E", "trip": "8am", "route_name": "Red Hills - Madhavaram - Anna Nagar - College",
     "driver": "J. Anand", "substitute_driver": "D. Prakash",
     "waypoints": _wp("Red Hills", "Madhavaram", "Anna Nagar", "College"),
     "base_speed": 35.0, "base_eta": 45, "base_distance": 27.8, "base_departure": "07:35",
     "weights": MIXED_BAG},

    # ── Evening (3pm) — Return routes (mirrored) ──
    {"dev_id": "DUMMY06", "number": "Bus F", "trip": "3pm", "route_name": "College - Koyambedu - Anna Nagar - Mogappair",
     "driver": "R. Selvam", "substitute_driver": "K. Bala",
     "waypoints": _wp("College", "Koyambedu", "Anna Nagar", "Mogappair"),
     "base_speed": 37.0, "base_eta": 36, "base_distance": 18.4, "base_departure": "15:15",
     "weights": RELIABLE},
    {"dev_id": "DUMMY07", "number": "Bus G", "trip": "3pm", "route_name": "College - Padi - Ambattur - Avadi",
     "driver": "M. Karthik", "substitute_driver": "S. Ravi",
     "waypoints": _wp("College", "Padi", "Ambattur", "Avadi"),
     "base_speed": 30.0, "base_eta": 50, "base_distance": 26.1, "base_departure": "15:00",
     "weights": BOTTLENECK},
    {"dev_id": "DUMMY08", "number": "Bus H", "trip": "3pm", "route_name": "College - Guindy - Chromepet - Tambaram",
     "driver": "P. Elango", "substitute_driver": "V. Suresh",
     "waypoints": _wp("College", "Guindy", "Chromepet", "Tambaram"),
     "base_speed": 39.0, "base_eta": 33, "base_distance": 20.7, "base_departure": "15:20",
     "weights": AVERAGE_PLUS_BREAKDOWN},
    {"dev_id": "DUMMY09", "number": "Bus I", "trip": "3pm", "route_name": "College - Koyambedu - Porur - Poonamallee",
     "driver": "A. Ganesan", "substitute_driver": "T. Muthu",
     "waypoints": _wp("College", "Koyambedu", "Porur", "Poonamallee"),
     "base_speed": 35.0, "base_eta": 41, "base_distance": 22.3, "base_departure": "15:10",
     "weights": WEATHER_SENSITIVE},
    {"dev_id": "DUMMY10", "number": "Bus J", "trip": "3pm", "route_name": "College - Anna Nagar - Madhavaram - Red Hills",
     "driver": "J. Anand", "substitute_driver": "D. Prakash",
     "waypoints": _wp("College", "Anna Nagar", "Madhavaram", "Red Hills"),
     "base_speed": 34.0, "base_eta": 46, "base_distance": 27.8, "base_departure": "14:55",
     "weights": MIXED_BAG},
]

BUS_BY_ID = {c["dev_id"]: c for c in BUS_CONFIGS}
for _i, _cfg in enumerate(BUS_CONFIGS):
    _cfg["color"] = BUS_COLORS[_i % len(BUS_COLORS)]


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
def _connect(db_config: dict):
    return mysql.connector.connect(**db_config)


def init_dummy_db(db_config: dict) -> None:
    conn = _connect(db_config)
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS dummy_history (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                dev_id          VARCHAR(16)  NOT NULL,
                bus_number      VARCHAR(32)  NOT NULL,
                route_name      VARCHAR(128) NOT NULL,
                driver          VARCHAR(64)  NOT NULL,
                date            DATE         NOT NULL,
                lat             DOUBLE       NOT NULL,
                lon             DOUBLE       NOT NULL,
                speed_kmh       DOUBLE       NOT NULL,
                distance_km     DOUBLE       NOT NULL,
                eta_min         INT          NOT NULL,
                delay_min       INT          NOT NULL,
                departure_time  VARCHAR(5)   NOT NULL,
                arrival_time    VARCHAR(5)   NOT NULL,
                status          VARCHAR(20)  NOT NULL,
                scenario_type   VARCHAR(24)  NOT NULL,
                scenario_note   VARCHAR(255) NOT NULL,
                UNIQUE KEY uniq_bus_date (dev_id, date),
                INDEX idx_date (date)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS dummy_predictions (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                dev_id              VARCHAR(16)  NOT NULL,
                date                DATE         NOT NULL,
                predicted_departure VARCHAR(5)   NOT NULL,
                predicted_arrival   VARCHAR(5)   NOT NULL,
                predicted_eta_min   INT          NOT NULL,
                travel_duration_min INT          NOT NULL,
                avg_speed_kmh       DOUBLE       NOT NULL,
                delay_probability   INT          NOT NULL,
                expected_distance   DOUBLE       NOT NULL,
                route_confidence    INT          NOT NULL,
                UNIQUE KEY uniq_bus_date (dev_id, date),
                INDEX idx_dev (dev_id)
            )
        """)
        conn.commit()
        cur.close()
    finally:
        conn.close()


def seed_if_needed(db_config: dict) -> None:
    conn = _connect(db_config)
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM dummy_history")
        has_history = cur.fetchone()[0] > 0
        cur.execute("SELECT COUNT(*) FROM dummy_predictions")
        has_predictions = cur.fetchone()[0] > 0
        cur.close()

        today = date.today()
        hist_dates = [today - timedelta(days=n) for n in range(HIST_DAYS, 0, -1)]
        future_dates = [today + timedelta(days=n) for n in range(1, FORECAST_DAYS + 1)]

        if not has_history:
            cur = conn.cursor()
            for cfg in BUS_CONFIGS:
                for rec in gen.generate_historical_records(cfg, hist_dates):
                    cur.execute(
                        "INSERT IGNORE INTO dummy_history "
                        "(dev_id, bus_number, route_name, driver, date, lat, lon, speed_kmh, "
                        " distance_km, eta_min, delay_min, departure_time, arrival_time, status, "
                        " scenario_type, scenario_note) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (rec["dev_id"], rec["bus_number"], rec["route_name"], rec["driver"], rec["date"],
                         rec["lat"], rec["lon"], rec["speed_kmh"], rec["distance_km"], rec["eta_min"],
                         rec["delay_min"], rec["departure_time"], rec["arrival_time"], rec["status"],
                         rec["scenario_type"], rec["scenario_note"]),
                    )
            conn.commit()
            cur.close()

        if not has_predictions:
            cur = conn.cursor()
            for cfg in BUS_CONFIGS:
                cur.execute("SELECT * FROM dummy_history WHERE dev_id=%s ORDER BY date", (cfg["dev_id"],))
                cols = [d[0] for d in cur.description]
                hist_rows = [dict(zip(cols, row)) for row in cur.fetchall()]
                for rec in gen.generate_forecast_records(cfg, hist_rows, future_dates):
                    cur.execute(
                        "INSERT IGNORE INTO dummy_predictions "
                        "(dev_id, date, predicted_departure, predicted_arrival, predicted_eta_min, "
                        " travel_duration_min, avg_speed_kmh, delay_probability, expected_distance, "
                        " route_confidence) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (rec["dev_id"], rec["date"], rec["predicted_departure"], rec["predicted_arrival"],
                         rec["predicted_eta_min"], rec["travel_duration_min"], rec["avg_speed_kmh"],
                         rec["delay_probability"], rec["expected_distance"], rec["route_confidence"]),
                    )
            conn.commit()
            cur.close()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Frontend-facing helpers
# ---------------------------------------------------------------------------
def buses_meta() -> list:
    return [
        {
            "dev_id": c["dev_id"], "number": c["number"], "route_name": c["route_name"],
            "driver": c["driver"], "color": c["color"], "trip": c["trip"],
            "waypoints": c["waypoints"],
        }
        for c in BUS_CONFIGS
    ]


def _interp(a, b, t):
    return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t


def _route_position(cfg: dict, frac: float):
    """frac in [0,1) -> (lat, lon) interpolated along the waypoint polyline."""
    wps = cfg["waypoints"]
    n = len(wps) - 1
    if n <= 0:
        return wps[0]["lat"], wps[0]["lon"]
    seg_f = frac * n
    idx = min(int(seg_f), n - 1)
    local_t = seg_f - idx
    a = (wps[idx]["lat"], wps[idx]["lon"])
    b = (wps[idx + 1]["lat"], wps[idx + 1]["lon"])
    return _interp(a, b, local_t)


# Full loop (park -> depart -> arrive -> layover) per bus, in seconds.
_CYCLE_SECONDS = 22 * 60
_MOVING_FRACTION = 0.75  # bus is "in transit" for the first 75% of the cycle, then idles at destination


def all_live() -> list:
    now = time.time()
    out = []
    for cfg in BUS_CONFIGS:
        # Stagger each bus's cycle so they don't all start/stop in lockstep.
        offset = (hash(cfg["dev_id"]) % 997)
        t_in_cycle = (now + offset) % _CYCLE_SECONDS
        progress = t_in_cycle / _CYCLE_SECONDS

        if progress < _MOVING_FRACTION:
            frac = progress / _MOVING_FRACTION
            lat, lon = _route_position(cfg, frac)
            # Deterministic-ish jitter within realistic bounds, changes every 5s tick.
            tick_seed = int(now // 5) ^ hash(cfg["dev_id"])
            speed = cfg["base_speed"] + ((tick_seed % 11) - 5)
            speed = max(25.0, min(60.0, speed))
            status = "Moving"
            distance_covered = round(cfg["base_distance"] * frac, 1)
            eta_min = max(1, round(cfg["base_eta"] * (1 - frac)))
        else:
            lat, lon = cfg["waypoints"][-1]["lat"], cfg["waypoints"][-1]["lon"]
            speed = 0.0
            status = "Stopped"
            distance_covered = cfg["base_distance"]
            eta_min = 0

        out.append({
            "dev_id": cfg["dev_id"],
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "speed_kmh": round(speed, 1),
            "status": status,
            "distance_km": distance_covered,
            "eta_min": eta_min,
            "timestamp": now,
        })
    return out
