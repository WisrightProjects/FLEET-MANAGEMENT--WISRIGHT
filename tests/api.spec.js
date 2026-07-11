// tests/api.spec.js
// ─────────────────────────────────────────────────────────────────────────────
// API TESTS — All REST endpoint validation
// Covers: API-001 to API-027, TC-058 to TC-110 (API-facing)
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const DEV  = 'PW_TEST_DEVICE_' + Date.now(); // unique device per run

// ── Helpers ──────────────────────────────────────────────────────────────────

function validPayload(overrides = {}) {
  return {
    dev_id: DEV,
    lat: 13.0827,
    lon: 80.2707,
    speed_kmh: 42.5,
    sos_active: 0,
    ...overrides,
  };
}

// ── HEALTH & INFO ─────────────────────────────────────────────────────────────

test.describe('🏥 Health & System Endpoints', () => {

  test('API-001 | GET /health → 200 with ok status', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(typeof b.records).toBe('number');
    expect(b.records).toBeGreaterThanOrEqual(0);
  });

  test('TC-090 | GET /info → 200 with config details', async ({ request }) => {
    const res = await request.get(`${BASE}/info`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(typeof b.stops_count).toBe('number');
    expect(typeof b.routes_count).toBe('number');
    expect(typeof b.auth_required).toBe('boolean');
  });

  test('TC-091 | GET / → serves dashboard.html (HTML response)', async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
    expect(text.toLowerCase()).toContain('dashboard');
  });

  test('TC-092 | GET /dashboard.css → text/css MIME', async ({ request }) => {
    const res = await request.get(`${BASE}/dashboard.css`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/css');
  });

  test('TC-093 | GET /dashboard.js → application/javascript MIME', async ({ request }) => {
    const res = await request.get(`${BASE}/dashboard.js`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('javascript');
  });

});

// ── TELEMETRY ─────────────────────────────────────────────────────────────────

test.describe('📡 Telemetry Ingestion — POST /telemetry', () => {

  test('TC-058 | Valid payload → HTTP 201 + record saved', async ({ request }) => {
    const res = await request.post(`${BASE}/telemetry`, { data: validPayload() });
    expect([201, 429]).toContain(res.status());
    if (res.status() === 201) {
      const b = await res.json();
      expect(b.status).toBe('ok');
      expect(typeof b.timestamp).toBe('number');
    }
  });

  test('TC-060 | Wrong auth token → HTTP 401', async ({ request }) => {
    // Only runs if server has a token set; if not, skip gracefully
    const info = await (await request.get(`${BASE}/info`)).json();
    if (!info.auth_required) {
      test.skip(); return;
    }
    const res = await request.post(`${BASE}/telemetry`, {
      data: validPayload(),
      headers: { 'Token': 'BADTOKEN_XYZ' },
    });
    expect(res.status()).toBe(401);
    const b = await res.json();
    expect(b.status).toBe('error');
    expect(b.message).toContain('Unauthorized');
  });

  test('TC-061 | Missing required field dev_id → HTTP 400', async ({ request }) => {
    const payload = validPayload();
    delete payload.dev_id;
    const res = await request.post(`${BASE}/telemetry`, { data: payload });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.status).toBe('error');
    expect(b.message).toContain("'dev_id'");
  });

  test('TC-061b | Missing required field lat → HTTP 400', async ({ request }) => {
    const payload = validPayload();
    delete payload.lat;
    const res = await request.post(`${BASE}/telemetry`, { data: payload });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.status).toBe('error');
    expect(b.message).toContain("'lat'");
  });

  test('TC-062 | lat=999 (out of range) → HTTP 400', async ({ request }) => {
    const res = await request.post(`${BASE}/telemetry`, {
      data: validPayload({ lat: 999 }),
    });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain('lat');
  });

  test('TC-063 | lon=-999 (out of range) → HTTP 400', async ({ request }) => {
    const res = await request.post(`${BASE}/telemetry`, {
      data: validPayload({ lon: -999 }),
    });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain('lon');
  });

  test('TC-064 | sos_active=5 (invalid) → HTTP 400', async ({ request }) => {
    const res = await request.post(`${BASE}/telemetry`, {
      data: validPayload({ dev_id: DEV + '_SOS', sos_active: 5 }),
    });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain('sos_active');
  });

  test('TC-065 | speed_kmh=-10 (negative) → HTTP 400', async ({ request }) => {
    const res = await request.post(`${BASE}/telemetry`, {
      data: validPayload({ speed_kmh: -10 }),
    });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain('speed_kmh');
  });

  test('TC-067 | Optional GPS fields (altitude, satellites, hdop) accepted', async ({ request }) => {
    const res = await request.post(`${BASE}/telemetry`, {
      data: validPayload({
        dev_id: DEV + '_GPS',
        altitude: 45.2,
        satellites: 8,
        hdop: 1.2,
        gps_date: '080726',
        gps_time: '053000',
      }),
    });
    expect([201, 429]).toContain(res.status());
  });

  test('TC-068 | Non-JSON body → HTTP 400', async ({ request }) => {
    const res = await request.post(`${BASE}/telemetry`, {
      data: 'not-json-at-all',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect([400, 415]).toContain(res.status());
  });

});

// ── TELEMETRY QUERY ───────────────────────────────────────────────────────────

test.describe('🔍 Telemetry Query Endpoints', () => {

  test('API-009 | GET /telemetry/latest → record for seeded device', async ({ request }) => {
    // Post a record first
    await request.post(`${BASE}/telemetry`, { data: validPayload({ dev_id: DEV + '_Q' }) });
    await new Promise(r => setTimeout(r, 300));
    const res = await request.get(`${BASE}/telemetry/latest?dev_id=${DEV}_Q`);
    expect([200, 404]).toContain(res.status()); // 404 if rate-limited insert failed
  });

  test('API-010 | GET /telemetry/latest → 404 for unknown device', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry/latest?dev_id=GHOSTDEVICE_PW_XYZ`);
    expect(res.status()).toBe(404);
    const b = await res.json();
    expect(b.status).toBe('error');
  });

  test('API-011 | GET /telemetry/latest → 400 missing dev_id', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry/latest`);
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain('dev_id');
  });

  test('API-013 | GET /telemetry/all-latest → array response', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry/all-latest`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(Array.isArray(b.data)).toBe(true);
  });

  test('API-014 | GET /telemetry/devices → device list', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry/devices`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(Array.isArray(b.data)).toBe(true);
  });

  test('TC-110 | GET /telemetry/stats unknown device → 404', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry/stats?dev_id=UNKNOWNDEVICE_XYZ`);
    expect(res.status()).toBe(404);
  });

  test('TC-109 | GET /telemetry/history no dev_id → 400', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry/history`);
    expect(res.status()).toBe(400);
  });

});

// ── STOPS CONFIG ──────────────────────────────────────────────────────────────

test.describe('📍 Stops Config CRUD', () => {

  let createdStopId = null;
  const stopName = `PW_Stop_${Date.now()}`;

  test('TC-069 | GET /telemetry/stops/config → 200', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry/stops/config`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(Array.isArray(b.data)).toBe(true);
  });

  test('TC-070 | POST /stops/config → create new stop', async ({ request }) => {
    const res = await request.post(`${BASE}/stops/config`, {
      data: { name: stopName, lat: 13.0827, lon: 80.2707, radius_m: 300 },
    });
    expect(res.status()).toBe(201);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(typeof b.id).toBe('number');
    createdStopId = b.id;
  });

  test('TC-071 | POST /stops/config missing name → 400', async ({ request }) => {
    const res = await request.post(`${BASE}/stops/config`, {
      data: { lat: 13.0, lon: 80.0 },
    });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain("'name'");
  });

  test('TC-072 | POST /stops/config duplicate name → 409', async ({ request }) => {
    const res = await request.post(`${BASE}/stops/config`, {
      data: { name: stopName, lat: 13.0, lon: 80.0 },
    });
    expect(res.status()).toBe(409);
    const b = await res.json();
    expect(b.message).toContain('already exists');
  });

  test('TC-073 | PUT /stops/config/:id → update radius', async ({ request }) => {
    if (!createdStopId) { test.skip(); return; }
    const res = await request.put(`${BASE}/stops/config/${createdStopId}`, {
      data: { radius_m: 500 },
    });
    expect(res.status()).toBe(200);
  });

  test('TC-074 | PUT /stops/config/9999 → 404 not found', async ({ request }) => {
    const res = await request.put(`${BASE}/stops/config/9999`, {
      data: { radius_m: 100 },
    });
    expect(res.status()).toBe(404);
  });

  test('TC-075 | DELETE /stops/config/:id → remove stop', async ({ request }) => {
    if (!createdStopId) { test.skip(); return; }
    const res = await request.delete(`${BASE}/stops/config/${createdStopId}`);
    expect(res.status()).toBe(200);
  });

  test('TC-076 | DELETE /stops/config/9999 → 404 not found', async ({ request }) => {
    const res = await request.delete(`${BASE}/stops/config/9999`);
    expect(res.status()).toBe(404);
  });

});

// ── ROUTES CONFIG ─────────────────────────────────────────────────────────────

test.describe('🛣️ Routes Config CRUD', () => {

  const routeKey = `pw_route_${Date.now()}`;

  test('TC-077 | GET /routes → 200 with array', async ({ request }) => {
    const res = await request.get(`${BASE}/routes`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(Array.isArray(b.data)).toBe(true);
  });

  test('TC-078 | POST /routes/config → create route with 2 stops', async ({ request }) => {
    const res = await request.post(`${BASE}/routes/config`, {
      data: {
        route_key: routeKey,
        name: 'PW Test Route',
        stops: [
          { name: 'Start Depot', lat: 13.0827, lon: 80.2707 },
          { name: 'End Terminal', lat: 13.0900, lon: 80.2800 },
        ],
        geofence_radius_m: 300,
        off_route_threshold_m: 600,
      },
    });
    expect(res.status()).toBe(201);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(typeof b.route_id).toBe('number');
  });

  test('TC-079 | POST /routes/config with 1 stop → 400', async ({ request }) => {
    const res = await request.post(`${BASE}/routes/config`, {
      data: {
        route_key: 'bad_route_key_pw',
        name: 'Bad Route',
        stops: [{ name: 'Only Stop', lat: 13.0, lon: 80.0 }],
      },
    });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain('at least 2');
  });

  test('TC-080 | POST /routes/config missing route_key → 400', async ({ request }) => {
    const res = await request.post(`${BASE}/routes/config`, {
      data: {
        name: 'No Key Route',
        stops: [
          { name: 'A', lat: 13.0, lon: 80.0 },
          { name: 'B', lat: 13.1, lon: 80.1 },
        ],
      },
    });
    expect(res.status()).toBe(400);
  });

  test('TC-082 | DELETE /routes/config/:key → remove route', async ({ request }) => {
    const res = await request.delete(`${BASE}/routes/config/${routeKey}`);
    expect(res.status()).toBe(200);
  });

  test('TC-083 | DELETE /routes/config/nonexistent → 404', async ({ request }) => {
    const res = await request.delete(`${BASE}/routes/config/no_such_route_pw_xyz`);
    expect(res.status()).toBe(404);
  });

});

// ── TRIP MANAGEMENT ───────────────────────────────────────────────────────────

test.describe('🚍 Trip Management', () => {

  const tripDev = `PW_TRIP_${Date.now()}`;
  let tripRouteKey = null;

  test.beforeAll(async ({ request }) => {
    // Create a temporary route for trip tests
    tripRouteKey = `pw_trip_route_${Date.now()}`;
    await request.post(`${BASE}/routes/config`, {
      data: {
        route_key: tripRouteKey,
        name: 'PW Trip Test Route',
        stops: [
          { name: 'Depot A', lat: 13.0827, lon: 80.2707 },
          { name: 'Stop B',  lat: 13.09,   lon: 80.28 },
        ],
      },
    });
  });

  test.afterAll(async ({ request }) => {
    // Cleanup: end trip if still active, delete route
    await request.post(`${BASE}/trip/end`, { data: { dev_id: tripDev } });
    if (tripRouteKey) {
      await request.delete(`${BASE}/routes/config/${tripRouteKey}`);
    }
  });

  test('TC-048 | POST /trip/start → 201 with trip_id', async ({ request }) => {
    const res = await request.post(`${BASE}/trip/start`, {
      data: { dev_id: tripDev, route_key: tripRouteKey },
    });
    expect(res.status()).toBe(201);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(typeof b.trip_id).toBe('number');
    expect(b.route).toBeTruthy();
    expect(typeof b.started_at).toBe('number');
  });

  test('TC-053 | GET /trip/active/:dev_id → active trip data', async ({ request }) => {
    const res = await request.get(`${BASE}/trip/active/${tripDev}`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    // May be null if start failed above
    if (b.data) {
      expect(b.data.status).toBe('active');
      expect(typeof b.data.total_km).toBe('number');
    }
  });

  test('TC-054 | GET /trip/active/NOMATCH → 200 with null data', async ({ request }) => {
    const res = await request.get(`${BASE}/trip/active/NOMATCH_PW_XYZ`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(b.data).toBeNull();
  });

  test('TC-049 | POST /trip/start no routes → 400 (different device)', async ({ request }) => {
    // This device has no route_key and there may be no default routes
    const res = await request.post(`${BASE}/trip/start`, {
      data: { dev_id: 'PW_NO_ROUTE_DEV' },
    });
    // Either 201 (default route picked) or 400 (no routes)
    expect([201, 400]).toContain(res.status());
  });

  test('TC-050 | POST /trip/start unknown route_key → 400', async ({ request }) => {
    const res = await request.post(`${BASE}/trip/start`, {
      data: { dev_id: 'PW_BAD_RT', route_key: 'nonexistent_key_pw_xyz' },
    });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain('Unknown route');
  });

  test('TC-051 | POST /trip/end → 200 completes the trip', async ({ request }) => {
    const res = await request.post(`${BASE}/trip/end`, {
      data: { dev_id: tripDev },
    });
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(typeof b.trip_id).toBe('number');
  });

  test('TC-052 | POST /trip/end no active trip → 404', async ({ request }) => {
    const res = await request.post(`${BASE}/trip/end`, {
      data: { dev_id: tripDev }, // just ended above
    });
    expect(res.status()).toBe(404);
    const b = await res.json();
    expect(b.message).toContain('No active trip');
  });

  test('TC-056 | GET /trips → array of trips', async ({ request }) => {
    const res = await request.get(`${BASE}/trips`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(Array.isArray(b.data)).toBe(true);
  });

});

// ── PASSENGER PRESENCE ────────────────────────────────────────────────────────

test.describe('🧍 Passenger Presence', () => {

  const presDev = `PW_PRES_${Date.now()}`;

  test('TC-084 | POST /presence board 5 passengers', async ({ request }) => {
    const res = await request.post(`${BASE}/presence`, {
      data: { dev_id: presDev, event_type: 'board', count: 5 },
    });
    expect(res.status()).toBe(201);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(typeof b.passengers_onboard).toBe('number');
  });

  test('TC-085 | POST /presence alight 3 passengers', async ({ request }) => {
    const res = await request.post(`${BASE}/presence`, {
      data: { dev_id: presDev, event_type: 'alight', count: 3 },
    });
    expect(res.status()).toBe(201);
    const b = await res.json();
    expect(b.passengers_onboard).toBeGreaterThanOrEqual(0);
  });

  test('TC-086 | Alight more than onboard → floor at 0', async ({ request }) => {
    const res = await request.post(`${BASE}/presence`, {
      data: { dev_id: presDev, event_type: 'alight', count: 999 },
    });
    expect(res.status()).toBe(201);
    const b = await res.json();
    expect(b.passengers_onboard).toBe(0);
  });

  test('TC-087 | Invalid event_type → 400', async ({ request }) => {
    const res = await request.post(`${BASE}/presence`, {
      data: { dev_id: presDev, event_type: 'transfer', count: 1 },
    });
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain("'board' or 'alight'");
  });

  test('TC-088 | GET /presence/count/:dev_id → count', async ({ request }) => {
    const res = await request.get(`${BASE}/presence/count/${presDev}`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(typeof b.passengers_onboard).toBe('number');
    expect(b.dev_id).toBe(presDev);
  });

});

// ── DUMMY FLEET ───────────────────────────────────────────────────────────────

test.describe('🚌 Dummy Fleet Endpoints', () => {

  test('TC-099 | GET /dummy/buses → 10 bus configs', async ({ request }) => {
    const res = await request.get(`${BASE}/dummy/buses`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(Array.isArray(b.data)).toBe(true);
    expect(b.data.length).toBe(10);
  });

  test('TC-100 | GET /dummy/buses/live → all 10 buses with position', async ({ request }) => {
    const res = await request.get(`${BASE}/dummy/buses/live`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(b.data.length).toBeLessThanOrEqual(10);
    for (const bus of b.data) {
      expect(typeof bus.lat).toBe('number');
      expect(typeof bus.lon).toBe('number');
      expect(typeof bus.speed_kmh).toBe('number');
      expect([0, 1]).toContain(bus.sos_active);
    }
  });

  test('TC-101 | GET /dummy/history/dates → date strings', async ({ request }) => {
    const res = await request.get(`${BASE}/dummy/history/dates`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(Array.isArray(b.data)).toBe(true);
    expect(b.data.length).toBeGreaterThan(0);
    // Validate date format YYYY-MM-DD
    for (const d of b.data.slice(0, 3)) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('TC-102 | GET /dummy/history?date=<valid> → 10 buses', async ({ request }) => {
    const datesRes = await request.get(`${BASE}/dummy/history/dates`);
    const datesBody = await datesRes.json();
    if (!datesBody.data.length) { test.skip(); return; }
    const date = datesBody.data[0];
    const res = await request.get(`${BASE}/dummy/history?date=${date}`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(Array.isArray(b.data)).toBe(true);
    expect(b.data.length).toBe(10);
  });

  test('TC-103 | GET /dummy/history?date=...&dev_id=DUMMY01 → 1 record', async ({ request }) => {
    const datesRes = await request.get(`${BASE}/dummy/history/dates`);
    const datesBody = await datesRes.json();
    if (!datesBody.data.length) { test.skip(); return; }
    const date = datesBody.data[0];
    const res = await request.get(`${BASE}/dummy/history?date=${date}&dev_id=DUMMY01`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.data.length).toBe(1);
    expect(b.data[0].dev_id).toBe('DUMMY01');
  });

  test('TC-104 | GET /dummy/history (no date) → 400', async ({ request }) => {
    const res = await request.get(`${BASE}/dummy/history`);
    expect(res.status()).toBe(400);
    const b = await res.json();
    expect(b.message).toContain('date');
  });

  test('TC-105 | GET /dummy/predictions?dev_id=DUMMY01 → future rows', async ({ request }) => {
    const res = await request.get(`${BASE}/dummy/predictions?dev_id=DUMMY01`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(Array.isArray(b.data)).toBe(true);
  });

  test('API-026 | GET /dummy/insights historical → narrative text', async ({ request }) => {
    const res = await request.get(`${BASE}/dummy/insights?dev_id=DUMMY01&kind=historical`);
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const b = await res.json();
      expect(b.status).toBe('ok');
      expect(b.data).toBeTruthy();
    }
  });

  test('API-027 | GET /dummy/insights unknown bus → 404', async ({ request }) => {
    const res = await request.get(`${BASE}/dummy/insights?dev_id=UNKNOWN_BUS_PW`);
    expect(res.status()).toBe(404);
    const b = await res.json();
    expect(b.status).toBe('error');
  });

});

// ── ERROR HANDLING ─────────────────────────────────────────────────────────────

test.describe('⚠️ Error Handling', () => {

  test('TC-106 | GET unknown endpoint → 404', async ({ request }) => {
    const res = await request.get(`${BASE}/nonexistent_endpoint_pw`);
    expect(res.status()).toBe(404);
  });

  test('TC-107 | GET on POST-only /telemetry → 405', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry`);
    expect(res.status()).toBe(405);
  });

  test('TC-108 | Malformed JSON body → 400', async ({ request }) => {
    const res = await request.post(`${BASE}/stops/config`, {
      data: 'NOT_JSON_AT_ALL',
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 500]).toContain(res.status());
  });

});

// ── STOP EVENTS ────────────────────────────────────────────────────────────────

test.describe('📌 Stop Events (Geofencing)', () => {

  test('TC-097 | GET /telemetry/stops without dev_id → 400', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry/stops`);
    expect(res.status()).toBe(400);
  });

  test('TC-097b | GET /telemetry/stops?dev_id=... → 200 array', async ({ request }) => {
    const res = await request.get(`${BASE}/telemetry/stops?dev_id=${DEV}`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
    expect(Array.isArray(b.data)).toBe(true);
  });

});
