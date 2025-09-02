// firebase.js — load with <script type="module" src="firebase.js">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, query, orderBy, limit, onSnapshot, addDoc,
  runTransaction, getDocs, increment, writeBatch, deleteDoc,
  collectionGroup
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* ------------------------------------------------------------------
   Firebase project config
------------------------------------------------------------------- */
// const firebaseConfig = {
//   apiKey: "AIzaSyCP-JzANiomwA-Q5MB5fnNoz0tUjdNX3Og",
//   authDomain: "japanese-n5-53295.firebaseapp.com",
//   projectId: "japanese-n5-53295",
//   storageBucket: "japanese-n5-53295.firebasestorage.app",
//   messagingSenderId: "176625372154",
//   appId: "1:176625372154:web:66acdaf3304e9ed03e7243",
//   measurementId: "G-JQ03SE08KW"
// };
//For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCIAoRM5KuCC6beLAAIHZief0wIiZOcu8I",
  authDomain: "cool-kit-469207-r6.firebaseapp.com",
  projectId: "cool-kit-469207-r6",
  storageBucket: "cool-kit-469207-r6.firebasestorage.app",
  messagingSenderId: "801430687128",
  appId: "1:801430687128:web:d30d5c33ac1b7b06a62fed",
  measurementId: "G-9KB1WBZ847"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const provider = new GoogleAuthProvider();

/* ------------------------------------------------------------------
   Constants / helpers
------------------------------------------------------------------- */
const TASK_BONUS = 10; // per task completed

const el = (id) => document.getElementById(id);
const gate       = el('auth-gate');
const appRoot    = el('app-root');
const authBtn    = el('auth-btn');
const authErr    = el('auth-error');

const todoFlyout = el('todo-flyout');
const todoTimer  = el('todo-timer');
const todoList   = el('todo-list');
const adminRow   = el('admin-row');
const adminInput = el('admin-task-input');
const adminAdd   = el('admin-task-add');

const overallLbList = el('overall-leaderboard-list');
const todaysLbList  = el('todays-leaderboard-list');

const showError = (msg) => { if (authErr) { authErr.textContent = msg; authErr.style.display = 'block'; } };
const hideError = () => { if (authErr) authErr.style.display = 'none'; };

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function endOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0);
}
function startCountdown() {
  if (!todoTimer) return;
  const tick = () => {
    const ms = endOfToday() - new Date();
    if (ms <= 0) { todoTimer.textContent = "00:00:00"; return; }
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    todoTimer.textContent = `${h}:${m}:${sec}`;
  };
  tick();
  setInterval(tick, 1000);
}
// --- Notes helpers ---
// Map path: users/{uid}/notes/{deckName}  (fields: wordKey -> note string)

window.__fb_fetchNotes = async function(deckName){
  try {
    if (!auth.currentUser) return {}; // not signed in -> let frontend fall back to localStorage
    const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    const ref = doc(db, "users", auth.currentUser.uid, "notes", deckName);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() || {}) : {};
  } catch (e) {
    console.warn("[notes] fetchNotes failed:", e?.message || e);
    return {};
  }
};

window.__fb_saveNote = async function({ deckName, wordKey, note }){
  try {
    if (!auth.currentUser) throw new Error("not-signed-in");
    const { doc, setDoc, deleteField } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    const ref = doc(db, "users", auth.currentUser.uid, "notes", deckName);
    // empty note -> remove field, else set field
    const payload = {};
    payload[wordKey] = (note && note.trim().length) ? note : deleteField();
    await setDoc(ref, payload, { merge: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};


/* ------------------------------------------------------------------
   Full Reset (wipe this user's data but keep sign-in)
------------------------------------------------------------------- */
window.__fb_fullReset = async function () {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const uid = user.uid;
  const refs = [];

  // attempts
  const attemptsSnap = await getDocs(collection(db, 'users', uid, 'attempts'));
  attemptsSnap.forEach(d => refs.push(d.ref));

  // daily aggregate docs (collect day IDs to clear dailyLeaderboard)
  const dailySnap = await getDocs(collection(db, 'users', uid, 'daily'));
  const dayIds = [];
  dailySnap.forEach(d => { refs.push(d.ref); dayIds.push(d.id); });

  // overall aggregate placeholder
  refs.push(doc(db, 'users', uid, 'overall', 'stats'));

  // taskCompletion/{date}/tasks/*
  const tcDatesSnap = await getDocs(collection(db, 'users', uid, 'taskCompletion'));
  for (const dateDoc of tcDatesSnap.docs) {
    const dateId = dateDoc.id;
    const tasksSnap = await getDocs(collection(db, 'users', uid, 'taskCompletion', dateId, 'tasks'));
    tasksSnap.forEach(t => refs.push(t.ref));
  }

  // ensure we also nuke today's status mirrors
  const today = localDateKey();
  const todaysTasks = await getDocs(collection(db, 'dailyTasks', today, 'tasks'));
  for (const t of todaysTasks.docs) {
    refs.push(doc(db, 'users', uid, 'taskCompletion', today, 'tasks', t.id));
  }

  // leaderboard docs
  refs.push(doc(db, 'overallLeaderboard', uid));
  for (const dateId of dayIds) {
    refs.push(doc(db, 'dailyLeaderboard', dateId, 'users', uid));
  }

  // batched deletes
  const CHUNK = 450;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (let j = i; j < Math.min(i + CHUNK, refs.length); j++) {
      batch.delete(refs[j]);
    }
    await batch.commit();
  }

  // Best-effort: delete empty taskCompletion parents
  try {
    for (const dateDoc of tcDatesSnap.docs) await deleteDoc(dateDoc.ref);
    await deleteDoc(doc(db, 'users', uid, 'taskCompletion', today));
  } catch (e) {
    console.warn('Non-fatal: could not delete some taskCompletion parent docs', e);
  }

  // Recreate placeholder rows for today & overall
  const us = await getDoc(doc(db, 'users', uid));
  const displayName = us.exists() ? (us.data().displayName || 'Anonymous') : 'Anonymous';

  await Promise.all([
    setDoc(doc(db, 'overallLeaderboard', uid), {
      uid, displayName,
      jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0,
      tasksCompleted: 0,
      score: 0, updatedAt: serverTimestamp()
    }, { merge: true }),
    setDoc(doc(db, 'dailyLeaderboard', today, 'users', uid), {
      uid, displayName,
      jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0,
      tasksCompleted: 0,
      score: 0, updatedAt: serverTimestamp()
    }, { merge: true }),
    setDoc(doc(db, 'users', uid, 'daily', today), {
      date: today, displayName,
      jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0,
      tasksCompleted: 0,
      score: 0, updatedAt: serverTimestamp()
    }, { merge: true }),
  ]);
};

/* ------------------------------------------------------------------
   Auth
------------------------------------------------------------------- */
authBtn?.addEventListener('click', async () => {
  try {
    hideError();
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.warn('[auth] Popup sign-in failed:', e?.code, e?.message);
    showError(e?.message || 'Sign-in failed');
  }
});

let unsubTodayLB = null;
let unsubOverallLB = null;
let unsubTasksDaily = null;
let unsubTasksStatus = null;

onAuthStateChanged(auth, async (user) => {
  try {
    if (user) {
      gate?.classList.add('hidden'); if (gate) gate.style.display = 'none';
      appRoot?.classList.remove('hidden'); if (appRoot) appRoot.style.display = 'block';
      todoFlyout?.classList.remove('hidden'); if (todoFlyout) todoFlyout.style.display = '';

      // Ensure base user doc
      const uref = doc(db, 'users', user.uid);
      const usnap = await getDoc(uref);
      if (!usnap.exists()) {
        await setDoc(uref, {
          displayName: user.displayName || 'Anonymous',
          photoURL: user.photoURL || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(uref, { updatedAt: serverTimestamp() });
      }

      // Admin UI toggle
      if (adminRow) {
        try {
          const adminSnap = await getDoc(doc(db, 'admins', user.uid));
          adminRow.classList.toggle('hidden', !adminSnap.exists());
        } catch {
          adminRow.classList.add('hidden');
        }
      }

      // Admin add-task
      if (adminAdd && adminInput) {
        adminAdd.onclick = async () => {
          const text = (adminInput.value || '').trim();
          if (!text) return;
          const dkey = localDateKey();
          await addDoc(collection(db, 'dailyTasks', dkey, 'tasks'), { text, createdAt: serverTimestamp() });
          adminInput.value = '';
        };
      }

      // Start streams
      startCountdown();
      if (todoList) subscribeTodayTasks(user.uid);
      if (todaysLbList) subscribeTodaysLeaderboard();
      if (overallLbList) subscribeOverallLeaderboard();

      // Auto-commit any pending session left locally
      try { await __fb_commitLocalPendingSession(); } catch (e) {
        console.warn('[pending-session] commit skipped:', e?.message || e);
      }

      // Let app JS continue
      window.__initAfterLogin?.();
    } else {
      appRoot?.classList.add('hidden'); if (appRoot) appRoot.style.display = 'none';
      gate?.classList.remove('hidden'); if (gate) gate.style.display = '';
      todoFlyout?.classList.add('hidden'); if (todoFlyout) todoFlyout.style.display = 'none';

      if (unsubTodayLB) { unsubTodayLB(); unsubTodayLB = null; }
      if (unsubOverallLB) { unsubOverallLB(); unsubOverallLB = null; }
      if (unsubTasksDaily)  { unsubTasksDaily();  unsubTasksDaily  = null; }
      if (unsubTasksStatus) { unsubTasksStatus(); unsubTasksStatus = null; }
    }
  } catch (err) {
    console.error('[auth] onAuthStateChanged handler error:', err);
    showError(err?.message || 'Unexpected error');
  }
});

/* ------------------------------------------------------------------
   Today’s Tasks (To‑Do)
------------------------------------------------------------------- */
async function subscribeTodayTasks(uid) {
  if (!todoList) return;
  const dkey = localDateKey();

  // caches from streams
  let lastTasks = [];     // [{id,text}]
  let lastStatusMap = {}; // {taskId: {done}}

  const renderTodos = () => {
    todoList.innerHTML = '';
    if (lastTasks.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No tasks yet for today.';
      li.className = 'todo-empty';
      todoList.appendChild(li);
      return;
    }
    lastTasks.forEach(t => {
      const li = document.createElement('li');
      li.className = 'todo-item';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!(lastStatusMap[t.id]?.done);

      const label = document.createElement('span');
      label.textContent = t.text || '(untitled task)';

      chk.onchange = async () => {
        await markTask(uid, dkey, t.id, label.textContent, chk.checked);
      };

      li.append(chk, label);
      todoList.appendChild(li);
    });
  };

  if (unsubTasksDaily)  { unsubTasksDaily();  unsubTasksDaily  = null; }
  if (unsubTasksStatus) { unsubTasksStatus(); unsubTasksStatus = null; }

  // Stream of shared tasks
  unsubTasksDaily = onSnapshot(collection(db, 'dailyTasks', dkey, 'tasks'), (ss) => {
    const arr = [];
    ss.forEach((docSnap) => arr.push({ id: docSnap.id, ...docSnap.data() }));
    lastTasks = arr;
    renderTodos();
  });

  // Stream of your status docs
  unsubTasksStatus = onSnapshot(collection(db, 'users', uid, 'taskCompletion', dkey, 'tasks'), (statusQs) => {
    const map = {};
    statusQs.forEach(s => map[s.id] = s.data());
    lastStatusMap = map;
    renderTodos();
  });
}

// Toggle a task + mirror to daily leaderboard
async function markTask(uid, dkey, taskId, text, done) {
  const statusRef = doc(db, 'users', uid, 'taskCompletion', dkey, 'tasks', taskId);
  const dailyRef  = doc(db, 'users', uid, 'daily', dkey);
  const lbRef     = doc(db, 'dailyLeaderboard', dkey, 'users', uid);
  const uref      = doc(db, 'users', uid);

  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(uref);
    const displayName = userSnap.exists() ? (userSnap.data().displayName || 'Anonymous') : 'Anonymous';

    const ds = await tx.get(dailyRef);
    const data = ds.exists() ? ds.data() : { jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0, tasksCompleted: 0 };

    let tasksCompleted = data.tasksCompleted || 0;
    const statusSnap = await tx.get(statusRef);
    const prev = statusSnap.exists() ? !!statusSnap.data().done : false;

    if (done && !prev) tasksCompleted += 1;
    if (!done && prev) tasksCompleted = Math.max(0, tasksCompleted - 1);

    tx.set(statusRef, {
      done, text, updatedAt: serverTimestamp(), ...(done ? { completedAt: serverTimestamp() } : {})
    }, { merge: true });

    const jpEn = data.jpEnCorrect   || 0;
    const enJp = data.enJpCorrect   || 0;
    const gram = data.grammarCorrect|| 0;

    // Score formula: 1 point per correct answer across all modes + task bonus
    const score = jpEn + enJp + gram + tasksCompleted * TASK_BONUS;

    tx.set(dailyRef, {
      date: dkey, displayName,
      jpEnCorrect: jpEn,
      enJpCorrect: enJp,
      grammarCorrect: gram,
      tasksCompleted,
      score,
      updatedAt: serverTimestamp()
    }, { merge: true });

    tx.set(lbRef, {
      uid, displayName,
      jpEnCorrect: jpEn,
      enJpCorrect: enJp,
      grammarCorrect: gram,
      tasksCompleted,
      score,
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
}

/* ------------------------------------------------------------------
   Leaderboards
   - Overall = SUM of all dailyLeaderboard/{date}/users per uid
   - Today   = dailyLeaderboard/{YYYY-MM-DD}/users
------------------------------------------------------------------- */
function subscribeOverallLeaderboard() {
  if (!overallLbList) return;

  const cg = collectionGroup(db, 'users'); // 'dailyLeaderboard/{date}/users/{uid}'
  if (unsubOverallLB) unsubOverallLB();

  unsubOverallLB = onSnapshot(cg, (ss) => {
    const agg = new Map();
    ss.forEach(docSnap => {
      const d = docSnap.data() || {};
      const uid = d.uid || docSnap.id;
      if (!agg.has(uid)) {
        agg.set(uid, {
          uid,
          displayName: d.displayName || 'Anonymous',
          jpEnCorrect: 0,
          enJpCorrect: 0,
          grammarCorrect: 0,
          tasksCompleted: 0,
          score: 0
        });
      }
      const row = agg.get(uid);
      row.jpEnCorrect    += d.jpEnCorrect    || 0;
      row.enJpCorrect    += d.enJpCorrect    || 0;
      row.grammarCorrect += d.grammarCorrect || 0;
      row.tasksCompleted += d.tasksCompleted || 0;
      row.score          += d.score          || 0;

      if (d.displayName) row.displayName = d.displayName;
    });

    const rows = [...agg.values()]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 50);

    overallLbList.innerHTML = '';
    let rank = 1;
    rows.forEach(u => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="lb-row">
          <span class="lb-rank">#${rank++}</span>
          <span class="lb-name">${u.displayName || 'Anonymous'}</span>
          <span class="lb-part">JP→EN: <b>${u.jpEnCorrect || 0}</b></span>
          <span class="lb-part">EN→JP: <b>${u.enJpCorrect || 0}</b></span>
          <span class="lb-part">Grammar: <b>${u.grammarCorrect || 0}</b></span>
          <span class="lb-part">Tasks: <b>${u.tasksCompleted || 0}</b></span>
          <span class="lb-score">${u.score || 0} pts</span>
        </div>`;
      overallLbList.appendChild(li);
    });
  }, (err) => console.error('[overall LB] snapshot error:', err));
}

function subscribeTodaysLeaderboard() {
  if (!todaysLbList) return;
  const dkey = localDateKey();
  const qy = query(collection(db, 'dailyLeaderboard', dkey, 'users'), orderBy('score', 'desc'), limit(50));
  if (unsubTodayLB) unsubTodayLB();

  unsubTodayLB = onSnapshot(qy, (ss) => {
    todaysLbList.innerHTML = '';
    let rank = 1;
    ss.forEach(docSnap => {
      const u = docSnap.data();
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="lb-row">
          <span class="lb-rank">#${rank++}</span>
          <span class="lb-name">${u.displayName || 'Anonymous'}</span>
          <span class="lb-part">JP→EN: <b>${u.jpEnCorrect || 0}</b></span>
          <span class="lb-part">EN→JP: <b>${u.enJpCorrect || 0}</b></span>
          <span class="lb-part">Grammar: <b>${u.grammarCorrect || 0}</b></span>
          <span class="lb-part">Tasks: <b>${u.tasksCompleted || 0}</b></span>
          <span class="lb-score">${u.score || 0} pts</span>
        </div>`;
      todaysLbList.appendChild(li);
    });
  }, (err) => console.error('[today LB] snapshot error:', err));
}

/* ------------------------------------------------------------------
   Commit a buffered session (single write burst)
   Accepts vocab (JP→EN / EN→JP) and grammar sessions.
------------------------------------------------------------------- */
/**
 * @param {{
 *   deckName: string,
 *   mode: 'jp-en'|'en-jp'|'grammar',
 *   correct: number, wrong: number, skipped: number, total: number,
 *   jpEnCorrect?: number, enJpCorrect?: number, grammarCorrect?: number
 * }} payload
 */
window.__fb_commitSession = async function (payload) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const {
    deckName = 'Unknown Deck',
    mode = 'jp-en',
    correct = 0, wrong = 0, skipped = 0, total = 0,
    jpEnCorrect = 0, enJpCorrect = 0, grammarCorrect = 0
  } = payload || {};

  const dkey = localDateKey();
  const uref = doc(db, 'users', user.uid);
  const dailyRef = doc(db, 'users', user.uid, 'daily', dkey);
  const lbDaily  = doc(db, 'dailyLeaderboard', dkey, 'users', user.uid);
  const attemptsCol = collection(db, 'users', user.uid, 'attempts');

  // ensure displayName
  const usnap = await getDoc(uref);
  const displayName = usnap.exists() ? (usnap.data().displayName || 'Anonymous') : 'Anonymous';

  // ensure daily & lb docs exist
  await Promise.all([
    setDoc(dailyRef, { date: dkey, uid: user.uid, displayName }, { merge: true }),
    setDoc(lbDaily,  { uid: user.uid, displayName }, { merge: true }),
  ]);

  // batch everything
  const batch = writeBatch(db);

  // Attempt record (keep the mode; useful for history)
  const attemptDoc = doc(attemptsCol);
  batch.set(attemptDoc, {
    deckName, mode, correct, wrong, skipped, total,
    createdAt: Date.now(), createdAtServer: serverTimestamp()
  });

  // Increments for daily + leaderboard mirrors
  // Score: 1 point per correct answer across all three modes
  const scoreInc = (jpEnCorrect || 0) + (enJpCorrect || 0) + (grammarCorrect || 0);

  const incsDaily = {
    updatedAt: serverTimestamp(),
    jpEnCorrect: increment(jpEnCorrect || 0),
    enJpCorrect: increment(enJpCorrect || 0),
    grammarCorrect: increment(grammarCorrect || 0),
    score: increment(scoreInc)
  };
  const incsLB = {
    updatedAt: serverTimestamp(),
    jpEnCorrect: increment(jpEnCorrect || 0),
    enJpCorrect: increment(enJpCorrect || 0),
    grammarCorrect: increment(grammarCorrect || 0),
    score: increment(scoreInc)
  };

  batch.set(dailyRef, incsDaily, { merge: true });
  batch.set(lbDaily,  incsLB,    { merge: true });

  await batch.commit();
};

/* ------------------------------------------------------------------
   Commit any locally pending session after sign-in
------------------------------------------------------------------- */
async function __fb_commitLocalPendingSession() {
  const raw = localStorage.getItem('pendingSession');
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    localStorage.removeItem('pendingSession');
    return;
  }
  if (!payload || !payload.total) {
    localStorage.removeItem('pendingSession');
    return;
  }
  await window.__fb_commitSession(payload);
  localStorage.removeItem('pendingSession');
}

/* ------------------------------------------------------------------
   Progress feed: recent attempts
------------------------------------------------------------------- */
window.__fb_fetchAttempts = async function (limitN = 20) {
  const user = getAuth().currentUser;
  if (!user) return [];
  const db = getFirestore();

  const colRef = collection(db, 'users', user.uid, 'attempts');
  const qy = query(colRef, orderBy('createdAt', 'desc'), limit(limitN));

  const snap = await getDocs(qy);
  const list = [];
  snap.forEach(docSnap => {
    const d = docSnap.data() || {};
    const ts = d.createdAt || (d.createdAtServer?.toMillis ? d.createdAtServer.toMillis() : Date.now());
    list.push({ id: docSnap.id, ...d, createdAt: ts });
  });
  return list;
};

/* ------------------------------------------------------------------
   Marked Words (Favorites) Helpers
------------------------------------------------------------------- */
window.__fb_fetchMarkedWords = async function () {
  try {
    const user = auth.currentUser;
    if (!user) return [];
    const colRef = collection(db, 'users', user.uid, 'markedWords');
    const snapshot = await getDocs(colRef);
    const result = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data && data.front) {
        result.push({ front: data.front, back: data.back, romaji: data.romaji || "" });
      }
    });
    return result;
  } catch (e) {
    console.warn("[markedWords] fetch error:", e);
    return [];
  }
};

window.__fb_markWord = async function(wordObj) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const docRef = doc(db, 'users', user.uid, 'markedWords', wordObj.front + '|' + wordObj.back);
    await setDoc(docRef, {
      front: wordObj.front,
      back: wordObj.back,
      romaji: wordObj.romaji || ""
    });
    return { ok: true };
  } catch (e) {
    console.error("Error marking word:", e);
    return { ok: false, error: e.message || String(e) };
  }
};

window.__fb_unmarkWord = async function(wordKey) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const docRef = doc(db, 'users', user.uid, 'markedWords', wordKey);
    await deleteDoc(docRef);
    return { ok: true };
  } catch (e) {
    console.error("Error unmarking word:", e);
    return { ok: false, error: e.message || String(e) };
  }
};

// Expose sign out
window.__signOut = () => signOut(auth);

