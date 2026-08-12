/**
 * PMS33 — Songs & Buzzer Music Module
 * Manages song selection and buzzer playback triggers on the ESP32-C6.
 */
import { showToast } from './app.js';
import { publishSong } from './api.js';
import { SONGS_LIBRARY } from './songs_library.js';

let currentPlayingId = null;
let activeCategory = 'All';
let searchQuery = '';

export function getSongs() {
    return SONGS_LIBRARY;
}

export function initSongsScreen() {
    const container = document.getElementById('songs-container');
    if (!container) return;

    renderSongsUI(container);
}

function getCategoryIcon(category) {
    switch (category) {
        case 'Games': return '🎮';
        case 'Movies': return '🎬';
        case 'Songs': return '🎧';
        case 'Other': return '🔔';
        default: return '🎵';
    }
}

function renderSongsUI(container) {
    container.innerHTML = '';

    // Search & Filter Header
    const headerWrapper = document.createElement('div');
    headerWrapper.style.cssText = 'display:flex; flex-direction:column; gap:12px; margin-bottom:16px;';

    // Search bar
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 Search 44+ songs...';
    searchInput.value = searchQuery;
    searchInput.style.cssText = `
        width: 100%;
        padding: 12px 16px;
        border-radius: 14px;
        border: 1px solid var(--card-border, rgba(0,0,0,0.1));
        background: var(--bg-card, #FFF);
        color: var(--text-1);
        font-size: 14px;
        outline: none;
        box-sizing: border-box;
    `;
    searchInput.oninput = (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderSongsList(listContainer);
    };

    // Category chips
    const categories = ['All', 'Games', 'Movies', 'Songs', 'Other'];
    const chipsRow = document.createElement('div');
    chipsRow.style.cssText = 'display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; -webkit-overflow-scrolling:touch;';

    categories.forEach(cat => {
        const chip = document.createElement('button');
        const isActive = activeCategory === cat;
        chip.style.cssText = `
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
            cursor: pointer;
            border: 1px solid ${isActive ? 'var(--teal)' : 'rgba(0,0,0,0.1)'};
            background: ${isActive ? 'var(--teal)' : 'var(--bg-card, #FFF)'};
            color: ${isActive ? '#FFF' : 'var(--text-2)'};
            transition: all 0.2s ease;
        `;
        chip.textContent = `${getCategoryIcon(cat)} ${cat}`;
        chip.onclick = () => {
            activeCategory = cat;
            renderSongsUI(container);
        };
        chipsRow.appendChild(chip);
    });

    headerWrapper.appendChild(searchInput);
    headerWrapper.appendChild(chipsRow);
    container.appendChild(headerWrapper);

    const listContainer = document.createElement('div');
    listContainer.className = 'song-list-container';
    container.appendChild(listContainer);

    renderSongsList(listContainer);
}

function renderSongsList(container) {
    container.innerHTML = '';

    const filtered = SONGS_LIBRARY.filter(s => {
        const matchesCat = activeCategory === 'All' || s.category === activeCategory;
        const matchesQuery = !searchQuery || 
            s.title.toLowerCase().includes(searchQuery) || 
            s.category.toLowerCase().includes(searchQuery) ||
            s.id.toLowerCase().includes(searchQuery);
        return matchesCat && matchesQuery;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="card" style="text-align:center; padding: 30px 20px; border-radius:16px;">
                <div style="font-size:36px; margin-bottom:10px;">🔍</div>
                <h3 style="font-size:15px; font-weight:700; color:var(--text-1); margin-bottom:4px;">No Songs Found</h3>
                <p style="font-size:12px; color:var(--text-2);">Try searching for another melody.</p>
            </div>
        `;
        return;
    }

    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:10px;';

    filtered.forEach(song => {
        const isPlaying = currentPlayingId === song.id;
        const item = document.createElement('div');
        item.className = `card song-item ${isPlaying ? 'playing' : ''}`;
        item.style.cssText = `
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 14px 16px !important;
            border-radius: 16px !important;
            gap: 12px !important;
            transition: all 0.2s ease;
            ${isPlaying ? 'border-color: var(--teal) !important; background: rgba(0, 168, 150, 0.08) !important;' : ''}
        `;

        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0; overflow:hidden;">
                <div style="
                    width: 42px; height: 42px; border-radius: 12px; 
                    background: ${isPlaying ? 'var(--teal)' : 'rgba(0,0,0,0.05)'}; 
                    color: ${isPlaying ? '#FFF' : 'var(--text-1)'};
                    display: flex; align-items: center; justify-content: center;
                    font-size: 18px; font-weight: bold; flex-shrink: 0;
                ">
                    ${isPlaying ? '🔊' : getCategoryIcon(song.category)}
                </div>
                <div style="flex:1; min-width:0; overflow:hidden;">
                    <div style="font-size:14px; font-weight:700; color:var(--text-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.3;">
                        ${song.title}
                    </div>
                    <div style="font-size:11px; color:var(--text-2); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        <span style="font-weight:600; color:var(--teal);">${song.category}</span> · ${song.duration}
                    </div>
                </div>
            </div>
            
            <button class="${isPlaying ? 'btn-secondary' : 'btn-primary'} btn-play-song" 
                style="width: auto !important; min-width: 86px !important; padding: 8px 14px !important; font-size: 12px !important; font-weight:600 !important; border-radius: 20px !important; flex-shrink: 0 !important; margin: 0 !important; display: inline-flex !important; align-items: center !important; justify-content: center !important;">
                ${isPlaying ? '⏹ Stop' : '▶ Play'}
            </button>
        `;

        item.querySelector('.btn-play-song').onclick = (e) => {
            e.stopPropagation();
            togglePlaySong(song);
        };
        list.appendChild(item);
    });

    container.appendChild(list);
}

export function togglePlaySong(song) {
    if (currentPlayingId === song.id) {
        stopSong();
    } else {
        playSong(song);
    }
}

export function playSong(song) {
    currentPlayingId = song.id;
    publishSong(song.id);
    showToast(`Playing "${song.title}" on buzzer 🎵`, 'info');
    initSongsScreen();
}

export function stopSong() {
    if (currentPlayingId) {
        publishSong('stop');
        showToast('Stopped song playback', 'info');
        currentPlayingId = null;
        initSongsScreen();
    }
}
