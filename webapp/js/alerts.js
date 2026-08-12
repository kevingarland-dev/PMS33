import { publishConfig } from './api.js';

// ─── Default thresholds (mirror firmware config.h) ───────────────────────────
const DEFAULTS = {
    temperature: { min: 22, max: 37,   unit: '°C',  absMin: 10,  absMax: 50  },
    humidity:    { min: 40, max: 60,   unit: '%RH', absMin: 0,   absMax: 100 },
    pressure:    { min: 950, max: 1050, unit: 'hPa', absMin: 900, absMax: 1100 },
    light:       { min: 50, max: 1000, unit: 'lux', absMin: 0,   absMax: 2000 },
};

const STORAGE_KEY = 'pms33_thresholds';

export function getThresholds() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : structuredClone(DEFAULTS);
    } catch {
        return structuredClone(DEFAULTS);
    }
}

export function saveThresholds(t) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

/** Returns true if val is outside [min, max] for a given sensor key */
export function isBreached(sensorKey, val, thresholds) {
    const t = thresholds[sensorKey];
    if (!t) return false;
    return val < t.min || val > t.max;
}

/** Human-readable alert label for alarm screen */
export function getAlertLabel(sensorKey, val, thresholds) {
    const t = thresholds[sensorKey];
    if (!t) return 'ALERT';
    return val > t.max
        ? `${sensorKey.toUpperCase()} HIGH`
        : `${sensorKey.toUpperCase()} LOW`;
}

// ─── UI ───────────────────────────────────────────────────────────────────────
export function initAlertsScreen() {
    const container = document.getElementById('thresholds-container');
    container.innerHTML = '';
    const t = getThresholds();

    const LABELS = {
        temperature: 'Temperature',
        humidity:    'Humidity',
        pressure:    'Pressure',
        light:       'Ambient Light',
    };

    Object.entries(DEFAULTS).forEach(([key, def]) => {
        const current = t[key] || def;
        const section = document.createElement('div');
        section.className = 'card threshold-item';
        section.style.marginBottom = '0';
        section.innerHTML = `
            <div class="threshold-row">
                <span class="threshold-name">${LABELS[key]}</span>
                <span class="threshold-range" id="range-label-${key}">
                    ${current.min}–${current.max} ${def.unit}
                </span>
            </div>

            <div class="slider-track" style="margin-top:10px">
                <input type="range" class="min-range" id="slider-min-${key}"
                    min="${def.absMin}" max="${def.absMax}"
                    value="${current.min}" step="${key === 'pressure' ? 5 : 1}">
            </div>
            <div class="slider-track" style="margin-top:6px">
                <input type="range" class="max-range" id="slider-max-${key}"
                    min="${def.absMin}" max="${def.absMax}"
                    value="${current.max}" step="${key === 'pressure' ? 5 : 1}">
            </div>
            <div class="range-labels">
                <span>${def.absMin} ${def.unit}</span>
                <span>${def.absMax} ${def.unit}</span>
            </div>
        `;
        container.appendChild(section);

        // Live update label as sliders move
        const minSlider = document.getElementById(`slider-min-${key}`);
        const maxSlider = document.getElementById(`slider-max-${key}`);
        const label     = document.getElementById(`range-label-${key}`);

        const update = () => {
            let lo = parseInt(minSlider.value);
            let hi = parseInt(maxSlider.value);
            // Enforce lo < hi
            if (lo >= hi) {
                if (document.activeElement === minSlider) lo = hi - 1;
                else hi = lo + 1;
                minSlider.value = lo;
                maxSlider.value = hi;
            }
            label.textContent = `${lo}–${hi} ${def.unit}`;
        };

        minSlider.addEventListener('input', update);
        maxSlider.addEventListener('input', update);
    });

    // Toggles section
    const togglesContainer = document.getElementById('outputs-container');
    togglesContainer.innerHTML = `
        <div class="section-heading">Outputs on Alarm</div>
        ${buildToggle('toggle-buzzer', 'Buzzer', 'Active on any threshold breach', true)}
        ${buildToggle('toggle-hysteresis', 'Hysteresis band', '±5% to prevent alarm chatter', false)}
    `;

    // Save button
    document.getElementById('btn-save-thresholds').onclick = saveAlertSettings;
}

function buildToggle(id, title, sub, defaultOn) {
    const stored = localStorage.getItem(id);
    const checked = stored === null ? (defaultOn ? 'checked' : '') : (stored === 'true' ? 'checked' : '');
    return `
        <div class="toggle-row card" style="margin-bottom:0">
            <div class="toggle-info">
                <div class="toggle-title">${title}</div>
                <div class="toggle-sub">${sub}</div>
            </div>
            <label class="toggle">
                <input type="checkbox" id="${id}" ${checked}>
                <span class="toggle-slider"></span>
            </label>
        </div>
    `;
}

async function saveAlertSettings() {
    const t = getThresholds();
    Object.keys(DEFAULTS).forEach(key => {
        const lo = parseInt(document.getElementById(`slider-min-${key}`).value);
        const hi = parseInt(document.getElementById(`slider-max-${key}`).value);
        t[key] = { ...DEFAULTS[key], min: lo, max: hi };
    });
    saveThresholds(t);

    // Persist toggle states
    ['toggle-buzzer', 'toggle-hysteresis'].forEach(id => {
        const el = document.getElementById(id);
        if (el) localStorage.setItem(id, el.checked);
    });

    const buzzerOn = document.getElementById('toggle-buzzer')?.checked ?? true;

    // Push config to ESP32 over WebSocket
    const btn = document.getElementById('btn-save-thresholds');
    if (btn) { btn.textContent = 'Syncing…'; btn.disabled = true; }

    try {
        publishConfig(t, buzzerOn);
        console.log('[Alerts] Config pushed to ESP32:', t);
        import('./app.js').then(m => m.showToast('Thresholds saved & synced to station ✓', 'success'));
    } catch (err) {
        console.error('[Alerts] Failed to push config:', err);
        import('./app.js').then(m => m.showToast('Saved locally — not synced (device offline?)', 'warning'));
    }

    if (btn) { btn.textContent = 'Save & sync'; btn.disabled = false; }
}
