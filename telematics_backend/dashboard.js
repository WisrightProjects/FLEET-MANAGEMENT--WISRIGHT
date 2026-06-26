/* ═══════════════════════════════
   GEOFENCE DATA — seeded from backend /telemetry/stops/config
   Fallback to Chennai stops until first API response
═══════════════════════════════ */
let GEO=[
  {id:'chennai_central',   name:'Chennai Central',   lat:13.0827,lon:80.2707,r:300},
  {id:'egmore',            name:'Egmore',            lat:13.0784,lon:80.2617,r:300},
  {id:'royapettah',        name:'Royapettah',        lat:13.0524,lon:80.2623,r:300},
  {id:'t_nagar_bus_stand', name:'T Nagar Bus Stand', lat:13.0418,lon:80.2341,r:300},
  {id:'vadapalani',        name:'Vadapalani',         lat:13.0524,lon:80.2121,r:300},
  {id:'anna_nagar',        name:'Anna Nagar',         lat:13.0850,lon:80.2101,r:300},
  {id:'guindy',            name:'Guindy',             lat:13.0067,lon:80.2206,r:300},
  {id:'adyar',             name:'Adyar',              lat:13.0012,lon:80.2565,r:300},
  {id:'koyambedu',         name:'Koyambedu',          lat:13.0694,lon:80.1948,r:300},
  {id:'perambur',          name:'Perambur',            lat:13.1175,lon:80.2479,r:300},
  {id:'avadi',             name:'Avadi',              lat:13.1132,lon:80.1050,r:300},
  {id:'porur_junction',    name:'Porur Junction',     lat:13.0359,lon:80.1569,r:300},
];
let geoLayerGroup=null; // map layer group for geofence circles

async function loadStopsConfig(){
  try{
    const r=await fetch(`${BACKEND}/telemetry/stops/config`,{signal:AbortSignal.timeout(3000)});
    if(!r.ok) return;
    const d=await r.json();
    const radius=d.radius_m||300;
    GEO=(d.data||[]).map(s=>({
      id:s.name.toLowerCase().replace(/\s+/g,'_'),
      name:s.name, lat:s.lat, lon:s.lon, r:radius
    }));
    if(mapInit) refreshMapGeofences();
  }catch{}
}

function refreshMapGeofences(){
  if(!lmap) return;
  if(geoLayerGroup) geoLayerGroup.clearLayers();
  else{ geoLayerGroup=L.layerGroup().addTo(lmap); }
  GEO.forEach(g=>{
    L.circle([g.lat,g.lon],{radius:g.r,color:'#7b2d8b',fillColor:'#7b2d8b',fillOpacity:.07,weight:1.5,dashArray:'6 4'}).addTo(geoLayerGroup).bindPopup(`<b>${g.name}</b>`);
    L.circleMarker([g.lat,g.lon],{radius:4,color:'#7b2d8b',fillColor:'#7b2d8b',fillOpacity:.7,weight:2}).addTo(geoLayerGroup).bindTooltip(g.name,{direction:'top'});
  });
}

// Simulation fallback routes (real Chennai stops, used only when backend is offline)
const ROUTES={
  'VTUESP32-0091':[[13.1132,80.1050],[13.0850,80.2101],[13.0694,80.1948],[13.0418,80.2341],[13.0067,80.2206],[13.0012,80.2565],[13.0784,80.2617],[13.0827,80.2707],[13.1132,80.1050]],
  'VTUESP32-0092':[[13.0827,80.2707],[13.1175,80.2479],[13.0850,80.2101],[13.0694,80.1948],[13.0359,80.1569],[13.0524,80.2121],[13.0418,80.2341],[13.0827,80.2707]],
  'VTUESP32-0093':[[13.0012,80.2565],[13.0067,80.2206],[13.0418,80.2341],[13.0524,80.2121],[13.0694,80.1948],[13.0850,80.2101],[13.1175,80.2479],[13.0012,80.2565]],
  'VTUESP32-0094':[[13.0418,80.2341],[13.0524,80.2623],[13.0784,80.2617],[13.0827,80.2707],[13.1175,80.2479],[13.0418,80.2341]],
  'VTUESP32-0095':[[13.1132,80.1050],[13.0694,80.1948],[13.0359,80.1569],[13.0524,80.2121],[13.0418,80.2341],[13.1132,80.1050]],
  'VTUESP32-0096':[[13.0012,80.2565],[13.0067,80.2206],[13.0359,80.1569],[13.0694,80.1948],[13.1132,80.1050],[13.0012,80.2565]],
};

const BMETA={
  'VTUESP32-0091':{num:'Bus 91',route:'Avadi → Anna Nagar → Central',        color:'#58a6ff',base:52,trip:'8am',sos:0},
  'VTUESP32-0092':{num:'Bus 92',route:'Central → Perambur → Koyambedu',      color:'#3fb950',base:45,trip:'8am',sos:0},
  'VTUESP32-0093':{num:'Bus 93',route:'Adyar → Guindy → Koyambedu',          color:'#d29922',base:38,trip:'3pm',sos:0},
  'VTUESP32-0094':{num:'Bus 94',route:'T Nagar → Egmore → Central Loop',     color:'#f85149',base:0, trip:'3pm',sos:1},
  'VTUESP32-0095':{num:'Bus 95',route:'Avadi → Porur → Vadapalani',          color:'#f97316',base:48,trip:'8am',sos:0},
  'VTUESP32-0096':{num:'Bus 96',route:'Adyar → Guindy → Porur → Avadi',     color:'#ec4899',base:41,trip:'3pm',sos:0},
};

const BACKEND='http://localhost:5000';
let backendOnline=false;

const sim={}, log=[];
let selFilter='all', curList='all', curBus=null, tickId=null;

Object.entries(ROUTES).forEach(([id,r])=>{
  sim[id]={id,ri:0,prog:Math.random(),lat:r[0][0],lon:r[0][1],speed:0,geo:null,stop:false,
           sos:BMETA[id].sos,ts:new Date().toISOString(),trail:[],stopSince:null,
           lastUpdate:Date.now(),liveTs:0};
});

function hav(a,b,c,d){
  const R=6371000,ra=Math.PI/180,dA=(c-a)*ra,dB=(d-b)*ra;
  const x=Math.sin(dA/2)**2+Math.cos(a*ra)*Math.cos(c*ra)*Math.sin(dB/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function lerp(a,b,t){return a+(b-a)*t}
function chkGeo(la,lo){return GEO.find(g=>hav(la,lo,g.lat,g.lon)<=g.r)||null}

// US-05 / US-28: green ≤ 40, amber 41–70, red > 70
function sclr(s){return s>70?'#f85149':s>40?'#d29922':'#3fb950'}
function spct(s,b){return Math.min(100,Math.round(s/((b||1)+20)*100))}

function simTick(){
  Object.values(sim).forEach(b=>{
    // If real backend data arrived in the last 8 s, freeze simulation for this bus
    if(b.liveTs && (Date.now()-b.liveTs)<8000) return;
    const m=BMETA[b.id], r=ROUTES[b.id];
    if(b.sos&&m.base===0){b.speed=0;b.stop=true;b.ts=new Date().toISOString();b.lastUpdate=Date.now();return}
    b.prog+=.018+Math.random()*.01;
    if(b.prog>=1){b.prog=0;b.ri=(b.ri+1)%(r.length-1)}
    const fr=r[b.ri],to=r[(b.ri+1)%r.length];
    b.lat=lerp(fr[0],to[0],b.prog); b.lon=lerp(fr[1],to[1],b.prog);
    b.speed=Math.max(0,+(m.base+Math.random()*14-7).toFixed(1));
    b.ts=new Date().toISOString();
    b.lastUpdate=Date.now();
    const gf=chkGeo(b.lat,b.lon);
    if(gf&&(!b.geo||b.geo.id!==gf.id)) log.unshift({bus:b.id,name:gf.name,arr:new Date().toLocaleTimeString(),dwell:null,inside:true});
    if(!gf&&b.geo){const e=log.find(l=>l.bus===b.id&&l.name===b.geo.name&&l.inside);if(e){e.dwell=(Math.floor(Math.random()*180+30))+'s';e.inside=false}}
    b.geo=gf||null; b.stop=gf?(b.speed<6):false;
    // US-26: track when bus became stopped
    if(b.speed<6){ if(!b.stopSince) b.stopSince=Date.now(); }
    else b.stopSince=null;
  });
}
setInterval(simTick,1100);

/* ═══════════════════════════════
   REAL BACKEND SYNC
═══════════════════════════════ */
async function syncFromAPI(){
  try{
    const r=await fetch(`${BACKEND}/telemetry/all-latest`,{signal:AbortSignal.timeout(2500)});
    if(!r.ok) throw new Error('bad status');
    const rows=(await r.json()).data||[];
    if(!backendOnline){
      backendOnline=true;
      const badge=document.getElementById('backendBadge');
      if(badge){badge.textContent='🟢 Live';badge.style.color='#16a34a';}
    }
    rows.forEach(t=>{
      const id=t.dev_id;
      // Auto-register devices that arrive from real hardware but aren't in BMETA
      if(!sim[id]){
        const r=ROUTES[id]||[[t.lat,t.lon],[t.lat,t.lon]];
        sim[id]={id,ri:0,prog:0,lat:t.lat,lon:t.lon,speed:0,geo:null,stop:false,
                 sos:0,ts:new Date().toISOString(),trail:[],stopSince:null,
                 lastUpdate:Date.now(),liveTs:0};
        if(!BMETA[id]) BMETA[id]={num:id.replace('VTUESP32-','Bus '),route:'Live GPS',
                                   color:'#a5b4fc',base:40,trip:'8am',sos:0};
        if(!ROUTES[id]) ROUTES[id]=[[t.lat,t.lon],[t.lat,t.lon]];
      }
      sim[id].lat=t.lat; sim[id].lon=t.lon;
      sim[id].speed=parseFloat(t.speed_kmh)||0;
      sim[id].sos=t.sos_active?1:0;
      sim[id].ts=new Date(t.timestamp*1000).toISOString();
      sim[id].stop=(sim[id].speed<6);
      sim[id].lastUpdate=Date.now();
      sim[id].liveTs=Date.now(); // mark as live — suppresses simTick for this bus
      const gf=chkGeo(t.lat,t.lon);
      sim[id].geo=gf||null;
      if(sim[id].speed<6){ if(!sim[id].stopSince) sim[id].stopSince=Date.now(); }
      else sim[id].stopSince=null;
    });
  }catch{
    if(backendOnline){
      backendOnline=false;
      const badge=document.getElementById('backendBadge');
      if(badge){badge.textContent='🔴 Offline';badge.style.color='#B91C1C';}
    }
  }
}
setInterval(syncFromAPI,3000);
syncFromAPI();
loadStopsConfig();

async function fetchStopEvents(id){
  try{
    const r=await fetch(`${BACKEND}/telemetry/stops?dev_id=${id}`,{signal:AbortSignal.timeout(2000)});
    if(!r.ok) return null;
    return (await r.json()).data||[];
  }catch{return null;}
}

/* ═══════════════════════════════
   VIEW SWITCH
═══════════════════════════════ */
function showV(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.getElementById(id).classList.add('active')}

/* ═══════════════════════════════
   HOME
═══════════════════════════════ */
function tick(){
  const n=new Date();
  document.getElementById('homeClock').textContent=
    n.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
  // US-24: show today's date
  const dateEl=document.getElementById('homeDate');
  if(dateEl){
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    dateEl.textContent=`${days[n.getDay()]}, ${n.getDate()} ${months[n.getMonth()]} ${n.getFullYear()}`;
  }
  const all=Object.values(sim);
  document.getElementById('sMoving').textContent=all.filter(b=>!b.stop&&!b.sos).length;
  document.getElementById('sStopped').textContent=all.filter(b=>b.stop&&!b.sos).length;
  document.getElementById('sSos').textContent=all.filter(b=>b.sos).length;
}
setInterval(tick,1000);tick();

function buildDates(){
  const row=document.getElementById('dateRow');
  const today=new Date();
  const ord=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0])};
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dow=today.getDay();
  const mon=new Date(today);mon.setDate(today.getDate()-(dow===0?6:dow-1));

  const hbtn=document.createElement('button');
  hbtn.textContent='TODAY'; hbtn.className='dr-home dr-sel';
  hbtn.onclick=()=>{row.querySelectorAll('button').forEach(b=>b.classList.remove('dr-sel'));hbtn.classList.add('dr-sel');buildTrips(today)};
  row.appendChild(hbtn);

  for(let i=0;i<8;i++){
    const d=new Date(mon);d.setDate(mon.getDate()+i);
    const isToday=d.toDateString()===today.toDateString();
    const btn=document.createElement('button');
    if(isToday) btn.className='dr-today';
    btn.innerHTML=`${ord(d.getDate())} ${days[d.getDay()]}`;
    btn.onclick=(function(dd,b){return()=>{
      row.querySelectorAll('button').forEach(x=>x.classList.remove('dr-sel'));
      b.classList.add('dr-sel');buildTrips(dd);
    }})(d,btn);
    row.appendChild(btn);
  }
  buildTrips(today);
}

const STRIP_COLORS={
  'VTUESP32-0091':'red','VTUESP32-0092':'grn',
  'VTUESP32-0093':'blue','VTUESP32-0094':'red',
  'VTUESP32-0095':'amb','VTUESP32-0096':'pnk'
};
const STRIP_LABEL_CLS={
  'VTUESP32-0091':'','VTUESP32-0092':'',
  'VTUESP32-0093':'pm-label','VTUESP32-0094':'',
  'VTUESP32-0095':'alt-label','VTUESP32-0096':'pm-label'
};

function stripHtml(id){
  const b=sim[id],m=BMETA[id],r=ROUTES[id];
  const overallProg=Math.min(0.97,(b.ri+b.prog)/(r.length-1));
  const clr=STRIP_COLORS[id]||'red';
  const lblCls=STRIP_LABEL_CLS[id]||'';
  const spdClass=b.speed>70?'fast':b.speed>40?'mid':'';
  const spdTxt=b.sos?'🚨 SOS':(b.speed+' km/h');
  return `<div class="tc-strip" id="hs-${id}">
    <div class="tc-strip-label ${lblCls}">${m.num}</div>
    <div class="tc-strip-wrap">
      <div class="tc-strip-track"></div>
      <div class="tc-strip-fill ${clr}" id="hsfill-${id}" style="width:${overallProg*100}%"></div>
      <div class="tc-strip-bus" id="hsbus-${id}" style="left:${overallProg*100}%">🚌</div>
    </div>
    <div class="tc-strip-spd ${spdClass}" id="hsspd-${id}">${spdTxt}</div>
  </div>`;
}

function buildTrips(date){
  const mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dn=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const sec=document.getElementById('tripsSection');
  const wknd=date.getDay()===0||date.getDay()===6;
  const label=`${dn[date.getDay()]}, ${date.getDate()} ${mn[date.getMonth()]} ${date.getFullYear()}`;
  const amBuses=Object.keys(BMETA).filter(id=>BMETA[id].trip==='8am');
  const pmBuses=Object.keys(BMETA).filter(id=>BMETA[id].trip==='3pm');
  const sosId=Object.keys(BMETA).find(id=>sim[id]?.sos);

  if(wknd){
    sec.innerHTML=`<div class="trips-title">${label}</div>
    <div class="weekend-box"><div class="wb-icon">🏖️</div><p>No bus service on weekends.</p></div>`;
    return;
  }

  const sosBanner=sosId?`<div class="sos-home-banner">
    <div class="sos-home-banner-icon">🚨</div>
    <div class="sos-home-banner-text">
      <div class="sos-home-banner-title">${BMETA[sosId].num} — SOS alert active</div>
      <div class="sos-home-banner-sub">${BMETA[sosId].route} · Dispatcher notified via SMS</div>
    </div>
    <button class="sos-home-banner-btn" onclick="openTracker('${sosId}')">View Live →</button>
  </div>`:'';

  sec.innerHTML=`
    ${sosBanner}
    <div class="trips-title" style="margin-top:${sosId?'16px':'0'}">${label} — Scheduled Trips</div>
    <div class="trips-grid">
      <div class="trip-card morning">
        <div class="trip-card-bar"></div>
        <div class="trip-card-body">
          <div class="tc-top"><div class="tc-icon">🌅</div><span class="tc-badge badge-am">8:00 AM</span></div>
          <div class="tc-title">Morning to College</div>
          <div class="tc-time">${amBuses.length} buses · Pickup across Chennai</div>
          <div class="tc-meta">
            <div class="tc-chip">🚌 <b>${amBuses.length}</b> Buses</div>
            <div class="tc-chip">📍 Live GPS</div>
          </div>
          <div class="tc-strips">${amBuses.map(stripHtml).join('')}</div>
          <button class="tc-btn am-btn" onclick="showBusList('8am','Morning to College — 8:00 AM')">View All Buses &amp; Track →</button>
        </div>
      </div>
      <div class="trip-card return">
        <div class="trip-card-bar"></div>
        <div class="trip-card-body">
          <div class="tc-top"><div class="tc-icon">🌆</div><span class="tc-badge badge-pm">3:00 PM</span></div>
          <div class="tc-title">Return from College</div>
          <div class="tc-time">${pmBuses.length} buses · Drop across Chennai</div>
          <div class="tc-meta">
            <div class="tc-chip">🚌 <b>${pmBuses.length}</b> Buses</div>
            <div class="tc-chip">📍 Live GPS</div>
          </div>
          <div class="tc-strips">${pmBuses.map(stripHtml).join('')}</div>
          <button class="tc-btn pm-btn" onclick="showBusList('3pm','Return from College — 3:00 PM')">View All Buses &amp; Track →</button>
        </div>
      </div>
    </div>`;
}

function updateHomeStrips(){
  if(!document.getElementById('homeView').classList.contains('active'))return;
  Object.keys(BMETA).forEach(id=>{
    const b=sim[id],r=ROUTES[id];
    const overallProg=Math.min(0.97,(b.ri+b.prog)/(r.length-1));
    const fillEl=document.getElementById('hsfill-'+id);
    const busEl =document.getElementById('hsbus-'+id);
    const spdEl =document.getElementById('hsspd-'+id);
    if(!fillEl)return;
    fillEl.style.width=overallProg*100+'%';
    busEl.style.left=overallProg*100+'%';
    const spdClass=b.speed>70?'fast':b.speed>40?'mid':'';
    spdEl.textContent=b.sos?'🚨 SOS':(b.speed+' km/h');
    spdEl.className='tc-strip-spd '+spdClass;
  });
}
setInterval(updateHomeStrips,1100);

// US-20: search by bus number / route — navigates directly to matching bus
function doSearch(){
  const v=document.getElementById('srchIn').value.trim().toLowerCase();
  if(v.length<2){alert('Please enter at least 2 characters.');return}
  const exact=Object.keys(BMETA).find(id=>
    BMETA[id].num.toLowerCase().includes(v)||
    BMETA[id].route.toLowerCase().includes(v)||
    id.toLowerCase().includes(v)
  );
  if(exact){openTracker(exact);return;}
  showBusList('all','Search: "'+v+'"');
}

// allow Enter key in search box
document.addEventListener('DOMContentLoaded',()=>{
  const inp=document.getElementById('srchIn');
  if(inp) inp.addEventListener('keydown',e=>{if(e.key==='Enter') doSearch();});
});

function goHome(){
  if(tickId){clearInterval(tickId);tickId=null}
  location.hash='';
  showV('homeView');
}

buildDates();

/* ═══════════════════════════════
   BUS LIST
═══════════════════════════════ */
function showBusList(trip,title){
  curList=trip; selFilter='all';
  document.querySelectorAll('.ftag').forEach((b,i)=>{b.classList.toggle('on',i===0)});
  document.getElementById('listTitle').textContent=title;
  renderTable(trip,'all');
  showV('busListView');
}

function applyFilter(f,btn){
  selFilter=f;
  document.querySelectorAll('.ftag').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  renderTable(curList,f);
}

// US-28: overspeed badge  US-30: offline detection
function renderTable(trip,f){
  let rows=Object.values(sim).filter(b=>{
    if(trip==='8am') return BMETA[b.id].trip==='8am';
    if(trip==='3pm') return BMETA[b.id].trip==='3pm';
    return true;
  });
  if(f==='moving')  rows=rows.filter(b=>!b.stop&&!b.sos);
  if(f==='stopped') rows=rows.filter(b=>b.stop&&!b.sos);
  if(f==='sos')     rows=rows.filter(b=>!!b.sos);

  const body=document.getElementById('busTbody');
  if(!rows.length){body.innerHTML='<tr><td colspan="6" style="text-align:center;padding:18px;color:#7b2d8b">No buses match this filter.</td></tr>';return}

  const now=Date.now();
  body.innerHTML=rows.map(b=>{
    const m=BMETA[b.id], sc=sclr(b.speed);
    const isSos=!!b.sos;
    const isOffline=(now-b.lastUpdate)>30000;
    const isOverspeed=b.speed>70;
    const dotCls=isSos?'sdot-sos':isOffline?'sdot-off':b.stop?'sdot-st':'sdot-mv';
    const stTxt=isSos?'⚠ SOS':isOffline?'Offline':b.stop?'Stopped':'Moving';
    const geo=b.geo?b.geo.name:'En route';
    const overspeedBadge=isOverspeed?`<span class="overspeed-badge">OVERSPEED</span>`:'';
    return`<tr class="${isOffline?'offline-row':''}">
      <td><b>${m.num}</b></td>
      <td style="max-width:150px;font-size:.76rem;color:#a8a29e">${m.route}</td>
      <td><span class="sdot ${dotCls}"></span>${stTxt}</td>
      <td><b style="color:${sc}">${b.speed}</b> km/h ${overspeedBadge}</td>
      <td style="font-size:.74rem;color:#a8a29e">${isOffline?`<span style="color:#6b7280;font-size:.7rem">Last: ${new Date(b.lastUpdate).toLocaleTimeString()}</span>`:geo}${(()=>{const e=etaToNextStop(b);return e&&!isOffline?`<br><span style="color:#58a6ff;font-size:.68rem">~${e} min to next stop</span>`:''})()}</td>
      <td><button class="trk-btn${isSos?' sos':''}" onclick="openTracker('${b.id}')">📍 Track</button></td>
    </tr>`;
  }).join('');
}

setInterval(()=>{if(document.getElementById('busListView').classList.contains('active'))renderTable(curList,selFilter)},1400);

/* ═══════════════════════════════
   TRACKER
═══════════════════════════════ */
let lmap=null,lmarker=null,ltrail=null,mapInit=false;

function ensureMap(){
  if(mapInit)return;
  lmap=L.map('liveMap',{zoomControl:true}).setView([13.05,80.22],13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',attribution:'© OpenStreetMap',maxZoom:19}).addTo(lmap);
  geoLayerGroup=L.layerGroup().addTo(lmap);
  refreshMapGeofences();
  ltrail=L.polyline([],{color:'#58a6ff',weight:3,opacity:.4,dashArray:'5 5'}).addTo(lmap);
  mapInit=true;
}

function busIcon(color,sos){
  const c=sos?'#f85149':color;
  return L.divIcon({className:'',html:`<div style="position:relative;width:44px;height:44px">
    <svg viewBox="0 0 44 44" width="44" height="44">
      <rect x="4" y="10" width="36" height="24" rx="5" fill="${c}" opacity=".95"/>
      <rect x="7"  y="14" width="10" height="8" rx="1.5" fill="white" opacity=".9"/>
      <rect x="20" y="14" width="10" height="8" rx="1.5" fill="white" opacity=".9"/>
      <circle cx="12" cy="36" r="4" fill="#111"/>
      <circle cx="32" cy="36" r="4" fill="#111"/>
      ${sos?'<rect x="15" y="3" width="14" height="8" rx="2" fill="#f85149"/><text x="22" y="9.5" text-anchor="middle" font-size="5.5" font-weight="bold" fill="white" font-family="sans-serif">SOS</text>':''}
    </svg>
    ${sos?'<div style="position:absolute;top:0;right:0;width:10px;height:10px;background:#f85149;border-radius:50%;border:2px solid #0d1117;animation:pa .8s infinite"></div>':''}
  </div>`,iconSize:[44,44],iconAnchor:[22,40],popupAnchor:[0,-40]});
}

// US-21: ETA to next stop in minutes
// When live GPS is active, find nearest stop that is NOT the current geofence.
// Falls back to route waypoints when simulating offline.
function etaToNextStop(b){
  if(b.speed<2) return null;
  if(b.liveTs&&(Date.now()-b.liveTs)<30000){
    // Real GPS path — nearest stop ahead excluding current geofence
    let best=null, bestDist=Infinity;
    GEO.forEach(g=>{
      if(b.geo&&g.name===b.geo.name) return;
      const d=hav(b.lat,b.lon,g.lat,g.lon);
      if(d<bestDist){bestDist=d;best=g;}
    });
    if(!best) return null;
    return Math.max(1,Math.round(bestDist/(b.speed*1000/60)));
  }
  // Simulation fallback
  const r=ROUTES[b.id];
  if(!r) return null;
  const nextIdx=(b.ri+1)%r.length;
  const [nlat,nlon]=r[nextIdx];
  const distM=hav(b.lat,b.lon,nlat,nlon);
  return Math.max(1,Math.round(distM/(b.speed*1000/60)));
}

// US-25: copy tracker link to clipboard
function shareTracker(){
  const url=window.location.href;
  if(navigator.clipboard){
    navigator.clipboard.writeText(url).then(()=>{
      const btn=document.querySelector('.share-btn');
      if(btn){const orig=btn.textContent;btn.textContent='✓ Copied!';setTimeout(()=>{btn.textContent=orig},2000);}
    }).catch(()=>prompt('Copy this link:',url));
  } else {
    prompt('Copy this link:',url);
  }
}

// US-25: deep link via URL hash
function openTracker(id){
  curBus=id;
  const m=BMETA[id];
  document.getElementById('trkName').textContent=m.num;
  document.getElementById('trkSub').textContent=m.route;
  location.hash=id;
  showV('trackerView');

  setTimeout(()=>{
    ensureMap(); lmap.invalidateSize();
    const b=sim[id];
    if(!lmarker) lmarker=L.marker([b.lat,b.lon],{icon:busIcon(m.color,!!b.sos)}).addTo(lmap);
    lmap.flyTo([b.lat,b.lon],15,{animate:true,duration:1.2});
    updateTele(id);
    if(tickId) clearInterval(tickId);
    tickId=setInterval(()=>updateTele(id),1100);
  },80);
}

function leaveTracker(){
  if(tickId){clearInterval(tickId);tickId=null}
  location.hash='';
  showV('busListView');
}

// US-31: acknowledge SOS — clears local SOS state
function acknowledgeSOSFor(id){
  if(sim[id]) sim[id].sos=0;
  updateTele(id);
}

// US-26 / US-28 / US-31: updateTele with overspeed HUD, stopped notice, ack button
function updateTele(id){
  const b=sim[id], m=BMETA[id], isSos=!!b.sos;
  const sc=sclr(b.speed), p=spct(b.speed,m.base);
  const isOverspeed=b.speed>70;
  const isOffline=(Date.now()-b.lastUpdate)>30000;

  lmarker.setLatLng([b.lat,b.lon]);
  lmarker.setIcon(busIcon(m.color,isSos));
  lmarker.bindPopup(`<b>${m.num}</b><br>Speed: <b>${b.speed} km/h</b><br>${b.geo?'At: '+b.geo.name:'En route'}`);

  b.trail.push([b.lat,b.lon]);
  if(b.trail.length>80) b.trail.shift();
  ltrail.setLatLngs(b.trail); ltrail.setStyle({color:m.color});
  lmap.panTo([b.lat,b.lon],{animate:true,duration:.5});

  // HUD — US-28: red + OVERSPEED label when >70
  const hudNum=document.getElementById('hudNum');
  hudNum.textContent=b.speed; hudNum.style.color=sc;
  const hudLbl=document.querySelector('.hud-lbl');
  if(hudLbl) hudLbl.textContent=isOverspeed?'⚠ OVERSPEED':'Axle Speed';
  const hb=document.getElementById('hudBar'); hb.style.width=p+'%'; hb.style.background=sc;
  document.getElementById('hudSos').className='hud-sos'+(isSos?' on':'');

  document.getElementById('tId').textContent=id;
  document.getElementById('tTs').textContent=isOffline?b.ts+' (last known)':b.ts;

  // Speed hero
  document.getElementById('tSpd').textContent=b.speed;
  document.getElementById('tSpd').style.color=sc;
  const sb=document.getElementById('tSpdBar'); sb.style.width=p+'%'; sb.style.background=sc;
  const mp=document.getElementById('tMpill');
  mp.textContent=b.stop?'⏸ Stopped':'▶ Moving';
  mp.className='mpill '+(b.stop?'mpill-st':'mpill-mv');

  // US-21: ETA to next stop in tracker panel
  let etaEl=document.getElementById('tEta');
  const eta=etaToNextStop(b);
  if(eta){
    if(!etaEl){
      etaEl=document.createElement('div');
      etaEl.id='tEta';
      etaEl.style.cssText='margin-top:6px;font-size:.73rem;color:#58a6ff;font-family:"IBM Plex Mono",monospace';
      document.getElementById('tSpdBar').parentNode.appendChild(etaEl);
    }
    etaEl.textContent=`⏱ ~${eta} min to next stop`;
  } else if(etaEl){ etaEl.remove(); }

  // US-26: "bus appears stopped" notice
  const stoppedMs=b.stopSince?(Date.now()-b.stopSince):0;
  let stoppedNotice=document.getElementById('stopped-notice');
  if(stoppedMs>120000){
    const mm=Math.floor(stoppedMs/60000), ss=Math.floor((stoppedMs%60000)/1000);
    if(!stoppedNotice){
      stoppedNotice=document.createElement('div');
      stoppedNotice.id='stopped-notice';
      stoppedNotice.className='stopped-notice';
      document.getElementById('tSpdBar').parentNode.appendChild(stoppedNotice);
    }
    stoppedNotice.textContent=`⚠ Bus appears stopped for ${mm}m ${ss}s`;
  } else if(stoppedNotice){ stoppedNotice.remove(); }

  document.getElementById('tLat').textContent=b.lat.toFixed(6)+'°';
  document.getElementById('tLon').textContent=b.lon.toFixed(6)+'°';

  // SOS card — US-31: ack button
  const sc2=document.getElementById('tSosCard');
  document.getElementById('tSosIco').textContent=isSos?'🔴':'🟢';
  document.getElementById('tSosSt').textContent=isSos?'TRIGGERED — EMERGENCY':'ARMED / SAFE';
  document.getElementById('tSosSt').style.color=isSos?'#f85149':'#3fb950';
  document.getElementById('tSosSub').textContent=isSos?'Priority SMS dispatched · ISR active':'No emergency detected';
  sc2.className='sos-card '+(isSos?'sos-trig':'sos-safe');
  let ackBtn=document.getElementById('sos-ack-btn');
  if(isSos){
    if(!ackBtn){
      ackBtn=document.createElement('button');
      ackBtn.id='sos-ack-btn';
      ackBtn.className='sos-ack-btn';
      ackBtn.textContent='Acknowledge SOS';
      ackBtn.onclick=()=>acknowledgeSOSFor(id);
      sc2.appendChild(ackBtn);
    }
  } else if(ackBtn){ ackBtn.remove(); }

  // Geo
  document.getElementById('tGeoIco').textContent=b.geo?'📌':'🛣️';
  document.getElementById('tGeoNm').textContent=b.geo?b.geo.name:'Outside all geofences';
  document.getElementById('tGeoSb').textContent=b.geo?'ID: '+b.geo.id:'En route between stops';

  // JSON packet
  document.getElementById('tJson').textContent=JSON.stringify({
    dev_id:id,ts:b.ts,
    lat:+b.lat.toFixed(6),lon:+b.lon.toFixed(6),
    speed_kmh:b.speed,
    geofence_id:b.geo?b.geo.id:null,
    stop_state:b.stop,sos_active:b.sos
  },null,2);

  // Landmark log
  if(backendOnline){
    fetchStopEvents(id).then(stops=>{
      const logEl=document.getElementById('tLog');
      if(!logEl) return;
      if(!stops||!stops.length){
        logEl.innerHTML='<div style="font-size:.73rem;color:#8b949e">No stop events recorded yet.</div>';
        return;
      }
      logEl.innerHTML=stops.slice(0,5).map(s=>{
        const arr=new Date(s.arrived_at*1000).toLocaleTimeString();
        const dwell=s.duration_sec!=null
          ?(Math.floor(s.duration_sec/60)>0?Math.floor(s.duration_sec/60)+'m ':'')+(Math.round(s.duration_sec%60))+'s'
          :null;
        // US-29: highlight rows where dwell > 10 minutes
        const longDwell=s.duration_sec!=null&&s.duration_sec>600;
        return`<div class="log-row${longDwell?' log-row-delay':''}">
          <div class="log-nm">🏁 ${s.location_name}${longDwell?' <span class="log-delay-tag">DELAY</span>':''}</div>
          <div class="log-mt">Arrived ${arr}${dwell?` · <span class="log-dw${longDwell?' log-dw-warn':''}">Dwell: ${dwell}</span>`:' · <span class="log-in">Currently inside</span>'}</div>
        </div>`;
      }).join('');
    });
  } else {
    const rows=log.filter(l=>l.bus===id).slice(0,5);
    document.getElementById('tLog').innerHTML=rows.length===0
      ?'<div style="font-size:.73rem;color:#8b949e">No events yet…</div>'
      :rows.map(l=>`<div class="log-row">
          <div class="log-nm">🏁 ${l.name}</div>
          <div class="log-mt">Arrived ${l.arr}${l.dwell?` · <span class="log-dw">Dwell: ${l.dwell}</span>`:' · <span class="log-in">Currently inside</span>'}</div>
        </div>`).join('');
  }
}

/* ═══════════════════════════════
   US-25: Deep link on page load
═══════════════════════════════ */
window.addEventListener('load',()=>{
  const hash=location.hash.slice(1);
  if(hash&&BMETA[hash]) openTracker(hash);
});
