// script.js — FULL REWRITE
// Vocab decks (Learn + MCQ), Grammar PDFs, and Grammar Practice (typing answers)
// All Firebase interactions are bridged via functions exposed from firebase.js

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

/* =========================
   DOM HELPERS
   ========================= */
const $ = (id) => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.innerText = txt; };
function statusLine(id, msg) { const s = $(id); if (s) s.textContent = msg; console.log(`[status:${id}]`, msg); }
function persistSession() { localStorage.setItem("sessionBuf", JSON.stringify(sessionBuf)); }
function percent(n, d) { if (!d) return 0; return Math.floor((n / d) * 100); }

/* =========================
   APP LIFECYCLE
   ========================= */
window.onload = () => {
  loadDeckManifest();
  loadGrammarPDFManifest();
  ensureGrammarUI();
  loadGrammarPracticeManifest();
  renderProgress();
  updateScore();
};

// Called by firebase.js when auth is ready
window.__initAfterLogin = () => { renderProgress(); };

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
  if (target) target.classList.remove('hidden'); else console.warn('showSection: no element with id:', id);

  currentSectionId = id;
  if (id === "practice") updateDeckProgress();
}
window.showSection = showSection;

/* =========================
   AUTOSAVE BRIDGE
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
    // reset counters only
    Object.assign(sessionBuf, { correct:0, wrong:0, skipped:0, total:0, jpEnCorrect:0, enJpCorrect:0 });
    persistSession();
    await renderProgress();
  } catch (e) {
    console.warn("[autosave] failed → keeping local buffer:", e?.message || e);
  } finally { committing = false; }
}

/* =========================
   VOCAB DECKS (load + UI)
   ========================= */
async function loadDeckManifest() {
  try {
    statusLine("deck-status", "Loading decks…");
    const res = await fetch("vocab_decks/deck_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status} for vocab_decks/deck_manifest.json`);
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Manifest is HTML (check path/case)");

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
  const text = (await res.text()).replace(/^\uFEFF/, "");
  const table = parseCSV(text);
  const looksLikeHeader = (row) => {
    if (!row || row.length === 0) return false;
    const h = row.map(c => (c || "").trim().toLowerCase());
    const set = new Set(h);
    return set.has("front") || set.has("back") || set.has("romaji") || set.has("word") || set.has("meaning");
  };
  const rows = (table.length && looksLikeHeader(table[0]) ? table.slice(1) : table)
    .map(cols => { const [word = "", meaning = "", romaji = ""] = cols; return { front:(word||"").trim(), back:(meaning||"").trim(), romaji:(romaji||"").trim() }; })
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
  if (!currentDeck.length) { alert(`Deck "${name}" is empty or failed to load.`); return; }
  sessionBuf = { deckName: name, mode: "jp-en", correct:0, wrong:0, skipped:0, total:0, jpEnCorrect:0, enJpCorrect:0 };
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
  if (!optionsList) return; optionsList.innerHTML = "";
  options.forEach((opt) => { const li = document.createElement("li"); li.textContent = opt; li.onclick = () => checkAnswer(opt, answer, q); optionsList.appendChild(li); });
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
  options.forEach((li) => { if (li.textContent === correct) li.classList.add("correct"); else if (li.textContent === selected) li.classList.add("wrong"); });
  const key = wordObj.front + "|" + wordObj.back;
  if (selected === correct) {
    score.correct++; sessionBuf.correct++; sessionBuf.total++; if (mode==='jp-en') sessionBuf.jpEnCorrect++; else sessionBuf.enJpCorrect++;
    masteryMap[key] = (masteryMap[key] || 0) + 1; if (masteryMap[key] >= 5) { mistakes = mistakes.filter((m) => m.front !== wordObj.front || m.back !== wordObj.back); }
  } else {
    score.wrong++; sessionBuf.wrong++; sessionBuf.total++; masteryMap[key] = 0; mistakes.push(wordObj);
  }
  localStorage.setItem("mistakes", JSON.stringify(mistakes));
  localStorage.setItem("masteryMap", JSON.stringify(masteryMap));
  persistSession(); updateScore();
  setTimeout(() => { nextQuestion(); updateDeckProgress(); }, 600);
}

function skipQuestion() {
  const wordObj = currentDeck[currentIndex]; if (!wordObj) return;
  const key = wordObj.front + "|" + wordObj.back;
  score.skipped++; sessionBuf.skipped++; sessionBuf.total++; masteryMap[key] = 0; mistakes.push(wordObj);
  localStorage.setItem("mistakes", JSON.stringify(mistakes));
  localStorage.setItem("masteryMap", JSON.stringify(masteryMap));
  persistSession(); updateScore(); nextQuestion(); updateDeckProgress();
}
window.skipQuestion = skipQuestion;

function nextQuestion() { currentIndex++; if (currentIndex >= currentDeck.length) { alert(`Finished! ✅ ${score.correct} ❌ ${score.wrong} ➖ ${score.skipped}\nSaving your progress…`); showSection("deck-select"); } else { showQuestion(); } }

function updateScore() { setText("correct", String(score.correct)); setText("wrong", String(score.wrong)); setText("skipped", String(score.skipped)); }

/* =========================
   LEARN MODE (minimal)
   ========================= */
function startLearnMode() { currentIndex = 0; if (!currentDeck.length) return alert("Pick a deck first!"); showSection("learn"); showLearnCard(); }
window.startLearnMode = startLearnMode;
function showLearnCard() { const word = currentDeck[currentIndex]; if (!word) return; const jp = word.front; const en = word.back; const ro = word.romaji || ""; setText("learn-box", `${jp} – ${en} – ${ro}`); }
function nextLearn() { currentIndex++; if (currentIndex >= currentDeck.length) { alert("🎉 Finished learning this deck!"); showSection("deck-select"); } else { showLearnCard(); } }
window.nextLearn = nextLearn;

/* =========================
   MISTAKES
   ========================= */
function startMistakePractice() { if (mistakes.length === 0) return alert("No mistakes yet!"); currentDeck = mistakes.slice(); currentDeckName = "Mistakes"; currentIndex = 0; showSection("practice"); startPractice(mode); }
window.startMistakePractice = startMistakePractice;
function clearMistakes() { if (confirm("Clear all mistake words?")) { mistakes = []; localStorage.setItem("mistakes", JSON.stringify([])); alert("Mistakes cleared."); } }
window.clearMistakes = clearMistakes;

/* =========================
   GRAMMAR PDFs (list + open)
   ========================= */
async function loadGrammarPDFManifest() {
  try {
    statusLine("grammar-status", "Loading grammar lessons…");
    let base = "grammar/"; let list = null;
    const tryLoad = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); const t = await r.text(); if (t.trim().startsWith("<")) throw new Error("Got HTML instead of JSON"); return JSON.parse(t); };
    try { list = await tryLoad("grammar/grammar_manifest.json"); base = "grammar/"; } catch { list = await tryLoad("grammar_manifest.json"); base = ""; }
    const container = $("grammar-list"); if (!container) return; container.innerHTML = "";
    const h3 = document.createElement('h3'); h3.textContent = 'Grammar PDFs'; container.appendChild(h3);
    const wrap = document.createElement('div');
    list.forEach((file) => { const btn = document.createElement("button"); btn.textContent = file.replace(".pdf", ""); btn.onclick = () => window.open(`${base}${file}`, "_blank"); wrap.appendChild(btn); });
    container.appendChild(wrap);
    statusLine("grammar-status", `Loaded ${list.length} grammar file(s).`);
  } catch (err) { console.error("Failed to load grammar manifest:", err); statusLine("grammar-status", `Failed to load grammar: ${err.message}`); }
}

/* =========================
   GRAMMAR PRACTICE (Typing answers)
   - Manifest: /grammar_practice/manifest.json
   - CSV per set: /grammar_practice/<SetName>.csv (question,answer[,romaji][,note])
   - Requirements: random order; flashcard; input + Submit; Show Answer; mismatch in red; Next (no auto-advance)
   ========================= */
const grammarState = {
  manifest: [],              // filenames from manifest.json
  setId: "",
  items: [],                 // [{q,a,romaji?,note?}]
  order: [],                 // shuffled indices
  idx: 0,                    // pointer into order[]
  correct: 0,
  wrong: 0,
  submitted: false,
  revealed: false,
  userAnswer: ""
};

function ensureGrammarUI(){
  const host = $("grammar-section"); if (!host) return;
  if (host.__gpBuilt) return; // idempotent

  // Append Practice Sets container under existing PDFs list
  const practiceHead = document.createElement('h3'); practiceHead.style.marginTop = '16px'; practiceHead.textContent = 'Practice Sets';
  const practiceDesc = document.createElement('p'); practiceDesc.className = 'muted'; practiceDesc.style.margin = '6px 0'; practiceDesc.textContent = 'Choose a set to practice. Questions will appear as flashcards with a typing box.';
  const setButtons = document.createElement('div'); setButtons.id = 'g-set-buttons'; setButtons.style.display = 'flex'; setButtons.style.flexWrap = 'wrap'; setButtons.style.gap = '8px';

  const practiceWrap = document.createElement('div'); practiceWrap.id = 'grammar-practice'; practiceWrap.className = 'hidden';
  practiceWrap.innerHTML = `
    <div class="deck-progress" style="margin-top:8px">
      <div class="deck-progress-bar" id="g-progress-bar"></div>
      <div class="deck-progress-text" id="g-progress-text">0 / 0 (0%)</div>
    </div>
    <div id="g-controls" style="margin:6px 0 10px">
      <button id="g-back">⏮ Back to Sets</button>
      <span class="muted" id="g-setname" style="margin-left:8px"></span>
    </div>
    <div id="g-card" class="card" style="min-height:90px;display:flex;align-items:center;justify-content:center;font-size:20px;text-align:center"></div>
    <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
      <input id="g-input" class="answer-input" placeholder="Type your answer…" autocomplete="off" style="flex:1; min-width:220px; padding:10px 12px; border:1px solid var(--border); border-radius:10px; font-size:16px;" />
      <button id="g-submit">Submit</button>
      <button id="g-show">👁 Show Answer</button>
      <button id="g-next" disabled>Next ▶</button>
    </div>
    <div id="g-feedback" style="margin-top:10px;font-size:16px"></div>
  `;

  const listContainer = $("grammar-list");
  if (listContainer) {
    listContainer.appendChild(practiceHead);
    listContainer.appendChild(practiceDesc);
    listContainer.appendChild(setButtons);
    listContainer.appendChild(practiceWrap);
  }

  // Wire buttons
  practiceWrap.querySelector('#g-back').onclick = () => gpBackToSets();
  practiceWrap.querySelector('#g-submit').onclick = () => gpSubmit();
  practiceWrap.querySelector('#g-show').onclick = () => gpReveal();
  practiceWrap.querySelector('#g-next').onclick = () => gpNext();

  host.__gpBuilt = true;
}

async function loadGrammarPracticeManifest(){
  const btnWrap = document.getElementById('g-set-buttons');
  if (!btnWrap) return;
  let arr = [];
  try {
    const r = await fetch('/grammar_practice/manifest.json');
    if (!r.ok) throw new Error(`HTTP ${r.status} for /grammar_practice/manifest.json`);
    const t = await r.text();
    if (t.trim().startsWith('<')) throw new Error('Got HTML instead of JSON');
    const parsed = JSON.parse(t);
    arr = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('No grammar practice manifest found:', e?.message||e);
    btnWrap.innerHTML = '<div class="muted">No practice sets found. Add <code>/grammar_practice/manifest.json</code>.</div>';
    return;
  }
  grammarState.manifest = arr;
  btnWrap.innerHTML = '';
  arr.forEach(entry => {
    const name = String(entry).replace(/\.csv$/i,'');
    const b = document.createElement('button'); b.textContent = name; b.onclick = () => gpStartSet(name);
    btnWrap.appendChild(b);
  });
}

async function gpStartSet(setId){
  const listBox = document.getElementById('g-set-buttons');
  const wrap = document.getElementById('grammar-practice');
  if (listBox) listBox.classList.add('hidden');
  if (wrap) wrap.classList.remove('hidden');

  grammarState.setId = setId;
  grammarState.items = await loadGrammarQuestions(setId);
  grammarState.order = Array.from({length: grammarState.items.length}, (_, i) => i);
  shuffleArray(grammarState.order);
  grammarState.idx = 0; grammarState.correct = 0; grammarState.wrong = 0; grammarState.submitted = false; grammarState.revealed = false; grammarState.userAnswer = '';

  const name = $("g-setname"); if (name) name.textContent = `Set: ${setId}`;
  gpRenderStep();
}

async function loadGrammarQuestions(setId){
  const csvUrl = `/grammar_practice/${setId}.csv`;
  const r = await fetch(csvUrl);
  if (!r.ok) throw new Error(`Missing CSV for set ${setId} at ${csvUrl}`);
  const txt = (await r.text()).replace(/^\uFEFF/, "");
  const rows = parseCSV(txt);
  const hasHeader = rows.length>0 && rows[0].length>=2 && /question|answer/i.test((rows[0][0]||'')+(rows[0][1]||''));
  return (hasHeader ? rows.slice(1) : rows)
    .map(r => ({ q:(r[0]||'').trim(), a:(r[1]||'').trim(), romaji:(r[2]||'').trim(), note:(r[3]||'').trim() }))
    .filter(x => x.q && x.a);
}

function gpRenderStep(){
  const total = grammarState.order.length;
  const done = Math.min(grammarState.idx, total);
  const p = percent(done, total);
  const bar = $("g-progress-bar"); if (bar) bar.style.width = `${p}%`;
  setText('g-progress-text', `${done} / ${total} (${p}%)`);

  const idx = grammarState.order[grammarState.idx];
  const qa = grammarState.items[idx];
  if (!qa) { return gpFinishSet(); }

  const card = $("g-card"); if (card) card.textContent = qa.q;
  const input = $("g-input"); if (input){ input.value = ''; input.focus(); input.onkeydown = (e)=>{ if(e.key==='Enter') gpSubmit(); }; }
  const fb = $("g-feedback"); if (fb) fb.innerHTML = '';

  const nextBtn = $("g-next"); if (nextBtn) nextBtn.disabled = true;
  grammarState.submitted = false; grammarState.revealed = false; grammarState.userAnswer = '';
}

function gpSubmit(){
  if (grammarState.submitted || grammarState.revealed) return;
  const idx = grammarState.order[grammarState.idx];
  const qa = grammarState.items[idx]; if (!qa) return;
  const input = $("g-input"); const guess = (input?.value||'').trim(); const correct = qa.a.trim();
  grammarState.userAnswer = guess; grammarState.submitted = true;
  const isRight = normalizeAnswer(guess) === normalizeAnswer(correct);
  if (isRight) grammarState.correct++; else grammarState.wrong++;
  const fb = $("g-feedback"); if (!fb) return;
  const diffHTML = diffMarkup(guess, correct);
  fb.innerHTML = isRight
    ? `<div class="card" style="border-color:#c7f9cc;background:#ecfdf5"><b>✅ Correct!</b><div style="margin-top:6px">Answer: ${escapeHTML(correct)}</div></div>`
    : `<div class="card" style="border-color:#fecaca;background:#fff1f2"><b>❌ Not quite.</b><div style="margin-top:6px">Your answer vs correct:</div><div style="margin-top:6px">${diffHTML}</div></div>`;
  const nextBtn = $("g-next"); if (nextBtn) nextBtn.disabled = false;
}

function gpReveal(){
  if (grammarState.revealed) return;
  grammarState.revealed = true;
  const idx = grammarState.order[grammarState.idx];
  const qa = grammarState.items[idx]; if (!qa) return;
  const fb = $("g-feedback"); if (fb) fb.innerHTML = `<div class="card"><b>Answer:</b> ${escapeHTML(qa.a)}</div>`;
  const nextBtn = $("g-next"); if (nextBtn) nextBtn.disabled = false;
}

function gpNext(){
  grammarState.idx++;
  const total = grammarState.order.length;
  if (grammarState.idx >= total){ gpFinishSet(); } else { gpRenderStep(); }
}

function gpBackToSets(){
  const listBox = document.getElementById('g-set-buttons'); if (listBox) listBox.classList.remove('hidden');
  const wrap = document.getElementById('grammar-practice'); if (wrap) wrap.classList.add('hidden');
  const bar = $("g-progress-bar"); if (bar) bar.style.width = '0%'; setText('g-progress-text','0 / 0 (0%)');
}

async function gpFinishSet(){
  const total = grammarState.order.length;
  alert(`Finished ${grammarState.setId}!\n✅ ${grammarState.correct} ❌ ${grammarState.wrong} / ${total}`);
  // Best-effort: commit as a 'grammar' attempt (jp/en counters = 0)
  try {
    if (window.__fb_commitSession && (grammarState.correct + grammarState.wrong) > 0) {
      await window.__fb_commitSession({
        deckName: grammarState.setId,
        mode: 'grammar',
        correct: grammarState.correct,
        wrong: grammarState.wrong,
        skipped: 0,
        total: grammarState.correct + grammarState.wrong,
        jpEnCorrect: 0,
        enJpCorrect: 0
      });
    }
  } catch (e) { console.warn('[grammar commit] skipped:', e?.message||e); }
  gpBackToSets();
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
        `; tbody.appendChild(tr);
      });
    }
    const last = attempts[0]; let prev = null; if (last) { prev = attempts.find(a => a.deckName === last.deckName && a.createdAt < last.createdAt) || null; }
    const lastBox = $("progress-last"), prevBox = $("progress-prev"), deltaBox = $("progress-delta");
    if (lastBox) last ? lastBox.innerHTML = `<div><b>${last.deckName}</b> (${last.mode})</div><div>✅ ${last.correct||0} | ❌ ${last.wrong||0} | ➖ ${last.skipped||0}</div><div class="muted">${new Date(last.createdAt).toLocaleString()}</div>` : lastBox.textContent = 'No attempts yet.';
    if (prevBox) prev ? prevBox.innerHTML = `<div><b>${prev.deckName}</b> (${prev.mode})</div><div>✅ ${prev.correct||0} | ❌ ${prev.wrong||0} | ➖ ${prev.skipped||0}</div><div class="muted">${new Date(prev.createdAt).toLocaleString()}</div>` : prevBox.textContent = '—';
    if (deltaBox) {
      if (last && prev) { const d = (last.correct||0) - (prev.correct||0); const cls = d >= 0 ? 'delta-up':'delta-down'; const sign = d > 0 ? '+' : (d < 0 ? '' : '±'); deltaBox.innerHTML = `<span class="${cls}">${sign}${d} correct vs previous (same deck)</span>`; }
      else if (last && !prev) deltaBox.textContent = 'No previous attempt for this deck.'; else deltaBox.textContent = '—';
    }
  } catch (e) { console.warn("renderProgress failed:", e); }
}
window.renderProgress = renderProgress;

/* =========================
   UTILITIES
   ========================= */
function shuffleArray(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function showRomaji() { const card = currentDeck[currentIndex]; if (!card) return; const romaji = card.romaji || "(no romaji)"; setText("extra-info", `Romaji: ${romaji}`); } window.showRomaji = showRomaji;
function showMeaning() { const card = currentDeck[currentIndex]; if (!card) return; const correct = mode === "jp-en" ? card.back : card.front; setText("extra-info", `Meaning: ${correct}`); } window.showMeaning = showMeaning;

function normalizeAnswer(s){ return String(s).trim().toLowerCase().replace(/\s+/g,' '); }
function escapeHTML(s){ return String(s).replace(/[&<>"']/g, (m)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
// Character-level diff: show mismatches in red (user vs correct)
function diffMarkup(user, correct){
  const a = [...String(user)], b = [...String(correct)];
  const n=a.length, m=b.length; const dp = Array.from({length:n+1},()=>Array(m+1).fill(0));
  for (let i=1;i<=n;i++){ for (let j=1;j<=m;j++){ dp[i][j] = (a[i-1]===b[j-1]) ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]); } }
  let i=n, j=m; const seq=[]; while(i>0 && j>0){ if(a[i-1]===b[j-1]){ seq.push({ch:a[i-1],ok:true}); i--; j--; } else if (dp[i-1][j]>=dp[i][j-1]){ seq.push({ch:a[i-1],ok:false,side:'user'}); i--; } else { seq.push({ch:b[j-1],ok:false,side:'correct'}); j--; } }
  while(i>0){ seq.push({ch:a[i-1],ok:false,side:'user'}); i--; } while(j>0){ seq.push({ch:b[j-1],ok:false,side:'correct'}); j--; } seq.reverse();
  let uOut='', cOut=''; for (const t of seq){ if (t.ok){ uOut += escapeHTML(t.ch); cOut += escapeHTML(t.ch); } else if (t.side==='user'){ uOut += `<span style="color:#dc2626;text-decoration:underline">${escapeHTML(t.ch)}</span>`; } else { cOut += `<span style="color:#dc2626;text-decoration:underline">${escapeHTML(t.ch)}</span>`; } }
  return `<div style="display:grid;gap:6px"><div><b>Your answer:</b> ${uOut || '<i>(empty)</i>'}</div><div><b>Correct:</b> ${cOut}</div></div>`;
}

/* =========================
   NAVBAR ACTIONS
   ========================= */
window.saveCurrentScore = async function () { try { await autoCommitIfNeeded("manual save"); alert('Progress saved ✅'); } catch {} };
window.resetSite = async function () {
  const sure = confirm("⚠️ This will erase ALL your progress (attempts, daily aggregates, leaderboard rows, tasks) from the database. Your sign‑in will remain.\n\nProceed?");
  if (!sure) return; const btn = event?.target; if (btn) btn.disabled = true;
  try {
    if (!window.__fb_fullReset) throw new Error("__fb_fullReset is not available.");
    await window.__fb_fullReset();
    localStorage.removeItem("mistakes"); localStorage.removeItem("masteryMap"); localStorage.removeItem("sessionBuf"); localStorage.removeItem("pendingSession");
    alert("✅ All progress erased. You are still signed in."); location.reload();
  } catch (e) { console.error("Full reset failed:", e); alert("Reset failed: " + (e?.message || e)); }
  finally { if (btn) btn.disabled = false; }
};
