// script.js — decks loader + quiz UI + grammar practice + progress UI
// NOTE: All Firebase access is delegated to firebase.js helpers on window.*
// This file contains NO direct Firebase imports.

/* =========================
   State
   ========================= */
let allDecks = {};                // { deckName: [{front, back, romaji}] }
let currentDeck = [];
let currentDeckName = "";
let currentIndex = 0;
let mode = "jp-en";
let score = { correct: 0, wrong: 0, skipped: 0 };

let mistakes = JSON.parse(localStorage.getItem("mistakes") || "[]");
let masteryMap = JSON.parse(localStorage.getItem("masteryMap") || "{}");

// Vocab session resume state (per sign-in session)
let vocabRun = JSON.parse(localStorage.getItem("vocabRun") || "null") || {
  deckName: "",
  mode: "jp-en",
  order: [],      // array of indices for shuffled order
  index: 0,
  score: { correct: 0, wrong: 0, skipped: 0 }
};

// Buffered counters for Firestore (committed in bursts via firebase.js)
let sessionBuf = JSON.parse(localStorage.getItem("sessionBuf") || "null") || {
  deckName: "",
  mode: "jp-en",
  correct: 0,
  wrong: 0,
  skipped: 0,
  total: 0,
  jpEnCorrect: 0,
  enJpCorrect: 0
};

let currentSectionId = "deck-select";
let committing = false;

/* =========================
   Grammar practice state
   ========================= */
let grammarSets = {}; // { setName: [{q, a}] }
let grammarRun = JSON.parse(localStorage.getItem("grammarRun") || "null") || {
  setName: "",
  order: [],
  index: 0,
  correct: 0,
  wrong: 0
};

/* =========================
   DOM helpers
   ========================= */
const $ = (id) => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.innerText = txt; };
function statusLine(id, msg) { const s = $(id); if (s) s.textContent = msg; }
function percent(n, d) { if (!d) return 0; return Math.floor((n / d) * 100); }
function persist(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
function persistSession(){ persist("sessionBuf", sessionBuf); }

/* =========================
   Deck progress (Vocab Practice)
   ========================= */
function updateDeckProgress() {
  const totalQs = currentDeck.length || 0;
  const done = Math.min(currentIndex, totalQs);
  const p = percent(done, totalQs);
  const bar = $("deck-progress-bar");
  const txt = $("deck-progress-text");
  if (bar) bar.style.width = `${p}%`;
  if (txt) txt.textContent = `${done} / ${totalQs} (${p}%)`;
}

/* =========================
   Autosave bridge
   ========================= */
async function autoCommitIfNeeded(reason = "") {
  if (!window.__fb_commitSession) return;
  if (committing) return;
  if (!sessionBuf || sessionBuf.total <= 0) return;

  try {
    committing = true;
    const payload = {
      deckName: sessionBuf.deckName || 'Unknown Deck',
      mode: sessionBuf.mode,
      correct: sessionBuf.correct,
      wrong: sessionBuf.wrong,
      skipped: sessionBuf.skipped,
      total: sessionBuf.total,
      jpEnCorrect: sessionBuf.jpEnCorrect,
      enJpCorrect: sessionBuf.enJpCorrect
    };
    await window.__fb_commitSession(payload);

    // Reset counters but keep deck & mode for a smooth continue
    sessionBuf.correct = 0;
    sessionBuf.wrong = 0;
    sessionBuf.skipped = 0;
    sessionBuf.total = 0;
    sessionBuf.jpEnCorrect = 0;
    sessionBuf.enJpCorrect = 0;
    persistSession();

    await renderProgress();
  } catch (e) {
    console.warn("[autosave] failed, will keep local buffer:", e?.message || e);
  } finally {
    committing = false;
  }
}

/* =========================
   Lifecycle
   ========================= */
window.onload = () => {
  loadDeckManifest();
  loadGrammarManifest();        // PDFs
  loadGrammarPracticeManifest(); // NEW: Practice Grammar sets
  renderProgress();
  updateScore();
  // If there’s an active vocab run, keep the user where they are if they are already in practice
  // (we resume explicitly when they select the deck again).
};

// Called by firebase.js when auth is ready
window.__initAfterLogin = () => {
  renderProgress();
};

// best-effort safeguard
window.addEventListener('pagehide', () => {
  try {
    if (sessionBuf.total > 0) localStorage.setItem('pendingSession', JSON.stringify(sessionBuf));
  } catch {}
});
window.addEventListener('beforeunload', () => {
  try {
    if (sessionBuf.total > 0) localStorage.setItem('pendingSession', JSON.stringify(sessionBuf));
  } catch {}
});

/* =========================
   Section Router
   ========================= */
function showSection(id) {
  // Leaving Vocab Practice? autosave the deck's buffered progress
  if (currentSectionId === "practice" && id !== "practice") {
    autoCommitIfNeeded("leaving vocab practice");
  }

  document.querySelectorAll('.main-content main > section').forEach(sec => {
    sec.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');

  currentSectionId = id;

  if (id === "practice") updateDeckProgress();
}
window.showSection = showSection;

/* =========================
   VOCAB DECKS
   ========================= */
async function loadDeckManifest() {
  try {
    statusLine("deck-status", "Loading decks…");
    const res = await fetch("vocab_decks/deck_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Manifest looks like HTML; check path.");
    /** @type {string[]} */
    const deckList = JSON.parse(text);
    deckList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    allDecks = {};
    for (const file of deckList) {
      const name = file.replace(".csv", "");
      statusLine("deck-status", `Loading ${file}…`);
      allDecks[name] = await fetchAndParseVocabCSV(`vocab_decks/${file}`);
    }

    renderDeckButtons();
    statusLine("deck-status", `Loaded ${Object.keys(allDecks).length} deck(s).`);
  } catch (err) {
    console.error("Failed to load decks:", err);
    statusLine("deck-status", `Failed: ${err.message}`);
  }
}

function parseCSV(text){
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (inQuotes){
      if (ch === '"'){
        if (text[i+1] === '"'){ cur += '"'; i++; }
        else { inQuotes = false; }
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ','){ row.push(cur.trim()); cur = ''; }
      else if (ch === '\n'){ row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r'){ /* ignore */ }
      else cur += ch;
    }
  }
  if (cur.length || inQuotes || row.length){ row.push(cur.trim()); rows.push(row); }
  return rows.filter(r => r.some(c => c && c.length));
}

async function fetchAndParseVocabCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = (await res.text()).replace(/^\uFEFF/, "");
  const table = parseCSV(text);

  const looksLikeHeader = (row) => {
    if (!row || row.length === 0) return false;
    const h = row.map(c => (c || "").trim().toLowerCase());
    const set = new Set(h);
    return (
      set.has("front") || set.has("back") || set.has("romaji") ||
      set.has("word")  || set.has("meaning")
    );
  };

  const rows = (table.length && looksLikeHeader(table[0]) ? table.slice(1) : table)
    .map(cols => {
      const [word = "", meaning = "", romaji = ""] = cols;
      return { front: (word||"").trim(), back:(meaning||"").trim(), romaji:(romaji||"").trim() };
    })
    .filter(r => r.front && r.back);

  return rows;
}

function renderDeckButtons() {
  const container = $("deck-buttons");
  if (!container) return;
  container.innerHTML = "";

  Object.keys(allDecks).forEach((name) => {
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.onclick = async () => {
      // If switching decks while having progress, auto-save first
      if (sessionBuf.total > 0 && sessionBuf.deckName && sessionBuf.deckName !== name) {
        await autoCommitIfNeeded("switching decks");
      }
      selectDeck(name);
    };
    container.appendChild(btn);
  });
}

function selectDeck(name) {
  currentDeck = allDecks[name] || [];
  currentDeckName = name;

  // If there is a saved run for this deck, resume it
  const canResume = vocabRun.deckName === name && Array.isArray(vocabRun.order) && vocabRun.order.length === currentDeck.length;
  if (canResume) {
    mode = vocabRun.mode || "jp-en";
    currentIndex = vocabRun.index || 0;
    score = vocabRun.score || { correct:0, wrong:0, skipped:0 };
    sessionBuf.deckName = name;
    sessionBuf.mode = mode;
    showSection("mode-select");
    statusLine("deck-status", `Resuming ${name} at ${currentIndex + 1}/${currentDeck.length}`);
    return;
  }

  // otherwise fresh run
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  sessionBuf = {
    deckName: name,
    mode: "jp-en",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0
  };
  persistSession();
  vocabRun = { deckName: name, mode: "jp-en", order: [], index: 0, score: { correct:0, wrong:0, skipped:0 } };
  persist("vocabRun", vocabRun);
  showSection("mode-select");
}

/* =========================
   VOCAB PRACTICE
   ========================= */
function startPractice(selectedMode) {
  mode = selectedMode;
  sessionBuf.mode = selectedMode;
  score = { correct: 0, wrong: 0, skipped: 0 };

  // Initialize or reuse shuffled order for resume
  const size = currentDeck.length;
  if (!Array.isArray(vocabRun.order) || vocabRun.order.length !== size || vocabRun.deckName !== currentDeckName || vocabRun.mode !== mode) {
    const order = Array.from({length: size}, (_, i) => i);
    shuffleArray(order);
    vocabRun = { deckName: currentDeckName, mode, order, index: 0, score: { correct:0, wrong:0, skipped:0 } };
  } else {
    // Use existing resume state
  }
  persist("vocabRun", vocabRun);

  currentIndex = vocabRun.index || 0;
  showSection("practice");
  updateScore();
  updateDeckProgress();
  showQuestion();
}
window.startPractice = startPractice;

function mapIndex(i){
  // translate logical position to actual item via shuffled order
  if (!vocabRun.order || !vocabRun.order.length) return i;
  return vocabRun.order[i] ?? i;
}

function showQuestion() {
  const q = currentDeck[mapIndex(currentIndex)];
  if (!q) return nextQuestion();

  const front  = (mode === "jp-en") ? q.front : q.back;
  const answer = (mode === "jp-en") ? q.back  : q.front;
  const options = generateOptions(answer);

  setText("question-box", front);
  setText("extra-info", "");
  const optionsList = $("options");
  if (!optionsList) return;
  optionsList.innerHTML = "";

  options.forEach((opt) => {
    const li = document.createElement("li");
    li.textContent = opt;
    li.onclick = () => checkAnswer(opt, answer, q);
    optionsList.appendChild(li);
  });

  updateDeckProgress();
}

function generateOptions(correct) {
  const pool = currentDeck.map((q) => (mode === "jp-en" ? q.back : q.front)).filter(Boolean);
  const unique = [...new Set(pool.filter((opt) => opt !== correct))];
  shuffleArray(unique);
  const distractors = unique.slice(0, 3);
  return shuffleArray([correct, ...distractors]);
}

function checkAnswer(selected, correct, wordObj) {
  const options = document.querySelectorAll("#options li");
  options.forEach((li) => {
    if (li.textContent === correct) li.classList.add("correct");
    else if (li.textContent === selected) li.classList.add("wrong");
  });

  const key = wordObj.front + "|" + wordObj.back;

  if (selected === correct) {
    score.correct++;
    vocabRun.score.correct++;
    sessionBuf.correct++;
    sessionBuf.total++;
    if (mode === 'jp-en') sessionBuf.jpEnCorrect++; else sessionBuf.enJpCorrect++;

    masteryMap[key] = (masteryMap[key] || 0) + 1;
    if (masteryMap[key] >= 5) {
      mistakes = mistakes.filter(m => m.front !== wordObj.front || m.back !== wordObj.back);
    }
  } else {
    score.wrong++;
    vocabRun.score.wrong++;
    sessionBuf.wrong++;
    sessionBuf.total++;
    masteryMap[key] = 0;
    mistakes.push(wordObj);
  }

  persist("mistakes", mistakes);
  persist("masteryMap", masteryMap);
  persistSession();
  persist("vocabRun", vocabRun);
  updateScore();

  setTimeout(() => { nextQuestion(); updateDeckProgress(); }, 600);
}

function skipQuestion() {
  const wordObj = currentDeck[mapIndex(currentIndex)];
  if (!wordObj) return;

  score.skipped++;
  vocabRun.score.skipped++;
  sessionBuf.skipped++;
  sessionBuf.total++;

  const key = wordObj.front + "|" + wordObj.back;
  masteryMap[key] = 0;
  mistakes.push(wordObj);

  persist("mistakes", mistakes);
  persist("masteryMap", masteryMap);
  persistSession();
  persist("vocabRun", vocabRun);
  updateScore();
  nextQuestion();
  updateDeckProgress();
}
window.skipQuestion = skipQuestion;

function nextQuestion() {
  currentIndex++;
  vocabRun.index = currentIndex;
  persist("vocabRun", vocabRun);

  if (currentIndex >= currentDeck.length) {
    alert(`Finished! ✅ ${score.correct} ❌ ${score.wrong} ➖ ${score.skipped}\nSaving your progress…`);
    // clear this run so next time starts fresh unless reselected
    vocabRun = { deckName: "", mode: "jp-en", order: [], index: 0, score: {correct:0,wrong:0,skipped:0} };
    persist("vocabRun", vocabRun);
    showSection("deck-select");
  } else {
    showQuestion();
  }
}

function updateScore() {
  setText("correct", String(score.correct));
  setText("wrong", String(score.wrong));
  setText("skipped", String(score.skipped));
}

/* =========================
   VOCAB LEARN mode (modified)
   - Show word big
   - Show meaning under it
   - Romaji toggle button (as requested)
   ========================= */
function startLearnMode() {
  currentIndex = vocabRun.index && vocabRun.deckName === currentDeckName ? vocabRun.index : 0;
  if (!currentDeck.length) return alert("Pick a deck first!");
  showSection("learn");
  renderLearnCard();
}
window.startLearnMode = startLearnMode;

function renderLearnCard() {
  const box = $("learn-box");
  const word = currentDeck[mapIndex(currentIndex)] || currentDeck[currentIndex];
  if (!word || !box) return;

  box.innerHTML = `
    <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow);max-width:680px;">
      <div style="font-size:28px;font-weight:800;margin-bottom:10px">${word.front}</div>
      <div style="font-size:18px;color:#333;margin-bottom:8px">${word.back}</div>
      <div id="learn-romaji" class="muted" style="display:none;margin-top:4px;"></div>
      <div style="margin-top:12px;">
        <button id="btn-learn-romaji">👁 Show Romaji</button>
        <button id="btn-learn-prev">◀ Prev</button>
        <button id="btn-learn-next">Next ▶</button>
      </div>
    </div>
  `;

  const romajiDiv = $("learn-romaji");
  const btnR = $("btn-learn-romaji");
  btnR.onclick = () => {
    if (!romajiDiv) return;
    if (romajiDiv.style.display === "none") {
      romajiDiv.textContent = word.romaji || "(no romaji)";
      romajiDiv.style.display = "block";
      btnR.textContent = "🙈 Hide Romaji";
    } else {
      romajiDiv.style.display = "none";
      btnR.textContent = "👁 Show Romaji";
    }
  };

  $("btn-learn-prev").onclick = () => {
    if (currentIndex > 0) { currentIndex--; vocabRun.index = currentIndex; persist("vocabRun", vocabRun); renderLearnCard(); }
  };
  $("btn-learn-next").onclick = () => nextLearn();
}

function nextLearn() {
  currentIndex++;
  vocabRun.index = currentIndex;
  persist("vocabRun", vocabRun);
  if (currentIndex >= currentDeck.length) {
    alert("🎉 Finished learning this deck!");
    showSection("deck-select");
  } else {
    renderLearnCard();
  }
}
window.nextLearn = nextLearn;

/* =========================
   MISTAKES
   ========================= */
function startMistakePractice() {
  if (mistakes.length === 0) return alert("No mistakes yet!");
  currentDeck = mistakes.slice();
  currentDeckName = "Mistakes";
  currentIndex = 0;

  // reset vocabRun for mistakes deck
  const order = Array.from({length: currentDeck.length}, (_, i) => i);
  shuffleArray(order);
  vocabRun = { deckName: "Mistakes", mode, order, index: 0, score: {correct:0,wrong:0,skipped:0} };
  persist("vocabRun", vocabRun);

  showSection("practice");
  startPractice(mode);
}
window.startMistakePractice = startMistakePractice;

function clearMistakes() {
  if (confirm("Clear all mistake words?")) {
    mistakes = [];
    persist("mistakes", []);
    alert("Mistakes cleared.");
  }
}
window.clearMistakes = clearMistakes;

/* =========================
   GRAMMAR (PDF list, existing)
   ========================= */
async function loadGrammarManifest() {
  try {
    statusLine("grammar-status", "Loading grammar lessons…");
    let base = "grammar/";
    let list = null;

    const tryLoad = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const t = await r.text();
      if (t.trim().startsWith("<")) throw new Error("Got HTML instead of JSON");
      return JSON.parse(t);
    };

    try {
      list = await tryLoad("grammar/grammar_manifest.json");
      base = "grammar/";
    } catch {
      list = await tryLoad("grammar_manifest.json");
      base = "";
    }

    const container = $("grammar-list");
    if (!container) return;
    container.innerHTML = "";

    // PDFs at the top
    const pdfWrap = document.createElement("div");
    pdfWrap.style.marginBottom = "12px";
    const pdfTitle = document.createElement("h3");
    pdfTitle.textContent = "Grammar PDFs";
    pdfWrap.appendChild(pdfTitle);

    const btnRow = document.createElement("div");
    list.forEach((file) => {
      const btn = document.createElement("button");
      btn.textContent = file.replace(".pdf", "");
      btn.onclick = () => window.open(`${base}${file}`, "_blank");
      btnRow.appendChild(btn);
    });
    pdfWrap.appendChild(btnRow);
    container.appendChild(pdfWrap);

    // Placeholder for Practice Grammar list will be appended by loadGrammarPracticeManifest()
    const pgTitle = document.createElement("h3");
    pgTitle.textContent = "Practice Grammar";
    container.appendChild(pgTitle);

    const pgHost = document.createElement("div");
    pgHost.id = "grammar-practice-host";
    container.appendChild(pgHost);

    statusLine("grammar-status", `Loaded ${list.length} PDF file(s).`);
  } catch (err) {
    console.error("Failed to load grammar manifest:", err);
    statusLine("grammar-status", `Failed to load PDFs: ${err.message}`);
  }
}

/* =========================
   GRAMMAR PRACTICE (NEW)
   - Loads /practice-grammar/manifest.csv (list of csv filenames)
   - Each csv has question,answer (no header)
   - Typing input; check; show answer; random order; 2s advance; progressbar
   - Hides the set list while practicing; supports resume per session
   ========================= */
async function loadGrammarPracticeManifest(){
  try{
    const host = $("grammar-practice-host");
    if (!host) return; // created by loadGrammarManifest
    host.innerHTML = "Loading practice sets…";

    const res = await fetch("/practice-grammar/manifest.csv");
    if (!res.ok) throw new Error(`HTTP ${res.status} for /practice-grammar/manifest.csv`);
    const raw = await res.text();
    const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);

    // Load all sets’ contents (lazy on click could be done too, but small files are fine)
    grammarSets = {};
    for (const fname of lines) {
      const csvUrl = `/practice-grammar/${fname}`;
      grammarSets[fname.replace(".csv","")] = await fetchAndParseGrammarCSV(csvUrl);
    }

    renderGrammarSetList();
  }catch(e){
    console.error("Grammar practice manifest failed:", e);
    const host = $("grammar-practice-host");
    if (host) host.textContent = `Failed to load practice sets: ${e.message}`;
  }
}

async function fetchAndParseGrammarCSV(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = (await res.text()).replace(/^\uFEFF/, "");
  const rows = parseCSV(text).map(r => ({ q: (r[0]||"").trim(), a: (r[1]||"").trim() }))
                             .filter(r => r.q && r.a);
  return rows;
}

function renderGrammarSetList(){
  const host = $("grammar-practice-host");
  if (!host) return;
  host.innerHTML = "";

  const listWrap = document.createElement("div");
  listWrap.id = "gp-list";
  Object.keys(grammarSets).forEach(setName => {
    const btn = document.createElement("button");
    btn.textContent = setName;
    btn.onclick = () => startGrammarPractice(setName);
    listWrap.appendChild(btn);
  });
  host.appendChild(listWrap);

  const practiceWrap = document.createElement("div");
  practiceWrap.id = "gp-practice";
  practiceWrap.style.display = "none";
  host.appendChild(practiceWrap);

  // If there’s a resumable grammar run, offer auto-resume banner
  if (grammarRun.setName && grammarSets[grammarRun.setName]) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `You have an unfinished practice: ${grammarRun.setName} (${grammarRun.index}/${grammarSets[grammarRun.setName].length}). Click the set to resume.`;
    host.prepend(note);
  }
}

function startGrammarPractice(setName){
  const items = grammarSets[setName] || [];
  if (items.length === 0) { alert("This set is empty."); return; }

  // Resume or create a shuffled order
  if (grammarRun.setName !== setName || !Array.isArray(grammarRun.order) || grammarRun.order.length !== items.length) {
    const order = Array.from({length: items.length}, (_, i) => i);
    shuffleArray(order);
    grammarRun = { setName, order, index: 0, correct: 0, wrong: 0 };
  }
  persist("grammarRun", grammarRun);

  // Hide list, show practice
  const list = $("gp-list");
  const box = $("gp-practice");
  if (list && box) { list.style.display = "none"; box.style.display = ""; }

  renderGrammarPracticeCard();
}

function mapGrammarIndex(i){
  if (!grammarRun.order || !grammarRun.order.length) return i;
  return grammarRun.order[i] ?? i;
}

function renderGrammarPracticeCard(){
  const box = $("gp-practice");
  const items = grammarSets[grammarRun.setName] || [];
  const n = items.length;
  const i = grammarRun.index;
  const item = items[mapGrammarIndex(i)];

  if (!box) return;
  if (!item) { finishGrammarPractice(); return; }

  const p = percent(i, n);
  box.innerHTML = `
    <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow);max-width:780px;">
      <div style="font-weight:700;margin-bottom:8px">${grammarRun.setName}</div>

      <div style="margin:8px 0 12px">
        <div style="height:10px;background:#eef2ff;border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <div style="width:${p}%;height:10px;background:var(--primary);transition:width .25s ease"></div>
        </div>
        <div class="muted" style="margin-top:6px">${i} / ${n} (${p}%)</div>
      </div>

      <div style="font-size:24px;font-weight:800;margin-bottom:12px;border:1px dashed var(--border);border-radius:12px;padding:14px;">
        ${item.q}
      </div>

      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="gp-input" placeholder="Type your answer…" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px" />
        <button id="gp-submit">Submit</button>
        <button id="gp-skip">Skip</button>
        <button id="gp-show">💡 Show Answer</button>
      </div>

      <div id="gp-feedback" style="margin-top:12px;font-size:16px;"></div>
    </div>
  `;

  const input = $("gp-input");
  const submit = $("gp-submit");
  const skip = $("gp-skip");
  const showBtn = $("gp-show");
  const feedback = $("gp-feedback");

  function norm(s){ return (s||"").trim().toLowerCase(); }

  function lockUI(disabled=true){
    if (input) input.disabled = disabled;
    if (submit) submit.disabled = disabled;
    if (skip) skip.disabled = disabled;
    if (showBtn) showBtn.disabled = disabled;
  }

  submit.onclick = () => {
    const user = input.value;
    if (!user) { input.focus(); return; }
    const ok = norm(user) === norm(item.a);
    if (ok){
      grammarRun.correct++;
      feedback.innerHTML = `<span style="color:var(--green);font-weight:700">✅ Correct!</span>`;
    } else {
      grammarRun.wrong++;
      feedback.innerHTML = `<span style="color:var(--red);font-weight:700">❌ Wrong.</span> <span class="muted">Correct: ${item.a}</span>`;
    }
    lockUI(true);
    grammarRun.index++;
    persist("grammarRun", grammarRun);
    setTimeout(renderGrammarPracticeCard, 2000);
  };

  skip.onclick = () => {
    grammarRun.index++;
    persist("grammarRun", grammarRun);
    renderGrammarPracticeCard();
  };

  showBtn.onclick = () => {
    feedback.innerHTML = `<span class="muted">Answer: ${item.a}</span>`;
    input?.focus();
  };

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit.click();
  });

  input?.focus();
}

function finishGrammarPractice(){
  const items = grammarSets[grammarRun.setName] || [];
  const box = $("gp-practice");
  if (!box) return;

  box.innerHTML = `
    <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow);max-width:780px;">
      <h3>Finished: ${grammarRun.setName}</h3>
      <p>✅ ${grammarRun.correct} &nbsp; ❌ ${grammarRun.wrong} &nbsp; / ${items.length}</p>
      <button id="gp-back">← Back to Sets</button>
    </div>
  `;

  $("gp-back").onclick = () => {
    // clear run
    grammarRun = { setName:"", order:[], index:0, correct:0, wrong:0 };
    persist("grammarRun", grammarRun);
    const list = $("gp-list");
    if (list) list.style.display = "";
    if (box) box.style.display = "none";
  };
}

/* =========================
   PROGRESS (reads via firebase.js)
   ========================= */
async function renderProgress() {
  if (!window.__fb_fetchAttempts) return;
  try {
    const attempts = await window.__fb_fetchAttempts(50);
    const tbody = $("progress-table")?.querySelector("tbody");
    if (tbody) {
      tbody.innerHTML = "";
      attempts.slice(0, 20).forEach(a => {
        const tr = document.createElement("tr");
        const when = a.createdAt ? new Date(a.createdAt).toLocaleString() : "—";
        tr.innerHTML = `
          <td>${when}</td>
          <td>${a.deckName || "—"}</td>
          <td>${a.mode || "—"}</td>
          <td>${a.correct ?? 0}</td>
          <td>${a.wrong ?? 0}</td>
          <td>${a.skipped ?? 0}</td>
          <td>${a.total ?? ((a.correct||0)+(a.wrong||0)+(a.skipped||0))}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    const last = attempts[0];
    let prev = null;
    if (last) {
      prev = attempts.find(a =>
        a.deckName === last.deckName && a.createdAt < last.createdAt
      ) || null;
    }

    const lastBox = $("progress-last");
    const prevBox = $("progress-prev");
    const deltaBox = $("progress-delta");

    if (lastBox) {
      if (last) {
        lastBox.innerHTML = `
          <div><b>${last.deckName}</b> (${last.mode})</div>
          <div>✅ ${last.correct || 0} | ❌ ${last.wrong || 0} | ➖ ${last.skipped || 0}</div>
          <div class="muted">${new Date(last.createdAt).toLocaleString()}</div>
        `;
      } else lastBox.textContent = "No attempts yet.";
    }

    if (prevBox) {
      if (prev) {
        prevBox.innerHTML = `
          <div><b>${prev.deckName}</b> (${prev.mode})</div>
          <div>✅ ${prev.correct || 0} | ❌ ${prev.wrong || 0} | ➖ ${prev.skipped || 0}</div>
          <div class="muted">${new Date(prev.createdAt).toLocaleString()}</div>
        `;
      } else prevBox.textContent = "—";
    }

    if (deltaBox) {
      if (last && prev) {
        const d = (last.correct || 0) - (prev.correct || 0);
        const cls = d >= 0 ? "delta-up" : "delta-down";
        const sign = d > 0 ? "+" : (d < 0 ? "" : "±");
        deltaBox.innerHTML = `<span class="${cls}">${sign}${d} correct vs previous (same deck)</span>`;
      } else if (last && !prev) deltaBox.textContent = "No previous attempt for this deck.";
      else deltaBox.textContent = "—";
    }
  } catch (e) {
    console.warn("renderProgress failed:", e);
  }
}
window.renderProgress = renderProgress;

/* =========================
   Utilities
   ========================= */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showRomaji() {
  const card = currentDeck[mapIndex(currentIndex)];
  if (!card) return;
  const romaji = card.romaji || "(no romaji)";
  setText("extra-info", `Romaji: ${romaji}`);
}
window.showRomaji = showRomaji;

function showMeaning() {
  const card = currentDeck[mapIndex(currentIndex)];
  if (!card) return;
  const correct = mode === "jp-en" ? card.back : card.front;
  setText("extra-info", `Meaning: ${correct}`);
}
window.showMeaning = showMeaning;

/* =========================
   Navbar actions
   ========================= */
window.saveCurrentScore = async function () {
  try {
    await autoCommitIfNeeded("manual save");
    alert('Progress saved ✅');
  } catch {}
};

window.resetSite = async function () {
  const sure = confirm("⚠️ This will erase ALL your progress (attempts, daily aggregates, leaderboard rows, tasks) from the database. Your sign‑in will remain.\n\nProceed?");
  if (!sure) return;

  const btn = event?.target;
  if (btn) btn.disabled = true;

  try {
    if (!window.__fb_fullReset) throw new Error("__fb_fullReset is not available.");
    await window.__fb_fullReset();

    // Clear local caches
    localStorage.removeItem("mistakes");
    localStorage.removeItem("masteryMap");
    localStorage.removeItem("sessionBuf");
    localStorage.removeItem("pendingSession");
    localStorage.removeItem("vocabRun");
    localStorage.removeItem("grammarRun");

    alert("✅ All progress erased. You are still signed in.");
    location.reload();
  } catch (e) {
    console.error("Full reset failed:", e);
    alert("Reset failed: " + (e?.message || e));
  } finally {
    if (btn) btn.disabled = false;
  }
};
