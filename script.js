import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

/* ==========================================================================
   Luminary Digital Group — Client Portal
   One template, many clients: which client's data loads depends entirely
   on the ?client=slug in the URL. Each client gets their own link AND a
   real Firebase login from the admin dashboard, e.g.
   yoursite.com/index.html?client=kairos-kreations

   Access control: a visitor must be signed in with the exact email stored
   as this client's `clientEmail` in Firestore. The old name/email-only gate
   was personalization, not security — it did not actually restrict access.
   That's now handled here with real Firebase Auth.
   ========================================================================== */

const CLIENT_SLUG = new URLSearchParams(window.location.search).get("client");

// Sensible fallbacks in case a client doc is missing launchDate/duration
// (e.g. one created by hand before those fields existed).
const CLIENT = {
  companyName: "your business",
  agencyName: "Luminary Digital Group",
  launchDate: "2026-08-01T00:00:00",
  durationDays: 90,
  phases: [],
};

const DAY_MS = 86400000;

function computePhases(durationDays) {
  const third = durationDays / 3;
  return [
    { key: "foundation", label: "Foundation & launch", startDay: 0, endDay: third },
    { key: "optimization", label: "Optimization", startDay: third, endDay: third * 2 },
    { key: "scale", label: "Scale", startDay: third * 2, endDay: durationDays },
  ];
}

/* ---------------------------------------------------------------------- */
/* Date / phase math                                                      */
/* ---------------------------------------------------------------------- */

function getCampaignStatus(now = new Date()){
  const launch = new Date(CLIENT.launchDate);
  const msFromLaunch = now - launch;

  if (msFromLaunch < 0){
    return {
      state: "pre-launch",
      daysUntilLaunch: Math.ceil(Math.abs(msFromLaunch) / DAY_MS),
      elapsedDays: 0,
      progressPct: 0,
      currentPhaseKey: null,
    };
  }

  const elapsedDays = Math.floor(msFromLaunch / DAY_MS);

  if (elapsedDays >= CLIENT.durationDays){
    return {
      state: "complete",
      daysUntilLaunch: 0,
      elapsedDays: CLIENT.durationDays,
      progressPct: 100,
      currentPhaseKey: "scale",
    };
  }

  const currentPhase = CLIENT.phases.find(
    (p) => elapsedDays >= p.startDay && elapsedDays < p.endDay
  );

  return {
    state: "active",
    daysUntilLaunch: 0,
    elapsedDays,
    progressPct: Math.min(100, (elapsedDays / CLIENT.durationDays) * 100),
    currentPhaseKey: currentPhase ? currentPhase.key : "foundation",
  };
}

function formatDate(iso){
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/* ---------------------------------------------------------------------- */
/* Render: static client details                                          */
/* ---------------------------------------------------------------------- */

function renderClientDetails(){
  document.querySelectorAll(".js-company-name").forEach(
    (el) => (el.textContent = CLIENT.companyName)
  );
  const chip = document.getElementById("launchDateChip");
  if (chip) chip.textContent = formatDate(CLIENT.launchDate);
  document.title = `${CLIENT.companyName} · Luminary Digital Group`;
}

/* ---------------------------------------------------------------------- */
/* Gate state helpers — only one of these is visible at a time             */
/* ---------------------------------------------------------------------- */

const GATE_STATES = ["gateLoading", "gateLanding", "gateNotFound", "gateNoAccess", "gateLogin", "gateForm"];

function showGateState(id){
  GATE_STATES.forEach((stateId) => {
    const el = document.getElementById(stateId);
    if (el) el.style.display = stateId === id ? (stateId === "gateLogin" || stateId === "gateForm" ? "block" : "block") : "none";
  });
}

function dismissGate(){
  const gate = document.getElementById("gate");
  if (gate) gate.classList.add("is-hidden");
  document.body.classList.remove("gate-active");
}

/* ---------------------------------------------------------------------- */
/* Sign-in form (real Firebase Auth — this is the actual access control)  */
/* ---------------------------------------------------------------------- */

function initGateLogin(){
  const form = document.getElementById("gateLogin");
  const errorEl = document.getElementById("gateLoginError");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.style.display = "none";
    const submitBtn = form.querySelector(".gate-submit");
    const email = document.getElementById("gateLoginEmail").value.trim().toLowerCase();
    const password = document.getElementById("gateLoginPassword").value;

    if (submitBtn){
      submitBtn.disabled = true;
      submitBtn.textContent = "Signing in…";
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged below picks up the change and re-runs boot().
    } catch (err) {
      errorEl.textContent = "Couldn't sign in — check your email and password.";
      errorEl.style.display = "block";
    } finally {
      if (submitBtn){
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign in";
      }
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Personalization — first name / last name, shown once after real login  */
/* ---------------------------------------------------------------------- */
/* Note: this is cosmetic, not access control. Access is already granted
   by the time this shows — it just makes the greeting less robotic.
   Saved to this browser's localStorage, scoped to this client's slug. */

const VISITOR_STORAGE_KEY = `luminaryPortalVisitor:${CLIENT_SLUG}`;

function loadSavedVisitor(){
  try {
    const raw = localStorage.getItem(VISITOR_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null; // localStorage unavailable (private browsing, blocked cookies, etc.)
  }
}

function saveVisitor(visitor){
  try {
    localStorage.setItem(VISITOR_STORAGE_KEY, JSON.stringify(visitor));
  } catch (e) {
    // If storage is blocked, the portal still works for this session —
    // it just won't remember the visitor after a refresh.
  }
}

function applyVisitorToPage(visitor){
  document.querySelectorAll(".js-first-name").forEach((el) => {
    el.textContent = visitor.firstName;
  });
  const visitorChip = document.querySelector(".js-visitor-name");
  if (visitorChip) visitorChip.textContent = `${visitor.firstName} ${visitor.lastName}`;
}

function initGateNameForm(){
  const form = document.getElementById("gateForm");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const firstName = document.getElementById("gateFirstName").value.trim();
    const lastName = document.getElementById("gateLastName").value.trim();

    if (!firstName || !lastName){
      form.reportValidity();
      return;
    }

    const visitor = { firstName, lastName, savedAt: new Date().toISOString() };
    saveVisitor(visitor);
    applyVisitorToPage(visitor);
    dismissGate();
  });
}

/* ---------------------------------------------------------------------- */
/* Log out — real Firebase sign-out, then clear the saved visitor name    */
/* ---------------------------------------------------------------------- */

function initLogout(){
  const btn = document.getElementById("logoutBtn");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "true";

  btn.addEventListener("click", async () => {
    try {
      localStorage.removeItem(VISITOR_STORAGE_KEY);
    } catch (e) {
      // nothing saved / storage unavailable
    }
    try {
      await signOut(auth);
    } finally {
      location.reload();
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Render: mission control (live status)                                  */
/* ---------------------------------------------------------------------- */

const PHASE_DISPLAY_LABEL = {
  "pre-launch": "Pre-launch",
  foundation: "Foundation & launch",
  optimization: "Optimization",
  scale: "Scale",
  complete: "Complete",
};

function renderMissionControl(){
  const status = getCampaignStatus();
  const badge = document.getElementById("phaseBadge");
  const statusText = document.getElementById("mcStatusText");
  const fill = document.getElementById("progressFill");
  const timelineFill = document.getElementById("timelineFill");

  let badgeLabel = PHASE_DISPLAY_LABEL[status.state === "active" ? status.currentPhaseKey : status.state];
  badge.textContent = badgeLabel;

  if (status.state === "pre-launch"){
    statusText.innerHTML = `Launch is in <strong>${status.daysUntilLaunch} day${status.daysUntilLaunch === 1 ? "" : "s"}</strong> — on ${formatDate(CLIENT.launchDate)} the ${CLIENT.durationDays}-day clock starts and this bar starts moving.`;
  } else if (status.state === "complete"){
    statusText.innerHTML = `The ${CLIENT.durationDays}-day engagement is <strong>complete</strong>. Everything below stays here as your record — let's talk about what's next.`;
  } else {
    const dayNum = status.elapsedDays + 1;
    statusText.innerHTML = `Day <strong>${dayNum}</strong> of <strong>${CLIENT.durationDays}</strong> — currently in the <strong>${badgeLabel}</strong> phase.`;
  }

  requestAnimationFrame(() => {
    fill.style.width = `${status.progressPct}%`;
    timelineFill.style.height = `${status.progressPct}%`;
  });

  // highlight the correct roadmap node
  document.querySelectorAll(".timeline-node").forEach((node) => {
    const key = node.dataset.phase;
    node.classList.remove("is-active", "is-complete");
    if (status.state === "complete"){
      node.classList.add("is-complete");
      return;
    }
    if (status.state === "pre-launch") return;

    const phaseDef = CLIENT.phases.find((p) => p.key === key);
    if (!phaseDef) return;
    if (status.elapsedDays >= phaseDef.endDay){
      node.classList.add("is-complete");
    } else if (key === status.currentPhaseKey){
      node.classList.add("is-active");
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Render: monthly report cards — live from Firestore                     */
/* ---------------------------------------------------------------------- */
/* Pulls only PUBLISHED reports (enforced by the Firestore security rules,
   not just this code) and groups them by month. A month can have up to
   three rows underneath it — one per ad platform — uploaded from the
   admin dashboard. Updates in real time: publish something in admin.html
   and it appears here within a second or two, no refresh needed. */

const PLATFORM_LABEL = { meta: "Meta", tiktok: "TikTok", google: "Google Ads" };

function formatMoney(value){
  if (value === null || value === undefined) return null;
  return "$" + Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

let unsubscribeReports = null;

function initLiveReports(){
  const grid = document.getElementById("reportsGrid");
  if (!grid) return;
  if (unsubscribeReports) unsubscribeReports();

  const reportsRef = collection(db, "clients", CLIENT_SLUG, "monthlyReports");
  const q = query(reportsRef, where("isPublished", "==", true), orderBy("monthStart", "asc"));

  unsubscribeReports = onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty){
        grid.innerHTML = `
          <div class="report-card">
            <div class="report-card-head">
              <span class="report-month">Coming soon</span>
              <span class="report-status-icon"><svg viewBox="0 0 24 24"><use href="#icon-lock"/></svg></span>
            </div>
            <h3>Your first report</h3>
            <p class="report-note">This fills in automatically the moment your first month's report is published — nothing to request.</p>
          </div>`;
        return;
      }

      // Group the flat list of platform rows into one entry per month.
      const byMonth = new Map();
      snapshot.forEach((docSnap) => {
        const r = docSnap.data();
        if (!byMonth.has(r.monthStart)) byMonth.set(r.monthStart, []);
        byMonth.get(r.monthStart).push(r);
      });

      grid.innerHTML = "";
      byMonth.forEach((platformRows, monthStart) => {
        const monthLabel = new Date(monthStart + "T00:00:00").toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });

        const totalSpend = platformRows.reduce((sum, r) => sum + (Number(r.spend) || 0), 0);
        const totalResults = platformRows.reduce((sum, r) => sum + (Number(r.results) || 0), 0);
        const note = platformRows.find((r) => r.adminNotes)?.adminNotes;

        const breakdown = platformRows
          .map((r) => {
            const spend = formatMoney(r.spend);
            const parts = [];
            if (spend) parts.push(spend);
            if (r.results != null) parts.push(`${r.results} results`);
            return `<li><span>${PLATFORM_LABEL[r.platform] || r.platform}</span><span>${parts.join(" · ") || "—"}</span></li>`;
          })
          .join("");

        const card = document.createElement("article");
        card.className = "report-card is-unlocked";
        card.innerHTML = `
          <div class="report-card-head">
            <span class="report-month">${monthLabel}</span>
            <span class="report-status-icon"><svg viewBox="0 0 24 24"><use href="#icon-check"/></svg></span>
          </div>
          <h3>${formatMoney(totalSpend) || "$0"} spent · ${totalResults} results</h3>
          <ul class="platform-breakdown">${breakdown}</ul>
          ${note ? `<p class="report-note">${note}</p>` : ""}
        `;
        grid.appendChild(card);
      });
    },
    () => {
      grid.innerHTML = `<p class="report-note">Couldn't load reports right now — try refreshing.</p>`;
    }
  );
}

/* ---------------------------------------------------------------------- */
/* Scroll reveal                                                          */
/* ---------------------------------------------------------------------- */

let revealInitialized = false;
function initReveal(){
  if (revealInitialized) return;
  revealInitialized = true;
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)){
    items.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting){
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  items.forEach((el) => observer.observe(el));
}

/* ---------------------------------------------------------------------- */
/* Count-up stats                                                         */
/* ---------------------------------------------------------------------- */

let countersInitialized = false;
function initCounters(){
  if (countersInitialized) return;
  countersInitialized = true;
  const nums = document.querySelectorAll(".stat-num");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const animate = (el) => {
    const target = parseInt(el.dataset.count, 10);
    if (prefersReducedMotion){
      el.textContent = target;
      return;
    }
    const duration = 900;
    const start = performance.now();
    function step(now){
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };

  if (!("IntersectionObserver" in window)){
    nums.forEach(animate);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting){
          animate(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.4 }
  );
  nums.forEach((el) => observer.observe(el));
}

/* ---------------------------------------------------------------------- */
/* Boot — driven by real auth state, not just the URL                     */
/* ---------------------------------------------------------------------- */

initGateLogin();
initGateNameForm();

onAuthStateChanged(auth, async (user) => {
  if (!CLIENT_SLUG){
    showGateState("gateLanding");
    return;
  }

  if (!user){
    showGateState("gateLogin");
    return;
  }

  let clientSnap;
  try {
    clientSnap = await getDoc(doc(db, "clients", CLIENT_SLUG));
  } catch (err) {
    // Most likely: this signed-in account isn't authorized to read this
    // client doc under the Firestore rules — treat it the same as "wrong
    // account" rather than "portal doesn't exist".
    showGateState("gateNoAccess");
    return;
  }

  if (!clientSnap.exists()){
    showGateState("gateNotFound");
    return;
  }

  const c = clientSnap.data();
  const owns = c.clientEmail && c.clientEmail.toLowerCase() === (user.email || "").toLowerCase();
  if (!owns){
    await signOut(auth);
    showGateState("gateNoAccess");
    return;
  }

  CLIENT.companyName = c.name || CLIENT.companyName;
  CLIENT.launchDate = c.launchDate || CLIENT.launchDate;
  CLIENT.durationDays = c.durationMonths ? c.durationMonths * 30 : CLIENT.durationDays;
  CLIENT.phases = computePhases(CLIENT.durationDays);

  renderClientDetails();
  renderMissionControl();
  initLiveReports();
  initReveal();
  initCounters();
  initLogout();

  // Already have their access verified — this step is just personalization.
  const saved = loadSavedVisitor();
  if (saved){
    applyVisitorToPage(saved);
    dismissGate();
  } else {
    showGateState("gateForm");
  }
});
