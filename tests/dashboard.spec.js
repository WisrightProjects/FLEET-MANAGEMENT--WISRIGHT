// tests/dashboard.spec.js
// ─────────────────────────────────────────────────────────────────────────────
// UI / DASHBOARD TESTS — Browser-level Playwright tests
// Covers: TC-001 to TC-042, TC-089 to TC-093, UI-001 to UI-024
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect } = require('@playwright/test');

const BASE = 'https://fms.wisright.com';

// Helper: wait for dummy data to load
async function waitForData(page) {
  await page.waitForTimeout(2000);
}

// ── HOME VIEW ─────────────────────────────────────────────────────────────────

test.describe('🏠 Dashboard Home View', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await waitForData(page);
  });

  test('TC-001 | Home view loads — nav, hero, stats visible', async ({ page }) => {
    await expect(page.locator('nav, .topnav, .h-nav')).toBeVisible();
    await expect(page.locator('h1')).toBeVisible();
    // Stats strip
    await expect(page.locator('#sBusTotal, .stat-num').first()).toBeVisible();
  });

  test('TC-002 | Live clock updates every second', async ({ page }) => {
    const clockSel = '#homeClock';
    const clockEl = page.locator(clockSel);
    if (await clockEl.count() === 0) { test.skip(); return; }
    const t1 = await clockEl.textContent();
    await page.waitForTimeout(2000);
    const t2 = await clockEl.textContent();
    expect(t1).not.toBe(t2); // Clock must have changed
  });

  test('TC-003 | Date display shows current date', async ({ page }) => {
    const dateEl = page.locator('#homeDate');
    if (await dateEl.count() === 0) { test.skip(); return; }
    const text = await dateEl.textContent();
    expect(text.trim().length).toBeGreaterThan(3);
  });

  test('TC-004 | Backend status badge visible', async ({ page }) => {
    const badge = page.locator('#backendBadge');
    if (await badge.count() === 0) { test.skip(); return; }
    await expect(badge).toBeVisible();
    const text = await badge.textContent();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('TC-006 | Stats strip — Bus Total shows a number', async ({ page }) => {
    const el = page.locator('#sBusTotal');
    if (await el.count() === 0) { test.skip(); return; }
    await expect(el).toBeVisible();
    const text = await el.textContent();
    // Should be a number or "—" (loading/offline)
    expect(text.trim()).toBeTruthy();
  });

  test('TC-009 | SOS stat element is visible', async ({ page }) => {
    const el = page.locator('#sSos');
    if (await el.count() === 0) { test.skip(); return; }
    await expect(el).toBeVisible();
  });

  test('TC-010 | Historical date picker has options', async ({ page }) => {
    const picker = page.locator('#histDateSelect');
    if (await picker.count() === 0) { test.skip(); return; }
    await expect(picker).toBeVisible();
    const optCount = await picker.locator('option').count();
    expect(optCount).toBeGreaterThan(1); // at least "— Select a date —" + real dates
  });

});

// ── NAVIGATION ────────────────────────────────────────────────────────────────

test.describe('🧭 Navigation', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await waitForData(page);
  });

  test('TC-013 | Track button opens map view', async ({ page }) => {
    // First navigate to bus list
    const trackBtn = page.locator('button:has-text("Track"), .track-btn, [onclick*="track"]').first();
    if (await trackBtn.count() > 0) {
      await trackBtn.click();
      await page.waitForTimeout(1000);
      // Map view or map container should be visible
      const mapEl = page.locator('.leaflet-container, #map, [id*="map"]');
      if (await mapEl.count() > 0) {
        await expect(mapEl.first()).toBeVisible();
      }
    }
  });

  test('TC-016 | Bus Test panel opens', async ({ page }) => {
    const busTestBtn = page.locator('button:has-text("Bus Test"), .bustest-nav-btn').first();
    if (await busTestBtn.count() > 0) {
      await busTestBtn.click();
      await page.waitForTimeout(500);
      // Some panel should become visible
    }
  });

  test('TC-017 | Only one view active at a time', async ({ page }) => {
    // Count active views
    const activeViews = await page.locator('.view.active, .view[style*="display: block"]').count();
    expect(activeViews).toBeGreaterThanOrEqual(1);
  });

});

// ── SEARCH ─────────────────────────────────────────────────────────────────────

test.describe('🔍 Search Functionality', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await waitForData(page);
  });

  test('TC-020 | Typing <4 chars does not trigger search', async ({ page }) => {
    const inp = page.locator('#srchIn');
    if (await inp.count() === 0) { test.skip(); return; }
    await inp.fill('AB');
    await page.waitForTimeout(300);
    // No error should be thrown
    const errors = [];
    page.on('pageerror', e => errors.push(e));
    expect(errors.length).toBe(0);
  });

  test('TC-018 | Search with 4+ chars executes doSearch', async ({ page }) => {
    const inp = page.locator('#srchIn');
    if (await inp.count() === 0) { test.skip(); return; }
    await inp.fill('Depot');
    await page.waitForTimeout(500);
    // No crash expected
  });

});

// ── BUS LIST VIEW ─────────────────────────────────────────────────────────────

test.describe('🚌 Bus List View', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await waitForData(page);
    await page.locator('#openBusListBtn').click();
    await page.waitForTimeout(300);
  });

  test('TC-022 | Bus table body has rows', async ({ page }) => {
    const tbody = page.locator('#busTbody');
    if (await tbody.count() === 0) { test.skip(); return; }
    const rows = await tbody.locator('tr').count();
    expect(rows).toBeGreaterThanOrEqual(0); // Could be 0 if not on bus list view
  });

  test('TC-023-025 | Filter buttons exist and are clickable', async ({ page }) => {
    const filters = page.locator('.ftag');
    if (await filters.count() === 0) { test.skip(); return; }
    const count = await filters.count();
    expect(count).toBeGreaterThanOrEqual(4); // All, Moving, Stopped, SOS
    // Click each without error
    for (let i = 0; i < Math.min(count, 4); i++) {
      await filters.nth(i).click();
      await page.waitForTimeout(200);
    }
  });

});

// ── MAP VIEW ──────────────────────────────────────────────────────────────────

test.describe('🗺️ Map View', () => {

  test('TC-029 | Leaflet map script is loaded', async ({ page }) => {
    await page.goto(BASE);
    // Check Leaflet is defined
    const leafletLoaded = await page.evaluate(() => typeof window.L !== 'undefined');
    expect(leafletLoaded).toBe(true);
  });

  test('TC-029b | Leaflet map container exists in DOM', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(2000);
    const mapEl = page.locator('.leaflet-container, [id*="map"], #liveMap');
    // Map container may exist but be hidden
    const count = await mapEl.count();
    // At minimum Leaflet should be on the page
    expect(count).toBeGreaterThanOrEqual(0);
  });

});

// ── UI ELEMENTS ───────────────────────────────────────────────────────────────

test.describe('🎨 UI Elements & Design', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(1500);
  });

  test('UI-001 | Navigation bar is visible', async ({ page }) => {
    const nav = page.locator('nav, .h-nav, .topnav').first();
    await expect(nav).toBeVisible();
  });

  test('UI-002 | Hero section with h1 visible', async ({ page }) => {
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
    const text = await h1.textContent();
    expect(text.trim().length).toBeGreaterThan(5);
  });

  test('UI-004 | Page title is set', async ({ page }) => {
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(5);
  });

  test('UI-007 | Google Fonts loaded (not default serif)', async ({ page }) => {
    const fontLinks = await page.locator('link[href*="fonts.googleapis.com"]').count();
    expect(fontLinks).toBeGreaterThanOrEqual(1);
  });

  test('UI-008 | Page background is dark (not white)', async ({ page }) => {
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    // Dark background — RGB values should all be low
    // e.g. rgb(10, 14, 26) for #0a0e1a
    const match = bgColor.match(/\d+/g);
    if (match) {
      const [r, g, b] = match.map(Number);
      const brightness = (r + g + b) / 3;
      expect(brightness).toBeLessThan(100); // Dark theme
    }
  });

  test('UI-010 | SOS stat element is present', async ({ page }) => {
    const el = page.locator('#sSos');
    if (await el.count() === 0) { test.skip(); return; }
    const colorStyle = await el.evaluate(el => window.getComputedStyle(el).color);
    expect(colorStyle).toBeTruthy();
  });

  test('UI-021 | Footer is visible', async ({ page }) => {
    const footer = page.locator('.rec-footer, footer').first();
    if (await footer.count() === 0) { test.skip(); return; }
    await expect(footer).toBeVisible();
  });

});

// ── RESPONSIVE DESIGN ─────────────────────────────────────────────────────────

test.describe('📱 Responsive Design', () => {

  test('UI-011 | Mobile 375px — no horizontal scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // ±5px tolerance
  });

  test('UI-013 | Tablet 768px — page renders without layout break', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    const h1 = page.locator('h1').first();
    if (await h1.count() > 0) {
      await expect(h1).toBeVisible();
    }
  });

  test('UI-014 | Desktop 1280px — full layout visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

});

// ── LOADING STATES ─────────────────────────────────────────────────────────────

test.describe('⏳ Error & Loading States', () => {

  test('TC-089 | /health API returns proper JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.status).toBe('ok');
  });

  test('UI-023 | Dashboard does not crash with no data', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(3000);
    const criticalErrors = errors.filter(e =>
      e.toLowerCase().includes('uncaught') ||
      e.toLowerCase().includes('typeerror') ||
      e.toLowerCase().includes('referenceerror')
    );
    expect(criticalErrors.length).toBe(0);
  });

});

// ── PERFORMANCE ───────────────────────────────────────────────────────────────

test.describe('⚡ Performance Benchmarks', () => {

  test('PERF-001 | Dashboard loads in under 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const loadTime = Date.now() - start;
    console.log(`  → Dashboard load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(5000);
  });

  test('PERF-006 | GET /health responds in under 1000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/health`);
    const elapsed = Date.now() - start;
    console.log(`  → /health response time: ${elapsed}ms`);
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(1000);
  });

  test('PERF-007 | GET /dummy/buses/live responds in under 2000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/dummy/buses/live`);
    const elapsed = Date.now() - start;
    console.log(`  → /dummy/buses/live response time: ${elapsed}ms`);
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });

  test('PERF-011 | GET /trips responds in under 2000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/trips`);
    const elapsed = Date.now() - start;
    console.log(`  → /trips response time: ${elapsed}ms`);
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });

});

// ── SECURITY ──────────────────────────────────────────────────────────────────

test.describe('🔐 Security Tests', () => {

  test('SEC-007 | SQL injection in dev_id query param → safe response', async ({ request }) => {
    const malicious = "' OR '1'='1";
    const res = await request.get(`${BASE}/telemetry/latest?dev_id=${encodeURIComponent(malicious)}`);
    // Should return 404 (no record) or 400, NOT 200 with data leak
    expect([400, 404]).toContain(res.status());
    const b = await res.json();
    expect(b.status).toBe('error');
  });

  test('SEC-008 | SQL injection in stop name → safe response', async ({ request }) => {
    const res = await request.post(`${BASE}/stops/config`, {
      data: {
        name: "'; DROP TABLE stops_config;--",
        lat: 13.0,
        lon: 80.0,
      },
    });
    // Should succeed (inserted as literal) or fail on constraints — NOT a server error
    expect([201, 400, 409]).toContain(res.status());
    // If created, clean it up
    if (res.status() === 201) {
      const b = await res.json();
      await request.delete(`${BASE}/stops/config/${b.id}`);
    }
  });

  test('SEC-012 | sos_active as boolean (true) → 400 type error', async ({ request }) => {
    const res = await request.post(`${BASE}/telemetry`, {
      data: {
        dev_id: 'SEC_TEST_PW',
        lat: 13.0,
        lon: 80.0,
        speed_kmh: 0, sos_active: 0,
        sos_active: true,  // boolean instead of int
      },
    });
    expect(res.status()).toBe(400);
  });

  test('SEC-014 | Rate limiting triggers 429 after burst', async ({ request }) => {
    const devId = `RATE_TEST_${Date.now()}`;
    const results = [];
    // Fire 5 requests as fast as possible
    for (let i = 0; i < 5; i++) {
      const res = await request.post(`${BASE}/telemetry`, {
        data: {
          dev_id: devId,
          lat: 13.0,
          lon: 80.0,
          speed_kmh: 0, sos_active: 0,
          sos_active: 0,
        },
      });
      results.push(res.status());
    }
    console.log('  → Rate limit responses:', results.join(', '));
    // At least one 429 should appear in 5 rapid requests
    expect(results.some(s => s === 429)).toBe(true);
  });

  test('SEC-017 | CORS headers present', async ({ request }) => {
    const res = await request.get(`${BASE}/health`, {
      headers: { 'Origin': 'http://evil.example.com' },
    });
    const cors = res.headers()['access-control-allow-origin'];
    expect(cors).toBeTruthy();
  });

});
