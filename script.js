// script.js — decks loader + quiz UI + grammar list

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

// Load both Decks and Grammar on page ready
window.onload = () => {
  loadDeckManifest();
  loadGrammarManifest();
  updateScore();
};

// Gate-aware hook (called by firebase.js after login, optional)
window.__initAfterLogin = () => {
  // If you want to refresh after login, uncomment:
  // loadDeckManifest();
  // loadGrammarManifest();
};

// ---- sections --------------------------------------------------------------
function showSection(id) {
  const sections = [
    "deck-select", "grammar-section", "mistakes-section",
    "practice", "mode-select", "learn", "leaderboard-section"
  ];
  sections.forEach(sec => $(sec)?.classList.add("hidden"));
  $(id)?.classList.remove("hidden");
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

function nextQuestion() {
  currentIndex++;
  if (currentIndex >= currentDeck.length) {
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
      // Fallback if repo has grammar_manifest.json at root
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
