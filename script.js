// script.js — decks loader + quiz UI + grammar practice + progress UI
// NOTE: All Firebase access is delegated to firebase.js helpers on window.*
// This file contains NO direct Firebase imports.

// ---------------- State ----------------
let allDecks = {};                // { deckName: [{front, back, romaji}] }
let currentDeck = [];
let currentDeckName = "";
let currentIndex = 0;
let mode = "jp-en";
let score = { correct: 0, wrong: 0, skipped: 0 };

let mistakes = JSON.parse(localStorage.getItem("mistakes") || "[]");
let masteryMap = JSON.parse(localStorage.getItem("masteryMap") || "{}");

// ---- Audio (Learn Mode) ----
const AUDIO_BASE = "audio";            // no leading slash (keeps it relative on GitHub Pages)
let audioManifest = [];                // ["Vocab-Lesson-01", ..., "kanji"]
let audioFolders = new Set();          // quick lookup
let currentAudioFolder = null;         // resolved per selected deck
let audioManifestLoaded = false;

// Session buffer (temporary storage; committed on demand/auto via firebase.js)
let sessionBuf = JSON.parse(localStorage.getItem("sessionBuf") || "null") || {
  deckName: "",
  mode: "jp-en",      // 'jp-en' | 'en-jp' | 'grammar'
  correct: 0,
  wrong: 0,
  skipped: 0,
  total: 0,
  jpEnCorrect: 0,
  enJpCorrect: 0,
  grammarCorrect: 0   // NEW: counted for grammar typing
};

let currentSectionId = "deck-select";
let committing = false;

// Practice Grammar state
const pgState = {
  files: [],          // ['lesson-01.csv', ...]
  setName: "",        // active set file name (no path)
  items: [],          // [{q, a}, ...]
  order: [],          // shuffled indices
  i: 0,               // pointer into order
  correct: 0,
  wrong: 0,
  answered: false     // prevent resubmission until Next
};

// ---------------- DOM helpers ----------------
const $ = (id) => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.innerText = txt; };
function statusLine(id, msg) {
  const s = $(id);
  if (s) s.textContent = msg;
  console.log(`[status:${id}]`, msg);
}
function persistSession() {
  localStorage.setItem("sessionBuf", JSON.stringify(sessionBuf));
}

async function loadAudioManifest() {
  try {
    const res = await fetch(`${AUDIO_BASE}/manifest.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    audioManifest = await res.json();
    audioFolders = new Set(audioManifest);
    audioManifestLoaded = true;
    console.log("[audio] manifest loaded:", audioManifest);
  } catch (e) {
    audioManifestLoaded = false;
    console.warn("[audio] manifest failed to load → audio disabled:", e?.message || e);
  }
}

function percent(n, d) {
  if (!d) return 0;
  return Math.floor((n / d) * 100);
}

// ---------------- Deck progress UI ----------------
function updateDeckProgress() {
  const totalQs = currentDeck.length || 0;
  const done = Math.min(currentIndex, totalQs);
  const p = percent(done, totalQs);
  const bar = $("deck-progress-bar");
  const txt = $("deck-progress-text");
  if (bar) bar.style.width = `${p}%`;
  if (txt) txt.textContent = `${done} / ${totalQs} (${p}%)`;
}

// ---------------- Autosave bridge ----------------
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
      enJpCorrect: sessionBuf.enJpCorrect,
      grammarCorrect: sessionBuf.grammarCorrect || 0
    };
    await window.__fb_commitSession(payload);

    sessionBuf.correct = 0;
    sessionBuf.wrong = 0;
    sessionBuf.skipped = 0;
    sessionBuf.total = 0;
    sessionBuf.jpEnCorrect = 0;
    sessionBuf.enJpCorrect = 0;
    sessionBuf.grammarCorrect = 0;
    persistSession();

    await renderProgress();
    console.log("[autosave] saved ✔");
  } catch (e) {
    console.warn("[autosave] failed → keeping local buffer:", e?.message || e);
  } finally {
    committing = false;
  }
}

// ---------------- App lifecycle ----------------
window.onload = () => {
  loadAudioManifest();
  loadDeckManifest();
  loadGrammarManifest();      // PDF lessons list
  loadGrammarPracticeManifest(); // Practice grammar sets
  renderProgress();
  updateScore();
};

window.__initAfterLogin = () => {
  renderProgress();
};

window.addEventListener('pagehide', () => {
  try {
    if (sessionBuf.total > 0) {
      localStorage.setItem('pendingSession', JSON.stringify(sessionBuf));
    }
  } catch {}
});
window.addEventListener('beforeunload', () => {
  try {
    if (sessionBuf.total > 0) {
      localStorage.setItem('pendingSession', JSON.stringify(sessionBuf));
    }
  } catch {}
});

// ---------------- Section Router ----------------
function showSection(id) {
  if (currentSectionId === "practice" && id !== "practice") {
    autoCommitIfNeeded("leaving vocab practice");
  }
  if (currentSectionId === "practice-grammar" && id !== "practice-grammar") {
    autoCommitIfNeeded("leaving grammar practice");
    // ensure set list is visible when leaving
    const filesBox = $("pg-file-buttons");
    if (filesBox) filesBox.classList.remove('hidden');
    const area = $("pg-area");
    if (area) area.classList.add('hidden');
  }

  document.querySelectorAll('.main-content main > section').forEach(sec => {
    sec.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
  else console.warn('showSection: no element with id:', id);

  currentSectionId = id;

  if (id === "practice") updateDeckProgress();
  if (id === "practice-grammar") pgUpdateProgress();
}
window.showSection = showSection;

// ---------------- DECKS (Vocab) ----------------
async function loadDeckManifest() {
  try {
    statusLine("deck-status", "Loading decks…");
    // UPDATED PATH per new file structure
    const res = await fetch("vocab_decks/deck_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status} for vocab_decks/deck_manifest.json`);
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Manifest is HTML (check path/case for vocab_decks/manifest.json)");

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
    return (
      set.has("front") || set.has("back") || set.has("romaji") ||
      set.has("word")  || set.has("meaning") || set.has("question") || set.has("answer")
    );
  };

  const rows = (table.length && looksLikeHeader(table[0]) ? table.slice(1) : table)
    .map(cols => {
      const [word = "", meaning = "", romaji = ""] = cols;
      return {
        front:  (word    || "").trim(),
        back:   (meaning || "").trim(),
        romaji: (romaji  || "").trim(),
      };
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

  // Resolve audio folder from deck name
  currentAudioFolder = resolveAudioFolder(name);
  if (audioManifestLoaded && currentAudioFolder && !audioFolders.has(currentAudioFolder)) {
    // Folder not present in manifest → disable audio for this deck
    currentAudioFolder = null;
  }

  sessionBuf = {
    deckName: name,
    mode: "jp-en",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0,
    grammarCorrect: 0
  };
  persistSession();
  showSection("mode-select");
}

// Map "Lesson-01" → "Vocab-Lesson-01"; "kanji" → "kanji"; otherwise pass through.
function resolveAudioFolder(deckName) {
  // e.g., "Lesson-01"
  const m = /^Lesson-(\d{2})$/i.exec(deckName);
  if (m) return `Vocab-Lesson-${m[1]}`;
  // special case
  if (/^kanji$/i.test(deckName)) return "kanji";
  // fallback: exact same name (in case future decks match manifest directly)
  return deckName;
}


// ---------------- PRACTICE (Vocab MCQ) ----------------
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

  const qb = $("question-box");
  if (qb) qb.className = "flashcard";
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
      mistakes = mistakes.filter(
        (m) => m.front !== wordObj.front || m.back !== wordObj.back
      );
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
  setTimeout(() => {
    nextQuestion();
    updateDeckProgress();
  }, 600);
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

// ---------------- LEARN mode (Flashcard + Prev/Next + Show Romaji) ----------------
function startLearnMode() {
  currentIndex = 0;
  if (!currentDeck.length) return alert("Pick a deck first!");
  showSection("learn");
  showLearnCard();
}
window.startLearnMode = startLearnMode;

function showLearnCard() {
  const word = currentDeck[currentIndex];
  if (!word) return;

  const box = $("learn-box");
  if (box) {
    const audioEnabled = !!(audioManifestLoaded && currentAudioFolder);
    const disabledAttr = audioEnabled ? "" : "disabled title='Audio not available for this deck'";
    const aria = `aria-label="Play pronunciation"`;
    const kb = `onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); playLearnAudio();}"`;
    
    // Show word + meaning inside the flashcard (meaning always shown by default)
    box.className = "flashcard";
    box.innerHTML = `
      <div class="learn-word-row">
        <div class="learn-word">${word.front || "—"}</div>
        <button class="icon-btn" ${aria} ${kb} onclick="playLearnAudio()" ${disabledAttr}>🔊</button>
      </div>
      <div class="learn-meaning muted">Meaning: ${word.back || "(no meaning)"} </div>
    `;
  }

  // Clear romaji line under the card
  const extra = $("learn-extra");
  if (extra) extra.textContent = "";
}

function nextLearn() {
  if (!currentDeck.length) return;
  currentIndex = Math.min(currentIndex + 1, currentDeck.length - 1);
  showLearnCard();
}
window.nextLearn = nextLearn;

function prevLearn() {
  if (!currentDeck.length) return;
  currentIndex = Math.max(currentIndex - 1, 0);
  showLearnCard();
}
window.prevLearn = prevLearn;

function showLearnRomaji() {
  const word = currentDeck[currentIndex];
  if (!word) return;
  const extra = $("learn-extra");
  if (extra) extra.textContent = `Romaji: ${word.romaji || "(no romaji)"}`;
}
window.showLearnRomaji = showLearnRomaji;

// ---------------- MISTAKES ----------------
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

// ---------------- GRAMMAR (PDF links) ----------------
async function loadGrammarManifest() {
  try {
    statusLine("grammar-status", "Loading grammar lessons…");

    // UPDATED PATH per new file structure
    const r = await fetch("grammar/grammar_manifest.json");
    if (!r.ok) throw new Error(`HTTP ${r.status} for grammar/grammar_manifest.json`);
    const t = await r.text();
    if (t.trim().startsWith("<")) throw new Error("Got HTML instead of JSON");
    const list = JSON.parse(t);

    const container = $("grammar-list");
    if (!container) return;
    container.innerHTML = "";

    list.forEach((file) => {
      const btn = document.createElement("button");
      btn.textContent = file.replace(".pdf", "");
      btn.onclick = () => window.open(`grammar/${file}`, "_blank");
      container.appendChild(btn);
    });

    statusLine("grammar-status", `Loaded ${list.length} grammar file(s).`);
  } catch (err) {
    console.error("Failed to load grammar manifest:", err);
    statusLine("grammar-status", `Failed to load grammar: ${err.message}`);
  }
}

// ---------------- PRACTICE GRAMMAR (type the answer) ----------------
async function loadGrammarPracticeManifest() {
  const statusId = "pg-status";
  try {
    const statusEl = $(statusId);
    if (statusEl) statusEl.textContent = "Loading practice grammar sets…";
    const res = await fetch("practice-grammar/manifest.csv");
    if (!res.ok) throw new Error(`HTTP ${res.status} for practice-grammar/manifest.csv`);
    const text = (await res.text()).replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    pgState.files = lines;

    const container = $("pg-file-buttons");
    if (container) {
      container.innerHTML = "";
      lines.forEach(file => {
        const btn = document.createElement("button");
        btn.textContent = file.replace(/\.csv$/i, "");
        btn.onclick = () => pgStartSet(file);
        container.appendChild(btn);
      });
    }

    if (statusEl) statusEl.textContent = `Loaded ${lines.length} set(s). Choose one to start.`;
  } catch (err) {
    console.warn("Practice grammar manifest failed:", err);
    const statusEl = $(statusId);
    if (statusEl) statusEl.textContent = `Failed to load practice sets: ${err.message}`;
  }
}

async function pgStartSet(fileName) {
  try {
    const statusEl = $("pg-status");
    if (statusEl) statusEl.textContent = `Loading ${fileName}…`;

    const res = await fetch(`practice-grammar/${fileName}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for practice-grammar/${fileName}`);
    const text = (await res.text()).replace(/^\uFEFF/, "");

    const rows = parseCSV(text)
      .map(cols => ({ q: (cols[0] || "").trim(), a: (cols[1] || "").trim() }))
      .filter(x => x.q && x.a);
    if (!rows.length) throw new Error("No valid Q/A rows found.");

    pgState.setName = fileName;
    pgState.items = rows;
    pgState.order = shuffleArray([...rows.keys()]);
    pgState.i = 0;
    pgState.correct = 0;
    pgState.wrong = 0;
    pgState.answered = false;

    sessionBuf.deckName = `Grammar: ${fileName.replace(/\.csv$/i, "")}`;
    sessionBuf.mode = "grammar";
    persistSession();

    // Hide set buttons like Vocab section behavior
    const filesBox = $("pg-file-buttons");
    if (filesBox) filesBox.classList.add('hidden');

    // Show practice area
    const area = $("pg-area");
    if (area) area.classList.remove("hidden");

    pgRender();
    pgUpdateProgress();

    if (statusEl) statusEl.textContent = `Loaded ${rows.length} questions.`;
    showSection("practice-grammar");
  } catch (e) {
    alert("Failed to start set: " + (e?.message || e));
  }
}

function pgRender() {
  const idx = pgState.order[pgState.i];
  const item = pgState.items[idx];
  const card = $("pg-card");
  if (card) {
    card.className = "flashcard";
    card.textContent = item ? item.q : "(finished)";
  }
  const input = $("pg-input");
  if (input) {
    input.value = "";
    input.disabled = false;
    input.focus();
  }
  const submitBtn = $("pg-submit");
  if (submitBtn) submitBtn.disabled = false;

  const fb = $("pg-feedback");
  if (fb) fb.innerHTML = "";

  pgState.answered = false;
}

function pgUpdateProgress() {
  const total = pgState.items.length || 0;
  const done = Math.min(pgState.i, total);
  const p = percent(done, total);
  const bar = $("pg-progress-bar");
  const txt = $("pg-progress-text");
  if (bar) bar.style.width = `${p}%`;
  if (txt) txt.textContent = `${done} / ${total} (${p}%)`;
}

function normalizeAnswer(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[。、，,。!！?？;；:：]/g, "")
    .trim();
}

function highlightDiff(userRaw, correctRaw) {
  // Work at Unicode codepoint level
  const uArr = [...(userRaw || "")];
  const cArr = [...(correctRaw || "")];
  let i = 0, j = 0;
  let out = "";

  const esc = (s) => (s || "").replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  while (i < uArr.length || j < cArr.length) {
    const uc = uArr[i];
    const cc = cArr[j];

    // match
    if (i < uArr.length && j < cArr.length && uc === cc) {
      out += esc(uc);
      i++; j++;
      continue;
    }

    // lookahead to decide: extra typed vs missing char
    const uNextMatches = (i + 1 < uArr.length) && (uArr[i + 1] === cc);
    const cNextMatches = (j + 1 < cArr.length) && (cArr[j + 1] === uc);

    // user typed an extra char not in this position → show that char in red
    if (i < uArr.length && (j >= cArr.length || uNextMatches)) {
      out += `<span class="diff-wrong">${esc(uc)}</span>`;
      i++;
      continue;
    }

    // user is missing a char from the correct answer → insert that char in red
    if (j < cArr.length && (i >= uArr.length || cNextMatches)) {
      out += `<span class="diff-wrong">${esc(cc)}</span>`;
      j++;
      continue;
    }

    // substitution (both differ) → mark the user's char red, advance both
    if (i < uArr.length && j < cArr.length) {
      out += `<span class="diff-wrong">${esc(uc)}</span>`;
      i++; j++;
      continue;
    }

    // leftovers
    if (i < uArr.length) {
      out += `<span class="diff-wrong">${esc(uArr[i++])}</span>`;
    } else if (j < cArr.length) {
      out += `<span class="diff-wrong">${esc(cArr[j++])}</span>`;
    }
  }
  return out;
}


function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
}

function pgSubmit() {
  const idx = pgState.order[pgState.i];
  const item = pgState.items[idx];
  if (!item || pgState.answered) return;

  const input = $("pg-input");
  const fb = $("pg-feedback");
  const userAnsRaw = input ? input.value : "";

  const ok = normalizeAnswer(userAnsRaw) === normalizeAnswer(item.a);

  // Show correct answer always, plus mismatch view
  if (fb) {
    const userDiffHtml = highlightDiff(userAnsRaw, item.a);
    fb.innerHTML = ok
      ? `✅ Correct!<br><b>Answer:</b> ${escapeHtml(item.a)}<br><b>Your answer:</b> ${escapeHtml(userAnsRaw)}`
      : `❌ Wrong.<br><b>Answer:</b> ${escapeHtml(item.a)}<br><b>Your answer:</b> ${userDiffHtml}`;
  }

  if (ok) {
    pgState.correct++;
    sessionBuf.correct++;
    sessionBuf.total++;
    sessionBuf.grammarCorrect = (sessionBuf.grammarCorrect || 0) + 1;
  } else {
    pgState.wrong++;
    sessionBuf.wrong++;
    sessionBuf.total++;
  }
  persistSession();

  // Lock input until Next is clicked; question won't auto-advance
  if (input) input.disabled = true;
  const submitBtn = $("pg-submit");
  if (submitBtn) submitBtn.disabled = true;
  pgState.answered = true;
}
window.pgSubmit = pgSubmit;

function pgShowAnswer() {
  const idx = pgState.order[pgState.i];
  const item = pgState.items[idx];
  const fb = $("pg-feedback");
  if (fb && item) fb.innerHTML = `💡 Answer: ${escapeHtml(item.a)}`;
}
window.pgShowAnswer = pgShowAnswer;

function pgNext() {
  // re-enable input for next question
  const input = $("pg-input");
  if (input) { input.disabled = false; }
  const submitBtn = $("pg-submit");
  if (submitBtn) submitBtn.disabled = false;

  pgState.i++;
  pgUpdateProgress();
  if (pgState.i >= pgState.items.length) {
    alert(`Finished! ✅ ${pgState.correct} ❌ ${pgState.wrong}\nSaving your progress…`);
    autoCommitIfNeeded("finish grammar set");

    // Hide practice area, show files list again
    const area = $("pg-area");
    if (area) area.classList.add("hidden");
    const filesBox = $("pg-file-buttons");
    if (filesBox) filesBox.classList.remove('hidden');

    showSection("practice-grammar");
  } else {
    pgRender();
  }
}
window.pgNext = pgNext;

// ---------------- PROGRESS (reads via firebase.js) ----------------
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

// ---------------- Utilities ----------------
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

function pad2(n){ return String(n).padStart(2, '0'); }

function ensureAudioElement() {
  let a = document.getElementById("__learn_audio");
  if (!a) {
    a = document.createElement("audio");
    a.id = "__learn_audio";
    a.preload = "auto";
    document.body.appendChild(a);
  }
  return a;
}

function showToast(msg, ms = 2200) {
  let t = document.getElementById("__toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "__toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), ms);
}

window.playLearnAudio = function () {
  const word = currentDeck[currentIndex];
  if (!word) return;

  if (!audioManifestLoaded || !currentAudioFolder) {
    showToast("Audio not available for this word.");
    return;
  }

  const nn = pad2(currentIndex + 1); // 1-based index in learn sequence
  const fileName = `${nn}_${word.front}.mp3`;
  const url = `${AUDIO_BASE}/${currentAudioFolder}/${fileName}`;

  const audio = ensureAudioElement();
  // Clean up any previous listeners
  audio.oncanplay = null;
  audio.onerror = null;

  audio.src = url;
  audio.oncanplay = () => { try { audio.play(); } catch {} };
  audio.onerror = () => {
    showToast("Audio not available for this word.");
  };
  // Kick it off
  audio.load();
};

// ---------------- Navbar actions ----------------
window.saveCurrentScore = async function () {
  try {
    await autoCommitIfNeeded("manual save");
    alert('Progress saved ✅');
  } catch {
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