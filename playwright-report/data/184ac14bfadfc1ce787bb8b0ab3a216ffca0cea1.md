# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.js >> 🚌 Bus List View >> TC-023-025 | Filter buttons exist and are clickable
- Location: tests\dashboard.spec.js:170:3

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('#openBusListBtn')

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
      - generic [ref=e10]: 12:56:33 pm
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
      - generic [ref=e23]: "14"
      - generic [ref=e24]: Buses Active
    - generic [ref=e25]:
      - generic [ref=e26]: "8"
      - generic [ref=e27]: Moving
    - generic [ref=e28]:
      - generic [ref=e29]: "5"
      - generic [ref=e30]: Stopped
    - generic [ref=e31]:
      - generic [ref=e32]: "1"
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
            - generic [ref=e82]: 37 km/h
          - generic [ref=e83]:
            - generic [ref=e84]: Bus B
            - generic [ref=e88]: 🚌
            - generic [ref=e89]: 27 km/h
          - generic [ref=e90]:
            - generic [ref=e91]: Bus C
            - generic [ref=e95]: 🚌
            - generic [ref=e96]: 42 km/h
          - generic [ref=e97]:
            - generic [ref=e98]: Bus D
            - generic [ref=e101]: 🚌
            - generic [ref=e102]: 0 km/h
          - generic [ref=e103]:
            - generic [ref=e104]: Bus E
            - generic [ref=e107]: 🚌
            - generic [ref=e108]: 0 km/h
        - button "View All & Track →" [ref=e109] [cursor=pointer]
      - generic [ref=e112]:
        - generic [ref=e113]:
          - generic [ref=e114]: 🌆
          - generic [ref=e115]: 3:00 PM
        - generic [ref=e116]: Evening Return
        - generic [ref=e117]: 5 buses · Scheduled
        - generic [ref=e118]:
          - generic [ref=e119]: 🚌 5 Buses
          - generic [ref=e120]: 📅 Scheduled
        - generic [ref=e121]:
          - generic [ref=e122]:
            - generic [ref=e123]: Bus F
            - generic [ref=e127]: 🚌
            - generic [ref=e128]: 38 km/h
          - generic [ref=e129]:
            - generic [ref=e130]: Bus G
            - generic [ref=e134]: 🚌
            - generic [ref=e135]: 25 km/h
          - generic [ref=e136]:
            - generic [ref=e137]: Bus H
            - generic [ref=e141]: 🚌
            - generic [ref=e142]: 35 km/h
          - generic [ref=e143]:
            - generic [ref=e144]: Bus I
            - generic [ref=e148]: 🚌
            - generic [ref=e149]: 32 km/h
          - generic [ref=e150]:
            - generic [ref=e151]: Bus J
            - generic [ref=e155]: 🚌
            - generic [ref=e156]: 31 km/h
        - button "View All & Track →" [ref=e157] [cursor=pointer]
  - generic [ref=e158]: "© 2026 Smart Transport Dept. | Helpline: 044-2680-1999 | Mon – Sat · 7 AM – 6 PM"
```

# Test source

```ts
  59  |     if (await el.count() === 0) { test.skip(); return; }
  60  |     await expect(el).toBeVisible();
  61  |     const text = await el.textContent();
  62  |     // Should be a number or "—" (loading/offline)
  63  |     expect(text.trim()).toBeTruthy();
  64  |   });
  65  | 
  66  |   test('TC-009 | SOS stat element is visible', async ({ page }) => {
  67  |     const el = page.locator('#sSos');
  68  |     if (await el.count() === 0) { test.skip(); return; }
  69  |     await expect(el).toBeVisible();
  70  |   });
  71  | 
  72  |   test('TC-010 | Historical date picker has options', async ({ page }) => {
  73  |     const picker = page.locator('#histDateSelect');
  74  |     if (await picker.count() === 0) { test.skip(); return; }
  75  |     await expect(picker).toBeVisible();
  76  |     const optCount = await picker.locator('option').count();
  77  |     expect(optCount).toBeGreaterThan(1); // at least "— Select a date —" + real dates
  78  |   });
  79  | 
  80  | });
  81  | 
  82  | // ── NAVIGATION ────────────────────────────────────────────────────────────────
  83  | 
  84  | test.describe('🧭 Navigation', () => {
  85  | 
  86  |   test.beforeEach(async ({ page }) => {
  87  |     await page.goto(BASE);
  88  |     await waitForData(page);
  89  |   });
  90  | 
  91  |   test('TC-013 | Track button opens map view', async ({ page }) => {
  92  |     // First navigate to bus list
  93  |     const trackBtn = page.locator('button:has-text("Track"), .track-btn, [onclick*="track"]').first();
  94  |     if (await trackBtn.count() > 0) {
  95  |       await trackBtn.click();
  96  |       await page.waitForTimeout(1000);
  97  |       // Map view or map container should be visible
  98  |       const mapEl = page.locator('.leaflet-container, #map, [id*="map"]');
  99  |       if (await mapEl.count() > 0) {
  100 |         await expect(mapEl.first()).toBeVisible();
  101 |       }
  102 |     }
  103 |   });
  104 | 
  105 |   test('TC-016 | Bus Test panel opens', async ({ page }) => {
  106 |     const busTestBtn = page.locator('button:has-text("Bus Test"), .bustest-nav-btn').first();
  107 |     if (await busTestBtn.count() > 0) {
  108 |       await busTestBtn.click();
  109 |       await page.waitForTimeout(500);
  110 |       // Some panel should become visible
  111 |     }
  112 |   });
  113 | 
  114 |   test('TC-017 | Only one view active at a time', async ({ page }) => {
  115 |     // Count active views
  116 |     const activeViews = await page.locator('.view.active, .view[style*="display: block"]').count();
  117 |     expect(activeViews).toBeGreaterThanOrEqual(1);
  118 |   });
  119 | 
  120 | });
  121 | 
  122 | // ── SEARCH ─────────────────────────────────────────────────────────────────────
  123 | 
  124 | test.describe('🔍 Search Functionality', () => {
  125 | 
  126 |   test.beforeEach(async ({ page }) => {
  127 |     await page.goto(BASE);
  128 |     await waitForData(page);
  129 |   });
  130 | 
  131 |   test('TC-020 | Typing <4 chars does not trigger search', async ({ page }) => {
  132 |     const inp = page.locator('#srchIn');
  133 |     if (await inp.count() === 0) { test.skip(); return; }
  134 |     await inp.fill('AB');
  135 |     await page.waitForTimeout(300);
  136 |     // No error should be thrown
  137 |     const errors = [];
  138 |     page.on('pageerror', e => errors.push(e));
  139 |     expect(errors.length).toBe(0);
  140 |   });
  141 | 
  142 |   test('TC-018 | Search with 4+ chars executes doSearch', async ({ page }) => {
  143 |     const inp = page.locator('#srchIn');
  144 |     if (await inp.count() === 0) { test.skip(); return; }
  145 |     await inp.fill('Depot');
  146 |     await page.waitForTimeout(500);
  147 |     // No crash expected
  148 |   });
  149 | 
  150 | });
  151 | 
  152 | // ── BUS LIST VIEW ─────────────────────────────────────────────────────────────
  153 | 
  154 | test.describe('🚌 Bus List View', () => {
  155 | 
  156 |   test.beforeEach(async ({ page }) => {
  157 |     await page.goto(BASE);
  158 |     await waitForData(page);
> 159 |     await page.locator('#openBusListBtn').click();
      |                                           ^ Error: locator.click: Test timeout of 30000ms exceeded.
  160 |     await page.waitForTimeout(300);
  161 |   });
  162 | 
  163 |   test('TC-022 | Bus table body has rows', async ({ page }) => {
  164 |     const tbody = page.locator('#busTbody');
  165 |     if (await tbody.count() === 0) { test.skip(); return; }
  166 |     const rows = await tbody.locator('tr').count();
  167 |     expect(rows).toBeGreaterThanOrEqual(0); // Could be 0 if not on bus list view
  168 |   });
  169 | 
  170 |   test('TC-023-025 | Filter buttons exist and are clickable', async ({ page }) => {
  171 |     const filters = page.locator('.ftag');
  172 |     if (await filters.count() === 0) { test.skip(); return; }
  173 |     const count = await filters.count();
  174 |     expect(count).toBeGreaterThanOrEqual(4); // All, Moving, Stopped, SOS
  175 |     // Click each without error
  176 |     for (let i = 0; i < Math.min(count, 4); i++) {
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
```