/**
 * PMS33 — App router & orchestrator
 * Handles screen switching, onboarding flow, alarm display, and toast notifications.
 */
import { getCredentials, saveCredentials, validateCredentials, publishConfig, connectWebSocket } from './api.js';
import { initDashboard, setAlarmCallback } from './dashboard.js';
import { initAlertsScreen, getThresholds } from './alerts.js';
import { initHistoryScreen } from './history.js';
import { initSettingsScreen, getPatientInfo } from './settings.js';
import { initSongsScreen } from './songs.js';
import { getAlertLabel } from './alerts.js';

// ─── Screen registry ──────────────────────────────────────────────────────────
function getScreens() {
    return {
        setup:    document.getElementById('screen-setup'),
        home:     document.getElementById('screen-home'),
        songs:    document.getElementById('screen-songs'),
        history:  document.getElementById('screen-history'),
        alerts:   document.getElementById('screen-alerts'),
        settings: document.getElementById('screen-settings'),
        alarm:    document.getElementById('screen-alarm'),
    };
}

let currentScreen = null;
let alarmAcknowledged = false;

// ─── Boot ─────────────────────────────────────────────────────────────────────
export function boot() {
    // Wire alarm callback into dashboard (avoids circular import)
    setAlarmCallback(showAlarm);

    const creds = getCredentials();
    if (creds) {
        connectWebSocket();
        navigateTo('home');
    } else {
        showSetupScreen();
    }
    bindNavigation();
    bindSetup();
    bindAlarmActions();
}

// ─── Navigation ───────────────────────────────────────────────────────────────
export function navigateTo(screenId) {
    if (currentScreen === screenId) return;

    const screens = getScreens();
    // Hide all screens, show target
    Object.values(screens).forEach(s => s?.classList.remove('active'));
    const target = screens[screenId];
    if (!target) return;
    target.classList.add('active');

    // No need to stop polling anymore (WebSocket handles background state)

    currentScreen = screenId;

    // Update nav highlight (alarm has no nav item)
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
    if (activeNav) activeNav.classList.add('active');

    // Screen-specific init
    switch (screenId) {
        case 'home':
            refreshDashboardHeader();
            initDashboard();
            break;
        case 'songs':
            initSongsScreen();
            break;
        case 'alerts':
            initAlertsScreen();
            break;
        case 'history':
            initHistoryScreen();
            break;
        case 'settings':
            initSettingsScreen();
            break;
    }
}

function bindNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.screen;
            if (id) navigateTo(id);
        });
    });
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
function showSetupScreen() {
    const screens = getScreens();
    Object.values(screens).forEach(s => s?.classList.remove('active'));
    screens.setup?.classList.add('active');
    currentScreen = 'setup';

    const userInput = document.getElementById('setup-station-ip');
    if (userInput && !userInput.value) userInput.value = '192.168.';
}

function bindSetup() {
    const btnConnect = document.getElementById('btn-pair-connect');
    const btnManual  = document.getElementById('btn-manual-entry');
    const manualForm = document.getElementById('manual-entry-form');

    // "Pair & connect" — animated, then show manual entry (simulated pairing)
    btnConnect?.addEventListener('click', () => {
        btnConnect.textContent = 'Connecting…';
        btnConnect.disabled = true;
        setTimeout(() => {
            btnConnect.textContent = 'Pair & connect';
            btnConnect.disabled = false;
            manualForm?.classList.remove('hidden');
            manualForm?.scrollIntoView({ behavior: 'smooth' });
        }, 1800);
    });

    // "Enter pairing code manually" link
    btnManual?.addEventListener('click', () => {
        manualForm?.classList.remove('hidden');
        manualForm?.scrollIntoView({ behavior: 'smooth' });
    });

    // Manual form submit
    document.getElementById('btn-setup-submit')?.addEventListener('click', handleSetupSubmit);
}

async function handleSetupSubmit() {
    const ip      = document.getElementById('setup-station-ip')?.value.trim();
    const patient = document.getElementById('setup-patient-name')?.value.trim();
    const room    = document.getElementById('setup-room')?.value.trim();

    if (!ip) { showToast('Station IP Address is required', 'error'); return; }

    const btn = document.getElementById('btn-setup-submit');
    btn.textContent = 'Verifying…';
    btn.disabled = true;

    const ok = await validateCredentials(ip);
    if (!ok) {
        showToast('Could not connect to Station — check the IP', 'error');
        btn.textContent = 'Connect Station';
        btn.disabled = false;
        return;
    }

    saveCredentials(ip);
    if (patient) localStorage.setItem('pms33_patient', patient);
    if (room)    localStorage.setItem('pms33_room', room);

    connectWebSocket();
    showToast('Station connected ✓', 'success');
    setTimeout(() => navigateTo('home'), 800);
}

// ─── Dashboard header helper ──────────────────────────────────────────────────
function refreshDashboardHeader() {
    const { name, room } = getPatientInfo();
    const el = document.getElementById('dashboard-patient-header');
    if (el) el.textContent = `${room} — ${name}`;
    const onlineDot = document.getElementById('header-online-dot');
    if (onlineDot) onlineDot.classList.add('online');
    
    // Update buzzer button UI based on current config
    const t = getThresholds();
    updateMuteButtonUI(t.buzzer);
}

function updateMuteButtonUI(isBuzzerEnabled) {
    const btn = document.getElementById('btn-quick-mute');
    if (!btn) return;
    if (isBuzzerEnabled) {
        btn.innerHTML = '🔕 Mute Buzzer';
        btn.classList.remove('btn-muted'); // Optional styling
    } else {
        btn.innerHTML = '🔔 Unmute Buzzer';
        btn.classList.add('btn-muted');
    }
}

// ─── Alarm screen ─────────────────────────────────────────────────────────────
let alarmTimer = null;

export function showAlarm(sensor, val, thresholds) {
    if (alarmAcknowledged) return;

    const label = getAlertLabel(sensor.key, val, thresholds);
    document.getElementById('alarm-label-text').textContent  = `ALARM — ${label}`;
    document.getElementById('alarm-value-text').textContent  = `${val.toFixed(sensor.decimals ?? 1)} ${sensor.unit ?? ''}`;
    const t = thresholds[sensor.key];
    document.getElementById('alarm-threshold-text').textContent =
        t ? `Threshold ${val > t.max ? t.max : t.min} ${sensor.unit ?? ''} · hysteresis 5%` : '';

    // Icon by sensor type
    const iconEl = document.getElementById('alarm-icon');
    iconEl.innerHTML = alarmIcon(sensor.key);

    navigateTo('alarm');
}

function alarmIcon(key) {
    const icons = {
        temperature: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z"/></svg>`,
        humidity:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2C6 10 4 13 4 16a8 8 0 0016 0c0-3-2-6-8-14z"/></svg>`,
        pressure:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0h6"/></svg>`,
        light:       `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"/></svg>`,
    };
    return icons[key] || icons.temperature;
}

function bindAlarmActions() {
    document.getElementById('btn-alarm-ack')?.addEventListener('click', () => {
        alarmAcknowledged = true;
        navigateTo('home');
        // Reset acknowledged flag after 2 minutes
        setTimeout(() => { alarmAcknowledged = false; }, 120_000);
    });

    document.getElementById('btn-alarm-silence')?.addEventListener('click', () => {
        // Disable physical buzzer and push to MQTT
        const t = getThresholds();
        t.buzzer = false;
        localStorage.setItem('thresholds', JSON.stringify(t));

        // Update the settings UI toggle just in case
        const buzzerToggle = document.getElementById('buzzer-enabled');
        if (buzzerToggle) {
            buzzerToggle.checked = false;
            document.getElementById('buzzer-wrapper')?.classList.remove('active');
        }
        
        // Push config to station
        publishConfig(t, t.lcdMirror);

        showToast('Buzzer physically disabled on station', 'info');
        navigateTo('home');
        // Reset acknowledged flag after 5 minutes
        setTimeout(() => { alarmAcknowledged = false; }, 300_000);
    });

    document.getElementById('btn-quick-mute')?.addEventListener('click', () => {
        const t = getThresholds();
        t.buzzer = !t.buzzer; // Toggle
        localStorage.setItem('thresholds', JSON.stringify(t));
        
        const buzzerToggle = document.getElementById('buzzer-enabled');
        if (buzzerToggle) {
            buzzerToggle.checked = t.buzzer;
            if (t.buzzer) {
                document.getElementById('buzzer-wrapper')?.classList.add('active');
            } else {
                document.getElementById('buzzer-wrapper')?.classList.remove('active');
            }
        }
        
        updateMuteButtonUI(t.buzzer);
        
        const lcdMirror = localStorage.getItem('lcdMirror') === 'true';
        publishConfig(t, lcdMirror);
        showToast(t.buzzer ? 'Buzzer unmuted on station' : 'Buzzer muted on station', 'info');
    });
}

// ─── Toast notifications ──────────────────────────────────────────────────────
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 350);
    }, 3000);
}
