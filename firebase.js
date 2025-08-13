// firebase.js  — load with <script type="module" src="firebase.js">
const V = "10.12.4"; // change if CDN 404s

import { initializeApp } from `https://www.gstatic.com/firebasejs/${V}/firebase-app.js`;
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from `https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`;
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, query, orderBy, limit, onSnapshot, addDoc, deleteDoc
} from `https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`;

// --- your config (as posted) ---
const firebaseConfig = {
  apiKey: "AIzaSyCP-JzANiomwA-Q5MB5fnNoz0tUjdNX3Og",
  authDomain: "japanese-n5-53295.firebaseapp.com",
  projectId: "japanese-n5-53295",
  storageBucket: "japanese-n5-53295.firebasestorage.app",
  messagingSenderId: "176625372154",
  appId: "1:176625372154:web:66acdaf3304e9ed03e7243",
  measurementId: "G-JQ03SE08KW"
};

// Init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// DOM refs (we’ll add these elements in step 2)
const authBtn   = document.getElementById('auth-btn');
const userPill  = document.getElementById('user-pill');
const lbList    = document.getElementById('leaderboard-list');
const todoInput = document.getElementById('todo-input');
const todoAdd   = document.getElementById('todo-add');
const todoList  = document.getElementById('todo-list');

// Sign-in / Sign-out button
authBtn?.addEventListener('click', async () => {
  if (auth.currentUser) { await signOut(auth); }
  else { await signInWithPopup(auth, provider); }
});

// Live UI wiring
let unsubLB = null, unsubTodos = null;
onAuthStateChanged(auth, async (user) => {
  if (user) {
    authBtn.textContent = '🚪 Sign out';
    userPill?.classList.remove('hidden');
    userPill.innerHTML = `Signed in as <b>${user.displayName || 'User'}</b>`;

    // Ensure user doc exists
    const uref = doc(db, 'users', user.uid);
    const snap = await getDoc(uref);
    if (!snap.exists()) {
      await setDoc(uref, {
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        totalCorrect: 0, totalWrong: 0,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    }

    // Leaderboard (top 20 by totalCorrect)
    if (unsubLB) unsubLB();
    const q = query(collection(db, 'users'), orderBy('totalCorrect', 'desc'), limit(20));
    unsubLB = onSnapshot(q, (ss) => {
      if (!lbList) return;
      lbList.innerHTML = '';
      let rank = 1;
      ss.forEach(docSnap => {
        const u = docSnap.data();
        const li = document.createElement('li');
        li.textContent = `#${rank++} ${u.displayName || 'Anonymous'} — ${u.totalCorrect || 0} pts`;
        lbList.appendChild(li);
      });
    });

    // To‑Dos under users/{uid}/todos
    if (unsubTodos) unsubTodos();
    const tq = query(collection(db, 'users', user.uid, 'todos'), orderBy('createdAt', 'asc'));
    unsubTodos = onSnapshot(tq, (ss) => {
      if (!todoList) return;
      todoList.innerHTML = '';
      ss.forEach(docSnap => {
        const t = docSnap.data();
        const li = document.createElement('li');
        li.style.display = 'flex'; li.style.alignItems = 'center'; li.style.gap = '8px';

        const chk = document.createElement('input');
        chk.type = 'checkbox'; chk.checked = !!t.done;
        chk.onchange = async () => {
          await updateDoc(doc(db, 'users', user.uid, 'todos', docSnap.id), {
            done: chk.checked, updatedAt: serverTimestamp()
          });
        };

        const span = document.createElement('span'); span.textContent = t.text;

        const del = document.createElement('button');
        del.textContent = '🗑'; del.style.padding = '4px 8px';
        del.onclick = async () => { await deleteDoc(doc(db, 'users', user.uid, 'todos', docSnap.id)); };

        li.append(chk, span, del);
        todoList.appendChild(li);
      });
    });

  } else {
    authBtn.textContent = '🔐 Sign in';
    userPill?.classList.add('hidden'); userPill.innerHTML = '';
    if (lbList) lbList.innerHTML = '<li>Sign in to see leaderboard</li>';
    if (todoList) todoList.innerHTML = '<li>Sign in to manage your tasks</li>';
    if (unsubLB) { unsubLB(); unsubLB = null; }
    if (unsubTodos) { unsubTodos(); unsubTodos = null; }
  }
});

// Add a To‑Do
todoAdd?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return alert('Sign in first.');
  const text = (todoInput.value || '').trim();
  if (!text) return;
  await addDoc(collection(db, 'users', user.uid, 'todos'), {
    text, done: false, createdAt: serverTimestamp()
  });
  todoInput.value = '';
});

// Public hook for your quiz to add points
window.__fb_updateScore = async function({ deltaCorrect = 0, deltaWrong = 0 } = {}) {
  const user = auth.currentUser;
  if (!user) return;
  const uref = doc(db, 'users', user.uid);
  const snap = await getDoc(uref);
  if (!snap.exists()) return;
  const data = snap.data();
  await updateDoc(uref, {
    totalCorrect: (data.totalCorrect || 0) + deltaCorrect,
    totalWrong: (data.totalWrong || 0) + deltaWrong,
    updatedAt: serverTimestamp()
  });
};
