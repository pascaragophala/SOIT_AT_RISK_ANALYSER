import os
import re
from io import BytesIO
from flask import Flask, render_template, request, jsonify
import pandas as pd
from werkzeug.utils import secure_filename

ALLOWED_EXTENSIONS = {"xlsx", "xls"}

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

# ---------- JSON safety ----------
def _counts_to_json_safe(series: pd.Series) -> dict:
    safe = {}
    for k, v in series.items():
        key = "Unknown" if (pd.isna(k) or k is None) else str(k)
        safe[key] = int(v)
    return safe

def _list_int(values) -> list:
    return [int(x) for x in list(values)]

def _sort_weeks_like(weeks: pd.Series) -> list:
    try:
        nums = weeks.astype(str).str.extract(r"(\d+)", expand=False).fillna("0").astype(int)
        return [w for _, w in sorted(zip(nums, weeks.astype(str)))]
    except Exception:
        return list(weeks.astype(str))

def _sid(x) -> str:
    """Normalize student ID to a clean string (strip trailing .0 etc)."""
    try:
        if pd.isna(x):
            return ""
    except Exception:
        pass
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        return str(int(x)) if x.is_integer() else str(x)
    s = str(x).strip()
    s = re.sub(r"\.0+$", "", s)  # "25302469.0" -> "25302469"
    return s

def build_report(df: pd.DataFrame):
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]

    # Likely columns from your sheet
    col_student = next((c for c in df.columns if c.lower().startswith("student number")), None)
    col_name    = next((c for c in df.columns if c.lower().startswith("student name")), None)
    col_module  = next((c for c in df.columns if c.lower().startswith("module")), None)
    col_year    = next((c for c in df.columns if c.lower() == "year"), None)
    col_week    = next((c for c in df.columns if c.lower() == "week"), None)
    col_reason  = next((c for c in df.columns if "reason" in c.lower()), None)
    col_risk    = next((c for c in df.columns if "risk" in c.lower()), None)
    col_resolved= next((c for c in df.columns if "resolved" in c.lower()), None)

    # Normalize dtypes for JSON
    if col_week and df[col_week].notna().any():
        df[col_week] = df[col_week].astype(str)
    if col_year and df[col_year].notna().any():
        df[col_year] = df[col_year].astype(str)

    total_records = int(len(df))
    unique_students = int(df[col_student].nunique()) if col_student else None

    # Global counts
    risk_counts     = _counts_to_json_safe(df[col_risk].value_counts(dropna=False)) if col_risk else {}
    resolved_counts = _counts_to_json_safe(df[col_resolved].value_counts(dropna=False)) if col_resolved else {}
    by_reason       = _counts_to_json_safe(df[col_reason].value_counts().head(15)) if col_reason else {}

    # Weeks and modules
    weeks   = _sort_weeks_like(df[col_week].dropna().unique()) if col_week else []
    modules = sorted(df[col_module].dropna().astype(str).unique()) if col_module else []

    # Unique students by module (overall)
    by_module = {}
    if col_module and col_student:
        tmp = (
            df.groupby(col_module)[col_student]
            .nunique()
            .sort_values(ascending=False)
        )
        by_module = {str(k): int(v) for k, v in tmp.items()}

    # Non-attendance detector (tolerant)
    att_mask = None
    if col_reason:
        att_regex = r"(absent|attendance|attend|no\s*show|did\s*not\s*attend|not\s*attend|missed\s*class|no\s*class\s*attendance)"
        att_mask = df[col_reason].astype(str).str.contains(att_regex, flags=re.IGNORECASE, regex=True, na=False)

    # Non-attendance counts
    by_module_att = {}
    by_week_att = {}
    by_week_module_all = {}
    by_week_module_att = {}

    def _count(series_groupby):
        return series_groupby.nunique() if col_student else series_groupby.size()

    if col_module and col_student and att_mask is not None:
        tmp_att = _count(df[att_mask].groupby(col_module)[col_student]).sort_values(ascending=False)
        by_module_att = {str(k): int(v) for k, v in tmp_att.items()}

    if col_week and att_mask is not None:
        base = df[att_mask]
        key = col_student if col_student else df.columns[0]
        tmp_week_att = base.groupby(col_week)[key].nunique() if col_student else base.groupby(col_week).size()
        by_week_att = {str(k): int(v) for k, v in tmp_week_att.items()}

    if col_week and col_module:
        # All reasons, by week x module
        g_all = df.groupby([col_week, col_module])
        s_all = _count(g_all[col_student] if col_student else g_all.size())
        nested_all = {}
        for (w, m), v in s_all.items():
            nested_all.setdefault(str(w), {})[str(m)] = int(v)
        by_week_module_all = nested_all

        if att_mask is not None:
            g_att = df[att_mask].groupby([col_week, col_module])
            s_att = _count(g_att[col_student] if col_student else g_att.size())
            nested_att = {}
            for (w, m), v in s_att.items():
                nested_att.setdefault(str(w), {})[str(m)] = int(v)
            by_week_module_att = nested_att

    # Week x Risk pivot (for the line chart)
    week_risk = {}
    if col_week and col_risk:
        pivot = df.pivot_table(
            index=col_week,
            columns=col_risk,
            values=col_student if col_student else df.columns[0],
            aggfunc="count",
            fill_value=0,
        )
        pivot = pivot.reindex(_sort_weeks_like(pivot.index.to_series()))
        week_risk = {
            "weeks": [str(x) for x in list(pivot.index)],
            "series": [{"name": str(c), "data": _list_int(pivot[c].values)} for c in pivot.columns],
        }

    # Resolved rate by week (percentage)
    resolved_rate = {}
    if col_week and col_resolved:
        vals = df[col_resolved].astype(str).str.strip().str.lower()
        truthy = vals.isin({"yes", "y", "true", "1", "resolved"})
        grp = df.groupby(col_week)
        totals = grp.size()
        trues = grp.apply(lambda g: int(truthy.loc[g.index].sum()))
        for w in totals.index:
            resolved_rate[str(w)] = round((int(trues.loc[w]) / int(totals.loc[w])) * 100, 1) if int(totals.loc[w]) else 0.0

    # ---------- Student analytics (names + clean IDs) ----------
    student_enabled = bool(col_student)
    student_lookup = []
    ps_modules_att = {}
    ps_weeks_att = {}
    ps_risk_module_max = {}
    ps_week_risk_counts = {}
    module_top_students_att = {}
    global_top_students_att = []

    if student_enabled:
        # Build a stable "id -> full name" map using clean string IDs
        name_map = {}
        if col_name:
            tmp = df[[col_student, col_name]].dropna(subset=[col_student]).copy()
            tmp["_sid"] = tmp[col_student].apply(_sid)
            # pick the most frequent non-empty name for each ID
            nm_series = tmp.groupby("_sid")[col_name].agg(
                lambda s: s.dropna().astype(str).mode().iat[0] if not s.dropna().empty else ""
            ).astype(str)
            name_map = nm_series.to_dict()

        # All known student IDs (clean)
        students_order = pd.unique(df[col_student].dropna().apply(_sid)).tolist()
        for sid in students_order:
            nm = (name_map.get(sid, "") or "").strip()
            label = f"{sid} — {nm}" if nm else sid
            student_lookup.append({"id": sid, "label": label, "name": nm})

        # Per-student non-attendance by module/week
        if att_mask is not None and col_module:
            grp = df[att_mask].groupby([col_student, col_module]).size()
            for (sid_raw, mod), v in grp.items():
                sid = _sid(sid_raw); mod = str(mod)
                ps_modules_att.setdefault(sid, {})[mod] = int(v)

        if att_mask is not None and col_week:
            grp = df[att_mask].groupby([col_student, col_week]).size()
            for (sid_raw, wk), v in grp.items():
                sid = _sid(sid_raw); wk = str(wk)
                ps_weeks_att.setdefault(sid, {})[wk] = int(v)

        # Risk by module (max severity seen per module for each student)
        if col_risk and col_module:
            # map each row to a rank
            rank_map = {}
            labels = []
            for rv in df[col_risk].tolist():
                r, lbl = (3, "High") if (isinstance(rv, str) and "high" in rv.lower()) else \
                         ((2, "Medium") if (isinstance(rv, str) and ("med" in rv.lower() or "amber" in rv.lower() or "yellow" in rv.lower())) else \
                         ((1, "Low") if (isinstance(rv, str) and "low" in rv.lower()) else (0, "Unknown")))
                labels.append(lbl)
            df["_risk_rank"] = [3 if l=="High" else 2 if l=="Medium" else 1 if l=="Low" else 0 for l in labels]

            grp = df.groupby([col_student, col_module])["_risk_rank"].max()
            for (sid_raw, mod), rank in grp.items():
                sid = _sid(sid_raw); mod = str(mod)
                label = {3: "High", 2: "Medium", 1: "Low", 0: "Unknown"}.get(int(rank), "Unknown")
                ps_risk_module_max.setdefault(sid, {})[mod] = label

        # Week x risk counts per student
        if col_week and col_risk:
            grp = df.groupby([col_student, col_week, col_risk]).size()
            for (sid_raw, wk, rk), v in grp.items():
                sid = _sid(sid_raw); wk = str(wk); rk = str(rk)
                ps_week_risk_counts.setdefault(sid, {}).setdefault(wk, {})[rk] = int(v)

        # Top students who miss class per module + global (labels include names)
        if att_mask is not None:
            if col_module:
                grp = df[att_mask].groupby([col_module, col_student]).size()
                for (mod, sid_raw), v in grp.items():
                    sid = _sid(sid_raw); mod = str(mod)
                    nm = (name_map.get(sid, "") or "").strip()
                    label = f"{sid} — {nm}" if nm else sid
                    module_top_students_att.setdefault(mod, []).append({"id": sid, "label": label, "count": int(v)})
                for mod in list(module_top_students_att.keys()):
                    module_top_students_att[mod].sort(key=lambda x: x["count"], reverse=True)
                    module_top_students_att[mod] = module_top_students_att[mod][:100]

            grp_global = df[att_mask].groupby(col_student).size().sort_values(ascending=False)
            for sid_raw, v in grp_global.items():
                sid = _sid(sid_raw)
                nm = (name_map.get(sid, "") or "").strip()
                label = f"{sid} — {nm}" if nm else sid
                global_top_students_att.append({"id": sid, "label": label, "count": int(v)})
            global_top_students_att = global_top_students_att[:200]

    # Repeats
    repeated_students = {}
    if col_student:
        counts = df.groupby(col_student).size().sort_values(ascending=False)
        repeated = counts[counts > 1].head(50)
        if not repeated.empty:
            preview_cols = [c for c in [col_student, col_name, col_module, col_week, col_risk] if c in df.columns]
            preview = df[df[col_student].isin(repeated.index)][preview_cols].copy().head(200)
            repeated_students = {
                "top_counts": {str(k): int(v) for k, v in repeated.items()},
                "preview_rows": preview.fillna("").astype(str).to_dict(orient="records"),
            }

    sample_rows = df.head(50).fillna("").astype(str).to_dict(orient="records")

    return {
        "total_records": total_records,
        "unique_students": unique_students,
        "risk_counts": risk_counts,
        "resolved_counts": resolved_counts,
        "by_reason": by_reason,
        "by_module": by_module,
        "by_module_attendance": by_module_att,
        "by_week_attendance": by_week_att,
        "by_week_module_all": by_week_module_all,
        "by_week_module_attendance": by_week_module_att,
        "weeks": weeks,
        "modules": modules,
        "week_risk": week_risk,
        "resolved_rate": resolved_rate,
        "repeated_students": repeated_students,
        "sample_rows": sample_rows,
        # student analytics payload
        "student_enabled": student_enabled,
        "student_lookup": student_lookup,
        "ps_modules_att": ps_modules_att,
        "ps_weeks_att": ps_weeks_att,
        "ps_risk_module_max": ps_risk_module_max,
        "ps_week_risk_counts": ps_week_risk_counts,
        "module_top_students_att": module_top_students_att,
        "global_top_students_att": global_top_students_att,
    }

def create_app():
    app = Flask(__name__)

    @app.route("/", methods=["GET"])
    def index():
        return render_template("index.html", report=None, error=None, filename=None)

    @app.route("/upload", methods=["POST"])
    def upload():
        if "file" not in request.files:
            return render_template("index.html", report=None, error="No file part.", filename=None)
        file = request.files["file"]
        if file.filename == "":
            return render_template("index.html", report=None, error="No file selected.", filename=None)
        if not allowed_file(file.filename):
            return render_template("index.html", report=None, error="Please upload an Excel file (.xlsx or .xls).", filename=None)

        filename = secure_filename(file.filename)
        try:
            data = BytesIO(file.read())
            try:
                df = pd.read_excel(data)
            except Exception:
                data.seek(0)
                xl = pd.ExcelFile(data)
                df = pd.read_excel(xl, sheet_name=xl.sheet_names[0])

            report = build_report(df)
            return render_template("index.html", report=report, error=None, filename=filename)
        except Exception as e:
            return render_template("index.html", report=None, error=f"Failed to analyze file: {e}", filename=None)

    @app.route("/api/ping")
    def ping():
        return jsonify({"ok": True})

    return app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)
