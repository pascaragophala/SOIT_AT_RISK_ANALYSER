(function () {
  // Theme toggle
  const body = document.documentElement;
  const key = "soit_theme";
  const btn = document.getElementById("themeToggle");

  function apply(theme) {
    if (theme === "light") {
      body.setAttribute("data-theme", "light");
      if (btn) btn.textContent = "Dark mode";
    } else {
      body.removeAttribute("data-theme");
      if (btn) btn.textContent = "Light mode";
    }
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

  // Refs
  const weekSel  = document.getElementById("weekFilter");
  const scopeSel = document.getElementById("moduleScope");
  const basisSel = document.getElementById("moduleBasis");
  const applyBtn = document.getElementById("applyFilters");
  const resetBtn = document.getElementById("resetFilters");

  // Charts
  let moduleChart, riskChart, reasonChart, resolvedChart, weekRiskChart, nonAttendanceChart, resolvedRateChart;

  // Helpers
  const hideCard = (canvasId) => {
    const c = document.getElementById(canvasId);
    if (c) c.closest(".card").classList.add("hidden");
  };

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

  // Static charts (hide cards if no data)
  if (report.risk_counts && Object.keys(report.risk_counts).length) {
    riskChart = makeBar(document.getElementById("riskChart"),
      Object.keys(report.risk_counts), Object.values(report.risk_counts));
  } else { hideCard("riskChart"); }

  if (report.by_reason && Object.keys(report.by_reason).length) {
    reasonChart = makeBar(document.getElementById("reasonChart"),
      Object.keys(report.by_reason), Object.values(report.by_reason));
  } else { hideCard("reasonChart"); }

  if (report.resolved_counts && Object.keys(report.resolved_counts).length) {
    resolvedChart = makeDoughnut(document.getElementById("resolvedChart"),
      Object.keys(report.resolved_counts), Object.values(report.resolved_counts));
  } else { hideCard("resolvedChart"); }

  if (report.week_risk && report.week_risk.weeks && report.week_risk.series && report.week_risk.weeks.length) {
    weekRiskChart = makeLine(document.getElementById("weekRiskChart"),
      report.week_risk.weeks, report.week_risk.series);
  } else { hideCard("weekRiskChart"); }

  if (report.by_week_attendance && Object.keys(report.by_week_attendance).length) {
    const weeks = Object.keys(report.by_week_attendance);
    const vals = weeks.map(w => report.by_week_attendance[w] || 0);
    nonAttendanceChart = new Chart(document.getElementById("nonAttendanceChart"), {
      type: "line",
      data: { labels: weeks, datasets: [{ label: "Non-attendance", data: vals, tension: 0.35, pointRadius: 2, pointHoverRadius: 4, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  } else { hideCard("nonAttendanceChart"); }

  if (report.resolved_rate && Object.keys(report.resolved_rate).length) {
    const weeks = Object.keys(report.resolved_rate);
    const vals = weeks.map(w => report.resolved_rate[w]);
    resolvedRateChart = new Chart(document.getElementById("resolvedRateChart"), {
      type: "line",
      data: { labels: weeks, datasets: [{ label: "Resolved %", data: vals, tension: 0.35, pointRadius: 2, pointHoverRadius: 4, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: v => v + "%" } } } }
    });
  } else { hideCard("resolvedRateChart"); }

  // ---------- Module chart with filters ----------
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

  function setDynamicHeight(container, count) {
    const perBar = 26;           // px per bar
    const minH = 260;
    const maxH = 560;            // clamp to avoid full-screen blocks
    const h = Math.min(maxH, Math.max(minH, count * perBar + 80));
    container.style.setProperty("--h", h + "px");
  }

  function renderModuleChart() {
    const wrap = document.getElementById("moduleChartWrap");
    const ctx  = document.getElementById("moduleChart");
    if (!wrap || !ctx) return;

    const week  = weekSel ? weekSel.value : "";
    const scope = scopeSel ? scopeSel.value : "all";
    const basis = basisSel ? basisSel.value : "all";

    const { labels, values } = getModuleCounts({ week, basis, scope });

    // If no data, hide the card
    if (!labels.length) { hideCard("moduleChart"); return; }

    // Horizontal bars; never skip y labels; clamp height
    setDynamicHeight(wrap, labels.length);
    if (moduleChart) moduleChart.destroy();
    moduleChart = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Count", data: values }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false }, tooltip: { intersect: false } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { ticks: { autoSkip: false } }
        }
      }
    });
  }

  // Initial render + filter actions
  renderModuleChart();
  if (applyBtn) applyBtn.addEventListener("click", (e) => { e.preventDefault(); renderModuleChart(); });
  if (resetBtn)  resetBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (weekSel) weekSel.value = "";
    if (scopeSel) scopeSel.value = "all";
    if (basisSel) basisSel.value = "all";
    renderModuleChart();
  });
})();
