/**
 * PMS33 Dashboard v3
 * Stacked sensor cards with large values, status dots and sparklines.
 * Matches design reference screenshots (warm-cream, card-based layout).
 */
import { on } from './api.js';
import { getThresholds, isBreached } from './alerts.js';
// (No import from app.js — avoids circular dependency)
// app.js injects the alarm callback via setAlarmCallback()
let onAlarm = null;
export function setAlarmCallback(fn) { onAlarm = fn; }

// Sensor definitions — order matches screenshot top-to-bottom
const SENSORS = [
    {
        id: 'temperature', key: 'temperature',
        label: 'Temperature', unit: '°C', cls: 'temp',
        decimals: 1, gaugeMin: 10, gaugeMax: 45,
    },
    {
        id: 'humidity', key: 'humidity',
        label: 'Humidity', unit: '%RH', cls: 'hum',
        decimals: 0, gaugeMin: 0, gaugeMax: 100,
    },
    {
        id: 'pressure', key: 'pressure',
        label: 'Pressure', unit: 'hPa', cls: 'pres',
        decimals: 0, gaugeMin: 900, gaugeMax: 1100,
    },
    {
        id: 'light', key: 'light',
        label: 'Ambient Light', unit: 'lux', cls: 'light',
        decimals: 0, gaugeMin: 0, gaugeMax: 2000,
    },
];

// Chart.js accent colours per sensor
const SPARK_COLOR = {
    temperature: '#2BB5A0',
    humidity:    '#E8A838',
    pressure:    '#4A7CF7',
    light:       '#9B59B6',
};
const SPARK_FILL = {
    temperature: 'rgba(43,181,160,0.12)',
    humidity:    'rgba(232,168,56,0.12)',
    pressure:    'rgba(74,124,247,0.12)',
    light:       'rgba(155,89,182,0.12)',
};

// Ring buffer for sparklines (last 20 readings)
const SPARK_LEN = 20;
const sparkHistory = { temperature: [], humidity: [], pressure: [], light: [] };

// Trend tracking (last two values)
const prevValues = {};

const AVG_LABEL = '1s live'; // matches firmware 1-second WebSocket broadcast
let sparkCharts = {};

// ─── WebSocket Event Listener ────────────────────────────────────────────────
on('data', (data) => {
    handleData(data);
});

// ─── Build UI ─────────────────────────────────────────────────────────────────
export function initDashboard() {
    const container = document.getElementById('dashboard-cards');
    container.innerHTML = '';
    sparkCharts = {};

    SENSORS.forEach(s => {
        const card = buildCard(s);
        container.appendChild(card);

        const ctx = document.getElementById(`spark-${s.id}`).getContext('2d');
        sparkCharts[s.id] = new Chart(ctx, {
            type: 'line',
            data: {
                labels:   [],
                datasets: [{
                    data: [],
                    borderColor:     SPARK_COLOR[s.id],
                    backgroundColor: SPARK_FILL[s.id],
                    borderWidth:  2,
                    pointRadius:  0,
                    tension:      0.4,
                    fill:         true,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales:  { x: { display: false }, y: { display: false } },
                animation: { duration: 600 },
            },
        });
    });
}

/** Build a single sensor card matching the screenshot layout */
function buildCard(s) {
    const card = document.createElement('div');
    card.className = `sensor-card ${s.cls}`;
    card.id = `card-${s.id}`;
    card.innerHTML = `
        <div class="sensor-card-header">
            <span class="sensor-card-label">${s.label}</span>
            <span class="sensor-card-dot" id="dot-${s.id}"></span>
        </div>

        <div class="sensor-card-reading">
            <span class="sensor-card-value"
                  id="val-${s.id}"
                  data-prev="0"
                  aria-label="${s.label} reading">--</span>
            <span class="sensor-card-unit">${s.unit}</span>
        </div>

        <div class="sensor-card-sub" id="meta-${s.id}">${AVG_LABEL} · waiting…</div>

        <canvas id="spark-${s.id}" aria-hidden="true"></canvas>
    `;
    return card;
}

// ─── Handle Incoming Data ───────────────────────────────────────────────────────
function handleData(data) {
    if (!data) return;

    const thresholds = getThresholds();
    let firstAlarm   = null;

    SENSORS.forEach(s => {
        const val = parseFloat(data[s.key]);
        if (isNaN(val)) return;

        // ── Sparkline ring buffer ──────────────────────────────────
        sparkHistory[s.key].push(val);
        if (sparkHistory[s.key].length > SPARK_LEN) sparkHistory[s.key].shift();

        // ── Animated value counter ─────────────────────────────────
        const valEl = document.getElementById(`val-${s.id}`);
        if (valEl) {
            const prev = parseFloat(valEl.dataset.prev) || val;
            valEl.dataset.prev = isNaN(val) ? 0 : val;
            animateCounter(valEl, prev, val, s.decimals);
        }

        // ── Sub-text: avg window · status ─────────────────────────
        const metaEl = document.getElementById(`meta-${s.id}`);
        if (metaEl) {
            const status = getStatusText(s.key, val, thresholds);
            metaEl.textContent = `${AVG_LABEL} · ${status}`;
        }

        // ── Alert state on card ────────────────────────────────────
        const breached = isBreached(s.key, val, thresholds);
        const card     = document.getElementById(`card-${s.id}`);
        if (card) card.classList.toggle('alert', breached);
        if (breached && !firstAlarm) firstAlarm = { sensor: s, val };

        // ── Sparkline update ───────────────────────────────────────
        const chart = sparkCharts[s.id];
        if (chart) {
            chart.data.labels           = sparkHistory[s.key].map((_, i) => i);
            chart.data.datasets[0].data = sparkHistory[s.key];
            chart.update('none');
        }
    });

    // Mark as online
    document.getElementById('header-online-dot')?.classList.add('online');

    if (firstAlarm && onAlarm) onAlarm(firstAlarm.sensor, firstAlarm.val, thresholds);
}

// ─── Status text logic ────────────────────────────────────────────────────────
function getStatusText(key, val, thresholds) {
    const t    = thresholds?.[key];
    const prev = prevValues[key];

    // Determine trend direction
    let trendSuffix = '';
    if (prev !== undefined) {
        const diff = val - prev;
        if      (diff >  0.15) trendSuffix = ' · trending up';
        else if (diff < -0.15) trendSuffix = ' · trending down';
    }
    prevValues[key] = val;

    if (!t) return 'no threshold set';
    if (val > t.max) return `high · out of range${trendSuffix}`;
    if (val < t.min) return `low · out of range${trendSuffix}`;

    // Light-specific friendly text
    if (key === 'light') {
        if (val < 50)   return 'dim · patient resting';
        if (val < 500)  return 'normal · patient active';
        return `bright${trendSuffix}`;
    }

    return `within range${trendSuffix}`;
}

// ─── Animated counter (ease-out cubic) ───────────────────────────────────────
function animateCounter(el, from, to, decimals, dur = 700) {
    if (!el) return;
    if (isNaN(to)) { el.textContent = '--'; return; }
    const start = performance.now();
    const diff  = to - from;
    (function tick(now) {
        const t    = Math.min((now - start) / dur, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        el.textContent = (from + diff * ease).toFixed(decimals);
        if (t < 1) requestAnimationFrame(tick);
    })(performance.now());
}
