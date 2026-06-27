"""
IoT Smart Vehicle Telematics Backend
Module 4 - Sri Janani
Flask backend with MySQL: telemetry, geofence, trip tracking, presence monitoring.
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import mysql.connector
import time
import math
import os

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# MySQL configuration — loaded from .env (never hardcode credentials)
# ---------------------------------------------------------------------------

def _load_env():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
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

# ---------------------------------------------------------------------------
# Device auth & rate limiting
# ---------------------------------------------------------------------------

DEVICE_TOKEN  = os.environ.get("DEVICE_TOKEN", "")
_rate_buckets: dict = {}
_RATE_MAX     = 2.0
_RATE_REFILL  = 2.0
_rate_lock    = __import__("threading").Lock()


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
# Known bus stops / depots — geofence targets
# ---------------------------------------------------------------------------

STOPS = [
    {"name": "Chennai Central",   "lat": 13.0827, "lon": 80.2707},
    {"name": "Egmore",            "lat": 13.0784, "lon": 80.2617},
    {"name": "Royapettah",        "lat": 13.0524, "lon": 80.2623},
    {"name": "T Nagar Bus Stand", "lat": 13.0418, "lon": 80.2341},
    {"name": "Vadapalani",        "lat": 13.0524, "lon": 80.2121},
    {"name": "Anna Nagar",        "lat": 13.0850, "lon": 80.2101},
    {"name": "Guindy",            "lat": 13.0067, "lon": 80.2206},
    {"name": "Adyar",             "lat": 13.0012, "lon": 80.2565},
    {"name": "Koyambedu",         "lat": 13.0694, "lon": 80.1948},
    {"name": "Perambur",          "lat": 13.1175, "lon": 80.2479},
    {"name": "Avadi",             "lat": 13.1132, "lon": 80.1050},
    {"name": "Porur Junction",    "lat": 13.0359, "lon": 80.1569},
    {"name": "Mogappair",         "lat": 13.0832, "lon": 80.1650},
    {"name": "Maduravoyil",       "lat": 13.0523, "lon": 80.1760},
    # Update Office coordinates to your actual office GPS location
    {"name": "Office",            "lat": 13.0067, "lon": 80.2206},
]

GEOFENCE_RADIUS_M = 300

# ---------------------------------------------------------------------------
# Route configuration — Office → Mogappair with mandatory stops
# Update Office lat/lon below to match your actual office location
# ---------------------------------------------------------------------------

ROUTE_CONFIG = {
    "office_to_mogappair": {
        "name": "Office → Mogappair",
        "mandatory_stops": [
            {"name": "Office",         "lat": 13.0067, "lon": 80.2206},
            {"name": "Porur Junction", "lat": 13.0359, "lon": 80.1569},
            {"name": "Koyambedu",      "lat": 13.0694, "lon": 80.1948},
            {"name": "Anna Nagar",     "lat": 13.0850, "lon": 80.2101},
            {"name": "Mogappair",      "lat": 13.0832, "lon": 80.1650},
        ],
        "geofence_radius_m":     300,
        "off_route_threshold_m": 600,
    }
}

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

_active_at: dict        = {}  # dev_id → geofence stop state (existing)
_active_trips: dict     = {}  # dev_id → active trip state dict
_in_mandatory_stop: dict = {} # (trip_id, stop_name) → {arrived_at, trip_stop_id}

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    return mysql.connector.connect(**DB_CONFIG)


def query(sql, params=(), fetch="all"):
    conn = get_db()
    cur = None
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(sql, params)
        return cur.fetchall() if fetch == "all" else cur.fetchone()
    finally:
        if cur: cur.close()
        conn.close()


def execute(sql, params=(), lastrowid=False):
    conn = get_db()
    cur = None
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        conn.commit()
        return cur.lastrowid if lastrowid else None
    finally:
        if cur: cur.close()
        conn.close()


def init_db():
    cfg = {k: v for k, v in DB_CONFIG.items() if k != "database"}
    conn = mysql.connector.connect(**cfg)
    cur = None
    try:
        cur = conn.cursor()
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{DB_CONFIG['database']}`")
        cur.execute(f"USE `{DB_CONFIG['database']}`")
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
                id          INT AUTO_INCREMENT PRIMARY KEY,
                dev_id      VARCHAR(64)  NOT NULL,
                trip_id     INT,
                stop_name   VARCHAR(128),
                event_type  VARCHAR(10)  NOT NULL,
                count       INT          DEFAULT 1,
                timestamp   DOUBLE       NOT NULL,
                INDEX idx_dev_trip (dev_id, trip_id)
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
    finally:
        if cur: cur.close()
        conn.close()

# ---------------------------------------------------------------------------
# Geofence & route helpers
# ---------------------------------------------------------------------------

def haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _dist_point_to_segment_m(plat, plon, alat, alon, blat, blon) -> float:
    """Approximate distance in meters from point P to segment A→B."""
    clat   = (plat + alat + blat) / 3
    cos_l  = math.cos(math.radians(clat))
    px = (plon - alon) * cos_l * 111320;  py = (plat - alat) * 111320
    bx = (blon - alon) * cos_l * 111320;  by = (blat - alat) * 111320
    seg2 = bx * bx + by * by
    if seg2 == 0:
        return math.sqrt(px * px + py * py)
    t = max(0.0, min(1.0, (px * bx + py * by) / seg2))
    return math.sqrt((px - t * bx) ** 2 + (py - t * by) ** 2)


def dist_to_route_m(lat, lon, route_key) -> float:
    """Minimum distance in meters from (lat, lon) to the route polyline."""
    stops = ROUTE_CONFIG[route_key]["mandatory_stops"]
    min_d = min(
        haversine_m(lat, lon, stops[0]["lat"], stops[0]["lon"]),
        haversine_m(lat, lon, stops[-1]["lat"], stops[-1]["lon"]),
    )
    for i in range(len(stops) - 1):
        a, b = stops[i], stops[i + 1]
        min_d = min(min_d, _dist_point_to_segment_m(lat, lon, a["lat"], a["lon"], b["lat"], b["lon"]))
    return min_d


def run_geofence(dev_id: str, lat: float, lon: float, ts: float):
    nearest, nearest_dist = None, float("inf")
    for stop in STOPS:
        d = haversine_m(lat, lon, stop["lat"], stop["lon"])
        if d < nearest_dist:
            nearest_dist, nearest = d, stop

    in_zone = nearest_dist <= GEOFENCE_RADIUS_M
    was = _active_at.get(dev_id)

    if in_zone:
        if was is None:
            event_id = execute(
                "INSERT INTO stop_events (dev_id, location_name, lat, lon, arrived_at, duration_sec) VALUES (%s,%s,%s,%s,%s,%s)",
                (dev_id, nearest["name"], nearest["lat"], nearest["lon"], ts, None),
                lastrowid=True,
            )
            _active_at[dev_id] = {"stop_name": nearest["name"], "arrived_at": ts, "event_id": event_id}
        elif was["stop_name"] != nearest["name"]:
            execute("UPDATE stop_events SET duration_sec=%s WHERE id=%s",
                    (round(ts - was["arrived_at"], 1), was["event_id"]))
            event_id = execute(
                "INSERT INTO stop_events (dev_id, location_name, lat, lon, arrived_at, duration_sec) VALUES (%s,%s,%s,%s,%s,%s)",
                (dev_id, nearest["name"], nearest["lat"], nearest["lon"], ts, None),
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
    """Close the active trip for dev_id. Returns trip_id or None."""
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
    for key in list(_in_mandatory_stop.keys()):
        if key[0] == st["trip_id"]:
            del _in_mandatory_stop[key]
    return st["trip_id"]


def _update_trip_tracking(dev_id: str, lat: float, lon: float, ts: float):
    """Called on every telemetry POST while a trip is active."""
    st = _active_trips.get(dev_id)
    if not st:
        return

    route   = ROUTE_CONFIG[st["route_key"]]
    stop_r  = route["geofence_radius_m"]
    off_thr = route["off_route_threshold_m"]

    # Accumulate distance — ignore GPS jumps > 500 m (cold-start noise)
    if st["last_lat"] is not None:
        d_m = haversine_m(st["last_lat"], st["last_lon"], lat, lon)
        if d_m < 500:
            st["total_km"] += d_m / 1000.0
            execute("UPDATE trips SET total_km=%s WHERE id=%s",
                    (round(st["total_km"], 3), st["trip_id"]))

    st["last_lat"] = lat
    st["last_lon"] = lon

    # Off-route detection — throttle to one record per 30 s
    off_dist = dist_to_route_m(lat, lon, st["route_key"])
    if off_dist > off_thr and int(ts) - st.get("last_off_ts", 0) >= 30:
        st["last_off_ts"] = int(ts)
        execute(
            "INSERT INTO off_route_events (dev_id, trip_id, lat, lon, timestamp, distance_from_route) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (dev_id, st["trip_id"], lat, lon, ts, round(off_dist, 1)),
        )
        execute("UPDATE trips SET off_route_count=off_route_count+1 WHERE id=%s", (st["trip_id"],))

    # Mandatory stop arrival / departure
    for stop in route["mandatory_stops"]:
        d   = haversine_m(lat, lon, stop["lat"], stop["lon"])
        key = (st["trip_id"], stop["name"])
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
# Validation
# ---------------------------------------------------------------------------

REQUIRED_TELEMETRY = {
    "dev_id":     str,
    "lat":        (int, float),
    "lon":        (int, float),
    "speed_kmh":  (int, float),
    "sos_active": int,
}

REQUIRED_STOP = {
    "dev_id":        str,
    "location_name": str,
    "lat":           (int, float),
    "lon":           (int, float),
    "arrived_at":    (int, float),
}


def validate(data, schema):
    if not isinstance(data, dict):
        return False, "Request body must be a JSON object."
    for field, expected in schema.items():
        if field not in data:
            return False, f"Missing required field: '{field}'."
        if not isinstance(data[field], expected):
            t = expected.__name__ if isinstance(expected, type) else " or ".join(x.__name__ for x in expected)
            return False, f"Field '{field}' must be of type {t}."
    return True, None


# ---------------------------------------------------------------------------
# Serve dashboard
# ---------------------------------------------------------------------------

@app.route("/")
def dashboard():
    return send_from_directory(os.path.dirname(__file__), "dashboard.html")

@app.route("/dashboard.css")
def dashboard_css():
    return send_from_directory(os.path.dirname(__file__), "dashboard.css")

@app.route("/dashboard.js")
def dashboard_js():
    return send_from_directory(os.path.dirname(__file__), "dashboard.js")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    row = query("SELECT COUNT(*) AS cnt FROM telemetry", fetch="one")
    return jsonify({"status": "ok", "records": row["cnt"], "time": time.time()}), 200


# ---------------------------------------------------------------------------
# Telemetry endpoints
# ---------------------------------------------------------------------------

@app.route("/telemetry", methods=["POST"])
def post_telemetry():
    if DEVICE_TOKEN:
        if request.headers.get("X-Device-Token") != DEVICE_TOKEN:
            return jsonify({"status": "error", "message": "Unauthorized."}), 401

    data = request.get_json(silent=True)
    valid, error = validate(data, REQUIRED_TELEMETRY)
    if not valid:
        return jsonify({"status": "error", "message": error}), 400

    if not _check_rate(data.get("dev_id", "")):
        return jsonify({"status": "error", "message": "Rate limit exceeded."}), 429
    if data["sos_active"] not in (0, 1):
        return jsonify({"status": "error", "message": "Field 'sos_active' must be 0 or 1."}), 400
    if not (-90 <= data["lat"] <= 90):
        return jsonify({"status": "error", "message": "Field 'lat' must be between -90 and 90."}), 400
    if not (-180 <= data["lon"] <= 180):
        return jsonify({"status": "error", "message": "Field 'lon' must be between -180 and 180."}), 400
    if data["speed_kmh"] < 0:
        return jsonify({"status": "error", "message": "Field 'speed_kmh' must be >= 0."}), 400

    ts = time.time()
    execute(
        "INSERT INTO telemetry (dev_id, lat, lon, speed_kmh, sos_active, timestamp) VALUES (%s,%s,%s,%s,%s,%s)",
        (data["dev_id"], data["lat"], data["lon"], data["speed_kmh"], data["sos_active"], ts),
    )
    run_geofence(data["dev_id"], data["lat"], data["lon"], ts)
    _update_trip_tracking(data["dev_id"], data["lat"], data["lon"], ts)
    return jsonify({"status": "ok", "timestamp": ts}), 201


@app.route("/telemetry/latest", methods=["GET"])
def get_latest():
    dev_id = request.args.get("dev_id")
    if not dev_id:
        return jsonify({"status": "error", "message": "Query parameter 'dev_id' is required."}), 400
    row = query("SELECT * FROM telemetry WHERE dev_id=%s ORDER BY timestamp DESC LIMIT 1",
                (dev_id,), fetch="one")
    if not row:
        return jsonify({"status": "error", "message": f"No records found for dev_id '{dev_id}'."}), 404
    return jsonify({"status": "ok", "data": row}), 200


@app.route("/telemetry/history", methods=["GET"])
def get_history():
    dev_id = request.args.get("dev_id")
    if not dev_id:
        return jsonify({"status": "error", "message": "Query parameter 'dev_id' is required."}), 400
    rows = query("SELECT * FROM telemetry WHERE dev_id=%s ORDER BY timestamp DESC LIMIT 50", (dev_id,))
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
# Stop event endpoints
# ---------------------------------------------------------------------------

@app.route("/telemetry/stops/config", methods=["GET"])
def get_stops_config():
    return jsonify({"status": "ok", "data": STOPS, "radius_m": GEOFENCE_RADIUS_M}), 200


@app.route("/telemetry/stops", methods=["GET"])
def get_stops():
    dev_id = request.args.get("dev_id")
    if not dev_id:
        return jsonify({"status": "error", "message": "Query parameter 'dev_id' is required."}), 400
    rows = query("SELECT * FROM stop_events WHERE dev_id=%s ORDER BY arrived_at DESC", (dev_id,))
    return jsonify({"status": "ok", "data": rows}), 200


@app.route("/telemetry/stats", methods=["GET"])
def get_stats():
    dev_id = request.args.get("dev_id")
    if not dev_id:
        return jsonify({"status": "error", "message": "Query parameter 'dev_id' is required."}), 400
    row = query(
        """SELECT COUNT(*) AS total, ROUND(AVG(speed_kmh),1) AS avg_speed,
                  ROUND(MAX(speed_kmh),1) AS max_speed,
                  MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen
           FROM telemetry WHERE dev_id=%s""",
        (dev_id,), fetch="one"
    )
    if not row or not row["total"]:
        return jsonify({"status": "error", "message": f"No records for dev_id '{dev_id}'."}), 404
    return jsonify({"status": "ok", "data": row}), 200


@app.route("/telemetry/stops", methods=["POST"])
def post_stop():
    data = request.get_json(silent=True)
    valid, error = validate(data, REQUIRED_STOP)
    if not valid:
        return jsonify({"status": "error", "message": error}), 400
    execute(
        "INSERT INTO stop_events (dev_id, location_name, lat, lon, arrived_at, duration_sec) VALUES (%s,%s,%s,%s,%s,%s)",
        (data["dev_id"], data["location_name"], data["lat"], data["lon"],
         data["arrived_at"], data.get("duration_sec")),
    )
    return jsonify({"status": "ok"}), 201


# ---------------------------------------------------------------------------
# Route configuration endpoint
# ---------------------------------------------------------------------------

@app.route("/routes", methods=["GET"])
def get_routes():
    return jsonify({"status": "ok", "data": [
        {"key": k, "name": v["name"], "stops": v["mandatory_stops"],
         "off_route_threshold_m": v["off_route_threshold_m"]}
        for k, v in ROUTE_CONFIG.items()
    ]}), 200


# ---------------------------------------------------------------------------
# Trip endpoints
# ---------------------------------------------------------------------------

@app.route("/trip/start", methods=["POST"])
def start_trip():
    data = request.get_json(silent=True)
    if not data or not data.get("dev_id"):
        return jsonify({"status": "error", "message": "dev_id required"}), 400
    dev_id    = data["dev_id"]
    route_key = data.get("route_key", "office_to_mogappair")
    if route_key not in ROUTE_CONFIG:
        return jsonify({"status": "error", "message": f"Unknown route: {route_key}"}), 400

    if dev_id in _active_trips:
        _end_trip_internal(dev_id)

    ts = time.time()
    trip_id = execute(
        "INSERT INTO trips (dev_id, route_name, start_time, status) VALUES (%s,%s,%s,'active')",
        (dev_id, ROUTE_CONFIG[route_key]["name"], ts), lastrowid=True,
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
    }
    return jsonify({
        "status": "ok", "trip_id": trip_id,
        "route": ROUTE_CONFIG[route_key]["name"], "started_at": ts,
    }), 201


@app.route("/trip/end", methods=["POST"])
def end_trip():
    data = request.get_json(silent=True)
    if not data or not data.get("dev_id"):
        return jsonify({"status": "error", "message": "dev_id required"}), 400
    dev_id = data["dev_id"]
    if dev_id not in _active_trips:
        return jsonify({"status": "error", "message": "No active trip for this device"}), 404
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
        return jsonify({"status": "error", "message": "Trip not found"}), 404
    stops     = query("SELECT * FROM trip_stops WHERE trip_id=%s ORDER BY arrived_at ASC", (trip_id,))
    presence  = query("SELECT * FROM presence_events WHERE trip_id=%s ORDER BY timestamp ASC", (trip_id,))
    off_route = query("SELECT * FROM off_route_events WHERE trip_id=%s ORDER BY timestamp ASC", (trip_id,))
    return jsonify({"status": "ok", "data": {
        "trip": trip, "stops": stops, "presence": presence, "off_route": off_route
    }}), 200


@app.route("/trips", methods=["GET"])
def list_trips():
    dev_id = request.args.get("dev_id")
    limit  = min(int(request.args.get("limit", 20)), 100)
    if dev_id:
        rows = query("SELECT * FROM trips WHERE dev_id=%s ORDER BY start_time DESC LIMIT %s",
                     (dev_id, limit))
    else:
        rows = query("SELECT * FROM trips ORDER BY start_time DESC LIMIT %s", (limit,))
    return jsonify({"status": "ok", "data": rows}), 200


# ---------------------------------------------------------------------------
# Presence / passenger monitoring
# ---------------------------------------------------------------------------

@app.route("/presence", methods=["POST"])
def post_presence():
    data = request.get_json(silent=True)
    if not data or not data.get("dev_id") or not data.get("event_type"):
        return jsonify({"status": "error", "message": "dev_id and event_type required"}), 400
    dev_id     = data["dev_id"]
    event_type = data["event_type"]
    if event_type not in ("board", "alight"):
        return jsonify({"status": "error", "message": "event_type must be 'board' or 'alight'"}), 400
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
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    print("=" * 55)
    print("  Telematics Backend - Module 4 (Sri Janani)")
    print(f"  Database : {DB_CONFIG['host']} / {DB_CONFIG['database']}")
    print(f"  Route    : Office -> Porur -> Koyambedu -> Anna Nagar -> Mogappair")
    print("=" * 55)
    print(f"  Dashboard: http://0.0.0.0:5000/")
    print(f"  Health   : http://0.0.0.0:5000/health")
    print(f"  Trips    : http://0.0.0.0:5000/trips")
    print("=" * 55)
    app.run(host="0.0.0.0", port=5000, debug=True)
