"""
Migration script to add recommendation_reason column to generated_clips table.

Run this after deploying the code changes to add the new column to existing databases.

Usage:
    python scripts/migrate_add_recommendation_reason.py
"""

import sqlite3
import os
import sys

raw_url = os.environ.get("DATABASE_URL")
if not raw_url:
    sys.exit(
        "ERROR: DATABASE_URL environment variable is not set.\n"
        "Create a .env file (see .env.example) or set it in your environment.\n"
        "Examples:\n"
        "  SQLite:     DATABASE_URL=sqlite+aiosqlite:///./data/momiji.db\n"
        "  PostgreSQL: DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/momiji"
    )

if not raw_url.startswith("sqlite"):
    sys.exit(
        f"ERROR: This migration script only supports SQLite.\n"
        f"DATABASE_URL is set to a non-SQLite backend: {raw_url}\n"
        f"For PostgreSQL, run the equivalent ALTER TABLE statement manually."
    )

import re
match = re.search(r"sqlite[^:]*:///(.+)", raw_url)
if not match:
    sys.exit(f"ERROR: Could not parse SQLite path from DATABASE_URL: {raw_url}")
DB_PATH = match.group(1)

# If path is relative, make it absolute relative to backend directory
if not os.path.isabs(DB_PATH):
    DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), DB_PATH)

def migrate():
    """Add recommendation_reason column to generated_clips table."""
    print(f"Connecting to database: {DB_PATH}")

    if not os.path.exists(DB_PATH):
        print(f"Error: Database not found at {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check if column already exists
    cursor.execute("PRAGMA table_info(generated_clips)")
    columns = [row[1] for row in cursor.fetchall()]

    if "recommendation_reason" in columns:
        print("Column 'recommendation_reason' already exists. No migration needed.")
        conn.close()
        return

    print("Adding 'recommendation_reason' column to generated_clips table...")

    try:
        cursor.execute("""
            ALTER TABLE generated_clips
            ADD COLUMN recommendation_reason TEXT
        """)
        conn.commit()
        print("Successfully added 'recommendation_reason' column.")
    except sqlite3.OperationalError as e:
        print(f"Error adding column: {e}")
        conn.close()
        sys.exit(1)

    conn.close()
    print("Migration complete!")

if __name__ == "__main__":
    migrate()
