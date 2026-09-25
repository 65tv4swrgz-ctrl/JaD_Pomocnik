// Herní katalogy z data DB (jen pro čtení). Seznamy se načtou jednou a filtrují v paměti.

import { data } from './db.js';
import { cmp, norm } from './util.js';

let cache = null;

export const RARITY_ORDER = ['Běžný', 'Neobvyklý', 'Vzácný', 'Velmi vzácný', 'Legendární', 'Artefakt'];

function distinct(rows, key) {
  const set = new Set();
  for (const r of rows) {
    const v = (r[key] ?? '').toString().trim();
    if (v) set.add(v);
  }
  return [...set].sort(cmp);
}

function parseClasses(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String).filter((s) => s.trim() !== '') : [];
  } catch {
    return [];
  }
}

export function crToFloat(cr) {
  const s = normalizeCrKey(cr);
  if (!s) return NaN;
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    return b ? a / b : NaN;
  }
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

export function normalizeCrKey(cr) {
  let s = String(cr ?? '').trim();
  if (!s) return '';
  s = s.replace('⅛', '1/8').replace('¼', '1/4').replace('½', '1/2').replace(/[⁄∕]/g, '/').replace(/\s*\/\s*/g, '/');
  return s.trim();
}

function load() {
  if (cache) return cache;

  const monsters = data.all('SELECT * FROM jad_monsters ORDER BY jmeno');
  for (const m of monsters) {
    m._n = norm(m.jmeno);
    m._cr = normalizeCrKey(m.nebezpecnost);
    m._crv = crToFloat(m._cr);
  }
  monsters.sort((a, b) => cmp(a.jmeno, b.jmeno));

  const items = data.all('SELECT * FROM jad_items');
  for (const it of items) {
    it._n = norm(it.jmeno);
    const ri = RARITY_ORDER.indexOf(it.vzacnost);
    it._rar = ri < 0 ? 999 : ri;
  }
  items.sort((a, b) => cmp(a.jmeno, b.jmeno));

  const spells = data.all('SELECT * FROM spells');
  for (const s of spells) {
    s._n = norm(s.name);
    s._classes = parseClasses(s.classes);
    s.classes_text = s._classes.join(', ');
  }
  spells.sort((a, b) => cmp(a.name, b.name));

  const itemSubByCat = {};
  for (const it of items) {
    const c = (it.kategorie ?? '').trim();
    const s = (it.podkategorie ?? '').trim();
    if (!c || !s) continue;
    (itemSubByCat[c] ||= new Set()).add(s);
  }
  for (const k of Object.keys(itemSubByCat)) itemSubByCat[k] = [...itemSubByCat[k]].sort(cmp);

  const rarities = distinct(items, 'vzacnost').sort((a, b) => {
    const ia = RARITY_ORDER.indexOf(a);
    const ib = RARITY_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || cmp(a, b);
  });

  const spellClasses = [...new Set(spells.flatMap((s) => s._classes))].sort(cmp);

  // Tabulka síly: level -> { cr: hodnota }
  const strength = {};
  for (const r of data.all('SELECT level, cr_key, strength_num, strength_den FROM jad_encounter_strength')) {
    const cr = normalizeCrKey(r.cr_key);
    if (!cr || !r.strength_den) continue;
    (strength[r.level] ||= {})[cr] = r.strength_num / r.strength_den;
  }

  cache = {
    monsters,
    monsterById: new Map(monsters.map((m) => [m.id, m])),
    monsterCats: distinct(monsters, 'kategorie'),
    monsterEnvs: distinct(monsters, 'prostredi'),
    items,
    itemById: new Map(items.map((i) => [i.id, i])),
    rarities,
    itemCats: distinct(items, 'kategorie'),
    itemSubs: distinct(items, 'podkategorie'),
    itemSubByCat,
    itemClasses: distinct(items, 'trida'),
    itemBonuses: distinct(items, 'bonus'),
    spells,
    spellById: new Map(spells.map((s) => [s.id, s])),
    spellSchools: distinct(spells, 'school'),
    spellClasses,
    strength,
  };
  return cache;
}

export function catalog() {
  return load();
}

/** Kouzla protivníka (vazba monster_spells, zdroj „kouzla“) – stejné řazení jako na webu. */
export function spellsForMonster(monsterId) {
  return data.all(
    `SELECT ms.slot_level, ms.usage_text, ms.group_order,
            s.id AS spell_id, s.name, s.level, s.school, s.casting_time, s.range_text,
            s.components_text, s.duration_text, s.description
       FROM monster_spells ms
       JOIN spells s ON s.id = ms.spell_id
      WHERE ms.monster_id = ? AND ms.source = 'kouzla'
      ORDER BY COALESCE(ms.group_order, 99), COALESCE(ms.slot_level, s.level, 0), s.level, s.name`,
    [monsterId]
  );
}

export function spellLevelLabel(lvl) {
  const i = parseInt(lvl, 10) || 0;
  return i === 0 ? 'Trik' : i + '. úr.';
}
