(function () {
  // ===================== THEME TOGGLE =====================
  const body = document.documentElement;
  const themeKey = "soit_theme";
  const themeBtn = document.getElementById("themeToggle");

  function applyTheme(theme) {
    if (theme === "light") {
      body.setAttribute("data-theme", "light");
      if (themeBtn) themeBtn.textContent = "Dark mode";
    } else {
      body.removeAttribute("data-theme");
      if (themeBtn) themeBtn.textContent = "Light mode";
    }
  }
  applyTheme(localStorage.getItem(themeKey) || "dark");
  themeBtn?.addEventListener("click", () => {
    const next = body.getAttribute("data-theme") === "light" ? "dark" : "light";
    localStorage.setItem(themeKey, next);
    applyTheme(next);
  });

  // Nothing to draw until a file is uploaded
  if (!window.__REPORT__) return;
  const report = window.__REPORT__;

  // ===================== CHART GLOBALS =====================
  Chart.defaults.font.family =
    '"Inter", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;

  // --------------------- helpers
  const hideCardByCanvas = (id) => {
    const c = document.getElementById(id);
    if (c) c.closest(".card").classList.add("hidden");
  };
  const hideEl = (id) => {
    const e = document.getElementById(id);
    if (e) e.classList.add("hidden");
  };
  const showEl = (id) => {
    const e = document.getElementById(id);
    if (e) e.classList.remove("hidden");
  };
  const normalizeId = (x) => String(x ?? "").trim().replace(/\.0+$/, "");
  const sortedWeeks = (keys) => {
    const arr = (keys || []).map(String);
    return arr
      .map((w) => ({ w, n: (w.match(/\d+/) || [0])[0] * 1 }))
      .sort((a, b) => a.n - b.n)
      .map((x) => x.w);
  };
  function setDynamicHeight(container, count, opts = {}) {
    const { perBar = 26, minH = 260, maxH = 560 } = opts;
    const h = Math.min(maxH, Math.max(minH, count * perBar + 80));
    container.style.setProperty("--h", h + "px");
  }

  // --------------------- chart builders
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
          x: {
            ticks: { autoSkip: !horizontal, maxRotation: 0 },
            grid: { display: !horizontal },
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, autoSkip: horizontal ? false : true },
          },
        },
      },
    });
  }
  function makeDoughnut(ctx, labels, data) {
    return new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: { legend: { position: "bottom" } },
      },
    });
  }
  function makeLine(ctx, labels, seriesArr) {
    return new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: seriesArr.map((s) => ({
          label: s.name,
          data: s.data,
          tension: 0.35,
          pointRadius: 2,
          pointHoverRadius: 4,
          fill: false,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  // ===================== STATIC CHARTS =====================
  let moduleChart,
    riskChart,
    reasonChart,
    resolvedChart,
    weekRiskChart,
    nonAttendanceChart,
    resolvedRateChart;

  if (report.risk_counts && Object.keys(report.risk_counts).length) {
    riskChart = makeBar(
      document.getElementById("riskChart"),
      Object.keys(report.risk_counts),
      Object.values(report.risk_counts)
    );
  } else {
    hideCardByCanvas("riskChart");
  }

  if (report.by_reason && Object.keys(report.by_reason).length) {
    reasonChart = makeBar(
      document.getElementById("reasonChart"),
      Object.keys(report.by_reason),
      Object.values(report.by_reason)
    );
  } else {
    hideCardByCanvas("reasonChart");
  }

  if (report.resolved_counts && Object.keys(report.resolved_counts).length) {
    resolvedChart = makeDoughnut(
      document.getElementById("resolvedChart"),
      Object.keys(report.resolved_counts),
      Object.values(report.resolved_counts)
    );
  } else {
    hideCardByCanvas("resolvedChart");
  }

  if (report.week_risk && report.week_risk.weeks?.length) {
    weekRiskChart = makeLine(
      document.getElementById("weekRiskChart"),
      report.week_risk.weeks,
      report.week_risk.series
    );
  } else {
    hideCardByCanvas("weekRiskChart");
  }

  if (report.by_week_attendance && Object.keys(report.by_week_attendance).length) {
    const weeks = sortedWeeks(Object.keys(report.by_week_attendance));
    const vals = weeks.map((w) => report.by_week_attendance[w] || 0);
    nonAttendanceChart = new Chart(document.getElementById("nonAttendanceChart"), {
      type: "line",
      data: {
        labels: weeks,
        datasets: [
          {
            label: "Non-attendance",
            data: vals,
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  } else {
    hideCardByCanvas("nonAttendanceChart");
  }

  if (report.resolved_rate && Object.keys(report.resolved_rate).length) {
    const weeks = sortedWeeks(Object.keys(report.resolved_rate));
    const vals = weeks.map((w) => report.resolved_rate[w]);
    resolvedRateChart = new Chart(document.getElementById("resolvedRateChart"), {
      type: "line",
      data: {
        labels: weeks,
        datasets: [
          {
            label: "Resolved %",
            data: vals,
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: (v) => v + "%" } },
        },
      },
    });
  } else {
    hideCardByCanvas("resolvedRateChart");
  }

  // ===================== MODULES CHART (FILTERS) =====================
  const weekSel = document.getElementById("weekFilter");
  const scopeSel = document.getElementById("moduleScope");
  const basisSel = document.getElementById("moduleBasis");
  const qualSel = document.getElementById("qualFilter");
  const applyBtn = document.getElementById("applyFilters");
  const resetBtn = document.getElementById("resetFilters");

  function getModuleCounts({ week = "", basis = "all", scope = "all", qual = "" }) {
    let dataMap = {};
    const isTop = scope.startsWith("top");
    const topN =
      scope === "top3_att" ? 3 : scope === "top5_att" ? 5 : scope === "top10_att" ? 10 : null;

    if (basis === "attendance") {
      if (qual)
        dataMap = week
          ? report.by_week_module_att_by_qual?.[qual]?.[week] || {}
          : report.by_module_att_by_qual?.[qual] || {};
      else
        dataMap = week
          ? report.by_week_module_attendance?.[week] || {}
          : report.by_module_attendance || {};
    } else {
      if (qual)
        dataMap = week
          ? report.by_week_module_all_by_qual?.[qual]?.[week] || {}
          : report.by_module_all_by_qual?.[qual] || {};
      else dataMap = week ? report.by_week_module_all?.[week] || {} : report.by_module || {};
    }

    let pairs = Object.entries(dataMap).map(([k, v]) => [String(k), Number(v)]);
    pairs.sort((a, b) => b[1] - a[1]);
    if (isTop && topN) pairs = pairs.slice(0, topN);
    return { labels: pairs.map((p) => p[0]), values: pairs.map((p) => p[1]) };
  }

  function renderModuleChart() {
    const wrap = document.getElementById("moduleChartWrap");
    const ctx = document.getElementById("moduleChart");
    if (!wrap || !ctx) return;

    const { labels, values } = getModuleCounts({
      week: weekSel?.value || "",
      basis: basisSel?.value || "all",
      scope: scopeSel?.value || "all",
      qual: qualSel?.value || "",
    });

    if (!labels.length) {
      hideCardByCanvas("moduleChart");
      return;
    }
    setDynamicHeight(wrap, labels.length);
    moduleChart?.destroy();
    moduleChart = makeBar(ctx, labels, values, true);
  }
  renderModuleChart();
  applyBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    renderModuleChart();
  });
  resetBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (weekSel) weekSel.value = "";
    if (scopeSel) scopeSel.value = "all";
    if (basisSel) basisSel.value = "all";
    if (qualSel) qualSel.value = "";
    renderModuleChart();
  });

  // ===================== STUDENT ANALYSIS =====================
  if (report.student_enabled) {
    const studentSearch = document.getElementById("studentSearch");
    const topModuleSelect = document.getElementById("topModuleSelect");
    const topQualSelect = document.getElementById("topQualSelect");
    const topNStudent = document.getElementById("topNStudent");
    const renderTopListBtn = document.getElementById("renderTopList");
    const analyzeStudentBtn = document.getElementById("analyzeStudentBtn");
    const topStudentList = document.getElementById("topStudentList");
    const studentSelectedNote = document.getElementById("studentSelectedNote");

    const labelToId = {};
    const idToLabel = {};
    const idToQual = {};
    const idToName = {};
    (report.student_lookup || []).forEach((s) => {
      labelToId[s.label] = s.id;
      idToLabel[s.id] = s.label;
      idToQual[s.id] = s.qual || "";
      idToName[s.id] = s.name || "";
    });

    let stuModAttChart, stuWeekAttChart, stuWeekRiskChart;

    function renderTopList() {
      const mod = topModuleSelect?.value || "";
      const qual = topQualSelect?.value || "";
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

      if (!list.length) {
        topStudentList.innerHTML = "<em>No data for the selection.</em>";
        return;
      }
      topStudentList.innerHTML = list
        .map(
          (x) =>
            `<button class="btn btn-outline" data-sid="${x.id}" data-label="${x.label}" style="margin:4px 6px 0 0;">${x.label} (${x.count})</button>`
        )
        .join("");

      topStudentList.querySelectorAll("button[data-sid]").forEach((b) => {
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
      if (!sid) {
        studentSelectedNote.textContent = "Pick a student.";
        return;
      }

      const qual = idToQual[sid] || "";
      studentSelectedNote.textContent = `Selected: ${idToLabel[sid] || sid}${
        qual ? " · Qualification: " + qual : ""
      }`;

      // Non-attendance by module
      const modMap = report.ps_modules_att?.[sid] || {};
      const mods = Object.keys(modMap),
        modVals = mods.map((m) => modMap[m]);
      const modWrap = document.getElementById("stuModAttWrap");
      setDynamicHeight(modWrap, mods.length);
      stuModAttChart?.destroy();
      if (mods.length) {
        stuModAttChart = makeBar(
          document.getElementById("stuModAttChart"),
          mods,
          modVals,
          true
        );
        showEl("stuModAttCard");
      } else {
        hideEl("stuModAttCard");
      }

      // Non-attendance by week
      const wkMap = report.ps_weeks_att?.[sid] || {};
      const weeks = sortedWeeks(Object.keys(wkMap));
      const wkVals = weeks.map((w) => wkMap[w]);
      stuWeekAttChart?.destroy();
      if (weeks.length) {
        stuWeekAttChart = makeLine(
          document.getElementById("stuWeekAttChart"),
          weeks,
          [{ name: "Non-attendance", data: wkVals }]
        );
        showEl("stuWeekAttCard");
      } else {
        hideEl("stuWeekAttCard");
      }

      // Risk by week
      const wkRisk = report.ps_week_risk_counts?.[sid] || {};
      const wks = sortedWeeks(Object.keys(wkRisk));
      const riskNames = Array.from(
        new Set([].concat(...wks.map((w) => Object.keys(wkRisk[w]))))
      );
      const series = riskNames.map((name) => ({
        name,
        data: wks.map((w) => wkRisk[w][name] || 0),
      }));
      stuWeekRiskChart?.destroy();
      if (wks.length && riskNames.length) {
        stuWeekRiskChart = makeLine(
          document.getElementById("stuWeekRiskChart"),
          wks,
          series
        );
        showEl("stuWeekRiskCard");
      } else {
        hideEl("stuWeekRiskCard");
      }

      // Risk by module table
      const riskMod = report.ps_risk_module_max?.[sid] || {};
      const tblWrap = document.getElementById("stuRiskModuleTable");
      if (Object.keys(riskMod).length) {
        const rows = Object.entries(riskMod).sort((a, b) =>
          a[0].localeCompare(b[0])
        );
        tblWrap.innerHTML = `<table><thead><tr><th>Module</th><th>Max risk</th></tr></thead>
          <tbody>${rows
            .map(([m, r]) => `<tr><td>${m}</td><td>${r}</td></tr>`)
            .join("")}</tbody></table>`;
        showEl("stuRiskModuleCard");
      } else {
        tblWrap.innerHTML = "<p class='muted tiny'>No risk information for this student.</p>";
        showEl("stuRiskModuleCard");
      }
    }

    renderTopList();
    renderTopListBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      renderTopList();
    });
    analyzeStudentBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      analyzeStudent();
    });
  }

  // ===================== MODULE HEATMAP =====================
  let heatmapChart;

  // id → name / qual maps for table labels and filters
  const idToName = {};
  const idToQual = {};
  (report.student_lookup || []).forEach((s) => {
    idToName[s.id] = s.name || "";
    idToQual[s.id] = s.qual || "";
  });

  function colorForRate(r) {
    if (r == null || isNaN(r)) return "rgba(0,0,0,0)";
    // 0 -> green (120), 1 -> red (0)
    const h = Math.round((1 - Math.max(0, Math.min(1, r))) * 120);
    return `hsl(${h} 70% 45%)`;
  }

  function buildModuleWeeks(mod, qual) {
    const byMod = report.module_heatmap?.[mod] || {};
    const sids = Object.keys(byMod).filter(
      (sid) => !qual || (idToQual[sid] || "") === qual
    );
    const set = new Set();
    sids.forEach((sid) => Object.keys(byMod[sid] || {}).forEach((w) => set.add(String(w))));
    let weeks = Array.from(set);
    if (!weeks.length) weeks = report.weeks || [];
    return sortedWeeks(weeks);
  }

  // Build rows like Excel: binary per week, plus totals/rate
  function buildHeatRows(mod, qual, sortKey = "total_desc") {
    const byMod = report.module_heatmap?.[mod] || {};
    const weeks = buildModuleWeeks(mod, qual);
    const rows = [];

    Object.keys(byMod).forEach((sid) => {
      if (qual && (idToQual[sid] || "") !== qual) return;
      const wkMap = byMod[sid] || {};
      const weekVals = {};
      let total = 0;

      weeks.forEach((w) => {
        const entry = wkMap[w];
        // absent if there’s >=1 absence flag in that week for this module+student
        const bin = entry ? ((entry[0] || 0) > 0 ? 1 : 0) : 0;
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
        ratePct: Math.round(rate * 100),
      });
    });

    if (sortKey === "total_desc") {
      rows.sort((a, b) => b.total - a.total || a.sid.localeCompare(b.sid));
    } else if (sortKey === "name_asc") {
      rows.sort(
        (a, b) => (a.name || "").localeCompare(b.name || "") || a.sid.localeCompare(b.sid)
      );
    } else if (sortKey === "id_asc") {
      rows.sort((a, b) => a.sid.localeCompare(b.sid));
    }

    return { weeks, rows };
  }

  function renderHeatLegend(mode) {
    const legend = document.getElementById("heatLegend");
    if (!legend) return;
    legend.innerHTML =
      mode === "binary"
        ? `<span class="tiny muted">Legend:</span><div class="legend__bar legend__bar--binary"></div><span class="tiny muted">0</span><span class="tiny muted">→</span><span class="tiny muted">1</span>`
        : `<span class="tiny muted">Legend:</span><div class="legend__bar"></div><span class="tiny muted">0%</span><span class="tiny muted">→</span><span class="tiny muted">100%</span>`;
  }

  function renderHeatmap() {
    const modSel = document.getElementById("heatModule");
    const qualSel = document.getElementById("heatQual");
    const modeSel = document.getElementById("heatMode");
    const sortSel = document.getElementById("heatSort");
    const topNSel = document.getElementById("heatTopN");
    const wrap = document.getElementById("heatmapWrap");
    const ctx = document.getElementById("moduleHeatmap");

    const mod = modSel?.value || "";
    const qual = qualSel?.value || "";
    const mode = modeSel?.value || "binary";
    const sortKey = sortSel?.value || "total_desc";
    const topN = parseInt(topNSel?.value || "20", 10) || 20;

    const { weeks, rows } = buildHeatRows(mod, qual, sortKey);
    const chosen = rows.slice(0, topN);

    // y labels
    const yLabels = chosen.map((r) => `${r.sid} — ${r.name}`.trim());
    const rowsCount = yLabels.length;
    const colsCount = weeks.length;

    // data points for matrix
    const points = [];
    chosen.forEach((r, y) => {
      weeks.forEach((w, x) => {
        const bin = r.weekVals[w] || 0;
        const v = mode === "binary" ? bin : r.ratePct / 100; // rate uses student’s overall rate
        const color =
          mode === "binary"
            ? bin
              ? "#e74c3c" // absent
              : "rgba(255,255,255,0.08)" // present → faint cell so grid is visible
            : colorForRate(v);
        points.push({ x, y, v, bin, sid: r.sid, week: w, color });
      });
    });

    // dynamic height
    const cellH = 24;
    const height = Math.max(260, Math.min(800, rowsCount * cellH + 80));
    wrap.style.setProperty("--h", height + "px");

    // cell width based on columns
    const cellW = Math.max(18, Math.min(42, Math.floor(680 / Math.max(1, colsCount))));

    renderHeatLegend(mode);

    heatmapChart?.destroy();
    heatmapChart = new Chart(ctx, {
      type: "matrix",
      data: {
        datasets: [
          {
            label: mode === "binary" ? "Absent (1=absent)" : "Absence rate",
            data: points,
            backgroundColor: (c) => c.raw?.color || "rgba(0,0,0,0)",
            borderColor: "rgba(0,0,0,0.12)",
            borderWidth: 1,
            width: cellW,
            height: cellH,
          },
        ],
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
                if (mode === "binary") {
                  return `${yLabels[d.y]} — W${weeks[d.x]}: ${
                    d.bin === 1 ? "Absent (1)" : "Present (0)"
                  }`;
                } else {
                  const pct = Math.round(d.v * 100);
                  return `${yLabels[d.y]} — W${weeks[d.x]}: ${pct}% overall absence rate`;
                }
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            position: "top",
            min: -0.5,
            max: colsCount - 0.5,
            ticks: { stepSize: 1, callback: (v) => weeks[v] ?? "" },
            grid: { display: false },
          },
          y: {
            type: "linear",
            min: -0.5,
            max: rowsCount - 0.5,
            ticks: { stepSize: 1, callback: (v) => yLabels[v] ?? "" },
            grid: { display: false },
          },
        },
      },
    });

    renderHeatTable(mod, weeks, chosen);
    wireCsv(mod, weeks, chosen);
  }

  function renderHeatTable(mod, weeks, rows) {
    const host = document.getElementById("heatTableWrap");
    if (!host) return;
    if (!weeks.length || !rows.length) {
      host.innerHTML = "<p class='muted tiny'>No data for this selection.</p>";
      return;
    }

    const headerWeeks = weeks
      .map((w) => `<th style="text-align:center;">${w}</th>`)
      .join("");
    const bodyRows = rows
      .map((r) => {
        const tds = weeks
          .map((w) => {
            const bin = r.weekVals[w] || 0;
            return `<td class="heat-cell ${bin ? "heat-absent" : ""}">${bin || ""}</td>`;
          })
          .join("");

        const rateColor = colorForRate(r.ratePct / 100);
        return `<tr>
          <td>${r.sid}</td>
          <td>${r.name || ""}</td>
          <td>${mod}</td>
          ${tds}
          <td style="text-align:center;font-weight:700;">${r.total}</td>
          <td><span class="rate-chip" style="background:${rateColor};color:white;">${r.ratePct}%</span></td>
        </tr>`;
      })
      .join("");

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
      const header = [
        "Student Number",
        "Student Name",
        "Module(s)",
        ...weeks,
        "Total Absences",
        "Absence Rate (%)",
      ];
      const lines = [header.join(",")];
      rows.forEach((r) => {
        const vals = weeks.map((w) => r.weekVals[w] || 0);
        lines.push(
          [
            r.sid,
            `"${(r.name || "").replace(/"/g, '""')}"`,
            mod,
            ...vals,
            r.total,
            r.ratePct,
          ].join(",")
        );
      });
      const blob = new Blob([lines.join("\n")], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `heatmap_${mod}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };
  }

  // Hook up heatmap button and draw once
  document.getElementById("drawHeatmap")?.addEventListener("click", (e) => {
    e.preventDefault();
    renderHeatmap();
  });
  renderHeatmap();
})();
