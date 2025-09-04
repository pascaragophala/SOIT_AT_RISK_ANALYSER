(function () {
  // Theme toggle
  const body = document.documentElement;
  const key = "soit_theme";
  const btn = document.getElementById("themeToggle");
  function apply(theme) {
    if (theme === "light") { body.setAttribute("data-theme", "light"); if (btn) btn.textContent = "Dark mode"; }
    else { body.removeAttribute("data-theme"); if (btn) btn.textContent = "Light mode"; }
  }
  apply(localStorage.getItem(key) || "dark");
  btn?.addEventListener("click", () => {
    const next = (body.getAttribute("data-theme") === "light") ? "dark" : "light";
    localStorage.setItem(key, next); apply(next);
  });

  if (!window.__REPORT__) return;
  const report = window.__REPORT__;

  // Chart defaults
  Chart.defaults.font.family = '"Inter", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;

  // Utils
  const hideCardByCanvas = (id) => { const c = document.getElementById(id); if (c) c.closest(".card").classList.add("hidden"); };
  const hideEl = (id) => { const e = document.getElementById(id); if (e) e.classList.add("hidden"); };
  const showEl = (id) => { const e = document.getElementById(id); if (e) e.classList.remove("hidden"); };
  const normalizeId = (x) => String(x ?? "").trim().replace(/\.0+$/, "");
  const sortedWeeks = (keys) => {
    const arr = keys.map(String);
    return arr.map(w => ({ w, n: (w.match(/\d+/) || [0])[0]*1 })).sort((a,b)=>a.n-b.n).map(x=>x.w);
  };
  function setDynamicHeight(container, count, { perBar=26, minH=260, maxH=560 } = {}) {
    const h = Math.min(maxH, Math.max(minH, count * perBar + 80));
    container.style.setProperty("--h", h + "px");
  }

  // Builders
  function makeBar(ctx, labels, data, horizontal = false) {
    return new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Count", data }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: horizontal ? "y" : "x",
        plugins: { legend: { display: false }, tooltip: { intersect: false } },
        scales: {
          x: { ticks: { autoSkip: !horizontal, maxRotation: 0 }, grid: { display: !horizontal } },
          y: { beginAtZero: true, ticks: { precision: 0, autoSkip: horizontal ? false : true } }
        }
      }
    });
  }
  function makeDoughnut(ctx, labels, data) {
    return new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data, borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom" } } }
    });
  }
  function makeLine(ctx, labels, seriesArr) {
    return new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: seriesArr.map(s => ({ label: s.name, data: s.data, tension: .35, pointRadius: 2, pointHoverRadius: 4, fill: false }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom" } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  // ----- Static charts (unchanged) -----
  let moduleChart, riskChart, reasonChart, resolvedChart, weekRiskChart, nonAttendanceChart, resolvedRateChart;

  if (report.risk_counts && Object.keys(report.risk_counts).length) {
    riskChart = makeBar(document.getElementById("riskChart"), Object.keys(report.risk_counts), Object.values(report.risk_counts));
  } else { hideCardByCanvas("riskChart"); }

  if (report.by_reason && Object.keys(report.by_reason).length) {
    reasonChart = makeBar(document.getElementById("reasonChart"), Object.keys(report.by_reason), Object.values(report.by_reason));
  } else { hideCardByCanvas("reasonChart"); }

  if (report.resolved_counts && Object.keys(report.resolved_counts).length) {
    resolvedChart = makeDoughnut(document.getElementById("resolvedChart"), Object.keys(report.resolved_counts), Object.values(report.resolved_counts));
  } else { hideCardByCanvas("resolvedChart"); }

  if (report.week_risk && report.week_risk.weeks?.length) {
    weekRiskChart = makeLine(document.getElementById("weekRiskChart"), report.week_risk.weeks, report.week_risk.series);
  } else { hideCardByCanvas("weekRiskChart"); }

  if (report.by_week_attendance && Object.keys(report.by_week_attendance).length) {
    const weeks = sortedWeeks(Object.keys(report.by_week_attendance));
    const vals = weeks.map(w => report.by_week_attendance[w] || 0);
    nonAttendanceChart = new Chart(document.getElementById("nonAttendanceChart"), {
      type: "line",
      data: { labels: weeks, datasets: [{ label: "Non-attendance", data: vals, tension: .35, pointRadius: 2, pointHoverRadius: 4, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  } else { hideCardByCanvas("nonAttendanceChart"); }

  if (report.resolved_rate && Object.keys(report.resolved_rate).length) {
    const weeks = sortedWeeks(Object.keys(report.resolved_rate));
    const vals = weeks.map(w => report.resolved_rate[w]);
    resolvedRateChart = new Chart(document.getElementById("resolvedRateChart"), {
      type: "line",
      data: { labels: weeks, datasets: [{ label: "Resolved %", data: vals, tension: .35, pointRadius: 2, pointHoverRadius: 4, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: v => v + "%" } } } }
    });
  } else { hideCardByCanvas("resolvedRateChart"); }

  // ----- Modules chart with Week + Basis + Qualification -----
  const weekSel  = document.getElementById("weekFilter");
  const scopeSel = document.getElementById("moduleScope");
  const basisSel = document.getElementById("moduleBasis");
  const qualSel  = document.getElementById("qualFilter");
  const applyBtn = document.getElementById("applyFilters");
  const resetBtn = document.getElementById("resetFilters");

  function getModuleCounts({ week = "", basis = "all", scope = "all", qual = "" }) {
    let dataMap = {};
    const isTop = scope.startsWith("top");
    const topN = scope === "top3_att" ? 3 : scope === "top5_att" ? 5 : scope === "top10_att" ? 10 : null;

    if (basis === "attendance") {
      if (qual) {
        dataMap = week
          ? (report.by_week_module_att_by_qual?.[qual]?.[week] || {})
          : (report.by_module_att_by_qual?.[qual] || {});
      } else {
        dataMap = week
          ? (report.by_week_module_attendance?.[week] || {})
          : (report.by_module_attendance || {});
      }
    } else {
      if (qual) {
        dataMap = week
          ? (report.by_week_module_all_by_qual?.[qual]?.[week] || {})
          : (report.by_module_all_by_qual?.[qual] || {});
      } else {
        dataMap = week
          ? (report.by_week_module_all?.[week] || {})
          : (report.by_module || {});
      }
    }

    let pairs = Object.entries(dataMap).map(([k, v]) => [String(k), Number(v)]);
    pairs.sort((a, b) => b[1] - a[1]);
    if (isTop && topN) pairs = pairs.slice(0, topN);
    return { labels: pairs.map(p => p[0]), values: pairs.map(p => p[1]) };
  }

  function renderModuleChart() {
    const wrap = document.getElementById("moduleChartWrap");
    const ctx  = document.getElementById("moduleChart");
    if (!wrap || !ctx) return;
    const { labels, values } = getModuleCounts({
      week: weekSel?.value || "", basis: basisSel?.value || "all",
      scope: scopeSel?.value || "all", qual: qualSel?.value || ""
    });
    if (!labels.length) { hideCardByCanvas("moduleChart"); return; }
    setDynamicHeight(wrap, labels.length);
    moduleChart?.destroy();
    moduleChart = makeBar(ctx, labels, values, true);
  }
  renderModuleChart();
  applyBtn?.addEventListener("click", (e) => { e.preventDefault(); renderModuleChart(); });
  resetBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (weekSel) weekSel.value = "";
    if (scopeSel) scopeSel.value = "all";
    if (basisSel) basisSel.value = "all";
    if (qualSel)  qualSel.value  = "";
    renderModuleChart();
  });

  // ----- Student analysis (already in your app) -----
  if (report.student_enabled) {
    const studentSearch = document.getElementById("studentSearch");
    const topModuleSelect = document.getElementById("topModuleSelect");
    const topQualSelect   = document.getElementById("topQualSelect");
    const topNStudent = document.getElementById("topNStudent");
    const renderTopListBtn = document.getElementById("renderTopList");
    const analyzeStudentBtn = document.getElementById("analyzeStudentBtn");
    const topStudentList = document.getElementById("topStudentList");
    const studentSelectedNote = document.getElementById("studentSelectedNote");

    const labelToId = {};
    const idToLabel = {};
    const idToQual  = {};
    (report.student_lookup || []).forEach(s => {
      labelToId[s.label] = s.id; idToLabel[s.id] = s.label; idToQual[s.id] = s.qual || "";
    });

    let stuModAttChart, stuWeekAttChart, stuWeekRiskChart;

    function renderTopList() {
      const mod = topModuleSelect?.value || "";
      const qual= topQualSelect?.value || "";
      const n = parseInt(topNStudent?.value || "10", 10) || 10;

      let list = [];
      if (mod && qual && report.module_top_students_att_by_qual?.[qual]?.[mod]) {
        list = report.module_top_students_att_by_qual[qual][mod].slice(0, n);
      } else if (mod && report.module_top_students_att?.[mod]) {
        list = report.module_top_students_att[mod].slice(0, n);
      } else if (qual && report.global_top_students_att_by_qual?.[qual]) {
        list = report.global_top_students_att_by_qual[qual].slice(0, n);
      } else if (report.global_top_students_att) {
        list = report.global_top_students_att.slice(0, n);
      }

      if (!list.length) { topStudentList.innerHTML = "<em>No data for the selection.</em>"; return; }
      topStudentList.innerHTML = list.map(x =>
        `<button class="btn btn-outline" data-sid="${x.id}" data-label="${x.label}" style="margin:4px 6px 0 0;">${x.label} (${x.count})</button>`
      ).join("");

      topStudentList.querySelectorAll("button[data-sid]").forEach(b => {
        b.addEventListener("click", () => {
          if (studentSearch) studentSearch.value = b.dataset.label;
          analyzeStudent(b.dataset.sid);
        });
      });
    }

    function analyzeStudent(sid) {
      if (!sid) {
        const typed = studentSearch?.value || "";
        sid = labelToId[typed] || normalizeId(typed);
      }
      if (!sid) { studentSelectedNote.textContent = "Pick a student."; return; }

      const qual = idToQual[sid] || "";
      studentSelectedNote.textContent = `Selected: ${idToLabel[sid] || sid}${qual ? " · Qualification: " + qual : ""}`;

      // Non-attendance by module
      const modMap = report.ps_modules_att?.[sid] || {};
      const mods = Object.keys(modMap), modVals = mods.map(m => modMap[m]);
      const modWrap = document.getElementById("stuModAttWrap");
      setDynamicHeight(modWrap, mods.length);
      stuModAttChart?.destroy();
      if (mods.length) { stuModAttChart = makeBar(document.getElementById("stuModAttChart"), mods, modVals, true); showEl("stuModAttCard"); }
      else { hideEl("stuModAttCard"); }

      // Non-attendance by week
      const wkMap = report.ps_weeks_att?.[sid] || {};
      const weeks = sortedWeeks(Object.keys(wkMap));
      const wkVals = weeks.map(w => wkMap[w]);
      stuWeekAttChart?.destroy();
      if (weeks.length) { stuWeekAttChart = makeLine(document.getElementById("stuWeekAttChart"), weeks, [{ name: "Non-attendance", data: wkVals }]); showEl("stuWeekAttCard"); }
      else { hideEl("stuWeekAttCard"); }

      // Risk by week (multi-series)
      const wkRisk = report.ps_week_risk_counts?.[sid] || {};
      const wks = sortedWeeks(Object.keys(wkRisk));
      const riskNames = Array.from(new Set([].concat(...wks.map(w => Object.keys(wkRisk[w])))));
      const series = riskNames.map(name => ({ name, data: wks.map(w => (wkRisk[w][name] || 0)) }));
      stuWeekRiskChart?.destroy();
      if (wks.length && riskNames.length) { stuWeekRiskChart = makeLine(document.getElementById("stuWeekRiskChart"), wks, series); showEl("stuWeekRiskCard"); }
      else { hideEl("stuWeekRiskCard"); }

      // Risk by module table
      const riskMod = report.ps_risk_module_max?.[sid] || {};
      const tblWrap = document.getElementById("stuRiskModuleTable");
      if (Object.keys(riskMod).length) {
        const rows = Object.entries(riskMod).sort((a,b)=>a[0].localeCompare(b[0]));
        tblWrap.innerHTML = `<table><thead><tr><th>Module</th><th>Max risk</th></tr></thead>
          <tbody>${rows.map(([m,r])=>`<tr><td>${m}</td><td>${r}</td></tr>`).join("")}</tbody></table>`;
        showEl("stuRiskModuleCard");
      } else {
        tblWrap.innerHTML = "<p class='muted tiny'>No risk information for this student.</p>";
        showEl("stuRiskModuleCard");
      }
    }

    renderTopList();
    renderTopListBtn?.addEventListener("click", (e) => { e.preventDefault(); renderTopList(); });
    analyzeStudentBtn?.addEventListener("click", (e) => { e.preventDefault(); analyzeStudent(); });
  }

  // ----- NEW: Module heatmap (absence rate per student per week) -----
  let heatmapChart;

  function colorForRate(r) {
    if (r == null || isNaN(r)) return 'rgba(0,0,0,0)';
    // 0 -> green (120), 1 -> red (0)
    const h = Math.round((1 - Math.max(0, Math.min(1, r))) * 120);
    return `hsl(${h} 70% 45%)`;
  }

  function renderHeatmap() {
    const dataMap = report.module_heatmap || {};
    const modSel = document.getElementById("heatModule");
    const qualSel = document.getElementById("heatQual");
    const topNSel = document.getElementById("heatTopN");
    const wrap = document.getElementById("heatmapWrap");
    const ctx  = document.getElementById("moduleHeatmap");

    const mod = modSel?.value || "";
    const qual = qualSel?.value || "";
    const topN = parseInt(topNSel?.value || "20", 10) || 20;
    const byMod = dataMap[mod] || {};

    // Build id->label/qual maps from student_lookup
    const idToLabel = {};
    const idToQual  = {};
    (report.student_lookup || []).forEach(s => { idToLabel[s.id] = s.label; idToQual[s.id] = s.qual || ""; });

    // Filter students by qualification if chosen
    let sids = Object.keys(byMod);
    if (qual) sids = sids.filter(sid => (idToQual[sid] || "") === qual);

    // Compute total non-attendance for sorting
    const totals = sids.map(sid => {
      const weeks = byMod[sid] || {};
      let attSum = 0;
      Object.values(weeks).forEach(([att, tot]) => { attSum += Number(att || 0); });
      return { sid, attSum };
    }).sort((a,b) => b.attSum - a.attSum)
      .slice(0, topN);

    const chosen = totals.map(t => t.sid);

    // Weeks across chosen students
    let weekSet = new Set();
    chosen.forEach(sid => Object.keys(byMod[sid] || {}).forEach(w => weekSet.add(String(w))));
    let weeks = Array.from(weekSet);
    if (!weeks.length) {
      // fall back to global weeks list if there’s nothing yet
      weeks = report.weeks || [];
    }
    weeks = sortedWeeks(weeks);

    // y labels
    const yLabels = chosen.map(sid => idToLabel[sid] || sid);
    const rows = yLabels.length;
    const cols = weeks.length;

    // Matrix points
    const points = [];
    chosen.forEach((sid, y) => {
      const wkMap = byMod[sid] || {};
      weeks.forEach((w, x) => {
        const entry = wkMap[w];
        if (!entry) return;        // no data -> empty cell
        const [att, tot] = entry;
        if (!tot) return;
        const rate = att / tot;
        points.push({
          x, y, v: rate,
          att: Number(att || 0), tot: Number(tot || 0),
          sid, week: w
        });
      });
    });

    // Dynamic height: 24px per row
    const cellH = 24;
    const height = Math.max(260, Math.min(800, rows * cellH + 80));
    wrap.style.setProperty("--h", height + "px");

    // Cell width based on columns
    const cellW = Math.max(18, Math.min(42, Math.floor(680 / Math.max(1, cols))));

    heatmapChart?.destroy();
    heatmapChart = new Chart(ctx, {
      type: 'matrix',
      data: {
        datasets: [{
          label: 'Absence rate',
          data: points,
          backgroundColor: ctx => colorForRate(ctx.raw?.v),
          borderColor: 'rgba(0,0,0,0.15)',
          borderWidth: 1,
          width: cellW,
          height: cellH,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (tip) => {
                const d = tip.raw;
                const pct = (d.v * 100).toFixed(0) + "%";
                return `${yLabels[d.y]} — W${weeks[d.x]}: ${pct} (${d.att}/${d.tot})`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear', position: 'top',
            min: -0.5, max: cols - 0.5, ticks: {
              stepSize: 1, callback: v => weeks[v] ?? ''
            },
            grid: { display: false }
          },
          y: {
            type: 'linear',
            min: -0.5, max: rows - 0.5, ticks: {
              stepSize: 1, callback: v => yLabels[v] ?? ''
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  // Hook up heatmap button
  document.getElementById("drawHeatmap")?.addEventListener("click", (e) => {
    e.preventDefault(); renderHeatmap();
  });

  // Draw on load (uses first module)
  renderHeatmap();
})();
