/**
 * PMS33 — History & Logs screen
 * Fetches historical feed data from Adafruit IO and renders trend charts.
 */
import { requestHistory, on } from './api.js';

// Chart.js instances, keyed by sensor id
let histCharts = {};

const SENSORS = [
    { key: 'temperature', label: 'TEMPERATURE °C',  color: '#00D4AA', colorA: 'rgba(0,212,170,0.12)'  },
    { key: 'humidity',    label: 'HUMIDITY %RH',    color: '#F59E0B', colorA: 'rgba(245,158,11,0.12)'  },
    { key: 'pressure',    label: 'PRESSURE hPa',    color: '#60A5FA', colorA: 'rgba(96,165,250,0.12)'  },
    { key: 'light',       label: 'AMBIENT LIGHT lx',color: '#A78BFA', colorA: 'rgba(167,139,250,0.12)'  },
];

// Current time range
let currentRange = 'today';

// ─── Build static chart containers ───────────────────────────────────────────
export function initHistoryScreen() {
    const container = document.getElementById('history-charts');
    if (container.dataset.built) return; // already built DOM, just reload data
    container.dataset.built = '1';
    container.innerHTML = '';

    SENSORS.forEach(s => {
        const card = document.createElement('div');
        card.className = 'card history-chart-card';
        card.innerHTML = `
            <div style="display:flex;align-items:center;margin-bottom:8px">
                <span class="chart-label">${s.label}</span>
                <span class="chart-avg" id="avg-${s.key}">avg --</span>
            </div>
            <canvas id="hchart-${s.key}"></canvas>
        `;
        container.appendChild(card);

        const ctx = document.getElementById(`hchart-${s.key}`).getContext('2d');
        histCharts[s.key] = new Chart(ctx, {
            type: 'line',
            data: {
                labels:   [],
                datasets: [{
                    data: [],
                    borderColor: s.color,
                    backgroundColor: s.colorA,
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    fill: true,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                scales: {
                    x: {
                        display: true,
                        ticks: { maxTicksLimit: 6, font: { size: 10 }, color: '#9CA3AF' },
                        grid: { display: false },
                    },
                    y: {
                        display: true,
                        ticks: { maxTicksLimit: 4, font: { size: 10 }, color: '#9CA3AF' },
                        grid: { color: 'rgba(0,0,0,0.06)' },
                    },
                },
                animation: { duration: 500 },
            },
        });
    });

    // Tab button listeners
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRange = btn.dataset.range;
            loadHistoryData();
        });
    });

    loadHistoryData();
}

// ─── Fetch and render data ────────────────────────────────────────────────────
// ─── WebSocket Event Listener ────────────────────────────────────────────────
on('history', (payload) => {
    const data = payload.data;
    if (!data || !data.length) {
        SENSORS.forEach(s => { document.getElementById(`avg-${s.key}`).textContent = 'no data'; });
        return;
    }

    const now = new Date();
    const len = data.length;

    SENSORS.forEach((s, idx) => {
        const values = data.map(pt => pt[idx]);
        const labels = data.map((_, i) => {
            const minAgo = len - 1 - i;
            const d = new Date(now.getTime() - minAgo * 60000);
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        });

        const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
        document.getElementById(`avg-${s.key}`).textContent = `avg ${avg}`;

        const chart = histCharts[s.key];
        chart.data.labels = labels;
        chart.data.datasets[0].data = values;
        chart.update();
    });
});

export function loadHistoryData() {
    SENSORS.forEach(s => {
        document.getElementById(`avg-${s.key}`).textContent = 'loading…';
    });
    requestHistory();
}
