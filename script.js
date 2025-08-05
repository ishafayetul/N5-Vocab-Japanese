let decks = {}; // {deckName: [{front: ..., back: ...}]}
let currentDeck = [];
let currentIndex = 0;
let mode = 'jp-en';
let score = { correct: 0, wrong: 0, skipped: 0 };
let mistakes = JSON.parse(localStorage.getItem('mistakes') || '[]');
let masteryMap = JSON.parse(localStorage.getItem('masteryMap') || '{}');

window.onload = () => {
  loadDeckButtons();
  loadDeleteDropdown();
  updateScore();
};

function showSection(id) {
  const allSections = [
    'deck-select',
    'upload-section',
    'delete-deck-section',
    'mistakes-section',
    'practice',
    'mode-select',
    'learn'
  ];

  allSections.forEach(sec => {
    const el = document.getElementById(sec);
    if (el) el.classList.add('hidden');
  });

  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}



function loadDeckButtons() {
  const deckButtons = document.getElementById('deck-buttons');
  deckButtons.innerHTML = ''; // Clear previous buttons

  const deckKeys = Object.keys(localStorage)
    .filter(key => key.startsWith('deck_'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  deckKeys.forEach(key => {
    const name = key.replace('deck_', '');
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.onclick = () => selectDeck(name);
    deckButtons.appendChild(btn);
  });
}



function loadDeleteDropdown() {
  const select = document.getElementById('delete-deck-select');
  select.innerHTML = '';
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('deck_')) {
      const name = key.replace('deck_', '');
      const option = document.createElement('option');
      option.value = key;
      option.textContent = name;
      select.appendChild(option);
    }
  });
}

function deleteSelectedDeck() {
  const select = document.getElementById('delete-deck-select');
  const selectedKey = select.value;
  if (confirm(`Are you sure you want to delete deck: ${selectedKey.replace('deck_', '')}?`)) {
    localStorage.removeItem(selectedKey);
    location.reload();
  }
}

function selectDeck(name) {
  currentDeck = JSON.parse(localStorage.getItem('deck_' + name));
  document.getElementById('deck-select').classList.add('hidden');
  document.getElementById('mode-select').classList.remove('hidden');
}

function startPractice(selectedMode) {
  mode = selectedMode;
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  shuffleArray(currentDeck);
  document.getElementById('mode-select').classList.add('hidden');
  document.getElementById('practice').classList.remove('hidden');
  updateScore();
  showQuestion();
}

function showQuestion() {
  const q = currentDeck[currentIndex];
  const front = mode === 'jp-en' ? q.front : q.back;
  const answer = mode === 'jp-en' ? q.back : q.front;
  const options = generateOptions(answer);

  document.getElementById('question-box').innerText = front;
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
  const allOptions = currentDeck.map(q => (mode === 'jp-en' ? q.back : q.front));
  const uniqueOptions = [...new Set(allOptions)];
  const filtered = uniqueOptions.filter(opt => opt !== correct);
  shuffleArray(filtered);

  const options = [correct, ...filtered.slice(0, 3)];
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
  setTimeout(nextQuestion, 1000);
}

function nextQuestion() {
  currentIndex++;
  if (currentIndex >= currentDeck.length) {
    alert(`Finished! Correct: ${score.correct}, Wrong: ${score.wrong}, Skipped: ${score.skipped}`);
    location.reload();
  } else showQuestion();
}

function skipQuestion() {
  const wordObj = currentDeck[currentIndex];
  const key = wordObj.front + '|' + wordObj.back;

  score.skipped++;
  mistakes.push(wordObj);
  masteryMap[key] = 0;

  localStorage.setItem('mistakes', JSON.stringify(mistakes));
  localStorage.setItem('masteryMap', JSON.stringify(masteryMap));

  updateScore();
  nextQuestion();
}


function updateScore() {
  document.getElementById('correct').innerText = score.correct;
  document.getElementById('wrong').innerText = score.wrong;
  document.getElementById('skipped').innerText = score.skipped;
}

function uploadCSV() {
  const files = document.getElementById('csv-file').files;
  if (!files.length) return alert('Please select at least one CSV file.');

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const lines = e.target.result.split('\n').filter(Boolean);
      const data = lines.map(line => {
        const [word, meaning, romaji] = line.split(',');
        return {
          front: word.trim(),
          back: meaning.trim(),
          romaji: romaji?.trim() || ''
        };
      });

      const deckName = file.name.replace(/\\.csv$/i, '');
      localStorage.setItem('deck_' + deckName, JSON.stringify(data));
      loadDeckButtons();
      loadDeleteDropdown();
    };
    reader.readAsText(file);
  });

  alert('All decks uploaded successfully!');
}



function startMistakePractice() {
  if (mistakes.length === 0) return alert('No mistakes yet!');
  currentDeck = mistakes;
  document.getElementById('deck-select').classList.add('hidden');
  document.getElementById('mistakes-section').classList.add('hidden');
  startPractice(mode);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clearMistakes() {
  if (confirm("Are you sure you want to clear all mistake words?")) {
    mistakes = [];
    localStorage.setItem('mistakes', JSON.stringify([]));
    alert("Mistake list cleared!");
  }
}

function resetSite() {
  if (confirm("⚠️ This will delete all decks, mistakes, and progress. Continue?")) {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('deck_') || key === 'mistakes' || key === 'masteryMap') {
        localStorage.removeItem(key);
      }
    });
    alert("All data has been reset.");
    location.reload();
  }
}

function startLearnMode() {
  currentIndex = 0;
  document.getElementById('mode-select').classList.add('hidden');
  document.getElementById('learn').classList.remove('hidden');
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
    alert("Finished learning this deck!");
    location.reload();
  } else {
    showLearnCard();
  }
}
