/* =========================
   Base / Resets
   ========================= */
:root{
  --bg: #f7f8fa;
  --text: #222;
  --muted: #666;
  --primary: #0d6efd;
  --primary-hover: #0b5ed7;
  --sidebar-bg: #2c3e50;
  --sidebar-btn: #34495e;
  --sidebar-btn-hover: #1abc9c;
  --card: #fff;
  --border: #e5e7eb;
  --success: #d4edda;
  --danger: #f8d7da;
  --shadow: 0 10px 24px rgba(0,0,0,.12);
  --green: #16a34a;
  --red: #dc2626;
  --warning: #fff7ed;
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
  color: var(--text);
  background: var(--bg);
  line-height: 1.4;
}
.hidden { display: none !important; }

/* =========================
   Layout
   ========================= */
.layout { min-height: 100vh; }
.sidebar{
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: 220px;
  background: var(--sidebar-bg);
  color: #fff;
  padding: 20px;
  display: flex; flex-direction: column;
}
.main-content{
  margin-left: 220px;
  padding: 20px;
}

/* =========================
   Typography / Headings
   ========================= */
h1 { margin: 0 0 8px; font-size: 28px; }
h2 { margin: 20px 0 12px; font-size: 22px; }
h3 { margin: 0 0 10px; font-size: 18px; }
.muted { color: var(--muted); }
.error { color: #b00020; margin-top: 10px; }

/* =========================
   Score
   ========================= */
#score { font-size: 16px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
#score span { font-weight: 700; }

/* =========================
   Sidebar buttons
   ========================= */
.sidebar h2 { font-size: 18px; margin-bottom: 18px; }
.sidebar button{
  background: var(--sidebar-btn);
  color: #fff;
  border: 0;
  padding: 10px;
  margin-bottom: 10px;
  text-align: left;
  border-radius: 8px;
  font-size: 15px;
  cursor: pointer;
  transition: background .18s ease, transform .06s ease;
}
.sidebar button:hover{ background: var(--sidebar-btn-hover); }
.sidebar button:active{ transform: translateY(1px); }

/* =========================
   Generic buttons
   ========================= */
button{
  padding: 10px 18px;
  margin: 6px;
  cursor: pointer;
  border: none;
  background: var(--primary);
  color: #fff;
  border-radius: 8px;
  font-size: 16px;
  transition: background .18s ease, transform .06s ease, box-shadow .18s ease;
}
button:hover{ background: var(--primary-hover); }
button:active{ transform: translateY(1px); }
button.save{ background:#10b981; }
button.save:hover{ background:#0ea371; }
button:disabled { opacity: .6; cursor: not-allowed; }

/* =========================
   Practice actions
   ========================= */
.practice-actions{ display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }

/* =========================
   Deck list / options
   ========================= */
#deck-buttons{ display:flex; flex-wrap:wrap; gap:10px; }
#deck-buttons button{ border-radius: 999px; padding: 8px 14px; }

#options{ list-style:none; padding:0; margin: 12px 0 0; }
#options li{
  margin: 8px 0;
  padding: 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  font-size: 18px;
  transition: background .18s ease, border-color .18s ease;
}
#options li:hover{ background:#f2f4f7; }
.correct{ background: var(--success) !important; }
.wrong{ background: var(--danger) !important; }

/* =========================
   Flashcard (shared by Learn, Vocab MCQ, Practice Grammar)
   ========================= */
.flashcard{
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
  min-height: 120px;
  padding: 18px 20px;
  display:flex; align-items:center; justify-content:center;
  font-size: 22px;
  text-align: center;
  transition: transform .18s ease, box-shadow .18s ease;
}
.flashcard:focus-within, .flashcard:hover{
  transform: translateY(-2px);
  box-shadow: 0 14px 30px rgba(0,0,0,.14);
}

/* Learn box as a flashcard if the div ID is used instead of .flashcard class */
#learn-box{
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
  min-height: 120px;
  padding: 18px 20px;
  display:flex; flex-direction: column; align-items:center; justify-content:center;
  font-size: 22px;
  text-align: center;
}

/* Question box (MCQ) */
#question-box{
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
  min-height: 120px;
  padding: 18px 20px;
  display:flex; align-items:center; justify-content:center;
  font-size: 22px;
  text-align: center;
}

/* Learn actions alignment (Prev/Next/Show...) */
#learn .practice-actions{
  justify-content:center;
}

/* =========================
   Deck progress (Practice + Grammar)
   ========================= */
.deck-progress{
  margin: 8px 0 12px;
  background: #eef2ff;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: var(--shadow);
}
.deck-progress-bar{
  height: 10px;
  width: 0%;
  background: var(--primary);
  transition: width .25s ease;
}
.deck-progress-text{
  padding: 8px 10px;
  font-size: 14px;
  color: #111;
}

/* =========================
   Practice Grammar
   ========================= */
.pg-files{ display:flex; flex-wrap:wrap; gap:10px; margin: 6px 0 12px; }
.pg-files button{ border-radius: 999px; padding: 8px 14px; }

.pg-input-row{
  display:flex; gap:8px; flex-wrap:wrap;
  margin-top: 12px;
  align-items: center;
}
.pg-input{
  flex: 1 1 320px;
  min-width: 280px;
  padding: 16px 20px;
  font-size: 24px;
  height: 56px;
  line-height: 1.2;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  outline: none;
  transition: box-shadow .18s ease, border-color .18s ease, background .18s ease;
}
/* Put any .pg-input on its own line */
.pg-input-row .pg-input{
  flex-basis: 100%;
  width: 100%;
}
.pg-input::placeholder{ font-size: .95em; opacity: .7; }
.pg-input:focus{
  border-color: #60a5fa;
  box-shadow: 0 0 0 4px rgba(59,130,246,.15);
}
/* Make Sentence: multi-line input uses the same look as pg-input */
.pg-input.make-textarea{
  height: auto;
  min-height: 96px;
  line-height: 1.4;
  resize: vertical;
}
.pg-feedback{
  margin-top: 8px;
  font-size: 15px;
  padding: 8px 10px;
  border-radius: 10px;
  background: transparent;
}
.pg-feedback.ok{ background:#ecfdf5; color:#065f46; }
.pg-feedback.bad{ background:#fef2f2; color:#7f1d1d; }

/* =========================
   Leaderboards
   ========================= */
#overall-leaderboard-list,
#todays-leaderboard-list{ list-style:none; padding-left:0; }
#overall-leaderboard-list li,
#todays-leaderboard-list li{
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  margin: 8px 0;
  box-shadow: var(--shadow);
}
.lb-row{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.lb-rank{ width:48px; font-weight:700; }
.lb-name{ min-width:150px; font-weight:600; }
.lb-part{ color:#333; }
.lb-score{ margin-left:auto; font-weight:700; }

/* =========================
   Progress
   ========================= */
.progress-grid{
  display:grid;
  grid-template-columns: repeat(3, minmax(0,1fr));
  gap:12px;
}
.card{
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  box-shadow: var(--shadow);
}
.table-wrap{ overflow:auto; }
.progress-table{
  width: 100%;
  border-collapse: collapse;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.progress-table th, .progress-table td{
  font-size: 14px;
  border-bottom: 1px solid var(--border);
  padding: 8px 10px;
  text-align: left;
}
.progress-table thead th{ background:#f3f4f6; }
.delta-up{ color: var(--green); font-weight: 700; }
.delta-down{ color: var(--red); font-weight: 700; }

/* =========================
   Auth gate
   ========================= */
.auth-gate{
  position: fixed; inset: 0;
  display: grid; place-items: center;
  background: #0f172a;
  z-index: 9999;
}
.auth-card{
  background:#fff;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
  padding: 28px;
  width: min(420px, calc(100% - 40px));
  text-align: center;
}

/* =========================
   To-Do flyout (bottom-right)
   ========================= */
.todo-flyout{
  position: fixed;
  bottom: 12px;
  right: 12px;
  width: 360px;
  max-height: 45vh;
  overflow: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  z-index: 500;
  padding: 14px;
}
.todo-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; font-weight:600; }
.todo-timer{
  padding:2px 8px; border-radius:999px; background:#0ea5e9; color:#fff; font-weight:700;
  font-variant-numeric: tabular-nums;
}
.todo-list{ list-style:none; padding:0; margin:0; max-height: 40vh; overflow:auto; }
.todo-item{ display:flex; align-items:center; gap:10px; padding:8px; border-radius:8px; }
.todo-item:hover{ background:#f6f8fa; }
.todo-empty{ color:var(--muted); padding:6px; }
.admin-row{ display:flex; gap:8px; margin-top:10px; border-top:1px dashed #e2e8f0; padding-top:10px; }
.admin-row input{ flex:1; padding:8px 10px; border:1px solid var(--border); border-radius:8px; }

/* =========================
   Responsive
   ========================= */
@media (max-width: 900px){
  .todo-flyout{ position: static; width:100%; margin:10px 0 0; }
}

@media (max-width: 768px){
  .sidebar{
    position: static;
    width: 100%;
    height: auto;
    flex-direction: row;
    gap: 6px;
    overflow-x: auto;
  }
  .main-content{ margin-left: 0; }
  .sidebar button{ white-space: nowrap; font-size: 14px; text-align: center; }
  h1{ font-size: 24px; }
  h2{ font-size: 20px; }
  #options li{ font-size: 16px; }
  .progress-grid{ grid-template-columns: 1fr; }
  .flashcard, #learn-box, #question-box{ font-size: 20px; min-height: 100px; }
  .pg-input{ flex-basis: 100%; }
}

@media (max-width: 480px){
  .sidebar{ flex-wrap: wrap; gap: 6px; }
  .sidebar button{ min-width: 120px; font-size: 13px; padding: 8px; }
  button{ font-size: 14px; }
  #options li{ font-size: 15px; }
  .flashcard, #learn-box, #question-box{ font-size: 18px; }
}

/* Reserve room so content isn't covered by the fixed flyout on desktop */
@media (min-width: 769px){
  .main-content{ padding-bottom: 360px; }
}
/* Extra helper for inline diff highlighting in Practice Grammar */
.diff-wrong { color: var(--red); font-weight: 600; }

/* Optional: nicer spacing inside Learn card */
.learn-word { font-size: 3.5em; margin-bottom: 6px; }
.learn-meaning { font-size: 0.95em; margin-top: 6px; }

/* Learn: word + speaker icon side-by-side */
.learn-word-row{
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

/* Small circular icon button (speaker) */
.icon-btn{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  min-width: 38px;
  min-height: 38px;
  border-radius: 999px;
  background: var(--sidebar-btn);
  color: #fff;
  border: none;
  cursor: pointer;
  transition: background .18s ease, transform .06s ease, box-shadow .18s ease;
}
.icon-btn:hover{ background: var(--sidebar-btn-hover); }
.icon-btn:disabled{ opacity: .5; cursor: not-allowed; }

/* Toast for non-blocking messages */
.toast{
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%) translateY(20px);
  background: #111;
  color: #fff;
  padding: 10px 14px;
  border-radius: 999px;
  font-size: 14px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .18s ease, transform .18s ease;
  z-index: 99999;
}
.toast.show{
  opacity: .95;
  transform: translateX(-50%) translateY(0);
}
/* Optional: make Next lighter by default; it’s secondary to Submit */
#write-next { background: #6b7280; }
#write-next:hover { background: #4b5563; }
.learn-note-card { margin-top: 12px; }
.learn-note-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom:8px;
}
.learn-note-label{ font-weight:600; }
.learn-note-status{ font-size: 12px; }
.learn-note-input{
  width: 100%;
  min-height: 72px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  outline: none;
  resize: vertical;
  background: #fff;
  transition: box-shadow .18s ease, border-color .18s ease;
}
.learn-note-input:focus{
  border-color: #60a5fa;
  box-shadow: 0 0 0 4px rgba(59,130,246,.15);
}

/* style.css (new styles for Marked Words feature) */
/* Make the Unmark button red (danger style) */
button.unmark-btn {
  background: var(--red);
}
button.unmark-btn:hover {
  background: #b91c1c; /* a slightly darker red on hover */
}

/* Style each marked word entry as a card with spaced content */
.marked-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  box-shadow: var(--shadow);              /* reuse base card styling if using a preprocessor, or manually ensure same base styles */
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
/* Optional AI loading tint */
.pg-feedback.loading { background: var(--warning); color: #7c2d12; }

.k2hm-col{ list-style:none; padding:0; margin:0; }
.k2hm-col li{ margin: 6px 0; padding: 10px; background: var(--card); border:1px solid var(--border); border-radius:10px; cursor:pointer; }
.k2hm-col li:hover{ background:#f2f4f7; }
.k2hm-col li.selected{ outline: 2px solid #a5b4fc; background:#eef2ff; }