let auth = null;
let db = null;
let cloudReady = false;
let firebaseApi = null;

function isProgressKey(k) {
  return /^progress_/.test(k) ||
    /^np_daily_/.test(k) ||
    k === "tm_attempts_v1" ||
    k === "tm_day_count" ||
    k === "tm_last_increment";
}

function clearLocalProgress() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (isProgressKey(k)) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}

async function loadOrCreateCloudProgress(uid) {
  const ref = firebaseApi.doc(db, "progress", uid);
  const snap = await firebaseApi.getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
  } else {
    await firebaseApi.setDoc(ref, {});
  }
}

async function fcSaveCloud() {
  if (!cloudReady || !auth || !auth.currentUser) return;
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (isProgressKey(k)) data[k] = localStorage.getItem(k);
  }
  await firebaseApi.setDoc(firebaseApi.doc(db, "progress", auth.currentUser.uid), data);
}

window.fcSaveCloud = async () => {};

async function afterLogin() {
  clearLocalProgress();
  await loadOrCreateCloudProgress(auth.currentUser.uid);
  location.reload();
}

async function signInWithGoogle() {
  if (!cloudReady || !auth) return;
  const provider = new firebaseApi.GoogleAuthProvider();
  try {
    await firebaseApi.signInWithPopup(auth, provider);
    await afterLogin();
  } catch {
    await firebaseApi.signInWithRedirect(auth, provider);
  }
}

async function signOutUser() {
  if (!cloudReady || !auth) return;
  await firebaseApi.signOut(auth);
  clearLocalProgress();
  location.reload();
}

function ensureAuthUI() {
  const hosts = [document.querySelector(".nav-right"), document.querySelector(".side-footer")].filter(Boolean);
  hosts.forEach(host => {
    let box = host.querySelector(".auth-box");
    if (!box) {
      box = document.createElement("div");
      box.className = "auth-box";
      box.style.display = "flex";
      box.style.gap = "6px";
      if (host.classList.contains("nav-right")) {
        box.style.flexDirection = "row";
        box.style.marginTop = "0";
      } else {
        box.style.flexDirection = "column";
        box.style.marginTop = "10px";
      }
      host.appendChild(box);
    }
    if (!host.classList.contains("nav-right") && !box.querySelector(".auth-status")) {
      const s = document.createElement("div");
      s.className = "auth-status muted";
      box.appendChild(s);
    }
    if (!box.querySelector(".auth-btn")) {
      const b = document.createElement("button");
      b.className = "auth-btn btn";
      box.appendChild(b);
    }
  });
}

function renderAuthUI(user, cloudEnabled = cloudReady) {
  ensureAuthUI();
  document.querySelectorAll(".auth-status").forEach(el => {
    el.textContent = cloudEnabled
      ? (user ? `Signed in as ${user.email}` : "Not signed in")
      : "Local progress only";
  });
  document.querySelectorAll(".auth-btn").forEach(btn => {
    btn.textContent = cloudEnabled
      ? (user ? "Log Out" : "Login with Google")
      : "Local progress only";
    btn.disabled = !cloudEnabled;
    btn.title = cloudEnabled
      ? ""
      : "Cloud sync is disabled because this public copy has no private Firebase config.";
  });
}

async function loadFirebaseConfig() {
  try {
    const module = await import("./firebaseConfig.sample.js");
    return module.default || module.firebaseConfig || null;
  } catch {
    return null;
  }
}

function hasUsableConfig(config) {
  return Boolean(
    config &&
    typeof config === "object" &&
    config.apiKey &&
    config.projectId &&
    config.appId
  );
}

async function setupCloudSync() {
  const config = await loadFirebaseConfig();
  if (!hasUsableConfig(config)) {
    renderAuthUI(null, false);
    return;
  }

  try {
    const appModule = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js");
    const authModule = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js");
    const firestoreModule = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

    const app = appModule.initializeApp(config);
    auth = authModule.getAuth(app);
    db = firestoreModule.getFirestore(app);
    firebaseApi = {
      GoogleAuthProvider: authModule.GoogleAuthProvider,
      signInWithPopup: authModule.signInWithPopup,
      signInWithRedirect: authModule.signInWithRedirect,
      getRedirectResult: authModule.getRedirectResult,
      signOut: authModule.signOut,
      onAuthStateChanged: authModule.onAuthStateChanged,
      doc: firestoreModule.doc,
      getDoc: firestoreModule.getDoc,
      setDoc: firestoreModule.setDoc,
    };
    cloudReady = true;
    window.fcSaveCloud = fcSaveCloud;

    firebaseApi.getRedirectResult(auth)
      .then(async (res) => {
        if (res && res.user) await afterLogin();
      })
      .catch(() => {});
    firebaseApi.onAuthStateChanged(auth, (user) => renderAuthUI(user, true));
    renderAuthUI(auth.currentUser, true);
  } catch (error) {
    console.warn("Cloud sync is unavailable; using local progress only.", error);
    cloudReady = false;
    window.fcSaveCloud = async () => {};
    renderAuthUI(null, false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderAuthUI(auth && auth.currentUser, cloudReady);
});

window.signInWithGoogle = () => {
  if (!cloudReady || !auth) return;
  return auth.currentUser ? signOutUser() : signInWithGoogle();
};

setupCloudSync();
