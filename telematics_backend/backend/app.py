"""
IoT Smart Vehicle Telematics Backend — Module 4
Flask + MySQL + ngrok tunnel for SIM-card ESP32 devices.
All stops and routes are DB-configured — no hardcoded coordinates.
Real device data only; simulation removed.
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import mysql.connector
import time
import math
import os
import json
import queue
import threading

import dummy_data
from services import summary_service

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Load .env (never hardcode credentials)
# ---------------------------------------------------------------------------

def _load_env():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

_load_env()

DB_CONFIG = {
    "host":     os.environ.get("MYSQL_HOST",     "localhost"),
    "user":     os.environ.get("MYSQL_USER",     "root"),
    "password": os.environ.get("MYSQL_PASSWORD", ""),
    "database": os.environ.get("MYSQL_DATABASE", "telematics"),
}

DEVICE_TOKEN  = os.environ.get("DEVICE_TOKEN", "")
NGROK_TOKEN   = os.environ.get("NGROK_AUTHTOKEN", "")

# How long (s) with no telemetry before a device is considered offline, how
# close (m) / how long (s) the bus must dwell to count as an auto-detected stop.
OFFLINE_TIMEOUT_SEC   = float(os.environ.get("OFFLINE_TIMEOUT_SEC",   "45"))
AUTO_STOP_RADIUS_M    = float(os.environ.get("AUTO_STOP_RADIUS_M",    "60"))
AUTO_STOP_MIN_SEC     = float(os.environ.get("AUTO_STOP_MIN_SEC",     "120"))
OFFLINE_POLL_SEC      = float(os.environ.get("OFFLINE_POLL_SEC",      "5"))

# ---------------------------------------------------------------------------
# Rate limiting — token bucket, 2 req/s per device
# ---------------------------------------------------------------------------

_rate_buckets: dict = {}
_RATE_MAX     = 2.0
_RATE_REFILL  = 2.0
_rate_lock    = threading.Lock()


def _check_rate(dev_id: str) -> bool:
    now = time.time()
    with _rate_lock:
        if dev_id not in _rate_buckets:
            _rate_buckets[dev_id] = {"tokens": _RATE_MAX, "last": now}
        b = _rate_buckets[dev_id]
        elapsed = now - b["last"]
        b["tokens"] = min(_RATE_MAX, b["tokens"] + elapsed * _RATE_REFILL)
        b["last"] = now
        if b["tokens"] >= 1.0:
            b["tokens"] -= 1.0
            return True
        return False


# ---------------------------------------------------------------------------
# In-memory caches for stops & routes (refreshed from DB every 60 s)
# ---------------------------------------------------------------------------

_stops_cache: list | None  = None
_stops_ts:    float        = 0.0
_routes_cache: dict | None = None
_routes_ts:   float        = 0.0
_CACHE_TTL = 60.0
_cache_lock = threading.Lock()


def _invalidate_stops():
    global _stops_cache, _stops_ts
    with _cache_lock:
        _stops_cache = None; _stops_ts = 0.0


def _invalidate_routes():
    global _routes_cache, _routes_ts
    with _cache_lock:
        _routes_cache = None; _routes_ts = 0.0


def _get_stops() -> list:
    """Return list of stop dicts from DB (cached 60 s)."""
    global _stops_cache, _stops_ts
    now = time.time()
    with _cache_lock:
        if _stops_cache is not None and now - _stops_ts < _CACHE_TTL:
            return _stops_cache
    rows = query("SELECT id, name, lat, lon, radius_m FROM stops_config ORDER BY id")
    with _cache_lock:
        _stops_cache = rows or []
        _stops_ts = now
    return _stops_cache


def _get_routes() -> dict:
    """Return dict of route_key -> route config from DB (cached 60 s)."""
    global _routes_cache, _routes_ts
    now = time.time()
    with _cache_lock:
        if _routes_cache is not None and now - _routes_ts < _CACHE_TTL:
            return _routes_cache
    routes = query("SELECT * FROM routes_config")
    result = {}
    for r in routes:
        stops = query(
            "SELECT stop_name, lat, lon FROM route_stops WHERE route_id=%s ORDER BY seq_order",
            (r["id"],),
        )
        result[r["route_key"]] = {
            "name":                   r["name"],
            "mandatory_stops":        [{"name": s["stop_name"], "lat": s["lat"], "lon": s["lon"]} for s in stops],
            "geofence_radius_m":      r["geofence_radius_m"],
            "off_route_threshold_m":  r["off_route_threshold_m"],
        }
    with _cache_lock:
        _routes_cache = result
        _routes_ts = now
    return result


# ---------------------------------------------------------------------------
# In-memory trip/geofence state
# ---------------------------------------------------------------------------

_active_at: dict         = {}   # dev_id → geofence state
_active_trips: dict      = {}   # dev_id → active trip state
_in_mandatory_stop: dict = {}   # (trip_id, stop_name) → state

# ---------------------------------------------------------------------------
# Device online/offline state (server-side, timeout-driven) + SSE fanout
# ---------------------------------------------------------------------------

_device_status: dict      = {}   # dev_id → {"status": "online"/"offline", "last_seen": ts}
_status_lock              = threading.Lock()
_status_subscribers: list = []   # list[queue.Queue] — one per open /device/status/stream
_status_subs_lock         = threading.Lock()
_watcher_started          = False

# ---------------------------------------------------------------------------
# ngrok public URL (set at startup if NGROK_AUTHTOKEN is configured)
# ---------------------------------------------------------------------------

_ngrok_url: str = ""


def _start_ngrok(port: int = 5000) -> str:
    """Create a stable public HTTPS tunnel using the official ngrok Python SDK.
    Uses ngrok.forward() — no binary download, no Windows Defender interference.
    Requires:  pip install ngrok
    """
    if not NGROK_TOKEN:
        return ""
    try:
        import ngrok as _ngrok
        listener = _ngrok.forward(port, authtoken=NGROK_TOKEN)
        url = listener.url()
        if url and url.startswith("http://"):
            url = "https://" + url[7:]
        return url or ""
    except Exception as e:
        print(f"  [ngrok] SDK tunnel failed: {e}")
        return ""


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    return mysql.connector.connect(**DB_CONFIG)


def query(sql, params=(), fetch="all"):
    conn = get_db()
    cur  = None
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(sql, params)
        return cur.fetchall() if fetch == "all" else cur.fetchone()
    finally:
        if cur:  cur.close()
        conn.close()


def execute(sql, params=(), lastrowid=False):
    conn = get_db()
    cur  = None
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        conn.commit()
        return cur.lastrowid if lastrowid else None
    finally:
        if cur:  cur.close()
        conn.close()


def init_db():
    cfg = {k: v for k, v in DB_CONFIG.items() if k != "database"}
    conn = mysql.connector.connect(**cfg)
    cur  = None
    try:
        cur = conn.cursor()
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{DB_CONFIG['database']}`")
        cur.execute(f"USE `{DB_CONFIG['database']}`")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS stops_config (
                id       INT AUTO_INCREMENT PRIMARY KEY,
                name     VARCHAR(128) NOT NULL UNIQUE,
                lat      DOUBLE       NOT NULL,
                lon      DOUBLE       NOT NULL,
                radius_m INT          NOT NULL DEFAULT 300
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS routes_config (
                id                    INT AUTO_INCREMENT PRIMARY KEY,
                route_key             VARCHAR(64)  NOT NULL UNIQUE,
                name                  VARCHAR(128) NOT NULL,
                geofence_radius_m     INT          NOT NULL DEFAULT 300,
                off_route_threshold_m INT          NOT NULL DEFAULT 600
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS route_stops (
                id        INT AUTO_INCREMENT PRIMARY KEY,
                route_id  INT          NOT NULL,
                stop_name VARCHAR(128) NOT NULL,
                lat       DOUBLE       NOT NULL,
                lon       DOUBLE       NOT NULL,
                seq_order INT          NOT NULL DEFAULT 0,
                INDEX idx_route (route_id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS telemetry (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                dev_id     VARCHAR(64)  NOT NULL,
                lat        DOUBLE       NOT NULL,
                lon        DOUBLE       NOT NULL,
                speed_kmh  DOUBLE       NOT NULL,
                sos_active TINYINT(1)   NOT NULL,
                timestamp  DOUBLE       NOT NULL,
                INDEX idx_dev_ts (dev_id, timestamp)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS stop_events (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                dev_id        VARCHAR(64)  NOT NULL,
                location_name VARCHAR(128) NOT NULL,
                lat           DOUBLE       NOT NULL,
                lon           DOUBLE       NOT NULL,
                arrived_at    DOUBLE       NOT NULL,
                duration_sec  DOUBLE,
                INDEX idx_dev (dev_id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS trips (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                dev_id          VARCHAR(64)  NOT NULL,
                route_name      VARCHAR(128) NOT NULL,
                start_time      DOUBLE       NOT NULL,
                end_time        DOUBLE,
                total_km        DOUBLE       DEFAULT 0,
                status          VARCHAR(20)  DEFAULT 'active',
                off_route_count INT          DEFAULT 0,
                INDEX idx_dev_status (dev_id, status)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS trip_stops (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                trip_id             INT          NOT NULL,
                dev_id              VARCHAR(64)  NOT NULL,
                stop_name           VARCHAR(128) NOT NULL,
                lat                 DOUBLE,
                lon                 DOUBLE,
                arrived_at          DOUBLE       NOT NULL,
                departed_at         DOUBLE,
                dwell_sec           DOUBLE,
                distance_from_prev  DOUBLE       DEFAULT 0,
                time_from_prev      DOUBLE       DEFAULT 0,
                passengers_boarded  INT          DEFAULT 0,
                passengers_alighted INT          DEFAULT 0,
                passengers_onboard  INT          DEFAULT 0,
                INDEX idx_trip (trip_id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS presence_events (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                dev_id     VARCHAR(64)  NOT NULL,
                trip_id    INT,
                stop_name  VARCHAR(128),
                event_type VARCHAR(10)  NOT NULL,
                count      INT          DEFAULT 1,
                timestamp  DOUBLE       NOT NULL,
                INDEX idx_dev_trip (dev_id, trip_id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS device_status (
                dev_id     VARCHAR(64) PRIMARY KEY,
                status     VARCHAR(10) NOT NULL DEFAULT 'offline',
                last_seen  DOUBLE,
                updated_at DOUBLE
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS trip_points (
                id        INT AUTO_INCREMENT PRIMARY KEY,
                trip_id   INT    NOT NULL,
                lat       DOUBLE NOT NULL,
                lon       DOUBLE NOT NULL,
                timestamp DOUBLE NOT NULL,
                INDEX idx_trip (trip_id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS auto_stops (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                trip_id      INT          NOT NULL,
                dev_id       VARCHAR(64)  NOT NULL,
                lat          DOUBLE       NOT NULL,
                lon          DOUBLE       NOT NULL,
                start_time   DOUBLE       NOT NULL,
                end_time     DOUBLE,
                duration_sec DOUBLE,
                INDEX idx_trip (trip_id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS off_route_events (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                dev_id              VARCHAR(64)  NOT NULL,
                trip_id             INT,
                lat                 DOUBLE       NOT NULL,
                lon                 DOUBLE       NOT NULL,
                timestamp           DOUBLE       NOT NULL,
                distance_from_route DOUBLE,
                INDEX idx_trip (trip_id)
            )
        """)

        conn.commit()

        # Add extended GPS columns if they don't exist yet (safe to re-run)
        extended_cols = [
            ("altitude",   "DOUBLE       DEFAULT NULL"),
            ("satellites", "INT          DEFAULT NULL"),
            ("hdop",       "DOUBLE       DEFAULT NULL"),
            ("gps_date",   "VARCHAR(10)  DEFAULT NULL"),
            ("gps_time",   "VARCHAR(8)   DEFAULT NULL"),
        ]
        for col_name, col_def in extended_cols:
            try:
                cur.execute(f"ALTER TABLE telemetry ADD COLUMN {col_name} {col_def}")
                conn.commit()
            except mysql.connector.Error:
                pass  # Column already exists — skip

        # Marks a trip as server-auto-created (online→offline lifecycle) vs.
        # one started via the manual /trip/start endpoint.
        try:
            cur.execute("ALTER TABLE trips ADD COLUMN auto TINYINT(1) NOT NULL DEFAULT 0")
            conn.commit()
        except mysql.connector.Error:
            pass  # Column already exists — skip

    finally:
        if cur:  cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _dist_point_to_segment_m(plat, plon, alat, alon, blat, blon) -> float:
    clat  = (plat + alat + blat) / 3
    cos_l = math.cos(math.radians(clat))
    px = (plon - alon) * cos_l * 111320;  py = (plat - alat) * 111320
    bx = (blon - alon) * cos_l * 111320;  by = (blat - alat) * 111320
    seg2 = bx * bx + by * by
    if seg2 == 0:
        return math.sqrt(px * px + py * py)
    t = max(0.0, min(1.0, (px * bx + py * by) / seg2))
    return math.sqrt((px - t * bx) ** 2 + (py - t * by) ** 2)


def dist_to_route_m(lat, lon, route_key) -> float:
    routes = _get_routes()
    if route_key not in routes:
        return 0.0
    stops = routes[route_key]["mandatory_stops"]
    if not stops:
        return 0.0
    min_d = min(
        haversine_m(lat, lon, stops[0]["lat"],  stops[0]["lon"]),
        haversine_m(lat, lon, stops[-1]["lat"], stops[-1]["lon"]),
    )
    for i in range(len(stops) - 1):
        a, b = stops[i], stops[i + 1]
        min_d = min(min_d, _dist_point_to_segment_m(lat, lon, a["lat"], a["lon"], b["lat"], b["lon"]))
    return min_d


# ---------------------------------------------------------------------------
# Geofence state machine — runs on every telemetry POST
# ---------------------------------------------------------------------------

def run_geofence(dev_id: str, lat: float, lon: float, ts: float):
    stops = _get_stops()
    if not stops:
        return  # No stops configured yet — geofencing inactive

    nearest, nearest_dist = None, float("inf")
    for stop in stops:
        d = haversine_m(lat, lon, stop["lat"], stop["lon"])
        if d < nearest_dist:
            nearest_dist, nearest = d, stop

    in_zone = nearest_dist <= nearest["radius_m"]
    was     = _active_at.get(dev_id)

    if in_zone:
        if was is None:
            event_id = execute(
                "INSERT INTO stop_events (dev_id, location_name, lat, lon, arrived_at, duration_sec) "
                "VALUES (%s,%s,%s,%s,%s,NULL)",
                (dev_id, nearest["name"], nearest["lat"], nearest["lon"], ts),
                lastrowid=True,
            )
            _active_at[dev_id] = {"stop_name": nearest["name"], "arrived_at": ts, "event_id": event_id}
        elif was["stop_name"] != nearest["name"]:
            execute("UPDATE stop_events SET duration_sec=%s WHERE id=%s",
                    (round(ts - was["arrived_at"], 1), was["event_id"]))
            event_id = execute(
                "INSERT INTO stop_events (dev_id, location_name, lat, lon, arrived_at, duration_sec) "
                "VALUES (%s,%s,%s,%s,%s,NULL)",
                (dev_id, nearest["name"], nearest["lat"], nearest["lon"], ts),
                lastrowid=True,
            )
            _active_at[dev_id] = {"stop_name": nearest["name"], "arrived_at": ts, "event_id": event_id}
    else:
        if was is not None:
            execute("UPDATE stop_events SET duration_sec=%s WHERE id=%s",
                    (round(ts - was["arrived_at"], 1), was["event_id"]))
            del _active_at[dev_id]


# ---------------------------------------------------------------------------
# Trip tracking helpers
# ---------------------------------------------------------------------------

def _end_trip_internal(dev_id: str):
    st = _active_trips.pop(dev_id, None)
    if not st:
        return None
    ts = time.time()
    execute("UPDATE trips SET end_time=%s, total_km=%s, status='completed' WHERE id=%s",
            (ts, round(st["total_km"], 3), st["trip_id"]))
    execute(
        "UPDATE trip_stops SET departed_at=%s, dwell_sec=ROUND(%s - arrived_at, 1) "
        "WHERE trip_id=%s AND departed_at IS NULL",
        (ts, ts, st["trip_id"]),
    )
    for key in [k for k in _in_mandatory_stop if k[0] == st["trip_id"]]:
        del _in_mandatory_stop[key]
    return st["trip_id"]


def _accumulate_trip_distance(dev_id: str, lat: float, lon: float):
    """Adds to the active trip's total_km. Runs for every active trip
    (manual or auto-detected), independent of whether a route is configured —
    auto trips have no route_key, so this can't live inside the route-only
    off-route/mandatory-stop logic in _update_trip_tracking."""
    st = _active_trips.get(dev_id)
    if not st:
        return
    # Ignore GPS jumps > 500 m (cold-start / NLOS noise)
    if st["last_lat"] is not None:
        d_m = haversine_m(st["last_lat"], st["last_lon"], lat, lon)
        if d_m < 500:
            st["total_km"] += d_m / 1000.0
            execute("UPDATE trips SET total_km=%s WHERE id=%s",
                    (round(st["total_km"], 3), st["trip_id"]))
    st["last_lat"] = lat
    st["last_lon"] = lon


def _record_trip_point_and_stop(dev_id: str, lat: float, lon: float, ts: float):
    """Appends a GPS point to trip_points (for the route polyline) and runs
    dwell-based stop detection: if the bus stays within AUTO_STOP_RADIUS_M of
    a point for AUTO_STOP_MIN_SEC, that's recorded as a Stop in auto_stops."""
    st = _active_trips.get(dev_id)
    if not st:
        return

    execute("INSERT INTO trip_points (trip_id, lat, lon, timestamp) VALUES (%s,%s,%s,%s)",
            (st["trip_id"], lat, lon, ts))

    c = st.get("cluster")
    if c is None:
        st["cluster"] = {"lat": lat, "lon": lon, "start_ts": ts, "stop_id": None}
        return

    d = haversine_m(lat, lon, c["lat"], c["lon"])
    if d <= AUTO_STOP_RADIUS_M:
        dwell = ts - c["start_ts"]
        if c["stop_id"] is None and dwell >= AUTO_STOP_MIN_SEC:
            c["stop_id"] = execute(
                "INSERT INTO auto_stops (trip_id, dev_id, lat, lon, start_time) VALUES (%s,%s,%s,%s,%s)",
                (st["trip_id"], dev_id, c["lat"], c["lon"], c["start_ts"]),
                lastrowid=True,
            )
        if c["stop_id"] is not None:
            execute("UPDATE auto_stops SET end_time=%s, duration_sec=%s WHERE id=%s",
                    (ts, round(ts - c["start_ts"], 1), c["stop_id"]))
    else:
        # Moved away — start a fresh cluster at the new point.
        st["cluster"] = {"lat": lat, "lon": lon, "start_ts": ts, "stop_id": None}


def _auto_start_trip(dev_id: str, ts: float) -> int:
    """Starts a trip automatically when a device transitions offline→online.
    Uses the first configured route if one exists (so mandatory-stop/off-route
    tracking still runs); otherwise starts a route-less "Auto Trip" that still
    gets distance, GPS trail and dwell-based stop detection."""
    routes     = _get_routes()
    route_key  = next(iter(routes)) if routes else None
    route_name = routes[route_key]["name"] if route_key else "Auto Trip"

    trip_id = execute(
        "INSERT INTO trips (dev_id, route_name, start_time, status, auto) VALUES (%s,%s,%s,'active',1)",
        (dev_id, route_name, ts), lastrowid=True,
    )
    _active_trips[dev_id] = {
        "trip_id":            trip_id,
        "route_key":          route_key,
        "last_lat":           None,
        "last_lon":           None,
        "start_ts":           ts,
        "total_km":           0.0,
        "passengers_onboard": 0,
        "km_at_last_stop":    0.0,
        "ts_at_last_stop":    ts,
        "last_off_ts":        0,
        "cluster":            None,
    }
    return trip_id


# ---------------------------------------------------------------------------
# Device online/offline tracking — purely server-side (no firmware changes).
# A device is "online" as soon as a telemetry packet arrives; if none arrives
# for OFFLINE_TIMEOUT_SEC it's flipped to "offline" by the background watcher
# thread below. Each online transition auto-starts a trip (if none is already
# active); each offline transition auto-ends it — so one ON→OFF session is
# exactly one trip, matching real ESP32 power-cycle behaviour without needing
# any change to the firmware.
# ---------------------------------------------------------------------------

def _broadcast_status(dev_id: str, status: str, ts: float):
    payload = json.dumps({"dev_id": dev_id, "status": status, "last_seen": ts})
    with _status_subs_lock:
        dead = []
        for q in _status_subscribers:
            try:
                q.put_nowait(payload)
            except Exception:
                dead.append(q)
        for q in dead:
            _status_subscribers.remove(q)


def _set_device_status(dev_id: str, status: str, ts: float):
    with _status_lock:
        _device_status[dev_id] = {"status": status, "last_seen": ts}
    execute(
        "INSERT INTO device_status (dev_id, status, last_seen, updated_at) VALUES (%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE status=VALUES(status), last_seen=VALUES(last_seen), "
        "updated_at=VALUES(updated_at)",
        (dev_id, status, ts, ts),
    )
    _broadcast_status(dev_id, status, ts)


def _touch_device_online(dev_id: str, ts: float):
    """Called on every telemetry POST. Flips offline→online (and auto-starts
    a trip) the first time a packet arrives; otherwise just refreshes last_seen
    so the offline watcher doesn't time it out."""
    with _status_lock:
        prev = _device_status.get(dev_id)
    if prev is None or prev["status"] != "online":
        _set_device_status(dev_id, "online", ts)
        if dev_id not in _active_trips:
            _auto_start_trip(dev_id, ts)
    else:
        with _status_lock:
            _device_status[dev_id]["last_seen"] = ts
        execute("UPDATE device_status SET last_seen=%s, updated_at=%s WHERE dev_id=%s", (ts, ts, dev_id))


def _offline_watcher():
    while True:
        time.sleep(OFFLINE_POLL_SEC)
        now = time.time()
        with _status_lock:
            snapshot = dict(_device_status)
        for dev_id, info in snapshot.items():
            if info["status"] == "online" and now - info["last_seen"] > OFFLINE_TIMEOUT_SEC:
                _set_device_status(dev_id, "offline", info["last_seen"])
                if dev_id in _active_trips:
                    _end_trip_internal(dev_id)


def start_background_watcher():
    global _watcher_started
    if _watcher_started:
        return
    _watcher_started = True
    threading.Thread(target=_offline_watcher, daemon=True).start()


def _update_trip_tracking(dev_id: str, lat: float, lon: float, ts: float):
    """Route-specific tracking only (off-route + mandatory-stop dwell/passenger
    logic). Distance accumulation and generic stop-detection now live in
    _accumulate_trip_distance / _record_trip_point_and_stop above, since those
    must run even for auto-detected trips that have no configured route."""
    st = _active_trips.get(dev_id)
    if not st or not st.get("route_key"):
        return  # No route configured for this trip (e.g. an auto trip) — skip

    routes  = _get_routes()
    route   = routes.get(st["route_key"])
    if not route:
        return  # Route was removed while trip was active

    stop_r  = route["geofence_radius_m"]
    off_thr = route["off_route_threshold_m"]

    # Off-route detection — throttle to one record per 30 s
    if route["mandatory_stops"]:
        off_dist = dist_to_route_m(lat, lon, st["route_key"])
        if off_dist > off_thr and int(ts) - st.get("last_off_ts", 0) >= 30:
            st["last_off_ts"] = int(ts)
            execute(
                "INSERT INTO off_route_events (dev_id, trip_id, lat, lon, timestamp, distance_from_route) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (dev_id, st["trip_id"], lat, lon, ts, round(off_dist, 1)),
            )
            execute("UPDATE trips SET off_route_count=off_route_count+1 WHERE id=%s", (st["trip_id"],))

    # Mandatory stop arrival / departure tracking
    for stop in route["mandatory_stops"]:
        d       = haversine_m(lat, lon, stop["lat"], stop["lon"])
        key     = (st["trip_id"], stop["name"])
        in_zone = d <= stop_r
        was     = _in_mandatory_stop.get(key)

        if in_zone and was is None:
            km_since   = round(st["total_km"] - st.get("km_at_last_stop", 0.0), 3)
            time_since = round(ts - st.get("ts_at_last_stop", st["start_ts"]), 1)
            trip_stop_id = execute(
                """INSERT INTO trip_stops
                   (trip_id, dev_id, stop_name, lat, lon, arrived_at,
                    distance_from_prev, time_from_prev, passengers_onboard)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (st["trip_id"], dev_id, stop["name"], stop["lat"], stop["lon"],
                 ts, km_since, time_since, st["passengers_onboard"]),
                lastrowid=True,
            )
            _in_mandatory_stop[key] = {"arrived_at": ts, "trip_stop_id": trip_stop_id}

        elif not in_zone and was is not None:
            dwell = round(ts - was["arrived_at"], 1)
            execute("UPDATE trip_stops SET departed_at=%s, dwell_sec=%s WHERE id=%s",
                    (ts, dwell, was["trip_stop_id"]))
            st["km_at_last_stop"] = st["total_km"]
            st["ts_at_last_stop"] = ts
            del _in_mandatory_stop[key]


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

REQUIRED_TELEMETRY = {
    "dev_id":     str,
    "lat":        (int, float),
    "lon":        (int, float),
    "speed_kmh":  (int, float),
    "sos_active": int,
}


def validate(data, schema):
    if not isinstance(data, dict):
        return False, "Request body must be a JSON object."
    for field, expected in schema.items():
        if field not in data:
            return False, f"Missing required field: '{field}'."
        
        # In Python, bool is a subclass of int. Reject booleans if they are passed instead of integers.
        is_expected_bool = (expected is bool) or (isinstance(expected, tuple) and bool in expected)
        if isinstance(data[field], bool) and not is_expected_bool:
            return False, f"Field '{field}' cannot be a boolean."

        if not isinstance(data[field], expected):
            t = expected.__name__ if isinstance(expected, type) else " or ".join(x.__name__ for x in expected)
            return False, f"Field '{field}' must be of type {t}."
    return True, None


# ---------------------------------------------------------------------------
# Static file serving — dashboard lives in ../frontend (backend/ and
# frontend/ are separate sibling folders under telematics_backend/)
# ---------------------------------------------------------------------------

_HERE = os.path.abspath(os.path.dirname(__file__))
_FRONTEND_DIR = os.path.abspath(os.path.join(_HERE, "..", "frontend"))

@app.route("/")
def dashboard():
    return send_from_directory(_FRONTEND_DIR, "dashboard.html")

@app.route("/dashboard.css")
def dashboard_css():
    resp = send_from_directory(_FRONTEND_DIR, "dashboard.css")
    resp.headers["Content-Type"] = "text/css; charset=utf-8"
    return resp

@app.route("/dashboard.js")
def dashboard_js_route():
    resp = send_from_directory(_FRONTEND_DIR, "dashboard.js")
    resp.headers["Content-Type"] = "application/javascript; charset=utf-8"
    return resp


@app.route("/mock")
def mock_dashboard():
    return send_from_directory(_FRONTEND_DIR, "mock.html")


# ---------------------------------------------------------------------------
# Health & info
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    row = query("SELECT COUNT(*) AS cnt FROM telemetry", fetch="one")
    return jsonify({
        "status": "ok",
        "records": row["cnt"],
        "time": time.time(),
        "ngrok_url": _ngrok_url or None,
    }), 200


@app.route("/info", methods=["GET"])
def info():
    """Returns ngrok public URL and token endpoint — useful for ESP32 configuration."""
    return jsonify({
        "status":      "ok",
        "ngrok_url":   _ngrok_url or None,
        "telemetry_endpoint": f"{_ngrok_url}/telemetry" if _ngrok_url else None,
        "auth_required": bool(DEVICE_TOKEN),
        "stops_count": len(_get_stops()),
        "routes_count": len(_get_routes()),
    }), 200


# ---------------------------------------------------------------------------
# Telemetry — ESP32 / SIM-card device posts here
# ---------------------------------------------------------------------------

@app.route("/telemetry", methods=["POST"])
def post_telemetry():
    # Accept "Token" (ESP32 AT firmware) or "X-Device-Token" (standard header)
    if DEVICE_TOKEN:
        token = (request.headers.get("Token") or
                 request.headers.get("X-Device-Token") or "")
        if token != DEVICE_TOKEN:
            return jsonify({"status": "error", "message": "Unauthorized."}), 401

    data = request.get_json(silent=True)
    valid, error = validate(data, REQUIRED_TELEMETRY)
    if not valid:
        return jsonify({"status": "error", "message": error}), 400

    dev_id = data["dev_id"]
    if not _check_rate(dev_id):
        return jsonify({"status": "error", "message": "Rate limit exceeded."}), 429

    if data["sos_active"] not in (0, 1):
        return jsonify({"status": "error", "message": "sos_active must be 0 or 1."}), 400
    if not (-90 <= data["lat"] <= 90):
        return jsonify({"status": "error", "message": "lat must be between -90 and 90."}), 400
    if not (-180 <= data["lon"] <= 180):
        return jsonify({"status": "error", "message": "lon must be between -180 and 180."}), 400
    if data["speed_kmh"] < 0:
        return jsonify({"status": "error", "message": "speed_kmh must be >= 0."}), 400

    ts = time.time()
    execute(
        "INSERT INTO telemetry "
        "(dev_id, lat, lon, speed_kmh, sos_active, timestamp, altitude, satellites, hdop, gps_date, gps_time) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            dev_id, data["lat"], data["lon"], data["speed_kmh"], data["sos_active"], ts,
            data.get("altitude"),
            data.get("satellites"),
            data.get("hdop"),
            data.get("gps_date"),
            data.get("gps_time"),
        ),
    )
    _touch_device_online(dev_id, ts)
    run_geofence(dev_id, data["lat"], data["lon"], ts)
    _accumulate_trip_distance(dev_id, data["lat"], data["lon"])
    _update_trip_tracking(dev_id, data["lat"], data["lon"], ts)
    _record_trip_point_and_stop(dev_id, data["lat"], data["lon"], ts)
    return jsonify({"status": "ok", "timestamp": ts}), 201


@app.route("/telemetry/latest", methods=["GET"])
def get_latest():
    dev_id = request.args.get("dev_id")
    if not dev_id:
        return jsonify({"status": "error", "message": "dev_id required."}), 400
    row = query(
        "SELECT * FROM telemetry WHERE dev_id=%s ORDER BY timestamp DESC LIMIT 1",
        (dev_id,), fetch="one"
    )
    if not row:
        return jsonify({"status": "error", "message": f"No records for '{dev_id}'."}), 404
    return jsonify({"status": "ok", "data": row}), 200


@app.route("/telemetry/history", methods=["GET"])
def get_history():
    dev_id = request.args.get("dev_id")
    if not dev_id:
        return jsonify({"status": "error", "message": "dev_id required."}), 400
    rows = query(
        "SELECT * FROM telemetry WHERE dev_id=%s ORDER BY timestamp DESC LIMIT 50", (dev_id,)
    )
    return jsonify({"status": "ok", "data": rows}), 200


@app.route("/telemetry/all-latest", methods=["GET"])
def get_all_latest():
    rows = query(
        """SELECT t.* FROM telemetry t
           INNER JOIN (
             SELECT dev_id, MAX(timestamp) AS ts FROM telemetry GROUP BY dev_id
           ) m ON t.dev_id = m.dev_id AND t.timestamp = m.ts
           ORDER BY t.timestamp DESC"""
    )
    return jsonify({"status": "ok", "data": rows}), 200


@app.route("/telemetry/devices", methods=["GET"])
def get_devices():
    rows = query(
        "SELECT dev_id, MAX(timestamp) AS last_seen, COUNT(*) AS total "
        "FROM telemetry GROUP BY dev_id ORDER BY last_seen DESC"
    )
    return jsonify({"status": "ok", "data": rows}), 200


# ---------------------------------------------------------------------------
# Stops config — GET / POST / DELETE
# ---------------------------------------------------------------------------

@app.route("/telemetry/stops/config", methods=["GET"])
def get_stops_config():
    stops = _get_stops()
    radius = stops[0]["radius_m"] if stops else 300
    return jsonify({"status": "ok", "data": stops, "radius_m": radius}), 200


@app.route("/stops/config", methods=["POST"])
def add_stop():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"status": "error", "message": "JSON body required."}), 400
    for f in ("name", "lat", "lon"):
        if f not in data:
            return jsonify({"status": "error", "message": f"Field '{f}' required."}), 400
    if not isinstance(data["lat"], (int, float)) or not isinstance(data["lon"], (int, float)):
        return jsonify({"status": "error", "message": "lat and lon must be numbers."}), 400
    if not (-90 <= data["lat"] <= 90):
        return jsonify({"status": "error", "message": "lat must be -90..90."}), 400
    if not (-180 <= data["lon"] <= 180):
        return jsonify({"status": "error", "message": "lon must be -180..180."}), 400
    radius = int(data.get("radius_m", 300))
    try:
        sid = execute(
            "INSERT INTO stops_config (name, lat, lon, radius_m) VALUES (%s,%s,%s,%s)",
            (data["name"].strip(), data["lat"], data["lon"], radius),
            lastrowid=True,
        )
    except mysql.connector.IntegrityError:
        return jsonify({"status": "error", "message": f"Stop '{data['name']}' already exists."}), 409
    _invalidate_stops()
    return jsonify({"status": "ok", "id": sid}), 201


@app.route("/stops/config/<int:stop_id>", methods=["DELETE"])
def delete_stop(stop_id):
    row = query("SELECT id FROM stops_config WHERE id=%s", (stop_id,), fetch="one")
    if not row:
        return jsonify({"status": "error", "message": "Stop not found."}), 404
    execute("DELETE FROM stops_config WHERE id=%s", (stop_id,))
    _invalidate_stops()
    return jsonify({"status": "ok"}), 200


@app.route("/stops/config/<int:stop_id>", methods=["PUT"])
def update_stop(stop_id):
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"status": "error", "message": "JSON body required."}), 400
    row = query("SELECT * FROM stops_config WHERE id=%s", (stop_id,), fetch="one")
    if not row:
        return jsonify({"status": "error", "message": "Stop not found."}), 404
    name     = data.get("name",     row["name"])
    lat      = data.get("lat",      row["lat"])
    lon      = data.get("lon",      row["lon"])
    radius_m = data.get("radius_m", row["radius_m"])
    execute(
        "UPDATE stops_config SET name=%s, lat=%s, lon=%s, radius_m=%s WHERE id=%s",
        (name, lat, lon, radius_m, stop_id),
    )
    _invalidate_stops()
    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# Stop events
# ---------------------------------------------------------------------------

@app.route("/telemetry/stops", methods=["GET"])
def get_stop_events():
    dev_id = request.args.get("dev_id")
    if not dev_id:
        return jsonify({"status": "error", "message": "dev_id required."}), 400
    rows = query(
        "SELECT * FROM stop_events WHERE dev_id=%s ORDER BY arrived_at DESC LIMIT 50",
        (dev_id,)
    )
    return jsonify({"status": "ok", "data": rows}), 200


@app.route("/telemetry/stats", methods=["GET"])
def get_stats():
    dev_id = request.args.get("dev_id")
    if not dev_id:
        return jsonify({"status": "error", "message": "dev_id required."}), 400
    row = query(
        """SELECT COUNT(*) AS total, ROUND(AVG(speed_kmh),1) AS avg_speed,
                  ROUND(MAX(speed_kmh),1) AS max_speed,
                  MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen
           FROM telemetry WHERE dev_id=%s""",
        (dev_id,), fetch="one"
    )
    if not row or not row["total"]:
        return jsonify({"status": "error", "message": f"No records for '{dev_id}'."}), 404
    return jsonify({"status": "ok", "data": row}), 200


# ---------------------------------------------------------------------------
# Routes config — GET / POST / DELETE
# ---------------------------------------------------------------------------

@app.route("/routes", methods=["GET"])
def get_routes():
    routes = _get_routes()
    return jsonify({"status": "ok", "data": [
        {
            "key":                   k,
            "name":                  v["name"],
            "stops":                 v["mandatory_stops"],
            "off_route_threshold_m": v["off_route_threshold_m"],
            "geofence_radius_m":     v["geofence_radius_m"],
        }
        for k, v in routes.items()
    ]}), 200


@app.route("/routes/config", methods=["POST"])
def add_route():
    """Add or replace a route. Body: {route_key, name, stops:[{name,lat,lon},...],
    geofence_radius_m?, off_route_threshold_m?}"""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"status": "error", "message": "JSON body required."}), 400
    for f in ("route_key", "name", "stops"):
        if f not in data:
            return jsonify({"status": "error", "message": f"Field '{f}' required."}), 400
    if not isinstance(data["stops"], list) or len(data["stops"]) < 2:
        return jsonify({"status": "error", "message": "stops must be a list with at least 2 stops."}), 400
    for i, s in enumerate(data["stops"]):
        for f in ("name", "lat", "lon"):
            if f not in s:
                return jsonify({"status": "error", "message": f"Stop {i}: field '{f}' required."}), 400

    geo_r = int(data.get("geofence_radius_m",     300))
    off_r = int(data.get("off_route_threshold_m", 600))

    # Upsert route
    existing = query("SELECT id FROM routes_config WHERE route_key=%s", (data["route_key"],), fetch="one")
    if existing:
        route_id = existing["id"]
        execute("UPDATE routes_config SET name=%s, geofence_radius_m=%s, off_route_threshold_m=%s WHERE id=%s",
                (data["name"], geo_r, off_r, route_id))
        execute("DELETE FROM route_stops WHERE route_id=%s", (route_id,))
    else:
        route_id = execute(
            "INSERT INTO routes_config (route_key, name, geofence_radius_m, off_route_threshold_m) "
            "VALUES (%s,%s,%s,%s)",
            (data["route_key"], data["name"], geo_r, off_r),
            lastrowid=True,
        )

    for i, s in enumerate(data["stops"]):
        execute(
            "INSERT INTO route_stops (route_id, stop_name, lat, lon, seq_order) VALUES (%s,%s,%s,%s,%s)",
            (route_id, s["name"], s["lat"], s["lon"], i),
        )

    _invalidate_routes()
    return jsonify({"status": "ok", "route_id": route_id}), 201


@app.route("/routes/config/<route_key>", methods=["DELETE"])
def delete_route(route_key):
    row = query("SELECT id FROM routes_config WHERE route_key=%s", (route_key,), fetch="one")
    if not row:
        return jsonify({"status": "error", "message": "Route not found."}), 404
    execute("DELETE FROM route_stops WHERE route_id=%s", (row["id"],))
    execute("DELETE FROM routes_config WHERE id=%s", (row["id"],))
    _invalidate_routes()
    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# Device online/offline status — REST + Server-Sent Events for live push
# ---------------------------------------------------------------------------

@app.route("/device/status", methods=["GET"])
def device_status_all():
    with _status_lock:
        data = [{"dev_id": k, **v} for k, v in _device_status.items()]
    return jsonify({"status": "ok", "data": data}), 200


@app.route("/device/status/<dev_id>", methods=["GET"])
def device_status_one(dev_id):
    with _status_lock:
        info = _device_status.get(dev_id)
    if info is None:
        row = query("SELECT status, last_seen FROM device_status WHERE dev_id=%s", (dev_id,), fetch="one")
        info = row or {"status": "offline", "last_seen": None}
    return jsonify({"status": "ok", "dev_id": dev_id, "data": info}), 200


@app.route("/device/status/stream")
def device_status_stream():
    """SSE stream — pushes {dev_id, status, last_seen} the instant a device
    flips online/offline, so the dashboard updates without polling/refresh."""
    q = queue.Queue()
    with _status_subs_lock:
        _status_subscribers.append(q)

    def gen():
        try:
            with _status_lock:
                snapshot = dict(_device_status)
            for dev_id, info in snapshot.items():
                yield f"data: {json.dumps({'dev_id': dev_id, **info})}\n\n"
            while True:
                try:
                    payload = q.get(timeout=15)
                    yield f"data: {payload}\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"
        finally:
            with _status_subs_lock:
                if q in _status_subscribers:
                    _status_subscribers.remove(q)

    resp = app.response_class(gen(), mimetype="text/event-stream")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


# ---------------------------------------------------------------------------
# Trip endpoints
# ---------------------------------------------------------------------------

@app.route("/trip/start", methods=["POST"])
def start_trip():
    data = request.get_json(silent=True)
    if not data or not data.get("dev_id"):
        return jsonify({"status": "error", "message": "dev_id required."}), 400
    dev_id    = data["dev_id"]
    routes    = _get_routes()
    route_key = data.get("route_key")

    if route_key and route_key not in routes:
        return jsonify({"status": "error", "message": f"Unknown route: '{route_key}'."}), 400
    if not route_key:
        if not routes:
            return jsonify({"status": "error",
                            "message": "No routes configured. POST /routes/config first."}), 400
        route_key = next(iter(routes))  # Use first available route

    if dev_id in _active_trips:
        _end_trip_internal(dev_id)

    ts = time.time()
    trip_id = execute(
        "INSERT INTO trips (dev_id, route_name, start_time, status) VALUES (%s,%s,%s,'active')",
        (dev_id, routes[route_key]["name"], ts), lastrowid=True,
    )
    _active_trips[dev_id] = {
        "trip_id":            trip_id,
        "route_key":          route_key,
        "last_lat":           None,
        "last_lon":           None,
        "start_ts":           ts,
        "total_km":           0.0,
        "passengers_onboard": 0,
        "km_at_last_stop":    0.0,
        "ts_at_last_stop":    ts,
        "last_off_ts":        0,
        "cluster":            None,
    }
    return jsonify({
        "status":     "ok",
        "trip_id":    trip_id,
        "route":      routes[route_key]["name"],
        "route_key":  route_key,
        "started_at": ts,
    }), 201


@app.route("/trip/end", methods=["POST"])
def end_trip():
    data = request.get_json(silent=True)
    if not data or not data.get("dev_id"):
        return jsonify({"status": "error", "message": "dev_id required."}), 400
    dev_id = data["dev_id"]
    if dev_id not in _active_trips:
        return jsonify({"status": "error", "message": "No active trip for this device."}), 404
    trip_id = _end_trip_internal(dev_id)
    return jsonify({"status": "ok", "trip_id": trip_id}), 200


@app.route("/trip/active/<dev_id>", methods=["GET"])
def get_active_trip(dev_id):
    if dev_id not in _active_trips:
        return jsonify({"status": "ok", "data": None}), 200
    st  = _active_trips[dev_id]
    row = query("SELECT * FROM trips WHERE id=%s", (st["trip_id"],), fetch="one")
    if not row:
        return jsonify({"status": "ok", "data": None}), 200
    row["total_km"]           = round(st["total_km"], 3)
    row["passengers_onboard"] = st["passengers_onboard"]
    stops_visited = query(
        "SELECT * FROM trip_stops WHERE trip_id=%s ORDER BY arrived_at ASC", (st["trip_id"],)
    )
    return jsonify({"status": "ok", "data": row, "stops_visited": stops_visited}), 200


@app.route("/trip/summary/<int:trip_id>", methods=["GET"])
def get_trip_summary(trip_id):
    trip = query("SELECT * FROM trips WHERE id=%s", (trip_id,), fetch="one")
    if not trip:
        return jsonify({"status": "error", "message": "Trip not found."}), 404
    stops       = query("SELECT * FROM trip_stops WHERE trip_id=%s ORDER BY arrived_at ASC", (trip_id,))
    presence    = query("SELECT * FROM presence_events WHERE trip_id=%s ORDER BY timestamp ASC", (trip_id,))
    off_route   = query("SELECT * FROM off_route_events WHERE trip_id=%s ORDER BY timestamp ASC", (trip_id,))
    points      = query("SELECT lat, lon, timestamp FROM trip_points WHERE trip_id=%s ORDER BY timestamp ASC",
                         (trip_id,))
    auto_stops  = query("SELECT * FROM auto_stops WHERE trip_id=%s ORDER BY start_time ASC", (trip_id,))
    return jsonify({"status": "ok", "data": {
        "trip": trip, "stops": stops, "presence": presence, "off_route": off_route,
        "points": points, "auto_stops": auto_stops,
    }}), 200


@app.route("/trip/<int:trip_id>/points", methods=["GET"])
def get_trip_points(trip_id):
    """Full GPS route (lat, lon, timestamp) for one trip — used to draw the
    travelled polyline on the Trip History map."""
    rows = query("SELECT lat, lon, timestamp FROM trip_points WHERE trip_id=%s ORDER BY timestamp ASC",
                 (trip_id,))
    return jsonify({"status": "ok", "data": rows}), 200


@app.route("/trip/<int:trip_id>/stops", methods=["GET"])
def get_trip_auto_stops(trip_id):
    """Dwell-detected stops (bus stayed within AUTO_STOP_RADIUS_M for at
    least AUTO_STOP_MIN_SEC) for one trip — distinct from the route's
    mandatory stops in trip_stops."""
    rows = query("SELECT * FROM auto_stops WHERE trip_id=%s ORDER BY start_time ASC", (trip_id,))
    return jsonify({"status": "ok", "data": rows}), 200


@app.route("/trips", methods=["GET"])
def list_trips():
    dev_id = request.args.get("dev_id")
    q_text = request.args.get("q", "").strip()
    sort   = request.args.get("sort", "start_time")
    order  = "ASC" if request.args.get("order", "desc").lower() == "asc" else "DESC"
    limit  = min(int(request.args.get("limit", 20)), 100)

    sort_col = {
        "start_time": "start_time",
        "duration":   "(IFNULL(end_time, UNIX_TIMESTAMP()) - start_time)",
        "distance":   "total_km",
    }.get(sort, "start_time")

    clauses, params = [], []
    if dev_id:
        clauses.append("dev_id=%s"); params.append(dev_id)
    if q_text:
        clauses.append("(route_name LIKE %s OR dev_id LIKE %s)")
        params.extend([f"%{q_text}%", f"%{q_text}%"])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    sql = f"SELECT * FROM trips {where} ORDER BY {sort_col} {order} LIMIT %s"
    params.append(limit)
    rows = query(sql, tuple(params))
    return jsonify({"status": "ok", "data": rows}), 200


# ---------------------------------------------------------------------------
# Presence / passenger monitoring
# ---------------------------------------------------------------------------

@app.route("/presence", methods=["POST"])
def post_presence():
    data = request.get_json(silent=True)
    if not data or not data.get("dev_id") or not data.get("event_type"):
        return jsonify({"status": "error", "message": "dev_id and event_type required."}), 400
    dev_id     = data["dev_id"]
    event_type = data["event_type"]
    if event_type not in ("board", "alight"):
        return jsonify({"status": "error", "message": "event_type must be 'board' or 'alight'."}), 400
    count     = max(1, int(data.get("count", 1)))
    stop_name = data.get("stop_name", "")
    ts        = time.time()

    trip_id = None
    if dev_id in _active_trips:
        trip_id = _active_trips[dev_id]["trip_id"]
        if event_type == "board":
            _active_trips[dev_id]["passengers_onboard"] += count
        else:
            _active_trips[dev_id]["passengers_onboard"] = max(
                0, _active_trips[dev_id]["passengers_onboard"] - count)
        if stop_name:
            col = "passengers_boarded" if event_type == "board" else "passengers_alighted"
            execute(
                f"UPDATE trip_stops SET {col}={col}+%s "
                f"WHERE trip_id=%s AND stop_name=%s AND departed_at IS NULL",
                (count, trip_id, stop_name),
            )

    execute(
        "INSERT INTO presence_events (dev_id, trip_id, stop_name, event_type, count, timestamp) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (dev_id, trip_id, stop_name, event_type, count, ts),
    )
    onboard = _active_trips.get(dev_id, {}).get("passengers_onboard", 0)
    return jsonify({"status": "ok", "passengers_onboard": onboard, "timestamp": ts}), 201


@app.route("/presence/count/<dev_id>", methods=["GET"])
def get_presence_count(dev_id):
    onboard = _active_trips.get(dev_id, {}).get("passengers_onboard", 0)
    return jsonify({"status": "ok", "passengers_onboard": onboard, "dev_id": dev_id}), 200


# ---------------------------------------------------------------------------
# Dummy fleet — 5 morning + 5 evening simulated buses (PRD: Bus Tracking &
# Fleet Management). Fully isolated dev_id namespace (DUMMY01..DUMMY10),
# own MySQL tables (dummy_history / dummy_predictions). Never reads/writes
# `telemetry`, `stops_config`, `routes_config`, or any real-device table.
# ---------------------------------------------------------------------------

@app.route("/dummy/buses", methods=["GET"])
def dummy_buses():
    return jsonify({"status": "ok", "data": dummy_data.buses_meta()}), 200


@app.route("/dummy/buses/live", methods=["GET"])
def dummy_buses_live():
    return jsonify({"status": "ok", "data": dummy_data.all_live()}), 200


@app.route("/dummy/history/dates", methods=["GET"])
def dummy_history_dates():
    rows = query("SELECT DISTINCT date FROM dummy_history ORDER BY date DESC")
    dates = [r["date"].isoformat() for r in rows]
    return jsonify({"status": "ok", "data": dates}), 200


@app.route("/dummy/history", methods=["GET"])
def dummy_history():
    date = request.args.get("date")
    dev_id = request.args.get("dev_id")
    if not date:
        return jsonify({"status": "error", "message": "date required (YYYY-MM-DD)."}), 400
    if dev_id:
        rows = query("SELECT * FROM dummy_history WHERE date=%s AND dev_id=%s", (date, dev_id))
    else:
        rows = query("SELECT * FROM dummy_history WHERE date=%s ORDER BY dev_id", (date,))
    return jsonify({"status": "ok", "data": rows}), 200


@app.route("/dummy/predictions", methods=["GET"])
def dummy_predictions():
    dev_id = request.args.get("dev_id")
    if not dev_id:
        return jsonify({"status": "error", "message": "dev_id required."}), 400
    rows = query("SELECT * FROM dummy_predictions WHERE dev_id=%s ORDER BY date", (dev_id,))
    return jsonify({"status": "ok", "data": rows}), 200


@app.route("/dummy/insights", methods=["GET"])
def dummy_insights():
    """AI-generated (Kimi) or rule-based fallback narrative summary for a
    dummy bus's historical or forecast report. Never touches real-device
    tables; reads only dummy_history / dummy_predictions."""
    dev_id = request.args.get("dev_id")
    kind = request.args.get("kind", "historical")
    force = request.args.get("regenerate") == "1"

    cfg = dummy_data.BUS_BY_ID.get(dev_id)
    if not cfg:
        return jsonify({"status": "error", "message": f"Unknown dummy bus '{dev_id}'."}), 404

    hist_rows = query("SELECT * FROM dummy_history WHERE dev_id=%s ORDER BY date", (dev_id,))
    if not hist_rows:
        return jsonify({"status": "error", "message": "No historical data for this bus yet."}), 404

    if kind == "forecast":
        pred_rows = query("SELECT * FROM dummy_predictions WHERE dev_id=%s ORDER BY date", (dev_id,))
        result = summary_service.get_forecast_summary(
            dev_id, cfg["number"], cfg["route_name"], hist_rows, pred_rows, force_regenerate=force
        )
    else:
        result = summary_service.get_historical_summary(
            dev_id, cfg["number"], cfg["route_name"], hist_rows, force_regenerate=force
        )

    return jsonify({"status": "ok", "data": result}), 200


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    dummy_data.init_dummy_db(DB_CONFIG)
    dummy_data.seed_if_needed(DB_CONFIG)
    start_background_watcher()

    _ngrok_url = _start_ngrok(5000)

    print("=" * 60)
    print("  Telematics Backend — Module 4 (Sri Janani)")
    print(f"  DB       : {DB_CONFIG['host']} / {DB_CONFIG['database']}")
    print(f"  Auth     : {'ENABLED (Token set)' if DEVICE_TOKEN else 'DISABLED (no token)'}")
    print("=" * 60)
    if _ngrok_url:
        host = _ngrok_url.replace("https://", "").replace("http://", "").rstrip("/")
        print("")
        print("  " + "=" * 56)
        print("  >>> COPY THIS INTO bus_final.ino <<<")
        print(f'  #define NGROK_HOST  "{host}"')
        print("  " + "=" * 56)
        print(f"  Full URL   : {_ngrok_url}")
        print(f"  ESP32 POST : {_ngrok_url}/telemetry")
        print(f"  Auth token : Token: {DEVICE_TOKEN}" if DEVICE_TOKEN else "  Auth disabled")
    else:
        print("  Local only : http://0.0.0.0:5000/")
        print("  Set NGROK_AUTHTOKEN in .env for SIM-card ESP32 access")
    print("=" * 60)
    print("  Dashboard  : /")
    print("  Health     : /health")
    print("  Info       : /info        (shows ngrok URL + config)")
    print("  Stops API  : POST /stops/config  { name, lat, lon, radius_m? }")
    print("  Routes API : POST /routes/config { route_key, name, stops:[...] }")
    print("=" * 60)

    stop_count  = len(_get_stops())
    route_count = len(_get_routes())
    if stop_count == 0:
        print("  ⚠  No stops configured. Use POST /stops/config to add geofence stops.")
    else:
        print(f"  {stop_count} stop(s) loaded from DB.")
    if route_count == 0:
        print("  ⚠  No routes configured. Use POST /routes/config to add a route.")
    else:
        print(f"  {route_count} route(s) loaded from DB.")
    print("=" * 60)

    app.run(host="0.0.0.0", port=5000, debug=False)
