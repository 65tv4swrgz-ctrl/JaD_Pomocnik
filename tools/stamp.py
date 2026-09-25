#!/usr/bin/env python3
"""
Orazítkuje verzi aplikace podle obsahu složky public/.

- Spočítá hash všech souborů v public/ (kromě sw.js a js/version.js).
- Zapíše ho do `const BUILD = '…'` v public/sw.js a do APP_VERSION v public/js/version.js.
- Zkontroluje, že PRECACHE v sw.js obsahuje všechny soubory aplikace (jinak by offline chyběly).

Spouštěj před každým commitem/nasazením:
    python tools/stamp.py
Bez změny sw.js si nainstalovaná aplikace na iPadu novou verzi nestáhne.
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SW = PUBLIC / "sw.js"
VERSION_JS = PUBLIC / "js" / "version.js"
SKIP = {SW, VERSION_JS, PUBLIC / "_headers"}

# Soubory, které nemusí být v precache (favicon.ico si prohlížeč stáhne sám).
OPTIONAL = {"icons/favicon.ico"}


def main() -> int:
    files = sorted(p for p in PUBLIC.rglob("*") if p.is_file() and p not in SKIP)
    h = hashlib.sha256()
    for p in files:
        h.update(p.relative_to(PUBLIC).as_posix().encode())
        h.update(p.read_bytes())
    build = h.hexdigest()[:10]

    sw = SW.read_text(encoding="utf-8")
    sw_new, n = re.subn(r"const BUILD = '[^']*';", f"const BUILD = '{build}';", sw)
    if n != 1:
        print("V sw.js nebyl nalezen řádek `const BUILD = '…';`", file=sys.stderr)
        return 1
    SW.write_text(sw_new, encoding="utf-8", newline="\n")

    ver = VERSION_JS.read_text(encoding="utf-8")
    ver_new = re.sub(r"export const APP_VERSION = '[^']*';", f"export const APP_VERSION = '{build}';", ver)
    VERSION_JS.write_text(ver_new, encoding="utf-8", newline="\n")

    # Kontrola precache
    listed = set(re.findall(r"^\s*'([^']+)',", sw_new, flags=re.M))
    missing = [
        p.relative_to(PUBLIC).as_posix()
        for p in files
        if p.relative_to(PUBLIC).as_posix() not in listed and p.relative_to(PUBLIC).as_posix() not in OPTIONAL
    ]
    missing = [m for m in missing if not m.endswith(".md")]
    print(f"BUILD = {build}")
    if missing:
        print("POZOR – tyto soubory nejsou v PRECACHE v sw.js (offline by chyběly):")
        for m in missing:
            print("  ", m)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
