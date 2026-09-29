import json
import re
import sqlite3
import sys


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "pages":
        database, path, raw_start, raw_limit = sys.argv[2:6]
        start = max(int(raw_start), 1)
        limit = min(max(int(raw_limit), 1), 10)
        connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
        total = connection.execute(
            'SELECT MAX(page) FROM passages WHERE path=? AND kind="pdf"', (path,)
        ).fetchone()[0]
        rows = connection.execute(
            'SELECT page, body FROM passages WHERE path=? AND kind="pdf" AND page>=? ORDER BY page LIMIT ?',
            (path, start, limit),
        ).fetchall()
        print(json.dumps({"indexed": total is not None, "totalPages": total or 0,
                          "pages": [{"page": page, "text": body} for page, body in rows]}))
        return
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
