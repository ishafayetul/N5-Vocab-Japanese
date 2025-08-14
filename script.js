// script.js — decks loader + quiz UI + grammar list + progress UI

let allDecks = {};                // { deckName: [{front, back, romaji}] }
let currentDeck = [];
let currentDeckName = "";
let currentIndex = 0;
let mode = "jp-en";
let score = { correct: 0, wrong: 0, skipped: 0 };

let mistakes = JSON.parse(localStorage.getItem("mistakes") || "[]");
let masteryMap = JSON.parse(localStorage.getItem("masteryMap") || "{}");

// ---- helpers ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.innerText = txt; };

function statusLine(id, msg) {
  const s = $(id);
  if (s) s.textContent = msg;
  console.log(`[status:${id}]`, msg);
}

// Load Decks + Grammar + Progress on page ready
window.onload = () => {
  loadDeckManifest();
  loadGrammarManifest();
  renderProgress();
  updateScore();
};

// Gate-aware hook (called by firebase.js after login)
window.__initAfterLogin = () => {
  renderProgress();
};

// ---- section router (robust) ----------------------------------------------
function showSection(id) {
  // Hide every section inside <main>, then show requested
  document.querySelectorAll('.main-content main > section').forEach(sec => {
    sec.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
  else console.warn('showSection: no element with id:', id);
}

// ---- DECKS -----------------------------------------------------------------
async function loadDeckManifest() {
  try {
    statusLine("deck-status", "Loading decks…");
    const res = await fetch("vocab_decks/deck_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status} for vocab_decks/deck_manifest.json`);

    const text = await res.text();
    if (text.trim().startsWith("<")) {
      throw new Error("Manifest is HTML (check path/case for vocab_decks/deck_manifest.json)");
    }
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
    btn.onclick = () => selectDeck(name);
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
  showSection("mode-select");
}

// ---- PRACTICE --------------------------------------------------------------
function startPractice(selectedMode) {
  mode = selectedMode;
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  shuffleArray(currentDeck);
  showSection("practice");
  updateScore();
  showQuestion();
}

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
    // update daily & overall live (Firebase will aggregate)
    window.__fb_recordAnswer?.({
      deckName: currentDeckName,
      mode,
      isCorrect: true,
    });

    masteryMap[key] = (masteryMap[key] || 0) + 1;
    if (masteryMap[key] >= 5) {
      mistakes = mistakes.filter(
        (m) => m.front !== wordObj.front || m.back !== wordObj.back
      );
    }
  } else {
    score.wrong++;
    masteryMap[key] = 0;
    mistakes.push(wordObj);
  }

  localStorage.setItem("mistakes", JSON.stringify(mistakes));
  localStorage.setItem("masteryMap", JSON.stringify(masteryMap));
  updateScore();
  setTimeout(nextQuestion, 600);
}

function skipQuestion() {
  const wordObj = currentDeck[currentIndex];
  if (!wordObj) return;
  const key = wordObj.front + "|" + wordObj.back;

  score.skipped++;
  masteryMap[key] = 0;
  mistakes.push(wordObj);

  localStorage.setItem("mistakes", JSON.stringify(mistakes));
  localStorage.setItem("masteryMap", JSON.stringify(masteryMap));
  updateScore();
  nextQuestion();
}

// NEW: Save Score AND finish current session (return to Deck Select)
// Save & Finish (global)
window.saveCurrentScore = async function () {
  const btn = document.querySelector('#practice .save');
  if (btn) btn.disabled = true;
  try {
    await window.__fb_saveScore?.({
      deckName: currentDeckName || 'Unknown Deck',
      mode,
      correct: score.correct,
      wrong: score.wrong,
      skipped: score.skipped,
      total: score.correct + score.wrong + score.skipped
    });
    await renderProgress();           // refresh Progress view
    alert('Score saved to Progress ✅');
    // Finish session and go back to Deck Select
    currentDeck = [];
    currentDeckName = "";
    currentIndex = 0;
    showSection('deck-select');
  } catch (e) {
    console.warn('saveCurrentScore failed:', e);
    alert('Could not save score. Please try again.');
  } finally {
    if (btn) btn.disabled = false;
  }
};



function nextQuestion() {
  currentIndex++;
  if (currentIndex >= currentDeck.length) {
    // store an attempt automatically on finish
    (async () => {
      try {
        await window.__fb_finishAttempt?.({
          deckName: currentDeckName,
          mode,
          correct: score.correct,
          wrong: score.wrong,
          skipped: score.skipped,
          total: score.correct + score.wrong + score.skipped
        });
        renderProgress();
      } catch (e) {
        console.warn("finishAttempt failed:", e);
      }
    })();

    alert(`Finished! ✅ ${score.correct} ❌ ${score.wrong} ➖ ${score.skipped}`);
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

// ---- LEARN mode ------------------------------------------------------------
function startLearnMode() {
  currentIndex = 0;
  if (!currentDeck.length) return alert("Pick a deck first!");
  showSection("learn");
  showLearnCard();
}

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

// ---- MISTAKES --------------------------------------------------------------
function startMistakePractice() {
  if (mistakes.length === 0) return alert("No mistakes yet!");
  currentDeck = mistakes.slice();
  currentDeckName = "Mistakes";
  currentIndex = 0;
  showSection("practice");
  startPractice(mode);
}

function clearMistakes() {
  if (confirm("Clear all mistake words?")) {
    mistakes = [];
    localStorage.setItem("mistakes", JSON.stringify([]));
    alert("Mistakes cleared.");
  }
}

function resetSite() {
  if (confirm("⚠️ Reset all progress? This clears mistakes and mastery.")) {
    localStorage.removeItem("mistakes");
    localStorage.removeItem("masteryMap");
    alert("All data reset.");
    location.reload();
  }
}

// ---- GRAMMAR ---------------------------------------------------------------
async function loadGrammarManifest() {
  try {
    statusLine("grammar-status", "Loading grammar lessons…");

    // Try folder path first; fall back to root if needed
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

// ---- PROGRESS --------------------------------------------------------------
async function renderProgress() {
  if (!window.__fb_fetchAttempts) return;

  try {
    const attempts = await window.__fb_fetchAttempts(20); // latest 20
    const tbody = $("progress-table")?.querySelector("tbody");
    if (tbody) {
      tbody.innerHTML = "";
      attempts.forEach(a => {
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
    const prev = attempts[1];

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
        deltaBox.innerHTML = `<span class="${cls}">${sign}${d} correct vs previous</span>`;
      } else {
        deltaBox.textContent = "—";
      }
    }
  } catch (e) {
    console.warn("renderProgress failed:", e);
  }
}

// ---- utils -----------------------------------------------------------------
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

function showMeaning() {
  const card = currentDeck[currentIndex];
  if (!card) return;
  const correct = mode === "jp-en" ? card.back : card.front;
  setText("extra-info", `Meaning: ${correct}`);
}
