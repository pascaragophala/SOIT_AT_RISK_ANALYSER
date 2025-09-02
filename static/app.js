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
  if (btn) btn.addEventListener("click", () => {
    const next = (body.getAttribute("data-theme") === "light") ? "dark" : "light";
    localStorage.setItem(key, next); apply(next);
  });

  if (!window.__REPORT__) return;
  const report = window.__REPORT__;

  // Chart defaults
  Chart.defaults.font.family = '"Inter", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;

  // ======= Helpers =======
  const hideCardByCanvas = (id) => { const c = document.getElementById(id); if (c) c.closest(".card").classList.add("hidden"); };
  const hideEl = (id) => { const e = document.getElementById(id); if (e) e.classList.add("hidden"); };
  const showEl = (id) => { const e = document.getElementById(id); if (e) e.classList.remove("hidden"); };

  function makeBar(ctx, labels, data, horizontal = false) {
    return new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Count", data }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
        datasets: seriesArr.map((s) => ({
          label: s.name, data: s.data, tension: 0.35, pointRadius: 2, pointHoverRadius: 4, fill: false
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom" } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }
  function setDynamicHeight(container, count, { perBar = 26, minH = 260, maxH = 560 } = {}) {
    const h = Math.min(maxH, Math.max(minH, count * perBar + 80));
    container.style.setProperty("--h", h + "px");
  }
  function sortedWeeks(keys) {
    const arr = keys.map(String);
    const withNum = arr.map(w => ({ w, n: (w.match(/\d+/) || [0])[0] * 1 }));
    withNum.sort((a, b) => a.n - b.n);
    return withNum.map(x => x.w);
  }

  // ======= Static charts =======
  let moduleChart, riskChart, reasonChart, resolvedChart, weekRiskChart, nonAttendanceChart, resolvedRateChart;

  if (report.risk_counts && Object.keys(report.risk_counts).length) {
    riskChart = makeBar(document.getElementById("riskChart"),
      Object.keys(report.risk_counts), Object.values(report.risk_counts));
  } else { hideCardByCanvas("riskChart"); }

  if (report.by_reason && Object.keys(report.by_reason).length) {
    reasonChart = makeBar(document.getElementById("reasonChart"),
      Object.keys(report.by_reason), Object.values(report.by_reason));
  } else { hideCardByCanvas("reasonChart"); }

  if (report.resolved_counts && Object.keys(report.resolved_counts).length) {
    resolvedChart = makeDoughnut(document.getElementById("resolvedChart"),
      Object.keys(report.resolved_counts), Object.values(report.resolved_counts));
  } else { hideCardByCanvas("resolvedChart"); }

  if (report.week_risk && report.week_risk.weeks && report.week_risk.series && report.week_risk.weeks.length) {
    weekRiskChart = makeLine(document.getElementById("weekRiskChart"),
      report.week_risk.weeks, report.week_risk.series);
  } else { hideCardByCanvas("weekRiskChart"); }

  if (report.by_week_attendance && Object.keys(report.by_week_attendance).length) {
    const weeks = sortedWeeks(Object.keys(report.by_week_attendance));
    const vals = weeks.map(w => report.by_week_attendance[w] || 0);
    nonAttendanceChart = new Chart(document.getElementById("nonAttendanceChart"), {
      type: "line",
      data: { labels: weeks, datasets: [{ label: "Non-attendance", data: vals, tension: 0.35, pointRadius: 2, pointHoverRadius: 4, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  } else { hideCardByCanvas("nonAttendanceChart"); }

  if (report.resolved_rate && Object.keys(report.resolved_rate).length) {
    const weeks = sortedWeeks(Object.keys(report.resolved_rate));
    const vals = weeks.map(w => report.resolved_rate[w]);
    resolvedRateChart = new Chart(document.getElementById("resolvedRateChart"), {
      type: "line",
      data: { labels: weeks, datasets: [{ label: "Resolved %", data: vals, tension: 0.35, pointRadius: 2, pointHoverRadius: 4, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: v => v + "%" } } } }
    });
  } else { hideCardByCanvas("resolvedRateChart"); }

  // ======= Modules chart with filters (kept from earlier) =======
  const weekSel  = document.getElementById("weekFilter");
  const scopeSel = document.getElementById("moduleScope");
  const basisSel = document.getElementById("moduleBasis");
  const applyBtn = document.getElementById("applyFilters");
  const resetBtn = document.getElementById("resetFilters");

  function getModuleCounts({ week = "", basis = "all", scope = "all" }) {
    let dataMap = {};
    const isTop = scope.startsWith("top");
    const topN = scope === "top3_att" ? 3 : scope === "top5_att" ? 5 : scope === "top10_att" ? 10 : null;

    if (basis === "attendance") {
      if (week && report.by_week_module_attendance && report.by_week_module_attendance[week]) {
        dataMap = report.by_week_module_attendance[week];
      } else if (report.by_module_attendance) {
        dataMap = report.by_module_attendance;
      }
    } else {
      if (week && report.by_week_module_all && report.by_week_module_all[week]) {
        dataMap = report.by_week_module_all[week];
      } else if (report.by_module) {
        dataMap = report.by_module;
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

    const week  = weekSel ? weekSel.value : "";
    const scope = scopeSel ? scopeSel.value : "all";
    const basis = basisSel ? basisSel.value : "all";

    const { labels, values } = getModuleCounts({ week, basis, scope });

    if (!labels.length) { hideCardByCanvas("moduleChart"); return; }
    setDynamicHeight(wrap, labels.length);
    if (moduleChart) moduleChart.destroy();
    moduleChart = makeBar(ctx, labels, values, true);
  }
  renderModuleChart();
  if (applyBtn) applyBtn.addEventListener("click", (e) => { e.preventDefault(); renderModuleChart(); });
  if (resetBtn)  resetBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (weekSel) weekSel.value = "";
    if (scopeSel) scopeSel.value = "all";
    if (basisSel) basisSel.value = "all";
    renderModuleChart();
  });

  // ======= Student analysis =======
  if (report.student_enabled) {
    const studentSearch = document.getElementById("studentSearch");
    const topModuleSelect = document.getElementById("topModuleSelect");
    const topNStudent = document.getElementById("topNStudent");
    const renderTopListBtn = document.getElementById("renderTopList");
    const analyzeStudentBtn = document.getElementById("analyzeStudentBtn");
    const topStudentList = document.getElementById("topStudentList");
    const studentSelectedNote = document.getElementById("studentSelectedNote");

    // quick lookup label -> id
    const labelToId = {};
    (report.student_lookup || []).forEach(s => { labelToId[s.label] = s.id; });

    // charts
    let stuModAttChart, stuWeekAttChart, stuWeekRiskChart;

    function renderTopList() {
      const mod = topModuleSelect ? topModuleSelect.value : "";
      const n = parseInt(topNStudent ? topNStudent.value : "10", 10) || 10;
      let list = [];

      if (mod && report.module_top_students_att && report.module_top_students_att[mod]) {
        list = report.module_top_students_att[mod].slice(0, n);
      } else if (report.global_top_students_att) {
        list = report.global_top_students_att.slice(0, n);
      }

      if (!list.length) {
        topStudentList.innerHTML = "<em>No data for the selected module.</em>";
        return;
      }

      // clickable pills
      topStudentList.innerHTML = list.map(x =>
        `<button class="btn btn-outline" data-sid="${x.id}" style="margin:4px 6px 0 0;">${x.label} (${x.count})</button>`
      ).join("");

      topStudentList.querySelectorAll("button[data-sid]").forEach(btn => {
        btn.addEventListener("click", () => {
          studentSearch.value = btn.textContent.replace(/\s\(\d+\)$/, ""); // set label
          analyzeStudent(btn.getAttribute("data-sid"));
        });
      });
    }

    function analyzeStudent(sid) {
      // If no sid, try to map from search box value
      if (!sid) {
        const label = (studentSearch && studentSearch.value) || "";
        sid = labelToId[label] || null;
      }
      if (!sid) {
        studentSelectedNote.textContent = "Pick a student (type to search, or click from the list).";
        return;
      }

      // Update header note
      studentSelectedNote.textContent = `Selected: ${Object.keys(labelToId).find(k => labelToId[k] === sid) || sid}`;

      // 1) Non-attendance by module
      const modMap = (report.ps_modules_att && report.ps_modules_att[sid]) || {};
      const mods = Object.keys(modMap);
      const modVals = mods.map(m => modMap[m]);
      const modWrap = document.getElementById("stuModAttWrap");
      setDynamicHeight(modWrap, mods.length);
      if (stuModAttChart) stuModAttChart.destroy();
      if (mods.length) {
        stuModAttChart = makeBar(document.getElementById("stuModAttChart"), mods, modVals, true);
        showEl("stuModAttCard");
      } else { hideEl("stuModAttCard"); }

      // 2) Non-attendance by week
      const wkMap = (report.ps_weeks_att && report.ps_weeks_att[sid]) || {};
      const weeks = sortedWeeks(Object.keys(wkMap));
      const wkVals = weeks.map(w => wkMap[w]);
      if (stuWeekAttChart) stuWeekAttChart.destroy();
      if (weeks.length) {
        stuWeekAttChart = makeLine(document.getElementById("stuWeekAttChart"), weeks, [{ name: "Non-attendance", data: wkVals }]);
        showEl("stuWeekAttCard");
      } else { hideEl("stuWeekAttCard"); }

      // 3) Risk by week (multi-series)
      const wkRisk = (report.ps_week_risk_counts && report.ps_week_risk_counts[sid]) || {};
      const wks = sortedWeeks(Object.keys(wkRisk));
      const riskNames = Array.from(new Set([].concat(...wks.map(w => Object.keys(wkRisk[w])))));
      const series = riskNames.map(name => ({
        name,
        data: wks.map(w => (wkRisk[w][name] || 0))
      }));
      if (stuWeekRiskChart) stuWeekRiskChart.destroy();
      if (wks.length && riskNames.length) {
        stuWeekRiskChart = makeLine(document.getElementById("stuWeekRiskChart"), wks, series);
        showEl("stuWeekRiskCard");
      } else { hideEl("stuWeekRiskCard"); }

      // 4) Risk by module (max severity) -> small table
      const riskMod = (report.ps_risk_module_max && report.ps_risk_module_max[sid]) || {};
      const tblWrap = document.getElementById("stuRiskModuleTable");
      if (Object.keys(riskMod).length) {
        const rows = Object.entries(riskMod).sort((a,b)=>a[0].localeCompare(b[0]));
        const html = `
          <table>
            <thead><tr><th>Module</th><th>Max risk</th></tr></thead>
            <tbody>
              ${rows.map(([m, r]) => `<tr><td>${m}</td><td>${r}</td></tr>`).join("")}
            </tbody>
          </table>`;
        tblWrap.innerHTML = html;
        showEl("stuRiskModuleCard");
      } else {
        tblWrap.innerHTML = "<p class='muted tiny'>No risk information for this student.</p>";
        showEl("stuRiskModuleCard");
      }
    }

    // initial render
    renderTopList();
    if (renderTopListBtn) renderTopListBtn.addEventListener("click", (e) => { e.preventDefault(); renderTopList(); });
    if (analyzeStudentBtn) analyzeStudentBtn.addEventListener("click", (e) => { e.preventDefault(); analyzeStudent(); });
  }
})();
