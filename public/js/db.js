// Databázová vrstva: dvě sql.js databáze.
//  - data: herní katalogy (jen pro čtení), stažené z data/jad.sqlite (service worker je drží offline)
//  - user: střetnutí a družiny; celá DB se po změnách ukládá jako bajty do IndexedDB

export const SQLJS_VERSION = '1.13.0';
const SQLJS_BASE = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist/`;

const IDB_NAME = 'jad-offline';
const IDB_STORE = 'kv';
const IDB_KEY = 'userdb';

let SQL = null;
let dataDb = null;
let userDb = null;

// ---------------------------------------------------------------------------
// IndexedDB (jednoduché key–value)

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => reject(r.error);
  }).finally(() => db.close());
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

// ---------------------------------------------------------------------------
// Schéma uživatelské databáze. PRAGMA user_version = verze schématu.

const USER_MIGRATIONS = [
  // v1
  `
  CREATE TABLE parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE party_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    bv_ted INTEGER,
    bv_max INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_pm_party ON party_members(party_id);

  CREATE TABLE encounters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id INTEGER,
    party_name TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL DEFAULT 'medium',
    strength REAL,
    base_xp INTEGER NOT NULL DEFAULT 0,
    multiplier REAL NOT NULL DEFAULT 1,
    adjusted_xp INTEGER NOT NULL DEFAULT 0,
    loot_mode TEXT NOT NULL DEFAULT 'balanced',
    base_items_only INTEGER NOT NULL DEFAULT 0,
    phase TEXT NOT NULL DEFAULT 'prepared',
    note TEXT NOT NULL DEFAULT '',
    round_no INTEGER NOT NULL DEFAULT 1,
    active_instance_id INTEGER,
    pc_init_done INTEGER NOT NULL DEFAULT 0,
    pc_tie_pending TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  -- monster_id: NULL = hráčská postava, -1 = zjednodušený protivník, >0 = jad_monsters.id
  CREATE TABLE encounter_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id INTEGER NOT NULL,
    monster_id INTEGER,
    party_member_id INTEGER,
    level INTEGER,
    instance_no INTEGER NOT NULL DEFAULT 1,
    name_override TEXT NOT NULL DEFAULT '',
    initiative INTEGER,
    hp_current INTEGER,
    hp_max INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    is_defeated INTEGER NOT NULL DEFAULT 0,
    is_boss INTEGER NOT NULL DEFAULT 0,
    simple_ac INTEGER,
    simple_attack TEXT
  );
  CREATE INDEX idx_ei_enc ON encounter_instances(encounter_id);

  CREATE TABLE encounter_effects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id INTEGER NOT NULL,
    instance_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    duration_rounds INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_ee_enc ON encounter_effects(encounter_id);

  CREATE TABLE encounter_loot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id INTEGER NOT NULL,
    item_id INTEGER,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    rarity TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'random',
    given_to TEXT
  );
  CREATE INDEX idx_el_enc ON encounter_loot(encounter_id);
  `,
];

function migrate(db) {
  const cur = db.exec('PRAGMA user_version')[0]?.values?.[0]?.[0] ?? 0;
  for (let v = cur; v < USER_MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(USER_MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Dotazovací helpery

function all(db, sql, params = []) {
  const st = db.prepare(sql);
  try {
    st.bind(params);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally {
    st.free();
  }
}

function one(db, sql, params = []) {
  return all(db, sql, params)[0] ?? null;
}

function makeApi(db, onWrite) {
  return {
    all: (sql, params) => all(db, sql, params),
    one: (sql, params) => one(db, sql, params),
    value: (sql, params) => {
      const r = one(db, sql, params);
      return r ? Object.values(r)[0] : null;
    },
    run(sql, params = []) {
      db.run(sql, params);
      if (onWrite) onWrite();
      return this;
    },
    insert(sql, params = []) {
      db.run(sql, params);
      const id = one(db, 'SELECT last_insert_rowid() AS id').id;
      if (onWrite) onWrite();
      return id;
    },
    /** Spustí fn v transakci; při výjimce rollback. */
    tx(fn) {
      db.exec('BEGIN');
      try {
        const r = fn();
        db.exec('COMMIT');
        if (onWrite) onWrite();
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Ukládání uživatelské DB (debounce + flush při skrytí aplikace)

let saveTimer = null;
let savePending = false;
let saveChain = Promise.resolve();
const saveListeners = new Set();

function scheduleSave() {
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushUser, 400);
}

export function flushUser() {
  clearTimeout(saveTimer);
  if (!savePending || !userDb) return saveChain;
  savePending = false;
  const bytes = userDb.export();
  saveChain = saveChain
    .then(() => idbSet(IDB_KEY, bytes))
    .then(() => saveListeners.forEach((fn) => fn(null)))
    .catch((e) => {
      console.error('Uložení selhalo', e);
      saveListeners.forEach((fn) => fn(e));
    });
  return saveChain;
}

export function onSave(fn) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushUser();
});
window.addEventListener('pagehide', () => flushUser());

// ---------------------------------------------------------------------------

export let data = null;
export let user = null;
export let dataVersion = null;

export async function initDatabases() {
  if (typeof initSqlJs !== 'function') {
    throw new Error('Knihovna sql.js se nenačetla. Při prvním spuštění musí být zařízení online.');
  }
  SQL = await initSqlJs({ locateFile: (f) => SQLJS_BASE + f });

  const [dataBytes, ver, userBytes] = await Promise.all([
    fetch('data/jad.sqlite').then((r) => {
      if (!r.ok) throw new Error('Nepodařilo se načíst data/jad.sqlite (' + r.status + ').');
      return r.arrayBuffer();
    }),
    fetch('data/version.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    idbGet(IDB_KEY).catch(() => null),
  ]);

  dataDb = new SQL.Database(new Uint8Array(dataBytes));
  data = makeApi(dataDb, null);
  dataVersion = ver;

  userDb = userBytes ? new SQL.Database(new Uint8Array(userBytes)) : new SQL.Database();
  migrate(userDb);
  user = makeApi(userDb, scheduleSave);
  if (!userBytes) {
    savePending = true;
    flushUser();
  }

  // Požádáme prohlížeč, aby data neuklízel (Safari to respektuje u nainstalované PWA).
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {
    /* nevadí */
  }
}

/** Záloha uživatelských dat – bajty SQLite souboru. */
export function exportUserBytes() {
  return userDb.export();
}

/** Obnova ze zálohy. Ověří, že jde o SQLite s očekávanými tabulkami. */
export async function importUserBytes(bytes) {
  const test = new SQL.Database(bytes);
  try {
    const t = all(test, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('encounters','parties')");
    if (t.length < 2) throw new Error('Soubor neobsahuje data JaD Pomocníka.');
    migrate(test);
  } catch (e) {
    test.close();
    throw e;
  }
  userDb.close();
  userDb = test;
  user = makeApi(userDb, scheduleSave);
  savePending = true;
  await flushUser();
}

export async function resetUserData() {
  userDb.close();
  userDb = new SQL.Database();
  migrate(userDb);
  user = makeApi(userDb, scheduleSave);
  savePending = true;
  await flushUser();
}

export async function storageInfo() {
  const out = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      out.usage = e.usage ?? null;
      out.quota = e.quota ?? null;
    }
  } catch {
    /* nevadí */
  }
  return out;
}
