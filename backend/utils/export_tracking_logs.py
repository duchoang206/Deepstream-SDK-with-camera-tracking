#!/usr/bin/env python3
"""
Tracking Logs & Analytics History Export Utility.

Exports intrusion alerts and tracked target histories from SQLite to JSON / CSV.
"""

import sqlite3
import json
import csv
import argparse
import os
import logging
from typing import List, Dict, Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("ExportTrackingLogs")


def export_logs(db_path: str, output_file: str, output_format: str = "json"):
    if not os.path.exists(db_path):
        logger.error(f"Database file not found: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row["name"] for row in cursor.fetchall()]
        logger.info(f"Discovered tables in database: {tables}")

        data: Dict[str, List[Dict[str, Any]]] = {}
        for tbl in tables:
            cursor.execute(f"SELECT * FROM {tbl} ORDER BY id DESC LIMIT 500")
            rows = [dict(row) for row in cursor.fetchall()]
            data[tbl] = rows
            logger.info(f"Extracted {len(rows)} rows from table '{tbl}'")

        if output_format.lower() == "json":
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            logger.info(f"Exported logs to JSON: {output_file}")
        elif output_format.lower() == "csv":
            for tbl, rows in data.items():
                if not rows:
                    continue
                tbl_csv_file = f"{os.path.splitext(output_file)[0]}_{tbl}.csv"
                with open(tbl_csv_file, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
                    writer.writeheader()
                    writer.writerows(rows)
                logger.info(f"Exported table '{tbl}' to CSV: {tbl_csv_file}")

    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export Tracking Analytics Logs")
    parser.add_argument("--db", type=str, default="backend/data/analytics.db", help="Path to SQLite DB")
    parser.add_argument("--out", type=str, default="tracking_export.json", help="Output file path")
    parser.add_argument("--format", type=str, default="json", choices=["json", "csv"], help="Format")
    args = parser.parse_args()

    export_logs(args.db, args.out, args.format)
