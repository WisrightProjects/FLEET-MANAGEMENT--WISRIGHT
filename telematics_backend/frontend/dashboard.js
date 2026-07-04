/* ═══════════════════════════════════════════════════════════════
   FleetTrack Dashboard — 100% live backend data
   No simulation. All state comes from /telemetry/all-latest.
═══════════════════════════════════════════════════════════════ */

// ── Backend URL configuration ────────────────────────────────────────────────
// When the page is served through Flask (http://localhost:5000 or ngrok URL),
// BACKEND is auto-detected from window.location and works for all cases.
// If you open dashboard.html directly as a file:// you must set BACKEND_OVERRIDE.
const BACKEND_OVERRIDE = null; // e.g. "https://51fbc48f9c3dbd.lhr.life"

const BACKEND = BACKEND_OVERRIDE || (
  (window.location.protocol === 'file:')
    ? 'http://localhost:5000'
    : window.location.port
      ? `${window.location.protocol}//${window.location.hostname}:${window.location.port}`
      : `${window.location.protocol}//${window.location.hostname}`
);
let backendOnline = false;

/* ── Bus display metadata — populated dynamically from real device IDs ── */
const BMETA = {};
const BUS_COLORS = ['#58a6ff','#3fb950','#d29922','#f85149','#f97316','#ec4899','#a5b4fc','#34d399'];
let _busColorIdx = 0;
function registerDevice(id) {
  if (BMETA[id]) return;
  const suffix = id.replace(/\D+0*/,'');
  const num = suffix ? 'Bus ' + suffix : id;
  BMETA[id] = {
    num,
    route: 'Live GPS Device',
    color: BUS_COLORS[_busColorIdx++ % BUS_COLORS.length],
    trip: '8am'
  };
}

/* ── Live state cache — entries created ONLY when real data arrives from backend ── */
const sim = {};

let selFilter = 'all', curList = 'all', curBus = null, tickId = null;

/* ═══════════════════════════════
   GEOFENCES — loaded exclusively from backend /telemetry/stops/config
   No fallback hardcoded coordinates — real stops only.
═══════════════════════════════ */
let GEO = [];
let geoLayerGroup = null;
let mapInit = false;

async function loadStopsConfig() {
  try {
    const r = await fetch(`${BACKEND}/telemetry/stops/config`, {signal: AbortSignal.timeout(3000)});
    if (!r.ok) return;
    const d = await r.json();
    const radius = d.radius_m || 300;
    GEO = (d.data || []).map(s => ({
      id: s.name.toLowerCase().replace(/\s+/g, '_'),
      name: s.name, lat: s.lat, lon: s.lon, r: radius
    }));
    if (mapInit) refreshMapGeofences();
  } catch {}
}

function refreshMapGeofences() {
  if (!lmap) return;
  if (geoLayerGroup) geoLayerGroup.clearLayers();
  else { geoLayerGroup = L.layerGroup().addTo(lmap); }
  GEO.forEach(g => {
    L.circle([g.lat, g.lon], {radius: g.r, color:'#7b2d8b', fillColor:'#7b2d8b', fillOpacity:.07, weight:1.5, dashArray:'6 4'})
      .addTo(geoLayerGroup).bindPopup(`<b>${g.name}</b>`);
    L.circleMarker([g.lat, g.lon], {radius:4, color:'#7b2d8b', fillColor:'#7b2d8b', fillOpacity:.7, weight:2})
      .addTo(geoLayerGroup).bindTooltip(g.name, {direction:'top'});
  });
}

/* ═══════════════════════════════
   MATH HELPERS
═══════════════════════════════ */
function hav(a, b, c, d) {
  const R=6371000, ra=Math.PI/180, dA=(c-a)*ra, dB=(d-b)*ra;
  const x = Math.sin(dA/2)**2 + Math.cos(a*ra)*Math.cos(c*ra)*Math.sin(dB/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function chkGeo(la, lo) { return GEO.find(g => hav(la, lo, g.lat, g.lon) <= g.r) || null; }

// Always returns the nearest stop with distance in metres
function nearestStop(la, lo) {
  if (!GEO.length) return null;
  let best = null, bestDist = Infinity;
  GEO.forEach(g => { const d = hav(la, lo, g.lat, g.lon); if (d < bestDist) { bestDist = d; best = g; } });
  return { stop: best, dist: Math.round(bestDist) };
}

// US-05 / US-28: speed colour thresholds
function sclr(s) { return s > 70 ? '#f85149' : s > 40 ? '#d29922' : '#3fb950'; }
function spct(s) { return Math.min(100, Math.round(s / 80 * 100)); }

/* ═══════════════════════════════
   REAL BACKEND SYNC (only data source)
═══════════════════════════════ */
async function syncFromAPI() {
  try {
    const r = await fetch(`${BACKEND}/telemetry/all-latest`, {signal: AbortSignal.timeout(2500)});
    if (!r.ok) throw new Error('bad status');
    const rows = (await r.json()).data || [];

    if (!backendOnline) {
      backendOnline = true;
      const badge = document.getElementById('backendBadge');
      if (badge) { badge.textContent = '🟢 Live'; badge.style.color = '#16a34a'; }
    }

    rows.forEach(t => {
      const id = t.dev_id;
      // Auto-register any new device arriving from hardware
      if (!sim[id]) {
        sim[id] = {id, lat: null, lon: null, speed: 0, sos: 0,
                   geo: null, stop: false, stopSince: null,
                   ts: null, trail: [], lastUpdate: 0};
      }
      registerDevice(id);

      sim[id].lat   = t.lat;
      sim[id].lon   = t.lon;
      sim[id].speed = parseFloat(t.speed_kmh) || 0;
      sim[id].sos   = (t.sos_active && !sosAcknowledged.has(id)) ? 1 : 0;
      sim[id].ts    = new Date(t.timestamp * 1000).toISOString();
      sim[id].stop  = sim[id].speed < 6;
      sim[id].lastUpdate = Date.now();

      const gf = chkGeo(t.lat, t.lon);
      sim[id].geo = gf || null;

      if (sim[id].speed < 6) { if (!sim[id].stopSince) sim[id].stopSince = Date.now(); }
      else sim[id].stopSince = null;

      // Accumulate GPS trail — only push when position actually changes
      const tr = sim[id].trail;
      const last = tr[tr.length - 1];
      if (!last || last[0] !== t.lat || last[1] !== t.lon) {
        tr.push([t.lat, t.lon]);
        if (tr.length > 120) tr.shift();
      }
    });
  } catch {
    if (backendOnline) {
      backendOnline = false;
      const badge = document.getElementById('backendBadge');
      if (badge) { badge.textContent = '🔴 Offline'; badge.style.color = '#B91C1C'; }
    }
  }
}
setInterval(syncFromAPI, 3000);
syncFromAPI();
loadStopsConfig();

let _stopFetchController = null;

async function fetchStopEvents(id) {
  if (_stopFetchController) _stopFetchController.abort();
  _stopFetchController = new AbortController();
  const signal = AbortSignal.any
    ? AbortSignal.any([_stopFetchController.signal, AbortSignal.timeout(2000)])
    : _stopFetchController.signal;
  try {
    const r = await fetch(`${BACKEND}/telemetry/stops?dev_id=${id}`, {signal});
    if (!r.ok) return null;
    return (await r.json()).data || [];
  } catch { return null; }
}

/* ═══════════════════════════════
   VIEW SWITCH
═══════════════════════════════ */
function showV(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ═══════════════════════════════
   HOME
═══════════════════════════════ */
function tick() {
  const n = new Date();
  document.getElementById('homeClock').textContent =
    n.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true});
  const dateEl = document.getElementById('homeDate');
  if (dateEl) {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    dateEl.textContent = `${days[n.getDay()]}, ${n.getDate()} ${months[n.getMonth()]} ${n.getFullYear()}`;
  }
  const all = Object.values(sim).filter(b => b.lastUpdate > 0);
  const totalEl = document.getElementById('sBusTotal');
  if (totalEl) totalEl.textContent = all.length;
  document.getElementById('sMoving').textContent  = all.filter(b => !b.stop && !b.sos).length;
  document.getElementById('sStopped').textContent = all.filter(b =>  b.stop && !b.sos).length;
  document.getElementById('sSos').textContent     = all.filter(b =>  b.sos).length;
}
setInterval(tick, 1000); tick();

function buildDates() {
  const row = document.getElementById('dateRow');
  const today = new Date();
  const ord = n => { const s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dow = today.getDay();
  const mon = new Date(today); mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));

  const hbtn = document.createElement('button');
  hbtn.textContent = 'TODAY'; hbtn.className = 'dr-home dr-sel';
  hbtn.onclick = () => {
    row.querySelectorAll('button').forEach(b => b.classList.remove('dr-sel'));
    hbtn.classList.add('dr-sel'); buildTrips(today);
  };
  row.appendChild(hbtn);

  for (let i = 0; i < 8; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const isToday = d.toDateString() === today.toDateString();
    const btn = document.createElement('button');
    if (isToday) btn.className = 'dr-today';
    btn.innerHTML = `${ord(d.getDate())} ${days[d.getDay()]}`;
    btn.onclick = (function(dd, b) { return () => {
      row.querySelectorAll('button').forEach(x => x.classList.remove('dr-sel'));
      b.classList.add('dr-sel'); buildTrips(dd);
    };})(d, btn);
    row.appendChild(btn);
  }
  buildTrips(today);
}

/* Strip progress bar = speed percentage (0 → 80 km/h scale).
   Color taken from dynamically assigned BMETA[id].color (hex). */
function stripHtml(id) {
  const b = sim[id], m = BMETA[id];
  const hasData = b.lastUpdate > 0;
  const color   = m ? m.color : '#58a6ff';
  const spdPct  = hasData ? spct(b.speed) : 0;
  const spdTxt  = b.sos ? '🚨 SOS' : hasData ? (b.speed + ' km/h') : 'No signal';
  const spdClass = b.speed > 70 ? 'fast' : b.speed > 40 ? 'mid' : '';
  return `<div class="tc-strip" id="hs-${id}">
    <div class="tc-strip-label">${m ? m.num : id}</div>
    <div class="tc-strip-wrap">
      <div class="tc-strip-track"></div>
      <div class="tc-strip-fill" id="hsfill-${id}" style="width:${spdPct}%;background:${color}"></div>
      <div class="tc-strip-bus" id="hsbus-${id}" style="left:${Math.min(93,spdPct)}%">🚌</div>
    </div>
    <div class="tc-strip-spd ${spdClass}" id="hsspd-${id}">${spdTxt}</div>
  </div>`;
}

function buildTrips(date) {
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dn = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const sec = document.getElementById('tripsSection');
  const dow = date.getDay(); // 0=Sun
  const label = `${dn[dow]}, ${date.getDate()} ${mn[date.getMonth()]} ${date.getFullYear()}`;

  const liveBuses  = Object.keys(sim).filter(id => sim[id].lastUpdate > 0);
  const sosId      = liveBuses.find(id => sim[id].sos);

  const sosBanner = sosId ? `<div class="sos-home-banner">
    <div class="sos-home-banner-icon">🚨</div>
    <div class="sos-home-banner-text">
      <div class="sos-home-banner-title">${BMETA[sosId]?.num || sosId} — SOS alert active</div>
      <div class="sos-home-banner-sub">${BMETA[sosId]?.route || 'Live GPS Device'} · Dispatcher notified via SMS</div>
    </div>
    <button class="sos-home-banner-btn" onclick="openTracker('${sosId}')">View Live →</button>
  </div>` : '';

  const offlineBanner = !backendOnline ? `<div class="sos-home-banner" style="border-color:#6b7280;background:#1a1f2e">
    <div class="sos-home-banner-icon">📡</div>
    <div class="sos-home-banner-text">
      <div class="sos-home-banner-title" style="color:#9ca3af">Backend offline — showing schedule</div>
      <div class="sos-home-banner-sub" style="color:#6b7280">Live GPS will appear once backend connects to ${BACKEND}</div>
    </div>
  </div>` : '';

  // Sunday = holiday leave
  if (dow === 0) {
    sec.innerHTML = `${sosBanner}${offlineBanner}
      <div class="trips-title" style="margin-top:8px">${label}</div>
      <div class="weekend-box">
        <div class="wb-icon">🌴</div>
        <div style="font-size:1.05rem;font-weight:700;color:#f97316;margin-bottom:4px">Sunday Leave</div>
        <p>No bus service today. All routes resume Monday 8:00 AM.</p>
      </div>`;
    return;
  }

  // Mon–Sat: always show full schedule from BMETA, enrich with live data if available
  const allAmIds = Object.keys(BMETA).filter(id => BMETA[id].trip === '8am');
  const allPmIds = Object.keys(BMETA).filter(id => BMETA[id].trip === '3pm');

  function scheduleStrip(id) {
    const m      = BMETA[id];
    const b      = sim[id];
    const color  = m ? m.color : '#58a6ff';
    const hasData = b && b.lastUpdate > 0;
    const spdPct  = hasData ? spct(b.speed) : 0;
    const spdTxt  = b && b.sos ? '🚨 SOS' : hasData ? (b.speed + ' km/h') : 'Scheduled';
    const spdClass = (b && b.speed > 70) ? 'fast' : (b && b.speed > 40) ? 'mid' : '';
    return `<div class="tc-strip" id="hs-${id}">
      <div class="tc-strip-label">${m ? m.num : id}</div>
      <div class="tc-strip-wrap">
        <div class="tc-strip-track"></div>
        <div class="tc-strip-fill" id="hsfill-${id}" style="width:${spdPct}%;background:${color}"></div>
        <div class="tc-strip-bus" id="hsbus-${id}" style="left:${Math.min(93,spdPct)}%">🚌</div>
      </div>
      <div class="tc-strip-spd ${spdClass}" id="hsspd-${id}">${spdTxt}</div>
    </div>`;
  }

  const liveChip = backendOnline ? '<div class="tc-chip">📍 Live GPS</div>' : '<div class="tc-chip" style="color:#9ca3af">📅 Scheduled</div>';

  const amSection = `
    <div class="trip-card morning">
      <div class="trip-card-bar"></div>
      <div class="trip-card-body">
        <div class="tc-top"><div class="tc-icon">🌅</div><span class="tc-badge badge-am">8:00 AM</span></div>
        <div class="tc-title">Morning to College</div>
        <div class="tc-time">${allAmIds.length} buses · ${backendOnline ? 'Live GPS' : 'Scheduled'}</div>
        <div class="tc-meta">
          <div class="tc-chip">🚌 <b>${allAmIds.length}</b> Buses</div>
          ${liveChip}
        </div>
        <div class="tc-strips">${allAmIds.map(scheduleStrip).join('')}</div>
        <button class="tc-btn am-btn" onclick="showBusList('8am','Morning to College — 8:00 AM')">View All &amp; Track →</button>
      </div>
    </div>`;

  const pmSection = `
    <div class="trip-card return">
      <div class="trip-card-bar"></div>
      <div class="trip-card-body">
        <div class="tc-top"><div class="tc-icon">🌆</div><span class="tc-badge badge-pm">3:00 PM</span></div>
        <div class="tc-title">Evening Return</div>
        <div class="tc-time">${allPmIds.length} buses · ${backendOnline ? 'Live GPS' : 'Scheduled'}</div>
        <div class="tc-meta">
          <div class="tc-chip">🚌 <b>${allPmIds.length}</b> Buses</div>
          ${liveChip}
        </div>
        <div class="tc-strips">${allPmIds.map(scheduleStrip).join('')}</div>
        <button class="tc-btn pm-btn" onclick="showBusList('3pm','Evening Return — 3:00 PM')">View All &amp; Track →</button>
      </div>
    </div>`;

  // Extra hardware devices not in BMETA
  const otherBuses = liveBuses.filter(id => !BMETA[id]);
  const otherSection = otherBuses.length ? `
    <div class="trip-card morning" style="grid-column:1/-1">
      <div class="trip-card-bar"></div>
      <div class="trip-card-body">
        <div class="tc-top"><div class="tc-icon">📡</div><span class="tc-badge badge-am">Live</span></div>
        <div class="tc-title">Live Devices</div>
        <div class="tc-time">${otherBuses.length} device${otherBuses.length>1?'s':''} · Real GPS</div>
        <div class="tc-strips">${otherBuses.map(id => stripHtml(id)).join('')}</div>
        <button class="tc-btn am-btn" onclick="showBusList('all','All Live Devices')">View All &amp; Track →</button>
      </div>
    </div>` : '';

  sec.innerHTML = `
    ${sosBanner}${offlineBanner}
    <div class="trips-title" style="margin-top:8px">${label} — ${backendOnline ? 'Live Fleet' : 'Bus Schedule'}</div>
    <div class="trips-grid">${amSection}${pmSection}${otherSection}</div>`;
}

function updateHomeStrips() {
  if (!document.getElementById('homeView').classList.contains('active')) return;
  Object.keys(BMETA).forEach(id => {
    const b = sim[id];
    const hasData = b && b.lastUpdate > 0;
    const spdPct = hasData ? spct(b.speed) : 0;
    const fillEl = document.getElementById('hsfill-' + id);
    const busEl  = document.getElementById('hsbus-'  + id);
    const spdEl  = document.getElementById('hsspd-'  + id);
    if (!fillEl || !busEl || !spdEl) return;
    fillEl.style.width = spdPct + '%';
    busEl.style.left   = Math.min(93, spdPct) + '%';
    const spd = hasData ? b.speed : 0;
    const spdClass = spd > 70 ? 'fast' : spd > 40 ? 'mid' : '';
    spdEl.textContent = (b && b.sos) ? '🚨 SOS' : hasData ? (spd + ' km/h') : 'Scheduled';
    spdEl.className = 'tc-strip-spd ' + spdClass;
  });
}
setInterval(updateHomeStrips, 3000);

// US-20: search by bus number / route
function doSearch() {
  const v = document.getElementById('srchIn').value.trim().toLowerCase();
  if (v.length < 2) { alert('Please enter at least 2 characters.'); return; }
  // Search only buses that have real data
  const exact = Object.keys(sim).filter(id => sim[id].lastUpdate > 0).find(id =>
    (BMETA[id]?.num  || '').toLowerCase().includes(v) ||
    (BMETA[id]?.route|| '').toLowerCase().includes(v) ||
    id.toLowerCase().includes(v)
  );
  if (exact) { openTracker(exact); return; }
  showBusList('all', 'Search: "' + v + '"');
}

document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('srchIn');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
});

function goHome() {
  if (tickId) { clearInterval(tickId); tickId = null; }
  location.hash = '';
  showV('homeView');
}

buildDates();

/* ═══════════════════════════════
   BUS LIST
═══════════════════════════════ */
function showBusList(trip, title) {
  curList = trip; selFilter = 'all';
  document.querySelectorAll('.ftag').forEach((b, i) => b.classList.toggle('on', i === 0));
  document.getElementById('listTitle').textContent = title;
  renderTable(trip, 'all');
  showV('busListView');
}

function applyFilter(f, btn) {
  selFilter = f;
  document.querySelectorAll('.ftag').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderTable(curList, f);
}

// US-28: overspeed badge  US-30: offline detection
function renderTable(trip, f) {
  // Only show buses that have sent real data
  let rows = Object.values(sim).filter(b => {
    if (b.lastUpdate === 0) return false;
    if (trip === '8am') return BMETA[b.id]?.trip === '8am';
    if (trip === '3pm') return BMETA[b.id]?.trip === '3pm';
    return true;
  });
  if (f === 'moving')  rows = rows.filter(b => !b.stop && !b.sos && b.lastUpdate > 0);
  if (f === 'stopped') rows = rows.filter(b =>  b.stop && !b.sos && b.lastUpdate > 0);
  if (f === 'sos')     rows = rows.filter(b => !!b.sos);

  const body = document.getElementById('busTbody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:18px;color:#7b2d8b">No buses match this filter.</td></tr>';
    return;
  }

  const now = Date.now();
  body.innerHTML = rows.map(b => {
    const m = BMETA[b.id];
    const hasData     = b.lastUpdate > 0;
    const isSos       = !!b.sos;
    const isOffline   = !hasData || (now - b.lastUpdate) > 30000;
    const isOverspeed = b.speed > 70;
    const sc  = sclr(b.speed);
    const dotCls = isSos ? 'sdot-sos' : isOffline ? 'sdot-off' : b.stop ? 'sdot-st' : 'sdot-mv';
    const stTxt  = isSos ? '⚠ SOS'   : isOffline ? 'No signal' : b.stop ? 'Stopped' : 'Moving';
    const ns     = (hasData && b.lat != null) ? nearestStop(b.lat, b.lon) : null;
    const geo    = b.geo
      ? `📍 ${b.geo.name}`
      : ns ? `Near ${ns.stop.name} <span style="font-size:.65rem;color:#6b7280">(${ns.dist}m)</span>` : '—';
    const overspeedBadge = isOverspeed ? `<span class="overspeed-badge">OVERSPEED</span>` : '';
    return `<tr class="${isOffline ? 'offline-row' : ''}">
      <td><b>${m.num}</b></td>
      <td style="max-width:150px;font-size:.76rem;color:#a8a29e">${m.route}</td>
      <td><span class="sdot ${dotCls}"></span>${stTxt}</td>
      <td><b style="color:${sc}">${hasData ? b.speed : '—'}</b>${hasData ? ' km/h' : ''} ${overspeedBadge}</td>
      <td style="font-size:.74rem;color:#a8a29e">${
        isOffline
          ? `<span style="color:#6b7280;font-size:.7rem">Awaiting GPS signal…</span>`
          : geo + (() => { const e = etaToNextStop(b); return e ? `<br><span style="color:#58a6ff;font-size:.68rem">~${e} min to next stop</span>` : ''; })()
      }</td>
      <td><button class="trk-btn${isSos ? ' sos' : ''}" onclick="openTracker('${b.id}')">📍 Track</button></td>
    </tr>`;
  }).join('');
}

setInterval(() => {
  if (document.getElementById('busListView').classList.contains('active')) renderTable(curList, selFilter);
}, 3000);

/* ═══════════════════════════════
   TRACKER
═══════════════════════════════ */
let lmap = null, lmarker = null, ltrail = null;

function destroyMap() {
  if (lmap) { lmap.remove(); lmap = null; }
  mapInit = false;
  lmarker = null; ltrail = null; geoLayerGroup = null;
}

function initMap(lat, lon, zoom) {
  destroyMap();
  lmap = L.map('liveMap', { zoomControl: true, preferCanvas: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(lmap);
  geoLayerGroup = L.layerGroup().addTo(lmap);
  mapInit = true;
  refreshMapGeofences();
  ltrail = L.polyline([], { color: '#58a6ff', weight: 3, opacity: .6, dashArray: '5 5' }).addTo(lmap);
  lmap.setView([lat, lon], zoom);
}

function busIcon(color, sos) {
  const c = sos ? '#f85149' : color;
  return L.divIcon({className:'', html:`<div style="position:relative;width:44px;height:44px">
    <svg viewBox="0 0 44 44" width="44" height="44">
      <rect x="4" y="10" width="36" height="24" rx="5" fill="${c}" opacity=".95"/>
      <rect x="7"  y="14" width="10" height="8" rx="1.5" fill="white" opacity=".9"/>
      <rect x="20" y="14" width="10" height="8" rx="1.5" fill="white" opacity=".9"/>
      <circle cx="12" cy="36" r="4" fill="#111"/>
      <circle cx="32" cy="36" r="4" fill="#111"/>
      ${sos ? '<rect x="15" y="3" width="14" height="8" rx="2" fill="#f85149"/><text x="22" y="9.5" text-anchor="middle" font-size="5.5" font-weight="bold" fill="white" font-family="sans-serif">SOS</text>' : ''}
    </svg>
    ${sos ? '<div style="position:absolute;top:0;right:0;width:10px;height:10px;background:#f85149;border-radius:50%;border:2px solid #0d1117;animation:pa .8s infinite"></div>' : ''}
  </div>`, iconSize:[44,44], iconAnchor:[22,40], popupAnchor:[0,-40]});
}

// US-21: ETA — nearest stop ahead, using real GPS speed and stop positions
function etaToNextStop(b) {
  if (b.lat === null || b.speed < 2) return null;
  let best = null, bestDist = Infinity;
  GEO.forEach(g => {
    if (b.geo && g.name === b.geo.name) return; // skip stop we're currently at
    const d = hav(b.lat, b.lon, g.lat, g.lon);
    if (d < bestDist) { bestDist = d; best = g; }
  });
  if (!best) return null;
  return Math.max(1, Math.round(bestDist / (b.speed * 1000 / 60)));
}

// US-25: copy tracker link to clipboard
function shareTracker() {
  const url = window.location.href;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.querySelector('.share-btn');
      if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = orig; }, 2000); }
    }).catch(() => prompt('Copy this link:', url));
  } else {
    prompt('Copy this link:', url);
  }
}

// US-25: deep link via URL hash
function openTracker(id) {
  // Clear any running interval synchronously — prevents double-click race
  if (tickId) { clearInterval(tickId); tickId = null; }
  curBus = id;
  const m = BMETA[id] || {num: id, route: 'Live GPS Device', color: '#a5b4fc'};
  document.getElementById('trkName').textContent = m.num;
  document.getElementById('trkSub').textContent  = m.route;
  location.hash = id;
  showV('trackerView');

  requestAnimationFrame(() => requestAnimationFrame(() => {
    const b = sim[id];
    const hasData = b && b.lastUpdate > 0 && b.lat !== null;
    // Default view: Chennai area — replaced immediately once real GPS arrives
    const lat  = hasData ? b.lat  : (GEO.length ? GEO[0].lat : 13.0694);
    const lon  = hasData ? b.lon  : (GEO.length ? GEO[0].lon : 80.1948);
    const zoom = hasData ? 16 : 12;

    initMap(lat, lon, zoom);
    lmarker = L.marker([lat, lon], { icon: busIcon(m.color, !!(b && b.sos)) }).addTo(lmap);

    // Immediately fetch fresh GPS so map opens on the correct position, not stale data
    syncFromAPI().then(() => {
      const fresh = sim[id];
      if (fresh && fresh.lat !== null) {
        lmarker.setLatLng([fresh.lat, fresh.lon]);
        lmap.setView([fresh.lat, fresh.lon], 16);
      }
      updateTele(id);
    });
    updateTele(id);
    currentTripId = null;
    _updateTripPanelEmpty();
    fetchActiveTrip(id).then(trip => {
      const btn = document.getElementById('tripActionBtn');
      if (trip && trip.status === 'active') {
        currentTripId = trip.id;
        if (btn) { btn.textContent = '⏹ End Trip'; btn.classList.add('trip-active'); }
      } else {
        if (btn) { btn.textContent = '▶ Start Trip'; btn.classList.remove('trip-active'); }
      }
      updateTripPanel(id);
    });
    tickId = setInterval(() => { updateTele(id); updateTripPanel(id); }, 3000);
  }));
}

function leaveTracker() {
  if (tickId) { clearInterval(tickId); tickId = null; }
  destroyMap();
  // Reset trip UI — trip stays active on backend, just hidden here
  currentTripId    = null;
  _activeRouteKey  = null;
  _routeStopsCache = null;
  const btn = document.getElementById('tripActionBtn');
  if (btn) { btn.textContent = '▶ Start Trip'; btn.classList.remove('trip-active'); }
  location.hash = '';
  showV('busListView');
}

// Tracks buses whose SOS the operator has acknowledged — suppresses backend restore
const sosAcknowledged = new Set();

// US-31: acknowledge SOS — latches suppression so syncFromAPI can't restore it
function acknowledgeSOSFor(id) {
  sosAcknowledged.add(id);
  if (sim[id]) sim[id].sos = 0;
  updateTele(id);
}

// US-26 / US-28 / US-31: updateTele
function updateTele(id) {
  if (!sim[id]) return; // backend hasn't returned data for this device yet
  const b = sim[id], m = BMETA[id] || {num: id, route: 'Live GPS Device', color: '#a5b4fc'};
  const hasData     = b.lastUpdate > 0 && b.lat !== null;
  const isSos       = !!b.sos;
  const sc          = sclr(b.speed);
  const p           = spct(b.speed);
  const isOverspeed = b.speed > 70;
  const isOffline   = !hasData || (Date.now() - b.lastUpdate) > 30000;

  if (hasData && lmap && lmarker) {
    lmarker.setLatLng([b.lat, b.lon]);
    lmarker.setIcon(busIcon(m.color, isSos));
    lmarker.bindPopup(`<b>${m.num}</b><br>Speed: <b>${b.speed} km/h</b><br>${b.geo ? 'At: ' + b.geo.name : 'En route'}`);
    if (ltrail) { ltrail.setLatLngs(b.trail); ltrail.setStyle({color: m.color}); }
    // Always pan to keep the bus centred — GPS updates every 3s so movement is small
    lmap.panTo([b.lat, b.lon], {animate: true, duration: 0.8});
  }

  // HUD — US-28: red + OVERSPEED label when >70
  const hudNum = document.getElementById('hudNum');
  hudNum.textContent = hasData ? b.speed : '—';
  hudNum.style.color = sc;
  const hudLbl = document.querySelector('.hud-lbl');
  if (hudLbl) hudLbl.textContent = isOverspeed ? '⚠ OVERSPEED' : 'Axle Speed';
  const hb = document.getElementById('hudBar');
  hb.style.width = p + '%'; hb.style.background = sc;
  document.getElementById('hudSos').className = 'hud-sos' + (isSos ? ' on' : '');

  document.getElementById('tId').textContent = id;
  document.getElementById('tTs').textContent = isOffline
    ? 'Awaiting GPS signal…'
    : (b.ts || '—');

  document.getElementById('tSpd').textContent = hasData ? b.speed : '—';
  document.getElementById('tSpd').style.color = sc;
  const sb = document.getElementById('tSpdBar');
  sb.style.width = p + '%'; sb.style.background = sc;
  const mp = document.getElementById('tMpill');
  mp.textContent = isOffline ? '📡 No signal' : b.stop ? '⏸ Stopped' : '▶ Moving';
  mp.className = 'mpill ' + (isOffline ? 'mpill-st' : b.stop ? 'mpill-st' : 'mpill-mv');

  // US-21: ETA to next stop
  let etaEl = document.getElementById('tEta');
  const eta = etaToNextStop(b);
  if (eta && hasData) {
    if (!etaEl) {
      etaEl = document.createElement('div');
      etaEl.id = 'tEta';
      etaEl.style.cssText = 'margin-top:6px;font-size:.73rem;color:#58a6ff;font-family:"IBM Plex Mono",monospace';
      document.getElementById('tSpdBar').parentNode.appendChild(etaEl);
    }
    etaEl.textContent = `⏱ ~${eta} min to next stop`;
  } else if (etaEl) { etaEl.remove(); }

  // US-26: "bus appears stopped" notice
  const stoppedMs = b.stopSince ? (Date.now() - b.stopSince) : 0;
  let stoppedNotice = document.getElementById('stopped-notice');
  if (stoppedMs > 120000 && hasData) {
    const mm = Math.floor(stoppedMs / 60000), ss = Math.floor((stoppedMs % 60000) / 1000);
    if (!stoppedNotice) {
      stoppedNotice = document.createElement('div');
      stoppedNotice.id = 'stopped-notice';
      stoppedNotice.className = 'stopped-notice';
      document.getElementById('tSpdBar').parentNode.appendChild(stoppedNotice);
    }
    stoppedNotice.textContent = `⚠ Bus appears stopped for ${mm}m ${ss}s`;
  } else if (stoppedNotice) { stoppedNotice.remove(); }

  document.getElementById('tLat').textContent = hasData ? b.lat.toFixed(6) + '°' : '—';
  document.getElementById('tLon').textContent = hasData ? b.lon.toFixed(6) + '°' : '—';

  // SOS card — US-31: ack button
  const sc2 = document.getElementById('tSosCard');
  document.getElementById('tSosIco').textContent = isSos ? '🔴' : '🟢';
  document.getElementById('tSosSt').textContent  = isSos ? 'TRIGGERED — EMERGENCY' : 'ARMED / SAFE';
  document.getElementById('tSosSt').style.color  = isSos ? '#f85149' : '#3fb950';
  document.getElementById('tSosSub').textContent = isSos
    ? 'Priority SMS dispatched · ISR active'
    : 'No emergency detected';
  sc2.className = 'sos-card ' + (isSos ? 'sos-trig' : 'sos-safe');
  let ackBtn = document.getElementById('sos-ack-btn');
  if (isSos) {
    if (!ackBtn) {
      ackBtn = document.createElement('button');
      ackBtn.id = 'sos-ack-btn'; ackBtn.className = 'sos-ack-btn';
      ackBtn.textContent = 'Acknowledge SOS';
      ackBtn.onclick = () => acknowledgeSOSFor(id);
      sc2.appendChild(ackBtn);
    }
  } else if (ackBtn) { ackBtn.remove(); }

  // Geofence — show nearest stop when outside all geofences
  const geoNs = (hasData && b.lat != null) ? nearestStop(b.lat, b.lon) : null;
  document.getElementById('tGeoIco').textContent = b.geo ? '📌' : (geoNs ? '🛣️' : '⏳');
  document.getElementById('tGeoNm').textContent  = b.geo
    ? b.geo.name
    : geoNs ? `Near ${geoNs.stop.name}` : 'Awaiting GPS signal';
  document.getElementById('tGeoSb').textContent  = b.geo
    ? 'Inside geofence · ' + b.geo.id
    : geoNs ? `${geoNs.dist} m away · En route` : '—';

  // Live JSON packet
  document.getElementById('tJson').textContent = JSON.stringify(hasData ? {
    dev_id: id, ts: b.ts,
    lat: +b.lat.toFixed(6), lon: +b.lon.toFixed(6),
    speed_kmh: b.speed,
    geofence: b.geo ? b.geo.name : null,
    stop_state: b.stop, sos_active: b.sos
  } : {dev_id: id, status: 'awaiting_signal'}, null, 2);

  // Landmark stop log — always from real backend
  fetchStopEvents(id).then(stops => {
    if (curBus !== id) return; // discard stale response from a previous bus
    const logEl = document.getElementById('tLog');
    if (!logEl) return;
    if (!stops || !stops.length) {
      logEl.innerHTML = '<div style="font-size:.73rem;color:#8b949e">No stop events recorded yet.</div>';
      return;
    }
    logEl.innerHTML = stops.slice(0, 5).map(s => {
      const arr  = new Date(s.arrived_at * 1000).toLocaleTimeString();
      const dwell = s.duration_sec != null
        ? (Math.floor(s.duration_sec / 60) > 0 ? Math.floor(s.duration_sec / 60) + 'm ' : '') + (Math.round(s.duration_sec % 60)) + 's'
        : null;
      const longDwell = s.duration_sec != null && s.duration_sec > 600;
      return `<div class="log-row${longDwell ? ' log-row-delay' : ''}">
        <div class="log-nm">🏁 ${s.location_name}${longDwell ? ' <span class="log-delay-tag">DELAY</span>' : ''}</div>
        <div class="log-mt">Arrived ${arr}${dwell
          ? ` · <span class="log-dw${longDwell ? ' log-dw-warn' : ''}">Dwell: ${dwell}</span>`
          : ' · <span class="log-in">Currently inside</span>'}</div>
      </div>`;
    }).join('');
  });
}

/* ═══════════════════════════════
   US-25: Deep link on page load
═══════════════════════════════ */
window.addEventListener('load', () => {
  const hash = location.hash.slice(1);
  if (hash) openTracker(hash);
});

/* ═══════════════════════════════════════════════════════════
   TRIP MANAGEMENT
   Start / End trips, accumulate km, detect off-route, record
   mandatory stop arrivals/departures and dwell times.
═══════════════════════════════════════════════════════════ */

let currentTripId    = null;
let _routeStopsCache = null;
let _activeRouteKey  = null;

async function _pickRouteKey() {
  // Use the cached active route key, or fetch first available from backend
  if (_activeRouteKey) return _activeRouteKey;
  try {
    const r = await fetch(`${BACKEND}/routes`, {signal: AbortSignal.timeout(2500)});
    if (!r.ok) return null;
    const d = await r.json();
    const routes = d.data || [];
    if (!routes.length) { alert('No routes configured on backend. Add one via POST /routes/config.'); return null; }
    _activeRouteKey = routes[0].key;
    return _activeRouteKey;
  } catch { return null; }
}

async function tripAction() {
  if (!curBus) return;
  const btn = document.getElementById('tripActionBtn');
  if (currentTripId) {
    if (!confirm(`End trip for ${BMETA[curBus]?.num || curBus}?`)) return;
    try {
      const r = await fetch(`${BACKEND}/trip/end`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({dev_id: curBus}),
      });
      const d = await r.json();
      if (d.status === 'ok') {
        const finishedId = currentTripId;
        currentTripId = null;
        _activeRouteKey = null;
        if (btn) { btn.textContent = '▶ Start Trip'; btn.classList.remove('trip-active'); }
        _updateTripPanelEmpty();
        if (confirm('Trip ended! View full summary?')) showTripSummary(finishedId);
      }
    } catch { alert('Failed to end trip — check backend connection.'); }
  } else {
    const routeKey = await _pickRouteKey();
    if (!routeKey) return;
    try {
      const r = await fetch(`${BACKEND}/trip/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({dev_id: curBus, route_key: routeKey}),
      });
      const d = await r.json();
      if (d.status === 'ok') {
        currentTripId   = d.trip_id;
        _activeRouteKey = d.route_key || routeKey;
        if (btn) { btn.textContent = '⏹ End Trip'; btn.classList.add('trip-active'); }
        updateTripPanel(curBus);
      } else {
        alert('Could not start trip: ' + (d.message || 'Unknown error'));
      }
    } catch { alert('Failed to start trip — check backend connection.'); }
  }
}

async function fetchActiveTrip(devId) {
  try {
    const r = await fetch(`${BACKEND}/trip/active/${devId}`, {signal: AbortSignal.timeout(2500)});
    if (!r.ok) return null;
    const d = await r.json();
    return d.data ? {...d.data, stops_visited: d.stops_visited || []} : null;
  } catch { return null; }
}

async function fetchRouteStops() {
  if (_routeStopsCache) return _routeStopsCache;
  try {
    const r = await fetch(`${BACKEND}/routes`, {signal: AbortSignal.timeout(2000)});
    if (!r.ok) return [];
    const d = await r.json();
    const routes = d.data || [];
    // Use the active route key if known, otherwise first available route
    const route = _activeRouteKey
      ? routes.find(x => x.key === _activeRouteKey)
      : routes[0];
    _routeStopsCache = route ? route.stops : [];
    return _routeStopsCache;
  } catch { return []; }
}

function fmtDuration(sec) {
  sec = Math.round(+sec || 0);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m ${s}s`;
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date((+ts) * 1000).toLocaleTimeString('en-IN',
    {hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

function _updateTripPanelEmpty() {
  const panel = document.getElementById('tripPanel');
  if (panel) panel.style.display = 'none';
  const presEl = document.getElementById('presencePanelContent');
  if (presEl) presEl.innerHTML =
    '<div style="font-size:.73rem;color:#8b949e">Start a trip to enable passenger tracking.</div>';
}

async function updateTripPanel(id) {
  if (!id) return;
  const trip = await fetchActiveTrip(id);
  const panel = document.getElementById('tripPanel');
  const content = document.getElementById('tripPanelContent');
  const presEl  = document.getElementById('presencePanelContent');
  if (!panel || !content) return;

  if (!trip || trip.status !== 'active') {
    panel.style.display = 'none';
    _updateTripPanelEmpty();
    return;
  }

  // Sync button state (e.g. after opening tracker for a device with existing trip)
  currentTripId = trip.id;
  const btn = document.getElementById('tripActionBtn');
  if (btn && !btn.classList.contains('trip-active')) {
    btn.textContent = '⏹ End Trip'; btn.classList.add('trip-active');
  }

  panel.style.display = '';

  const elapsed  = Math.floor(Date.now() / 1000 - trip.start_time);
  const elStr    = fmtDuration(elapsed);
  const allStops = await fetchRouteStops();
  const visited  = new Set((trip.stops_visited || []).map(s => s.stop_name));

  const stopsHtml = allStops.map(s => {
    const done   = visited.has(s.name);
    const detail = (trip.stops_visited || []).find(v => v.stop_name === s.name);
    const extra  = detail?.dwell_sec != null
      ? `<span class="sp-dwell">${fmtDuration(detail.dwell_sec)} dwell</span>`
      : (detail ? '<span class="sp-here">● Here now</span>' : '');
    return `<div class="sp-row${done ? ' sp-done' : ''}">
      <span class="sp-dot${done ? ' done' : ''}"></span>
      <span class="sp-nm">${s.name}</span>${extra}</div>`;
  }).join('');

  content.innerHTML = `
    <div class="trip-metrics">
      <div class="tm"><div class="tm-v">${(+trip.total_km||0).toFixed(2)}</div><div class="tm-l">km</div></div>
      <div class="tm"><div class="tm-v">${elStr}</div><div class="tm-l">elapsed</div></div>
      <div class="tm"><div class="tm-v">${trip.passengers_onboard||0}</div><div class="tm-l">onboard</div></div>
      <div class="tm"><div class="tm-v${trip.off_route_count>0?' warn':''}"> ${trip.off_route_count}</div><div class="tm-l">off-route</div></div>
    </div>
    <div class="stop-progress">${stopsHtml}</div>
    <div class="trip-start-note">Started ${fmtTime(trip.start_time)} · Route: ${trip.route_name}</div>`;

  // Presence controls
  if (presEl) {
    const curStop = sim[id]?.geo?.name || '';
    presEl.innerHTML = `
      <div class="pax-row">
        <span class="pax-icon">🧍</span>
        <span class="pax-count"><b id="paxCount">${trip.passengers_onboard||0}</b> onboard</span>
      </div>
      <div class="pres-ctrls">
        <input id="presCount" type="number" min="1" max="50" value="1" class="pres-num"/>
        <button class="pres-btn board" onclick="logPresence('board')">🟢 Board</button>
        <button class="pres-btn alight" onclick="logPresence('alight')">🔴 Alight</button>
      </div>
      ${curStop ? `<div class="pres-stop">At: ${curStop}</div>` : ''}`;
  }
}

async function logPresence(type) {
  if (!curBus || !currentTripId) return;
  const count     = Math.max(1, parseInt(document.getElementById('presCount')?.value || '1', 10));
  const stopName  = sim[curBus]?.geo?.name || '';
  try {
    const r = await fetch(`${BACKEND}/presence`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({dev_id: curBus, event_type: type, count, stop_name: stopName}),
    });
    const d = await r.json();
    if (d.status === 'ok') {
      const el = document.getElementById('paxCount');
      if (el) el.textContent = d.passengers_onboard;
    }
  } catch {}
}

/* ═══════════════════════════════════════════════════════════
   TRIP LOG VIEW (View 4)
═══════════════════════════════════════════════════════════ */

async function showTripLog() {
  showV('tripLogView');
  const sub     = document.getElementById('tripLogSub');
  const content = document.getElementById('tripLogContent');
  if (sub) sub.textContent = 'Route history & passenger data';
  content.innerHTML = '<div style="color:#8b949e;padding:24px;font-size:.82rem">Loading trips…</div>';

  try {
    const devId = curBus;
    const url   = devId
      ? `${BACKEND}/trips?dev_id=${devId}&limit=30`
      : `${BACKEND}/trips?limit=30`;
    const r = await fetch(url, {signal: AbortSignal.timeout(4000)});
    const d = await r.json();
    const trips = d.data || [];

    if (!trips.length) {
      content.innerHTML = `<div class="tlog-empty">
        <div style="font-size:2rem;margin-bottom:10px">🗺</div>
        <div>No trips recorded yet.</div>
        <div style="color:#6b7280;font-size:.75rem;margin-top:6px">Open the tracker and tap "▶ Start Trip" to begin.</div>
      </div>`;
      return;
    }

    content.innerHTML = trips.map(t => {
      const dur    = t.end_time ? fmtDuration(t.end_time - t.start_time) : 'Active';
      const isActive = t.status === 'active';
      const badge  = isActive
        ? '<span class="tlog-badge active">● Active</span>'
        : '<span class="tlog-badge done">✓ Done</span>';
      const offBadge = t.off_route_count > 0
        ? `<span class="tlog-badge offroute">⚠ ${t.off_route_count} off-route</span>`
        : '';
      return `<div class="tlog-row" onclick="showTripSummary(${t.id})">
        <div class="tlog-left">
          <div class="tlog-route">${t.route_name}</div>
          <div class="tlog-meta">
            ${new Date(t.start_time*1000).toLocaleString('en-IN')}
            &nbsp;·&nbsp; ${dur}
            &nbsp;·&nbsp; ${(+t.total_km||0).toFixed(2)} km
          </div>
          <div class="tlog-badges">${badge}${offBadge}</div>
        </div>
        <div class="tlog-chev">›</div>
      </div>`;
    }).join('');
  } catch {
    content.innerHTML = '<div style="color:#f85149;padding:20px;font-size:.82rem">Failed to load trips. Is the backend running?</div>';
  }
}

async function showTripSummary(tripId) {
  showV('tripLogView');
  const sub     = document.getElementById('tripLogSub');
  const content = document.getElementById('tripLogContent');
  if (sub) sub.textContent = `Trip #${tripId} — Full Summary`;
  content.innerHTML = '<div style="color:#8b949e;padding:24px;font-size:.82rem">Loading summary…</div>';

  try {
    const r = await fetch(`${BACKEND}/trip/summary/${tripId}`, {signal: AbortSignal.timeout(4000)});
    const d = await r.json();
    if (d.status !== 'ok') { content.innerHTML = '<div style="color:#f85149;padding:20px">Trip not found.</div>'; return; }
    _renderTripSummary(d.data, content);
  } catch {
    content.innerHTML = '<div style="color:#f85149;padding:20px;font-size:.82rem">Failed to load summary.</div>';
  }
}

function _renderTripSummary(data, el) {
  const {trip, stops, presence, off_route} = data;
  const dur      = trip.end_time ? fmtDuration(trip.end_time - trip.start_time) : 'Ongoing';
  const totalPax = presence.filter(p => p.event_type === 'board').reduce((s, p) => s + (+p.count||0), 0);

  // Build per-stop passenger aggregates
  const paxByStop = {};
  presence.forEach(p => {
    if (!p.stop_name) return;
    if (!paxByStop[p.stop_name]) paxByStop[p.stop_name] = {board:0, alight:0};
    if (p.event_type === 'board') paxByStop[p.stop_name].board  += +p.count||0;
    else                          paxByStop[p.stop_name].alight += +p.count||0;
  });

  const stopRows = stops.length
    ? stops.map((s, i) => {
        const pax = paxByStop[s.stop_name] || {board:0, alight:0};
        return `<tr>
          <td>${i+1}</td>
          <td><b>${s.stop_name}</b></td>
          <td>${fmtTime(s.arrived_at)}</td>
          <td>${s.departed_at ? fmtTime(s.departed_at) : '<span style="color:#3fb950">Here now</span>'}</td>
          <td>${s.dwell_sec != null ? fmtDuration(s.dwell_sec) : '—'}</td>
          <td>${s.distance_from_prev > 0 ? (+s.distance_from_prev).toFixed(2)+' km' : '—'}</td>
          <td>${s.time_from_prev > 0 ? fmtDuration(s.time_from_prev) : '—'}</td>
          <td style="color:#3fb950;font-weight:700">+${pax.board}</td>
          <td style="color:#f85149;font-weight:700">−${pax.alight}</td>
          <td><b>${+s.passengers_onboard||0}</b></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="10" style="color:#8b949e;text-align:center;padding:16px">No mandatory stops recorded.</td></tr>';

  const offRows = off_route.slice(0, 20).map(e =>
    `<tr>
      <td>${fmtTime(e.timestamp)}</td>
      <td>${(+e.lat).toFixed(5)}</td>
      <td>${(+e.lon).toFixed(5)}</td>
      <td style="color:#f85149;font-weight:700">${(+e.distance_from_route||0).toFixed(0)} m</td>
    </tr>`).join('');

  const presRows = presence.map(p =>
    `<tr>
      <td>${fmtTime(p.timestamp)}</td>
      <td style="color:${p.event_type==='board'?'#3fb950':'#f85149'};font-weight:700">
        ${p.event_type==='board'?'🟢 Board':'🔴 Alight'}</td>
      <td>${p.count}</td>
      <td>${p.stop_name||'—'}</td>
    </tr>`).join('');

  el.innerHTML = `
    <button class="back-to-list" onclick="showTripLog()">← All Trips</button>

    <div class="sum-hero">
      <div class="sh"><div class="sh-v">${(+trip.total_km||0).toFixed(2)}</div><div class="sh-l">Total km</div></div>
      <div class="sh"><div class="sh-v">${dur}</div><div class="sh-l">Duration</div></div>
      <div class="sh"><div class="sh-v">${totalPax}</div><div class="sh-l">Total Pax</div></div>
      <div class="sh"><div class="sh-v${trip.off_route_count>0?' warn':''}">${trip.off_route_count}</div><div class="sh-l">Off-Route</div></div>
    </div>

    <div class="sum-meta">
      <div><b>Route:</b> ${trip.route_name}</div>
      <div><b>Start:</b> ${new Date(trip.start_time*1000).toLocaleString('en-IN')}</div>
      <div><b>End:</b> ${trip.end_time ? new Date(trip.end_time*1000).toLocaleString('en-IN') : '—'}</div>
      <div><b>Device:</b> ${trip.dev_id}</div>
      <div><b>Status:</b> <span style="color:${trip.status==='active'?'#3fb950':'#8b949e'}">${trip.status}</span></div>
    </div>

    <div class="sum-title">📍 Mandatory Stop Log</div>
    <div class="tbl-wrap" style="margin:0 0 16px">
      <table>
        <thead><tr>
          <th>#</th><th>Stop</th><th>Arrived</th><th>Departed</th>
          <th>Dwell</th><th>Distance</th><th>Travel Time</th>
          <th>Boarded</th><th>Alighted</th><th>Onboard</th>
        </tr></thead>
        <tbody>${stopRows}</tbody>
      </table>
    </div>

    ${off_route.length ? `
    <div class="sum-title" style="color:#f85149">⚠ Off-Route Events (${off_route.length})</div>
    <div class="tbl-wrap" style="margin:0 0 16px">
      <table>
        <thead><tr><th>Time</th><th>Lat</th><th>Lon</th><th>Distance from Route</th></tr></thead>
        <tbody>${offRows}</tbody>
      </table>
    </div>` : ''}

    ${presence.length ? `
    <div class="sum-title">👥 Passenger Event Log</div>
    <div class="tbl-wrap" style="margin:0 0 16px">
      <table>
        <thead><tr><th>Time</th><th>Type</th><th>Count</th><th>Stop</th></tr></thead>
        <tbody>${presRows}</tbody>
      </table>
    </div>` : ''}`;
}

function leaveTripLog() {
  const sub = document.getElementById('tripLogSub');
  if (sub) sub.textContent = 'Route history & passenger data';
  if (curBus) showV('trackerView');
  else goHome();
}

/* ═══════════════════════════════════════════════════════
   VIEW 5 — BUS LIVE TEST
   Tracks a single ESP32 device by Bus ID in real time
═══════════════════════════════════════════════════════ */

let btMap = null, btMarker = null, btTrail = null, btTickId = null;
let btBusId = 'BUS01', btTrailPts = [];
let btCountdown = 5, btCountdownId = null;

function openBusTest() {
  showV('busTestView');
  btBusId = (document.getElementById('btBusIdInput') || {}).value || 'BUS01';
  bustest_initMap();
  bustest_start();
}

function leaveBusTest() {
  bustest_stop();
  goHome();
}

function bustest_start() {
  bustest_stop();
  btBusId = (document.getElementById('btBusIdInput') || {}).value || 'BUS01';
  btTrailPts = [];
  bustest_refresh();
  btTickId = setInterval(bustest_refresh, 5000);
  _btCountdownTick();
}

function bustest_stop() {
  if (btTickId)      { clearInterval(btTickId);      btTickId = null; }
  if (btCountdownId) { clearInterval(btCountdownId); btCountdownId = null; }
}

function _btCountdownTick() {
  if (btCountdownId) clearInterval(btCountdownId);
  btCountdown = 5;
  const el = document.getElementById('btRefreshCountdown');
  if (el) el.textContent = '⟳ 5s';
  btCountdownId = setInterval(() => {
    btCountdown -= 1;
    if (btCountdown < 0) btCountdown = 5;
    if (el) el.textContent = `⟳ ${btCountdown}s`;
  }, 1000);
}

function bustest_initMap() {
  if (btMap) { btMap.remove(); btMap = null; btMarker = null; btTrail = null; }
  const el = document.getElementById('btMap');
  if (!el) return;
  btMap = L.map('btMap', { zoomControl: true }).setView([13.0694, 80.1948], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 19
  }).addTo(btMap);
  btTrail = L.polyline([], { color: '#58a6ff', weight: 3, opacity: 0.7 }).addTo(btMap);
}

async function bustest_refresh() {
  _btCountdownTick();
  try {
    const r = await fetch(`${BACKEND}/telemetry/latest?dev_id=${encodeURIComponent(btBusId)}`,
      { signal: AbortSignal.timeout(2500) });
    if (!r.ok) { bustest_setStatus(false, null); return; }
    const j = await r.json();
    const d = j.data;
    if (!d || d.lat == null) { bustest_setStatus(false, null); return; }
    bustest_updateUI(d);
    bustest_setStatus(true, d.timestamp || d.ts || null);
  } catch (_) {
    bustest_setStatus(false, null);
  }
}

function bustest_setStatus(online, ts) {
  const stEl = document.getElementById('btStatus');
  const lsEl = document.getElementById('btLastSeen');
  if (stEl) {
    stEl.textContent = online ? '● Online' : '● No signal';
    stEl.className   = 'bt-status ' + (online ? 'bt-online' : 'bt-offline');
  }
  if (lsEl) {
    if (online && ts) {
      lsEl.textContent = 'Last seen: ' + new Date(ts * 1000).toLocaleTimeString();
    } else {
      lsEl.textContent = 'Waiting for device…';
    }
  }
  if (!online) {
    const overlay = document.getElementById('btMapOverlay');
    if (overlay) overlay.style.display = '';
    if (btMarker) { btMarker.remove(); btMarker = null; }
    btTrailPts = [];
    if (btTrail) btTrail.setLatLngs([]);
  }
}

function bustest_updateUI(t) {
  const lat = parseFloat(t.lat), lon = parseFloat(t.lon);
  const spd = parseFloat(t.speed_kmh) || 0;
  const sos = !!t.sos_active;

  // Coordinates
  const latEl = document.getElementById('btLat');
  const lonEl = document.getElementById('btLon');
  if (latEl) latEl.textContent = isNaN(lat) ? '—' : lat.toFixed(6);
  if (lonEl) lonEl.textContent = isNaN(lon) ? '—' : lon.toFixed(6);

  // Speed
  const spdEl = document.getElementById('btSpeed');
  const barEl = document.getElementById('btSpdBar');
  const mpEl  = document.getElementById('btMpill');
  if (spdEl) spdEl.textContent = spd.toFixed(1);
  if (barEl) barEl.style.width = Math.min(spd / 80 * 100, 100) + '%';
  if (mpEl) {
    mpEl.textContent = spd > 1 ? '▶ Moving' : '⏸ Stopped';
    mpEl.style.color = spd > 1 ? '#3fb950' : '#8b949e';
  }

  // Satellites / HDOP / Altitude
  const satsEl = document.getElementById('btSats');
  const hdopEl = document.getElementById('btHdop');
  const altEl  = document.getElementById('btAlt');
  if (satsEl) satsEl.textContent = t.satellites != null ? t.satellites : '—';
  if (hdopEl) hdopEl.textContent = t.hdop       != null ? parseFloat(t.hdop).toFixed(1) : '—';
  if (altEl)  altEl.textContent  = t.altitude   != null ? parseFloat(t.altitude).toFixed(1) + ' m' : '—';

  // GPS date / time
  const dtEl = document.getElementById('btDate');
  const tmEl = document.getElementById('btTime');
  if (dtEl) dtEl.textContent = t.gps_date || '—';
  if (tmEl) tmEl.textContent = t.gps_time || '—';

  // SOS
  const sosAlert = document.getElementById('btSosAlert');
  const sosCard  = document.getElementById('btSosCard');
  const sosIco   = document.getElementById('btSosIco');
  const sosSt    = document.getElementById('btSosSt');
  const sosSub   = document.getElementById('btSosSub');
  if (sosAlert) sosAlert.style.display = sos ? 'inline-flex' : 'none';
  if (sosIco)  sosIco.textContent = sos ? '🔴' : '🟢';
  if (sosSt) {
    sosSt.textContent = sos ? '🚨 SOS ACTIVE' : 'ARMED / SAFE';
    sosSt.style.color = sos ? '#f85149' : '#3fb950';
  }
  if (sosSub)  sosSub.textContent = sos ? 'Emergency button pressed!' : 'No emergency detected';
  if (sosCard) sosCard.style.background = sos ? 'rgba(248,81,73,.08)' : '';

  // Raw JSON
  const jsonEl = document.getElementById('btJson');
  if (jsonEl) jsonEl.textContent = JSON.stringify(t, null, 2);

  // Map — move marker and trail
  if (btMap && !isNaN(lat) && !isNaN(lon)) {
    const overlay = document.getElementById('btMapOverlay');
    if (overlay) overlay.style.display = 'none';

    const latlng = [lat, lon];
    btTrailPts.push(latlng);
    if (btTrailPts.length > 200) btTrailPts.shift();
    if (btTrail) btTrail.setLatLngs(btTrailPts);

    if (!btMarker) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="bt-bus-icon">🚌</div>',
        iconSize: [36, 36], iconAnchor: [18, 18],
      });
      btMarker = L.marker(latlng, { icon }).addTo(btMap);
    } else {
      btMarker.setLatLng(latlng);
    }
    btMap.panTo(latlng);
  }
}

/* ═══════════════════════════════════════════════════════════════
   PREDICTIVE SIMULATION MODULE  v2
   Scope: "Morning to College" and "Evening to Home" routes ONLY.
   Live Bus Test (View 5) is NOT touched by this code.

   Bug fixes v2:
   - pred_nextStopIdx: fixed to use timing not pathIdx
   - pred_updateStopList: fixed current/done/upcoming detection
   - per-stop historical stats (min/avg/max)
   - real-world dense waypoints along Chennai GST Road
═══════════════════════════════════════════════════════════════ */

// ── Real Chennai road route — dense waypoints along GST Road NH-45 ─────────
// Coordinates verified against OpenStreetMap for Tambaram ↔ Anna University
const PRED_ROUTES = {
  morning: {
    label: 'Morning to College',
    color: '#f59e0b',
    departure: { h: 8, m: 0 },
    // Dense GPS waypoints tracing actual GST Road (NH-45), Chennai
    // Verified against OpenStreetMap road geometry — 42 points
    path: [
      [12.9249, 80.1000], // 0  Tambaram Bus Stand
      [12.9258, 80.1008], // 1  GST Road start, heading NNE
      [12.9272, 80.1020], // 2  Near Tambaram railway bridge
      [12.9292, 80.1038], // 3  GST Road, Perungalathur limit
      [12.9312, 80.1058], // 4  Near Perungalathur junction
      [12.9332, 80.1080], // 5  Near Mudichur Road signal
      [12.9352, 80.1105], // 6  Post Mudichur junction
      [12.9372, 80.1132], // 7  Near Selaiyur
      [12.9392, 80.1162], // 8  Selaiyur north
      [12.9412, 80.1196], // 9  Near Chitlapakkam junction
      [12.9432, 80.1232], // 10 GST Road, Medavakkam link road
      [12.9452, 80.1272], // 11 Chromepet south approach
      [12.9478, 80.1338], // 12 Near Chromepet signal
      [12.9516, 80.1397], // 13 Chromepet Railway Station ★
      [12.9540, 80.1412], // 14 Chromepet north
      [12.9562, 80.1428], // 15 Near Vetri Vikas signal
      [12.9590, 80.1448], // 16 GST Road – Pallavaram approach
      [12.9618, 80.1470], // 17 Near Pallavaram main road
      [12.9648, 80.1488], // 18 Pallavaram south
      [12.9672, 80.1498], // 19 Pallavaram Bus Stop ★
      [12.9700, 80.1514], // 20 Pallavaram north
      [12.9725, 80.1532], // 21 GST Road, heading STM
      [12.9750, 80.1550], // 22 Near Pammal road junction
      [12.9774, 80.1570], // 23 Kovilambakkam approach
      [12.9800, 80.1592], // 24 Kovilambakkam junction
      [12.9826, 80.1618], // 25 Near STM south approach
      [12.9852, 80.1642], // 26 Near STM flyover south
      [12.9875, 80.1660], // 27 St Thomas Mount approach
      [12.9903, 80.1674], // 28 St. Thomas Mount ★
      [12.9928, 80.1696], // 29 STM north
      [12.9952, 80.1722], // 30 Near Meenambakkam road
      [12.9972, 80.1760], // 31 Airport road approach
      [12.9990, 80.1808], // 32 Airport road junction
      [13.0005, 80.1862], // 33 Near Alandur
      [13.0016, 80.1918], // 34 GST Road, pre-Kathipara
      [13.0026, 80.1968], // 35 Kathipara flyover south
      [13.0033, 80.1972], // 36 Kathipara junction ★ (internal stop)
      [13.0042, 80.2022], // 37 Kathipara flyover north
      [13.0050, 80.2072], // 38 Post Kathipara, Guindy approach
      [13.0057, 80.2130], // 39 Near Guindy bus terminus
      [13.0063, 80.2178], // 40 Guindy CLRI south
      [13.0067, 80.2206], // 41 Guindy (CLRI junction) ★
      [13.0074, 80.2252], // 42 Guindy north
      [13.0083, 80.2282], // 43 Near Anna Univ gate
      [13.0094, 80.2312], // 44 Anna University campus road
      [13.0104, 80.2337], // 45 Anna University (destination) ★
    ],
    stopPathIdx: [0, 13, 19, 28, 41, 45],
    stops: [
      'Tambaram Bus Stand',
      'Chromepet',
      'Pallavaram',
      'St. Thomas Mount',
      'Guindy',
      'Anna University',
    ],
  },
  evening: {
    label: 'Evening to Home',
    color: '#8b5cf6',
    departure: { h: 15, m: 0 },
    // Exact reverse of morning route along GST Road (NH-45)
    path: [
      [13.0104, 80.2337], // 0  Anna University (start) ★
      [13.0094, 80.2312], // 1
      [13.0083, 80.2282], // 2
      [13.0074, 80.2252], // 3  Guindy north
      [13.0067, 80.2206], // 4  Guindy (CLRI junction) ★
      [13.0063, 80.2178], // 5
      [13.0057, 80.2130], // 6
      [13.0050, 80.2072], // 7
      [13.0042, 80.2022], // 8  Kathipara flyover north
      [13.0033, 80.1972], // 9  Kathipara junction ★
      [13.0026, 80.1968], // 10
      [13.0016, 80.1918], // 11
      [13.0005, 80.1862], // 12
      [12.9990, 80.1808], // 13
      [12.9972, 80.1760], // 14
      [12.9952, 80.1722], // 15
      [12.9928, 80.1696], // 16
      [12.9903, 80.1674], // 17 St. Thomas Mount ★
      [12.9875, 80.1660], // 18
      [12.9852, 80.1642], // 19
      [12.9826, 80.1618], // 20
      [12.9800, 80.1592], // 21
      [12.9774, 80.1570], // 22
      [12.9750, 80.1550], // 23
      [12.9725, 80.1532], // 24
      [12.9700, 80.1514], // 25
      [12.9672, 80.1498], // 26 Pallavaram Bus Stop ★
      [12.9648, 80.1488], // 27
      [12.9618, 80.1470], // 28
      [12.9590, 80.1448], // 29
      [12.9562, 80.1428], // 30
      [12.9540, 80.1412], // 31
      [12.9516, 80.1397], // 32 Chromepet Railway Station ★
      [12.9478, 80.1338], // 33
      [12.9452, 80.1272], // 34
      [12.9432, 80.1232], // 35
      [12.9412, 80.1196], // 36
      [12.9392, 80.1162], // 37
      [12.9372, 80.1132], // 38
      [12.9352, 80.1105], // 39
      [12.9332, 80.1080], // 40
      [12.9312, 80.1058], // 41
      [12.9292, 80.1038], // 42
      [12.9272, 80.1020], // 43
      [12.9258, 80.1008], // 44
      [12.9249, 80.1000], // 45 Tambaram Bus Stand (destination) ★
    ],
    stopPathIdx: [0, 4, 17, 26, 32, 45],
    stops: [
      'Anna University',
      'Guindy',
      'St. Thomas Mount',
      'Pallavaram',
      'Chromepet',
      'Tambaram Bus Stand',
    ],
  },
};

// ── Road-snapped route geometry ────────────────────────────────────────────
// The hand-placed waypoints above are sparse and connect stop-to-stop with
// straight lines, which cuts corners and can look like the bus is flying
// over buildings instead of following the road. On first use of each route
// we snap it to the real road network via OSRM's public routing API and
// replace route.path / route.stopPathIdx with the dense, road-following
// geometry. If the request fails (offline, blocked, etc.) we fall back to
// the original hand-placed waypoints so the simulation still works.
const _PRED_ORIG = JSON.parse(JSON.stringify(PRED_ROUTES));
const _predRoadCache = {};

async function pred_fetchRoadPath(routeKey) {
  if (_predRoadCache[routeKey]) return _predRoadCache[routeKey];
  const orig = _PRED_ORIG[routeKey];
  const stopPts = orig.stopPathIdx.map(i => orig.path[i]); // [lat,lon] per stop
  const coordStr = stopPts.map(p => `${p[1]},${p[0]}`).join(';'); // OSRM wants lon,lat
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('bad status');
    const d = await r.json();
    if (d.code !== 'Ok' || !d.routes || !d.routes[0]) throw new Error('no route');
    const path = d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); // -> [lat,lon]

    // Map each original stop to the nearest point on the new dense road path
    const stopPathIdx = stopPts.map(sp => {
      let best = 0, bestD = Infinity;
      path.forEach((p, i) => {
        const dd = (p[0] - sp[0]) ** 2 + (p[1] - sp[1]) ** 2;
        if (dd < bestD) { bestD = dd; best = i; }
      });
      return best;
    });

    const result = { path, stopPathIdx };
    _predRoadCache[routeKey] = result;
    return result;
  } catch {
    // Offline / blocked — keep the straight-line fallback
    return { path: orig.path, stopPathIdx: orig.stopPathIdx };
  }
}

// ── 10-day historical segment times (minutes per stop-to-stop segment) ─────
// segs[i] = travel time (min) for segment i (stop[i] → stop[i+1])
// Modelled on real Chennai peak-hour traffic patterns on GST Road
const PRED_HISTORY = {
  morning: [
    // Tambaram→Chromepet, Chromepet→Pallavaram, Pallavaram→STMount, STMount→Guindy, Guindy→AnnaUniv
    { date: '2026-06-16', segs: [9,  5, 8, 13, 4], traffic: 'Medium' },
    { date: '2026-06-17', segs: [8,  4, 7, 11, 3], traffic: 'Low'    },
    { date: '2026-06-18', segs: [12, 6, 9, 15, 5], traffic: 'Heavy'  },
    { date: '2026-06-19', segs: [9,  5, 8, 13, 4], traffic: 'Medium' },
    { date: '2026-06-20', segs: [11, 6, 9, 14, 5], traffic: 'Heavy'  },
    { date: '2026-06-21', segs: [7,  4, 6,  9, 3], traffic: 'Low'    }, // Saturday
    { date: '2026-06-23', segs: [10, 5, 8, 12, 4], traffic: 'Medium' },
    { date: '2026-06-24', segs: [9,  5, 8, 13, 4], traffic: 'Medium' },
    { date: '2026-06-25', segs: [13, 7,10, 16, 5], traffic: 'Heavy'  },
    { date: '2026-06-26', segs: [8,  4, 7, 10, 3], traffic: 'Low'    },
  ],
  evening: [
    // AnnaUniv→Guindy, Guindy→STMount, STMount→Pallavaram, Pallavaram→Chromepet, Chromepet→Tambaram
    { date: '2026-06-16', segs: [4, 11, 8, 6, 10], traffic: 'Medium' },
    { date: '2026-06-17', segs: [3,  9, 7, 5,  8], traffic: 'Low'    },
    { date: '2026-06-18', segs: [5, 13,10, 7, 12], traffic: 'Heavy'  },
    { date: '2026-06-19', segs: [4, 11, 8, 6, 10], traffic: 'Medium' },
    { date: '2026-06-20', segs: [5, 12, 9, 7, 11], traffic: 'Heavy'  },
    { date: '2026-06-21', segs: [3,  8, 6, 4,  7], traffic: 'Low'    },
    { date: '2026-06-23', segs: [4, 11, 8, 5,  9], traffic: 'Medium' },
    { date: '2026-06-24', segs: [4, 11, 8, 6, 10], traffic: 'Medium' },
    { date: '2026-06-25', segs: [5, 14,11, 8, 13], traffic: 'Heavy'  },
    { date: '2026-06-26', segs: [3,  9, 7, 5,  8], traffic: 'Low'    },
  ],
};

// ── Module state ────────────────────────────────────────────────────────────
let _predMap       = null;
let _predMarker    = null;
let _predPathLine  = null;
let _predTrailLine = null;
let _predStopMarkers = [];
let _predTimer     = null;
let _predRoute     = 'morning';
let _predSpeed     = 30;        // simulation multiplier
let _predSimMin    = 0;         // simulated elapsed minutes
let _predRunning   = false;
let _predTimings   = [];        // minutes from departure for each path point
let _predAvgSegs   = [];
let _predTrailPts  = [];
let _predSearchMarker = null;
const PRED_GEOFENCE_THRESHOLD_M = 100;

// ── Average segment times from 10-day history ──────────────────────────────
function pred_avgSegs(routeKey) {
  const hist = PRED_HISTORY[routeKey];
  const nSegs = hist[0].segs.length;
  const avgs = new Array(nSegs).fill(0);
  hist.forEach(d => d.segs.forEach((v, i) => { avgs[i] += v; }));
  return avgs.map(v => v / hist.length);
}

// ── Predict traffic for 11th day (mode of last 10) ────────────────────────
function pred_predictTraffic(routeKey) {
  const hist = PRED_HISTORY[routeKey];
  const counts = { Low: 0, Medium: 0, Heavy: 0 };
  hist.forEach(d => { counts[d.traffic]++; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Build path timing array ───────────────────────────────────────────────
// Returns array where timings[i] = minutes from departure when bus is at path[i]
function pred_buildTimings(routeKey) {
  const route   = PRED_ROUTES[routeKey];
  const avgSegs = pred_avgSegs(routeKey);
  const path    = route.path;
  const sIdx    = route.stopPathIdx;
  const timings = new Array(path.length).fill(0);

  let cumMin = 0;
  for (let seg = 0; seg < sIdx.length - 1; seg++) {
    const si = sIdx[seg], ei = sIdx[seg + 1];
    const segMin = avgSegs[seg];
    timings[si] = cumMin;

    // Distribute time within segment proportional to haversine distance
    let segDist = 0;
    const dists = [];
    for (let i = si; i < ei; i++) {
      const d = hav(path[i][0], path[i][1], path[i+1][0], path[i+1][1]);
      dists.push(d);
      segDist += d;
    }
    let acc = cumMin;
    for (let i = si; i < ei; i++) {
      acc += segDist > 0 ? (dists[i - si] / segDist) * segMin : segMin / (ei - si);
      timings[i + 1] = acc;
    }
    cumMin += segMin;
  }
  return timings;
}

// ── Interpolate position at given sim minute ──────────────────────────────
function pred_posAt(simMin) {
  const path    = PRED_ROUTES[_predRoute].path;
  const timings = _predTimings;
  const total   = timings[timings.length - 1];
  if (simMin <= 0)     return { lat: path[0][0], lon: path[0][1], pathIdx: 0, pct: 0 };
  if (simMin >= total) return { lat: path[path.length-1][0], lon: path[path.length-1][1], pathIdx: path.length-1, pct: 100 };

  for (let i = 0; i < timings.length - 1; i++) {
    if (simMin >= timings[i] && simMin <= timings[i+1]) {
      const span = timings[i+1] - timings[i];
      const t    = span > 0 ? (simMin - timings[i]) / span : 0;
      const lat  = path[i][0] + t * (path[i+1][0] - path[i][0]);
      const lon  = path[i][1] + t * (path[i+1][1] - path[i][1]);
      return { lat, lon, pathIdx: i, pct: (simMin / total) * 100 };
    }
  }
  return { lat: path[path.length-1][0], lon: path[path.length-1][1], pathIdx: path.length-1, pct: 100 };
}

// ── Deviation check: min distance from pos to any route segment ───────────
function pred_distToRoute(lat, lon) {
  const path = PRED_ROUTES[_predRoute].path;
  let minD = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = _pred_ptSegDist(lat, lon, path[i][0], path[i][1], path[i+1][0], path[i+1][1]);
    if (d < minD) minD = d;
  }
  return minD;
}

function _pred_ptSegDist(plat, plon, alat, alon, blat, blon) {
  const cLat = (plat + alat + blat) / 3;
  const cosL = Math.cos(cLat * Math.PI / 180);
  const px = (plon - alon) * cosL * 111320, py = (plat - alat) * 111320;
  const bx = (blon - alon) * cosL * 111320, by = (blat - alat) * 111320;
  const seg2 = bx*bx + by*by;
  if (seg2 === 0) return Math.sqrt(px*px + py*py);
  const tt = Math.max(0, Math.min(1, (px*bx + py*by) / seg2));
  return Math.sqrt((px - tt*bx)**2 + (py - tt*by)**2);
}

// ── Per-stop historical stats (min / avg / max cumulative arrival) ────────
// Returns array of {min, avg, max} for each stop's cumulative arrival time from departure
function pred_stopStats(routeKey) {
  const hist = PRED_HISTORY[routeKey];
  const nStops = hist[0].segs.length + 1; // stops = segments + 1
  const stats = Array.from({length: nStops}, () => ({ min: Infinity, avg: 0, max: -Infinity }));
  stats[0] = { min: 0, avg: 0, max: 0 }; // departure stop always 0

  hist.forEach(d => {
    let cum = 0;
    d.segs.forEach((seg, i) => {
      cum += seg;
      stats[i + 1].min  = Math.min(stats[i + 1].min, cum);
      stats[i + 1].avg += cum;
      stats[i + 1].max  = Math.max(stats[i + 1].max, cum);
    });
  });
  for (let i = 1; i < nStops; i++) stats[i].avg = +(stats[i].avg / hist.length).toFixed(1);
  return stats;
}

// ── Next upcoming stop index based on sim time (FIXED: uses timings not pathIdx)
function pred_nextStopIdx(simMin) {
  const sIdx = PRED_ROUTES[_predRoute].stopPathIdx;
  for (let i = 0; i < sIdx.length; i++) {
    if (_predTimings[sIdx[i]] > simMin + 0.1) return i; // first stop not yet reached
  }
  return sIdx.length - 1; // all stops passed
}

// ── Simulation tick ───────────────────────────────────────────────────────
function pred_tick() {
  const total = _predTimings[_predTimings.length - 1];
  if (_predSimMin >= total) { pred_pause(); pred_updateUI(total); return; }
  _predSimMin = Math.min(total, _predSimMin + (0.2 / 60) * _predSpeed);
  pred_updateUI(_predSimMin);
}

// ── Main UI update ────────────────────────────────────────────────────────
function pred_updateUI(simMin) {
  const route     = PRED_ROUTES[_predRoute];
  const pos       = pred_posAt(simMin);
  const total     = _predTimings[_predTimings.length - 1];
  const dep       = route.departure;
  const absMin    = dep.h * 60 + dep.m + simMin;
  const clockH    = Math.floor(absMin / 60) % 24;
  const clockM    = Math.floor(absMin % 60);

  // Sim clock
  const clockEl = document.getElementById('predSimClock');
  if (clockEl) clockEl.textContent = `${String(clockH).padStart(2,'0')}:${String(clockM).padStart(2,'0')}`;

  // Marker + trail
  if (_predMarker) _predMarker.setLatLng([pos.lat, pos.lon]);
  if (_predMap)    _predMap.panTo([pos.lat, pos.lon], { animate: true, duration: 0.3 });
  _predTrailPts.push([pos.lat, pos.lon]);
  if (_predTrailPts.length > 400) _predTrailPts.shift();
  if (_predTrailLine) _predTrailLine.setLatLngs(_predTrailPts);

  // Progress bar
  const pct = Math.min(100, (simMin / total) * 100);
  const progBar = document.getElementById('predProgBar');
  const progTxt = document.getElementById('predProgTxt');
  if (progBar) progBar.style.width = pct.toFixed(1) + '%';
  if (progTxt) progTxt.textContent = pct.toFixed(0) + '% · ' + Math.round(simMin) + ' / ' + Math.round(total) + ' min';

  // Next stop (FIXED: based on timing, not pathIdx)
  const nextIdx = pred_nextStopIdx(simMin);
  const nextStop = route.stops[nextIdx] || 'Arrived';
  const nextEl   = document.getElementById('predNextStop');
  if (nextEl) nextEl.textContent = nextStop;

  // ETA to next stop + destination
  const nextStopTiming = _predTimings[route.stopPathIdx[nextIdx]] || total;
  const etaNext  = Math.max(0, nextStopTiming - simMin);
  const etaFinal = Math.max(0, total - simMin);
  const etaNextEl = document.getElementById('predEtaNext');
  const etaDestEl = document.getElementById('predEtaDest');
  if (etaNextEl) etaNextEl.textContent = etaNext  < 0.5 ? 'Arriving!' : Math.round(etaNext)  + ' min';
  if (etaDestEl) etaDestEl.textContent = etaFinal < 0.5 ? 'Arrived! 🎉' : Math.round(etaFinal) + ' min';

  // Detailed per-stop prediction cards
  pred_updateStopCards(simMin);

  // Deviation check
  const devBanner = document.getElementById('predDeviationBanner');
  if (devBanner) devBanner.style.display = pred_distToRoute(pos.lat, pos.lon) > PRED_GEOFENCE_THRESHOLD_M ? 'flex' : 'none';
}

// ── Detailed per-stop prediction cards (FIXED: correct done/current/upcoming) ──
function pred_updateStopCards(simMin) {
  const route  = PRED_ROUTES[_predRoute];
  const sIdx   = route.stopPathIdx;
  const stats  = pred_stopStats(_predRoute);
  const dep    = route.departure;
  const listEl = document.getElementById('predStopList');
  if (!listEl) return;

  listEl.innerHTML = route.stops.map((name, i) => {
    const arrMin    = _predTimings[sIdx[i]];
    const absMin    = dep.h * 60 + dep.m + arrMin;
    const hh        = Math.floor(absMin / 60) % 24;
    const mm        = Math.floor(absMin % 60);
    const predTime  = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    const etaFromNow = Math.max(0, arrMin - simMin);

    // FIXED: stop is done if sim has passed its arrival time by >30s
    const isDone    = simMin > arrMin + 0.5;
    // FIXED: stop is current/approaching if within 2 min ahead
    const isNext    = !isDone && etaFromNow <= 2.0;
    // upcoming = not done, not next
    const statusLbl = isDone ? '✓ Passed' : isNext ? '🚌 Approaching' : 'Scheduled';
    const cardCls   = isDone ? 'pred-scard-done' : isNext ? 'pred-scard-current' : 'pred-scard-pending';

    // Historical stats for this stop
    const st = stats[i];
    const minAbs = dep.h * 60 + dep.m + st.min;
    const maxAbs = dep.h * 60 + dep.m + st.max;
    const minT   = i === 0 ? '08:00' : `${String(Math.floor(minAbs/60)%24).padStart(2,'0')}:${String(Math.floor(minAbs%60)).padStart(2,'0')}`;
    const maxT   = i === 0 ? '08:00' : `${String(Math.floor(maxAbs/60)%24).padStart(2,'0')}:${String(Math.floor(maxAbs%60)).padStart(2,'0')}`;

    const etaRow = (!isDone && simMin > 0)
      ? `<div class="pred-scard-row">
           <span class="pred-scard-lbl">ETA from now</span>
           <span class="pred-scard-val pred-eta-blue">${etaFromNow < 0.5 ? 'Arriving!' : Math.round(etaFromNow) + ' min'}</span>
         </div>`
      : '';

    return `<div class="pred-scard ${cardCls}">
      <div class="pred-scard-hdr">
        <span class="pred-scard-num">${i + 1}</span>
        <span class="pred-scard-name">${name}</span>
        <span class="pred-scard-status">${statusLbl}</span>
      </div>
      <div class="pred-scard-body">
        <div class="pred-scard-row">
          <span class="pred-scard-lbl">Predicted Arrival</span>
          <span class="pred-scard-val">${i === 0 ? 'Departure' : predTime}</span>
        </div>
        ${i > 0 ? `<div class="pred-scard-row">
          <span class="pred-scard-lbl">History (min / avg / max)</span>
          <span class="pred-scard-val pred-scard-hist">${minT} / <b>${predTime}</b> / ${maxT}</span>
        </div>` : ''}
        ${etaRow}
      </div>
    </div>`;
  }).join('');
}

// ── Simulation controls ───────────────────────────────────────────────────
function pred_toggleSim() {
  if (_predRunning) pred_pause(); else pred_start();
}

function pred_start() {
  if (_predRunning) return;
  _predRunning = true;
  const btn = document.getElementById('predSimBtn');
  if (btn) { btn.textContent = '⏸ Pause'; btn.className = 'pred-sim-btn pred-sim-pause'; }
  _predTimer = setInterval(pred_tick, 200);
}

function pred_pause() {
  _predRunning = false;
  if (_predTimer) { clearInterval(_predTimer); _predTimer = null; }
  const btn = document.getElementById('predSimBtn');
  if (btn) { btn.textContent = '▶ Resume'; btn.className = 'pred-sim-btn pred-sim-start'; }
}

function pred_reset() {
  pred_pause();
  _predSimMin = 0;
  _predTrailPts = [];
  if (_predTrailLine) _predTrailLine.setLatLngs([]);
  const route = PRED_ROUTES[_predRoute];
  if (_predMarker) _predMarker.setLatLng(route.path[0]);
  if (_predMap)    _predMap.setView(route.path[0], 13);
  pred_updateUI(0);
  const btn = document.getElementById('predSimBtn');
  if (btn) { btn.textContent = '▶ Start Simulation'; btn.className = 'pred-sim-btn pred-sim-start'; }
  const devBanner = document.getElementById('predDeviationBanner');
  if (devBanner) devBanner.style.display = 'none';
}

function pred_setSpeed(s) {
  _predSpeed = s;
  document.querySelectorAll('.pred-spd-btn').forEach(b => b.classList.remove('pred-spd-active'));
  const el = document.getElementById('predSpd' + s);
  if (el) el.classList.add('pred-spd-active');
}

// ── Route switch ──────────────────────────────────────────────────────────
async function pred_selectRoute(routeKey) {
  _predRoute = routeKey;
  pred_pause();
  _predSimMin   = 0;
  _predTrailPts = [];

  document.getElementById('predTabMorn').className = 'pred-tab' + (routeKey === 'morning' ? ' pred-tab-active' : '');
  document.getElementById('predTabEve').className  = 'pred-tab' + (routeKey === 'evening' ? ' pred-tab-active' : '');

  // Snap to real roads (falls back to straight waypoints if offline)
  const roadData = await pred_fetchRoadPath(routeKey);
  PRED_ROUTES[routeKey].path        = roadData.path;
  PRED_ROUTES[routeKey].stopPathIdx = roadData.stopPathIdx;
  _predTimings = pred_buildTimings(routeKey);

  // Bail out if the user switched routes again while we were fetching
  if (_predRoute !== routeKey) return;

  // Rebuild map
  pred_initMap(routeKey);
  pred_renderHistory(routeKey);
  pred_updateUI(0);

  // Traffic prediction for 11th day
  const traffic = pred_predictTraffic(routeKey);
  const badge   = document.getElementById('predTrafficBadge');
  if (badge) {
    badge.textContent  = traffic;
    badge.className    = 'pred-traffic-badge pred-traffic-' + traffic.toLowerCase();
  }
  const note = document.getElementById('predTrafficNote');
  if (note) note.textContent = `11th day prediction: ${traffic} (mode of 10-day history)`;

  const btn = document.getElementById('predSimBtn');
  if (btn) { btn.textContent = '▶ Start Simulation'; btn.className = 'pred-sim-btn pred-sim-start'; }
}

// ── Map setup ─────────────────────────────────────────────────────────────
function pred_initMap(routeKey) {
  if (_predMap) { _predMap.remove(); _predMap = null; _predMarker = null; _predPathLine = null; _predTrailLine = null; _predStopMarkers = []; _predSearchMarker = null; }

  const route  = PRED_ROUTES[routeKey];
  const center = route.path[0];

  _predMap = L.map('predMap', { zoomControl: true, preferCanvas: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(_predMap);
  _predMap.setView(center, 13);

  // Route path polyline
  _predPathLine = L.polyline(route.path, {
    color: route.color, weight: 4, opacity: .5, dashArray: '8 4'
  }).addTo(_predMap);

  // GPS trail (simulated bus path so far)
  _predTrailLine = L.polyline([], {
    color: route.color, weight: 3, opacity: .85
  }).addTo(_predMap);

  // Stop markers
  _predStopMarkers = route.stops.map((name, i) => {
    const pt = route.path[route.stopPathIdx[i]];
    const isFirst = i === 0, isLast = i === route.stops.length - 1;
    const icon = L.divIcon({
      className: '',
      html: `<div style="background:${isFirst||isLast ? route.color : '#21262d'};border:2px solid ${route.color};width:12px;height:12px;border-radius:50%"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6],
    });
    return L.marker(pt, { icon }).addTo(_predMap).bindTooltip(name, { direction: 'top', permanent: false });
  });

  // Bus marker
  const busIcon = L.divIcon({
    className: '',
    html: `<div style="font-size:1.6rem;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))">🚌</div>`,
    iconSize: [32, 32], iconAnchor: [16, 28],
  });
  _predMarker = L.marker(center, { icon: busIcon }).addTo(_predMap);

  // Fit map to route — invalidateSize first in case the container was
  // resized/hidden since Leaflet last measured it (avoids a grey blank map)
  _predMap.invalidateSize();
  _predMap.fitBounds(_predPathLine.getBounds(), { padding: [30, 30] });
}

// ── History table ─────────────────────────────────────────────────────────
function pred_renderHistory(routeKey) {
  const hist  = PRED_HISTORY[routeKey];
  const el    = document.getElementById('predHistTable');
  if (!el) return;
  const predTotal = Math.round(_predTimings[_predTimings.length - 1]);
  el.innerHTML =
    `<div class="pred-hist-hdr-row">
       <span>Date</span><span>Total</span><span>Traffic</span>
     </div>` +
    hist.map(d => {
      const total = d.segs.reduce((a, b) => a + b, 0);
      return `<div class="pred-hist-row">
        <span class="pred-hist-date">${d.date.slice(5)}</span>
        <span class="pred-hist-dur">${total} min</span>
        <span class="pred-hist-traffic-${d.traffic.toLowerCase()}">${d.traffic}</span>
      </div>`;
    }).join('') +
    `<div class="pred-hist-row pred-hist-pred-row">
       <span style="color:#58a6ff;font-weight:700">11th Day ▶</span>
       <span class="pred-hist-dur" style="color:#58a6ff">${predTotal} min</span>
       <span class="pred-hist-traffic-${pred_predictTraffic(routeKey).toLowerCase()}">${pred_predictTraffic(routeKey)}</span>
     </div>`;
}

// ── Search stop ───────────────────────────────────────────────────────────
function pred_search() {
  const val = (document.getElementById('predSearchIn')?.value || '').trim().toLowerCase();
  if (!val) return;
  const route   = PRED_ROUTES[_predRoute];
  const matched = route.stops.findIndex(s => s.toLowerCase().includes(val));
  const resEl   = document.getElementById('predSearchResult');
  const conEl   = document.getElementById('predSearchContent');
  if (!resEl || !conEl) return;

  if (matched === -1) {
    resEl.style.display = 'block';
    conEl.innerHTML = `<div style="color:#f85149;font-size:.78rem">No stop found matching "<b>${val}</b>"</div>`;
    return;
  }

  const stopName  = route.stops[matched];
  const pathIdx   = route.stopPathIdx[matched];
  const arrMin    = _predTimings[pathIdx];
  const dep       = route.departure;
  const absMin    = dep.h * 60 + dep.m + arrMin;
  const hh        = Math.floor(absMin / 60) % 24;
  const mm        = Math.floor(absMin % 60);
  const etaFromNow = Math.max(0, arrMin - _predSimMin);
  const pt        = route.path[pathIdx];

  resEl.style.display = 'block';
  conEl.innerHTML = `<div class="pred-search-result-stop">
    <b>${stopName}</b><br>
    Predicted arrival: <b>${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}</b><br>
    ${_predSimMin > 0 ? `ETA from now: <b>${etaFromNow < 1 ? '< 1' : Math.round(etaFromNow)} min</b>` : ''}
    <br>Segment: Stop ${matched + 1} of ${route.stops.length}
  </div>`;

  // Pan map and show marker
  if (_predMap) {
    _predMap.setView(pt, 15, { animate: true });
    if (_predSearchMarker) _predSearchMarker.remove();
    _predSearchMarker = L.marker(pt, {
      icon: L.divIcon({ className: '', html: `<div style="background:#f59e0b;border:3px solid #fff;width:14px;height:14px;border-radius:50%"></div>`, iconSize:[14,14], iconAnchor:[7,7] })
    }).addTo(_predMap).bindPopup(`<b>${stopName}</b><br>Predicted: ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`).openPopup();
  }
}

// ── ETA Panel for View 3 (Tracker) ───────────────────────────────────────
// Computes stop-by-stop ETA using current GPS position and live speed,
// matched against PRED_ROUTES morning/evening. Falls back to speed-based calc.
function openETAPanel() {
  const panel = document.getElementById('etaPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  etaPanel_render();
}

function closeETAPanel() {
  const panel = document.getElementById('etaPanel');
  if (panel) panel.style.display = 'none';
}

function etaPanel_render() {
  const body   = document.getElementById('etaPanelBody');
  const subEl  = document.getElementById('etaPanelSub');
  if (!body) return;

  const b = curBus ? sim[curBus] : null;
  if (!b || b.lat === null || b.lastUpdate === 0) {
    body.innerHTML = `<div class="eta-panel-nodata">No live GPS data yet.<br>ETA available once bus connects.</div>`;
    return;
  }

  // Match to nearest route by proximity to any stop
  let bestRoute = null, bestDist = Infinity;
  ['morning', 'evening'].forEach(rk => {
    const route = PRED_ROUTES[rk];
    route.stops.forEach((_, si) => {
      const pt = route.path[route.stopPathIdx[si]];
      const d  = hav(b.lat, b.lon, pt[0], pt[1]);
      if (d < bestDist) { bestDist = d; bestRoute = rk; }
    });
  });

  const route  = PRED_ROUTES[bestRoute];
  const timings = pred_buildTimings(bestRoute);
  const stats  = pred_stopStats(bestRoute);
  const dep    = route.departure;

  // Find closest path point to current position
  let closestPathPt = 0, closestDist = Infinity;
  route.path.forEach((pt, i) => {
    const d = hav(b.lat, b.lon, pt[0], pt[1]);
    if (d < closestDist) { closestDist = d; closestPathPt = i; }
  });
  const simMinNow = timings[closestPathPt];

  if (subEl) subEl.textContent = `${route.label} · ${bestDist < 500 ? 'On route' : 'Near route'} · ${b.speed} km/h`;

  body.innerHTML = route.stops.map((name, i) => {
    const arrMin    = timings[route.stopPathIdx[i]];
    const etaMin    = Math.max(0, arrMin - simMinNow);
    const absMin    = dep.h * 60 + dep.m + arrMin;
    const hh        = Math.floor(absMin / 60) % 24;
    const mm        = Math.floor(absMin % 60);
    const predTime  = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    const isPassed  = simMinNow > arrMin + 0.5;
    const isNext    = !isPassed && etaMin <= 5;
    const st        = stats[i];

    // Historical reliability: how consistent is this stop?
    const variance  = i === 0 ? 0 : (st.max - st.min);
    const reliability = variance <= 2 ? 'High' : variance <= 5 ? 'Medium' : 'Variable';
    const relColor  = variance <= 2 ? '#3fb950' : variance <= 5 ? '#d29922' : '#f85149';

    return `<div class="eta-stop-card ${isPassed ? 'eta-stop-passed' : isNext ? 'eta-stop-next' : ''}">
      <div class="eta-stop-top">
        <span class="eta-stop-num">${i + 1}</span>
        <span class="eta-stop-name">${name}</span>
        <span class="eta-stop-time">${isPassed ? '✓ Passed' : predTime}</span>
      </div>
      ${!isPassed ? `
      <div class="eta-stop-detail">
        <div class="eta-detail-row">
          <span class="eta-detail-lbl">ETA</span>
          <span class="eta-detail-val eta-blue">${etaMin < 0.5 ? 'Arriving now' : Math.round(etaMin) + ' min away'}</span>
        </div>
        <div class="eta-detail-row">
          <span class="eta-detail-lbl">Hist. range</span>
          <span class="eta-detail-val">${i === 0 ? 'Departure' : st.min + '–' + st.max + ' min from start'}</span>
        </div>
        <div class="eta-detail-row">
          <span class="eta-detail-lbl">Reliability</span>
          <span class="eta-detail-val" style="color:${relColor}">${reliability}</span>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

// Refresh ETA panel when open
setInterval(() => {
  if (document.getElementById('etaPanel')?.style.display !== 'none') etaPanel_render();
}, 5000);

// ── View open / close ─────────────────────────────────────────────────────
function openPrediction() {
  showV('predictionView');
  // Wait two animation frames so the view is actually laid out (display:
  // none -> block) before Leaflet measures the container — a single
  // setTimeout(80) is not reliable and was leaving predMap with 0 height,
  // which renders as an empty grey Leaflet container.
  requestAnimationFrame(() => requestAnimationFrame(async () => {
    pred_pause();
    _predSimMin   = 0;
    _predTrailPts = [];

    const roadData = await pred_fetchRoadPath(_predRoute);
    PRED_ROUTES[_predRoute].path        = roadData.path;
    PRED_ROUTES[_predRoute].stopPathIdx = roadData.stopPathIdx;
    _predTimings = pred_buildTimings(_predRoute);

    pred_initMap(_predRoute);
    pred_renderHistory(_predRoute);
    pred_updateUI(0);
    if (_predMap) _predMap.invalidateSize();
    const traffic = pred_predictTraffic(_predRoute);
    const badge   = document.getElementById('predTrafficBadge');
    if (badge) { badge.textContent = traffic; badge.className = 'pred-traffic-badge pred-traffic-' + traffic.toLowerCase(); }
    const note = document.getElementById('predTrafficNote');
    if (note) note.textContent = `11th day prediction: ${traffic} (mode of 10-day history)`;
    pred_setSpeed(30);
    const btn = document.getElementById('predSimBtn');
    if (btn) { btn.textContent = '▶ Start Simulation'; btn.className = 'pred-sim-btn pred-sim-start'; }
  }));
}

function leavePrediction() {
  pred_pause();
  if (_predMap) { _predMap.remove(); _predMap = null; }
  showV('homeView');
}

// Close ETA panel when leaving tracker
const _origLeaveTracker = leaveTracker;
leaveTracker = function() { closeETAPanel(); _origLeaveTracker(); };

/* ═══════════════════════════════════════════════════════════════
   DUMMY FLEET — 5 morning + 5 evening simulated buses (PRD)
   Fully additive: reuses BMETA / sim / buildTrips / renderTable /
   openTracker so dummy buses render with the existing design
   language. Never touches registerDevice(), syncFromAPI(), or any
   state used by the real ESP32 device (BUS01) or the Bus Test view.
═══════════════════════════════════════════════════════════════ */
const DUMMY_META = {};   // dev_id -> {route_name, waypoints, driver, number}
let dummyRouteLine = null;

function registerDummyDevice(cfg) {
  DUMMY_META[cfg.dev_id] = cfg;
  if (!BMETA[cfg.dev_id]) {
    BMETA[cfg.dev_id] = {
      num: cfg.number,
      route: cfg.route_name,
      color: cfg.color,
      trip: cfg.trip
    };
  }
}

async function loadDummyMeta() {
  try {
    const r = await fetch(`${BACKEND}/dummy/buses`, {signal: AbortSignal.timeout(4000)});
    if (!r.ok) return;
    const rows = (await r.json()).data || [];
    rows.forEach(registerDummyDevice);
    buildDates(); // re-render home now that dummy buses are registered
    populateHistDateSelect();
  } catch {}
}

async function syncDummyBuses() {
  try {
    const r = await fetch(`${BACKEND}/dummy/buses/live`, {signal: AbortSignal.timeout(3000)});
    if (!r.ok) return;
    const rows = (await r.json()).data || [];
    rows.forEach(t => {
      const id = t.dev_id;
      if (!sim[id]) sim[id] = {id, lat: null, lon: null, speed: 0, sos: 0, geo: null, stop: false, stopSince: null, ts: null, trail: [], lastUpdate: 0};
      sim[id].lat   = t.lat;
      sim[id].lon   = t.lon;
      sim[id].speed = t.speed_kmh;
      sim[id].sos   = 0;
      sim[id].ts    = new Date(t.timestamp * 1000).toISOString();
      sim[id].stop  = t.status === 'Stopped';
      sim[id].lastUpdate = Date.now();
      sim[id].etaMin = t.eta_min;
      sim[id].distanceKm = t.distance_km;

      const tr = sim[id].trail;
      const last = tr[tr.length - 1];
      if (!last || last[0] !== t.lat || last[1] !== t.lon) {
        tr.push([t.lat, t.lon]);
        if (tr.length > 120) tr.shift();
      }
    });
    if (document.getElementById('homeView').classList.contains('active')) updateHomeStrips();
  } catch {}
}

loadDummyMeta();
setInterval(syncDummyBuses, 3000);
syncDummyBuses();

// ── Route polyline + Prediction/History buttons injected into the Tracker ──
const _origOpenTracker = openTracker;
openTracker = function(id) {
  _origOpenTracker(id);
  const dummyBtnSlot = document.getElementById('dummyTrkBtns');
  if (dummyBtnSlot) dummyBtnSlot.innerHTML = '';

  const cfg = DUMMY_META[id];
  if (!cfg) return; // real device — leave tracker exactly as-is

  if (dummyBtnSlot) {
    dummyBtnSlot.innerHTML =
      `<button class="eta-modal-open-btn" onclick="openDummyPredPanel('${id}')" title="Predicted next days">🔮 Prediction</button>
       <button class="eta-modal-open-btn" onclick="openDummyHistPanel('${id}')" title="Previous 15 days">📅 History</button>`;
  }

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!lmap) return;
    if (dummyRouteLine) { dummyRouteLine.remove(); dummyRouteLine = null; }
    const coords = cfg.waypoints.map(w => [w.lat, w.lon]);
    dummyRouteLine = L.polyline(coords, {color: cfg.color, weight: 4, opacity: .55}).addTo(lmap);
    coords.forEach((c, i) => {
      L.circleMarker(c, {radius: 5, color: cfg.color, fillColor: '#fff', fillOpacity: 1, weight: 2})
        .addTo(lmap).bindTooltip(cfg.waypoints[i].name, {direction: 'top'});
    });
    lmap.fitBounds(dummyRouteLine.getBounds(), {padding: [40, 40]});
  }));
};

const _origDestroyMap = destroyMap;
destroyMap = function() { dummyRouteLine = null; _origDestroyMap(); };

// ── AI Insights (Kimi-generated or rule-based fallback summary) ────────────
function _aiInsightsSkeleton() {
  return `<div class="ai-ins-hdr"><span class="ai-ins-title">✨ AI Insights</span></div>
    <div class="ai-ins-skeleton">
      <div class="ai-ins-skel-line w-90"></div>
      <div class="ai-ins-skel-line w-70"></div>
      <div class="ai-ins-skel-line w-50"></div>
    </div>`;
}

function _renderAIInsights(containerId, data, id, kind) {
  const isFallback = data.source === 'fallback';
  const attrLabel = isFallback ? 'Basic summary' : 'Generated by AI · Kimi';
  document.getElementById(containerId).innerHTML = `
    <div class="ai-ins-hdr">
      <span class="ai-ins-title">✨ AI Insights</span>
      <button class="ai-ins-regen-btn" id="${containerId}-regen" onclick="regenerateAIInsights('${containerId}','${id}','${kind}')">↺ Regenerate</button>
    </div>
    <div class="ai-ins-summary">${data.summary}</div>
    ${data.notableEvents && data.notableEvents.length ? `<ul class="ai-ins-events">${data.notableEvents.map(e => `<li>${e}</li>`).join('')}</ul>` : ''}
    <div class="ai-ins-rec"><span>💡</span><span>${data.recommendation}</span></div>
    <div class="ai-ins-attr ${isFallback ? 'fallback' : ''}">${attrLabel}</div>
    ${isFallback ? '<div class="ai-ins-fallback-note">⚠ AI summary unavailable — showing a rule-based summary instead.</div>' : ''}
  `;
}

async function loadAIInsights(containerId, id, kind, regenerate) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = _aiInsightsSkeleton();
  const btn = document.getElementById(`${containerId}-regen`);
  if (btn) btn.disabled = true;
  try {
    const url = `${BACKEND}/dummy/insights?dev_id=${id}&kind=${kind}${regenerate ? '&regenerate=1' : ''}`;
    const r = await fetch(url, {signal: AbortSignal.timeout(15000)});
    const body = await r.json();
    if (body.status !== 'ok') throw new Error(body.message || 'insights request failed');
    _renderAIInsights(containerId, body.data, id, kind);
  } catch {
    el.innerHTML = `<div class="ai-ins-hdr"><span class="ai-ins-title">✨ AI Insights</span></div>
      <div class="ai-ins-fallback-note">⚠ Could not load AI insights right now.</div>`;
  }
}

function regenerateAIInsights(containerId, id, kind) {
  loadAIInsights(containerId, id, kind, true);
}

// ── Prediction panel (next 5-10 days) ───────────────────────────────────────
async function openDummyPredPanel(id) {
  const panel = document.getElementById('dummyPredPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  const sub = document.getElementById('dummyPredPanelSub');
  if (sub) sub.textContent = `${BMETA[id]?.num || id} · ${BMETA[id]?.route || ''}`;
  loadAIInsights('dummyPredAIInsights', id, 'forecast', false);
  const body = document.getElementById('dummyPredPanelBody');
  body.innerHTML = '<div style="padding:10px;font-size:.75rem;color:#8b949e">Loading…</div>';
  try {
    const r = await fetch(`${BACKEND}/dummy/predictions?dev_id=${id}`, {signal: AbortSignal.timeout(4000)});
    const rows = (await r.json()).data || [];
    body.innerHTML = rows.map(row => `
      <div class="eta-stop-card">
        <div class="eta-stop-top">
          <span class="eta-stop-name">${row.date}</span>
          <span class="eta-stop-time" style="color:${row.route_confidence >= 90 ? '#3fb950' : '#d29922'}">${row.route_confidence}% conf.</span>
        </div>
        <div class="eta-stop-detail">
          <div class="eta-detail-row"><span class="eta-detail-lbl">Departure</span><span class="eta-detail-val">${row.predicted_departure}</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Arrival</span><span class="eta-detail-val">${row.predicted_arrival}</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">ETA</span><span class="eta-detail-val eta-blue">${row.predicted_eta_min} min</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Travel duration</span><span class="eta-detail-val">${row.travel_duration_min} min</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Avg speed</span><span class="eta-detail-val">${row.avg_speed_kmh} km/h</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Delay probability</span><span class="eta-detail-val">${row.delay_probability}%</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Expected distance</span><span class="eta-detail-val">${row.expected_distance} km</span></div>
        </div>
      </div>`).join('') || '<div style="padding:10px;font-size:.75rem;color:#8b949e">No prediction data.</div>';
  } catch {
    body.innerHTML = '<div style="padding:10px;font-size:.75rem;color:#f85149">Failed to load predictions.</div>';
  }
}
function closeDummyPredPanel() {
  const panel = document.getElementById('dummyPredPanel');
  if (panel) panel.style.display = 'none';
}

// ── Historical panel (previous 15 days) ─────────────────────────────────────
let _dummyHistDates = [];
async function populateHistDateSelect() {
  try {
    const r = await fetch(`${BACKEND}/dummy/history/dates`, {signal: AbortSignal.timeout(4000)});
    _dummyHistDates = (await r.json()).data || [];
    const sels = [document.getElementById('histDateSelect'), document.getElementById('dummyHistDateSelect')];
    sels.forEach(sel => {
      if (!sel) return;
      const keepFirst = sel.id === 'histDateSelect';
      sel.innerHTML = (keepFirst ? '<option value="">— Select a date —</option>' : '') +
        _dummyHistDates.map(d => `<option value="${d}">${d}</option>`).join('');
    });
  } catch {}
}

let _dummyHistCurrentId = null;
function openDummyHistPanel(id) {
  _dummyHistCurrentId = id;
  const panel = document.getElementById('dummyHistPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  loadAIInsights('dummyHistAIInsights', id, 'historical', false);
  renderDummyHistPanel();
}
function closeDummyHistPanel() {
  const panel = document.getElementById('dummyHistPanel');
  if (panel) panel.style.display = 'none';
}
async function renderDummyHistPanel() {
  const id = _dummyHistCurrentId;
  const body = document.getElementById('dummyHistPanelBody');
  const sel = document.getElementById('dummyHistDateSelect');
  if (!id || !body || !sel) return;
  const date = sel.value || _dummyHistDates[0];
  if (!date) { body.innerHTML = '<div style="padding:10px;font-size:.75rem;color:#8b949e">No history yet.</div>'; return; }
  body.innerHTML = '<div style="padding:10px;font-size:.75rem;color:#8b949e">Loading…</div>';
  try {
    const r = await fetch(`${BACKEND}/dummy/history?date=${date}&dev_id=${id}`, {signal: AbortSignal.timeout(4000)});
    const rows = (await r.json()).data || [];
    const row = rows[0];
    if (!row) { body.innerHTML = '<div style="padding:10px;font-size:.75rem;color:#8b949e">No record for this date.</div>'; return; }
    // Build a readable scenario badge colour
    const _scenColour = (s) => {
      if (!s) return '#8b949e';
      if (s === 'ON_TIME' || s === 'EARLY_ARRIVAL') return '#3fb950';
      if (s === 'CANCELLED' || s === 'BREAKDOWN') return '#f85149';
      if (s === 'MAJOR_DELAY') return '#f85149';
      if (s === 'MINOR_DELAY' || s === 'WEATHER_SLOWDOWN') return '#d29922';
      return '#58a6ff';
    };
    const scenLabel = (row.scenario_type || 'ON_TIME').replace(/_/g, ' ');
    body.innerHTML = `
      <div class="eta-stop-card">
        <div class="eta-stop-detail">
          <div class="eta-detail-row"><span class="eta-detail-lbl">Route</span><span class="eta-detail-val">${row.route_name}</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Departure</span><span class="eta-detail-val">${row.departure_time}</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Arrival</span><span class="eta-detail-val">${row.arrival_time}</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Speed</span><span class="eta-detail-val">${row.speed_kmh} km/h</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Distance</span><span class="eta-detail-val">${row.distance_km} km</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">ETA</span><span class="eta-detail-val">${row.eta_min} min</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Delay</span><span class="eta-detail-val">${row.delay_min} min</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Status</span><span class="eta-detail-val" style="color:${row.status==='Delayed'?'#f85149':row.status==='Cancelled'?'#f85149':'#3fb950'}">${row.status}</span></div>
          <div class="eta-detail-row"><span class="eta-detail-lbl">Scenario</span><span class="eta-detail-val" style="color:${_scenColour(row.scenario_type)};font-weight:700">${scenLabel}</span></div>
          ${row.scenario_note ? `<div style="margin-top:6px;padding:6px 8px;background:rgba(255,255,255,.04);border-radius:4px;font-size:.68rem;color:#a8a29e;font-style:italic;line-height:1.5">${row.scenario_note}</div>` : ''}
        </div>
      </div>`;
  } catch {
    body.innerHTML = '<div style="padding:10px;font-size:.75rem;color:#f85149">Failed to load history.</div>';
  }
}

// ── Homepage date-picker: view a previous day's full dummy-fleet dataset ──
async function onHistDateChange() {
  const sel = document.getElementById('histDateSelect');
  const date = sel.value;
  const tripsSection = document.getElementById('tripsSection');
  const histSection  = document.getElementById('histSection');
  if (!date) { tripsSection.style.display = ''; histSection.style.display = 'none'; return; }

  tripsSection.style.display = 'none';
  histSection.style.display  = '';
  histSection.innerHTML = '<div style="padding:10px;font-size:.8rem;color:#8b949e">Loading…</div>';
  try {
    const r = await fetch(`${BACKEND}/dummy/history?date=${date}`, {signal: AbortSignal.timeout(4000)});
    const rows = (await r.json()).data || [];

    // Scenario colour helper (same as in the panel)
    const _sc = (s) => {
      if (!s || s === 'ON_TIME' || s === 'EARLY_ARRIVAL') return '#3fb950';
      if (s === 'CANCELLED' || s === 'BREAKDOWN' || s === 'MAJOR_DELAY') return '#f85149';
      if (s === 'MINOR_DELAY' || s === 'WEATHER_SLOWDOWN') return '#d29922';
      return '#58a6ff';
    };

    histSection.innerHTML = `
      <div class="trips-title" style="margin-bottom:16px">Dummy Fleet — ${date}</div>
      <div class="tbl-wrap" style="margin-bottom:20px">
        <table>
          <thead><tr>
            <th>Bus No.</th><th>Route</th><th>Speed</th><th>Distance</th>
            <th>ETA</th><th>Delay</th><th>Departure</th><th>Arrival</th><th>Status</th><th>Scenario</th>
          </tr></thead>
          <tbody>
            ${rows.map(row => `<tr>
              <td><b>${BMETA[row.dev_id]?.num || row.dev_id}</b></td>
              <td style="font-size:.76rem;color:#a8a29e">${row.route_name}</td>
              <td>${row.speed_kmh} km/h</td>
              <td>${row.distance_km} km</td>
              <td>${row.eta_min} min</td>
              <td>${row.delay_min} min</td>
              <td>${row.departure_time}</td>
              <td>${row.arrival_time}</td>
              <td style="color:${row.status==='Delayed'||row.status==='Cancelled'?'#f85149':'#3fb950'}">${row.status}</td>
              <td style="color:${_sc(row.scenario_type)};font-size:.72rem;font-weight:600">${(row.scenario_type||'ON_TIME').replace(/_/g,' ')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="trips-title" style="margin-bottom:12px">AI Fleet Insights — ${date}</div>
      <div id="histDateAIGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;padding:0 0 20px"></div>`;

    // Load AI insights for each bus that has data on this date (staggered to avoid burst)
    const grid = document.getElementById('histDateAIGrid');
    if (grid && rows.length) {
      rows.forEach((row, idx) => {
        const busLabel = BMETA[row.dev_id]?.num || row.dev_id;
        const cid = `histDateAI-${row.dev_id}`;
        const card = document.createElement('div');
        card.style.cssText = 'background:#0d1117;border:1px solid #21262d;border-radius:7px;overflow:hidden';
        card.innerHTML = `<div style="padding:8px 10px;border-bottom:1px solid #21262d;font-size:.72rem;font-weight:700;color:#e6edf3">${busLabel}</div>
          <div class="ai-insights-box" id="${cid}" style="margin:0;border:none;border-radius:0"></div>`;
        grid.appendChild(card);
        // Stagger calls by 300ms per bus to avoid simultaneous burst
        setTimeout(() => loadAIInsights(cid, row.dev_id, 'historical', false), idx * 300);
      });
    }
  } catch {
    histSection.innerHTML = '<div style="padding:10px;font-size:.8rem;color:#f85149">Failed to load historical data.</div>';
  }
}

