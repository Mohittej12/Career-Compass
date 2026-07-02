/* ============================================================
   Job Application Tracker — front-end logic
   Talks to the Flask JSON API and drives all the interactions.
   ============================================================ */

// Per-status badge colors (kept in sync with the lifecycle stages).
const STATUS_COLORS = {
  "Applied":            { bg: "rgba(59,130,246,.16)",  fg: "#93c5fd" },
  "Online Assessment":  { bg: "rgba(139,92,246,.16)",  fg: "#c4b5fd" },
  "Interview":          { bg: "rgba(245,158,11,.16)",  fg: "#fcd34d" },
  "Offer":              { bg: "rgba(16,185,129,.16)",  fg: "#6ee7b7" },
  "Accepted":           { bg: "rgba(5,150,105,.18)",   fg: "#34d399" },
  "Rejected":           { bg: "rgba(239,68,68,.15)",   fg: "#fca5a5" },
};
const STATUSES = Object.keys(STATUS_COLORS);

let allApps = [];            // full dataset from the server
let activeStatusFilter = ""; // "" = all
let searchTerm = "";

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

// ---------- Data ----------
async function loadApplications() {
  const res = await fetch("/api/applications");
  allApps = await res.json();
  renderStats();
  renderDueAlert();
  renderCards();
}

// ---------- Stats with count-up animation ----------
function renderStats() {
  const total = allApps.length;
  const interviews = allApps.filter((a) => a.status === "Interview").length;
  const offers = allApps.filter((a) => a.status === "Offer" || a.status === "Accepted").length;
  const due = allApps.filter((a) => a.is_due).length;
  animateCount("total", total);
  animateCount("interviews", interviews);
  animateCount("offers", offers);
  animateCount("due", due);
}

function animateCount(key, target) {
  const el = document.querySelector(`[data-stat="${key}"]`);
  if (!el) return;
  const start = parseInt(el.textContent, 10) || 0;
  const dur = 700;
  const t0 = performance.now();
  function step(now) {
    const p = Math.min((now - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = Math.round(start + (target - start) * eased);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---------- Follow-up alert ----------
function renderDueAlert() {
  const due = allApps.filter((a) => a.is_due);
  const box = $("#due-alert");
  if (due.length === 0) { box.classList.add("hidden"); return; }
  const names = due.map((a) => esc(a.company)).join(", ");
  box.innerHTML = `⏰ <strong>${due.length}</strong> follow-up${due.length > 1 ? "s" : ""} due — ${names}`;
  box.classList.remove("hidden");
}

// ---------- Status filter chips ----------
function renderFilters() {
  const wrap = $("#status-filters");
  const chips = ["All", ...STATUSES];
  wrap.innerHTML = chips.map((label) => {
    const val = label === "All" ? "" : label;
    const active = val === activeStatusFilter ? "active" : "";
    return `<button class="chip ${active}" data-status="${esc(val)}">${esc(label)}</button>`;
  }).join("");
  wrap.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      activeStatusFilter = chip.dataset.status;
      renderFilters();
      renderCards();
    });
  });
}

// ---------- Cards ----------
function visibleApps() {
  return allApps.filter((a) => {
    if (activeStatusFilter && a.status !== activeStatusFilter) return false;
    if (searchTerm) {
      const hay = `${a.company} ${a.role || ""}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    return true;
  });
}

function renderCards() {
  const wrap = $("#cards");
  const empty = $("#empty-state");
  const apps = visibleApps();

  if (allApps.length === 0) { wrap.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  if (apps.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-dim);grid-column:1/-1;text-align:center;padding:40px;">No matches. Try a different search or filter.</p>`;
    return;
  }

  wrap.innerHTML = apps.map(cardHtml).join("");
  // Stagger the entrance animation for a polished feel.
  wrap.querySelectorAll(".card").forEach((card, i) => {
    card.classList.add("card-enter");
    card.style.animationDelay = `${i * 0.05}s`;
    attachCardHandlers(card);
  });
}

function cardHtml(a) {
  const c = STATUS_COLORS[a.status] || STATUS_COLORS["Applied"];
  const options = STATUSES.map((s) =>
    `<option value="${esc(s)}" ${s === a.status ? "selected" : ""}>${esc(s)}</option>`).join("");

  const meta = [];
  if (a.location) meta.push(`<span>📍 ${esc(a.location)}</span>`);
  meta.push(`<span>🗓️ Applied ${esc(a.date_applied || "—")}</span>`);
  if (a.job_link) meta.push(`<a href="${esc(a.job_link)}" target="_blank" rel="noopener">🔗 Job posting</a>`);
  if (a.notes) meta.push(`<span>📝 ${esc(a.notes)}</span>`);
  if (a.follow_up_date) {
    meta.push(a.is_due
      ? `<span class="due-flag">⏰ Follow-up due since ${esc(a.follow_up_date)}</span>`
      : `<span>⏰ Follow up on ${esc(a.follow_up_date)}</span>`);
  }

  const dl = a.resume_url
    ? `<a class="dl-btn" href="${esc(a.resume_url)}">⬇ Resume</a>`
    : `<span class="dl-btn" style="opacity:.5">No file</span>`;

  return `
    <article class="card" data-id="${a.id}">
      <div class="card-top">
        <div>
          <div class="card-company">${esc(a.company)}</div>
          <div class="card-role">${esc(a.role || "Role n/a")}</div>
        </div>
        <span class="badge" style="background:${c.bg};color:${c.fg}">${esc(a.status)}</span>
      </div>
      <div class="card-meta">${meta.join("")}</div>
      <div class="card-actions">
        <select data-action="status">${options}</select>
        ${dl}
        <button class="icon-btn" data-action="delete" aria-label="Delete">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
    </article>`;
}

function attachCardHandlers(card) {
  const id = card.dataset.id;

  // Mouse-follow glow.
  card.addEventListener("mousemove", (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  });

  // Status change.
  card.querySelector('[data-action="status"]').addEventListener("change", async (e) => {
    const newStatus = e.target.value;
    await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (newStatus === "Offer" || newStatus === "Accepted") celebrate();
    await loadApplications();
  });

  // Delete with a quick confirm.
  card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    if (!confirm("Delete this application and its stored resume?")) return;
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    await loadApplications();
  });
}

// ---------- Confetti celebration ----------
function celebrate() {
  if (typeof confetti !== "function") return;
  const end = Date.now() + 900;
  const colors = ["#a78bfa", "#ec4899", "#22d3ee", "#fcd34d"];
  (function frame() {
    confetti({ particleCount: 4, angle: 60, spread: 70, origin: { x: 0 }, colors });
    confetti({ particleCount: 4, angle: 120, spread: 70, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  confetti({ particleCount: 140, spread: 90, origin: { y: 0.6 }, colors });
}

function bindIfPresent(selector, eventName, handler) {
  const el = $(selector);
  if (el) el.addEventListener(eventName, handler);
}

// ---------- Modal ----------
const modal = $("#modal");
const contactModal = $("#contact-modal");
function openModal() {
  const formError = $("#form-error");
  if (formError) formError.classList.add("hidden");
  // Default the date field to today.
  const today = new Date().toISOString().slice(0, 10);
  if (modal) {
    const dateField = modal.querySelector('input[name="date_applied"]');
    if (dateField) dateField.value = today;
    modal.classList.remove("hidden");
  }
}
function closeModal() {
  if (modal) modal.classList.add("hidden");
  const addForm = $("#add-form");
  if (addForm) addForm.reset();
}
function openContactModal() { if (contactModal) contactModal.classList.remove("hidden"); }
function closeContactModal() { if (contactModal) contactModal.classList.add("hidden"); }

["#add-btn", "#add-btn-hero", "#add-btn-empty"].forEach((sel) => bindIfPresent(sel, "click", openModal));
bindIfPresent("#modal-close", "click", closeModal);
bindIfPresent("#modal-cancel", "click", closeModal);
if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
bindIfPresent("#contact-btn", "click", openContactModal);
bindIfPresent("#footer-contact-link", "click", (e) => { e.preventDefault(); openContactModal(); });
bindIfPresent("#contact-close", "click", closeContactModal);
if (contactModal) contactModal.addEventListener("click", (e) => { if (e.target === contactModal) closeContactModal(); });

// Submit the add form.
const addForm = $("#add-form");
if (addForm) {
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#form-error");
    if (errEl) errEl.classList.add("hidden");
    const formData = new FormData(e.target);
    const res = await fetch("/api/applications", { method: "POST", body: formData });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (errEl) {
        errEl.textContent = data.error || "Something went wrong. Please try again.";
        errEl.classList.remove("hidden");
      }
      return;
    }
    closeModal();
    await loadApplications();
  });
}

// ---------- Export ----------
bindIfPresent("#export-btn", "click", () => { window.location.href = "/api/export"; });

// ---------- Search ----------
bindIfPresent("#search", "input", (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderCards();
});

// ---------- Scroll reveal ----------
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

// ---------- Init ----------
renderFilters();
initReveal();
loadApplications();
