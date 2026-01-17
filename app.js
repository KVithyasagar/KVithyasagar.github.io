// --- VARIABLES ---
const STORAGE_KEY_DATA = "ghost_web_data";
const STORAGE_KEY_SETTINGS = "ghost_web_settings";
const STORAGE_KEY_HISTORY = "ghost_web_history";
const STORAGE_KEY_BEST = "ghost_web_best";

let normalData = [];
let questionData = [];
let workQueue = [];
let currentBatchIndex = 0;
let batchSize = 1;
let activeDataset = [];
let geminiKey = "";
let recognition = null;
let synth = window.speechSynthesis;

// Settings
let gameMode = "sentence";
let isChallengeMode = false;
let isClozeMode = false;
let feedbackMode = "immediate";
let navTrigger = "manual";
let autoNavDelay = 2;
let ttsEnabled = false;
let defaultTimerValue = 10;
let listRenderLimit = 50;
let timerInterval = null;

let currentLevelState = {
    data: [], combinedText: "", combinedKeywords: "", foundKeywords: [], allocatedTime: 0
};
let historyLog = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || "[]");
let bestTimes = JSON.parse(localStorage.getItem(STORAGE_KEY_BEST) || "{}");

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if data exists
    const storedData = localStorage.getItem(STORAGE_KEY_DATA);
    const storedKey = localStorage.getItem('ghost_api_key');
    
    if(storedKey) document.getElementById('apiKey').value = storedKey;

    if (storedData) {
        processData(JSON.parse(storedData));
        document.getElementById('status').innerText = "✅ Previous data loaded automatically";
        document.getElementById('startBtn').innerText = "Continue Session 🚀";
    }

    // File Upload Handler
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    
    // Start Button
    document.getElementById('startBtn').addEventListener('click', () => {
        const key = document.getElementById('apiKey').value;
        if(key) {
            geminiKey = key;
            localStorage.setItem('ghost_api_key', key);
        }
        
        if (normalData.length === 0 && questionData.length === 0) {
            alert("Please upload a file first!");
            return;
        }
        renderSelectionPage();
    });
});

// --- DATA HANDLING ---
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const rawContent = e.target.result;
        const parsed = parseContent(rawContent, file.name);
        
        // Save to LocalStorage
        localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(parsed));
        processData(parsed);
        document.getElementById('status').innerText = `✅ Loaded ${parsed.length} items`;
    };
    reader.readAsText(file);
}

function parseContent(content, filename) {
    const parsedData = [];
    // HTML Parsing
    if (filename.endsWith('.html') || filename.endsWith('.htm')) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        const blocks = doc.body.querySelectorAll('p, div, li, h1, h2, h3');
        blocks.forEach(node => {
            const text = node.textContent.replace(/\s+/g, ' ').trim();
            if (!text) return;
            const marks = node.querySelectorAll('mark, b, strong, em, u');
            let keywords = [];
            marks.forEach(m => keywords.push(m.textContent.trim()));
            parsedData.push({ text: text, keyword: keywords.join(',') });
        });
    } else {
        // Text Parsing
        const lines = content.split('\n');
        lines.forEach(line => {
            if (line.includes('|')) {
                const parts = line.split('|');
                parsedData.push({ text: parts[0].trim(), keyword: parts[1].trim() });
            }
        });
    }
    return parsedData;
}

function processData(data) {
    // Clean and split data
    normalData = data.filter(item => !item.text.startsWith("Q:"));
    questionData = data.filter(item => item.text.startsWith("Q:"));
}

// --- CORE UI RENDERING ---
function renderSelectionPage() {
    const root = document.getElementById('app-root');
    root.innerHTML = `
        <h2>Select Content</h2>
        <div class="control-bar" style="background:#fff; padding:10px; border-radius:8px; margin-bottom:15px;">
            <label><input type="radio" name="gm" value="sentence" ${gameMode==='sentence'?'checked':''}> Sentences</label>
            <label><input type="radio" name="gm" value="exam" ${gameMode==='exam'?'checked':''}> Questions</label>
            <input type="text" id="searchBox" placeholder="🔍 Search..." style="flex:2; margin-left:10px;">
        </div>
        
        <div id="list-container" class="list-container"></div>

        <div class="control-bar" style="justify-content:space-between;">
             <label><input type="checkbox" id="timerChk" ${isChallengeMode?'checked':''}> Timer</label>
             <select id="styleSel"><option value="classic">Classic</option><option value="cloze">Cloze</option></select>
             <button id="sessionStartBtn" class="btn-primary">START SESSION</button>
        </div>
    `;

    // Event Listeners for Mode
    document.querySelectorAll('input[name="gm"]').forEach(r => {
        r.addEventListener('change', (e) => { gameMode = e.target.value; renderList(); });
    });
    document.getElementById('searchBox').addEventListener('input', renderList);
    
    document.getElementById('sessionStartBtn').onclick = () => {
        workQueue = [];
        document.querySelectorAll('.item-chk:checked').forEach(chk => {
            const idx = parseInt(chk.value);
            const dataset = gameMode === 'sentence' ? normalData : questionData;
            workQueue.push(dataset[idx]);
        });
        if(workQueue.length === 0) return alert("Select items!");
        
        isChallengeMode = document.getElementById('timerChk').checked;
        isClozeMode = document.getElementById('styleSel').value === 'cloze';
        currentBatchIndex = 0;
        startLevel();
    };

    renderList();
}

function renderList() {
    const container = document.getElementById('list-container');
    container.innerHTML = "";
    const search = document.getElementById('searchBox') ? document.getElementById('searchBox').value.toLowerCase() : "";
    const dataset = gameMode === 'sentence' ? normalData : questionData;

    dataset.forEach((item, idx) => {
        if (search && !item.text.toLowerCase().includes(search)) return;
        if (idx >= listRenderLimit) return;

        const row = document.createElement('div');
        row.className = "list-item";
        row.innerHTML = `
            <input type="checkbox" class="item-chk" value="${idx}" id="chk-${idx}">
            <label for="chk-${idx}">#${idx+1}: ${item.text.substring(0, 60)}...</label>
        `;
        container.appendChild(row);
    });
    
    if(dataset.length > listRenderLimit) {
        const btn = document.createElement('button');
        btn.innerText = "Load More";
        btn.style.width="100%"; btn.style.marginTop="10px";
        btn.onclick = () => { listRenderLimit += 50; renderList(); };
        container.appendChild(btn);
    }
}

// --- GAME LOGIC ---
function startLevel() {
    stopTimer();
    const root = document.getElementById('app-root');
    root.innerHTML = ""; // Clear
    
    if (currentBatchIndex >= workQueue.length) { renderFinishScreen(); return; }

    const item = workQueue[currentBatchIndex];
    currentLevelState = { 
        combinedText: item.text, 
        combinedKeywords: item.keyword, 
        foundKeywords: [],
        allocatedTime: defaultTimerValue
    };

    // UI Structure
    root.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
            <button class="control-btn" style="background:#90a4ae" id="backBtn">⬅ Menu</button>
            <span id="timerDisplay" style="font-size:18px; font-weight:bold; padding:10px;"></span>
            <button class="control-btn" style="background:#ffb74d" id="skipBtn">Next ➡</button>
        </div>

        <div id="ghost-text" class="ghost-text-area">${isClozeMode ? formatCloze(item.text, []) : item.text}</div>

        <div class="stats-row">
            <span>Keywords: <span id="lbl-total">0</span></span>
            <span>Found: <span id="lbl-found" style="color:green">0</span></span>
        </div>

        <div class="input-group">
            <input type="text" id="userInput" placeholder="Type words here..." autocomplete="off">
            <div id="feedback" style="color:green; min-height:20px; margin-top:5px; font-weight:bold;"></div>
        </div>

        <div class="control-bar">
            <button class="control-btn" style="background:#29b6f6" id="micBtn">🎤 Voice</button>
            <button class="control-btn" style="background:#ffca28" id="peekBtn">👁️ Peek</button>
            <button class="control-btn" style="background:#4caf50" id="ttsBtn">🔊 Read</button>
        </div>
    `;

    // Logic Binding
    const input = document.getElementById('userInput');
    const textDiv = document.getElementById('ghost-text');
    
    input.focus();
    updateStats();

    if (isChallengeMode) startTimer(currentLevelState.allocatedTime);

    input.addEventListener('input', (e) => {
        checkInput(e.target.value);
    });

    document.getElementById('backBtn').onclick = renderSelectionPage;
    document.getElementById('skipBtn').onclick = () => { currentBatchIndex++; startLevel(); };
    document.getElementById('peekBtn').onclick = () => { textDiv.innerText = currentLevelState.combinedText; };
    document.getElementById('ttsBtn').onclick = () => { speak(currentLevelState.combinedText); };
    document.getElementById('micBtn').onclick = () => toggleVoice(input);
}

function checkInput(val) {
    const textDiv = document.getElementById('ghost-text');
    const keywords = currentLevelState.combinedKeywords.toLowerCase().split(',').map(k => k.trim());
    
    let newlyFound = false;
    keywords.forEach(k => {
        // Handle synonyms slashed (e.g., big/large)
        const variants = k.split('/');
        const match = variants.find(v => val.toLowerCase().includes(v));
        
        if (match && !currentLevelState.foundKeywords.includes(match)) {
            currentLevelState.foundKeywords.push(match);
            newlyFound = true;
            document.getElementById('userInput').value = ""; // Clear input on success
        }
    });

    if (newlyFound) {
        textDiv.innerHTML = isClozeMode ? 
            formatCloze(currentLevelState.combinedText, currentLevelState.foundKeywords) : 
            formatClassic(currentLevelState.combinedText, currentLevelState.foundKeywords);
        
        updateStats();
        
        // Check Full Completion
        const totalGroups = keywords.length; // Approximate check
        if (currentLevelState.foundKeywords.length >= totalGroups) {
            document.getElementById('feedback').innerText = "🎉 Complete! Moving next...";
            setTimeout(() => { currentBatchIndex++; startLevel(); }, 1500);
        }
    }
}

// --- UTILS ---
function formatCloze(text, found) {
    let formatted = text;
    const keywords = currentLevelState.combinedKeywords.split(',');
    keywords.forEach(k => {
        const variants = k.split('/').map(v => v.trim());
        const isFound = variants.some(v => found.includes(v.toLowerCase()));
        
        variants.forEach(v => {
            const regex = new RegExp(`(${escapeRegExp(v)})`, 'gi');
            formatted = formatted.replace(regex, isFound ? 
                `<span style="color:green; border-bottom:2px solid green">$1</span>` : 
                `<span style="background:#eee; color:#eee; border-radius:4px;">____</span>`);
        });
    });
    return formatted;
}

function formatClassic(text, found) {
    // Similar logic but reveals text instead of unmasking
    return formatCloze(text, found); // Reusing logic for brevity in this example
}

function updateStats() {
    const keywords = currentLevelState.combinedKeywords.split(',').filter(k=>k);
    document.getElementById('lbl-total').innerText = keywords.length;
    document.getElementById('lbl-found').innerText = currentLevelState.foundKeywords.length;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- TIMING & TTS ---
function startTimer(seconds) {
    let t = seconds;
    const display = document.getElementById('timerDisplay');
    display.innerText = `⏳ ${t}s`;
    timerInterval = setInterval(() => {
        t--;
        display.innerText = `⏳ ${t}s`;
        if (t <= 0) {
            clearInterval(timerInterval);
            display.innerText = "Time Up!";
            document.getElementById('ghost-text').innerText = currentLevelState.combinedText; // Reveal
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
}

function speak(text) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utter);
}

// --- VOICE (Web Speech API) ---
function toggleVoice(inputEl) {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        return alert("Voice not supported on this browser.");
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (recognition) { recognition.stop(); recognition = null; return; }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    
    recognition.onstart = () => { inputEl.placeholder = "Listening..."; inputEl.style.background = "#fff3e0"; };
    recognition.onend = () => { inputEl.placeholder = "Type words here..."; inputEl.style.background = "#fff"; recognition = null; };
    
    recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim();
        inputEl.value = transcript;
        checkInput(transcript); // Trigger check immediately
    };
    
    recognition.start();
}

function renderFinishScreen() {
    document.getElementById('app-root').innerHTML = `
        <div class="welcome-screen">
            <h1>Session Complete! 🎉</h1>
            <p>Great job.</p>
            <button class="btn-primary" onclick="renderSelectionPage()">Return to Menu</button>
        </div>
    `;
}