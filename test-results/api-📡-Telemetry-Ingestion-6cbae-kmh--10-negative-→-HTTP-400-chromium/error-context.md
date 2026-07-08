# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api.spec.js >> 📡 Telemetry Ingestion — POST /telemetry >> TC-065 | speed_kmh=-10 (negative) → HTTP 400
- Location: tests\api.spec.js:147:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 400
Received: 429
```

# Test source

```ts
  51  |     const text = await res.text();
  52  |     expect(text).toContain('<!DOCTYPE html>');
  53  |     expect(text.toLowerCase()).toContain('dashboard');
  54  |   });
  55  | 
  56  |   test('TC-092 | GET /dashboard.css → text/css MIME', async ({ request }) => {
  57  |     const res = await request.get(`${BASE}/dashboard.css`);
  58  |     expect(res.status()).toBe(200);
  59  |     expect(res.headers()['content-type']).toContain('text/css');
  60  |   });
  61  | 
  62  |   test('TC-093 | GET /dashboard.js → application/javascript MIME', async ({ request }) => {
  63  |     const res = await request.get(`${BASE}/dashboard.js`);
  64  |     expect(res.status()).toBe(200);
  65  |     expect(res.headers()['content-type']).toContain('javascript');
  66  |   });
  67  | 
  68  | });
  69  | 
  70  | // ── TELEMETRY ─────────────────────────────────────────────────────────────────
  71  | 
  72  | test.describe('📡 Telemetry Ingestion — POST /telemetry', () => {
  73  | 
  74  |   test('TC-058 | Valid payload → HTTP 201 + record saved', async ({ request }) => {
  75  |     const res = await request.post(`${BASE}/telemetry`, { data: validPayload() });
  76  |     expect([201, 429]).toContain(res.status());
  77  |     if (res.status() === 201) {
  78  |       const b = await res.json();
  79  |       expect(b.status).toBe('ok');
  80  |       expect(typeof b.timestamp).toBe('number');
  81  |     }
  82  |   });
  83  | 
  84  |   test('TC-060 | Wrong auth token → HTTP 401', async ({ request }) => {
  85  |     // Only runs if server has a token set; if not, skip gracefully
  86  |     const info = await (await request.get(`${BASE}/info`)).json();
  87  |     if (!info.auth_required) {
  88  |       test.skip(); return;
  89  |     }
  90  |     const res = await request.post(`${BASE}/telemetry`, {
  91  |       data: validPayload(),
  92  |       headers: { 'Token': 'BADTOKEN_XYZ' },
  93  |     });
  94  |     expect(res.status()).toBe(401);
  95  |     const b = await res.json();
  96  |     expect(b.status).toBe('error');
  97  |     expect(b.message).toContain('Unauthorized');
  98  |   });
  99  | 
  100 |   test('TC-061 | Missing required field dev_id → HTTP 400', async ({ request }) => {
  101 |     const payload = validPayload();
  102 |     delete payload.dev_id;
  103 |     const res = await request.post(`${BASE}/telemetry`, { data: payload });
  104 |     expect(res.status()).toBe(400);
  105 |     const b = await res.json();
  106 |     expect(b.status).toBe('error');
  107 |     expect(b.message).toContain("'dev_id'");
  108 |   });
  109 | 
  110 |   test('TC-061b | Missing required field lat → HTTP 400', async ({ request }) => {
  111 |     const payload = validPayload();
  112 |     delete payload.lat;
  113 |     const res = await request.post(`${BASE}/telemetry`, { data: payload });
  114 |     expect(res.status()).toBe(400);
  115 |     const b = await res.json();
  116 |     expect(b.status).toBe('error');
  117 |     expect(b.message).toContain("'lat'");
  118 |   });
  119 | 
  120 |   test('TC-062 | lat=999 (out of range) → HTTP 400', async ({ request }) => {
  121 |     const res = await request.post(`${BASE}/telemetry`, {
  122 |       data: validPayload({ lat: 999 }),
  123 |     });
  124 |     expect(res.status()).toBe(400);
  125 |     const b = await res.json();
  126 |     expect(b.message).toContain('lat');
  127 |   });
  128 | 
  129 |   test('TC-063 | lon=-999 (out of range) → HTTP 400', async ({ request }) => {
  130 |     const res = await request.post(`${BASE}/telemetry`, {
  131 |       data: validPayload({ lon: -999 }),
  132 |     });
  133 |     expect(res.status()).toBe(400);
  134 |     const b = await res.json();
  135 |     expect(b.message).toContain('lon');
  136 |   });
  137 | 
  138 |   test('TC-064 | sos_active=5 (invalid) → HTTP 400', async ({ request }) => {
  139 |     const res = await request.post(`${BASE}/telemetry`, {
  140 |       data: validPayload({ dev_id: DEV + '_SOS', sos_active: 5 }),
  141 |     });
  142 |     expect(res.status()).toBe(400);
  143 |     const b = await res.json();
  144 |     expect(b.message).toContain('sos_active');
  145 |   });
  146 | 
  147 |   test('TC-065 | speed_kmh=-10 (negative) → HTTP 400', async ({ request }) => {
  148 |     const res = await request.post(`${BASE}/telemetry`, {
  149 |       data: validPayload({ speed_kmh: -10 }),
  150 |     });
> 151 |     expect(res.status()).toBe(400);
      |                          ^ Error: expect(received).toBe(expected) // Object.is equality
  152 |     const b = await res.json();
  153 |     expect(b.message).toContain('speed_kmh');
  154 |   });
  155 | 
  156 |   test('TC-067 | Optional GPS fields (altitude, satellites, hdop) accepted', async ({ request }) => {
  157 |     const res = await request.post(`${BASE}/telemetry`, {
  158 |       data: validPayload({
  159 |         dev_id: DEV + '_GPS',
  160 |         altitude: 45.2,
  161 |         satellites: 8,
  162 |         hdop: 1.2,
  163 |         gps_date: '080726',
  164 |         gps_time: '053000',
  165 |       }),
  166 |     });
  167 |     expect([201, 429]).toContain(res.status());
  168 |   });
  169 | 
  170 |   test('TC-068 | Non-JSON body → HTTP 400', async ({ request }) => {
  171 |     const res = await request.post(`${BASE}/telemetry`, {
  172 |       data: 'not-json-at-all',
  173 |       headers: { 'Content-Type': 'text/plain' },
  174 |     });
  175 |     expect([400, 415]).toContain(res.status());
  176 |   });
  177 | 
  178 | });
  179 | 
  180 | // ── TELEMETRY QUERY ───────────────────────────────────────────────────────────
  181 | 
  182 | test.describe('🔍 Telemetry Query Endpoints', () => {
  183 | 
  184 |   test('API-009 | GET /telemetry/latest → record for seeded device', async ({ request }) => {
  185 |     // Post a record first
  186 |     await request.post(`${BASE}/telemetry`, { data: validPayload({ dev_id: DEV + '_Q' }) });
  187 |     await new Promise(r => setTimeout(r, 300));
  188 |     const res = await request.get(`${BASE}/telemetry/latest?dev_id=${DEV}_Q`);
  189 |     expect([200, 404]).toContain(res.status()); // 404 if rate-limited insert failed
  190 |   });
  191 | 
  192 |   test('API-010 | GET /telemetry/latest → 404 for unknown device', async ({ request }) => {
  193 |     const res = await request.get(`${BASE}/telemetry/latest?dev_id=GHOSTDEVICE_PW_XYZ`);
  194 |     expect(res.status()).toBe(404);
  195 |     const b = await res.json();
  196 |     expect(b.status).toBe('error');
  197 |   });
  198 | 
  199 |   test('API-011 | GET /telemetry/latest → 400 missing dev_id', async ({ request }) => {
  200 |     const res = await request.get(`${BASE}/telemetry/latest`);
  201 |     expect(res.status()).toBe(400);
  202 |     const b = await res.json();
  203 |     expect(b.message).toContain('dev_id');
  204 |   });
  205 | 
  206 |   test('API-013 | GET /telemetry/all-latest → array response', async ({ request }) => {
  207 |     const res = await request.get(`${BASE}/telemetry/all-latest`);
  208 |     expect(res.status()).toBe(200);
  209 |     const b = await res.json();
  210 |     expect(b.status).toBe('ok');
  211 |     expect(Array.isArray(b.data)).toBe(true);
  212 |   });
  213 | 
  214 |   test('API-014 | GET /telemetry/devices → device list', async ({ request }) => {
  215 |     const res = await request.get(`${BASE}/telemetry/devices`);
  216 |     expect(res.status()).toBe(200);
  217 |     const b = await res.json();
  218 |     expect(b.status).toBe('ok');
  219 |     expect(Array.isArray(b.data)).toBe(true);
  220 |   });
  221 | 
  222 |   test('TC-110 | GET /telemetry/stats unknown device → 404', async ({ request }) => {
  223 |     const res = await request.get(`${BASE}/telemetry/stats?dev_id=UNKNOWNDEVICE_XYZ`);
  224 |     expect(res.status()).toBe(404);
  225 |   });
  226 | 
  227 |   test('TC-109 | GET /telemetry/history no dev_id → 400', async ({ request }) => {
  228 |     const res = await request.get(`${BASE}/telemetry/history`);
  229 |     expect(res.status()).toBe(400);
  230 |   });
  231 | 
  232 | });
  233 | 
  234 | // ── STOPS CONFIG ──────────────────────────────────────────────────────────────
  235 | 
  236 | test.describe('📍 Stops Config CRUD', () => {
  237 | 
  238 |   let createdStopId = null;
  239 |   const stopName = `PW_Stop_${Date.now()}`;
  240 | 
  241 |   test('TC-069 | GET /telemetry/stops/config → 200', async ({ request }) => {
  242 |     const res = await request.get(`${BASE}/telemetry/stops/config`);
  243 |     expect(res.status()).toBe(200);
  244 |     const b = await res.json();
  245 |     expect(b.status).toBe('ok');
  246 |     expect(Array.isArray(b.data)).toBe(true);
  247 |   });
  248 | 
  249 |   test('TC-070 | POST /stops/config → create new stop', async ({ request }) => {
  250 |     const res = await request.post(`${BASE}/stops/config`, {
  251 |       data: { name: stopName, lat: 13.0827, lon: 80.2707, radius_m: 300 },
```