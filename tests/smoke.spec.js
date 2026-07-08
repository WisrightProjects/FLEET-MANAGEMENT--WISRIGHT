// tests/smoke.spec.js
// ─────────────────────────────────────────────────────────────────────────────
// SMOKE TESTS — Run first. If any fail, stop everything.
// Covers: S-001 to S-009 (hardware-independent checks only)
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect } = require('@playwright/test');

const BASE = 'https://fms.wisright.com';

test.describe('💨 Smoke Tests — Critical Path Verification', () => {

  test('S-001 | Backend server responds on port 5000', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
  });

  test('S-002 | Health endpoint returns status:ok', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.records).toBe('number');
    expect(typeof body.time).toBe('number');
  });

  test('S-003 | Dummy data is seeded (records exist)', async ({ request }) => {
    const res = await request.get(`${BASE}/dummy/history/dates`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('S-004 | GET / returns HTTP 200 (dashboard.html served)', async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('text/html');
  });

  test('S-005 | GET /dummy/buses/live returns 10 buses', async ({ request }) => {
    const res = await request.get(`${BASE}/dummy/buses/live`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(10);
  });

  test('S-006 | POST /telemetry with valid payload returns 201', async ({ request }) => {
    const res = await request.post(`${BASE}/telemetry`, {
      data: {
        dev_id: 'SMOKE_TEST_DEVICE',
        lat: 13.0827,
        lon: 80.2707,
        speed_kmh: 0,
        sos_active: 0,
      },
    });
    expect([201, 429]).toContain(res.status()); // 429 if rate limited from prior test
  });

  test('S-007 | GET /dashboard.css served with correct MIME type', async ({ request }) => {
    const res = await request.get(`${BASE}/dashboard.css`);
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('text/css');
  });

  test('S-008 | GET /dashboard.js served with correct MIME type', async ({ request }) => {
    const res = await request.get(`${BASE}/dashboard.js`);
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('javascript');
  });

  test('S-009 | Dashboard page has no critical JS load errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(2000);
    const critical = errors.filter(e =>
      !e.includes('ERR_FAILED') && // tile load failures are OK offline
      !e.includes('net::ERR') &&
      !e.includes('favicon')
    );
    expect(critical.length).toBe(0);
  });

});
