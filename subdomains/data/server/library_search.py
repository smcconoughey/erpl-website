import json
import re
import sqlite3
import sys


def main():
    database, raw_query, raw_limit = sys.argv[1:4]
    allowed_paths = json.load(sys.stdin)
    if not isinstance(allowed_paths, list) or not allowed_paths:
        print("[]")
        return
    terms = re.findall(r"[^\W_]+", raw_query, flags=re.UNICODE)[:12]
    if not terms:
        print("[]")
        return
    query = " AND ".join('"' + term.replace('"', '""') + '"*' for term in terms)
    limit = min(max(int(raw_limit), 1), 50)
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    placeholders = ",".join("?" for _ in allowed_paths)
    rows = connection.execute(
        f"""
        SELECT path, page, kind,
               snippet(passages, 3, '<mark>', '</mark>', ' … ', 30) AS excerpt,
               bm25(passages) AS score
          FROM passages
         WHERE passages MATCH ? AND path IN ({placeholders})
         ORDER BY score
         LIMIT ?
        """,
        (query, *allowed_paths, limit),
    ).fetchall()
    print(json.dumps([
        {"path": path, "page": page, "kind": kind, "excerpt": excerpt, "score": score}
        for path, page, kind, excerpt, score in rows
    ]))


if __name__ == "__main__":
    main()
