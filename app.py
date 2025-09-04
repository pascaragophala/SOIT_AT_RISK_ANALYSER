import os
import re
from io import BytesIO
from typing import Dict, Any, List

import pandas as pd
from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename

# -----------------------------------
# Config
# -----------------------------------
ALLOWED_EXTENSIONS = {"xlsx", "xls"}


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# -----------------------------------
# Helpers
# -----------------------------------
def _sid(x) -> str:
    """Normalize a student number to a string without trailing .0"""
    try:
        if isinstance(x, float) and x.is_integer():
            return str(int(x))
    except Exception:
        pass
    s = str(x).strip()
    return re.sub(r"\.0+$", "", s)


def _qual_group(s: str) -> str:
    """Collapse qualification variants to a small set."""
    if not isinstance(s, str):
        s = "" if pd.isna(s) else str(s)
    s = s.strip().upper()
    if s in {"BBIS", "BBIS-B"}:
        return "BBIS"
    if s in {"BITW", "BITW-B"}:
        return "BITW"
    if s in {"HCS", "HCS-B"}:
        return "HCS"
    return s or "Unknown"


def _sort_weeks_like(vals) -> List[str]:
    """Sort values like Week1, Week2, ...  or plain 1,2,3..."""
    def key_fn(v):
        m = re.search(r"(\d+)", str(v))
        return int(m.group(1)) if m else 0
    return [str(v) for v in sorted(vals, key=key_fn)]


def _counts_to_json_safe(series: pd.Series) -> Dict[str, int]:
    return {str(k): int(v) for k, v in series.items()}


# -----------------------------------
# Report builder
# -----------------------------------
def build_report(df: pd.DataFrame) -> Dict[str, Any]:
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]

    # Likely column names (be forgiving)
    col_student = next((c for c in df.columns if c.lower().startswith("student number")), None)
    col_name    = next((c for c in df.columns if c.lower().startswith("student name")), None)
    col_module  = next((c for c in df.columns if c.lower().startswith("module")), None)
    col_year    = next((c for c in df.columns if c.lower() == "year"), None)
    col_week    = next((c for c in df.columns if c.lower() == "week"), None)
    col_reason  = next((c for c in df.columns if "reason" in c.lower()), None)
    col_risk    = next((c for c in df.columns if "risk" in c.lower()), None)
    col_resolved= next((c for c in df.columns if "resolved" in c.lower()), None)
    col_qual    = next((c for c in df.columns if ("qual" in c.lower() or "program" in c.lower()
                                                  or "programme" in c.lower() or "course" in c.lower())), None)

    # Derived columns
    if col_student:
        df["_sid"] = df[col_student].apply(_sid)
    if col_name:
        df["_name"] = df[col_name].astype(str).str.strip()
    if col_module:
        df["_mod"] = df[col_module].astype(str).str.strip()
    if col_week:
        df["_week"] = df[col_week].astype(str).str.strip()
    if col_risk:
        df["_risk"] = df[col_risk].astype(str).str.strip().str.title()
    if col_resolved:
        df["_res"] = df[col_resolved].astype(str).str.strip().str.title()
    if col_qual:
        df["_qual"] = df[col_qual].apply(_qual_group)
    else:
        df["_qual"] = "Unknown"

    # Non-attendance mask from reason column
    if col_reason:
        txt = df[col_reason].astype(str).str.lower()
        att_mask = txt.str.contains(r"(non[\s-]*attendance|did\s*not\s*attend|no\s*show|absen|miss)", na=False)
    else:
        att_mask = pd.Series(False, index=df.index)

    # ----------------- top-level counts used across UI -----------------
    # Risk counts
    risk_counts = _counts_to_json_safe(df["_risk"].value_counts()) if "_risk" in df else {}
    by_reason   = _counts_to_json_safe(
        df[col_reason].astype(str).str.strip().replace({"": None}).dropna().str.title().value_counts().head(15)
    ) if col_reason else {}

    # Weeks, modules, qualifications lists
    weeks   = _sort_weeks_like(df["_week"].dropna().unique()) if "_week" in df else []
    modules = sorted(df["_mod"].dropna().unique()) if "_mod" in df else []
    quals   = sorted(pd.unique(df["_qual"]).tolist())

    # Modules (unique students overall)
    by_module = {}
    if "_mod" in df and "_sid" in df:
        by_module = df.groupby("_mod")["_sid"].nunique().sort_values(ascending=False).astype(int).to_dict()

    # Modules based on attendance only
    by_module_attendance = {}
    if "_mod" in df and "_sid" in df and att_mask is not None:
        by_module_attendance = df[att_mask].groupby("_mod")["_sid"].nunique().sort_values(ascending=False).astype(int).to_dict()

    # By week -> module (all vs attendance)
    by_week_module_all = {}
    by_week_module_attendance = {}
    if "_week" in df and "_mod" in df:
        by_week_module_all = (df.groupby(["_week","_mod"]).size().unstack(fill_value=0)).to_dict(int)
        if att_mask is not None:
            by_week_module_attendance = (df[att_mask].groupby(["_week","_mod"]).size().unstack(fill_value=0)).to_dict(int)

    # Qualification splits
    by_module_all_by_qual = {}
    by_module_att_by_qual = {}
    by_week_module_all_by_qual = {}
    by_week_module_att_by_qual = {}
    for q, g in df.groupby("_qual"):
        by_module_all_by_qual[q] = g.groupby("_mod")["_sid"].nunique().sort_values(ascending=False).astype(int).to_dict() if "_sid" in g else {}
        if att_mask is not None:
            by_module_att_by_qual[q] = g[att_mask].groupby("_mod")["_sid"].nunique().sort_values(ascending=False).astype(int).to_dict() if "_sid" in g else {}
        if "_week" in g and "_mod" in g:
            by_week_module_all_by_qual[q] = (g.groupby(["_week","_mod"]).size().unstack(fill_value=0)).to_dict(int)
            if att_mask is not None:
                by_week_module_att_by_qual[q] = (g[att_mask].groupby(["_week","_mod"]).size().unstack(fill_value=0)).to_dict(int)

    # Resolved counts and weekly rate
    resolved_counts = _counts_to_json_safe(df["_res"].value_counts()) if "_res" in df else {}
    resolved_rate = {}
    if "_week" in df and "_res" in df:
        grouped = df.groupby("_week")["_res"].value_counts().unstack(fill_value=0)
        for w, row in grouped.iterrows():
            total = int(row.sum())
            yes = int(row.get("Yes", 0)) + int(row.get("True", 0))
            resolved_rate[str(w)] = round(100 * yes / total, 1) if total else 0.0

    # Risk series by week
    week_risk = {"weeks": [], "series": []}
    if "_week" in df and "_risk" in df:
        pv = df.pivot_table(index="_week", columns="_risk", values="_sid", aggfunc="count", fill_value=0)
        order_weeks = _sort_weeks_like(pv.index)
        week_risk["weeks"] = order_weeks
        for col in pv.columns:
            week_risk["series"].append({"name": str(col), "data": [int(pv.loc[w, col]) if w in pv.index else 0 for w in order_weeks]})

    # Non-attendance by week (line)
    by_week_attendance = {}
    if "_week" in df and att_mask is not None:
        by_week_attendance = _counts_to_json_safe(df[att_mask]["_week"].value_counts())

    # ----------------- per-student structures -----------------
    student_enabled = bool("_sid" in df)
    student_lookup: List[Dict[str, Any]] = []
    if student_enabled:
        name_map = df.groupby("_sid")["_name"].agg(lambda s: s.dropna().iloc[0] if len(s.dropna()) else "").to_dict() if "_name" in df else {}
        qual_map = df.groupby("_sid")["_qual"].agg(lambda s: s.dropna().iloc[0] if len(s.dropna()) else "").to_dict()
        for sid in sorted(df["_sid"].dropna().unique()):
            nm = name_map.get(sid, "")
            ql = qual_map.get(sid, "")
            label = f"{sid} — {nm}" if nm else sid
            student_lookup.append({"id": sid, "label": label, "name": nm, "qual": ql})

    # per-student module non-attendance counts
    ps_modules_att = {}
    if "_sid" in df and "_mod" in df and att_mask is not None:
        tmp = df[att_mask].groupby(["_sid","_mod"]).size().unstack(fill_value=0)
        for sid, row in tmp.iterrows():
            d = {str(k): int(v) for k, v in row.items() if int(v) > 0}
            if d:
                ps_modules_att[str(sid)] = d

    # per-student week non-attendance
    ps_weeks_att = {}
    if "_sid" in df and "_week" in df and att_mask is not None:
        tmp = df[att_mask].groupby(["_sid","_week"]).size().unstack(fill_value=0)
        for sid, row in tmp.iterrows():
            d = {str(k): int(v) for k, v in row.items() if int(v) > 0}
            if d:
                ps_weeks_att[str(sid)] = d

    # per-student risk by week (High/Moderate/Low)
    ps_week_risk_counts = {}
    if "_sid" in df and "_week" in df and "_risk" in df:
        for (sid, wk, rk), cnt in df.groupby(["_sid","_week","_risk"]).size().items():
            ps_week_risk_counts.setdefault(str(sid), {}).setdefault(str(wk), {})[str(rk)] = int(cnt)

    # per-student max risk per module table
    ps_risk_module_max = {}
    if "_sid" in df and "_mod" in df and "_risk" in df:
        order = {"High": 3, "Moderate": 2, "Low": 1}
        g = df.groupby(["_sid","_mod","_risk"]).size().reset_index(name="n")
        for (sid, mod), sub in g.groupby(["_sid","_mod"]):
            # highest severity (not just most frequent)
            max_risk = "Low"
            max_score = 0
            for _, row in sub.iterrows():
                score = order.get(str(row["_risk"]), 0)
                if score > max_score:
                    max_score = score
                    max_risk = str(row["_risk"])
            ps_risk_module_max.setdefault(str(sid), {})[str(mod)] = str(max_risk)

    # Top students (global and by module; also by qualification)
    module_top_students_att = {}
    global_top_students_att = []
    if att_mask is not None and "_sid" in df:
        tmp_g = df[att_mask].groupby("_sid").size().reset_index(name="cnt").sort_values("cnt", ascending=False)
        for _, r in tmp_g.iterrows():
            sid = str(r["_sid"]); cnt = int(r["cnt"])
            nm = df.loc[df["_sid"] == sid, "_name"].dropna()
            nm = nm.iloc[0] if len(nm) else ""
            ql = df.loc[df["_sid"] == sid, "_qual"].dropna()
            ql = ql.iloc[0] if len(ql) else ""
            base = f"{sid} — {nm}" if nm else sid
            label = f"{base} — [{ql}]" if ql else base
            global_top_students_att.append({"id": sid, "label": label, "count": cnt})

        if "_mod" in df:
            tmp_m = df[att_mask].groupby(["_mod","_sid"]).size().reset_index(name="cnt")
            for mod, sub in tmp_m.groupby("_mod"):
                arr = []
                for _, r in sub.sort_values("cnt", ascending=False).iterrows():
                    sid = str(r["_sid"]); cnt = int(r["cnt"])
                    nm = df.loc[df["_sid"] == sid, "_name"].dropna()
                    nm = nm.iloc[0] if len(nm) else ""
                    ql = df.loc[df["_sid"] == sid, "_qual"].dropna()
                    ql = ql.iloc[0] if len(ql) else ""
                    base = f"{sid} — {nm}" if nm else sid
                    label = f"{base} — [{ql}]" if ql else base
                    arr.append({"id": sid, "label": label, "count": cnt})
                module_top_students_att[str(mod)] = arr

    global_top_students_att_by_qual = {}
    module_top_students_att_by_qual = {}
    if att_mask is not None and "_qual" in df:
        for q, g in df[att_mask].groupby("_qual"):
            # global per qual
            arr = []
            tmp = g.groupby("_sid").size().reset_index(name="cnt").sort_values("cnt", ascending=False)
            for _, r in tmp.iterrows():
                sid = str(r["_sid"]); cnt = int(r["cnt"])
                nm = df.loc[df["_sid"] == sid, "_name"].dropna()
                nm = nm.iloc[0] if len(nm) else ""
                base = f"{sid} — {nm}" if nm else sid
                arr.append({"id": sid, "label": f"{base} — [{q}]", "count": cnt})
            global_top_students_att_by_qual[str(q)] = arr

            # by module within qual
            if "_mod" in g:
                sub = g.groupby(["_mod","_sid"]).size().reset_index(name="cnt")
                for mod, mm in sub.groupby("_mod"):
                    arr2 = []
                    for _, r in mm.sort_values("cnt", ascending=False).iterrows():
                        sid = str(r["_sid"]); cnt = int(r["cnt"])
                        nm = df.loc[df["_sid"] == sid, "_name"].dropna()
                        nm = nm.iloc[0] if len(nm) else ""
                        base = f"{sid} — {nm}" if nm else sid
                        arr2.append({"id": sid, "label": f"{base} — [{q}]", "count": cnt})
                    module_top_students_att_by_qual.setdefault(str(q), {})[str(mod)] = arr2

    # ---- NEW: Module heatmap (module -> student -> week -> [absences, total_rows])
    module_heatmap: Dict[str, Dict[str, Dict[str, List[int]]]] = {}
    if "_mod" in df and "_sid" in df and "_week" in df:
        totals = df.groupby(["_mod","_sid","_week"]).size()
        if att_mask is not None:
            att = df[att_mask].groupby(["_mod","_sid","_week"]).size()
        else:
            att = pd.Series(dtype=int)
        for (m, s, w), tot in totals.items():
            a = int(att.get((m, s, w), 0))
            module_heatmap.setdefault(str(m), {}).setdefault(str(s), {})[str(w)] = [int(a), int(tot)]

    # Sample rows for debugging
    sample_rows = df.head(50).fillna("").astype(str).to_dict(orient="records")

    return {
        "weeks": weeks,
        "modules": modules,
        "quals": quals,

        "risk_counts": risk_counts,
        "by_reason": by_reason,

        "by_module": by_module,
        "by_module_attendance": by_module_attendance,
        "by_week_module_all": by_week_module_all,
        "by_week_module_attendance": by_week_module_attendance,
        "by_module_all_by_qual": by_module_all_by_qual,
        "by_module_att_by_qual": by_module_att_by_qual,
        "by_week_module_all_by_qual": by_week_module_all_by_qual,
        "by_week_module_att_by_qual": by_week_module_att_by_qual,

        "resolved_counts": resolved_counts,
        "resolved_rate": resolved_rate,
        "by_week_attendance": by_week_attendance,

        "student_enabled": student_enabled,
        "student_lookup": student_lookup,
        "ps_modules_att": ps_modules_att,
        "ps_weeks_att": ps_weeks_att,
        "ps_week_risk_counts": ps_week_risk_counts,
        "ps_risk_module_max": ps_risk_module_max,

        "module_top_students_att": module_top_students_att,
        "global_top_students_att": global_top_students_att,
        "global_top_students_att_by_qual": global_top_students_att_by_qual,
        "module_top_students_att_by_qual": module_top_students_att_by_qual,

        "module_heatmap": module_heatmap,

        "sample_rows": sample_rows,
    }


# -----------------------------------
# Flask app
# -----------------------------------
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
