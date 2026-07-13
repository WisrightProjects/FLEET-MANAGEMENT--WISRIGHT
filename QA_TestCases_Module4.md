# QA TEST SUMMARY REPORT — Module 4

**Project:** IoT Smart Vehicle Telematics & Fleet Management  
**Tester:** Sri Janani B  
**Environment:** Flask 3.0 / MySQL 8.0 / Playwright / Windows 11  

### Summary Metrics
- **Total Test Cases:** 15
- **Manual Test Cases:** 15 (Target: ≥ 10) ✅
- **Automated Test Cases (Playwright):** (Pending implementation phase)
- **Passed:** 15 (100% Pass Rate) ✅

---

## 🖐️ MANUAL TEST CASES

### TC-001: Home Dashboard Loads Successfully
- **Preconditions:** Flask backend running on localhost:5000
- **Steps:** 1. Open browser 2. Navigate to localhost:5000 3. Observe UI
- **Expected:** Page loads within 3s. Nav, hero, stats, date picker visible.
- **Actual:** Page loaded. All sections visible. Stats strip shows 5 buses.
- **Status:** ✅ Pass

### TC-002: Backend Status Badge — Online/Offline
- **Preconditions:** Backend running on port 5000
- **Steps:** 1. Note badge status 2. Stop server 3. Reload dashboard
- **Expected:** Shows 🟢 Online when reachable. 🔴 Offline when stopped.
- **Actual:** Online badge shows green. After stopping, shows Offline.
- **Status:** ✅ Pass

### TC-003: Fleet Stats Strip — 5 Dummy Buses
- **Preconditions:** Dummy data seeded
- **Steps:** Observe #sBusTotal, #sMoving, #sStopped, #sSos
- **Expected:** Buses Active shows 5. SOS shows red.
- **Actual:** All 4 stats render correctly. Total = 5.
- **Status:** ✅ Pass

### TC-004: Bus Table Renders
- **Preconditions:** Dummy data seeded
- **Steps:** Navigate to bus list. Verify columns and rows.
- **Expected:** 5 dummy buses appear as table rows.
- **Actual:** 5 rows visible. DUMMY01–DUMMY05 listed.
- **Status:** ✅ Pass

### TC-005: Bus List Filters
- **Preconditions:** Bus list active
- **Steps:** Click 'Moving', 'Stopped', 'All' filters
- **Expected:** Filters correctly hide/show rows. Active filter is highlighted.
- **Actual:** Moving showed 3 buses, Stopped 2. All reset to 5.
- **Status:** ✅ Pass

### TC-006: Live Map Loads with Bus Marker
- **Preconditions:** Internet connection for OSM tiles
- **Steps:** Click 'Track' on DUMMY01. Observe map and marker.
- **Expected:** Leaflet map renders. Marker appears. Popup shows data.
- **Actual:** Map opened. Tiles loaded. Marker and popup visible.
- **Status:** ✅ Pass

### TC-007: POST /telemetry — Valid Payload
- **Preconditions:** Backend running, Token: fleet-secret-2024
- **Steps:** POST valid telemetry JSON via Postman
- **Expected:** HTTP 201 response. Record in MySQL.
- **Actual:** HTTP 201 received. Confirmed in DB.
- **Status:** ✅ Pass

### TC-008: POST /telemetry — Invalid Token
- **Preconditions:** Backend running
- **Steps:** POST with header Token: WRONG_TOKEN_XYZ
- **Expected:** HTTP 401 Unauthorized.
- **Actual:** HTTP 401 received. No record inserted.
- **Status:** ✅ Pass

### TC-009: POST /telemetry — Missing Field
- **Preconditions:** Backend running
- **Steps:** POST missing 'dev_id' field
- **Expected:** HTTP 400 Bad Request.
- **Actual:** HTTP 400 received with correct error message.
- **Status:** ✅ Pass

### TC-010: Rate Limiting
- **Preconditions:** Backend running
- **Steps:** Send 5 rapid POST /telemetry requests
- **Expected:** 3rd-5th requests return HTTP 429.
- **Actual:** Request 3 returned HTTP 429 correctly.
- **Status:** ✅ Pass

### TC-011: Add New Geofence Stop via API
- **Preconditions:** Backend running
- **Steps:** POST /stops/config with new stop data
- **Expected:** HTTP 201. Stop appears in GET /stops/config.
- **Actual:** Stop created successfully. Confirmed via GET.
- **Status:** ✅ Pass

### TC-012: Duplicate Stop Name
- **Preconditions:** Stop 'Test Depot' exists
- **Steps:** POST /stops/config with 'Test Depot'
- **Expected:** HTTP 409 Conflict.
- **Actual:** HTTP 409 received. Constraint enforced.
- **Status:** ✅ Pass

### TC-013: Historical Date Picker
- **Preconditions:** Dummy history seeded
- **Steps:** Click dropdown, select date
- **Expected:** 15 dates available. Selecting loads history data.
- **Actual:** Selected 2026-07-07. Stats loaded correctly.
- **Status:** ✅ Pass

### TC-014: Trip Management
- **Preconditions:** Backend running
- **Steps:** POST /trip/start, verify active, POST /trip/end
- **Expected:** Trip status changes from active to completed.
- **Actual:** End-to-end trip lifecycle verified successfully.
- **Status:** ✅ Pass

### TC-015: Responsive UI (Mobile)
- **Preconditions:** Dashboard loaded in dev tools (375px)
- **Steps:** Observe layout on iPhone SE resolution
- **Expected:** No horizontal scrollbar. Elements fit.
- **Actual:** Nav and stats wrap properly. No overflow.
- **Status:** ✅ Pass
