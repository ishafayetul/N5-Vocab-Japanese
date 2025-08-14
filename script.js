// script.js — decks loader + quiz UI + grammar list + progress UI
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
  // Only commit if firebase helper exists and we have data
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

    // Refresh progress summaries
    await renderProgress();
    console.log("[autosave] saved ✔");
  } catch (e) {
    console.warn("[autosave] failed → keeping local buffer:", e?.message || e);
    // Leave sessionBuf intact; firebase.js will try to commit pendingSession next launch
  } finally {
    committing = false;
  }
}

// ---------------- App lifecycle ----------------
window.onload = () => {
  loadDeckManifest();
  loadGrammarManifest();
  renderProgress();
  updateScore();
};

// Called by firebase.js when auth is ready
window.__initAfterLogin = () => {
  renderProgress();
};

// Best-effort: persist pending session for next launch auto-commit
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
  // Leaving Practice? autosave the deck's buffered progress
  if (currentSectionId === "practice" && id !== "practice") {
    autoCommitIfNeeded("leaving practice");
  }

  document.querySelectorAll('.main-content main > section').forEach(sec => {
    sec.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
  else console.warn('showSection: no element with id:', id);

  currentSectionId = id;

  // Keep progress bar accurate if we re-enter Practice
  if (id === "practice") updateDeckProgress();
}

// Make router global for inline onclicks in HTML
window.showSection = showSection;

// ---------------- DECKS ----------------
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

async function fetchAndParseCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();

  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(Boolean);
  const rows = lines.map((line) => {
    const parts = line.split(",");
    const word   = (parts[0] || "").trim();
    const meaning = (parts[1] || "").trim();
    const romaji  = (parts[2] || "").trim();
    return { front: word, back: meaning, romaji };
  }).filter(r => r.front && r.back);

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
  currentIndex = 0;
  if (currentDeck.length === 0) {
    alert(`Deck "${name}" is empty or failed to load.`);
    return;
  }
  // reset session buffer for a fresh run on this deck
  sessionBuf = {
    deckName: name,
    mode: "jp-en",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0
  };
  persistSession();
  showSection("mode-select");
}

// ---------------- PRACTICE ----------------
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
window.startPractice = startPractice; // used by inline onclicks

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
    // Finished the deck → navigate to Vocab; autosave happens via showSection()
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

// ---------------- LEARN mode ----------------
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
  const jp = word.front;
  const en = word.back;
  const ro = word.romaji || "";
  setText("learn-box", `${jp} – ${en} – ${ro}`);
}

function nextLearn() {
  currentIndex++;
  if (currentIndex >= currentDeck.length) {
    alert("🎉 Finished learning this deck!");
    showSection("deck-select");
  } else {
    showLearnCard();
  }
}
window.nextLearn = nextLearn;

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

// ---------------- GRAMMAR ----------------
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
    } catch (e1) {
      list = await tryLoad("grammar_manifest.json");
      base = "";
    }

    const container = $("grammar-list");
    if (!container) return;
    container.innerHTML = "";

    list.forEach((file) => {
      const btn = document.createElement("button");
      btn.textContent = file.replace(".pdf", "");
      btn.onclick = () => window.open(`${base}${file}`, "_blank");
      container.appendChild(btn);
    });

    statusLine("grammar-status", `Loaded ${list.length} grammar file(s).`);
  } catch (err) {
    console.error("Failed to load grammar manifest:", err);
    statusLine("grammar-status", `Failed to load grammar: ${err.message}`);
  }
}

// ---------------- PROGRESS (reads via firebase.js) ----------------
async function renderProgress() {
  if (!window.__fb_fetchAttempts) return; // firebase.js exposes this

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

// ---------------- Navbar actions ----------------
window.saveCurrentScore = async function () {
  try {
    await autoCommitIfNeeded("manual save");
    alert('Progress saved ✅');
  } catch {
    // autoCommitIfNeeded already logs/handles errors
  }
};

window.resetSite = async function () {
  const sure = confirm("⚠️ This will erase ALL your progress (attempts, daily aggregates, leaderboard rows, tasks) from the database. Your sign‑in will remain.\n\nProceed?");
  if (!sure) return;

  const btn = event?.target;
  if (btn) btn.disabled = true;

  try {
    // Delegate to firebase.js where auth/db are available
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
