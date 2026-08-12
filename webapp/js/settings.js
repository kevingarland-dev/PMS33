/**
 * PMS33 — Settings / Device & Patient screen
 */
import { getCredentials, saveCredentials, validateCredentials } from './api.js';
import { showToast } from './app.js';

const PATIENT_KEY = 'pms33_patient';
const ROOM_KEY    = 'pms33_room';

export function getPatientInfo() {
    return {
        name: localStorage.getItem(PATIENT_KEY) || 'Patient',
        room: localStorage.getItem(ROOM_KEY)    || 'Room A',
    };
}

export function initSettingsScreen() {
    const patient = getPatientInfo();
    const creds   = getCredentials();

    // Avatar initials
    const initials = patient.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const avatarEl = document.getElementById('settings-avatar');
    if (avatarEl) avatarEl.textContent = initials;

    const nameEl = document.getElementById('settings-patient-name');
    if (nameEl) nameEl.textContent = patient.name;

    const roomEl = document.getElementById('settings-patient-room');
    if (roomEl) roomEl.textContent = patient.room;

    // Station info
    const boardEl = document.getElementById('settings-board-val');
    if (boardEl) boardEl.textContent = 'ESP32-C6';

    const linkEl = document.getElementById('settings-link-val');
    if (linkEl) linkEl.textContent = creds ? 'Wi-Fi · Adafruit IO' : 'Not linked';

    // AIO username display (optional element)
    const aioUserEl = document.getElementById('settings-aio-user');
    if (aioUserEl) aioUserEl.textContent = creds ? creds.username : 'Not linked';

    // Rolling average display
    const avgEl = document.getElementById('settings-avg-window');
    if (avgEl) avgEl.textContent = '10 s';

    // LCD mirror toggle — persist state
    const lcdToggle = document.getElementById('toggle-lcd-mirror');
    if (lcdToggle) {
        // Restore saved state (default: on)
        lcdToggle.checked = localStorage.getItem('pms33_lcd_mirror') !== 'false';
        // Remove any previous handler before re-adding
        lcdToggle.onchange = null;
        lcdToggle.onchange = () => {
            localStorage.setItem('pms33_lcd_mirror', lcdToggle.checked);
            showToast(`LCD mirror ${lcdToggle.checked ? 'enabled' : 'disabled'}`, 'info');
        };
    }

    // Edit patient button
    const editBtn = document.getElementById('btn-edit-patient');
    if (editBtn) editBtn.onclick = () => showPatientModal(patient);

    // Edit credentials button
    const credsBtn = document.getElementById('btn-edit-creds');
    if (credsBtn) credsBtn.onclick = () => showCredsModal(creds);
}

// ─── Patient edit modal ───────────────────────────────────────────────────────
function showPatientModal(patient) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:500;
        display:flex;align-items:flex-end;justify-content:center;
    `;
    overlay.innerHTML = `
        <div style="
            background:#FFFFFF;border-top:1px solid rgba(0,0,0,0.06);border-radius:24px 24px 0 0;padding:28px 24px 40px;
            width:100%;max-width:430px;animation:slideUp .3s ease;color:#1A1B2E;
        ">
            <h3 style="font-size:18px;font-weight:700;margin-bottom:20px">Edit Patient Info</h3>
            <div class="form-group" style="padding:0;margin-bottom:14px">
                <label>Patient Name</label>
                <input id="modal-name" type="text" placeholder="e.g. Ama K." value="${patient.name}">
            </div>
            <div class="form-group" style="padding:0;margin-bottom:24px">
                <label>Room / Bed</label>
                <input id="modal-room" type="text" placeholder="e.g. Room A — Bed 4A" value="${patient.room}">
            </div>
            <div style="display:flex;gap:10px">
                <button id="modal-cancel" class="btn-secondary" style="flex:1">Cancel</button>
                <button id="modal-save"   class="btn-primary"   style="flex:2">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#modal-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#modal-save').onclick = () => {
        const name = overlay.querySelector('#modal-name').value.trim();
        const room = overlay.querySelector('#modal-room').value.trim();
        if (!name) { showToast('Please enter a patient name', 'error'); return; }
        localStorage.setItem(PATIENT_KEY, name);
        localStorage.setItem(ROOM_KEY, room);
        overlay.remove();
        initSettingsScreen();
        // Update dashboard header
        updateDashboardPatient(name, room);
        showToast('Patient info updated ✓', 'success');
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ─── Credentials edit modal ───────────────────────────────────────────────────
function showCredsModal(creds) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:500;
        display:flex;align-items:flex-end;justify-content:center;
    `;
    overlay.innerHTML = `
        <div style="
            background:#FFFFFF;border-top:1px solid rgba(0,0,0,0.06);border-radius:24px 24px 0 0;padding:28px 24px 40px;
            width:100%;max-width:430px;animation:slideUp .3s ease;color:#1A1B2E;
        ">
            <h3 style="font-size:18px;font-weight:700;margin-bottom:20px">Adafruit IO Credentials</h3>
            <div class="form-group" style="padding:0;margin-bottom:14px">
                <label>AIO Username</label>
                <input id="modal-aio-user" type="text" placeholder="your_username" value="${creds ? creds.username : ''}">
            </div>
            <div class="form-group" style="padding:0;margin-bottom:24px">
                <label>AIO Key</label>
                <input id="modal-aio-key" type="password" placeholder="aio_xxxx..." value="${creds ? creds.key : ''}">
            </div>
            <div style="display:flex;gap:10px">
                <button id="modal-cancel" class="btn-secondary" style="flex:1">Cancel</button>
                <button id="modal-save"   class="btn-primary"   style="flex:2" id="modal-save-creds">Verify & Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#modal-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#modal-save').onclick = async () => {
        const user = overlay.querySelector('#modal-aio-user').value.trim();
        const key  = overlay.querySelector('#modal-aio-key').value.trim();
        if (!user || !key) { showToast('Both fields required', 'error'); return; }

        const saveBtn = overlay.querySelector('#modal-save');
        saveBtn.textContent = 'Verifying…';
        saveBtn.disabled = true;

        const ok = await validateCredentials(user, key);
        if (ok) {
            saveCredentials(user, key);
            overlay.remove();
            initSettingsScreen();
            showToast('Credentials saved & verified ✓', 'success');
        } else {
            showToast('Invalid credentials — check your AIO key', 'error');
            saveBtn.textContent = 'Verify & Save';
            saveBtn.disabled = false;
        }
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function updateDashboardPatient(name, room) {
    const el = document.getElementById('dashboard-patient-header');
    if (el) el.textContent = `${room} — ${name}`;
}
