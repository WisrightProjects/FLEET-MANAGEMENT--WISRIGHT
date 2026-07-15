"""
WSGI entrypoint for production (gunicorn).

Purpose
    app.py calls init_db() only inside its `if __name__ == "__main__"` block,
    which gunicorn never executes. Without this file the MySQL schema would
    never be created in a containerised deployment. This module:
      1. imports the Flask `app` object for gunicorn (`wsgi:app`)
      2. creates the database + tables (init_db) before serving
      3. retries the DB connection at boot, so the app can start alongside a
         freshly-provisioned MySQL container that is still coming up.

    ngrok is intentionally NOT started here — on a real VPS the public domain
    (served by Coolify/Traefik) replaces the ngrok tunnel. Leave NGROK_AUTHTOKEN
    empty in the environment.

Run with a SINGLE worker (see gunicorn_conf.py) — the app holds live trip /
geofence / rate-limit state in memory.

Input:  environment variables (MYSQL_HOST/USER/PASSWORD/DATABASE, DEVICE_TOKEN)
Output: a WSGI `app` callable ready for gunicorn, with the schema guaranteed.
"""

import time
import mysql.connector

import dummy_data
from app import app, init_db, DB_CONFIG, start_background_watcher  # noqa: F401  (app imported for gunicorn)


def _init_with_retry(attempts: int = 30, delay: float = 2.0) -> None:
    """Create + seed schema, retrying while MySQL finishes starting up."""
    last_err = None
    for i in range(1, attempts + 1):
        try:
            init_db()
            # Dummy-fleet tables (dummy_history / dummy_predictions) live in the
            # same DB. app.py only creates/seeds them inside its __main__ block,
            # which gunicorn never runs — so without this the /dummy/* endpoints
            # 500 with "Table 'telematics.dummy_history' doesn't exist".
            # Both calls are idempotent (CREATE TABLE IF NOT EXISTS + seed-if-empty).
            dummy_data.init_dummy_db(DB_CONFIG)
            dummy_data.seed_if_needed(DB_CONFIG)
            print(f"[wsgi] Database schema + dummy data ready (attempt {i}).", flush=True)
            return
        except mysql.connector.Error as e:
            last_err = e
            print(f"[wsgi] MySQL not ready (attempt {i}/{attempts}): {e}", flush=True)
            time.sleep(delay)
    raise RuntimeError(
        f"Database unreachable after {attempts} attempts — check MYSQL_* env vars. "
        f"Last error: {last_err}"
    )


_init_with_retry()
start_background_watcher()  # online/offline + auto-trip-end polling (app.py has no __main__ under gunicorn)
