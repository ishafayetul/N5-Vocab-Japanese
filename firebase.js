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
  console.log('[auth] state changed →', user ? 'SIGNED IN' : 'SIGNED OUT', user?.uid || '');
  try {
    if (user) {
      gate?.classList.add('hidden'); if (gate) gate.style.display = 'none';
      appRoot?.classList.remove('hidden'); if (appRoot) appRoot.style.display = 'block';
      todoFlyout?.classList.remove('hidden'); if (todoFlyout) todoFlyout.style.display = '';

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

      // Auto-commit any pending session stored locally (from last close)
      try {
        await __fb_commitLocalPendingSession();
      } catch (e) {
        console.warn('[pending-session] commit skipped:', e?.message || e);
      }

      // let app JS continue
      window.__initAfterLogin?.();
    } else {
      appRoot?.classList.add('hidden'); if (appRoot) appRoot.style.display = 'none';
      gate?.classList.remove('hidden'); if (gate) gate.style.display = '';
      todoFlyout?.classList.add('hidden'); if (todoFlyout) todoFlyout.style.display = 'none';

      if (unsubTodayLB) { unsubTodayLB(); unsubTodayLB = null; }
      if (unsubOverallLB) { unsubOverallLB(); unsubOverallLB = null; }
      if (unsubTasks) { unsubTasks(); unsubTasks = null; }
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
   - Overall leaderboard = SUM of all dailyLeaderboard/{date}/users per uid
   - Today's leaderboard  = dailyLeaderboard/{YYYY-MM-DD}/users
--------------------------------- */

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
          tasksCompleted: 0,
          score: 0
        });
      }
      const row = agg.get(uid);
      row.jpEnCorrect   += d.jpEnCorrect   || 0;
      row.enJpCorrect   += d.enJpCorrect   || 0;
      row.tasksCompleted+= d.tasksCompleted|| 0;
      row.score         += d.score         || 0;

      if (d.displayName) row.displayName = d.displayName;
    });

    const rows = [...agg.values()].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 50);

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
          <span class="lb-part">Tasks: <b>${u.tasksCompleted || 0}</b></span>
          <span class="lb-score">${u.score || 0} pts</span>
        </div>`;
      overallLbList.appendChild(li);
    });
  }, (err) => console.error('[overall LB] snapshot error:', err));
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
  }, (err) => console.error('[today LB] snapshot error:', err));
}

/* ------------------------------
   NEW — Commit a buffered session (single write burst)
--------------------------------- */

/**
 * Commit a buffered session to Firestore.
 * @param {{deckName:string, mode:'jp-en'|'en-jp', correct:number, wrong:number, skipped:number, total:number, jpEnCorrect:number, enJpCorrect:number}} payload
 */
window.__fb_commitSession = async function (payload) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const {
    deckName = 'Unknown Deck',
    mode = 'jp-en',
    correct = 0, wrong = 0, skipped = 0, total = 0,
    jpEnCorrect = 0, enJpCorrect = 0
  } = payload || {};

  const dkey = localDateKey();
  const uref = doc(db, 'users', user.uid);
  const dailyRef = doc(db, 'users', user.uid, 'daily', dkey);
  const lbDaily  = doc(db, 'dailyLeaderboard', dkey, 'users', user.uid);
  const attemptsCol = collection(db, 'users', user.uid, 'attempts');

  // ensure displayName
  const usnap = await getDoc(uref);
  const displayName = usnap.exists() ? (usnap.data().displayName || 'Anonymous') : 'Anonymous';

  // Make sure daily & lb docs exist before increment
  await Promise.all([
    setDoc(dailyRef, { date: dkey, uid: user.uid, displayName }, { merge: true }),
    setDoc(lbDaily,  { uid: user.uid, displayName }, { merge: true }),
  ]);

  // Batch: attempt + daily increments + lb increments
  const batch = writeBatch(db);

  // Attempt doc
  const attemptDoc = doc(attemptsCol);
  batch.set(attemptDoc, {
    deckName, mode, correct, wrong, skipped, total,
    createdAt: Date.now(), createdAtServer: serverTimestamp()
  });

  // Increments for daily aggregate + mirror on leaderboard
  const incsDaily = {
    updatedAt: serverTimestamp(),
    jpEnCorrect: increment(jpEnCorrect),
    enJpCorrect: increment(enJpCorrect),
    score: increment(jpEnCorrect + enJpCorrect) // +1 per correct answer
  };
  const incsLB = {
    updatedAt: serverTimestamp(),
    jpEnCorrect: increment(jpEnCorrect),
    enJpCorrect: increment(enJpCorrect),
    score: increment(jpEnCorrect + enJpCorrect)
  };

  batch.set(dailyRef, incsDaily, { merge: true });
  batch.set(lbDaily,  incsLB,    { merge: true });

  await batch.commit();
};

/**
 * If a pending session is in localStorage, commit it once the user is signed in.
 * Clears the pending session after success.
 */
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

// --- Progress: fetch recent attempts for the signed-in user ---
window.__fb_fetchAttempts = async function (limitN = 20) {
  const user = getAuth().currentUser; // reuse the same auth from firebase.js
  if (!user) return [];
  const db = getFirestore();

  const colRef = collection(db, 'users', user.uid, 'attempts');
  const qy = query(colRef, orderBy('createdAt', 'desc'), limit(limitN));

  const snap = await getDocs(qy);
  const list = [];
  snap.forEach(docSnap => {
    const d = docSnap.data() || {};
    // prefer client timestamp; fall back to server
    const ts = d.createdAt || (d.createdAtServer?.toMillis ? d.createdAtServer.toMillis() : Date.now());
    list.push({ id: docSnap.id, ...d, createdAt: ts });
  });
  return list;
};

// Expose sign out
window.__signOut = () => signOut(auth);
