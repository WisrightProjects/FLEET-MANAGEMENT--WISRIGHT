/*
  ╔═══════════════════════════════════════════════════════════════╗
  ║          BusTracker — Production ESP32 Firmware               ║
  ║   NEO-6M GPS + SIMCom A7670C 4G LTE + SOS push button          ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║  WIRING                                                        ║
  ║  ─────────────────────────────────────────────────────────    ║
  ║  NEO-6M  TX  →  ESP32 GPIO 16  (GPS_RX_PIN)                   ║
  ║  NEO-6M  RX  →  ESP32 GPIO 17  (GPS_TX_PIN, optional)         ║
  ║  NEO-6M  VCC →  3.3 V                                         ║
  ║  NEO-6M  GND →  GND                                           ║
  ║                                                               ║
  ║  A7670C  TX  →  ESP32 GPIO 26  (SIM_RX_PIN)                   ║
  ║  A7670C  RX  →  ESP32 GPIO 27  (SIM_TX_PIN)                   ║
  ║  A7670C  RST →  ESP32 GPIO  4  (SIM_RST_PIN, optional)        ║
  ║  A7670C  VCC →  5 V  (dedicated 2 A supply required — the      ║
  ║                       module browns out on ESP32/USB 5V and    ║
  ║                       drops registration mid-attach)           ║
  ║  A7670C  GND →  GND  (shared with ESP32)                      ║
  ║                                                                ║
  ║  SOS Button: one leg → ESP32 GPIO 32, other leg → GND          ║
  ║              (internal pull-up used — press = LOW = SOS)       ║
  ║              (external momentary push button — not the boot   ║
  ║               button; GPIO32 is a free input-capable pin)      ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║  Libraries (Arduino IDE → Library Manager):                    ║
  ║    TinyGPSPlus  by Mikal Hart       (>= 1.0.3)                ║
  ║    ArduinoJson  by Benoit Blanchon  (v6 or v7)                ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║  Board: ESP32 Dev Module  |  Upload Speed: 921600              ║
  ║  CPU: 240 MHz  |  Flash: 4 MB  |  Partition: Default           ║
  ╚═══════════════════════════════════════════════════════════════╝

  PURPOSE
  ──────────────────────────────────────────────────────────────
  Production build: ESP32 gets its internet purely from the SIMCom
  A7670C 4G module (no WiFi at all) and POSTs GPS + SOS telemetry
  straight to the hosted backend at https://fms.wisright.com/telemetry.
  Pressing the SOS push button sets sos_active=1 in every packet sent
  until the button is pressed again to clear it — the dashboard shows
  a live SOS alert banner/marker the moment a sos_active=1 packet lands.

  CELLULAR DATA BRING-UP (why SMS can work but the website won't)
  ──────────────────────────────────────────────────────────────
  A SIM registers on two separate networks:
    CS (circuit-switched) → voice + SMS
    PS (packet-switched)  → internet / data
  SMS working proves the module, antenna, coverage and SIM are fine;
  it says nothing about data. This firmware:
    - defines the APN (CGDCONT) BEFORE attaching (CGATT) — VI rejects
      the data session otherwise;
    - forces auto network mode (CNMP) so PS registration completes;
    - trusts data only after a real, non-zero local IP (CGPADDR),
      not the bare "OK" from CGACT.
  If it still fails: put the SIM in a phone with WiFi OFF and try to
  browse — no data there means the SIM's data plan is the problem,
  and no firmware change will fix it.

  Data flow:
    NEO-6M GPS --> ESP32 UART2 --> build JSON --> UART1 --> A7670C 4G
    --> mobile network --> Internet --> HTTPS --> fms.wisright.com/telemetry
    --> MySQL --> Dashboard (live map + SOS alert banner)
*/

#include <TinyGPSPlus.h>
#include <ArduinoJson.h>

// ─────────────────────────────────────────────────────────────────────────────
//  USER CONFIGURATION  <-- Edit these before uploading
// ─────────────────────────────────────────────────────────────────────────────

// Hosted backend — no ngrok needed
#define SERVER_HOST   "fms.wisright.com"
#define SERVER_PATH   "/telemetry"

// Auth token — must match DEVICE_TOKEN in server .env
#define DEVICE_TOKEN  "fleet-secret-2024"

// Unique ID shown on the dashboard for this physical bus
#define BUS_ID        "BUS01"

// SIM phone number (MSISDN) — label only, for logs/identification
#define SIM_NUMBER    "8608980556"

// SIM APN — VI (Vodafone Idea) India (fallbacks tried automatically)
// NOTE: an APN is NOT a URL — do not test it in a browser.
#define SIM_APN       "www.vodafone.net.in"

// ─────────────────────────────────────────────────────────────────────────────
//  HARDWARE PINS
// ─────────────────────────────────────────────────────────────────────────────

#define GPS_RX_PIN    16   // ESP32 <- NEO-6M TX
#define GPS_TX_PIN    17   // ESP32 -> NEO-6M RX
#define SIM_RX_PIN    26   // ESP32 <- A7670C TX
#define SIM_TX_PIN    27   // ESP32 -> A7670C RX
#define SOS_BTN_PIN   32   // External push button: pin -> GND, internal pull-up used

// ─────────────────────────────────────────────────────────────────────────────
//  BAUD RATES
// ─────────────────────────────────────────────────────────────────────────────

#define GPS_BAUD      9600
#define SIM_BAUD      115200
#define MONITOR_BAUD  115200

// ─────────────────────────────────────────────────────────────────────────────
//  TIMING (milliseconds)
// ─────────────────────────────────────────────────────────────────────────────

#define SEND_INTERVAL_MS      5000UL   // POST every 5 seconds
#define GPS_FIX_TIMEOUT_MS   120000UL  // Wait up to 2 min for first fix
#define AT_TIMEOUT_MS          5000UL  // Generic AT command timeout
#define HTTP_TIMEOUT_MS       35000UL  // AT+HTTPACTION wait timeout
#define STATUS_PRINT_MS        5000UL  // How often to print live status line
#define SOS_DEBOUNCE_MS         300UL  // Button debounce window

// ─────────────────────────────────────────────────────────────────────────────
//  HARDWARE SERIALS
// ─────────────────────────────────────────────────────────────────────────────

HardwareSerial gpsSerial(2);  // UART2: RX=GPIO16, TX=GPIO17
HardwareSerial simSerial(1);  // UART1: RX=GPIO26, TX=GPIO27

// ─────────────────────────────────────────────────────────────────────────────
//  GLOBALS
// ─────────────────────────────────────────────────────────────────────────────

TinyGPSPlus gps;

struct GpsSnapshot {
  double   lat;
  double   lon;
  double   speed_kmh;
  double   altitude_m;
  uint32_t satellites;
  double   hdop;
  char     date[11];    // "YYYY-MM-DD\0"
  char     utcTime[9];  // "HH:MM:SS\0"
  bool     valid;
};

static GpsSnapshot snap         = {};
static bool        networkReady = false;
static bool        sosActive    = false;
static bool        sosBtnLast   = HIGH;
static uint32_t    sosLastEdgeMs = 0;
static uint32_t    lastSendMs   = 0;
static uint32_t    lastStatusMs = 0;
static uint8_t     errCount     = 0;
static uint32_t    sendCount    = 0;   // total successful POSTs this session

// ─────────────────────────────────────────────────────────────────────────────
//  LOGGING MACROS
// ─────────────────────────────────────────────────────────────────────────────

#define LOG(x)    Serial.print(x)
#define LOGLN(x)  Serial.println(x)
#define LOGF(...) Serial.printf(__VA_ARGS__)
#define DIVIDER() Serial.println(F("--------------------------------------------"))

// ═════════════════════════════════════════════════════════════════════════════
//  STATUS BANNER — printed to Serial Monitor periodically in loop()
// ═════════════════════════════════════════════════════════════════════════════

void printLiveStatus() {
  DIVIDER();
  LOGF("[STATUS] Uptime: %lu s  |  Sends OK: %lu  |  Errors: %d\n",
       millis() / 1000, sendCount, errCount);

  LOGLN(networkReady ? F("[NET]    4G: CONNECTED  -- A7670C online")
                      : F("[NET]    4G: OFFLINE    -- waiting for re-init"));

  if (snap.valid) {
    LOGF("[GPS]    FIX OK  Lat=%.6f  Lon=%.6f\n", snap.lat, snap.lon);
    LOGF("[GPS]            Speed=%.1f km/h  Alt=%.1f m  Sats=%lu  HDOP=%.2f\n",
         snap.speed_kmh, snap.altitude_m, snap.satellites, snap.hdop);
    LOGF("[GPS]            Date=%s  Time=%s UTC\n", snap.date, snap.utcTime);
  } else {
    LOGF("[GPS]    NO FIX  |  chars=%lu  sentences=%lu  failed=%lu\n",
         gps.charsProcessed(), gps.sentencesWithFix(), gps.failedChecksum());
    if (gps.charsProcessed() == 0) {
      LOGLN(F("[GPS]    WARNING: 0 bytes from NEO-6M — check wiring on GPIO16"));
    }
  }

  LOGF("[SOS]    Button state: %s\n", sosActive ? "*** TRIGGERED ***" : "armed / safe");

  DIVIDER();
}

// ═════════════════════════════════════════════════════════════════════════════
//  SOS BUTTON — press to toggle, debounced
// ═════════════════════════════════════════════════════════════════════════════

void sos_setup() {
  pinMode(SOS_BTN_PIN, INPUT_PULLUP);
}

void sos_poll() {
  bool reading = digitalRead(SOS_BTN_PIN);
  uint32_t now = millis();

  if (reading != sosBtnLast && (now - sosLastEdgeMs) > SOS_DEBOUNCE_MS) {
    sosLastEdgeMs = now;
    sosBtnLast    = reading;
    if (reading == LOW) {   // button pressed (active LOW, pull-up)
      sosActive = !sosActive;
      DIVIDER();
      LOGF("[SOS]    Button pressed — SOS now %s\n", sosActive ? "*** ACTIVE ***" : "CLEARED");
      DIVIDER();
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  GPS FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

void gps_feed() {
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }
}

bool gps_waitForFix(uint32_t timeoutMs) {
  DIVIDER();
  LOGLN(F("[GPS] Searching for satellites..."));
  LOGLN(F("[GPS] (open-sky view needed — indoors may take longer)"));
  DIVIDER();

  uint32_t start   = millis();
  uint32_t nextLog = millis();
  bool     warnedNoBytes = false;

  while (millis() - start < timeoutMs) {
    gps_feed();
    sos_poll();

    if (!warnedNoBytes && millis() - start > 5000 && gps.charsProcessed() == 0) {
      warnedNoBytes = true;
      LOGLN(F("[GPS] WARNING: No bytes from NEO-6M after 5 s"));
      LOGLN(F("[GPS]          Check: VCC=3.3V, GND, TX->GPIO16 wiring"));
    }

    if (gps.location.isValid() && gps.location.age() < 2000) {
      uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
      double   hdop = gps.hdop.isValid()       ? gps.hdop.hdop()        : 99.9;
      DIVIDER();
      LOGF("[GPS] *** FIX ACQUIRED in %lu s ***\n", (millis() - start) / 1000);
      LOGF("[GPS]     Latitude  : %.6f\n", gps.location.lat());
      LOGF("[GPS]     Longitude : %.6f\n", gps.location.lng());
      LOGF("[GPS]     Satellites: %lu\n",  sats);
      LOGF("[GPS]     HDOP      : %.2f\n", hdop);
      DIVIDER();
      return true;
    }

    if (millis() - nextLog >= 5000) {
      nextLog = millis();
      uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
      LOGF("[GPS] Searching... %lu s elapsed | sats=%lu | chars=%lu\n",
           (millis() - start) / 1000, sats, gps.charsProcessed());
    }

    delay(50);
  }

  DIVIDER();
  LOGLN(F("[GPS] *** NO FIX within timeout ***"));
  LOGLN(F("[GPS]     Will retry in main loop. Continuing without GPS..."));
  DIVIDER();
  return false;
}

bool gps_snapshot() {
  gps_feed();

  if (!gps.location.isValid() || gps.location.age() > 5000) {
    if (snap.valid) {
      LOGLN(F("[GPS] Fix lost — location data is stale (>5 s old)"));
    }
    snap.valid = false;
    return false;
  }

  snap.lat        = gps.location.lat();
  snap.lon        = gps.location.lng();
  snap.speed_kmh  = gps.speed.isValid()      ? gps.speed.kmph()       : 0.0;
  snap.altitude_m = gps.altitude.isValid()   ? gps.altitude.meters()  : 0.0;
  snap.satellites = gps.satellites.isValid() ? gps.satellites.value() : 0;
  snap.hdop       = gps.hdop.isValid()       ? gps.hdop.hdop()        : 99.9;

  if (gps.date.isValid()) {
    snprintf(snap.date, sizeof(snap.date), "%04d-%02d-%02d",
             gps.date.year(), gps.date.month(), gps.date.day());
  } else {
    strlcpy(snap.date, "0000-00-00", sizeof(snap.date));
  }

  if (gps.time.isValid()) {
    snprintf(snap.utcTime, sizeof(snap.utcTime), "%02d:%02d:%02d",
             gps.time.hour(), gps.time.minute(), gps.time.second());
  } else {
    strlcpy(snap.utcTime, "00:00:00", sizeof(snap.utcTime));
  }

  snap.valid = true;
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  AT COMMAND HELPERS
// ═════════════════════════════════════════════════════════════════════════════

void sim_clearRx() {
  delay(50);
  while (simSerial.available()) simSerial.read();
}

bool sim_sendExpect(const char* cmd, const char* expected,
                    uint32_t timeoutMs = AT_TIMEOUT_MS) {
  sim_clearRx();
  simSerial.print(cmd);
  simSerial.print(F("\r\n"));

  String   resp;
  resp.reserve(256);
  uint32_t start = millis();

  while (millis() - start < timeoutMs) {
    while (simSerial.available()) resp += (char)simSerial.read();
    if (resp.indexOf(expected)    != -1) { return true; }
    if (resp.indexOf(F("ERROR"))  != -1) { return false; }
    delay(10);
  }
  return false;
}

String sim_sendCapture(const char* cmd, uint32_t timeoutMs = AT_TIMEOUT_MS) {
  sim_clearRx();
  simSerial.print(cmd);
  simSerial.print(F("\r\n"));

  String   resp;
  resp.reserve(512);
  uint32_t start    = millis();
  uint32_t lastChar = millis();

  while (millis() - start < timeoutMs) {
    while (simSerial.available()) {
      resp    += (char)simSerial.read();
      lastChar = millis();
    }
    bool complete = (resp.indexOf(F("OK"))    != -1 ||
                     resp.indexOf(F("ERROR")) != -1);
    bool silence  = (resp.length() > 0 && millis() - lastChar > 400);
    if (complete || silence) {
      delay(60);
      while (simSerial.available()) resp += (char)simSerial.read();
      break;
    }
    delay(10);
  }
  return resp;
}

bool sim_isAlive() {
  sim_clearRx();
  simSerial.print(F("AT\r\n"));
  delay(600);
  String r;
  while (simSerial.available()) r += (char)simSerial.read();
  return r.indexOf(F("OK")) != -1;
}

// ═════════════════════════════════════════════════════════════════════════════
//  SIM / NETWORK INITIALIZATION
// ═════════════════════════════════════════════════════════════════════════════

bool sim_checkSim() {
  LOGLN(F("[SIM] Checking SIM card..."));
  String r = sim_sendCapture("AT+CPIN?", 10000);
  if (r.indexOf(F("READY"))   != -1) { LOGLN(F("[SIM] SIM card: READY"));                      return true; }
  if (r.indexOf(F("SIM PIN")) != -1) { LOGLN(F("[SIM] SIM card requires PIN — not supported")); return false; }
  LOGLN(F("[SIM] SIM card not detected — check if inserted correctly"));
  return false;
}

void sim_logSignal() {
  String r   = sim_sendCapture("AT+CSQ");
  int    idx = r.indexOf(F("+CSQ:"));
  if (idx != -1) {
    int rssi = r.substring(idx + 5).toInt();
    int dbm  = (rssi < 99) ? (-113 + 2 * rssi) : -999;
    const char* quality = (rssi >= 20) ? "EXCELLENT" :
                          (rssi >= 15) ? "GOOD"      :
                          (rssi >= 10) ? "FAIR"      :
                          (rssi >=  5) ? "POOR"      : "NO SIGNAL";
    LOGF("[SIM] Signal: CSQ=%d  %d dBm  [%s]\n", rssi, dbm, quality);
  } else {
    LOGLN(F("[SIM] Signal: no +CSQ response"));
  }
}

// ─── Extract a quoted or trimmed value after a token in an AT response ────────
static String at_extractLine(const String& resp, const char* token) {
  int idx = resp.indexOf(token);
  if (idx == -1) return String();
  int start = idx + strlen(token);
  int end   = resp.indexOf('\n', start);
  String line = (end != -1) ? resp.substring(start, end) : resp.substring(start);
  line.trim();
  return line;
}

// Print the module's IMEI (unique modem serial — identifies this A7670C)
void sim_logIMEI() {
  // AT+CGSN returns the raw 15-digit IMEI on its own line
  String r = sim_sendCapture("AT+CGSN");
  r.replace("AT+CGSN", "");
  r.replace("OK", "");
  r.replace("\r", "");
  r.trim();
  // Keep only the first non-empty line (the digits)
  int nl = r.indexOf('\n');
  String imei = (nl != -1) ? r.substring(0, nl) : r;
  imei.trim();
  if (imei.length() >= 14) {
    LOGF("[SIM] IMEI: %s\n", imei.c_str());
  } else {
    LOGLN(F("[SIM] IMEI: unavailable"));
  }
}

// Print the currently configured APN (context 1) and its connection status
void sim_logAPN() {
  // Configured APN (what we asked the network for)
  String defc = sim_sendCapture("AT+CGDCONT?");
  String cfgApn = at_extractLine(defc, "+CGDCONT: 1,");
  if (cfgApn.length()) {
    LOGF("[SIM] APN config (CGDCONT): %s\n", cfgApn.c_str());
  }

  // Negotiated / active APN parameters from the network (only present if PDP up)
  String rdp = sim_sendCapture("AT+CGCONTRDP");
  String rdpApn = at_extractLine(rdp, "+CGCONTRDP:");
  if (rdpApn.length()) {
    LOGF("[SIM] APN active  (CGCONTRDP): %s\n", rdpApn.c_str());
    LOGLN(F("[SIM] APN connection: OK (network accepted the APN)"));
  } else {
    LOGLN(F("[SIM] APN connection: NOT active (no CGCONTRDP — data context down)"));
  }
}

// Print the local IP address assigned to this SIM by the carrier.
// A valid, non-zero IP here is proof the mobile-data connection really works.
bool sim_logLocalIP() {
  String r  = sim_sendCapture("AT+CGPADDR=1");
  int    idx = r.indexOf(F("+CGPADDR:"));
  String ip;
  if (idx != -1) {
    String line = at_extractLine(r, "+CGPADDR:");
    int comma = line.indexOf(',');
    if (comma != -1) ip = line.substring(comma + 1);
    ip.replace("\"", "");
    ip.trim();
  }
  bool hasIp = ip.length() > 0 && ip != "0.0.0.0";
  if (hasIp) {
    LOGF("[SIM] Local IP: %s  [DATA ONLINE]\n", ip.c_str());
  } else {
    LOGLN(F("[SIM] Local IP: none (0.0.0.0) — cellular DATA is NOT connected"));
    LOGLN(F("[SIM]   -> SIM registers for voice/SMS but has no data/APN session."));
    LOGLN(F("[SIM]   -> Check: data plan active, correct APN, PS registration, coverage."));
  }
  return hasIp;
}

// One-shot connectivity report: IMEI, signal, APN, local IP.
// Call after data-context activation to see exactly why cellular data fails.
void sim_logConnectivity() {
  DIVIDER();
  LOGLN(F("[SIM] ===== CELLULAR CONNECTIVITY REPORT ====="));
  LOGF("[SIM] SIM number: %s\n", SIM_NUMBER);
  sim_logIMEI();
  sim_logSignal();
  sim_logAPN();
  sim_logLocalIP();
  LOGLN(F("[SIM] ========================================"));
  DIVIDER();
}

bool sim_waitRegistered(uint32_t timeoutMs = 90000) {
  LOGLN(F("[SIM] Waiting for network registration (CS + PS)..."));
  uint32_t start = millis();

  bool csOk = false, psOk = false;

  while (millis() - start < timeoutMs) {
    if (!csOk) {
      String rc = sim_sendCapture("AT+CREG?");
      if (rc.indexOf(F(",1")) != -1 || rc.indexOf(F(",5")) != -1) {
        LOGLN(F("[SIM] CS registered (voice/SMS ready)"));
        csOk = true;
      }
    }

    if (!psOk) {
      String re = sim_sendCapture("AT+CEREG?");
      if (re.indexOf(F(",1")) != -1 || re.indexOf(F(",5")) != -1) {
        LOGLN(F("[SIM] LTE PS registered (data ready)"));
        psOk = true;
      } else {
        String rg = sim_sendCapture("AT+CGREG?");
        if (rg.indexOf(F(",1")) != -1 || rg.indexOf(F(",5")) != -1) {
          LOGLN(F("[SIM] GPRS PS registered (data ready)"));
          psOk = true;
        }
      }
    }

    if (csOk && psOk) return true;

    LOGF("[SIM] CS:%s PS:%s — waiting... %lu s\n",
         csOk ? "OK" : "wait", psOk ? "OK" : "wait",
         (millis() - start) / 1000);
    delay(4000);
  }

  LOGLN(F("[SIM] Registration TIMEOUT"));
  if (!csOk) LOGLN(F("[SIM] CS failed — check SIM inserted, carrier coverage, antenna"));
  if (!psOk) LOGLN(F("[SIM] PS failed — data won't work even though calls/SMS may work"));
  return csOk;
}

// Ask the module WHY the last data/registration action failed. AT+CEER returns
// the network's own cause (e.g. "missing or unknown APN", "insufficient
// resources", "operator determined barring"). This is what separates a real
// data-plan / APN rejection (module answers with a reason) from a local
// BROWNOUT (module has reset and answers nothing / garbage).
void sim_logExtendedError() {
  String r = sim_sendCapture("AT+CEER", 4000);
  String reason = at_extractLine(r, "+CEER:");
  if (reason.length()) {
    LOGF("[SIM] Last failure cause (CEER): %s\n", reason.c_str());
    LOGLN(F("[SIM]   -> module answered => NOT a reset. Suspect APN / data plan."));
  } else {
    LOGLN(F("[SIM] CEER: no reason returned — module may have reset."));
    LOGLN(F("[SIM]   -> silence here + garbage serial + GPS drop => POWER BROWNOUT."));
    LOGLN(F("[SIM]   -> give the A7670C its own 5V/2A supply + 1000uF cap, shared GND."));
  }
}

bool sim_activateDataContext() {
  // Define the PDP context (APN) BEFORE attaching. On VI Vodafone, attaching
  // with a blank/default context first makes the network reject the data
  // session — SMS/voice still work but you never get an IP. Trust data only
  // after a real, non-zero local IP (not the bare "OK" from CGACT).
  const char* apns[] = { SIM_APN, "internet", "www", nullptr };

  for (int i = 0; apns[i] != nullptr; i++) {
    LOGF("[SIM] Trying APN: %s\n", apns[i]);

    char cmd[80];
    snprintf(cmd, sizeof(cmd), "AT+CGDCONT=1,\"IP\",\"%s\"", apns[i]);
    if (!sim_sendExpect(cmd, "OK")) continue;
    delay(300);

    // Attach to packet service AFTER the APN is defined
    if (!sim_sendExpect("AT+CGATT=1", "OK", 20000)) {
      LOGLN(F("[SIM] CGATT=1 failed for this APN"));
      continue;
    }
    delay(500);

    sim_sendExpect("AT+CGACT=0,1", "OK", 8000);   // clear any stale context
    delay(500);

    // Activate the bearer — retry once. A single transient supply sag or a slow
    // network response can fail the first attempt. On the first failure, ask the
    // module for the network's reason (CEER) so power vs. plan is unambiguous.
    bool activated = sim_sendExpect("AT+CGACT=1,1", "OK", 30000);
    if (!activated) {
      LOGF("[SIM] CGACT attempt 1 failed on %s — asking module why...\n", apns[i]);
      sim_logExtendedError();
      delay(2000);
      activated = sim_sendExpect("AT+CGACT=1,1", "OK", 30000);
    }
    if (!activated) {
      LOGF("[SIM] CGACT failed on %s after retry\n", apns[i]);
      delay(1500);
      continue;
    }

    // The ONLY reliable proof of data: a real, non-zero local IP
    if (sim_logLocalIP()) {
      LOGF("[SIM] Data ACTIVE with real IP — APN: %s\n", apns[i]);
      return true;
    }
    LOGF("[SIM] Context up but NO IP on APN %s — trying next\n", apns[i]);
    delay(1500);
  }

  LOGLN(F("[SIM] All APNs failed — no data IP assigned"));
  return false;
}

void sim_configureSsl() {
  sim_sendExpect("AT+CSSLCFG=\"ignorertctime\",0,1", "OK", 3000);
  sim_sendExpect("AT+CSSLCFG=\"sslversion\",0,4",    "OK", 3000);
  sim_sendExpect("AT+CSSLCFG=\"authmode\",0,0",      "OK", 3000);
}

bool sim_initialize() {
  DIVIDER();
  LOGLN(F("[SIM] Initializing A7670C 4G module..."));
  DIVIDER();

  if (!sim_isAlive()) {
    LOGLN(F("[SIM] Module not responding — waiting 5 s for recovery..."));
    delay(5000);
    sim_clearRx();
    if (!sim_isAlive()) {
      LOGLN(F("[SIM] FATAL: Module unresponsive"));
      LOGLN(F("[SIM] Check: 5V power supply, GND shared with ESP32, TX/RX wiring"));
      return false;
    }
  }
  LOGLN(F("[SIM] Module alive"));

  sim_sendExpect("ATE0",      "OK");
  sim_sendExpect("AT+CMEE=2", "OK");
  sim_sendExpect("AT+CFUN=1", "OK", 10000);  // ensure full RF functionality
  sim_sendExpect("AT+CNMP=2", "OK", 3000);   // 2=auto; use 38 (LTE-only) if PS won't register

  if (!sim_checkSim())           return false;
  sim_logSignal();
  if (!sim_waitRegistered())     return false;
  sim_logSignal();
  sim_configureSsl();
  if (!sim_activateDataContext()) {
    // Data context failed — dump full diagnostics so the cause is visible
    sim_logConnectivity();
    return false;
  }

  // Data context reports active — confirm with a real local IP before trusting it
  sim_logConnectivity();

  networkReady = true;
  errCount     = 0;
  DIVIDER();
  LOGLN(F("[SIM] A7670C READY -- 4G internet active"));
  LOGF("[SIM] Endpoint: https://%s%s\n", SERVER_HOST, SERVER_PATH);
  DIVIDER();
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  JSON PAYLOAD BUILDER
// ═════════════════════════════════════════════════════════════════════════════

int buildPayload(char* buf, int bufLen, bool sos) {
  // ArduinoJson v7 replaced StaticJsonDocument with the elastic JsonDocument
  // (StaticJsonDocument is deprecated and warns). Guard so this builds warning-
  // free on v7 while still compiling on v6.
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<384> doc;
#endif
  doc["dev_id"]     = BUS_ID;
  doc["lat"]        = snap.lat;
  doc["lon"]        = snap.lon;
  doc["speed_kmh"]  = (double)(round(snap.speed_kmh  * 10.0) / 10.0);
  doc["sos_active"] = sos ? 1 : 0;
  doc["altitude"]   = (double)(round(snap.altitude_m * 10.0) / 10.0);
  doc["satellites"] = (int)snap.satellites;
  doc["hdop"]       = (double)(round(snap.hdop       * 100.0) / 100.0);
  doc["gps_date"]   = snap.date;
  doc["gps_time"]   = snap.utcTime;

  return serializeJson(doc, buf, bufLen);
}

// ═════════════════════════════════════════════════════════════════════════════
//  HTTP POST
// ═════════════════════════════════════════════════════════════════════════════

bool http_post(const char* payload, int payloadLen) {
  LOGF("[HTTP] Sending %d bytes to https://%s%s\n",
       payloadLen, SERVER_HOST, SERVER_PATH);

  sim_sendExpect("AT+HTTPTERM", "OK", 4000);
  delay(300);

  String r;

  r = sim_sendCapture("AT+HTTPINIT", 6000);
  if (r.indexOf("OK") == -1) {
    LOGF("[HTTP] HTTPINIT failed: %s\n", r.c_str());
    return false;
  }

  // NOTE: the A7670C has NO 'AT+HTTPSSL' command (that is a SIM800 command).
  // On the A7670C, HTTPS is enabled purely by the https:// URL scheme plus the
  // SSL-context bind below (AT+HTTPPARA "SSLCFG"). Sending AT+HTTPSSL only ever
  // returns ERROR and can leave the HTTP parser in a bad state, so it is gone.

  // Set the URL *first* so the module knows it is an https:// request before
  // we bind the SSL context.
  char urlCmd[320];
  snprintf(urlCmd, sizeof(urlCmd),
           "AT+HTTPPARA=\"URL\",\"https://%s%s\"", SERVER_HOST, SERVER_PATH);
  r = sim_sendCapture(urlCmd, 5000);
  if (r.indexOf("OK") == -1) {
    LOGF("[HTTP] Set URL failed: %s\n", r.c_str());
    sim_sendExpect("AT+HTTPTERM", "OK", 2000); return false;
  }

  // Bind PDP context 1 (the data context we activated). NON-FATAL: many A7670C
  // firmwares auto-use context 1 for HTTP and return ERROR to an explicit CID
  // set — aborting here was silently blocking every POST. The module still uses
  // context 1, so log the warning and carry on.
  r = sim_sendCapture("AT+HTTPPARA=\"CID\",1", 3000);
  if (r.indexOf("OK") == -1)
    LOGF("[HTTP] CID set warning (continuing on default ctx 1): %s\n", r.c_str());

  // Content-Type header. NON-FATAL for the same reason — the server does not
  // require it to parse the JSON body.
  r = sim_sendCapture("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 3000);
  if (r.indexOf("OK") == -1)
    LOGF("[HTTP] CONTENT warning (continuing): %s\n", r.c_str());

  // Bind SSL context 0 to the HTTP session (this is what actually enables HTTPS
  // on the A7670C). Non-fatal — some firmware auto-binds from the https:// URL.
  r = sim_sendCapture("AT+HTTPPARA=\"SSLCFG\",0", 3000);
  if (r.indexOf("OK") == -1)
    LOGF("[HTTP] SSLCFG bind warning (continuing): %s\n", r.c_str());

  // Auth token header
  char hdrCmd[160];
  snprintf(hdrCmd, sizeof(hdrCmd),
           "AT+HTTPPARA=\"USERDATA\",\"Token: %s\"", DEVICE_TOKEN);
  r = sim_sendCapture(hdrCmd, 3000);
  if (r.indexOf("OK") == -1)
    LOGF("[HTTP] USERDATA header warning (continuing): %s\n", r.c_str());

  char dataCmd[48];
  snprintf(dataCmd, sizeof(dataCmd), "AT+HTTPDATA=%d,10000", payloadLen);
  sim_clearRx();
  simSerial.print(dataCmd);
  simSerial.print(F("\r\n"));

  String   prompt;
  uint32_t t0 = millis();
  while (millis() - t0 < 7000) {
    while (simSerial.available()) prompt += (char)simSerial.read();
    if (prompt.indexOf(F("DOWNLOAD")) != -1) break;
    delay(20);
  }
  if (prompt.indexOf(F("DOWNLOAD")) == -1) {
    LOGLN(F("[HTTP] No DOWNLOAD prompt from module"));
    sim_sendExpect("AT+HTTPTERM", "OK", 2000); return false;
  }

  simSerial.print(payload);
  delay(700);

  String ack;
  t0 = millis();
  while (millis() - t0 < 4000) {
    while (simSerial.available()) ack += (char)simSerial.read();
    if (ack.indexOf(F("OK")) != -1) break;
    delay(20);
  }

  sim_clearRx();
  simSerial.print(F("AT+HTTPACTION=1\r\n"));

  String   actionResp;
  t0 = millis();
  while (millis() - t0 < HTTP_TIMEOUT_MS) {
    while (simSerial.available()) actionResp += (char)simSerial.read();
    if (actionResp.indexOf(F("+HTTPACTION:")) != -1) break;
    delay(100);
  }

  // Dump the raw action response so SSL/DNS error codes are never hidden.
  actionResp.trim();
  LOGF("[HTTP] HTTPACTION raw: %s\n", actionResp.c_str());

  int httpCode = -1;
  int idx      = actionResp.indexOf(F("+HTTPACTION:"));
  if (idx != -1) {
    String part = actionResp.substring(idx + 12);
    part.trim();
    int c1 = part.indexOf(',');
    if (c1 != -1) {
      int    c2      = part.indexOf(',', c1 + 1);
      String codeStr = (c2 != -1) ? part.substring(c1+1, c2) : part.substring(c1+1);
      codeStr.trim();
      httpCode = codeStr.toInt();
    }
  }

  String serverReply = sim_sendCapture("AT+HTTPREAD", 5000);
  int bodyStart = serverReply.indexOf("\r\n\r\n");
  if (bodyStart == -1) bodyStart = serverReply.indexOf("+HTTPREAD:");
  if (bodyStart != -1)
    LOGF("[HTTP] Server reply: %s\n", serverReply.substring(bodyStart).c_str());

  sim_sendExpect("AT+HTTPTERM", "OK", 3000);

  bool success = (httpCode >= 200 && httpCode < 300);
  if (success) {
    sendCount++;
    LOGF("[HTTP] POST OK  HTTP %d  (total sent: %lu)\n", httpCode, sendCount);
  } else {
    LOGF("[HTTP] POST FAILED  HTTP %d\n", httpCode);
    if (httpCode == 401 || httpCode == 403) {
      LOGLN(F("[HTTP] Auth error — check DEVICE_TOKEN matches server .env"));
    } else if (httpCode == -1) {
      LOGLN(F("[HTTP] No response — check SERVER_HOST is correct and server is running"));
    }
  }
  return success;
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN SEND CYCLE
// ═════════════════════════════════════════════════════════════════════════════

void telemetry_send() {
  if (!gps_snapshot()) {
    LOGLN(F("[MAIN] No GPS fix — skipping send, waiting for satellites..."));
    gps_waitForFix(30000);
    return;
  }

  LOGF("[MAIN] Sending: Lat=%.6f  Lon=%.6f  Speed=%.1f km/h  Sats=%lu  SOS=%s\n",
       snap.lat, snap.lon, snap.speed_kmh, snap.satellites, sosActive ? "ACTIVE" : "off");

  char payloadBuf[512];
  int  payloadLen = buildPayload(payloadBuf, sizeof(payloadBuf), sosActive);
  if (payloadLen <= 0) {
    LOGLN(F("[MAIN] JSON build failed")); return;
  }

  // Print the exact JSON being sent to the Serial Monitor
  DIVIDER();
  LOGF("[JSON] %s\n", payloadBuf);
  DIVIDER();

  if (http_post(payloadBuf, payloadLen)) {
    errCount = 0;
  } else {
    errCount++;
    LOGF("[MAIN] Consecutive errors: %d / 5\n", errCount);
    if (errCount >= 5) {
      DIVIDER();
      LOGLN(F("[MAIN] 5 consecutive failures — network may be lost"));
      LOGLN(F("[MAIN] Reinitializing 4G connection..."));
      DIVIDER();
      networkReady = false;
      errCount     = 0;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  SETUP
// ═════════════════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(MONITOR_BAUD);
  delay(600);

  LOGLN(F(""));
  LOGLN(F("============================================"));
  LOGLN(F("  BusTracker ESP32 -- Powering Up          "));
  LOGLN(F("  Module: SIMCom A7670C 4G + SOS button     "));
  LOGLN(F("============================================"));
  LOGF("  Bus ID   : %s\n",   BUS_ID);
  LOGF("  SIM No.  : %s\n",   SIM_NUMBER);
  LOGF("  Server   : https://%s%s\n", SERVER_HOST, SERVER_PATH);
  LOGF("  APN      : %s\n",   SIM_APN);
  LOGLN(F("============================================"));
  LOGLN(F(""));

  sos_setup();
  LOGLN(F("[SOS] Button armed on GPIO32 (press to trigger, press again to clear)"));

  // Start GPS UART first — GPS runs independently of SIM
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  LOGLN(F("[GPS] UART2 started (RX=GPIO16, TX=GPIO17, baud=9600)"));

  // Start SIM UART
  simSerial.begin(SIM_BAUD, SERIAL_8N1, SIM_RX_PIN, SIM_TX_PIN);
  LOGLN(F("[SIM] UART1 started (RX=GPIO26, TX=GPIO27, baud=115200)"));
  LOGLN(F("[SIM] Waiting 3 s for module to power up..."));
  delay(3000);

  // Try SIM init up to 3 times, then continue without it
  bool simOk = false;
  for (uint8_t attempt = 1; attempt <= 3; attempt++) {
    LOGF("[SIM] Init attempt %d / 3...\n", attempt);
    if (sim_initialize()) { simOk = true; break; }
    if (attempt < 3) {
      LOGLN(F("[SIM] Retrying in 5 s..."));
      delay(5000);
    }
  }

  if (!simOk) {
    DIVIDER();
    LOGLN(F("[SIM] *** A7670C NOT RESPONDING ***"));
    LOGLN(F("[SIM] Check: 5V supply to A7670C, shared GND, TX->GPIO26, RX->GPIO27"));
    LOGLN(F("[SIM] Continuing in GPS-only mode — coordinates will show below"));
    DIVIDER();
  }

  // Acquire first GPS fix — runs regardless of SIM state
  LOGLN(F("[GPS] Starting satellite search..."));
  if (!gps_waitForFix(GPS_FIX_TIMEOUT_MS)) {
    LOGLN(F("[GPS] *** No fix within 2 min — check antenna/open-sky view ***"));
    LOGLN(F("[GPS] Continuing — will keep retrying in main loop"));
  }

  DIVIDER();
  LOGF("[MAIN] Setup complete | SIM: %s | GPS: searching\n",
       simOk ? "ONLINE" : "OFFLINE");
  DIVIDER();
}

// ═════════════════════════════════════════════════════════════════════════════
//  LOOP
// ═════════════════════════════════════════════════════════════════════════════

static uint32_t lastSimRetryMs = 0;
#define SIM_RETRY_INTERVAL_MS  60000UL   // retry SIM every 60 s if offline

void loop() {
  // Always feed GPS — must never be starved
  gps_feed();

  // Always poll SOS button — must never be starved
  sos_poll();

  // Periodic live-status print (GPS + SIM + SOS state every 5 s)
  if (millis() - lastStatusMs >= STATUS_PRINT_MS) {
    lastStatusMs = millis();
    gps_snapshot();
    printLiveStatus();
  }

  // If SIM offline, retry every 60 s — GPS/SOS still run normally
  if (!networkReady) {
    if (millis() - lastSimRetryMs >= SIM_RETRY_INTERVAL_MS) {
      lastSimRetryMs = millis();
      LOGLN(F("[SIM] Attempting to reconnect A7670C..."));
      sim_initialize();
    }
    delay(10);
    return;
  }

  // Send telemetry on interval (only when SIM is online)
  if (millis() - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = millis();
    telemetry_send();
  }

  delay(10);
}
