# PMS33 PATIENT MONITORING STATION
## Technical Architecture, Device Connections & Communication Protocol Documentation

---

## 1. Executive Summary & System Overview

The **PMS33 Patient Monitoring Station** is an integrated, low-latency Internet-of-Things (IoT) bedside vital signs monitoring system designed for healthcare facilities, intensive care units (ICUs), and personal patient care. The system captures continuous environmental and physical telemetry—including ambient temperature, relative humidity, barometric pressure, and ambient light levels—evaluating these parameters in real time against configurable clinical threshold bounds.

The platform features a dual-interface model comprising an on-board **0.96" SH1106 OLED display** with frequency-modulated buzzer alarms on the physical hardware, paired with a high-performance **Progressive Web Application (PWA)** running across mobile and desktop browsers over a low-latency local **WebSocket protocol (Port 81)**.

> 📌 **KEY ARCHITECTURAL HIGHLIGHT**:
> The PMS33 architecture is engineered with a 100% non-blocking task design. Sensor acquisition, WebSocket frame dispatch, OLED UI rendering, and a 44-song interactive buzzer melody synthesizer operate concurrently in the main execution loop without blocking network communications or triggering hardware watchdog resets.

---

## 2. Hardware Architecture & Circuit Schematic

The hardware foundation of the PMS33 station centers around the **Espressif ESP32-C6 DevKitM-1** microcontroller, operating at 160 MHz with 4MB Flash and 320KB RAM. All primary environmental sensors communicate with the microcontroller over a shared **I2C serial bus** running at 100 kHz standard mode.

### 2.1 Complete Component Pin Mapping Table

| Component Name | Signal / Pin | ESP32-C6 Pin | Protocol / Type | Functional Description |
|---|---|---|---|---|
| **I2C Sensor Bus (Shared)** | SDA (Data) | **GPIO 6** | I2C Serial Data | Shared data line for AHT20, BMP280, BH1750, & SH1106 OLED |
| **I2C Sensor Bus (Shared)** | SCL (Clock) | **GPIO 7** | I2C Serial Clock | Shared clock line synchronized at 100 kHz bus speed |
| **Passive Piezo Buzzer** | SIG (Positive) | **GPIO 9** | PWM Output (Tone) | Synthesizes alarm beeps, heartbeat chimes, and 44-song melodies |
| **Actuator Relay 1** | IN1 (Trigger) | **GPIO 10** | Digital Output (Active High) | Triggers external temperature control / heating-cooling systems |
| **Actuator Relay 2** | IN2 (Trigger) | **GPIO 11** | Digital Output (Active High) | Triggers ventilation / lighting / auxiliary emergency systems |
| **SH1106 OLED Display** | VCC / GND | **3.3V / GND** | DC Power Rail | Provides 3.3V power to OLED screen (I2C address `0x3C`) |

### 2.2 Sensor Specifications & I2C Addresses

- **AHT20 Temperature & Humidity Sensor (I2C `0x38`)**: Measures ambient relative humidity (0–100% RH ±2%) and room temperature (-40 to +85°C ±0.3°C).
- **BMP280 Barometric Pressure Sensor (I2C `0x76`)**: Measures atmospheric pressure (300–1100 hPa ±1 hPa) and secondary verification temperature.
- **BH1750 Ambient Light Sensor (I2C `0x23`)**: Digital lux meter measuring ambient illumination levels (1–65535 lx) to monitor ward lighting conditions.

---

## 3. Network Communications & Protocol Architecture

The PMS33 platform utilizes a hybrid network architecture comprising a **Local HTTP File Server (Port 8000)** for serving static PWA assets, and an **AsyncWebSocket Server (Port 81)** running directly on the ESP32-C6 for real-time telemetry streaming and command execution.

### 3.1 Communication Sequence Flow

```
┌────────────────────────┐                   ┌────────────────────────┐                  ┌────────────────────────┐
│  Mobile / PC Browser   │                   │  ESP32-C6 Station      │                  │  Sensors & Actuators   │
│  (PWA Web Application) │                   │  (WebSocket Server :81)│                  │  (AHT20, BMP280, Buzzer│
└───────────┬────────────┘                   └───────────┬────────────┘                  └───────────┬────────────┘
            │                                            │                                           │
            │────── 1. WS Connect (ws://IP:81/) ────────>│                                           │
            │<───── 2. Config & Thresholds JSON ─────────│                                           │
            │                                            │                                           │
            │                                            │<───── 3. Sample Sensors (every 1s) ───────│
            │                                            │────── 4. Evaluate Threshold Alarms ──────>│
            │<───── 5. Live Telemetry Stream (1000ms) ───│                                           │
            │                                            │                                           │
            │────── 6. Update Thresholds Payload ───────>│                                           │
            │<───── 7. Acknowledge & Update EEPROM ──────│                                           │
            │                                            │                                           │
            │────── 8. Trigger Song ("play_song") ──────>│                                           │
            │                                            │────── 9. Non-blocking Tone Synthesis ────>│
            │                                            │                                           │
```

### 3.2 WebSocket JSON Frame Formats

#### 1. Telemetry Broadcast Frame (ESP32 -> WebApp every 1000ms):
```json
{
  "type": "telemetry",
  "temp": 24.5,
  "hum": 55.2,
  "pres": 1013.2,
  "light": 350.0,
  "temp_alarm": 0,
  "hum_alarm": 0,
  "pres_alarm": 0,
  "light_alarm": 0,
  "global_alarm": false,
  "relays": false,
  "buzzer": true
}
```

#### 2. Threshold Configuration Frame (WebApp -> ESP32):
```json
{
  "type": "config",
  "temp_min": 18.0, "temp_max": 28.0,
  "hum_min": 30.0,  "hum_max": 70.0,
  "pres_min": 950.0, "pres_max": 1050.0,
  "light_min": 50.0, "light_max": 1000.0,
  "buzzer": true
}
```

#### 3. Song Playback Frame (WebApp -> ESP32):
```json
{
  "type": "play_song",
  "song": "tokyo_drift"  // or "mario_bros", "star_wars", "stop"
}
```

---

## 4. Software & Web Application Architecture

The PMS33 front-end interface is constructed as a modern, responsive Single Page Application (SPA) adhering to Progressive Web App (PWA) standards. Built with HTML5, Vanilla CSS3, and ES6 Javascript modules, it features zero external framework dependencies for maximum performance and portability.

### 4.1 Component Modules

- **`js/app.js`**: Central client orchestrator, router, and event loop dispatcher managing screen transitions across Home, Songs, History, Alerts, and Settings.
- **`js/api.js`**: WebSocket client protocol wrapper managing reconnect logic, JSON serialization, and message publishing.
- **`js/dashboard.js`**: Renders bedside vital signs cards, hysteresis alarm status badges, live sparklines, and quick mute triggers.
- **`js/songs.js` & `js/songs_library.js`**: Interactive 44-song music module with live search, category filter chips (Games, Movies, Pop Hits, Classics), and playback triggers.
- **`js/history.js`**: Chart.js integration displaying 24-hour historical telemetry graphs with CSV data export capabilities.
- **`service-worker.js` (v3)**: PWA service worker delivering offline caching and immediate app updates.

---

## 5. Firmware Architecture & Safety Mechanisms

The ESP32-C6 firmware is written in C++ using the PlatformIO framework. To ensure high reliability in critical healthcare environments, the codebase enforces several safety mechanisms:

### 5.1 Non-Blocking `SongState` Machine
Unlike standard Arduino melody code that relies on blocking `delay()` loops, the PMS33 firmware implements a step-based `SongState` machine inside the main `loop()`. Note durations and inter-note pauses are evaluated against `millis()` delta timers. This allows the ESP32 to synthesize complex 44-song melodies while continuing to process WebSocket traffic and sensor polling without triggering Task Watchdog Timer (TWDT) resets.

### 5.2 Hysteresis & Alarm Auto-Silence
To prevent rapid alarm toggling (chatter) when a sensor value fluctuates near a threshold boundary, the system applies hysteresis offsets (e.g., 0.5°C for temperature, 2.0% for humidity). Additionally, continuous emergency alarm beeping automatically silences after 30 seconds to prevent alarm fatigue, while maintaining visual alert indicators until parameters normalize.

---
*Documentation generated for PMS33 Patient Monitoring Station project.*
