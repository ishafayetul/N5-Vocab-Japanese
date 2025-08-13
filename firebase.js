// firebase.js  — load with <script type="module" src="firebase.js">
// const V = "10.12.4"; // bump if CDN 404s (e.g., "11.0.0")

// import { initializeApp } from `https://www.gstatic.com/firebasejs/${V}/firebase-app.js`;
// import {
//   getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
// } from `https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`;
// import {
//   getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp,
//   collection, query, orderBy, limit, onSnapshot, addDoc, deleteDoc,
//   runTransaction, getDocs, increment
// } from `https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`;

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, query, orderBy, limit, onSnapshot, addDoc, deleteDoc,
  runTransaction, getDocs, increment
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// --- Your Firebase project ---
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
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- DOM refs (exist in index.html) ---
const gate     = document.getElementById('auth-gate');
const appRoot  = document.getElementById('app-root');
const authBtn  = document.getElementById('auth-btn');
const authErr  = document.getElementById('auth-error');

const todoFlyout = document.getElementById('todo-flyout');
const todoTimer  = document.getElementById('todo-timer');
const todoList   = document.getElementById('todo-list');
const adminRow   = document.getElementById('admin-row');
const adminInput = document.getElementById('admin-task-input');
const adminAdd   = document.getElementById('admin-task-add');

const lbList     = document.getElementById('leaderboard-list');

// --- Helpers ---
const TASK_BONUS = 10; // each completed task adds 10 points to leaderboard score

function localDateKey(d = new Date()) {
  // YYYY-MM-DD in the user's local timezone
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function endOfToday() {
  const n = new Date();
  const e = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0);
  return e;
}
function startCountdown() {
  function tick() {
    const ms = endOfToday() - new Date();
    if (ms <= 0) {
      todoTimer.textContent = "00:00:00";
      return;
    }
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    todoTimer.textContent = `${h}:${m}:${sec}`;
  }
  tick();
  setInterval(tick, 1000);
}

// --- Auth gate ---
authBtn?.addEventListener('click', async () => {
  try {
    authErr.style.display = 'none';
    await signInWithPopup(auth, provider);
  } catch (e) {
    authErr.textContent = e.message || 'Sign‑in failed';
    authErr.style.display = 'block';
  }
});

let unsubLB = null;
let unsubTasks = null;
let unsubTaskStatus = null;

onAuthStateChanged(auth, async (user) => {
  if (user) {
    gate.classList.add('hidden');
    appRoot.classList.remove('hidden');
    todoFlyout.classList.remove('hidden');

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

    // Is this user an admin?
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (adminSnap.exists()) {
      adminRow.classList.remove('hidden');
    } else {
      adminRow.classList.add('hidden');
    }

    // Hook admin add-task button
    adminAdd.onclick = async () => {
      const text = (adminInput.value || '').trim();
      if (!text) return;
      const dkey = localDateKey();
      await addDoc(collection(db, 'dailyTasks', dkey, 'tasks'), {
        text, createdAt: serverTimestamp()
      });
      adminInput.value = '';
    };

    // Start countdown
    startCountdown();

    // Subscribe to today's tasks + user statuses
    subscribeTodayTasks(user.uid);

    // Subscribe to today's leaderboard
    subscribeLeaderboard();

    // Let app JS know login succeeded (optional hook)
    window.__initAfterLogin?.();

  } else {
    appRoot.classList.add('hidden');
    gate.classList.remove('hidden');
    todoFlyout.classList.add('hidden');

    if (unsubLB) { unsubLB(); unsubLB = null; }
    if (unsubTasks) { unsubTasks(); unsubTasks = null; }
    if (unsubTaskStatus) { unsubTaskStatus(); unsubTaskStatus = null; }
  }
});

// --- To‑Do: listen to today's tasks (admin creates), render, and allow per‑user completion ---
async function subscribeTodayTasks(uid) {
  const dkey = localDateKey();

  // Listen to today's tasks
  if (unsubTasks) unsubTasks();
  unsubTasks = onSnapshot(collection(db, 'dailyTasks', dkey, 'tasks'), async (ss) => {
    const tasks = [];
    ss.forEach((docSnap) => tasks.push({ id: docSnap.id, ...docSnap.data() }));

    // Load user's completion statuses (single read is OK here)
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

// Toggle a task for the current user and update daily stats + leaderboard
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

    // update tasksCompleted
    let tasksCompleted = data.tasksCompleted || 0;
    const statusSnap = await tx.get(statusRef);
    const prev = statusSnap.exists() ? !!statusSnap.data().done : false;

    if (done && !prev) tasksCompleted += 1;
    if (!done && prev) tasksCompleted = Math.max(0, tasksCompleted - 1);

    // write status
    tx.set(statusRef, {
      done, text, updatedAt: serverTimestamp(), ...(done ? { completedAt: serverTimestamp() } : {})
    }, { merge: true });

    // write daily aggregate + leaderboard mirror
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

    tx.set(lbRef, {
      uid, displayName, jpEnCorrect: jpEn, enJpCorrect: enJp,
      tasksCompleted, score, updatedAt: serverTimestamp()
    }, { merge: true });
  });
}

// --- Leaderboard subscription (today only) ---
function subscribeLeaderboard() {
  const dkey = localDateKey();
  if (unsubLB) unsubLB();
  const q = query(collection(db, 'dailyLeaderboard', dkey, 'users'), orderBy('score', 'desc'), limit(50));
  unsubLB = onSnapshot(q, (ss) => {
    lbList.innerHTML = '';
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
      lbList.appendChild(li);
    });
  });
}

// --- Public API for your quiz to record answers ---
// Call this when the user answers (we only count correct answers for scores)
window.__fb_recordAnswer = async function ({ deckName = 'unknown', mode = 'jp-en', isCorrect = false } = {}) {
  const user = auth.currentUser;
  if (!user || !isCorrect) return;

  const dkey = localDateKey();
  const dailyRef = doc(db, 'users', user.uid, 'daily', dkey);
  const lbRef    = doc(db, 'dailyLeaderboard', dkey, 'users', user.uid);
  const uref     = doc(db, 'users', user.uid);

  await runTransaction(db, async (tx) => {
    const usnap = await tx.get(uref);
    const displayName = usnap.exists() ? (usnap.data().displayName || 'Anonymous') : 'Anonymous';

    const snap = await tx.get(dailyRef);
    let data = snap.exists() ? snap.data() : { jpEnCorrect: 0, enJpCorrect: 0, tasksCompleted: 0, byDeck: {} };

    // update counters
    if (mode === 'jp-en') data.jpEnCorrect = (data.jpEnCorrect || 0) + 1;
    else data.enJpCorrect = (data.enJpCorrect || 0) + 1;

    const bd = data.byDeck || {};
    bd[deckName] = bd[deckName] || { jpEn: 0, enJp: 0 };
    if (mode === 'jp-en') bd[deckName].jpEn += 1; else bd[deckName].enJp += 1;
    data.byDeck = bd;

    // recompute score
    const score = (data.jpEnCorrect || 0) + (data.enJpCorrect || 0) + (data.tasksCompleted || 0) * TASK_BONUS;

    // write daily + mirror
    tx.set(dailyRef, {
      date: dkey, displayName,
      jpEnCorrect: data.jpEnCorrect || 0,
      enJpCorrect: data.enJpCorrect || 0,
      tasksCompleted: data.tasksCompleted || 0,
      byDeck: data.byDeck,
      score,
      updatedAt: serverTimestamp()
    }, { merge: true });

    tx.set(lbRef, {
      uid: user.uid, displayName,
      jpEnCorrect: data.jpEnCorrect || 0,
      enJpCorrect: data.enJpCorrect || 0,
      tasksCompleted: data.tasksCompleted || 0,
      score,
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
};

// Optional: expose sign out (not used, but handy)
window.__signOut = () => signOut(getAuth());

