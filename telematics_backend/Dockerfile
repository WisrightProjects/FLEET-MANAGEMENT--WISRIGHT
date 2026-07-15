# ---------------------------------------------------------------------------
# Telematics Backend — production image for Coolify / VPS
# Flask app served by gunicorn. Schema init + DB-wait handled in wsgi.py.
#
# Layout: this Dockerfile builds from telematics_backend/ (the compose build
# context) and copies BOTH backend/ (Flask app) and frontend/ (dashboard
# static files) — app.py serves frontend/ via a relative path at runtime.
# ---------------------------------------------------------------------------
FROM python:3.12-slim

# Faster, quieter, no .pyc clutter
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first for better layer caching
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# App code: backend/ (app.py, wsgi.py, gunicorn_conf.py, services/) +
# frontend/ (dashboard.html/js/css)
COPY backend/ backend/
COPY frontend/ frontend/

EXPOSE 5000

# Run FROM backend/ so `gunicorn_conf.py` and `wsgi:app` resolve even if the
# platform (Coolify custom start command / Nixpacks) launches gunicorn without
# an explicit --chdir. Safe because app.py locates ../frontend via __file__,
# not the current working directory.
WORKDIR /app/backend

# IMPORTANT: single worker (see gunicorn_conf.py — in-memory trip/geofence state)
CMD ["gunicorn", "--config", "gunicorn_conf.py", "wsgi:app"]
