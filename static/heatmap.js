/* Module heatmap (absence per student per week)
   Self-contained. Does not modify other parts of the app. */
(function () {
  if (!window.__REPORT__) return;

  // Required DOM nodes for the heatmap section
  const ids = [
    "heatModule","heatQual","heatMode","heatSort","heatTopN",
    "heatLegend","heatmapWrap","moduleHeatmap","heatTableWrap",
    "downloadHeatCsv","drawHeatmap"
  ];
  if (!ids.every(id => document.getElementById(id))) return;
(function () {
  const report = window.__REPORT__ || {};
  if (!report || !report.student_enabled) return;

  // ------- DOM -------
  const studentSearch = document.getElementById("studentSearch");
  const analyzeStudentBtn = document.getElementById("analyzeStudentBtn");
  const studentSelectedNote = document.getElementById("studentSelectedNote");

  // legacy top heatmap
  const stuModuleForHeatmap = document.getElementById("stuModuleForHeatmap");
  const renderStudentHeatmapBtn = document.getElementById("renderStudentHeatmap");

  // inline multi-module heatmap
  const hmModule = document.getElementById("hmModule"); // MULTI
  const hmFrom = document.getElementById("hmFrom");
  const hmTo = document.getElementById("hmTo");
  const hmRender = document.getElementById("hmRender");

  const stuHeatmapWrap = document.getElementById("stuHeatmapWrap");
  const stuModSummaryWrap = document.getElementById("stuModSummaryWrap");

  // top list filters (kept)
  const topModuleSelect = document.getElementById("topModuleSelect");
  const topQualSelect = document.getElementById("topQualSelect");
  const topNStudent = document.getElementById("topNStudent");
  const topBasis = document.getElementById("topBasis");
  const rateBand = document.getElementById("rateBand");
  const renderTopListBtn = document.getElementById("renderTopList");
  const topStudentList = document.getElementById("topStudentList");

  // ------- helpers -------
  const ALL_WEEKS = sortedWeeks(report.weeks || []);

  function normalizeId(input) {
    if (!input) return "";
    const s = String(input).trim();
    const m = s.match(/^\s*(\d{5,})\b/);
    return m ? m[1] : s;
  }
  function sortedWeeks(weeks) {
    const ws = (weeks || []).map(String);
    const items = ws.map(w => {
      const n = (w.match(/\d+/) || ["0"])[0];
      return { n: parseInt(n, 10), w };
    });
    items.sort((a, b) => a.n - b.n || a.w.localeCompare(b.w));
    return items.map(x => x.w);
  }
  const labelToId = {};
  (report.student_lookup || []).forEach(s => {
    if (s && s.label) labelToId[s.label] = s.id || normalizeId(s.label);
  });
  function sidFromInput() {
    const typed = studentSearch?.value || "";
    return labelToId[typed] || normalizeId(typed);
  }

  // ---- options fill ----
  function fillModuleSelectForStudent(selectEl, sid, multi = false) {
    const modMap = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};
    const mods = Object.keys(modMap).sort((a, b) => a.localeCompare(b));
    if (!mods.length) {
      selectEl.innerHTML = `<option value="">No module data for this student</option>`;
      return null;
    }
    if (multi) {
      selectEl.innerHTML =
        `<option value="__ALL__">(All modules)</option>` +
        mods.map(m => `<option value="${m}">${m}</option>`).join("");
    } else {
      selectEl.innerHTML =
        `<option value="">Select a module…</option>` +
        mods.map(m => `<option value="${m}">${m}</option>`).join("");
    }
    return mods[0];
  }

  function fillWeeks(selectEl) {
    selectEl.innerHTML = `<option value="">Auto</option>` +
      ALL_WEEKS.map(w => `<option value="${w}">${w}</option>`).join("");
  }

  // ---- heatmap render (multi-row) ----
  function renderStudentHeatmapRows(sid, modules, wStart, wEnd) {
    if (!stuHeatmapWrap) return;
    const modMapAll = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};

    if (!modules || !modules.length) {
      stuHeatmapWrap.innerHTML = `<p class="muted tiny">Pick at least one module.</p>`;
      return;
    }

    // build columns from overall weeks (to align rows), then apply range
    let weeks = ALL_WEEKS.slice();
    if (wStart || wEnd) {
      const startN = wStart ? parseInt((String(wStart).match(/\d+/) || ["0"])[0], 10) : -Infinity;
      const endN   = wEnd   ? parseInt((String(wEnd).match(/\d+/) || ["0"])[0], 10) : Infinity;
      weeks = weeks.filter(w => {
        const n = parseInt((w.match(/\d+/) || ["0"])[0], 10);
        return n >= startN && n <= endN;
      });
    }
    if (!weeks.length) {
      stuHeatmapWrap.innerHTML = `<p class="muted tiny">No weeks in the selected range.</p>`;
      return;
    }

    const head = weeks.map(w => {
      const shortW = (w.match(/\d+/) || [""])[0] || w;
      return `<th>W${shortW}</th>`;
    }).join("");

    const bodyRows = modules.map(mod => {
      const wkMap = modMapAll[mod] || {};
      const tds = weeks.map(w => {
        const v = Number(wkMap[w] || 0);
        let bucket = 0;
        if (v >= 3) bucket = 4; else if (v === 2) bucket = 2; else if (v === 1) bucket = 1;
        return `<td class="hm-cell hm-${bucket}" title="${mod} — ${w}: ${v}">${v}</td>`;
      }).join("");
      return `<tr><td><strong>${mod}</strong></td>${tds}</tr>`;
    }).join("");

    stuHeatmapWrap.innerHTML = `
      <table>
        <thead><tr><th>Module</th>${head}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;
  }

  // ---- student module summary ----
  function computeSummaryLocally(sid) {
    const rows = [];
    const modMap = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};
    const capacity = report.module_week_capacity || {};
    (Object.keys(modMap)).forEach(mod => {
      const wkMap = modMap[mod] || {};
      const total = Object.values(wkMap).reduce((a, b) => a + Number(b || 0), 0);
      const caps = capacity[mod] || {};
      const denom = (report.weeks || []).reduce((s, w) => s + Number(caps[String(w)] || 0), 0);
      const rate = denom ? Math.round((total / denom) * 1000) / 10 : 0;
      rows.push({ module: mod, total_absences: total, rate });
    });
    return rows;
  }
  function renderStudentModuleSummary(sid) {
    if (!stuModSummaryWrap) return;
    let rows = (report.student_module_summary && report.student_module_summary[sid]) || [];
    if (!rows || !rows.length) rows = computeSummaryLocally(sid);
    if (!rows.length) {
      stuModSummaryWrap.innerHTML = `<p class="muted tiny">No module summary available for this student.</p>`;
      return;
    }
    const html = `
      <table>
        <thead>
          <tr><th>Module</th><th>Total Absences</th><th>Absence Rate (%)</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr><td>${r.module}</td><td>${r.total_absences}</td><td>${r.rate}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
    stuModSummaryWrap.innerHTML = html;
  }

  // ---- top-list rendering (unchanged logic, shows Absences only on the chip) ----
  function inBand(rate, band) {
    if (!band) return true;
    const r = Number(rate || 0);
    if (band === "low") return r <= 39;
    if (band === "moderate") return r >= 40 && r <= 69;
    if (band === "high") return r >= 70;
    return true;
  }
  function topStudentsData() {
    const base = (report.global_top_students_att || []).slice();
    const mod = topModuleSelect?.value || "";
    if (mod) {
      const arr = ((report.module_top_students_att || {})[mod] || []).map(x => ({
        id: x.id, label: x.label, count: x.count, rate: x.rate, qual: x.qual
      }));
      return arr;
    }
    return base;
  }
  function renderTopList() {
    if (!topStudentList) return;
    const n = parseInt(topNStudent?.value || "10", 10);
    const basis = topBasis?.value || "count";
    const band = rateBand?.value || "";
    const qual = (topQualSelect?.value || "").trim();

    let arr = topStudentsData();
    if (qual) {
      const rx = new RegExp(`\\[${qual.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\]`);
      arr = arr.filter(x => (x.qual && x.qual === qual) || rx.test(x.label || ""));
    }
    arr = arr.filter(x => inBand(x.rate, band));
    arr.sort((a, b) => {
      const av = basis === "rate" ? Number(a.rate) : Number(a.count);
      const bv = basis === "rate" ? Number(b.rate) : Number(b.count);
      return bv - av;
    });
    arr = arr.slice(0, n);

    if (!arr.length) {
      topStudentList.innerHTML = "<em>No data for the selection.</em>";
      return;
    }

    topStudentList.innerHTML = arr.map(x => {
      const count = Number(x.count ?? 0);
      return `
        <button class="btn btn-outline" data-sid="${x.id}" data-label="${x.label}" style="margin:4px 6px 0 0;">
          ${x.label}
          <span class="pill" style="margin-left:6px;">Absences: ${count}</span>
        </button>`;
    }).join("");

    topStudentList.querySelectorAll("button[data-sid]").forEach(b => {
      b.addEventListener("click", () => {
        if (studentSearch) studentSearch.value = b.dataset.label;
        analyzeStudent(b.dataset.sid, true);
      });
    });
  }

  // ---- analyze student ----
  function analyzeStudent(sid, autoRender = true) {
    if (!sid) sid = sidFromInput();
    if (!sid) {
      studentSelectedNote.textContent = "Pick a student.";
      return;
    }
    const picked = (report.student_lookup || []).find(x => x.id === sid);
    studentSelectedNote.textContent = picked ? `Selected: ${picked.label}` : `Selected: ${sid}`;

    renderStudentModuleSummary(sid);

    const firstModTop = fillModuleSelectForStudent(stuModuleForHeatmap, sid, false);
    fillModuleSelectForStudent(hmModule, sid, true);
    fillWeeks(hmFrom);
    fillWeeks(hmTo);

    if (autoRender) {
      // default: if user hasn’t chosen, render first module only
      if (firstModTop) {
        renderStudentHeatmapRows(sid, [firstModTop]);
      }
    }
  }

  // ------- events -------
  renderTopList();
  renderTopListBtn?.addEventListener("click", (e) => { e.preventDefault(); renderTopList(); });
  [topModuleSelect, topQualSelect, topNStudent, topBasis, rateBand].forEach(el => el?.addEventListener("change", renderTopList));

  analyzeStudentBtn?.addEventListener("click", (e) => { e.preventDefault(); analyzeStudent(); });

  // legacy single render
  renderStudentHeatmapBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    const sid = sidFromInput();
    if (!sid) { studentSelectedNote.textContent = "Pick a student first."; return; }
    const mod = stuModuleForHeatmap.value || "";
    if (!mod) { stuHeatmapWrap.innerHTML = `<p class="muted tiny">Pick a module.</p>`; return; }
    renderStudentHeatmapRows(sid, [mod]);
  });

  // inline multi render
  hmRender?.addEventListener("click", (e) => {
    e.preventDefault();
    const sid = sidFromInput();
    if (!sid) { studentSelectedNote.textContent = "Pick a student first."; return; }

    const sel = Array.from(hmModule?.selectedOptions || []).map(o => o.value);
    let modules = sel;

    // "(All modules)"
    if (modules.includes("__ALL__")) {
      const modMap = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};
      modules = Object.keys(modMap).sort((a,b)=>a.localeCompare(b));
    }

    if (!modules.length) {
      stuHeatmapWrap.innerHTML = `<p class="muted tiny">Pick at least one module.</p>`;
      return;
    }
    if (modules.length > 3) {
      modules = modules.slice(0, 3); // cap to 3 for readability
    }

    const from = hmFrom.value || "";
    const to = hmTo.value || "";
    renderStudentHeatmapRows(sid, modules, from, to);
  });
})();
  const report = window.__REPORT__;

  // ---------- Utilities ----------
  const sortedWeeks = (keys) =>
    (keys || [])
      .map(String)
      .map(w => ({ w, n: (w.match(/\d+/) || [0])[0] * 1 }))
      .sort((a,b)=>a.n-b.n)
      .map(x=>x.w);

  function colorForRate(r) {
    if (r == null || isNaN(r)) return "rgba(0,0,0,0)";
    // 0 -> green (120), 1 -> red (0)
    const h = Math.round((1 - Math.max(0, Math.min(1, r))) * 120);
    return `hsl(${h} 70% 45%)`;
  }

  // id -> name / qual maps (labels & filtering)
  const idToName = {};
  const idToQual = {};
  (report.student_lookup || []).forEach(s => {
    idToName[s.id] = s.name || "";
    idToQual[s.id] = s.qual || "";
  });

  function buildModuleWeeks(mod, qual) {
    const byMod = report.module_heatmap?.[mod] || {};
    const sids = Object.keys(byMod).filter(sid => !qual || (idToQual[sid] || "") === qual);
    const set = new Set();
    sids.forEach(sid => Object.keys(byMod[sid] || {}).forEach(w => set.add(String(w))));
    let weeks = Array.from(set);
    if (!weeks.length) weeks = report.weeks || [];
    return sortedWeeks(weeks);
  }

  // Excel-style rows: 0/1 per week + totals + rate
  function buildHeatRows(mod, qual, sortKey = "total_desc") {
    const byMod = report.module_heatmap?.[mod] || {};
    const weeks = buildModuleWeeks(mod, qual);
    const rows = [];

    Object.keys(byMod).forEach(sid => {
      if (qual && (idToQual[sid] || "") !== qual) return;
      const wkMap = byMod[sid] || {};
      const weekVals = {};
      let total = 0;

      weeks.forEach(w => {
        // Each value is [absence_count, total_rows]
        const entry = wkMap[w];
        const bin = entry ? ((entry[0] || 0) > 0 ? 1 : 0) : 0; // absent if >=1 flagged
        weekVals[w] = bin;
        total += bin;
      });

      const rate = weeks.length ? total / weeks.length : 0;
      rows.push({
        sid,
        name: idToName[sid] || "",
        qual: idToQual[sid] || "",
        weekVals,
        total,
        ratePct: Math.round(rate * 100)
      });
    });

    if (sortKey === "total_desc") rows.sort((a,b)=> b.total - a.total || a.sid.localeCompare(b.sid));
    else if (sortKey === "name_asc") rows.sort((a,b)=> (a.name||"").localeCompare(b.name||"") || a.sid.localeCompare(b.sid));
    else if (sortKey === "id_asc") rows.sort((a,b)=> a.sid.localeCompare(b.sid));

    return { weeks, rows };
  }

  function renderLegend(mode) {
    const legend = document.getElementById("heatLegend");
    if (!legend) return;
    const bar =
      mode === "binary"
        ? `linear-gradient(90deg, #ffffff, #ffffff 50%, #e74c3c)`
        : `linear-gradient(90deg, hsl(120 70% 45%), hsl(60 80% 50%), hsl(0 75% 50%))`;
    legend.innerHTML = `
      <span style="font-size:12px;opacity:.75">Legend:</span>
      <div style="height:10px;width:180px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:${bar};margin:0 6px;"></div>
      <span style="font-size:12px;opacity:.75">${mode==="binary"?"0":"0%"} </span>
      <span style="font-size:12px;opacity:.75">→</span>
      <span style="font-size:12px;opacity:.75">${mode==="binary"?"1":"100%"}</span>
    `;
  }

  function renderTable(mod, weeks, rows) {
    const host = document.getElementById("heatTableWrap");
    if (!host) return;
    if (!weeks.length || !rows.length) {
      host.innerHTML = "<p style='opacity:.7;font-size:12px;'>No data for this selection.</p>";
      return;
    }

    const headerWeeks = weeks.map(w => `<th style="text-align:center;">${w}</th>`).join("");
    const bodyRows = rows.map(r => {
      const tds = weeks.map(w => {
        const bin = r.weekVals[w] || 0;
        const style = bin
          ? "text-align:center;font-weight:600;background:#ffefef;color:#c0392b;"
          : "text-align:center;font-weight:600;";
        return `<td style="${style}">${bin || ""}</td>`;
      }).join("");
      const chip = `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-weight:700;color:#fff;background:${colorForRate(r.ratePct/100)}">${r.ratePct}%</span>`;
      return `<tr>
        <td>${r.sid}</td><td>${r.name || ""}</td><td>${mod}</td>
        ${tds}
        <td style="text-align:center;font-weight:700;">${r.total}</td>
        <td>${chip}</td>
      </tr>`;
    }).join("");

    host.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Student Number</th>
            <th>Student Name</th>
            <th>Module(s)</th>
            ${headerWeeks}
            <th>Total Absences</th>
            <th>Absence Rate (%)</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>`;
  }

  function wireCsv(mod, weeks, rows) {
    const btn = document.getElementById("downloadHeatCsv");
    if (!btn) return;
    btn.onclick = (e) => {
      e.preventDefault();
      const header = ["Student Number","Student Name","Module(s)",...weeks,"Total Absences","Absence Rate (%)"];
      const lines = [header.join(",")];
      rows.forEach(r => {
        const vals = weeks.map(w => r.weekVals[w] || 0);
        lines.push([r.sid, `"${(r.name||"").replace(/"/g,'""')}"`, mod, ...vals, r.total, r.ratePct].join(","));
      });
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `heatmap_${mod}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    };
  }

  // Load matrix plugin if it isn't on the page yet
  function ensureMatrixPlugin(cb) {
    try {
      const has =
        (Chart.registry && Chart.registry.controllers && Chart.registry.controllers.get && Chart.registry.controllers.get("matrix")) ||
        (Chart.controllers && Chart.controllers.matrix);
      if (has) return cb();
    } catch (_) {}
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chartjs-chart-matrix@2.0.2/dist/chartjs-chart-matrix.min.js";
    s.onload = cb;
    document.head.appendChild(s);
  }

  function draw() {
    const modSel  = document.getElementById("heatModule");
    const qualSel = document.getElementById("heatQual");
    const modeSel = document.getElementById("heatMode");
    const sortSel = document.getElementById("heatSort");
    const topNSel = document.getElementById("heatTopN");
    const wrap    = document.getElementById("heatmapWrap");
    const ctx     = document.getElementById("moduleHeatmap");

    const mod    = modSel.value || "";
    const qual   = qualSel.value || "";
    const mode   = modeSel.value || "binary";
    const sortBy = sortSel.value || "total_desc";
    const topN   = parseInt(topNSel.value || "20", 10) || 20;

    // If the backend hasn't sent module_heatmap, show a clear note
    if (!report.module_heatmap || !report.module_heatmap[mod]) {
      wrap.style.height = "260px";
      if (window.heatmapChart) { window.heatmapChart.destroy(); window.heatmapChart = null; }
      document.getElementById("heatTableWrap").innerHTML =
        "<p style='opacity:.7;font-size:12px;'>No heatmap data for this module. (Backend must provide <code>module_heatmap</code>.)</p>";
      renderLegend(mode);
      return;
    }

    const { weeks, rows } = buildHeatRows(mod, qual, sortBy);
    const chosen = rows.slice(0, topN);

    // y labels and points
    const yLabels = chosen.map(r => `${r.sid} — ${r.name}`.trim());
    const rowsCount = yLabels.length;
    const colsCount = weeks.length;

    const points = [];
    chosen.forEach((r, y) => {
      weeks.forEach((w, x) => {
        const bin = r.weekVals[w] || 0;
        const v = (mode === "binary") ? bin : (r.ratePct / 100);
        const color = (mode === "binary")
          ? (bin ? "#e74c3c" : "rgba(255,255,255,0.08)") // faint 0 so grid is visible
          : colorForRate(v);
        points.push({ x, y, v, bin, color });
      });
    });

    // dynamic height
    const cellH = 24;
    const height = Math.max(260, Math.min(800, rowsCount * cellH + 80));
    wrap.style.height = height + "px";

    // cell width based on columns
    const cellW = Math.max(18, Math.min(42, Math.floor(680 / Math.max(1, colsCount))));

    renderLegend(mode);

    if (window.heatmapChart) { window.heatmapChart.destroy(); window.heatmapChart = null; }
    window.heatmapChart = new Chart(ctx, {
      type: "matrix",
      data: {
        datasets: [{
          label: (mode === "binary") ? "Absent (1=absent)" : "Absence rate",
          data: points,
          backgroundColor: (c) => c.raw?.color || "rgba(0,0,0,0)",
          borderColor: "rgba(0,0,0,0.12)",
          borderWidth: 1,
          width: cellW,
          height: cellH
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: tip => {
                const d = tip.raw;
                if (mode === "binary") {
                  return `${yLabels[d.y]} — ${weeks[d.x]}: ${d.bin ? "Absent (1)" : "Present (0)"}`;
                }
                const pct = Math.round(d.v * 100);
                return `${yLabels[d.y]} — ${weeks[d.x]}: ${pct}% overall absence rate`;
              }
            }
          }
        },
        scales: {
          x: { type: "linear", position: "top", min: -0.5, max: colsCount - 0.5,
               ticks: { stepSize: 1, callback: v => weeks[v] ?? "" }, grid: { display: false } },
          y: { type: "linear", min: -0.5, max: rowsCount - 0.5,
               ticks: { stepSize: 1, callback: v => yLabels[v] ?? "" }, grid: { display: false } }
        }
      }
    });

    renderTable(mod, weeks, chosen);
    wireCsv(mod, weeks, chosen);
  }

  function redraw(e) { e && e.preventDefault(); ensureMatrixPlugin(draw); }

  document.getElementById("drawHeatmap").addEventListener("click", redraw);
  ensureMatrixPlugin(draw); // first render
})();
