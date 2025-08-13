let allDecks = {}; // {deckName: [{front, back, romaji}]}
let currentDeck = [];
let currentDeckName = "";
let currentIndex = 0;
let mode = 'jp-en';
let score = { correct: 0, wrong: 0, skipped: 0 };

let mistakes = JSON.parse(localStorage.getItem('mistakes') || '[]');
let masteryMap = JSON.parse(localStorage.getItem('masteryMap') || '{}');

let grammarFiles = []; // ["Grammar-Lesson-1.pdf", ...]

window.onload = () => {
  loadDeckManifest();
  updateScore();
  loadGrammarManifest();
};

function showSection(id) {
  const sections = [
    'deck-select', 'upload-section', 'delete-deck-section',
    'mistakes-section', 'practice', 'mode-select', 'learn', 'grammar-section'
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
    const res = await fetch('vocab_decks/deck_manifest.json');
    const deckList = await res.json();

    deckList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const file of deckList) {
      const name = file.replace('.csv', '');
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
  const text = await res.text();
  const lines = text.split('\n').filter(Boolean);
  return lines.map(line => {
    const [word, meaning, romaji] = line.split(',');
    return {
      front: word.trim(),
      back: meaning.trim(),
      romaji: romaji?.trim() || ''
    };
  });
}

function renderDeckButtons() {
  const container = document.getElementById('deck-buttons');
  container.innerHTML = '';
  Object.keys(allDecks).forEach(name => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.onclick = () => selectDeck(name);
    container.appendChild(btn);
  });
}

function selectDeck(name) {
  currentDeck = allDecks[name];
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
  const front = mode === 'jp-en' ? q.front : q.back;
  const answer = mode === 'jp-en' ? q.back : q.front;
  const options = generateOptions(answer);

  document.getElementById('question-box').innerText = front;
  document.getElementById('extra-info').innerText = ''; // clear info
  const optionsList = document.getElementById('options');
  optionsList.innerHTML = '';

  options.forEach(opt => {
    const li = document.createElement('li');
    li.textContent = opt;
    li.onclick = () => checkAnswer(opt, answer, q);
    optionsList.appendChild(li);
  });
}

function generateOptions(correct) {
  const pool = currentDeck.map(q => (mode === 'jp-en' ? q.back : q.front));
  const unique = [...new Set(pool.filter(opt => opt !== correct))];
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
    // NEW: push to leaderboard
    window.__fb_updateScore?.({ deltaCorrect: 1 });

    masteryMap[key] = (masteryMap[key] || 0) + 1;
    if (masteryMap[key] >= 5) {
      mistakes = mistakes.filter(m => m.front !== wordObj.front || m.back !== wordObj.back);
    }
  } else {
    score.wrong++;
    // NEW: push to leaderboard (wrong)
    window.__fb_updateScore?.({ deltaWrong: 1 });

    masteryMap[key] = 0;
    mistakes.push(wordObj);
  }
  // ...rest unchanged
}


function skipQuestion() {
  const wordObj = currentDeck[currentIndex];
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
    location.reload();
  } else {
    showQuestion();
  }
}

function updateScore() {
  document.getElementById('correct').innerText = score.correct;
  document.getElementById('wrong').innerText = score.wrong;
  document.getElementById('skipped').innerText = score.skipped;
}

function startMistakePractice() {
  if (mistakes.length === 0) return alert('No mistakes yet!');
  currentDeck = mistakes;
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
  const jp = word.front;
  const en = word.back;
  const ro = word.romaji || '';
  document.getElementById('learn-box').innerText = `${jp} – ${en} – ${ro}`;
}

function nextLearn() {
  currentIndex++;
  if (currentIndex >= currentDeck.length) {
    alert("🎉 Finished learning this deck!");
    location.reload();
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

// 2) Replace your loadGrammarManifest() with this version:
async function loadGrammarManifest() {
  try {
    const url = 'grammar/grammar_manifest.json?v=' + Date.now(); // cache-bust
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url} — HTTP ${res.status}`);
    grammarFiles = await res.json();

    // Basic validation
    if (!Array.isArray(grammarFiles)) {
      throw new Error('grammar_manifest.json must be a JSON array of file names.');
    }

    // Sort like 1,2,10
    grammarFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    renderGrammarLessons();
  } catch (e) {
    console.error(e);
    const wrap = document.getElementById('grammar-lessons');
    if (wrap) {
      wrap.innerHTML = `<div style="color:#b00;line-height:1.5">
        ⚠️ Couldn’t load <code>grammar/grammar_manifest.json</code>.<br>
        <strong>Tips:</strong><br>
        • Ensure the file exists at <code>/grammar/grammar_manifest.json</code><br>
        • Serve the site via http(s), not <code>file://</code><br>
        • Confirm JSON is valid (an array of strings)<br>
        • Filenames in JSON exactly match the PDFs (case‑sensitive)
      </div>`;
    }
  }
}

// 3) (Optional) Improve empty-state and add tiny logging:
function renderGrammarLessons() {
  const wrap = document.getElementById('grammar-lessons');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!grammarFiles.length) {
    wrap.innerHTML = `<div style="color:#666">No lessons found in grammar_manifest.json.</div>`;
    return;
  }

  console.log('Loaded grammar files:', grammarFiles); // debug
  grammarFiles.forEach((file, idx) => {
    const btn = document.createElement('button');
    const match = file.match(/(\d+)/);
    const labelNum = match ? match[1] : (idx + 1);
    btn.textContent = `Lesson ${labelNum}`;
    btn.onclick = () => openGrammarPDF(file);
    wrap.appendChild(btn);
  });
}

function openGrammarPDF(fileName) {
  const iframe = document.getElementById('pdf-viewer');
  const hint = document.getElementById('pdf-hint');
  const src = `grammar/${fileName}`;
  iframe.src = src;
  if (hint) hint.style.display = 'none';

  // Fallback for environments that block inline PDF preview
  iframe.onerror = () => window.open(src, '_blank');
}