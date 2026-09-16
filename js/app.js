/* ============================================================
   Monthly Meeting Report — frontend logic (works with Google
   Apps Script backend in apps-script/Code.gs)
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Constants ---------- */
  const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /* ---------- Field schema (drives forms + table rendering) ---------- */
  const SECTIONS = {
    "5S": {
      title: "5S of Project",
      subtitle: "Current photos of offices / barracks",
      card: true,
      columns: [
        { key: "project", label: "Project" },
        { key: "area", label: "Area / Office" },
        { key: "date", label: "Date" },
        { key: "photos", label: "Photos", kind: "photos" },
        { key: "remarks", label: "Remarks" },
      ],
      fields: [
        { key: "project", label: "Project", type: "text", required: true },
        { key: "area", label: "Area / Office / Barracks", type: "text", required: true },
        { key: "date", label: "date", type: "date", required: true },
        { key: "photos", label: "Photos (offices / barracks)", type: "file", multiple: true, note: "Photos are uploaded to Google Drive automatically." },
        { key: "remarks", label: "Remarks", type: "textarea" },
      ],
    },
    Manpower: {
      title: "Manpower Headcount",
      subtitle: "Active / Balance PRF / Transferred",
      table: true,
      fields: [
        { key: "project", label: "Project", type: "text", required: true },
        { key: "active", label: "Active Headcount", type: "number", step: "1", required: true },
        { key: "balanceprf", label: "Balance PRF", type: "number", step: "1" },
        { key: "transferred", label: "Manpower Transferred", type: "number", step: "1" },
        { key: "asof", label: "As Of Date", type: "date" },
        { key: "remarks", label: "Remarks", type: "textarea" },
      ],
    },
    Contracts: {
      title: "Contracts",
      subtitle: "Pending / Ongoing / Issues",
      table: true,
      fields: [
        { key: "project", label: "Project", type: "text", required: true },
        { key: "contract", label: "Contract / Description", type: "text", required: true },
        { key: "status", label: "Status", type: "select", options: ["Pending", "Ongoing", "Issues"], required: true },
        { key: "issue", label: "Issues / Notes", type: "textarea" },
        { key: "updated", label: "Date Updated", type: "date" },
        { key: "remarks", label: "Remarks", type: "textarea" },
      ],
    },
    Overtime: {
      title: "Overtime",
      subtitle: "Monthly hours per project — month-over-month comparison",
      table: true,
      fields: [
        { key: "project", label: "Project", type: "text", required: true },
        { key: "year", label: "Year", type: "number", step: "1", required: true },
        { key: "month", label: "Month", type: "select", options: MONTH_NAMES, required: true, note: "The month this meeting's OT figures cover." },
        { key: "hours", label: "Overtime Hours (selected month)", type: "number", step: "0.1", required: true },
        { key: "asof", label: "As Of Date", type: "date" },
        { key: "remarks", label: "Remarks", type: "textarea" },
      ],
    },
  };

  /* ---------- State ---------- */
  const state = {
    data: { "5S": [], Manpower: [], Contracts: [], Overtime: [] },
    section: "overview",
    editingRow: null,       // rowNumber when editing
    editingSection: null,
    uploading: false,
    compare: { A: null, B: null },   // overtime comparison periods {year, monthIdx}
    compareManual: false,
  };

  const MAX_PHOTO_DIM = 1280;
  const PHOTO_QUALITY = 0.85;

  /* ---------- Helpers ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtNum(v, dp) {
    const n = Number(v);
    if (v === "" || v == null || isNaN(n)) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: dp == null ? 0 : dp });
  }

  function todayISO() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function toast(msg, type) {
    const wrap = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast " + (type || "info");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.remove(); }, 4200);
  }

  function setConn(mode) {
    const el = $("#connStatus");
    const txt = $("#connText");
    el.classList.remove("online", "offline");
    if (mode === "online") { el.classList.add("online"); txt.textContent = "Online"; }
    else if (mode === "offline") { el.classList.add("offline"); txt.textContent = "Offline"; }
    else { txt.textContent = "Connecting…"; }
  }

  /* ---------- Apps Script API ---------- */
  async function callScript(params, postJson) {
    if (!GOOGLE_SCRIPT_URL) throw new Error("SETUP: paste your Apps Script Web App URL into js/config.js (see README.md).");
    let res;
    if (postJson !== undefined) {
      const body = Object.assign({}, params, postJson);
      res = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
      });
    } else {
      const q = new URLSearchParams();
      Object.keys(params).forEach((k) => { if (params[k] != null && params[k] !== "") q.append(k, params[k]); });
      res = await fetch(GOOGLE_SCRIPT_URL + "?" + q.toString(), { redirect: "follow" });
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    /* Known Google behavior: write actions can execute & save but the /exec
       echo comes back empty. Treat that as success and refresh. */
    if (!text.trim()) {
      const act = String(params.action || "");
      if (["add", "update", "delete"].includes(act)) return { ok: true, soft: true };
      throw new Error("Backend returned an empty response (HTTP " + res.status + ").");
    }

    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || "Unknown backend error");
    return data;
  }

  function read(sheet) {
    return callScript({ action: "read", sheet, key: API_KEY });
  }

  async function refreshData(quiet) {
    if (!GOOGLE_SCRIPT_URL) {
      $("#setupWarning").classList.remove("hidden");
      setConn("offline");
      renderEmptySection("5S");
      renderEmptySection("Manpower");
      renderEmptySection("Contracts");
      renderEmptySection("Overtime");
      return;
    }
    $("#setupWarning").classList.add("hidden");
    setConn("online");
    try {
      const results = await Promise.all([
        read("5S"), read("Manpower"), read("Contracts"), read("Overtime"),
      ]);
      state.data = {
        "5S": results[0].rows || [],
        Manpower: results[1].rows || [],
        Contracts: results[2].rows || [],
        Overtime: results[3].rows || [],
      };
      buildFilters();
      buildCompareControls();
      renderAll();
      if (!quiet) toast("Data refreshed from Google Sheets", "ok");
    } catch (err) {
      setConn("offline");
      toast("Failed to load data: " + err.message, "err");
    }
  }

  /* ---------- Filters ---------- */
  function distinctProjects(sheet) {
    const seen = new Set();
    (state.data[sheet] || []).forEach((r) => { if (r.project) seen.add(String(r.project).trim()); });
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }

  function buildFilters() {
    Object.keys(SECTIONS).forEach((s) => {
      const sel = $("#filter-" + s);
      if (!sel) return;
      const cur = sel.value;
      const projects = distinctProjects(s);
      sel.innerHTML = '<option value="">All projects</option>' +
        projects.map((p) => `<option>${esc(p)}</option>`).join("");
      if (projects.includes(cur)) sel.value = cur;
    });
  }

  function getProjectFilter(s) {
    const sel = $("#filter-" + s);
    return sel ? sel.value : "";
  }

  function filteredRows(s) {
    const pf = getProjectFilter(s);
    let rows = state.data[s] || [];
    if (pf) rows = rows.filter((r) => String(r.project || "") === pf);
    if (s === "Contracts") {
      const sf = $("#statusFilter-" + s);
      if (sf && sf.value) rows = rows.filter((r) => String(r.status || "") === sf.value);
    }
    return rows;
  }

  /* ---------- Overtime comparison helpers ---------- */
  function samePeriod(p, q) {
    return !!p && !!q && Number(p.year) === Number(q.year) && Number(p.monthIdx) === Number(q.monthIdx);
  }

  function periodLabel(p) {
    return p ? `${p.year} ${MONTH_NAMES[p.monthIdx]}` : "—";
  }

  function periodVal(p) {
    return p ? p.year + "-" + p.monthIdx : "";
  }

  function parsePeriod(s) {
    const parts = String(s).split("-");
    return { year: Number(parts[0]), monthIdx: Number(parts[1] || 0) };
  }

  function listPeriods() {
    const set = new Set();
    (state.data.Overtime || []).forEach((r) => {
      const y = r.year;
      MONTH_KEYS.forEach((k, i) => {
        const v = r[k];
        if (v != null && String(v) !== "") set.add(y + ":" + i);
      });
    });
    return Array.from(set).map((s) => {
      const [y, i] = s.split(":");
      return { year: Number(y), monthIdx: Number(i) };
    }).sort((a, b) => (b.year - a.year) || (b.monthIdx - a.monthIdx));
  }

  function computeComparison() {
    const periods = listPeriods();
    const hasA = state.compare.A && periods.some((p) => samePeriod(p, state.compare.A));
    const hasB = state.compare.B && periods.some((p) => samePeriod(p, state.compare.B));
    if (!state.compareManual || !hasA || !hasB) {
      if (periods.length) {
        state.compare.A = periods.length > 1 ? periods[1] : periods[0];
        state.compare.B = periods[0];
      } else {
        state.compare.A = null;
        state.compare.B = null;
      }
      state.compareManual = false;
    }
    return state.compare;
  }

  function monthValues(period) {
    const out = {};
    if (!period) return out;
    (state.data.Overtime || []).forEach((r) => {
      if (String(r.year) === String(period.year)) {
        const v = r[MONTH_KEYS[period.monthIdx]];
        if (v != null && String(v) !== "") out[r.project] = Number(v);
      }
    });
    return out;
  }

  function monthStats(period) {
    const values = monthValues(period);
    const arr = Object.keys(values).map((k) => values[k]);
    return {
      values,
      sum: arr.reduce((a, b) => a + b, 0),
      avg: arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
      count: arr.length,
    };
  }

  function pctText(pct) {
    const r = Math.round(pct);
    return (r > 0 ? "+" : "") + r + "%";
  }

  /* ---------- Rendering ---------- */
  function renderAll() {
    renderOverview();
    Object.keys(SECTIONS).forEach((s) => (SECTIONS[s].card ? render5S() : renderTable(s)));
  }

  function countEl(s, rows) {
    const el = $("#count-" + s);
    if (el) el.textContent = rows.length + " entr" + (rows.length === 1 ? "y" : "ies");
  }

  function emptyBlock(msg) {
    return `<div class="empty"><div class="big">📭</div>${msg}</div>`;
  }

  function loadingTable() {
    return `<tr class="loading-row"><td colspan="10"><span class="spinner"></span> Loading&hellip;</td></tr>`;
  }

  function renderEmptySection(s) {
    const name = SECTIONS[s].title;
    if (SECTIONS[s].card) {
      const grid = $("#grid-" + s);
      if (grid) grid.innerHTML = emptyBlock(`No ${esc(name)} entries yet.`);
    } else {
      const tbody = $("#tbody-" + s);
      if (tbody) tbody.innerHTML = `<tr class="loading-row"><td colspan="10"><span class="spinner"></span> Loading&hellip;</td></tr>`;
    }
    countEl(s, []);
  }

  /* --- Overview --- */
  function renderOverview() {
    const wrap = $("#overviewStats");
    const d = state.data;

    const counts = Object.keys(SECTIONS).reduce((acc, s) => { acc[s] = d[s].length; return acc; }, {});
    const projects5s = distinctProjects("5S");

    const manActive = sum(d.Manpower, "active");
    const manBalance = sum(d.Manpower, "balanceprf");

    const c = { Pending: 0, Ongoing: 0, Issues: 0 };
    d.Contracts.forEach((r) => { const k = String(r.status); if (c[k] != null) c[k]++; });

    const cmp = computeComparison();
    const tA = cmp.A ? monthStats(cmp.A) : { sum: 0 };
    const tB = cmp.B ? monthStats(cmp.B) : { sum: 0 };
    const pct = tA.sum > 0 ? ((tB.sum - tA.sum) / tA.sum) * 100 : 0;

    const otSub = cmp.B
      ? `<span class="${pct > 0 ? "up" : pct < 0 ? "down" : "flat"}">${pct > 0 ? "▲" : pct < 0 ? "▼" : "—"} ${pctText(pct)}</span> vs ${esc(periodLabel(cmp.A))}`
      : "No overtime data yet";

    wrap.innerHTML =
      statCard("5S Entries", counts["5S"] + `<small> · ${projects5s.length} proj.</small>`, "gallery", "5S", "Click to open 5S entries") +
      statCard("Active Manpower", fmtNum(manActive, 0), "person", "Manpower",
        `Balance PRF ${fmtNum(manBalance, 0)}`) +
      statCard("Contracts by Status", counts.Contracts, "description", "Contracts",
        `<span class="badge badge-pending">Pending ${c.Pending}</span> <span class="badge badge-ongoing">Ongoing ${c.Ongoing}</span> <span class="badge badge-issues">Issues ${c.Issues}</span>`) +
      statCard("Overtime Latest (h)", fmtNum(tB.sum, 1), "schedule", "Overtime", otSub);

    renderComparison();
  }

  function statCard(label, num, icon, page, sub) {
    return `<div class="stat-card" onclick="go('${page}')">
      <div class="stat-label">${label}</div>
      <div class="stat-num">${num}</div>
      <div class="stat-sub">${sub || ""}</div>
    </div>`;
  }

  function sum(rows, key) {
    return rows.reduce((t, r) => { const n = Number(r[key]); return t + (isNaN(n) ? 0 : n); }, 0);
  }

  /* --- Overtime comparison card (overview + overtime page) --- */
  function renderComparison() {
    $("#otBars").innerHTML = comparisonHTML();
    const otCard = $("#otCompareCard");
    if (otCard) otCard.innerHTML = comparisonHTML();
  }

  function comparisonHTML() {
    const cmp = computeComparison();
    if (!cmp.B) return emptyBlock("No overtime data yet — add the first month's hours with <b>＋ Add OT Entry</b>.");

    const tA = monthStats(cmp.A);
    const tB = monthStats(cmp.B);
    const pct = tA.sum > 0 ? ((tB.sum - tA.sum) / tA.sum) * 100 : (tB.sum > 0 ? 100 : 0);
    const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
    const stateWord = pct > 0 ? "increasing" : pct < 0 ? "decreasing" : "unchanged";

    const projects = Object.keys(tA.values);
    Object.keys(tB.values).forEach((p) => { if (!projects.includes(p)) projects.push(p); });
    const max = Math.max(...projects.map((p) => Math.max(tA.values[p] || 0, tB.values[p] || 0)), 1);

    const bars = projects.map((p) => {
      const a = tA.values[p] || 0;
      const b = tB.values[p] || 0;
      const ap = (a / max) * 100;
      const bp = (b / max) * 100;
      const pp = a > 0 ? ((b - a) / a) * 100 : (b > 0 ? 100 : 0);
      const pcls = pp > 0 ? "up" : pp < 0 ? "down" : "flat";
      const parrow = pp > 0 ? "▲" : pp < 0 ? "▼" : "—";
      return `<div class="ot-item">
        <div class="ot-label"><span>${esc(p)}</span>
          <span class="pct ${pcls}">${parrow} ${a > 0 ? pctText(pp) : (b > 0 ? "new" : "—")}</span></div>
        <div class="ot-track">
          <div class="july" style="width:${ap.toFixed(1)}%" title="${esc(periodLabel(cmp.A))}: ${fmtNum(a, 1)} h"></div>
          <div class="aug" style="width:${bp.toFixed(1)}%" title="${esc(periodLabel(cmp.B))}: ${fmtNum(b, 1)} h"></div>
        </div>
      </div>`;
    }).join("");

    return `<div class="cmp-summary">
      <div class="cmp-pair">
        <div class="cmp-box cmp-box-a">
          <span class="cmp-lbl">${esc(periodLabel(cmp.A))}</span>
          <b>${fmtNum(tA.sum, 1)} <small>hrs</small></b>
          <small>avg ${fmtNum(tA.avg, 1)} h / project · ${tA.count} ${tA.count === 1 ? "project" : "projects"}</small>
        </div>
        <div class="cmp-arrow ${cls}">${arrow} ${pctText(pct)}</div>
        <div class="cmp-box cmp-box-b">
          <span class="cmp-lbl">${esc(periodLabel(cmp.B))}</span>
          <b>${fmtNum(tB.sum, 1)} <small>hrs</small></b>
          <small>avg ${fmtNum(tB.avg, 1)} h / project · ${tB.count} ${tB.count === 1 ? "project" : "projects"}</small>
        </div>
      </div>
      <p class="cmp-note">${arrow} Overtime is <b>${stateWord}</b> month-over-month.</p>
      <div class="ot-bars">${bars || emptyBlock("No matching projects in the selected months.")}</div>
      <div class="ot-legend">
        <span class="lj">${esc(periodLabel(cmp.A))}</span>
        <span class="la">${esc(periodLabel(cmp.B))}</span>
        <span class="ot-note">Bar length scaled to the largest month total</span>
      </div>
    </div>`;
  }

  /* --- 5S cards --- */
  const _photoReg = {};   // id -> [{url}]

  function render5S() {
    const grid = $("#grid-5S");
    if (!grid) return;
    const rows = filteredRows("5S");
    countEl("5S", rows);
    if (!rows.length) {
      grid.innerHTML = emptyBlock("No 5S entries yet — click <b>＋ Add 5S Entry</b> to upload photos.");
      return;
    }
    grid.innerHTML = rows.map((r) => {
      const photos = Array.isArray(r.photos) ? r.photos : [];
      const pid = "p" + (r.rowNumber || "x");
      _photoReg[pid] = photos;
      const strip = photos.length
        ? photos.slice(0, 6).map((p, i) =>
          `<img src="${esc(p)}" alt="5S photo" onclick="openLightbox('${pid}', ${i})">`).join("")
        : `<div class="entry-sub" style="padding:30px 8px">No photos</div>`;
      return `<div class="entry-card">
        <div class="photo-strip">${strip}</div>
        <div class="entry-body">
          <div class="entry-title">${esc(r.project)}</div>
          <div class="entry-sub">${esc(r.area)} · ${esc(r.date)}</div>
          ${r.remarks ? `<div class="entry-remarks">${esc(r.remarks)}</div>` : ""}
        </div>
        <div class="entry-actions">
          <button class="btn btn-soft btn-sm" onclick="openEntryModal('5S', ${r.rowNumber})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="delEntry('5S', ${r.rowNumber})">Delete</button>
        </div>
      </div>`;
    }).join("");
  }

  /* --- Tables (Manpower, Contracts, Overtime) --- */
  function renderTable(s) {
    const tbody = $("#tbody-" + s);
    if (!tbody) return;
    const rows = filteredRows(s);
    countEl(s, rows);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-td"><div class="empty">No ${esc(SECTIONS[s].title)} entries yet.</div></td></tr>`;
      return;
    }
    if (s === "Overtime") { renderOvertimeTable(tbody, rows); return; }
    tbody.innerHTML = rows.map((r) => {
      if (s === "Manpower") {
        return `<tr>
          <td><b>${esc(r.project)}</b></td>
          <td class="num">${fmtNum(r.active, 0)}</td>
          <td class="num">${fmtNum(r.balanceprf, 0)}</td>
          <td class="num">${fmtNum(r.transferred, 0)}</td>
          <td>${esc(r.asof)}</td>
          <td>${esc(r.remarks)}</td>
          <td class="act">${actionsHtml(s, r.rowNumber)}</td>
        </tr>`;
      }
      if (s === "Contracts") {
        const st = String(r.status || "").toLowerCase();
        const badge = `badge-${["pending", "ongoing", "issues"].includes(st) ? st : "pending"}`;
        return `<tr>
          <td><b>${esc(r.project)}</b></td>
          <td>${esc(r.contract)}</td>
          <td><span class="badge ${badge}">${esc(r.status)}</span></td>
          <td>${esc(r.issue)}</td>
          <td>${esc(r.updated)}</td>
          <td>${esc(r.remarks)}</td>
          <td class="act">${actionsHtml(s, r.rowNumber)}</td>
        </tr>`;
      }
      return "";
    }).join("");
  }

  function renderOvertimeTable(tbody, rows) {
    const cmp = computeComparison();
    const totals = MONTH_KEYS.map((k) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));

    $$("#table-Overtime thead th[data-month]").forEach((th) => th.classList.remove("cmp-a", "cmp-b"));
    if (cmp.A) {
      const thA = $(`#table-Overtime thead th[data-month="${cmp.A.monthIdx}"]`);
      if (thA) thA.classList.add("cmp-a");
    }
    if (cmp.B) {
      const thB = $(`#table-Overtime thead th[data-month="${cmp.B.monthIdx}"]`);
      if (thB) thB.classList.add("cmp-b");
    }

    const monthCells = (r) => MONTH_KEYS.map((k, i) => {
      let cls = "num";
      if (cmp.A && String(r.year) === String(cmp.A.year) && i === cmp.A.monthIdx) cls += " cmp-a";
      if (cmp.B && String(r.year) === String(cmp.B.year) && i === cmp.B.monthIdx) cls += " cmp-b";
      const v = r[k];
      return `<td class="${cls}">${v == null || v === "" ? "—" : fmtNum(v, 1)}</td>`;
    }).join("");

    tbody.innerHTML = rows.map((r) => `<tr>
        <td><b>${esc(r.project)}</b></td>
        <td>${esc(r.year)}</td>
        ${monthCells(r)}
        <td>${esc(r.asof)}</td>
        <td class="act">${actionsHtml("Overtime", r.rowNumber)}</td>
      </tr>`).join("") +
      `<tr class="tbl-total">
        <td><b>Totals</b></td><td></td>
        ${totals.map((t) => `<td class="num">${t ? fmtNum(t, 1) : "—"}</td>`).join("")}
        <td></td><td></td>
      </tr>`;
  }

  function actionsHtml(s, rowNum) {
    return `<button class="btn btn-soft btn-sm" onclick="openEntryModal('${s}', ${rowNum})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="delEntry('${s}', ${rowNum})">Delete</button>`;
  }

  /* ---------- Navigation ---------- */
  window.go = function (page) {
    closeNavIfMobile();
    state.section = page;
    $$(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
    $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + page));
    window.scrollTo({ top: 0, behavior: "smooth" });
    renderAll();
  };

  function closeNavIfMobile() {
    $("#sidenav").classList.remove("open");
    $("#drawerOverlay").classList.remove("show");
    $("#navToggle").setAttribute("aria-expanded", "false");
  }

  /* ---------- Modal ---------- */
  window.openEntryModal = function (section, rowNum) {
    if (!GOOGLE_SCRIPT_URL) { toast("Set your Apps Script URL in js/config.js first.", "err"); return; }
    const def = SECTIONS[section];
    if (!def) return;
    state.editingSection = section;
    state.editingRow = rowNum || null;
    const isEdit = !!state.editingRow;

    let html = `<div class="form-grid">`;
    def.fields.forEach((f) => {
      html += `<div class="field ${f.type === "textarea" || f.type === "file" ? "full" : ""}">
        <label>${f.label}${f.required ? ' <span class="req">*</span>' : ""}</label>`;
      if (f.type === "select") {
        html += `<select data-field="${f.key}">${f.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
      } else if (f.type === "textarea") {
        html += `<textarea data-field="${f.key}" rows="3"></textarea>`;
      } else if (f.type === "file") {
        html += `<input type="file" data-field="${f.key}" accept="image/*" ${f.multiple ? "multiple" : ""}>`;
        html += `<div class="file-note">${f.note || "Max dimension 1280px, auto-resized on upload."}</div>`;
        html += `<div class="upload-list" id="uploadList"></div>`;
      } else {
        html += `<input type="${f.type}" data-field="${f.key}" step="${f.step || ""}">`;
      }
      html += `</div>`;
    });
    html += `</div>`;

    $("#modalTitle").textContent = (isEdit ? "Edit " : "Add ") + def.title;
    $("#entryForm").innerHTML = html;
    $("#btnSave").disabled = false;
    $("#btnSave").textContent = isEdit ? "Save Changes" : "Save";

    if (isEdit) fillForm(section, findRow(section, state.editingRow));

    $("#modal").classList.remove("hidden");
    document.body.style.overflow = "hidden";

    if (!isEdit) {
      const f = $("#entryForm").querySelector("[data-field=date], [data-field=asof], [data-field=updated]");
      if (f) f.value = todayISO();
      const yr = $("#entryForm").querySelector('[data-field="year"]');
      if (yr) yr.value = new Date().getFullYear();
      const m = $("#entryForm").querySelector('[data-field="month"]');
      if (m) m.value = MONTH_NAMES[new Date().getMonth()];
    }
  };

  window.closeModal = function () {
    $("#modal").classList.add("hidden");
    document.body.style.overflow = "";
    state.editingRow = null;
    state.editingSection = null;
  };

  function findRow(section, rowNum) {
    return (state.data[section] || []).find((r) => r.rowNumber === rowNum);
  }

  function fillForm(section, row) {
    if (!row) return;
    SECTIONS[section].fields.forEach((f) => {
      const input = $("#entryForm").querySelector(`[data-field="${f.key}"]`);
      if (!input) return;
      if (input.type === "file") return;
      if (f.key === "month" || f.key === "hours") return;   // handled below for Overtime
      input.value = row[f.key] == null ? "" : row[f.key];
    });
    if (section === "Overtime") {
      const monthSel = $("#entryForm").querySelector('[data-field="month"]');
      const hoursEl = $("#entryForm").querySelector('[data-field="hours"]');
      for (let i = 11; i >= 0; i--) {
        const v = row[MONTH_KEYS[i]];
        if (v != null && String(v) !== "") {
          if (monthSel) monthSel.value = MONTH_NAMES[i];
          if (hoursEl) hoursEl.value = v;
          break;
        }
      }
    }
  }

  /* ---------- Image handling ---------- */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > MAX_PHOTO_DIM || h > MAX_PHOTO_DIM) {
            const r = Math.min(MAX_PHOTO_DIM / w, MAX_PHOTO_DIM / h);
            w = Math.round(w * r); h = Math.round(h * r);
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          const isPng = file.type === "image/png";
          const type = isPng ? "image/png" : "image/jpeg";
          const dataUrl = canvas.toDataURL(type, PHOTO_QUALITY);
          resolve({
            base64: dataUrl.split(",")[1],
            mime: type,
            name: (file.name || "photo").replace(/[^\w.\- ]+/g, "_").replace(/\.jpe?g$/i, ".jpg"),
          });
        };
        img.onerror = () => reject(new Error("Cannot read image: " + file.name));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("File read error"));
      reader.readAsDataURL(file);
    });
  }

  async function uploadPhotos(files, listEl) {
    const urls = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      listEl.innerHTML += `<div>Uploading ${esc(f.name)}…</div>`;
      try {
        const img = await fileToBase64(f);
        const resp = await callScript({
          action: "upload",
          key: API_KEY,
          fileName: img.name,
          mimeType: img.mime,
          fileData: img.base64,
        });
        urls.push(resp.url);
        listEl.innerHTML += `<div class="ok">✔ ${esc(f.name)} → Google Drive</div>`;
      } catch (err) {
        listEl.innerHTML += `<div style="color:var(--red)">✖ ${esc(f.name)}: ${esc(err.message)}</div>`;
        throw err;
      }
    }
    return urls;
  }

  /* ---------- Save / delete ---------- */
  $("#entryForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const section = state.editingSection;
    if (!section) return;
    const def = SECTIONS[section];

    const row = {};
    let missing = null;
    def.fields.forEach((f) => {
      const input = this.querySelector(`[data-field="${f.key}"]`);
      if (!input) return;
      if (input.type === "file") return;
      row[f.key] = input.value.trim();
      if (f.required && !row[f.key]) missing = f.label;
    });

    if (missing) { toast(`Please fill in: ${missing}`, "err"); return; }

    const saveBtn = $("#btnSave");
    saveBtn.disabled = true;
    state.uploading = true;
    try {
      const fileInput = this.querySelector('[data-field="photos"]');
      if (fileInput && fileInput.files.length) {
        const listEl = $("#uploadList");
        listEl.innerHTML = "";
        toast("Uploading photos to Google Drive…", "info");
        row.photos = await uploadPhotos(Array.from(fileInput.files), listEl);
      }
      if (state.editingRow && section === "5S") {
        const existing = (findRow(section, state.editingRow).photos || []);
        if (row.photos) row.photos = existing.concat(row.photos);
      }

      /* Overtime: turn Month + Hours into the right month column of a project's row */
      let targetRowNumber = state.editingRow;
      if (section === "Overtime") {
        const monthName = row.month;
        const monthKey = MONTH_KEYS[MONTH_NAMES.indexOf(monthName)];
        const hours = row.hours;
        delete row.month;
        delete row.hours;
        if (!monthKey) { toast("Please choose a valid month.", "err"); saveBtn.disabled = false; return; }

        if (targetRowNumber) {
          const existing = findRow(section, targetRowNumber) || {};
          row = Object.assign({}, existing, row, { [monthKey]: hours });
        } else {
          const dup = state.data.Overtime.find((r) =>
            String(r.project) === row.project && String(r.year) === String(row.year));
          if (dup) {
            row = Object.assign({}, dup, row, { [monthKey]: hours });
            delete row.rowNumber;
            targetRowNumber = dup.rowNumber;
          } else {
            const base = { project: row.project, year: row.year, asof: row.asof, remarks: row.remarks };
            MONTH_KEYS.forEach((k) => { base[k] = ""; });
            base[monthKey] = hours;
            row = base;
          }
        }
      }

      let res;
      if (targetRowNumber) {
        res = await callScript({ action: "update", sheet: section, key: API_KEY, rowNumber: targetRowNumber }, { row });
      } else {
        res = await callScript({ action: "add", sheet: section, key: API_KEY }, { row });
      }
      toast(targetRowNumber && section === "Overtime" ? "Overtime month saved to Google Sheets" : "Entry saved to Google Sheets", "ok");
      closeModal();
      await refreshData(true);
    } catch (err) {
      toast("Save failed: " + err.message, "err");
      saveBtn.disabled = false;
    } finally {
      state.uploading = false;
    }
  });

  window.delEntry = async function (section, rowNum) {
    if (!confirm("Delete this entry from Google Sheets?")) return;
    try {
      await callScript({ action: "delete", sheet: section, key: API_KEY, rowNumber: rowNum });
      toast("Entry deleted", "ok");
      await refreshData(true);
    } catch (err) {
      toast("Delete failed: " + err.message, "err");
    }
  };

  /* ---------- Compare selects ---------- */
  function buildCompareControls() {
    const a = $("#cmpA");
    const b = $("#cmpB");
    if (!a || !b) return;
    const periods = listPeriods();
    const opts = periods.map((p) =>
      `<option value="${periodVal(p)}">${esc(periodLabel(p))}</option>`).join("");
    a.innerHTML = opts;
    b.innerHTML = opts;
    a.disabled = !periods.length;
    b.disabled = !periods.length;
    if (periods.length) {
      a.value = periodVal(state.compare.A);
      b.value = periodVal(state.compare.B);
    }
  }

  function syncCompareFromUI() {
    const a = $("#cmpA");
    const b = $("#cmpB");
    if (!a || !b || !a.value) return;
    state.compare.A = parsePeriod(a.value);
    state.compare.B = parsePeriod(b.value);
    state.compareManual = true;
  }

  /* ---------- Lightbox ---------- */
  window.openLightbox = function (pid, index) {
    const photos = _photoReg[pid] || [];
    if (!photos.length) return;
    let i = index || 0;
    const img = $("#lbImg");
    const cap = $("#lbCaption");
    function show() {
      img.src = photos[i];
      cap.textContent = `Photo ${i + 1} of ${photos.length}`;
    }
    show();
    img.onclick = () => { i = (i + 1) % photos.length; show(); };
    $("#lightbox").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  };

  window.closeLightbox = function () {
    $("#lightbox").classList.add("hidden");
    document.body.style.overflow = "";
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeLightbox(); }
  });

  /* ---------- Init ---------- */
  function init() {
    $("#navToggle").addEventListener("click", () => {
      const open = $("#sidenav").classList.toggle("open");
      $("#drawerOverlay").classList.toggle("show", open);
      $("#navToggle").setAttribute("aria-expanded", String(open));
    });
    $("#drawerOverlay").addEventListener("click", closeNavIfMobile);
    $("#btnRefresh").addEventListener("click", () => refreshData(false));

    $$(".nav-link").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.page); }));

    Object.keys(SECTIONS).forEach((s) => {
      const sel = $("#filter-" + s);
      if (sel) sel.addEventListener("change", () => (SECTIONS[s].card ? render5S() : renderTable(s)));
    });
    const sf = $("#statusFilter-Contracts");
    if (sf) sf.addEventListener("change", () => renderTable("Contracts"));
    ["#cmpA", "#cmpB"].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener("change", () => { syncCompareFromUI(); renderAll(); });
    });

    refreshData(true);
  }

  document.addEventListener("DOMContentLoaded", init);
})();