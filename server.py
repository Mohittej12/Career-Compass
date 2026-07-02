"""
server.py — Career Compass (custom web app)
---------------------------------------------------
A Flask backend serving a bespoke animated front-end. It tracks job
applications and stores the exact resume PDF used for each company, so when a
recruiter calls you can instantly download the right version.

Architecture:
    - Flask serves the single-page UI (templates/index.html) + static assets.
    - A small JSON REST API powers the page (list/add/update/delete/export).
    - Data is local: SQLite database + resume PDFs on disk. Nothing leaves
      your machine.

Run:  python server.py   →  open http://localhost:5000
"""

import csv
import io
import os
import sqlite3
import uuid
from datetime import date, datetime
from pathlib import Path

from flask import (
    Flask, request, jsonify, render_template, send_file, Response, abort
)

# --- Configuration -----------------------------------------------------------
DATA_DIR = Path("data")
RESUME_DIR = DATA_DIR / "resumes"          # uploaded resume files live here
DB_PATH = DATA_DIR / "tracker.db"          # SQLite database file

# The lifecycle stages an application can move through.
STATUSES = ["Applied", "Online Assessment", "Interview", "Offer", "Accepted", "Rejected"]

# Once here, follow-up reminders no longer matter — the process is over.
TERMINAL_STATUSES = {"Accepted", "Rejected"}

app = Flask(__name__)


# --- Database layer ----------------------------------------------------------
def get_connection() -> sqlite3.Connection:
    """Open a SQLite connection with row access by column name."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_storage() -> None:
    """Create the data folders and table if they don't exist yet."""
    DATA_DIR.mkdir(exist_ok=True)
    RESUME_DIR.mkdir(exist_ok=True)

    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS applications (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                company         TEXT NOT NULL,
                role            TEXT,
                date_applied    TEXT,
                status          TEXT,
                location        TEXT,
                job_link        TEXT,
                notes           TEXT,
                resume_filename TEXT,
                resume_path     TEXT,
                follow_up_date  TEXT,
                created_at      TEXT
            )
            """
        )
        conn.commit()
        # Upgrade older databases in place by adding any missing columns.
        existing = {row[1] for row in conn.execute("PRAGMA table_info(applications)")}
        if "follow_up_date" not in existing:
            conn.execute("ALTER TABLE applications ADD COLUMN follow_up_date TEXT")
            conn.commit()


def save_resume_file(uploaded_file) -> tuple[str, str]:
    """
    Save an uploaded resume under a unique name so two companies can never
    overwrite each other's file. Returns (original_name, saved_path).
    """
    unique_prefix = uuid.uuid4().hex[:8]
    safe_name = f"{unique_prefix}_{uploaded_file.filename}"
    dest = RESUME_DIR / safe_name
    uploaded_file.save(dest)
    return uploaded_file.filename, str(dest)


def row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a DB row to a JSON-friendly dict, adding a computed 'due' flag."""
    d = dict(row)
    # An application is "due" if its follow-up date has arrived and it's still active.
    follow_up = d.get("follow_up_date")
    d["is_due"] = bool(
        follow_up
        and follow_up <= date.today().isoformat()
        and d.get("status") not in TERMINAL_STATUSES
    )
    # Never leak the on-disk path to the browser; expose a download URL instead.
    d.pop("resume_path", None)
    d["resume_url"] = f"/api/applications/{d['id']}/resume" if d.get("resume_filename") else None
    return d


# --- Page route --------------------------------------------------------------
@app.route("/")
def index():
    """Serve the single-page app."""
    return render_template("index.html", statuses=STATUSES)


# --- API routes --------------------------------------------------------------
@app.get("/api/applications")
def list_applications():
    """Return all applications, newest first."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM applications ORDER BY date_applied DESC, id DESC"
        ).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.post("/api/applications")
def create_application():
    """Create an application from multipart form data (+ resume PDF)."""
    form = request.form
    company = (form.get("company") or "").strip()
    if not company:
        return jsonify({"error": "Company is required."}), 400

    resume = request.files.get("resume")
    if not resume or not resume.filename:
        return jsonify({"error": "Please attach the resume you used."}), 400

    resume_filename, resume_path = save_resume_file(resume)

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO applications
                (company, role, date_applied, status, location, job_link,
                 notes, resume_filename, resume_path, follow_up_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                company,
                (form.get("role") or "").strip(),
                form.get("date_applied") or date.today().isoformat(),
                form.get("status") or "Applied",
                (form.get("location") or "").strip(),
                (form.get("job_link") or "").strip(),
                (form.get("notes") or "").strip(),
                resume_filename,
                resume_path,
                form.get("follow_up_date") or None,
                datetime.now().isoformat(timespec="seconds"),
            ),
        )
        conn.commit()
    return jsonify({"ok": True}), 201


@app.patch("/api/applications/<int:app_id>")
def update_application(app_id: int):
    """Update an application's status."""
    data = request.get_json(silent=True) or {}
    new_status = data.get("status")
    if new_status not in STATUSES:
        return jsonify({"error": "Invalid status."}), 400
    with get_connection() as conn:
        conn.execute(
            "UPDATE applications SET status = ? WHERE id = ?", (new_status, app_id)
        )
        conn.commit()
    return jsonify({"ok": True})


@app.delete("/api/applications/<int:app_id>")
def remove_application(app_id: int):
    """Delete an application and its stored resume file."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT resume_path FROM applications WHERE id = ?", (app_id,)
        ).fetchone()
        if row and row["resume_path"]:
            f = Path(row["resume_path"])
            if f.exists():
                f.unlink()  # remove the orphaned PDF
        conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
        conn.commit()
    return jsonify({"ok": True})


@app.get("/api/applications/<int:app_id>/resume")
def download_resume(app_id: int):
    """Stream back the exact resume PDF used for this application."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT resume_filename, resume_path FROM applications WHERE id = ?",
            (app_id,),
        ).fetchone()
    if not row or not row["resume_path"]:
        abort(404)
    path = Path(row["resume_path"])
    if not path.exists():
        abort(404)
    return send_file(
        path, as_attachment=True, download_name=row["resume_filename"],
        mimetype="application/pdf",
    )


@app.get("/api/export")
def export_csv():
    """Export all applications as a CSV download."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT company, role, date_applied, status, location, job_link, "
            "notes, resume_filename, follow_up_date FROM applications "
            "ORDER BY date_applied DESC, id DESC"
        ).fetchall()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "company", "role", "date_applied", "status", "location",
        "job_link", "notes", "resume_filename", "follow_up_date",
    ])
    for r in rows:
        writer.writerow([r[k] for k in r.keys()])

    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=job_applications.csv"},
    )


if __name__ == "__main__":
    init_storage()
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
