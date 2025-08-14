// firebase.js — load with <script type="module" src="firebase.js">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, query, orderBy, limit, onSnapshot, addDoc,
  runTransaction, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// --- Firebase project config ---
const firebaseConfig = {
  apiKey: "AIzaSyCP-JzANiomwA-Q5MB5fnNoz0tUjdNX3Og",
  authDomain: "japanese-n5-53295.firebaseapp.com",
  projectId: "japanese-n5-53295",
  storageBucket: "japanese-n5-53295.firebasestorage.app",
  messagingSenderId: "176625372154",
  appId: "1:176625372154:web:66acdaf3304e9ed03e7243",
  measurementId: "G-JQ03SE08KW"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- DOM refs (may be null) ---
const gate       = document.getElementById('auth-gate');
const appRoot    = document.getElementById('app-root');
const authBtn    = document.getElementById('auth-btn');
const authErr    = document.getElementById('auth-error');

const todoFlyout = document.getElementById('todo-flyout');
const todoTimer  = document.getElementById('todo-timer');
const todoList   = document.getElementById('todo-list');
const adminRow   = document.getElementById('admin-row');
const adminInput = document.getElementById('admin-task-input');
const adminAdd   = document.getElementById('admin-task-add');

const overallLbList = document.getElementById('overall-leaderboard-list');
const todaysLbList  = document.getElementById('todays-leaderboard-list');

// --- Helpers ---
const TASK_BONUS = 10;

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
  function tick() {
    const ms = endOfToday() - new Date();
    if (ms <= 0) { todoTimer.textContent = "00:00:00"; return; }
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    todoTimer.textContent = `${h}:${m}:${sec}`;
  }
  tick();
  setInterval(tick, 1000);
}

// --- Sign-in ---
authBtn?.addEventListener('click', async () => {
  try {
    hideError();
    console.log('[auth] Trying signInWithPopup…');
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.warn('[auth] Popup sign-in failed:', e?.code, e?.message);
    showError(e?.message || 'Sign-in failed');
  }
});

let unsubTodayLB = null;
let unsubOverallLB = null;
let unsubTasks = null;

onAuthStateChanged(auth, async (user) => {
  const found = {
    gate: !!gate, appRoot: !!appRoot, todoFlyout: !!todoFlyout,
    todoTimer: !!todoTimer, todoList: !!todoList,
    adminRow: !!adminRow, adminInput: !!adminInput, adminAdd: !!adminAdd,
    overallLbList: !!overallLbList, todaysLbList: !!todaysLbList
  };
  console.log('[auth] state changed →', user ? 'SIGNED IN' : 'SIGNED OUT', user?.uid || '');
  console.log('[auth] elements found:', found);

  try {
    if (user) {
      if (gate) { gate.classList.add('hidden'); gate.style.display = 'none'; }
      if (appRoot) { appRoot.classList.remove('hidden'); appRoot.style.display = 'block'; }
      if (todoFlyout) { todoFlyout.classList.remove('hidden'); todoFlyout.style.display = ''; }

      // Ensure base user doc exists
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

      // Admin UI
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
          await addDoc(collection(db, 'dailyTasks', dkey, 'tasks'), {
            text, createdAt: serverTimestamp()
          });
          adminInput.value = '';
        };
      }

      // Start optional UI bits
      startCountdown();
      if (todoList) subscribeTodayTasks(user.uid);

      if (todaysLbList) subscribeTodaysLeaderboard();
      if (overallLbList) subscribeOverallLeaderboard();

      // let app JS continue
      window.__initAfterLogin?.();

      console.log('[auth] gate hidden + app shown');
    } else {
      if (appRoot) { appRoot.classList.add('hidden'); appRoot.style.display = 'none'; }
      if (gate) { gate.classList.remove('hidden'); gate.style.display = ''; }
      if (todoFlyout) { todoFlyout.classList.add('hidden'); todoFlyout.style.display = 'none'; }

      if (unsubTodayLB) { unsubTodayLB(); unsubTodayLB = null; }
      if (unsubOverallLB) { unsubOverallLB(); unsubOverallLB = null; }
      if (unsubTasks) { unsubTasks(); unsubTasks = null; }

      console.log('[auth] gate shown + app hidden');
    }
  } catch (err) {
    console.error('[auth] onAuthStateChanged handler error:', err);
    showError(err?.message || 'Unexpected error');
  }
});

// --- Today’s tasks (To-Do) ---
async function subscribeTodayTasks(uid) {
  if (!todoList) return;
  const dkey = localDateKey();

  if (unsubTasks) unsubTasks();
  unsubTasks = onSnapshot(collection(db, 'dailyTasks', dkey, 'tasks'), async (ss) => {
    const tasks = [];
    ss.forEach((docSnap) => tasks.push({ id: docSnap.id, ...docSnap.data() }));

    // Load user's completion statuses
    const statusQs = await getDocs(collection(db, 'users', uid, 'taskCompletion', dkey, 'tasks'));
    const statusMap = {};
    statusQs.forEach(s => statusMap[s.id] = s.data());

    // Render
    todoList.innerHTML = '';
    if (tasks.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No tasks yet for today.';
      li.className = 'todo-empty';
      todoList.appendChild(li);
    }
    tasks.forEach(t => {
      const li = document.createElement('li');
      li.className = 'todo-item';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!(statusMap[t.id]?.done);

      const label = document.createElement('span');
      label.textContent = t.text || '(untitled task)';

      chk.onchange = async () => {
        await markTask(uid, dkey, t.id, label.textContent, chk.checked);
      };

      li.append(chk, label);
      todoList.appendChild(li);
    });
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
    const data = ds.exists() ? ds.data() : { jpEnCorrect: 0, enJpCorrect: 0, tasksCompleted: 0 };

    let tasksCompleted = data.tasksCompleted || 0;
    const statusSnap = await tx.get(statusRef);
    const prev = statusSnap.exists() ? !!statusSnap.data().done : false;

    if (done && !prev) tasksCompleted += 1;
    if (!done && prev) tasksCompleted = Math.max(0, tasksCompleted - 1);

    tx.set(statusRef, {
      done, text, updatedAt: serverTimestamp(), ...(done ? { completedAt: serverTimestamp() } : {})
    }, { merge: true });

    const jpEn = data.jpEnCorrect || 0;
    const enJp = data.enJpCorrect || 0;
    const score = jpEn + enJp + tasksCompleted * TASK_BONUS;

    tx.set(dailyRef, {
      date: dkey, displayName,
      jpEnCorrect: jpEn,
      enJpCorrect: enJp,
      tasksCompleted,
      score,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // Mirror to today's leaderboard only
    tx.set(lbRef, {
      uid, displayName, jpEnCorrect: jpEn, enJpCorrect: enJp,
      tasksCompleted, score, updatedAt: serverTimestamp()
    }, { merge: true });
  });
}

/* ------------------------------
   Leaderboards
   - Overall leaderboard (from start) → collection: overallLeaderboard (docs keyed by uid)
   - Today's leaderboard (daily)      → collection: dailyLeaderboard/{dkey}/users
--------------------------------- */

// Overall (from start) — truly dynamic subscription
function subscribeOverallLeaderboard() {
  if (!overallLbList) return;
  const qy = query(collection(db, 'overallLeaderboard'), orderBy('score', 'desc'), limit(50));
  if (unsubOverallLB) unsubOverallLB();
  unsubOverallLB = onSnapshot(qy, (ss) => {
    overallLbList.innerHTML = '';
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
          <span class="lb-part">Tasks: <b>${u.tasksCompleted || 0}</b></span>
          <span class="lb-score">${u.score || 0} pts</span>
        </div>`;
      overallLbList.appendChild(li);
    });
  });
}

// Today's (date-scoped)
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
          <span class="lb-part">Tasks: <b>${u.tasksCompleted || 0}</b></span>
          <span class="lb-score">${u.score || 0} pts</span>
        </div>`;
      todaysLbList.appendChild(li);
    });
  });
}

/* ------------------------------
   Recording answers & attempts
--------------------------------- */

// Per-correct answer: updates TODAY and OVERALL live
window.__fb_recordAnswer = async function ({ deckName = 'unknown', mode = 'jp-en', isCorrect = false } = {}) {
  const user = auth.currentUser;
  if (!user || !isCorrect) return;

  const dkey = localDateKey();
  const dailyRef = doc(db, 'users', user.uid, 'daily', dkey);
  const lbDaily  = doc(db, 'dailyLeaderboard', dkey, 'users', user.uid);

  const overallRef = doc(db, 'users', user.uid, 'overall', 'stats');
  const lbOverall  = doc(db, 'overallLeaderboard', user.uid);
  const uref       = doc(db, 'users', user.uid);

  await runTransaction(db, async (tx) => {
    const usnap = await tx.get(uref);
    const displayName = usnap.exists() ? (usnap.data().displayName || 'Anonymous') : 'Anonymous';

    // --- Daily aggregate (for today's leaderboard)
    const ds = await tx.get(dailyRef);
    let d = ds.exists() ? ds.data() : { jpEnCorrect: 0, enJpCorrect: 0, tasksCompleted: 0 };
    if (mode === 'jp-en') d.jpEnCorrect = (d.jpEnCorrect || 0) + 1;
    else d.enJpCorrect = (d.enJpCorrect || 0) + 1;
    const scoreD = (d.jpEnCorrect || 0) + (d.enJpCorrect || 0) + (d.tasksCompleted || 0) * TASK_BONUS;

    tx.set(dailyRef, {
      date: dkey, displayName,
      jpEnCorrect: d.jpEnCorrect || 0,
      enJpCorrect: d.enJpCorrect || 0,
      tasksCompleted: d.tasksCompleted || 0,
      score: scoreD,
      updatedAt: serverTimestamp()
    }, { merge: true });

    tx.set(lbDaily, {
      uid: user.uid, displayName,
      jpEnCorrect: d.jpEnCorrect || 0,
      enJpCorrect: d.enJpCorrect || 0,
      tasksCompleted: d.tasksCompleted || 0,
      score: scoreD,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // --- OVERALL aggregate (since start)
    const os = await tx.get(overallRef);
    let o = os.exists() ? os.data() : { jpEnCorrect: 0, enJpCorrect: 0, tasksCompleted: 0 };
    if (mode === 'jp-en') o.jpEnCorrect = (o.jpEnCorrect || 0) + 1;
    else o.enJpCorrect = (o.enJpCorrect || 0) + 1;
    const scoreO = (o.jpEnCorrect || 0) + (o.enJpCorrect || 0) + (o.tasksCompleted || 0) * TASK_BONUS;

    tx.set(overallRef, {
      jpEnCorrect: o.jpEnCorrect || 0,
      enJpCorrect: o.enJpCorrect || 0,
      tasksCompleted: o.tasksCompleted || 0,
      score: scoreO,
      updatedAt: serverTimestamp()
    }, { merge: true });

    tx.set(lbOverall, {
      uid: user.uid, displayName,
      jpEnCorrect: o.jpEnCorrect || 0,
      enJpCorrect: o.enJpCorrect || 0,
      tasksCompleted: o.tasksCompleted || 0,
      score: scoreO,
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
};

// End of a practice run: store an attempt document for Progress page
window.__fb_finishAttempt = async function ({ deckName, mode, correct, wrong, skipped, total }) {
  const user = auth.currentUser;
  if (!user) return;

  const attemptsCol = collection(db, 'users', user.uid, 'attempts');
  await addDoc(attemptsCol, {
    deckName, mode, correct, wrong, skipped, total,
    createdAt: Date.now(), // client timestamp for quick display
    createdAtServer: serverTimestamp()
  });

  // touch leaderboard docs so live listeners refresh even if numbers unchanged right now
  await __touchLeaderboardDocs(user.uid);
};

// NEW: Save Score on demand (manual attempt + touch leaderboards)
window.__fb_saveScore = async function ({ deckName, mode, correct, wrong, skipped, total }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const attemptsCol = collection(db, 'users', user.uid, 'attempts');
  await addDoc(attemptsCol, {
    deckName, mode, correct, wrong, skipped, total,
    createdAt: Date.now(),
    createdAtServer: serverTimestamp()
  });

  // Ensure leaderboard docs exist and bump updatedAt so onSnapshot redraws
  await __touchLeaderboardDocs(user.uid);
};

// Fetch recent attempts (for Progress page)
window.__fb_fetchAttempts = async function (limitN = 20) {
  const user = auth.currentUser;
  if (!user) return [];
  const colRef = collection(db, 'users', user.uid, 'attempts');
  const qy = query(colRef, orderBy('createdAt', 'desc'), limit(limitN));
  const snap = await getDocs(qy);
  const list = [];
  snap.forEach(docSnap => {
    const d = docSnap.data();
    const ts = d.createdAt || (d.createdAtServer?.toMillis ? d.createdAtServer.toMillis() : Date.now());
    list.push({ id: docSnap.id, ...d, createdAt: ts });
  });
  return list;
};

// Ensure leaderboard docs exist and update their updatedAt
async function __touchLeaderboardDocs(uid) {
  const user = auth.currentUser;
  if (!user) return;

  const uref = doc(db, 'users', uid);
  const usnap = await getDoc(uref);
  const displayName = usnap.exists() ? (usnap.data().displayName || 'Anonymous') : 'Anonymous';

  const dkey = localDateKey();

  const lbOverall = doc(db, 'overallLeaderboard', uid);
  const lbDaily   = doc(db, 'dailyLeaderboard', dkey, 'users', uid);

  // set with defaults if missing, but DO NOT change counts here (avoid double-counting)
  await setDoc(lbOverall, {
    uid, displayName,
    jpEnCorrect: 0, enJpCorrect: 0, tasksCompleted: 0, score: 0,
    updatedAt: serverTimestamp()
  }, { merge: true });

  await setDoc(lbDaily, {
    uid, displayName,
    jpEnCorrect: 0, enJpCorrect: 0, tasksCompleted: 0, score: 0,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Optional: expose sign out
window.__signOut = () => signOut(auth);
