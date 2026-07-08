# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.js >> 📱 Responsive Design >> UI-011 | Mobile 375px — no horizontal scrollbar
- Location: tests\dashboard.spec.js:271:3

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 380
Received:    427
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - navigation [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: 🚌
      - generic [ref=e6]:
        - generic [ref=e7]: Smart Transport Dept.
        - generic [ref=e8]: IoT Live Bus Tracker · GPS Powered
    - generic [ref=e9]:
      - generic [ref=e10]: 01:02:00 pm
      - generic [ref=e11]: Wed, 8 Jul 2026
    - generic [ref=e12]: 🟢 Live
    - button "🚌 Bus Test" [ref=e13] [cursor=pointer]
  - generic [ref=e14]:
    - text: 🚌
    - generic [ref=e15]: Live GPS · Updated every second
    - heading "Know where your bus is right now" [level=1] [ref=e16]:
      - text: Know where your
      - text: bus is right now
    - paragraph [ref=e17]: Live GPS tracking across Chennai. On-board ESP32 trackers send real coordinates every 2 s — see your bus before you leave home.
    - generic [ref=e18]:
      - textbox "🔍 Enter stop or route name…" [ref=e19]:
        - /placeholder: 🔍  Enter stop or route name…
      - button "Search" [ref=e20] [cursor=pointer]
  - generic [ref=e21]:
    - generic [ref=e22]:
      - generic [ref=e23]: "13"
      - generic [ref=e24]: Buses Active
    - generic [ref=e25]:
      - generic [ref=e26]: "11"
      - generic [ref=e27]: Moving
    - generic [ref=e28]:
      - generic [ref=e29]: "2"
      - generic [ref=e30]: Stopped
    - generic [ref=e31]:
      - generic [ref=e32]: "0"
      - generic [ref=e33]: SOS Alert
  - generic [ref=e34]:
    - button "TODAY" [ref=e35] [cursor=pointer]
    - button "6th Mon" [ref=e36] [cursor=pointer]
    - button "7th Tue" [ref=e37] [cursor=pointer]
    - button "8th Wed" [ref=e38] [cursor=pointer]
    - button "9th Thu" [ref=e39] [cursor=pointer]
    - button "10th Fri" [ref=e40] [cursor=pointer]
    - button "11th Sat" [ref=e41] [cursor=pointer]
    - button "12th Sun" [ref=e42] [cursor=pointer]
    - button "13th Mon" [ref=e43] [cursor=pointer]
    - button "TODAY" [ref=e44] [cursor=pointer]
    - button "6th Mon" [ref=e45] [cursor=pointer]
    - button "7th Tue" [ref=e46] [cursor=pointer]
    - button "8th Wed" [ref=e47] [cursor=pointer]
    - button "9th Thu" [ref=e48] [cursor=pointer]
    - button "10th Fri" [ref=e49] [cursor=pointer]
    - button "11th Sat" [ref=e50] [cursor=pointer]
    - button "12th Sun" [ref=e51] [cursor=pointer]
    - button "13th Mon" [ref=e52] [cursor=pointer]
  - generic [ref=e53]:
    - generic [ref=e54]: "📅 Previous 15 days:"
    - combobox [ref=e55]:
      - option "— Select a date —" [selected]
      - option "2026-07-04"
      - option "2026-07-03"
      - option "2026-07-02"
      - option "2026-07-01"
      - option "2026-06-30"
      - option "2026-06-29"
      - option "2026-06-27"
      - option "2026-06-26"
      - option "2026-06-25"
      - option "2026-06-24"
      - option "2026-06-23"
      - option "2026-06-22"
  - generic [ref=e56]:
    - generic [ref=e57]:
      - generic [ref=e58]: 📡
      - generic [ref=e59]:
        - generic [ref=e60]: Backend offline — showing schedule
        - generic [ref=e61]: Live GPS will appear once backend connects to https://fms.wisright.com
    - generic [ref=e62]: Wednesday, 8 Jul 2026 — Bus Schedule
    - generic [ref=e63]:
      - generic [ref=e66]:
        - generic [ref=e67]:
          - generic [ref=e68]: 🌅
          - generic [ref=e69]: 8:00 AM
        - generic [ref=e70]: Morning to College
        - generic [ref=e71]: 5 buses · Scheduled
        - generic [ref=e72]:
          - generic [ref=e73]: 🚌 5 Buses
          - generic [ref=e74]: 📅 Scheduled
        - generic [ref=e75]:
          - generic [ref=e76]:
            - generic [ref=e77]: Bus A
            - generic [ref=e81]: 🚌
            - generic [ref=e82]: 43 km/h
          - generic [ref=e83]:
            - generic [ref=e84]: Bus B
            - generic [ref=e87]: 🚌
            - generic [ref=e88]: 0 km/h
          - generic [ref=e89]:
            - generic [ref=e90]: Bus C
            - generic [ref=e94]: 🚌
            - generic [ref=e95]: 36 km/h
          - generic [ref=e96]:
            - generic [ref=e97]: Bus D
            - generic [ref=e101]: 🚌
            - generic [ref=e102]: 32 km/h
          - generic [ref=e103]:
            - generic [ref=e104]: Bus E
            - generic [ref=e108]: 🚌
            - generic [ref=e109]: 37 km/h
        - button "View All & Track →" [ref=e110] [cursor=pointer]
      - generic [ref=e113]:
        - generic [ref=e114]:
          - generic [ref=e115]: 🌆
          - generic [ref=e116]: 3:00 PM
        - generic [ref=e117]: Evening Return
        - generic [ref=e118]: 5 buses · Scheduled
        - generic [ref=e119]:
          - generic [ref=e120]: 🚌 5 Buses
          - generic [ref=e121]: 📅 Scheduled
        - generic [ref=e122]:
          - generic [ref=e123]:
            - generic [ref=e124]: Bus F
            - generic [ref=e128]: 🚌
            - generic [ref=e129]: 35 km/h
          - generic [ref=e130]:
            - generic [ref=e131]: Bus G
            - generic [ref=e135]: 🚌
            - generic [ref=e136]: 30 km/h
          - generic [ref=e137]:
            - generic [ref=e138]: Bus H
            - generic [ref=e142]: 🚌
            - generic [ref=e143]: 36 km/h
          - generic [ref=e144]:
            - generic [ref=e145]: Bus I
            - generic [ref=e148]: 🚌
            - generic [ref=e149]: 0 km/h
          - generic [ref=e150]:
            - generic [ref=e151]: Bus J
            - generic [ref=e155]: 🚌
            - generic [ref=e156]: 32 km/h
        - button "View All & Track →" [ref=e157] [cursor=pointer]
  - generic [ref=e158]: "© 2026 Smart Transport Dept. | Helpline: 044-2680-1999 | Mon – Sat · 7 AM – 6 PM"
```

# Test source

```ts
  177 |       await filters.nth(i).click();
  178 |       await page.waitForTimeout(200);
  179 |     }
  180 |   });
  181 | 
  182 | });
  183 | 
  184 | // ── MAP VIEW ──────────────────────────────────────────────────────────────────
  185 | 
  186 | test.describe('🗺️ Map View', () => {
  187 | 
  188 |   test('TC-029 | Leaflet map script is loaded', async ({ page }) => {
  189 |     await page.goto(BASE);
  190 |     // Check Leaflet is defined
  191 |     const leafletLoaded = await page.evaluate(() => typeof window.L !== 'undefined');
  192 |     expect(leafletLoaded).toBe(true);
  193 |   });
  194 | 
  195 |   test('TC-029b | Leaflet map container exists in DOM', async ({ page }) => {
  196 |     await page.goto(BASE);
  197 |     await page.waitForTimeout(2000);
  198 |     const mapEl = page.locator('.leaflet-container, [id*="map"], #liveMap');
  199 |     // Map container may exist but be hidden
  200 |     const count = await mapEl.count();
  201 |     // At minimum Leaflet should be on the page
  202 |     expect(count).toBeGreaterThanOrEqual(0);
  203 |   });
  204 | 
  205 | });
  206 | 
  207 | // ── UI ELEMENTS ───────────────────────────────────────────────────────────────
  208 | 
  209 | test.describe('🎨 UI Elements & Design', () => {
  210 | 
  211 |   test.beforeEach(async ({ page }) => {
  212 |     await page.goto(BASE);
  213 |     await page.waitForTimeout(1500);
  214 |   });
  215 | 
  216 |   test('UI-001 | Navigation bar is visible', async ({ page }) => {
  217 |     const nav = page.locator('nav, .h-nav, .topnav').first();
  218 |     await expect(nav).toBeVisible();
  219 |   });
  220 | 
  221 |   test('UI-002 | Hero section with h1 visible', async ({ page }) => {
  222 |     const h1 = page.locator('h1').first();
  223 |     await expect(h1).toBeVisible();
  224 |     const text = await h1.textContent();
  225 |     expect(text.trim().length).toBeGreaterThan(5);
  226 |   });
  227 | 
  228 |   test('UI-004 | Page title is set', async ({ page }) => {
  229 |     const title = await page.title();
  230 |     expect(title.trim().length).toBeGreaterThan(5);
  231 |   });
  232 | 
  233 |   test('UI-007 | Google Fonts loaded (not default serif)', async ({ page }) => {
  234 |     const fontLinks = await page.locator('link[href*="fonts.googleapis.com"]').count();
  235 |     expect(fontLinks).toBeGreaterThanOrEqual(1);
  236 |   });
  237 | 
  238 |   test('UI-008 | Page background is dark (not white)', async ({ page }) => {
  239 |     const bgColor = await page.evaluate(() => {
  240 |       return window.getComputedStyle(document.body).backgroundColor;
  241 |     });
  242 |     // Dark background — RGB values should all be low
  243 |     // e.g. rgb(10, 14, 26) for #0a0e1a
  244 |     const match = bgColor.match(/\d+/g);
  245 |     if (match) {
  246 |       const [r, g, b] = match.map(Number);
  247 |       const brightness = (r + g + b) / 3;
  248 |       expect(brightness).toBeLessThan(100); // Dark theme
  249 |     }
  250 |   });
  251 | 
  252 |   test('UI-010 | SOS stat element is present', async ({ page }) => {
  253 |     const el = page.locator('#sSos');
  254 |     if (await el.count() === 0) { test.skip(); return; }
  255 |     const colorStyle = await el.evaluate(el => window.getComputedStyle(el).color);
  256 |     expect(colorStyle).toBeTruthy();
  257 |   });
  258 | 
  259 |   test('UI-021 | Footer is visible', async ({ page }) => {
  260 |     const footer = page.locator('.rec-footer, footer').first();
  261 |     if (await footer.count() === 0) { test.skip(); return; }
  262 |     await expect(footer).toBeVisible();
  263 |   });
  264 | 
  265 | });
  266 | 
  267 | // ── RESPONSIVE DESIGN ─────────────────────────────────────────────────────────
  268 | 
  269 | test.describe('📱 Responsive Design', () => {
  270 | 
  271 |   test('UI-011 | Mobile 375px — no horizontal scrollbar', async ({ page }) => {
  272 |     await page.setViewportSize({ width: 375, height: 812 });
  273 |     await page.goto(BASE);
  274 |     await page.waitForTimeout(1000);
  275 |     const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
  276 |     const clientWidth = await page.evaluate(() => document.body.clientWidth);
> 277 |     expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // ±5px tolerance
      |                         ^ Error: expect(received).toBeLessThanOrEqual(expected)
  278 |   });
  279 | 
  280 |   test('UI-013 | Tablet 768px — page renders without layout break', async ({ page }) => {
  281 |     await page.setViewportSize({ width: 768, height: 1024 });
  282 |     await page.goto(BASE);
  283 |     await page.waitForTimeout(1000);
  284 |     const h1 = page.locator('h1').first();
  285 |     if (await h1.count() > 0) {
  286 |       await expect(h1).toBeVisible();
  287 |     }
  288 |   });
  289 | 
  290 |   test('UI-014 | Desktop 1280px — full layout visible', async ({ page }) => {
  291 |     await page.setViewportSize({ width: 1280, height: 800 });
  292 |     await page.goto(BASE);
  293 |     await page.waitForTimeout(1000);
  294 |     await expect(page.locator('body')).toBeVisible();
  295 |   });
  296 | 
  297 | });
  298 | 
  299 | // ── LOADING STATES ─────────────────────────────────────────────────────────────
  300 | 
  301 | test.describe('⏳ Error & Loading States', () => {
  302 | 
  303 |   test('TC-089 | /health API returns proper JSON', async ({ request }) => {
  304 |     const res = await request.get(`${BASE}/health`);
  305 |     expect(res.status()).toBe(200);
  306 |     const b = await res.json();
  307 |     expect(b.status).toBe('ok');
  308 |   });
  309 | 
  310 |   test('UI-023 | Dashboard does not crash with no data', async ({ page }) => {
  311 |     const errors = [];
  312 |     page.on('pageerror', e => errors.push(e.message));
  313 |     await page.goto(BASE);
  314 |     await page.waitForTimeout(3000);
  315 |     const criticalErrors = errors.filter(e =>
  316 |       e.toLowerCase().includes('uncaught') ||
  317 |       e.toLowerCase().includes('typeerror') ||
  318 |       e.toLowerCase().includes('referenceerror')
  319 |     );
  320 |     expect(criticalErrors.length).toBe(0);
  321 |   });
  322 | 
  323 | });
  324 | 
  325 | // ── PERFORMANCE ───────────────────────────────────────────────────────────────
  326 | 
  327 | test.describe('⚡ Performance Benchmarks', () => {
  328 | 
  329 |   test('PERF-001 | Dashboard loads in under 5 seconds', async ({ page }) => {
  330 |     const start = Date.now();
  331 |     await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  332 |     const loadTime = Date.now() - start;
  333 |     console.log(`  → Dashboard load time: ${loadTime}ms`);
  334 |     expect(loadTime).toBeLessThan(5000);
  335 |   });
  336 | 
  337 |   test('PERF-006 | GET /health responds in under 1000ms', async ({ request }) => {
  338 |     const start = Date.now();
  339 |     const res = await request.get(`${BASE}/health`);
  340 |     const elapsed = Date.now() - start;
  341 |     console.log(`  → /health response time: ${elapsed}ms`);
  342 |     expect(res.status()).toBe(200);
  343 |     expect(elapsed).toBeLessThan(1000);
  344 |   });
  345 | 
  346 |   test('PERF-007 | GET /dummy/buses/live responds in under 2000ms', async ({ request }) => {
  347 |     const start = Date.now();
  348 |     const res = await request.get(`${BASE}/dummy/buses/live`);
  349 |     const elapsed = Date.now() - start;
  350 |     console.log(`  → /dummy/buses/live response time: ${elapsed}ms`);
  351 |     expect(res.status()).toBe(200);
  352 |     expect(elapsed).toBeLessThan(2000);
  353 |   });
  354 | 
  355 |   test('PERF-011 | GET /trips responds in under 2000ms', async ({ request }) => {
  356 |     const start = Date.now();
  357 |     const res = await request.get(`${BASE}/trips`);
  358 |     const elapsed = Date.now() - start;
  359 |     console.log(`  → /trips response time: ${elapsed}ms`);
  360 |     expect(res.status()).toBe(200);
  361 |     expect(elapsed).toBeLessThan(2000);
  362 |   });
  363 | 
  364 | });
  365 | 
  366 | // ── SECURITY ──────────────────────────────────────────────────────────────────
  367 | 
  368 | test.describe('🔐 Security Tests', () => {
  369 | 
  370 |   test('SEC-007 | SQL injection in dev_id query param → safe response', async ({ request }) => {
  371 |     const malicious = "' OR '1'='1";
  372 |     const res = await request.get(`${BASE}/telemetry/latest?dev_id=${encodeURIComponent(malicious)}`);
  373 |     // Should return 404 (no record) or 400, NOT 200 with data leak
  374 |     expect([400, 404]).toContain(res.status());
  375 |     const b = await res.json();
  376 |     expect(b.status).toBe('error');
  377 |   });
```