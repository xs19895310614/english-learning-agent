from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import unicodedata
from pathlib import Path


FIELDS = (
    "word",
    "phonetic",
    "definition",
    "translation",
    "pos",
    "collins",
    "oxford",
    "tag",
    "bnc",
    "frq",
    "exchange",
    "detail",
    "audio",
)


def normalize_word(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").replace("’", "'")
    value = re.sub(r"\s+", " ", value.strip().lower())
    return value


def strip_word(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", normalize_word(value))


def parse_exchange(value: str) -> list[str]:
    forms: list[str] = []
    for part in (value or "").split("/"):
        if ":" not in part:
            continue
        _, form = part.split(":", 1)
        form = form.strip()
        if form:
            forms.append(form)
    return forms


def build_database(source: Path, output: Path) -> tuple[int, int]:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    connection = sqlite3.connect(output)
    connection.executescript(
        """
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        CREATE TABLE entries (
          id INTEGER PRIMARY KEY,
          word TEXT NOT NULL,
          word_key TEXT NOT NULL,
          strip_key TEXT NOT NULL,
          phonetic TEXT,
          definition TEXT,
          translation TEXT,
          pos TEXT,
          collins TEXT,
          oxford TEXT,
          tag TEXT,
          bnc TEXT,
          frq TEXT,
          exchange TEXT,
          detail TEXT,
          audio TEXT
        );
        CREATE TABLE word_forms (
          form_key TEXT NOT NULL,
          entry_id INTEGER NOT NULL,
          form TEXT NOT NULL,
          FOREIGN KEY(entry_id) REFERENCES entries(id)
        );
        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        """
    )

    entry_rows: list[tuple[str, ...]] = []
    form_rows: list[tuple[str, int, str]] = []
    entry_count = 0
    form_count = 0

    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            word = (row.get("word") or "").strip()
            word_key = normalize_word(word)
            if not word_key:
                continue
            entry_count += 1
            entry_rows.append(
                (
                    word,
                    word_key,
                    strip_word(word),
                    (row.get("phonetic") or "").strip(),
                    row.get("definition") or "",
                    row.get("translation") or "",
                    row.get("pos") or "",
                    row.get("collins") or "",
                    row.get("oxford") or "",
                    row.get("tag") or "",
                    row.get("bnc") or "",
                    row.get("frq") or "",
                    row.get("exchange") or "",
                    row.get("detail") or "",
                    row.get("audio") or "",
                )
            )
            entry_id = entry_count
            seen_forms: set[str] = set()
            for form in parse_exchange(row.get("exchange") or ""):
                form_key = normalize_word(form)
                if not form_key or form_key in seen_forms or form_key == word_key:
                    continue
                seen_forms.add(form_key)
                form_rows.append((form_key, entry_id, form))
                form_count += 1

            if len(entry_rows) >= 5000:
                connection.executemany(
                    """
                    INSERT INTO entries (
                      word, word_key, strip_key, phonetic, definition, translation,
                      pos, collins, oxford, tag, bnc, frq, exchange, detail, audio
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    entry_rows,
                )
                entry_rows.clear()

            if len(form_rows) >= 10000:
                connection.executemany(
                    "INSERT INTO word_forms (form_key, entry_id, form) VALUES (?, ?, ?)",
                    form_rows,
                )
                form_rows.clear()

    if entry_rows:
        connection.executemany(
            """
            INSERT INTO entries (
              word, word_key, strip_key, phonetic, definition, translation,
              pos, collins, oxford, tag, bnc, frq, exchange, detail, audio
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            entry_rows,
        )
    if form_rows:
        connection.executemany(
            "INSERT INTO word_forms (form_key, entry_id, form) VALUES (?, ?, ?)",
            form_rows,
        )

    connection.executescript(
        """
        CREATE INDEX idx_entries_word_key ON entries(word_key);
        CREATE INDEX idx_entries_strip_key ON entries(strip_key);
        CREATE INDEX idx_word_forms_form_key ON word_forms(form_key);
        INSERT INTO metadata (key, value) VALUES ('source', 'ECDICT');
        INSERT INTO metadata (key, value) VALUES ('source_version', 'master@bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b');
        """
    )
    connection.commit()
    connection.close()
    return entry_count, form_count


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert ECDICT CSV to an indexed SQLite dictionary.")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    entries, forms = build_database(args.source, args.output)
    print(f"Built {args.output} with {entries} entries and {forms} word forms.")


if __name__ == "__main__":
    main()
