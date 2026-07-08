const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

const validFiles = {
  'A': [1,2,3,4,5,6,7,8,9,10,11,12,13,14,16],
  'B': [1,2,16],
  'C': [1,2,4,5,7,10,14,15,16],
  'D': [3,4,5,6,7,8,9,10,11,12,13,14,15,16],
  'E': [1,2,3,5,6,7,8,9,10,12,13,14,15,16]
};

const padConfigs = {
  'A': {
    2: { loop: true },
    7: { loop: true },
    11: { loop: true },
    12: { holdToPlay: true },
    16: { loop: true }
  }
};
// Other tabs default to {loop: false, holdToPlay: false}

let currentTab = 'A';
const buffers = {}; 
const activeNodes = {};

// ----- UI Initialization -----
function initGrid() {
    const grid = document.getElementById('pad-grid');
    for(let i = 1; i <= 16; i++) {
        const pad = document.createElement('div');
        pad.className = 'pad disabled';
        pad.dataset.id = i;
        pad.innerText = i.toString().padStart(2, '0');
        
        pad.addEventListener('touchstart', (e) => handlePadPress(e, i, pad), { passive: false });
        pad.addEventListener('touchend', (e) => handlePadRelease(e, i, pad), { passive: false });
        pad.addEventListener('touchcancel', (e) => handlePadRelease(e, i, pad), { passive: false });
        
        pad.addEventListener('mousedown', (e) => handlePadPress(e, i, pad));
        pad.addEventListener('mouseup', (e) => handlePadRelease(e, i, pad));
        pad.addEventListener('mouseleave', (e) => handlePadRelease(e, i, pad));
        
        pad.addEventListener('contextmenu', e => e.preventDefault());
        
        grid.appendChild(pad);
    }

    document.getElementById('stop-all').addEventListener('touchstart', (e) => {
        e.preventDefault();
        stopAll();
    }, { passive: false });
    document.getElementById('stop-all').addEventListener('mousedown', stopAll);
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTab = e.target.dataset.tab;
            renderTab();
        });
    });
}

function renderTab() {
    for(let i = 1; i <= 16; i++) {
        const pad = document.querySelector(`.pad[data-id="${i}"]`);
        if (validFiles[currentTab].includes(i)) {
            pad.classList.remove('disabled');
        } else {
            pad.classList.add('disabled');
            pad.classList.remove('playing', 'loop');
        }
    }
}

// ----- Audio Playback Logic -----
function getConfig(tab, id) {
    if (padConfigs[tab] && padConfigs[tab][id]) {
        return padConfigs[tab][id];
    }
    return { loop: false, holdToPlay: false };
}

function handlePadPress(e, id, padElement) {
    if (e.type === 'touchstart') e.preventDefault();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!validFiles[currentTab].includes(id)) return;

    const config = getConfig(currentTab, id);
    const bufferKey = `${currentTab}_${id}`;
    
    // UUID for active node to allow multi-tab STOP ALL tracking easily
    const nodeKey = bufferKey; 

    if (config.holdToPlay) {
        if (!activeNodes[nodeKey]) playBuffer(bufferKey, padElement, false, nodeKey);
    } else if (config.loop) {
        if (activeNodes[nodeKey]) stopBuffer(nodeKey, padElement);
        else playBuffer(bufferKey, padElement, true, nodeKey);
    } else {
        if (activeNodes[nodeKey]) stopBuffer(nodeKey, padElement);
        playBuffer(bufferKey, padElement, false, nodeKey);
    }
}

function handlePadRelease(e, id, padElement) {
    if (e.type && e.type.startsWith('touch')) e.preventDefault();
    const config = getConfig(currentTab, id);
    const nodeKey = `${currentTab}_${id}`;
    if (config.holdToPlay) {
        stopBuffer(nodeKey, padElement);
    }
}

function playBuffer(bufferKey, padElement, loop, nodeKey) {
    if (!buffers[bufferKey]) return;
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffers[bufferKey];
    source.loop = loop;
    source.connect(audioCtx.destination);
    
    source.onended = () => {
        if (activeNodes[nodeKey] === source) {
            // Only remove UI playing if we are on the same tab
            if (nodeKey.startsWith(currentTab)) {
                padElement.classList.remove('playing', 'loop');
            }
            delete activeNodes[nodeKey];
        }
    };
    
    source.start(0);
    activeNodes[nodeKey] = source;
    
    padElement.classList.add('playing');
    if (loop) padElement.classList.add('loop');
}

function stopBuffer(nodeKey, padElement) {
    if (activeNodes[nodeKey]) {
        try { activeNodes[nodeKey].stop(); } catch(e) {}
        delete activeNodes[nodeKey];
    }
    if (padElement) {
        padElement.classList.remove('playing', 'loop');
    } else if (nodeKey.startsWith(currentTab)) {
        // Find pad if not provided but we are on the same tab
        const id = nodeKey.split('_')[1];
        const p = document.querySelector(`.pad[data-id="${id}"]`);
        if(p) p.classList.remove('playing', 'loop');
    }
}

function stopAll() {
    Object.keys(activeNodes).forEach(nodeKey => {
        stopBuffer(nodeKey, null);
    });
    // Ensure all pads on current screen turn off visually
    document.querySelectorAll('.pad').forEach(p => p.classList.remove('playing', 'loop'));
}

// ----- IndexedDB & Setup Logic -----
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('SamplerDB', 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('audioStore')) {
                db.createObjectStore('audioStore');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function getFromDB(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('audioStore', 'readonly');
        const store = tx.objectStore('audioStore');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function saveToDB(db, key, arrayBuffer) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('audioStore', 'readwrite');
        const store = tx.objectStore('audioStore');
        const req = store.put(arrayBuffer, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function setupSystem() {
    const db = await openDB();
    const totalFiles = Object.values(validFiles).reduce((sum, arr) => sum + arr.length, 0);
    let checkedCount = 0;
    const progressFill = document.getElementById('setup-progress');
    const statusText = document.getElementById('setup-status');
    const startBtn = document.getElementById('setup-start-btn');
    
    // Ensure AudioContext is available
    const unlockAudio = () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
    };
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('mousedown', unlockAudio, { once: true });

    for (const [tab, fileIds] of Object.entries(validFiles)) {
        for (const id of fileIds) {
            const key = `${tab}_${id}`;
            const fileName = `${id.toString().padStart(2, '0')}.mp3`;
            const url = `audio/${tab}/${fileName}`;
            
            let arrayBuffer = await getFromDB(db, key);
            
            if (!arrayBuffer) {
                statusText.innerText = `Downloading ${tab}-${id}...`;
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    arrayBuffer = await res.arrayBuffer();
                    await saveToDB(db, key, arrayBuffer);
                } catch(e) {
                    console.error(`Failed downloading ${url}`, e);
                }
            }
            
            if (arrayBuffer) {
                try {
                    // We must clone the buffer because decodeAudioData detaches it
                    const bufferCopy = arrayBuffer.slice(0);
                    buffers[key] = await audioCtx.decodeAudioData(bufferCopy);
                } catch(e) {
                    console.error(`Failed decoding ${key}`, e);
                }
            }
            
            checkedCount++;
            progressFill.style.width = `${(checkedCount / totalFiles) * 100}%`;
        }
    }
    
    statusText.innerText = 'All audio files are cached and ready!';
    startBtn.innerText = 'TAP TO START';
    startBtn.classList.add('ready');
    startBtn.disabled = false;
    
    startBtn.addEventListener('click', () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        document.getElementById('setup-overlay').style.opacity = '0';
        setTimeout(() => document.getElementById('setup-overlay').style.display = 'none', 300);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initGrid();
    renderTab();
    setupSystem().catch(console.error);
});
