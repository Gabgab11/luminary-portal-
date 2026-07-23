import { db } from "./firebase-init.js";
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
   on the ?client=slug in the URL. Each client gets their own link from
   the admin dashboard, e.g. yoursite.com/index.html?client=kairos-kreations
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

// Paste your own Formspree endpoint here — from formspree.io, after you
// create a form, it looks like "https://formspree.io/f/abcdwxyz".
// Every gate submission is POSTed here so you get an email per visitor.
const FORMSPREE_ENDPOINT = "https://formspree.io/f/mdaqlzob";

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
/* Intake gate — first name / last name / email, no password or backend   */
/* ---------------------------------------------------------------------- */
/* Note: this is a personalization step, not a login. Anyone with the link
   can type any name — it does not authenticate or restrict access. Access
   control for this portal is the private link itself.

   The visitor's details are saved to this browser's localStorage, scoped
   to this specific client's slug, so a refresh (or coming back later on
   the same device) skips the form — without leaking a name typed on one
   client's portal into a different client's portal on the same device. */

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

function sendToFormspree(visitor){
  if (!FORMSPREE_ENDPOINT || FORMSPREE_ENDPOINT.includes("YOUR_FORM_ID")) return;

  fetch(FORMSPREE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      firstName: visitor.firstName,
      lastName: visitor.lastName,
      email: visitor.email,
      client: CLIENT.companyName,
      _subject: `Portal opened: ${visitor.firstName} ${visitor.lastName} (${CLIENT.companyName})`,
      _replyto: visitor.email,
    }),
  }).catch(() => {
    // Network hiccup — the visitor still gets into the portal either way;
    // this submission just won't show up in Formspree this time.
  });
}

function applyVisitorToPage(visitor){
  document.querySelectorAll(".js-first-name").forEach((el) => {
    el.textContent = visitor.firstName;
  });
  const visitorChip = document.querySelector(".js-visitor-name");
  if (visitorChip) visitorChip.textContent = `${visitor.firstName} ${visitor.lastName}`;
}

function dismissGate(){
  const gate = document.getElementById("gate");
  if (gate) gate.classList.add("is-hidden");
  document.body.classList.remove("gate-active");
}

function showNotFoundState(){
  const loading = document.getElementById("gateLoading");
  const notFound = document.getElementById("gateNotFound");
  if (loading) loading.style.display = "none";
  if (notFound) notFound.style.display = "block";
  // Gate stays up on purpose — there's no valid client data to show underneath.
}

function showLandingState(){
  const loading = document.getElementById("gateLoading");
  const landing = document.getElementById("gateLanding");
  if (loading) loading.style.display = "none";
  if (landing) landing.style.display = "block";
  // No client in the link at all — this is the shared front door, not a
  // specific portal. Gate stays up; there's nothing behind it to show yet.
}

function initGateAfterClientLoad(){
  const loading = document.getElementById("gateLoading");
  const form = document.getElementById("gateForm");
  if (!form) return;

  // Returning visitor on this device/browser, for this specific client —
  // skip the form entirely.
  const saved = loadSavedVisitor();
  if (saved){
    applyVisitorToPage(saved);
    dismissGate();
    return;
  }

  if (loading) loading.style.display = "none";
  form.style.display = "block";

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const firstName = document.getElementById("gateFirstName").value.trim();
    const lastName = document.getElementById("gateLastName").value.trim();
    const email = document.getElementById("gateEmail").value.trim();

    if (!firstName || !lastName || !email){
      form.reportValidity();
      return;
    }

    const submitBtn = form.querySelector(".gate-submit");
    if (submitBtn){
      submitBtn.disabled = true;
      submitBtn.textContent = "Just a moment…";
    }

    const visitor = { firstName, lastName, email, savedAt: new Date().toISOString() };
    saveVisitor(visitor);
    sendToFormspree(visitor);
    applyVisitorToPage(visitor);
    dismissGate();
  });
}

/* ---------------------------------------------------------------------- */
/* Log out — clears the saved visitor so the gate shows again             */
/* ---------------------------------------------------------------------- */

function initLogout(){
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    try {
      localStorage.removeItem(VISITOR_STORAGE_KEY);
    } catch (e) {
      // nothing saved / storage unavailable — reload will still show the gate
    }
    location.reload();
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

function initLiveReports(){
  const grid = document.getElementById("reportsGrid");
  if (!grid) return;

  const reportsRef = collection(db, "clients", CLIENT_SLUG, "monthlyReports");
  const q = query(reportsRef, where("isPublished", "==", true), orderBy("monthStart", "asc"));

  onSnapshot(
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

function initReveal(){
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

function initCounters(){
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
/* Boot — fetch this client's data first, then render everything          */
/* ---------------------------------------------------------------------- */

async function boot(){
  if (!CLIENT_SLUG){
    showLandingState();
    return;
  }

  let clientSnap;
  try {
    clientSnap = await getDoc(doc(db, "clients", CLIENT_SLUG));
  } catch (err) {
    showNotFoundState();
    return;
  }

  if (!clientSnap.exists()){
    showNotFoundState();
    return;
  }

  const c = clientSnap.data();
  CLIENT.companyName = c.name || CLIENT.companyName;
  CLIENT.launchDate = c.launchDate || CLIENT.launchDate;
  CLIENT.durationDays = c.durationMonths ? c.durationMonths * 30 : CLIENT.durationDays;
  CLIENT.phases = computePhases(CLIENT.durationDays);

  renderClientDetails();
  renderMissionControl();
  initLiveReports();
  initReveal();
  initCounters();
  initGateAfterClientLoad();
  initLogout();
}

document.addEventListener("DOMContentLoaded", boot);
