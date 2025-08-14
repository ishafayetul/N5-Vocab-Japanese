let allDecks = {}; // {deckName: [{front, back, romaji}]}
let currentDeck = [];
let currentDeckName = "";
let currentIndex = 0;
let mode = 'jp-en';
let score = { correct: 0, wrong: 0, skipped: 0 };

let mistakes = JSON.parse(localStorage.getItem('mistakes') || '[]');
let masteryMap = JSON.parse(localStorage.getItem('masteryMap') || '{}');

window.onload = () => {
  loadDeckManifest();
  updateScore();
};

// Gate-aware hook (called by firebase.js after login, optional)
window.__initAfterLogin = () => {
  // nothing required right now; decks are already loaded
};

function showSection(id) {
  const sections = [
    'deck-select', 'mistakes-section',
    'practice', 'mode-select', 'learn', 'leaderboard-section'
  ];
  sections.forEach(sec => {
    const el = document.getElementById(sec);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

async function loadDeckManifest() {
  try {
    // Load manifest from ROOT (fixes earlier path mismatch)
    const res = await fetch('vocab_decks/deck_manifest.json');
    const deckList = await res.json();

    deckList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const file of deckList) {
      const name = file.replace('.csv', '');
      // Fetch exactly as listed in manifest (no hard-coded subfolder)
      const deck = await fetchAndParseCSV(`vocab_decks/${file}`);
      allDecks[name] = deck;
    }

    renderDeckButtons();
  } catch (err) {
    console.error('Failed to load decks:', err);
  }
}

async function fetchAndParseCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const text = await res.text();
  const lines = text.split('\n').filter(Boolean);
  return lines.map(line => {
    const [word, meaning, romaji] = line.split(',');
    return {
      front: (word || '').trim(),
      back: (meaning || '').trim(),
      romaji: (romaji || '').trim()
    };
  }).filter(row => row.front && row.back);
}

function renderDeckButtons() {
  const container = document.getElementById('deck-buttons');
  if (!container) return;
  container.innerHTML = '';
  Object.keys(allDecks).forEach(name => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.onclick = () => selectDeck(name);
    container.appendChild(btn);
  });
}

function selectDeck(name) {
  currentDeck = allDecks[name] || [];
  currentDeckName = name;
  currentIndex = 0;
  showSection('mode-select');
}

function startPractice(selectedMode) {
  mode = selectedMode;
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  shuffleArray(currentDeck);
  showSection('practice');
  updateScore();
  showQuestion();
}

function showQuestion() {
  const q = currentDeck[currentIndex];
  if (!q) return;

  const front = mode === 'jp-en' ? q.front : q.back;
  const answer = mode === 'jp-en' ? q.back : q.front;
  const options = generateOptions(answer);

  const qBox = document.getElementById('question-box');
  const extra = document.getElementById('extra-info');
  const optionsList = document.getElementById('options');

  if (qBox) qBox.innerText = front;
  if (extra) extra.innerText = '';
  if (optionsList) optionsList.innerHTML = '';

  options.forEach(opt => {
    const li = document.createElement('li');
    li.textContent = opt;
    li.onclick = () => checkAnswer(opt, answer, q);
    optionsList.appendChild(li);
  });
}

function generateOptions(correct) {
  const pool = currentDeck.map(q => (mode === 'jp-en' ? q.back : q.front));
  const unique = [...new Set(pool.filter(opt => opt && opt !== correct))];
  shuffleArray(unique);
  const options = [correct, ...unique.slice(0, 3)];
  return shuffleArray(options);
}

function checkAnswer(selected, correct, wordObj) {
  const options = document.querySelectorAll('#options li');
  options.forEach(li => {
    if (li.textContent === correct) li.classList.add('correct');
    else if (li.textContent === selected) li.classList.add('wrong');
  });

  const key = wordObj.front + '|' + wordObj.back;
  if (selected === correct) {
    score.correct++;
    // Record to Firebase (per-day, per-deck, per-mode)
    window.__fb_recordAnswer?.({
      deckName: currentDeckName,
      mode,
      isCorrect: true
    });

    masteryMap[key] = (masteryMap[key] || 0) + 1;
    if (masteryMap[key] >= 5) {
      mistakes = mistakes.filter(m => m.front !== wordObj.front || m.back !== wordObj.back);
    }
  } else {
    score.wrong++;
    masteryMap[key] = 0;
    mistakes.push(wordObj);
  }

  localStorage.setItem('mistakes', JSON.stringify(mistakes));
  localStorage.setItem('masteryMap', JSON.stringify(masteryMap));
  updateScore();
  setTimeout(nextQuestion, 600);
}

function skipQuestion() {
  const wordObj = currentDeck[currentIndex];
  if (!wordObj) return;
  const key = wordObj.front + '|' + wordObj.back;
  score.skipped++;
  masteryMap[key] = 0;
  mistakes.push(wordObj);
  localStorage.setItem('mistakes', JSON.stringify(mistakes));
  localStorage.setItem('masteryMap', JSON.stringify(masteryMap));
  updateScore();
  nextQuestion();
}

function nextQuestion() {
  currentIndex++;
  if (currentIndex >= currentDeck.length) {
    alert(`Finished! ✅ ${score.correct} ❌ ${score.wrong} ➖ ${score.skipped}`);
    showSection('deck-select');
  } else {
    showQuestion();
  }
}

function updateScore() {
  const c = document.getElementById('correct');
  const w = document.getElementById('wrong');
  const s = document.getElementById('skipped');
  if (c) c.innerText = score.correct;
  if (w) w.innerText = score.wrong;
  if (s) s.innerText = score.skipped;
}

function startMistakePractice() {
  if (mistakes.length === 0) return alert('No mistakes yet!');
  currentDeck = mistakes.slice();
  currentIndex = 0;
  showSection('practice');
  startPractice(mode);
}

function clearMistakes() {
  if (confirm("Clear all mistake words?")) {
    mistakes = [];
    localStorage.setItem('mistakes', JSON.stringify([]));
    alert("Mistakes cleared.");
  }
}

function resetSite() {
  if (confirm("⚠️ Reset all progress? This clears mistakes and mastery.")) {
    localStorage.removeItem('mistakes');
    localStorage.removeItem('masteryMap');
    alert("All data reset.");
    location.reload();
  }
}

function startLearnMode() {
  currentIndex = 0;
  showSection('learn');
  showLearnCard();
}

function showLearnCard() {
  const word = currentDeck[currentIndex];
  if (!word) return;
  const jp = word.front;
  const en = word.back;
  const ro = word.romaji || '';
  const box = document.getElementById('learn-box');
  if (box) box.innerText = `${jp} – ${en} – ${ro}`;
}

function nextLearn() {
  currentIndex++;
  if (currentIndex >= currentDeck.length) {
    alert("🎉 Finished learning this deck!");
    showSection('deck-select');
  } else {
    showLearnCard();
  }
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showRomaji() {
  if (!currentDeck[currentIndex]) return;
  const romaji = currentDeck[currentIndex].romaji || '(no romaji)';
  const output = document.getElementById('extra-info');
  if (output) output.innerText = `Romaji: ${romaji}`;
}

function showMeaning() {
  if (!currentDeck[currentIndex]) return;
  const q = currentDeck[currentIndex];
  const correct = mode === 'jp-en' ? q.back : q.front;
  const output = document.getElementById('extra-info');
  if (output) output.innerText = `Meaning: ${correct}`;
}
