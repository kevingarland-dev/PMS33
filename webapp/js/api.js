/**
 * PMS33 — Local WebSocket API client
 * Connects directly to the ESP32-C6 over the local network.
 */

let ws = null;
let reconnectTimer = null;
const eventListeners = {
    'data': [],
    'config': [],
    'history': [],
    'connected': [],
    'disconnected': []
};

/** Return stored credentials or null */
export function getCredentials() {
    const ip = localStorage.getItem('pms33_station_ip');
    // For backwards compatibility when testing:
    if (!ip) {
        // Migration clear
        localStorage.removeItem('pms33_aio_user');
        localStorage.removeItem('pms33_aio_key');
    }
    return ip ? { ip } : null;
}

/** Save credentials to localStorage */
export function saveCredentials(ip) {
    localStorage.setItem('pms33_station_ip', ip.trim());
}

/** Subscribe to WebSocket events (data, config, history, connected, disconnected) */
export function on(event, callback) {
    if (eventListeners[event]) {
        eventListeners[event].push(callback);
    }
}

/** Initialize the persistent WebSocket connection */
export function connectWebSocket() {
    const creds = getCredentials();
    if (!creds) return;
    
    if (ws) {
        ws.close();
    }
    
    console.log(`[API] Connecting to ws://${creds.ip}:81/`);
    ws = new WebSocket(`ws://${creds.ip}:81/`);
    
    ws.onopen = () => {
        console.log('[API] WebSocket connected');
        eventListeners['connected'].forEach(cb => cb());
    };
    
    ws.onclose = () => {
        console.log('[API] WebSocket disconnected, reconnecting in 3s...');
        eventListeners['disconnected'].forEach(cb => cb());
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (e) => {
        console.error('[API] WebSocket error'); // 'e' doesn't contain useful info in browsers
    };
    
    ws.onmessage = (msg) => {
        try {
            const data = JSON.parse(msg.data);
            if (data.type && eventListeners[data.type]) {
                eventListeners[data.type].forEach(cb => cb(data));
            }
        } catch(e) {
            console.error('[API] Parse error:', e);
        }
    };
}

/** Request history dump from the ESP32 */
export function requestHistory() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'history' }));
    } else {
        console.warn("[API] Cannot request history, WebSocket not open");
    }
}

/**
 * Quick connectivity check — try to open a short-lived WebSocket to validate IP.
 */
export async function validateCredentials(ip) {
    return new Promise((resolve) => {
        try {
            const testWs = new WebSocket(`ws://${ip}:81/`);
            testWs.onopen = () => {
                testWs.close();
                resolve(true);
            };
            testWs.onerror = (err) => {
                console.error('[API] validateCredentials error:', err);
                resolve(false);
            };
            setTimeout(() => {
                if (testWs.readyState !== WebSocket.OPEN) {
                    console.error('[API] validateCredentials timeout');
                    testWs.close();
                    resolve(false);
                }
            }, 5000);
        } catch (e) {
            console.error('[API] validateCredentials exception:', e);
            resolve(false);
        }
    });
}

/**
 * Publish threshold config to the ESP32.
 */
export function publishConfig(thresholds, buzzer = true) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not open — device may be offline');
    }
    
    const t = thresholds;
    const payload = {
        type: 'config',
        temp_min: t.temperature.min,
        temp_max: t.temperature.max,
        hum_min: t.humidity.min,
        hum_max: t.humidity.max,
        pres_min: t.pressure.min,
        pres_max: t.pressure.max,
        light_min: t.light.min,
        light_max: t.light.max,
        buzzer: buzzer
    };
    
    ws.send(JSON.stringify(payload));
}

/**
 * Send song play command to the ESP32 buzzer over WebSocket.
 */
export function publishSong(songId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('[API] WebSocket not open to play song');
        return;
    }
    const payload = {
        type: 'play_song',
        song: songId
    };
    ws.send(JSON.stringify(payload));
}
