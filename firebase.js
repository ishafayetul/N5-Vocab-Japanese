// firebase.js  (type="module")
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, orderBy, limit, onSnapshot, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// 1) Init
const firebaseConfig = {
  apiKey: "AIzaSyCP-JzANiomwA-Q5MB5fnNoz0tUjdNX3Og",
  authDomain: "japanese-n5-53295.firebaseapp.com",
  projectId: "japanese-n5-53295",
  storageBucket: "japanese-n5-53295.firebasestorage.app",
  messagingSenderId: "176625372154",
  appId: "1:176625372154:web:66acdaf3304e9ed03e7243"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// 2) DOM refs
const authBtn = document.getElementById('auth-btn');
const userPill = document.getElementById('user-pill');
const lbList  = document.getElementById('leaderboard-list');
const todoInput = document.getElementById('todo-input');
const todoAddBtn = document.getElementById('todo-add');
const todoList  = document.getElementById('todo-list');

// 3) Auth button
authBtn?.addEventListener('click', async () => {
  if (auth.currentUser) {
    await signOut(auth);
  } else {
    await signInWithPopup(auth, provider);
  }
});

// 4) Auth state → set profile; ensure user doc exists; wire listeners
let unsubLeaderboard = null;
let unsubTodos = null;
onAuthStateChanged(auth, async (user) => {
  if (user) {
    authBtn.textContent = '🚪 Sign out';
    userPill?.classList.remove('hidden');
    userPill.innerHTML = `Signed in as <b>${user.displayName || 'User'}</b>`;

    // ensure user doc
    const uref = doc(db, 'users', user.uid);
    const snap = await getDoc(uref);
    if (!snap.exists()) {
      await setDoc(uref, {
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        totalCorrect: 0,
        totalWrong: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    // live leaderboard (top 20 by totalCorrect desc)
    if (unsubLeaderboard) unsubLeaderboard();
    const q = query(collection(db, 'users'), orderBy('totalCorrect', 'desc'), limit(20));
    unsubLeaderboard = onSnapshot(q, (ss) => {
      lbList.innerHTML = '';
      let rank = 1;
      ss.forEach(docSnap => {
        const u = docSnap.data();
        const li = document.createElement('li');
        li.textContent = `#${rank++} ${u.displayName || 'Anonymous'} — ${u.totalCorrect || 0} pts`;
        lbList.appendChild(li);
      });
    });

    // live todos: users/{uid}/todos
    if (unsubTodos) unsubTodos();
    const todosCol = collection(db, 'users', user.uid, 'todos');
    const tq = query(todosCol, orderBy('createdAt', 'asc'));
    unsubTodos = onSnapshot(tq, (ss) => {
      todoList.innerHTML = '';
      ss.forEach(docSnap => {
        const t = docSnap.data();
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.gap = '8px';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!t.done;
        chk.onchange = async () => {
          await updateDoc(doc(db, 'users', user.uid, 'todos', docSnap.id), {
            done: chk.checked,
            updatedAt: serverTimestamp()
          });
        };

        const span = document.createElement('span');
        span.textContent = t.text;

        const del = document.createElement('button');
        del.textContent = '🗑';
        del.style.padding = '4px 8px';
        del.onclick = async () => {
          await deleteDoc(doc(db, 'users', user.uid, 'todos', docSnap.id));
        };

        li.appendChild(chk);
        li.appendChild(span);
        li.appendChild(del);
        todoList.appendChild(li);
      });
    });

  } else {
    authBtn.textContent = '🔐 Sign in';
    userPill?.classList.add('hidden');
    userPill.innerHTML = '';
    lbList.innerHTML = '<li>Sign in to see leaderboard</li>';
    todoList.innerHTML = '<li>Sign in to manage your tasks</li>';

    if (unsubLeaderboard) { unsubLeaderboard(); unsubLeaderboard = null; }
    if (unsubTodos) { unsubTodos(); unsubTodos = null; }
  }
});

// 5) Add todo
todoAddBtn?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return alert('Sign in first.');
  const text = (todoInput.value || '').trim();
  if (!text) return;
  await addDoc(collection(db, 'users', user.uid, 'todos'), {
    text,
    done: false,
    createdAt: serverTimestamp()
  });
  todoInput.value = '';
});

// 6) Public API for script.js to report scores
// Call these from your quiz code when user answers:
window.__fb_updateScore = async function({ deltaCorrect = 0, deltaWrong = 0 } = {}) {
  const user = auth.currentUser;
  if (!user) return; // no‑op if logged out
  const uref = doc(db, 'users', user.uid);
  const snap = await getDoc(uref);
  if (!snap.exists()) return;
  const data = snap.data();
  await updateDoc(uref, {
    totalCorrect: (data.totalCorrect || 0) + deltaCorrect,
    totalWrong: (data.totalWrong || 0) + deltaWrong,
    updatedAt: serverTimestamp()
  });
}
