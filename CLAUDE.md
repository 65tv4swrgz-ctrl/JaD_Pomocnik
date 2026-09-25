# CLAUDE.md

Offline PWA „JaD Pomocník“ pro iPad – port části PHP aplikace (`C:\Users\cerny\Desktop\JaD_pomocnik_zaloha`):
příručka (protivníci, předměty, kouzla) + generátor a vedení střetnutí. Podrobnosti v `README.md`.

## Zásady

- Vanilla JS (ES moduly), žádný framework ani build krok. Nasazuje se složka `public/` (Cloudflare Pages).
- **Po každé změně v `public/` spusť `py tools/stamp.py`** – mění `BUILD` v `sw.js`; bez toho se změna
  do nainstalované aplikace nedostane. Nový soubor v `public/` přidej do `PRECACHE` v `sw.js` (stamp to hlídá).
- Texty pro uživatele i komentáře česky.
- `data/jad.sqlite` (katalogy, jen čtení) se generuje `py tools/build_db.py <záloha.sql>`; přenáší se jen
  whitelist tabulek. Zálohy `.sql` necommitovat (uživatelská data).
- Uživatelská data (družiny, střetnutí) = druhá sql.js DB v IndexedDB; schéma a migrace v `js/db.js`
  (`USER_MIGRATIONS`, `PRAGMA user_version`) – nové změny schématu vždy jako nová migrace, nikdy neupravovat staré.
- Pravidla (síla, XP, HP bosse, loot) v `js/rules.js` odpovídají `EncounterService`/`EncounterRepository` z PHP;
  operace nad DB v `js/store.js`. Názvy sloupců do SQL nikdy nesestavovat z uživatelského vstupu (whitelist).
- Na `localhost` je service worker vypnutý; offline test přes `?sw=1`.
- Na tomto PC je Python dostupný jako `py` (ne `python`).
