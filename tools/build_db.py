#!/usr/bin/env python3
"""
Převod zálohy MySQL (phpMyAdmin dump) na SQLite databázi pro offline PWA.

Do výstupu jdou VÝHRADNĚ herní katalogy (kouzla, předměty, protivníci, tabulky síly).
Uživatelská data (users, sessions, postavy, kampaně, střetnutí…) se nikdy nepřenáší.

Použití:
    python tools/build_db.py cesta/k/zaloze.sql

Výstup:
    public/data/jad.sqlite
    public/data/version.json   ({"version": "<hash>", "built": "...", "counts": {...}})
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data"
OUT_DB = OUT_DIR / "jad.sqlite"
OUT_VER = OUT_DIR / "version.json"

# Whitelist tabulek a sloupců, které se přenášejí. Nic jiného do výstupu nejde.
SCHEMA: dict[str, str] = {
    "spells": """
        CREATE TABLE spells (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          level INTEGER,
          school TEXT,
          ritual INTEGER NOT NULL DEFAULT 0,
          casting_time TEXT,
          range_text TEXT,
          components_text TEXT,
          material TEXT,
          duration_text TEXT,
          concentration INTEGER NOT NULL DEFAULT 0,
          classes TEXT,
          description TEXT
        )""",
    "jad_items": """
        CREATE TABLE jad_items (
          id INTEGER PRIMARY KEY,
          jmeno TEXT NOT NULL,
          vzacnost TEXT,
          kategorie TEXT,
          podkategorie TEXT,
          trida TEXT,
          vytribena INTEGER NOT NULL DEFAULT 0,
          druh_zbrane TEXT,
          dmg TEXT,
          dostrel TEXT,
          vlastnosti TEXT,
          cena TEXT,
          vaha TEXT,
          oc TEXT,
          nevyhoda TEXT,
          sila TEXT,
          obsah TEXT,
          sladeni TEXT,
          interakce TEXT,
          bonus TEXT,
          "limit" TEXT,
          trvani TEXT,
          efekt TEXT,
          popis TEXT,
          ucel TEXT
        )""",
    "jad_monsters": """
        CREATE TABLE jad_monsters (
          id INTEGER PRIMARY KEY,
          jmeno TEXT NOT NULL,
          kategorie TEXT,
          prostredi TEXT,
          nebezpecnost TEXT,
          presvedceni TEXT,
          velikost TEXT,
          sila INTEGER,
          obratnost INTEGER,
          odolnost INTEGER,
          inteligence INTEGER,
          moudrost INTEGER,
          charisma INTEGER,
          rychlost TEXT,
          pasivni_vnimani INTEGER,
          vydrz INTEGER,
          obranne_cislo INTEGER,
          utoky TEXT,
          kouzla TEXT,
          schopnosti TEXT,
          zachranne_hody TEXT,
          zdatnost TEXT,
          odolnosti TEXT,
          imunita TEXT,
          akce TEXT,
          reakce TEXT,
          legendarni_akce TEXT,
          unikatni TEXT,
          poznamka TEXT
        )""",
    "monster_spells": """
        CREATE TABLE monster_spells (
          id INTEGER PRIMARY KEY,
          monster_id INTEGER NOT NULL,
          spell_id INTEGER NOT NULL,
          source TEXT NOT NULL,
          slot_level INTEGER,
          usage_text TEXT,
          group_order INTEGER
        )""",
    "jad_cr": """
        CREATE TABLE jad_cr (
          cr_key TEXT PRIMARY KEY,
          cr_display TEXT NOT NULL,
          sort_order INTEGER NOT NULL
        )""",
    "jad_encounter_strength": """
        CREATE TABLE jad_encounter_strength (
          level INTEGER NOT NULL,
          cr_key TEXT NOT NULL,
          strength_num INTEGER NOT NULL,
          strength_den INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (level, cr_key)
        )""",
}

INDEXES = [
    "CREATE INDEX idx_spells_level ON spells(level)",
    "CREATE INDEX idx_items_name ON jad_items(jmeno)",
    "CREATE INDEX idx_monsters_name ON jad_monsters(jmeno)",
    "CREATE INDEX idx_monster_spells_mid ON monster_spells(monster_id)",
]


def schema_columns(ddl: str) -> list[str]:
    """Vytáhne názvy sloupců z CREATE TABLE výše (jednoduchý parser pro vlastní DDL)."""
    body = ddl[ddl.index("(") + 1 : ddl.rindex(")")]
    cols = []
    for line in body.split("\n"):
        line = line.strip().rstrip(",")
        if not line or line.upper().startswith("PRIMARY KEY"):
            continue
        cols.append(line.split()[0].strip('"'))
    return cols


# ---------------------------------------------------------------------------
# Parser MySQL INSERT příkazů
# ---------------------------------------------------------------------------

_ESCAPES = {"0": "\0", "b": "\b", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a", "\\": "\\", "'": "'", '"': '"'}


def parse_values(s: str, i: int) -> tuple[list[list], int]:
    """Parsuje `(…),(…);` od pozice i. Vrací seznam řádků a pozici za středníkem."""
    rows: list[list] = []
    n = len(s)
    while i < n:
        c = s[i]
        if c in " \t\r\n,":
            i += 1
            continue
        if c == ";":
            return rows, i + 1
        if c != "(":
            raise ValueError(f"Neočekávaný znak {c!r} na pozici {i}")
        i += 1
        row: list = []
        while True:
            while s[i] in " \t\r\n":
                i += 1
            c = s[i]
            if c == "'":
                i += 1
                buf = []
                while True:
                    ch = s[i]
                    if ch == "\\":
                        nxt = s[i + 1]
                        buf.append(_ESCAPES.get(nxt, nxt))
                        i += 2
                    elif ch == "'":
                        if i + 1 < n and s[i + 1] == "'":
                            buf.append("'")
                            i += 2
                        else:
                            i += 1
                            break
                    else:
                        buf.append(ch)
                        i += 1
                row.append("".join(buf))
            else:
                j = i
                while s[j] not in ",)":
                    j += 1
                tok = s[i:j].strip()
                i = j
                if tok.upper() == "NULL":
                    row.append(None)
                else:
                    try:
                        row.append(int(tok))
                    except ValueError:
                        row.append(float(tok))
            while s[i] in " \t\r\n":
                i += 1
            if s[i] == ",":
                i += 1
                continue
            if s[i] == ")":
                i += 1
                break
            raise ValueError(f"Neočekávaný znak {s[i]!r} na pozici {i}")
        rows.append(row)
    return rows, i


def iter_inserts(sql: str):
    """Generuje (tabulka, sloupce, řádky) pro každý INSERT v dumpu."""
    pos = 0
    marker = "INSERT INTO `"
    while True:
        k = sql.find(marker, pos)
        if k < 0:
            return
        t_end = sql.index("`", k + len(marker))
        table = sql[k + len(marker) : t_end]
        p_open = sql.index("(", t_end)
        p_close = sql.index(")", p_open)
        cols = [c.strip().strip("`") for c in sql[p_open + 1 : p_close].split(",")]
        v = sql.index("VALUES", p_close) + len("VALUES")
        rows, pos = parse_values(sql, v)
        yield table, cols, rows


# ---------------------------------------------------------------------------


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1])
    sql = src.read_text(encoding="utf-8")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = OUT_DB.with_suffix(".tmp")
    if tmp.exists():
        tmp.unlink()

    con = sqlite3.connect(tmp)
    for ddl in SCHEMA.values():
        con.execute(ddl)

    counts: dict[str, int] = {t: 0 for t in SCHEMA}
    target_cols = {t: schema_columns(ddl) for t, ddl in SCHEMA.items()}

    for table, cols, rows in iter_inserts(sql):
        if table not in SCHEMA:
            continue  # uživatelská a jiná data se záměrně přeskakují
        keep = [c for c in target_cols[table] if c in cols]
        idx = [cols.index(c) for c in keep]
        quoted = ", ".join(f'"{c}"' for c in keep)
        ph = ", ".join("?" for _ in keep)
        stmt = f'INSERT INTO "{table}" ({quoted}) VALUES ({ph})'
        data = [[r[i] for i in idx] for r in rows]
        if table == "monster_spells":
            # Offline aplikace používá jen vazby „kouzla“ (stejně jako MonsterRepository::spellsForMonster).
            src_i = keep.index("source")
            data = [d for d in data if d[src_i] == "kouzla"]
        con.executemany(stmt, data)
        counts[table] += len(data)

    for ddl in INDEXES:
        con.execute(ddl)
    con.commit()
    con.execute("VACUUM")
    con.close()

    if OUT_DB.exists():
        OUT_DB.unlink()
    tmp.rename(OUT_DB)

    digest = hashlib.sha256(OUT_DB.read_bytes()).hexdigest()[:12]
    OUT_VER.write_text(
        json.dumps(
            {
                "version": digest,
                "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "counts": counts,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    size_kb = OUT_DB.stat().st_size / 1024
    print(f"Hotovo: {OUT_DB.relative_to(ROOT)} ({size_kb:.0f} kB), verze {digest}")
    for t, n in counts.items():
        print(f"  {t:24} {n:6}")

    # Nová data = nová verze aplikace (jinak by si ji nainstalovaný iPad nestáhl).
    import stamp

    return stamp.main()


if __name__ == "__main__":
    sys.exit(main())
