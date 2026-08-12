#pragma once

// ─── Hardware Pins ────────────────────────────────────────────────────────────
#define PIN_SDA    6    // I2C Data  (default ESP32-C6)
#define PIN_SCL    7    // I2C Clock (default ESP32-C6)
#define PIN_BUZZER 10   // Active buzzer — change to your actual GPIO if different

// ─── Display ──────────────────────────────────────────────────────────────────
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1    // Shared reset; -1 = not connected
#define OLED_ADDRESS  0x3C

// ─── Adafruit IO Server ───────────────────────────────────────────────────────
#define AIO_SERVER   "io.adafruit.com"
#define AIO_PORT     1883
#define AIO_USERNAME "skinnyman_247"

// Feed paths  (group "pms33", one key per sensor)
#define AIO_FEED_TEMP  AIO_USERNAME "/feeds/pms33.temperature"
#define AIO_FEED_HUM   AIO_USERNAME "/feeds/pms33.humidity"
#define AIO_FEED_PRES  AIO_USERNAME "/feeds/pms33.pressure"
#define AIO_FEED_LIGHT AIO_USERNAME "/feeds/pms33.light"

// ─── Non-Blocking Timing (milliseconds) ──────────────────────────────────────
#define SENSOR_READ_INTERVAL     5000UL   // Read all sensors every 5 s
#define DISPLAY_UPDATE_INTERVAL  2000UL   // Refresh OLED every 2 s
#define MQTT_PUBLISH_INTERVAL   10000UL   // Publish to Adafruit IO every 10 s
#define MQTT_LOOP_INTERVAL        100UL   // MQTT keep-alive pump every 100 ms
#define WIFI_CHECK_INTERVAL     30000UL   // Reconnect WiFi check every 30 s
#define MQTT_RECONNECT_BACKOFF   5000UL   // Min gap between MQTT reconnect tries

// ─── Default Alert Thresholds ─────────────────────────────────────────────────
// These match the defaults shown in the PWA "Alerts & Thresholds" screen.
// The PWA stores user-adjusted values; the firmware uses these fixed defaults.
#define TEMP_MIN    22.0f    // °C  (patient room comfort lower)
#define TEMP_MAX    37.0f    // °C  (fever threshold)
#define HUM_MIN     40.0f    // %RH
#define HUM_MAX     60.0f    // %RH
#define PRES_MIN   950.0f    // hPa
#define PRES_MAX  1050.0f    // hPa
#define LIGHT_MIN   50.0f    // lux (too dim)
#define LIGHT_MAX 1000.0f    // lux (too bright)

// ─── Buzzer ───────────────────────────────────────────────────────────────────
#define BUZZER_ALERT_MS   1000UL   // Duration of a single alert buzz (ms)
