// script.js — decks loader + quiz UI + learn card UI + grammar (PDFs + optional practice) + progress UI
// NOTE: All Firebase access is delegated to firebase.js helpers on window.*
// This file contains NO direct Firebase imports.

/* =========================
   GLOBAL STATE
   ========================= */
let allDecks = {};                // { deckName: [{front, back, romaji}] }
let currentDeck = [];
let currentDeckName = "";
let currentIndex = 0;
let mode = "jp-en";
let score = { correct: 0, wrong: 0, skipped: 0 };

let mistakes = JSON.parse(localStorage.getItem("mistakes") || "[]");
let masteryMap = JSON.parse(localStorage.getItem("masteryMap") || "{}");

// Session buffer (temporary storage; committed on demand/auto via firebase.js)
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

// Grammar Practice (optional; auto-enables if files exist)
const grammarSets = {}; // { setName: [{front, back, romaji?, note?}, ...] }
const grammarRun = {
  setName: "",
  index: 0,
  correct: 0,
  wrong: 0,
  reveal: false
};

/* =========================
   DOM HELPERS
   ========================= */
const $ = (id) => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.innerText = txt; };
function statusLine(id, msg) { const s = $(id); if (s) s.textContent = msg; console.log(`[status:${id}]`, msg); }
function persistSession() { localStorage.setItem("sessionBuf", JSON.stringify(sessionBuf)); }
function percent(n, d) { if (!d) return 0; return Math.floor((n / d) * 100); }

/* =========================
   DECK PROGRESS (Practice)
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
   AUTOSAVE BRIDGE
   ========================= */
async function autoCommitIfNeeded(reason = "") {
  if (!window.__fb_commitSession) return;
  if (committing) return;
  if (!sessionBuf || sessionBuf.total <= 0) return;

  try {
    committing = true;
    console.log("[autosave] committing buffered session", { reason, sessionBuf });
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

    // Reset counts but keep deck & mode to allow continuing smoothly
    sessionBuf.correct = 0;
    sessionBuf.wrong = 0;
    sessionBuf.skipped = 0;
    sessionBuf.total = 0;
    sessionBuf.jpEnCorrect = 0;
    sessionBuf.enJpCorrect = 0;
    persistSession();

    await renderProgress();
    console.log("[autosave] saved ✔");
  } catch (e) {
    console.warn("[autosave] failed → keeping local buffer:", e?.message || e);
  } finally {
    committing = false;
  }
}

/* =========================
   APP LIFECYCLE
   ========================= */
window.onload = () => {
  loadDeckManifest();
  loadGrammarSection(); // PDFs + (optional) practice host
  renderProgress();
  updateScore();
};

window.__initAfterLogin = () => {
  renderProgress();
};

// Persist pending session if user closes/leaves
for (const ev of ['pagehide','beforeunload']) {
  window.addEventListener(ev, () => {
    try { if (sessionBuf.total > 0) localStorage.setItem('pendingSession', JSON.stringify(sessionBuf)); } catch {}
  });
}

/* =========================
   SECTION ROUTER
   ========================= */
function showSection(id) {
  if (currentSectionId === "practice" && id !== "practice") {
    autoCommitIfNeeded("leaving practice");
  }

  document.querySelectorAll('.main-content main > section').forEach(sec => sec.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
  else console.warn('showSection: no element with id:', id);

  currentSectionId = id;
  if (id === "practice") updateDeckProgress();
}
window.showSection = showSection;

/* =========================
   VOCAB DECKS (load + UI)
   ========================= */
async function loadDeckManifest() {
  try {
    statusLine("deck-status", "Loading decks…");
    const res = await fetch("vocab_decks/deck_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status} for vocab_decks/deck_manifest.json`);
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Manifest is HTML (check path/case for vocab_decks/deck_manifest.json)");

    /** @type {string[]} */
    const deckList = JSON.parse(text);
    deckList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    allDecks = {};
    for (const file of deckList) {
      const name = file.replace(".csv", "");
      const url = `vocab_decks/${file}`;
      statusLine("deck-status", `Loading ${file}…`);
      const deck = await fetchAndParseCSV(url);
      allDecks[name] = deck;
    }

    renderDeckButtons();
    statusLine("deck-status", `Loaded ${Object.keys(allDecks).length} deck(s).`);
  } catch (err) {
    console.error("Failed to load decks:", err);
    statusLine("deck-status", `Failed to load decks: ${err.message}`);
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

async function fetchAndParseCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = (await res.text()).replace(/^\uFEFF/, ""); // strip BOM

  const table = parseCSV(text);

  // Optional: detect and drop a header row
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
      return { front: (word||"").trim(), back: (meaning||"").trim(), romaji: (romaji||"").trim() };
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
  currentIndex = 0;
  if (currentDeck.length === 0) {
    alert(`Deck "${name}" is empty or failed to load.`);
    return;
  }
  sessionBuf = { deckName: name, mode: "jp-en", correct: 0, wrong: 0, skipped: 0, total: 0, jpEnCorrect: 0, enJpCorrect: 0 };
  persistSession();
  showSection("mode-select");
}

/* =========================
   PRACTICE (MCQ)
   ========================= */
function startPractice(selectedMode) {
  mode = selectedMode;
  sessionBuf.mode = selectedMode;
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  shuffleArray(currentDeck);
  showSection("practice");
  updateScore();
  updateDeckProgress();
  showQuestion();
}
window.startPractice = startPractice;

function showQuestion() {
  const q = currentDeck[currentIndex];
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
  const options = [correct, ...distractors];
  return shuffleArray(options);
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
    sessionBuf.correct++;
    sessionBuf.total++;
    if (mode === 'jp-en') sessionBuf.jpEnCorrect++;
    else sessionBuf.enJpCorrect++;

    masteryMap[key] = (masteryMap[key] || 0) + 1;
    if (masteryMap[key] >= 5) {
      mistakes = mistakes.filter((m) => m.front !== wordObj.front || m.back !== wordObj.back);
    }
  } else {
    score.wrong++;
    sessionBuf.wrong++;
    sessionBuf.total++;
    masteryMap[key] = 0;
    mistakes.push(wordObj);
  }

  localStorage.setItem("mistakes", JSON.stringify(mistakes));
  localStorage.setItem("masteryMap", JSON.stringify(masteryMap));
  persistSession();
  updateScore();
  setTimeout(() => { nextQuestion(); updateDeckProgress(); }, 600);
}

function skipQuestion() {
  const wordObj = currentDeck[currentIndex];
  if (!wordObj) return;
  const key = wordObj.front + "|" + wordObj.back;

  score.skipped++;
  sessionBuf.skipped++;
  sessionBuf.total++;

  masteryMap[key] = 0;
  mistakes.push(wordObj);

  localStorage.setItem("mistakes", JSON.stringify(mistakes));
  localStorage.setItem("masteryMap", JSON.stringify(masteryMap));
  persistSession();
  updateScore();
  nextQuestion();
  updateDeckProgress();
}
window.skipQuestion = skipQuestion;

function nextQuestion() {
  currentIndex++;
  if (currentIndex >= currentDeck.length) {
    alert(`Finished! ✅ ${score.correct} ❌ ${score.wrong} ➖ ${score.skipped}\nSaving your progress…`);
    showSection("deck-select"); // autosave on section change
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
   LEARN MODE (Upgraded)
   ========================= */
function startLearnMode() {
  currentIndex = 0;
  if (!currentDeck.length) return alert("Pick a deck first!");
  renderLearnShell();     // ensure full card UI exists
  showSection("learn");
  showLearnCard();
}
window.startLearnMode = startLearnMode;

function renderLearnShell() {
  const host = $("learn-box");
  if (!host) return;
  host.innerHTML = `
    <div id="learn-card" class="card">
      <div id="learn-word" class="learn-word" style="font-size:26px;font-weight:700;"></div>
      <div id="learn-meaning" class="learn-meaning" style="font-size:18px;margin-top:6px;"></div>
      <div id="learn-romaji" class="learn-romaji muted hidden" style="margin-top:6px;"></div>
    </div>
    <div class="practice-actions" style="justify-content:space-between;">
      <div>
        <button id="btn-learn-romaji" onclick="toggleLearnRomaji()">👁 Show Romaji</button>
      </div>
      <div>
        <button id="btn-learn-prev" onclick="prevLearn()">⬅️ Previous</button>
        <button id="btn-learn-next" onclick="nextLearn()">➡️ Next</button>
      </div>
    </div>
  `;
}

function showLearnCard() {
  const word = currentDeck[currentIndex];
  if (!word) return;

  $("learn-word").textContent = word.front;
  $("learn-meaning").textContent = word.back;
  $("learn-romaji").textContent = word.romaji ? `Romaji: ${word.romaji}` : "Romaji: (none)";
  $("learn-romaji").classList.add("hidden");

  updateLearnNavButtons();
}

function updateLearnNavButtons() {
  const prevBtn = $("btn-learn-prev");
  const nextBtn = $("btn-learn-next");
  if (prevBtn) prevBtn.disabled = currentIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentIndex >= currentDeck.length - 1;
}

function toggleLearnRomaji() {
  const el = $("learn-romaji");
  if (!el) return;
  el.classList.toggle("hidden");
  const b = $("btn-learn-romaji");
  if (b) b.textContent = el.classList.contains("hidden") ? "👁 Show Romaji" : "🙈 Hide Romaji";
}
window.toggleLearnRomaji = toggleLearnRomaji;

function prevLearn() {
  if (currentIndex > 0) {
    currentIndex--;
    showLearnCard();
  }
}
window.prevLearn = prevLearn;

function nextLearn() {
  if (currentIndex < currentDeck.length - 1) {
    currentIndex++;
    showLearnCard();
  } else {
    alert("🎉 Finished learning this deck!");
    showSection("deck-select");
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
  showSection("practice");
  startPractice(mode);
}
window.startMistakePractice = startMistakePractice;

function clearMistakes() {
  if (confirm("Clear all mistake words?")) {
    mistakes = [];
    localStorage.setItem("mistakes", JSON.stringify([]));
    alert("Mistakes cleared.");
  }
}
window.clearMistakes = clearMistakes;

/* =========================
   GRAMMAR SECTION
   - Lists PDFs (from grammar_manifest.json or grammar/grammar_manifest.json)
   - Optionally adds "Practice Grammar" if grammar_practice/manifest.json exists
   ========================= */
async function loadGrammarSection() {
  await loadGrammarManifest();           // PDFs
  await loadGrammarPracticeManifest();   // optional practice
}

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

    const h3 = document.createElement("h3");
    h3.textContent = "Grammar PDFs";
    container.appendChild(h3);

    const wrap = document.createElement("div");
    list.forEach((file) => {
      const btn = document.createElement("button");
      btn.textContent = file.replace(".pdf", "");
      btn.onclick = () => window.open(`${base}${file}`, "_blank");
      wrap.appendChild(btn);
    });
    container.appendChild(wrap);

    statusLine("grammar-status", `Loaded ${list.length} grammar file(s).`);
  } catch (err) {
    console.error("Failed to load grammar manifest:", err);
    statusLine("grammar-status", `Failed to load grammar: ${err.message}`);
  }
}

/* ---------- Grammar Practice (optional) ---------- */
async function loadGrammarPracticeManifest() {
  // Try a few common paths; if none exist, show a friendly note.
  const tryJSON = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const t = await r.text();
    if (t.trim().startsWith("<")) throw new Error("HTML instead of JSON");
    return JSON.parse(t);
  };

  let manifest = null;
  let base = "";
  const candidates = [
    ["grammar_practice/manifest.json", "grammar_practice/"],
    ["grammar/practice_manifest.json", "grammar/"]
  ];

  for (const [m, b] of candidates) {
    try { manifest = await tryJSON(m); base = b; break; } catch {}
  }

  const host = ensureGrammarPracticeHost(); // adds heading + containers
  const listBox = $("gp-list");
  const box = $("gp-practice");

  if (!manifest || !Array.isArray(manifest) || manifest.length === 0) {
    if (listBox) listBox.innerHTML = `<div class="muted">No grammar practice sets found. (Add <code>grammar_practice/manifest.json</code> to enable.)</div>`;
    if (box) box.innerHTML = "";
    return;
  }

  // manifest is expected like: ["Set-01.csv", "Set-02.csv", ...]
  listBox.innerHTML = "";
  for (const file of manifest) {
    const btn = document.createElement("button");
    btn.textContent = file.replace(/\.csv$/i, "");
    btn.onclick = async () => {
      await loadGrammarSet(base + file, btn.textContent);
      startGrammarPractice(btn.textContent);
    };
    listBox.appendChild(btn);
  }
}

function ensureGrammarPracticeHost() {
  const container = $("grammar-list");
  if (!container) return null;

  // If not already injected, inject host
  if (!document.getElementById("gp-host")) {
    const h3 = document.createElement("h3");
    h3.textContent = "Practice Grammar";
    container.appendChild(h3);

    const host = document.createElement("div");
    host.id = "gp-host";
    host.innerHTML = `
      <div id="gp-list" style="margin-bottom:10px;"></div>
      <div id="gp-practice" class="card"></div>
    `;
    container.appendChild(host);
  }
  return $("gp-host");
}

async function loadGrammarSet(url, setName) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = (await res.text()).replace(/^\uFEFF/, "");
    const rows = parseCSV(text).filter(r => r.some(Boolean));

    // Support a few schemas:
    // 1) [front, back, romaji?, note?]
    // 2) [question, answer, note?]
    const out = rows.map(cols => {
      const [a="", b="", c="", d=""] = cols;
      let front = (a||"").trim();
      let back  = (b||"").trim();
      let romaji= (c||"").trim();
      let note  = (d||"").trim();

      // If it looks like Q/A only, keep romaji empty
      return { front, back, romaji, note };
    }).filter(x => x.front && x.back);

    grammarSets[setName] = out;
  } catch (e) {
    alert("Failed to load grammar set: " + (e?.message || e));
  }
}

function startGrammarPractice(setName) {
  grammarRun.setName = setName;
  grammarRun.index = 0;
  grammarRun.correct = 0;
  grammarRun.wrong = 0;
  grammarRun.reveal = false;
  renderGrammarPracticeCard();
}

function renderGrammarPracticeCard() {
  const items = grammarSets[grammarRun.setName] || [];
  const box = $("gp-practice");
  if (!box) return;

  if (items.length === 0) {
    box.innerHTML = `<div class="muted">No items in this grammar set.</div>`;
    return;
  }

  if (grammarRun.index >= items.length) {
    finishGrammarPractice();
    return;
  }

  const it = items[grammarRun.index];
  const showBack = grammarRun.reveal;

  box.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;">${grammarRun.setName}</div>
    <div style="font-size:20px;"><b>Q:</b> ${it.front}</div>
    <div style="margin:8px 0;${showBack?'':'display:none;'}"><b>A:</b> ${it.back}</div>
    ${it.romaji ? `<div class="muted" style="${showBack?'':'display:none;'}">Romaji: ${it.romaji}</div>` : ``}
    ${it.note ? `<div class="muted" style="${showBack?'':'display:none;'}">Note: ${it.note}</div>` : ``}

    <div class="practice-actions" style="justify-content:space-between;margin-top:10px;">
      <div>
        <button id="gp-show" ${showBack ? 'disabled' : ''} onclick="gpReveal()">👁 Show Answer</button>
      </div>
      <div>
        <button onclick="gpMark(false)" ${showBack ? '' : 'disabled'}>❌ I was wrong</button>
        <button onclick="gpMark(true)" ${showBack ? '' : 'disabled'}>✅ I was right</button>
      </div>
    </div>

    <div class="muted" style="margin-top:8px;">
      ${grammarRun.index + 1} / ${items.length}
    </div>
  `;
}

window.gpReveal = function () {
  grammarRun.reveal = true;
  renderGrammarPracticeCard();
};

window.gpMark = function (isRight) {
  if (isRight) grammarRun.correct++;
  else grammarRun.wrong++;
  grammarRun.index++;
  grammarRun.reveal = false;
  renderGrammarPracticeCard();
};

async function finishGrammarPractice() {
  const items = grammarSets[grammarRun.setName] || [];
  const box = $("gp-practice");
  if (!box) return;

  // Try to commit Grammar results if backend supports it
  (async () => {
    try {
      if (window.__fb_commitSession && grammarRun.correct + grammarRun.wrong > 0) {
        await window.__fb_commitSession({
          deckName: grammarRun.setName,
          mode: 'grammar',
          correct: grammarRun.correct,
          wrong: grammarRun.wrong,
          skipped: 0,
          total: grammarRun.correct + grammarRun.wrong,
          // jp/en increments are 0 for grammar; backend will just add attempt + score if desired
          jpEnCorrect: 0,
          enJpCorrect: 0
        });
      }
    } catch (e) {
      console.warn('[grammar commit] skipped:', e?.message || e);
    }
  })();

  box.innerHTML = `
    <div class="card">
      <div style="font-weight:700;margin-bottom:6px;">${grammarRun.setName} — Finished</div>
      <div>✅ Correct: <b>${grammarRun.correct}</b></div>
      <div>❌ Wrong: <b>${grammarRun.wrong}</b></div>
      <div>📦 Total: <b>${grammarRun.correct + grammarRun.wrong}</b></div>
      <div class="practice-actions" style="margin-top:10px;">
        <button onclick="startGrammarPractice('${grammarRun.setName}')">↻ Retry</button>
        <button onclick="showSection('grammar-section')">🏁 Back to Grammar</button>
      </div>
    </div>
  `;
}

/* =========================
   PROGRESS (via firebase.js)
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
      } else {
        lastBox.textContent = "No attempts yet.";
      }
    }

    if (prevBox) {
      if (prev) {
        prevBox.innerHTML = `
          <div><b>${prev.deckName}</b> (${prev.mode})</div>
          <div>✅ ${prev.correct || 0} | ❌ ${prev.wrong || 0} | ➖ ${prev.skipped || 0}</div>
          <div class="muted">${new Date(prev.createdAt).toLocaleString()}</div>
        `;
      } else {
        prevBox.textContent = "—";
      }
    }

    if (deltaBox) {
      if (last && prev) {
        const d = (last.correct || 0) - (prev.correct || 0);
        const cls = d >= 0 ? "delta-up" : "delta-down";
        const sign = d > 0 ? "+" : (d < 0 ? "" : "±");
        deltaBox.innerHTML = `<span class="${cls}">${sign}${d} correct vs previous (same deck)</span>`;
      } else if (last && !prev) {
        deltaBox.textContent = "No previous attempt for this deck.";
      } else {
        deltaBox.textContent = "—";
      }
    }
  } catch (e) {
    console.warn("renderProgress failed:", e);
  }
}
window.renderProgress = renderProgress;

/* =========================
   UTILITIES
   ========================= */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showRomaji() {
  const card = currentDeck[currentIndex];
  if (!card) return;
  const romaji = card.romaji || "(no romaji)";
  setText("extra-info", `Romaji: ${romaji}`);
}
window.showRomaji = showRomaji;

function showMeaning() {
  const card = currentDeck[currentIndex];
  if (!card) return;
  const correct = mode === "jp-en" ? card.back : card.front;
  setText("extra-info", `Meaning: ${correct}`);
}
window.showMeaning = showMeaning;

/* =========================
   NAVBAR ACTIONS
   ========================= */
window.saveCurrentScore = async function () {
  try {
    await autoCommitIfNeeded("manual save");
    alert('Progress saved ✅');
  } catch {
    // handled above
  }
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

    alert("✅ All progress erased. You are still signed in.");
    location.reload();
  } catch (e) {
    console.error("Full reset failed:", e);
    alert("Reset failed: " + (e?.message || e));
  } finally {
    if (btn) btn.disabled = false;
  }
};
