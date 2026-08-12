#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_BMP280.h>
#include <BH1750.h>
#include "pitches.h"
#include "songs_library.h"
#include "secrets.h"

// ==========================================
// --- WEBSOCKETS SERVER ---
// ==========================================
AsyncWebServer server(81);
AsyncWebSocket ws("/");const unsigned long PUBLISH_INTERVAL = 1000; // publish sensor data every 1 s
unsigned long lastPublish = 0;

// ==========================================
// --- HISTORY BUFFER (24 HOURS) ---
// ==========================================
const int HISTORY_SIZE = 1440; // 24 hours at 1 sample/minute
float histTemp[HISTORY_SIZE];
float histHum[HISTORY_SIZE];
float histPres[HISTORY_SIZE];
float histLight[HISTORY_SIZE];
int histIndex = 0;
int histCount = 0;
unsigned long lastHistorySave = 0;
const unsigned long HISTORY_INTERVAL = 60000; // 1 minute

// ==========================================
// --- HARDWARE & PIN DEFINITIONS ---
// ==========================================
#define SDA_PIN    7
#define SCL_PIN    6
#define BUZZER_PIN 5

// 2-Channel Relay Pins
#define RELAY_CH1_PIN 2
#define RELAY_CH2_PIN 3

// Relay configuration (true for active-LOW modules)
const bool RELAY_ACTIVE_LOW = true;

// ==========================================
// --- ALARM LIMITS (runtime-updatable) ---
// ==========================================
float tempMin  = 22.0,  tempMax  = 37.0;   // °C
float humMin   = 40.0,  humMax   = 70.0;   // %RH
float presMin  = 950.0, presMax  = 1050.0; // hPa
float lightMin = 50.0,  lightMax = 1000.0; // lux
bool  buzzerEnabled = true;

// Hysteresis (fixed — not configurable from web)
const float TEMP_HYST  = 1.0;
const float HUM_HYST   = 5.0;
const float PRES_HYST  = 2.0;
const float LIGHT_HYST = 50.0;

// ==========================================
// --- SENSOR OBJECTS ---
// ==========================================
Adafruit_AHTX0 aht;
Adafruit_BMP280 bmp;
BH1750 lightMeter;

// I2C OLED (SH1106 128x64)
Adafruit_SH1106G display = Adafruit_SH1106G(128, 64, &Wire, -1);

// ==========================================
// --- GLOBAL STATE ---
// ==========================================
float avgTemp = 0, avgHum = 0, avgPres = 0, avgLight = 0;
float bmpTempCurrent = 0;

const int NUM_SAMPLES = 10;
float tempSamples[NUM_SAMPLES]  = {0};
float humSamples[NUM_SAMPLES]   = {0};
float presSamples[NUM_SAMPLES]  = {0};
float lightSamples[NUM_SAMPLES] = {0};
int   sampleIndex = 0;
int   sampleCount = 0;

const unsigned long SAMPLE_INTERVAL = 1000; 
unsigned long lastSampleTime = 0;

// Alarm enums
enum AlarmState { NORMAL, ALARM_HIGH, ALARM_LOW };
AlarmState tempAlarm  = NORMAL;
AlarmState humAlarm   = NORMAL;
AlarmState presAlarm  = NORMAL;
AlarmState lightAlarm = NORMAL;
bool globalAlarm = false;
bool prevGlobalAlarm = false;

// Buzzer timing logic
unsigned long alarmStartTime = 0;
const unsigned long ALARM_MAX_DURATION = 30000; // max 30s beep duration
bool buzzerState = false; // Is the buzzer currently physically ON?
unsigned long lastBuzzerToggle = 0;
const unsigned long ALARM_HIGH_INTERVAL = 250; // fast pulse

// Buzzer PWM constants
const int BUZZ_CH        = 0;
const int BUZZ_RES       = 8;
const int BUZZ_FREQ_HIGH = 4000;
const int BUZZ_FREQ_LOW  = 2000;

// ==========================================
// --- BUZZER TYPE ---
// ==========================================
// This is a PASSIVE buzzer — requires tone() to produce sound.
#define ALARM_TONE_FREQ 1000  // Hz for alarm beeps

void buzzerOn(unsigned int freq) {
  tone(BUZZER_PIN, freq > 0 ? freq : ALARM_TONE_FREQ);
}

void buzzerOff() {
  noTone(BUZZER_PIN);
}

AlarmState activeAlarmType = NORMAL;
String     activeAlarmMsg  = "";
unsigned int activeBuzzerFreq = 0;
unsigned long lastDefaultBeep = 0;

// ==========================================
// --- WEBSOCKETS LOGIC ---
// ==========================================
void sendDataToAll() {
  String json = "{\"type\":\"data\",";
  json += "\"temperature\":" + String(avgTemp, 1) + ",";
  json += "\"humidity\":" + String(avgHum, 1) + ",";
  json += "\"pressure\":" + String(avgPres, 1) + ",";
  json += "\"light\":" + String(avgLight, 1) + ",";
  json += "\"alarm\":\"" + String(activeAlarmType) + "\"}";

  ws.textAll(json);
}

void sendConfigToClient(uint32_t clientId) {
  String json = "{\"type\":\"config\",";
  json += "\"temp_min\":" + String(tempMin, 1) + ",";
  json += "\"temp_max\":" + String(tempMax, 1) + ",";
  json += "\"hum_min\":" + String(humMin, 1) + ",";
  json += "\"hum_max\":" + String(humMax, 1) + ",";
  json += "\"pres_min\":" + String(presMin, 1) + ",";
  json += "\"pres_max\":" + String(presMax, 1) + ",";
  json += "\"light_min\":" + String(lightMin, 1) + ",";
  json += "\"light_max\":" + String(lightMax, 1) + ",";
  json += "\"buzzer\":" + String(buzzerEnabled ? "true" : "false") + "}";

  ws.text(clientId, json);
}

void sendHistoryToClient(uint32_t clientId) {
  String json = "{\"type\":\"history\",\"data\":[";
  bool first = true;
  int startIdx = (histCount == HISTORY_SIZE) ? histIndex : 0;
  for (int i = 0; i < histCount; i++) {
    int idx = (startIdx + i) % HISTORY_SIZE;
    if (!first) json += ",";
    json += "[";
    json += String(histTemp[idx], 1) + ",";
    json += String(histHum[idx], 1) + ",";
    json += String(histPres[idx], 1) + ",";
    json += String(histLight[idx], 1);
    json += "]";
    first = false;
  }
  json += "]}";
  ws.text(clientId, json);
}

int activeSongIndex = -1;
int currentSongStep = 0;
unsigned long songStepStartTime = 0;
unsigned long songStepDuration = 0;
bool inNotePause = false;

void triggerSongById(const char* songId) {
  if (!songId) return;
  if (strcmp(songId, "stop") == 0) {
    activeSongIndex = -1;
    currentSongStep = 0;
    inNotePause = false;
    noTone(BUZZER_PIN);
    return;
  }
  for (int i = 0; i < TOTAL_SONGS; i++) {
    if (strcmp(SONGS_LIBRARY[i].id, songId) == 0) {
      activeSongIndex = i;
      currentSongStep = 0;
      songStepStartTime = 0;
      inNotePause = false;
      noTone(BUZZER_PIN);
      Serial.printf("[SONG] Started playing: %s (%s)\n", SONGS_LIBRARY[i].title, SONGS_LIBRARY[i].id);
      return;
    }
  }
  Serial.printf("[SONG] Song not found: %s\n", songId);
}

void stopSongPlayback() {
  activeSongIndex = -1;
  currentSongStep = 0;
  inNotePause = false;
  noTone(BUZZER_PIN);
}

void updateSongPlayback(unsigned long currentMillis) {
  if (activeSongIndex < 0 || activeSongIndex >= TOTAL_SONGS || !buzzerEnabled) return;

  const SongDef &song = SONGS_LIBRARY[activeSongIndex];

  if (currentSongStep >= song.length) {
    stopSongPlayback();
    return;
  }

  if (songStepStartTime == 0) {
    int noteDurationSetting = song.durations[currentSongStep];
    int pitch = song.melody[currentSongStep];
    if (noteDurationSetting <= 0) noteDurationSetting = 4;
    int noteDur = 1000 / noteDurationSetting;

    if (pitch != REST) {
      tone(BUZZER_PIN, pitch, noteDur);
    } else {
      noTone(BUZZER_PIN);
    }
    songStepDuration = noteDur;
    songStepStartTime = currentMillis;
    inNotePause = false;
  } else if (!inNotePause) {
    if (currentMillis - songStepStartTime >= songStepDuration) {
      noTone(BUZZER_PIN);
      inNotePause = true;
      songStepStartTime = currentMillis;
      songStepDuration = songStepDuration * 0.30;
    }
  } else {
    if (currentMillis - songStepStartTime >= songStepDuration) {
      currentSongStep++;
      songStepStartTime = 0;
      inNotePause = false;
    }
  }
}

void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    IPAddress ip = client->remoteIP();
    Serial.printf("[%u] Connected from %d.%d.%d.%d\n", client->id(), ip[0], ip[1], ip[2], ip[3]);
    sendConfigToClient(client->id());
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("[%u] Disconnected!\n", client->id());
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, data, len);
      if (error) {
        Serial.print("deserializeJson() failed: ");
        Serial.println(error.c_str());
        return;
      }
      if (!doc["type"].isNull()) {
        const char* msgType = doc["type"];
        if (strcmp(msgType, "config") == 0) {
          tempMin = doc["temp_min"];
          tempMax = doc["temp_max"];
          humMin = doc["hum_min"];
          humMax = doc["hum_max"];
          presMin = doc["pres_min"];
          presMax = doc["pres_max"];
          lightMin = doc["light_min"];
          lightMax = doc["light_max"];
          buzzerEnabled = doc["buzzer"];
          buzzerOff(); // always ensure correct pin state when mute toggled
          sendConfigToClient(client->id());
        } else if (strcmp(msgType, "history") == 0) {
          sendHistoryToClient(client->id());
        } else if (strcmp(msgType, "play_song") == 0) {
          const char* song = doc["song"];
          if (song) {
            triggerSongById(song);
          }
        }
      }
    }
  }
}

// ==========================================
// --- OLED HELPER ---
// ==========================================
void oledStatus(const char* line1, const char* line2 = "") {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);  display.println("PMS33 booting...");
  display.setCursor(0, 16); display.println(line1);
  display.setCursor(0, 28); display.println(line2);
  display.display();
}

// ==========================================
// --- NETWORKING ---
// ==========================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  oledStatus("WiFi: connecting...");
  Serial.print("Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
    oledStatus("WiFi: OK", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("WiFi: timed out — running offline");
    oledStatus("WiFi: FAILED", "(offline mode)");
  }
  delay(800);
}

// ==========================================
// --- RELAY HELPER ---
// ==========================================
void handleRelays(bool isAlarmActive) {
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(RELAY_CH1_PIN, isAlarmActive ? LOW  : HIGH);
    if (!isAlarmActive) digitalWrite(RELAY_CH2_PIN, HIGH);
  } else {
    digitalWrite(RELAY_CH1_PIN, isAlarmActive ? HIGH : LOW);
    if (!isAlarmActive) digitalWrite(RELAY_CH2_PIN, LOW);
  }
}

// ==========================================
// --- SETUP ---
// ==========================================
void setup() {
  Serial.begin(115200);

  // Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerOff(); // ensure it starts OFF

  // Relays
  pinMode(RELAY_CH1_PIN, OUTPUT);
  pinMode(RELAY_CH2_PIN, OUTPUT);
  handleRelays(false);

  Wire.begin(SDA_PIN, SCL_PIN);

  // OLED
  if (!display.begin(0x3C, true)) {
    Serial.println("OLED init failed!");
    while (1);
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.println("PMS33 booting...");
  display.display();

  // --- Startup Nokia tune ---
  int nokiaMelody[] = {
    NOTE_E5, NOTE_D5, NOTE_FS4, NOTE_GS4,
    NOTE_CS5, NOTE_B4, NOTE_D4, NOTE_E4,
    NOTE_B4, NOTE_A4, NOTE_CS4, NOTE_E4,
    NOTE_A4
  };
  int nokiaDurations[] = {
    8, 8, 4, 4,
    8, 8, 4, 4,
    8, 8, 4, 4,
    2
  };
  int nokiaSize = sizeof(nokiaDurations) / sizeof(int);
  for (int note = 0; note < nokiaSize; note++) {
    int duration = 1000 / nokiaDurations[note];
    tone(BUZZER_PIN, nokiaMelody[note], duration);
    int pauseBetweenNotes = duration * 1.30;
    delay(pauseBetweenNotes);
    noTone(BUZZER_PIN);
  }

  // Sensors
  if (!aht.begin()) Serial.println("AHT20 not found!");

  if (!bmp.begin(0x76) && !bmp.begin(0x77)) {
    Serial.println("BMP280 not found!");
  } else {
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                    Adafruit_BMP280::SAMPLING_X2,
                    Adafruit_BMP280::SAMPLING_X16,
                    Adafruit_BMP280::FILTER_X16,
                    Adafruit_BMP280::STANDBY_MS_500);
  }

  if (!lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x23, &Wire)) {
    Serial.println("BH1750 not found!");
  }

  connectWiFi();
  
  // Configure PNA and CORS headers globally
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Private-Network", "true");

  // Handle OPTIONS preflight for Private Network Access
  server.on("/", HTTP_OPTIONS, [](AsyncWebServerRequest *request){
    AsyncWebServerResponse *response = request->beginResponse(204);
    response->addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type");
    request->send(response);
  });

  // Attach WebSocket
  ws.onEvent(onEvent);
  server.addHandler(&ws);
  server.begin();

  delay(1000);
}

// ==========================================
// --- LOOP ---
// ==========================================
void loop() {
  unsigned long currentMillis = millis();

  connectWiFi();
  // AsyncWebSocket handles cleanup
  ws.cleanupClients();

  // ─── 1. SENSOR SAMPLING (every 1 s) ──────────────────────────────
  if (currentMillis - lastSampleTime >= SAMPLE_INTERVAL) {
    lastSampleTime = currentMillis;

    sensors_event_t humidity, temp_aht;
    aht.getEvent(&humidity, &temp_aht);

    bmpTempCurrent  = bmp.readTemperature();
    float pres_hpa  = bmp.readPressure() / 100.0F;
    float lux       = lightMeter.readLightLevel();

    tempSamples[sampleIndex]  = temp_aht.temperature;
    humSamples[sampleIndex]   = humidity.relative_humidity;
    presSamples[sampleIndex]  = pres_hpa;
    lightSamples[sampleIndex] = lux;

    sampleIndex = (sampleIndex + 1) % NUM_SAMPLES;
    if (sampleCount < NUM_SAMPLES) sampleCount++;

    float sumTemp = 0, sumHum = 0, sumPres = 0, sumLight = 0;
    for (int i = 0; i < sampleCount; i++) {
      sumTemp  += tempSamples[i];
      sumHum   += humSamples[i];
      sumPres  += presSamples[i];
      sumLight += lightSamples[i];
    }
    avgTemp  = sumTemp  / sampleCount;
    avgHum   = sumHum   / sampleCount;
    avgPres  = sumPres  / sampleCount;
    avgLight = sumLight / sampleCount;

    // ─── 2. ALARM EVALUATION (with hysteresis) ───────────────────────
    // Temperature
    if      (avgTemp < tempMin)                                          tempAlarm = ALARM_LOW;
    else if (avgTemp > tempMax)                                          tempAlarm = ALARM_HIGH;
    else if (tempAlarm == ALARM_LOW  && avgTemp > tempMin + TEMP_HYST)  tempAlarm = NORMAL;
    else if (tempAlarm == ALARM_HIGH && avgTemp < tempMax - TEMP_HYST)  tempAlarm = NORMAL;

    // Humidity
    if      (avgHum < humMin)                                         humAlarm = ALARM_LOW;
    else if (avgHum > humMax)                                         humAlarm = ALARM_HIGH;
    else if (humAlarm == ALARM_LOW  && avgHum > humMin + HUM_HYST)   humAlarm = NORMAL;
    else if (humAlarm == ALARM_HIGH && avgHum < humMax - HUM_HYST)   humAlarm = NORMAL;

    // Pressure
    if      (avgPres < presMin)                                           presAlarm = ALARM_LOW;
    else if (avgPres > presMax)                                           presAlarm = ALARM_HIGH;
    else if (presAlarm == ALARM_LOW  && avgPres > presMin + PRES_HYST)   presAlarm = NORMAL;
    else if (presAlarm == ALARM_HIGH && avgPres < presMax - PRES_HYST)   presAlarm = NORMAL;

    // Light
    if      (avgLight < lightMin)                                              lightAlarm = ALARM_LOW;
    else if (avgLight > lightMax)                                              lightAlarm = ALARM_HIGH;
    else if (lightAlarm == ALARM_LOW  && avgLight > lightMin + LIGHT_HYST)    lightAlarm = NORMAL;
    else if (lightAlarm == ALARM_HIGH && avgLight < lightMax - LIGHT_HYST)    lightAlarm = NORMAL;

    // ─── 3. DETERMINE ACTIVE ALARM ───────────────────────────────────
    activeBuzzerFreq = 0;
    activeAlarmMsg   = "";
    activeAlarmType  = NORMAL;

    if      (tempAlarm  == ALARM_HIGH) { activeAlarmMsg = "** High Temp! **";  activeBuzzerFreq = BUZZ_FREQ_HIGH; activeAlarmType = ALARM_HIGH; }
    else if (tempAlarm  == ALARM_LOW)  { activeAlarmMsg = "** Low Temp! **";   activeBuzzerFreq = BUZZ_FREQ_LOW;  activeAlarmType = ALARM_LOW;  }
    else if (humAlarm   == ALARM_HIGH) { activeAlarmMsg = "** High Humid! **"; activeBuzzerFreq = BUZZ_FREQ_HIGH; activeAlarmType = ALARM_HIGH; }
    else if (humAlarm   == ALARM_LOW)  { activeAlarmMsg = "** Low Humid! **";  activeBuzzerFreq = BUZZ_FREQ_LOW;  activeAlarmType = ALARM_LOW;  }
    else if (presAlarm  == ALARM_HIGH) { activeAlarmMsg = "** High Pres! **";  activeBuzzerFreq = BUZZ_FREQ_HIGH; activeAlarmType = ALARM_HIGH; }
    else if (presAlarm  == ALARM_LOW)  { activeAlarmMsg = "** Low Pres! **";   activeBuzzerFreq = BUZZ_FREQ_LOW;  activeAlarmType = ALARM_LOW;  }
    else if (lightAlarm == ALARM_HIGH) { activeAlarmMsg = "** High Light! **"; activeBuzzerFreq = BUZZ_FREQ_HIGH; activeAlarmType = ALARM_HIGH; }
    else if (lightAlarm == ALARM_LOW)  { activeAlarmMsg = "** Low Light! **";  activeBuzzerFreq = BUZZ_FREQ_LOW;  activeAlarmType = ALARM_LOW;  }

    globalAlarm = (tempAlarm != NORMAL || humAlarm != NORMAL ||
                   presAlarm != NORMAL || lightAlarm != NORMAL);

    if (globalAlarm && !prevGlobalAlarm) {
      alarmStartTime = currentMillis; // Start 30s timer
    }
    prevGlobalAlarm = globalAlarm;

    handleRelays(globalAlarm);

    // ─── 4. OLED UPDATE ──────────────────────────────────────────────
    display.clearDisplay();
    display.setCursor(0, 0);
    if (globalAlarm) display.println(activeAlarmMsg);
    else             display.println("PMS33");

    display.setCursor(0, 12);
    display.print("AHT T: "); display.print(avgTemp, 1); display.print(" C");
    if (tempAlarm != NORMAL) display.print(" [!]");

    display.setCursor(0, 22);
    display.print("Hum : "); display.print(avgHum, 1); display.print(" %");
    if (humAlarm != NORMAL) display.print(" [!]");

    display.setCursor(0, 32);
    display.print("BMP T: "); display.print(bmpTempCurrent, 1); display.print(" C");

    display.setCursor(0, 42);
    display.print("Pres : "); display.print(avgPres, 0); display.print(" hPa");
    if (presAlarm != NORMAL) display.print(" [!]");

    display.setCursor(0, 52);
    display.print("Light: "); display.print(avgLight, 0); display.print(" lx");
    if (lightAlarm != NORMAL) display.print(" [!]");

    display.display();
  }

  // ─── 5. NON-BLOCKING BUZZER & SONG LOGIC ─────────────────────────
  if (activeSongIndex >= 0) {
    updateSongPlayback(currentMillis);
  } else if (!buzzerEnabled) {
    // Muted — ensure buzzer is off and reset state
    if (buzzerState) { buzzerOff(); buzzerState = false; }
  } else {
    // Rapid beeping when alarm is active, stops after 30 seconds
    bool alarmWindowOpen = globalAlarm &&
                           (currentMillis - alarmStartTime < ALARM_MAX_DURATION);

    if (alarmWindowOpen) {
      // Toggle buzzer every 250ms for rapid beeping
      if (currentMillis - lastBuzzerToggle >= ALARM_HIGH_INTERVAL) {
        lastBuzzerToggle = currentMillis;
        buzzerState = !buzzerState;
        if (buzzerState) buzzerOn(0);
        else             buzzerOff();
      }
    } else {
      // No alarm — calm single beep every 15 seconds
      if (currentMillis - lastDefaultBeep >= 15000) {
        lastDefaultBeep = currentMillis;
        buzzerOn(0);
        buzzerState = true;
      }
      // Turn off after 50ms
      if (buzzerState && currentMillis - lastDefaultBeep >= 50) {
        buzzerOff();
        buzzerState = false;
      }
    }
  }

  // ─── 6. HISTORY SAVING (every 60 s) ──────────────────────────────
  if (currentMillis - lastHistorySave >= HISTORY_INTERVAL) {
    lastHistorySave = currentMillis;
    histTemp[histIndex] = avgTemp;
    histHum[histIndex] = avgHum;
    histPres[histIndex] = avgPres;
    histLight[histIndex] = avgLight;
    histIndex = (histIndex + 1) % HISTORY_SIZE;
    if (histCount < HISTORY_SIZE) histCount++;
  }

  // ─── 7. WEBSOCKET BROADCAST (every 1 s) ──────────────────────────
  if (currentMillis - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = currentMillis;

    JsonDocument doc;
    doc["type"] = "data";
    doc["temperature"] = avgTemp;
    doc["humidity"] = avgHum;
    doc["pressure"] = avgPres;
    doc["light"] = avgLight;
    
    String json;
    serializeJson(doc, json);
    ws.textAll(json);
  }
}
