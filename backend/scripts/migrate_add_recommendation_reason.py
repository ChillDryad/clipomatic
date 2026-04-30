"""
Migration script to add recommendation_reason column to generated_clips table.

Run this after deploying the code changes to add the new column to existing databases.

Usage:
    python scripts/migrate_add_recommendation_reason.py
"""

import sqlite3
import os
import sys

# Get the database path from environment or use default
DB_PATH = os.environ.get("DATABASE_URL", "sqlite:///./momiji.db").replace("sqlite:///", "")

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
