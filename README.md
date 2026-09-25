# JaD Pomocník – offline PWA

Offline verze herního pomocníka pro **Jeskyně a draci**, určená hlavně pro iPad:

- **Příručka** – protivníci, předměty a kouzla s vyhledáváním a filtry (data ze zálohy webové verze).
- **Generátor střetnutí** – výpočet síly podle JaD tabulky, boss, režimy lootu.
- **Vedení boje** – iniciativa (včetně řešení shod), tahy a kola, body výdrže, stavy s odpočtem,
  přidávání protivníků za běhu, loot a jeho předávání, poznámky.
- **Družiny** – postavy s úrovní a BV (BV se během boje zapisují zpět).

Běží čistě ve prohlížeči: statické soubory + [sql.js](https://sql.js.org) (SQLite ve WebAssembly).
Žádný server ani build krok.

## Struktura

```
public/                 ← to se nasazuje (Cloudflare Pages: output directory)
  index.html, sw.js, manifest.webmanifest, _headers
  css/app.css
  js/                   ← ES moduly (app.js = router, db.js, store.js, rules.js, views/…)
  data/jad.sqlite       ← herní katalogy (jen pro čtení), generuje tools/build_db.py
  icons/
tools/
  build_db.py           ← MySQL záloha → public/data/jad.sqlite (+ zavolá stamp.py)
  stamp.py              ← orazítkuje verzi (hash obsahu) do sw.js – NUTNÉ před každým nasazením
```

### Data

- `data/jad.sqlite` obsahuje **jen** tabulky `spells`, `jad_items`, `jad_monsters`, `monster_spells`,
  `jad_cr`, `jad_encounter_strength`. Uživatelské účty, hesla, postavy ani kampaně se nepřenáší
  (whitelist v `tools/build_db.py`).
- Družiny a střetnutí jsou v druhé SQLite databázi, která se ukládá do **IndexedDB** v zařízení.
  Záloha/obnova je na stránce **Data** (sdílení do Souborů / AirDrop).

## Aktualizace herních dat

```bash
python tools/build_db.py cesta/k/zaloze.sql
```

Záloha `.sql` se **necommituje** (je v `.gitignore`) – obsahuje uživatelská data.

## Nasazení

1. Před každým commitem: `python tools/stamp.py` (změní `BUILD` v `sw.js`; bez toho si nainstalovaná
   aplikace novou verzi nestáhne). Skript zároveň hlídá, že všechny soubory jsou v seznamu pro offline.
2. Commit + push na GitHub.
3. **Cloudflare Pages** (jednorázově): *Workers & Pages → Create → Pages → Connect to Git* → vybrat repozitář:
   - Framework preset: **None**
   - Build command: *(prázdné)*
   - Build output directory: **`public`**
   Každý další push se nasadí automaticky.

Na iPadu se nová verze projeví lištou „Je k dispozici nová verze → Aktualizovat“.

## Instalace na iPad

1. Otevři adresu z Cloudflare Pages v **Safari** (poprvé musí být online).
2. *Sdílet → Přidat na plochu*.
3. Spouštěj z ikony. Data v ikoně a v Safari jsou oddělená – střetnutí zakládej v nainstalované aplikaci.

## Lokální vývoj

```bash
python -m http.server 8765 --directory public
```

Na `localhost` je service worker vypnutý (jinak by servíroval staré soubory z cache);
pro test offline režimu otevři `http://localhost:8765/?sw=1`.

## Poznámky k převodu z PHP verze

- Logika odpovídá `EncounterService` / `EncounterRepository` webové verze (síla, násobiče XP, HP bosse,
  generátor lootu, pořadí tahů, řešení shod iniciativ).
- Oprava: webová verze u předmětů „Velmi vzácný“ omylem počítala vzácnost „vzácný“ (loot je tak
  mohl nabízet už od 5. úrovně). Offline verze je řadí správně (od 11. úrovně).
- Vyřazený účastník, který byl právě na tahu: „Další tah“ pokračuje dalším v pořadí (web skočil na začátek
  a přičetl kolo).
- Předání lootu postavě jen zaznamená, komu předmět připadl (offline verze nemá inventáře postav).
- sql.js se načítá z jsDelivr a při instalaci se uloží do cache service workeru.
