/* Module heatmap (absence per student per week)
   Safe to drop in without changing other parts of the app. */
(function () {
  if (!window.__REPORT__) return;

  // Bail out if the heatmap elements are not on the page
  const needIds = [
    "heatModule","heatQual","heatMode","heatSort","heatTopN",
    "heatLegend","heatmapWrap","moduleHeatmap","heatTableWrap",
    "downloadHeatCsv","drawHeatmap"
  ];
  if (!needIds.every(id => document.getElementById(id))) return;

  const report = window.__REPORT__;

  // Local helpers (no dependency on your existing app.js)
  const sortedWeeks = (keys) => {
    const arr = (keys || []).map(String);
    return arr
      .map(w => ({ w, n: (w.match(/\d+/) || [0])[0] * 1 }))
      .sort((a,b)=>a.n-b.n)
      .map(x=>x.w);
  };
  function colorForRate(r) {
    if (r == null || isNaN(r)) return "rgba(0,0,0,0)";
    // 0 -> green (120), 1 -> red (0)
    const h = Math.round((1 - Math.max(0, Math.min(1, r))) * 120);
    return `hsl(${h} 70% 45%)`;
  }

  // id -> name/qual maps for labels and filtering
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

  // Build Excel-like rows with binary values, totals, and % rate
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
        const entry = wkMap[w];           // [att_count, total_rows]
        const bin = entry ? ((entry[0] || 0) > 0 ? 1 : 0) : 0; // absent if ≥1 flagged absence
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

  function renderHeatLegend(mode) {
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

  function renderHeatTable(mod, weeks, rows) {
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
        <td>${r.sid}</td>
        <td>${r.name || ""}</td>
        <td>${mod}</td>
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

  function renderHeatmap() {
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

    if (!report.module_heatmap || !report.module_heatmap[mod]) {
      // Clear both views
      wrap.style.height = "260px";
      if (window.heatmapChart) { window.heatmapChart.destroy(); window.heatmapChart = null; }
      document.getElementById("heatTableWrap").innerHTML =
        "<p style='opacity:.7;font-size:12px;'>No data for this module.</p>";
      return;
    }

    const { weeks, rows } = buildHeatRows(mod, qual, sortBy);
    const chosen = rows.slice(0, topN);

    // y-axis labels and data points
    const yLabels = chosen.map(r => `${r.sid} — ${r.name}`.trim());
    const rowsCount = yLabels.length;
    const colsCount = weeks.length;

    const points = [];
    chosen.forEach((r, y) => {
      weeks.forEach((w, x) => {
        const bin = r.weekVals[w] || 0;
        const v = (mode === "binary") ? bin : (r.ratePct / 100); // rate = student's overall
        const color = (mode === "binary")
          ? (bin ? "#e74c3c" : "rgba(255,255,255,0.08)") // show faint 0 so the grid is visible
          : colorForRate(v);
        points.push({ x, y, v, bin, color });
      });
    });

    // Dynamic height so long lists fit
    const cellH = 24;
    const height = Math.max(260, Math.min(800, rowsCount * cellH + 80));
    wrap.style.height = height + "px";

    // Cell width based on columns
    const cellW = Math.max(18, Math.min(42, Math.floor(680 / Math.max(1, colsCount))));

    renderHeatLegend(mode);

    // Draw matrix (requires chartjs-chart-matrix plugin, which you already include)
    if (window.heatmapChart) { window.heatmapChart.destroy(); window.heatmapChart = null; }
    window.heatmapChart = new Chart(ctx, {
      type: "matrix",
      data: { datasets: [{
        label: (mode === "binary") ? "Absent (1=absent)" : "Absence rate",
        data: points,
        backgroundColor: (c) => c.raw?.color || "rgba(0,0,0,0)",
        borderColor: "rgba(0,0,0,0.12)",
        borderWidth: 1,
        width: cellW,
        height: cellH
      }]},
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

    // Table + CSV for the same selection
    renderHeatTable(mod, weeks, chosen);
    wireCsv(mod, weeks, chosen);
  }

  document.getElementById("drawHeatmap").addEventListener("click", (e) => {
    e.preventDefault();
    renderHeatmap();
  });

  // First render on load
  renderHeatmap();
})();
