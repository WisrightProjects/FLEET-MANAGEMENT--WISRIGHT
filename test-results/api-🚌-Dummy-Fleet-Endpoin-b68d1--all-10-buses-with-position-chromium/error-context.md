# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api.spec.js >> 🚌 Dummy Fleet Endpoints >> TC-100 | GET /dummy/buses/live → all 10 buses with position
- Location: tests\api.spec.js:553:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected value: undefined
Received array: [0, 1]
```

# Test source

```ts
  463 |     expect(b.status).toBe('ok');
  464 |     expect(typeof b.trip_id).toBe('number');
  465 |   });
  466 | 
  467 |   test('TC-052 | POST /trip/end no active trip → 404', async ({ request }) => {
  468 |     const res = await request.post(`${BASE}/trip/end`, {
  469 |       data: { dev_id: tripDev }, // just ended above
  470 |     });
  471 |     expect(res.status()).toBe(404);
  472 |     const b = await res.json();
  473 |     expect(b.message).toContain('No active trip');
  474 |   });
  475 | 
  476 |   test('TC-056 | GET /trips → array of trips', async ({ request }) => {
  477 |     const res = await request.get(`${BASE}/trips`);
  478 |     expect(res.status()).toBe(200);
  479 |     const b = await res.json();
  480 |     expect(b.status).toBe('ok');
  481 |     expect(Array.isArray(b.data)).toBe(true);
  482 |   });
  483 | 
  484 | });
  485 | 
  486 | // ── PASSENGER PRESENCE ────────────────────────────────────────────────────────
  487 | 
  488 | test.describe('🧍 Passenger Presence', () => {
  489 | 
  490 |   const presDev = `PW_PRES_${Date.now()}`;
  491 | 
  492 |   test('TC-084 | POST /presence board 5 passengers', async ({ request }) => {
  493 |     const res = await request.post(`${BASE}/presence`, {
  494 |       data: { dev_id: presDev, event_type: 'board', count: 5 },
  495 |     });
  496 |     expect(res.status()).toBe(201);
  497 |     const b = await res.json();
  498 |     expect(b.status).toBe('ok');
  499 |     expect(typeof b.passengers_onboard).toBe('number');
  500 |   });
  501 | 
  502 |   test('TC-085 | POST /presence alight 3 passengers', async ({ request }) => {
  503 |     const res = await request.post(`${BASE}/presence`, {
  504 |       data: { dev_id: presDev, event_type: 'alight', count: 3 },
  505 |     });
  506 |     expect(res.status()).toBe(201);
  507 |     const b = await res.json();
  508 |     expect(b.passengers_onboard).toBeGreaterThanOrEqual(0);
  509 |   });
  510 | 
  511 |   test('TC-086 | Alight more than onboard → floor at 0', async ({ request }) => {
  512 |     const res = await request.post(`${BASE}/presence`, {
  513 |       data: { dev_id: presDev, event_type: 'alight', count: 999 },
  514 |     });
  515 |     expect(res.status()).toBe(201);
  516 |     const b = await res.json();
  517 |     expect(b.passengers_onboard).toBe(0);
  518 |   });
  519 | 
  520 |   test('TC-087 | Invalid event_type → 400', async ({ request }) => {
  521 |     const res = await request.post(`${BASE}/presence`, {
  522 |       data: { dev_id: presDev, event_type: 'transfer', count: 1 },
  523 |     });
  524 |     expect(res.status()).toBe(400);
  525 |     const b = await res.json();
  526 |     expect(b.message).toContain("'board' or 'alight'");
  527 |   });
  528 | 
  529 |   test('TC-088 | GET /presence/count/:dev_id → count', async ({ request }) => {
  530 |     const res = await request.get(`${BASE}/presence/count/${presDev}`);
  531 |     expect(res.status()).toBe(200);
  532 |     const b = await res.json();
  533 |     expect(b.status).toBe('ok');
  534 |     expect(typeof b.passengers_onboard).toBe('number');
  535 |     expect(b.dev_id).toBe(presDev);
  536 |   });
  537 | 
  538 | });
  539 | 
  540 | // ── DUMMY FLEET ───────────────────────────────────────────────────────────────
  541 | 
  542 | test.describe('🚌 Dummy Fleet Endpoints', () => {
  543 | 
  544 |   test('TC-099 | GET /dummy/buses → 10 bus configs', async ({ request }) => {
  545 |     const res = await request.get(`${BASE}/dummy/buses`);
  546 |     expect(res.status()).toBe(200);
  547 |     const b = await res.json();
  548 |     expect(b.status).toBe('ok');
  549 |     expect(Array.isArray(b.data)).toBe(true);
  550 |     expect(b.data.length).toBe(10);
  551 |   });
  552 | 
  553 |   test('TC-100 | GET /dummy/buses/live → all 10 buses with position', async ({ request }) => {
  554 |     const res = await request.get(`${BASE}/dummy/buses/live`);
  555 |     expect(res.status()).toBe(200);
  556 |     const b = await res.json();
  557 |     expect(b.status).toBe('ok');
  558 |     expect(b.data.length).toBeLessThanOrEqual(10);
  559 |     for (const bus of b.data) {
  560 |       expect(typeof bus.lat).toBe('number');
  561 |       expect(typeof bus.lon).toBe('number');
  562 |       expect(typeof bus.speed_kmh).toBe('number');
> 563 |       expect([0, 1]).toContain(bus.sos_active);
      |                      ^ Error: expect(received).toContain(expected) // indexOf
  564 |     }
  565 |   });
  566 | 
  567 |   test('TC-101 | GET /dummy/history/dates → date strings', async ({ request }) => {
  568 |     const res = await request.get(`${BASE}/dummy/history/dates`);
  569 |     expect(res.status()).toBe(200);
  570 |     const b = await res.json();
  571 |     expect(Array.isArray(b.data)).toBe(true);
  572 |     expect(b.data.length).toBeGreaterThan(0);
  573 |     // Validate date format YYYY-MM-DD
  574 |     for (const d of b.data.slice(0, 3)) {
  575 |       expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  576 |     }
  577 |   });
  578 | 
  579 |   test('TC-102 | GET /dummy/history?date=<valid> → 10 buses', async ({ request }) => {
  580 |     const datesRes = await request.get(`${BASE}/dummy/history/dates`);
  581 |     const datesBody = await datesRes.json();
  582 |     if (!datesBody.data.length) { test.skip(); return; }
  583 |     const date = datesBody.data[0];
  584 |     const res = await request.get(`${BASE}/dummy/history?date=${date}`);
  585 |     expect(res.status()).toBe(200);
  586 |     const b = await res.json();
  587 |     expect(b.status).toBe('ok');
  588 |     expect(Array.isArray(b.data)).toBe(true);
  589 |     expect(b.data.length).toBe(10);
  590 |   });
  591 | 
  592 |   test('TC-103 | GET /dummy/history?date=...&dev_id=DUMMY01 → 1 record', async ({ request }) => {
  593 |     const datesRes = await request.get(`${BASE}/dummy/history/dates`);
  594 |     const datesBody = await datesRes.json();
  595 |     if (!datesBody.data.length) { test.skip(); return; }
  596 |     const date = datesBody.data[0];
  597 |     const res = await request.get(`${BASE}/dummy/history?date=${date}&dev_id=DUMMY01`);
  598 |     expect(res.status()).toBe(200);
  599 |     const b = await res.json();
  600 |     expect(b.data.length).toBe(1);
  601 |     expect(b.data[0].dev_id).toBe('DUMMY01');
  602 |   });
  603 | 
  604 |   test('TC-104 | GET /dummy/history (no date) → 400', async ({ request }) => {
  605 |     const res = await request.get(`${BASE}/dummy/history`);
  606 |     expect(res.status()).toBe(400);
  607 |     const b = await res.json();
  608 |     expect(b.message).toContain('date');
  609 |   });
  610 | 
  611 |   test('TC-105 | GET /dummy/predictions?dev_id=DUMMY01 → future rows', async ({ request }) => {
  612 |     const res = await request.get(`${BASE}/dummy/predictions?dev_id=DUMMY01`);
  613 |     expect(res.status()).toBe(200);
  614 |     const b = await res.json();
  615 |     expect(b.status).toBe('ok');
  616 |     expect(Array.isArray(b.data)).toBe(true);
  617 |   });
  618 | 
  619 |   test('API-026 | GET /dummy/insights historical → narrative text', async ({ request }) => {
  620 |     const res = await request.get(`${BASE}/dummy/insights?dev_id=DUMMY01&kind=historical`);
  621 |     expect([200, 404]).toContain(res.status());
  622 |     if (res.status() === 200) {
  623 |       const b = await res.json();
  624 |       expect(b.status).toBe('ok');
  625 |       expect(b.data).toBeTruthy();
  626 |     }
  627 |   });
  628 | 
  629 |   test('API-027 | GET /dummy/insights unknown bus → 404', async ({ request }) => {
  630 |     const res = await request.get(`${BASE}/dummy/insights?dev_id=UNKNOWN_BUS_PW`);
  631 |     expect(res.status()).toBe(404);
  632 |     const b = await res.json();
  633 |     expect(b.status).toBe('error');
  634 |   });
  635 | 
  636 | });
  637 | 
  638 | // ── ERROR HANDLING ─────────────────────────────────────────────────────────────
  639 | 
  640 | test.describe('⚠️ Error Handling', () => {
  641 | 
  642 |   test('TC-106 | GET unknown endpoint → 404', async ({ request }) => {
  643 |     const res = await request.get(`${BASE}/nonexistent_endpoint_pw`);
  644 |     expect(res.status()).toBe(404);
  645 |   });
  646 | 
  647 |   test('TC-107 | GET on POST-only /telemetry → 405', async ({ request }) => {
  648 |     const res = await request.get(`${BASE}/telemetry`);
  649 |     expect(res.status()).toBe(405);
  650 |   });
  651 | 
  652 |   test('TC-108 | Malformed JSON body → 400', async ({ request }) => {
  653 |     const res = await request.post(`${BASE}/stops/config`, {
  654 |       data: 'NOT_JSON_AT_ALL',
  655 |       headers: { 'Content-Type': 'application/json' },
  656 |     });
  657 |     expect([400, 500]).toContain(res.status());
  658 |   });
  659 | 
  660 | });
  661 | 
  662 | // ── STOP EVENTS ────────────────────────────────────────────────────────────────
  663 | 
```