// Operace nad postavami v uživatelské DB – přepis CharacterRepository / character_api.php.

import { user } from './db.js';
import { catalog } from './catalog.js';
import {
  ALIGNMENTS, BACKGROUNDS, CLASS_SPECS, CLASSES, HIT_DICE, RACES, SPELL_ABILITIES, SPELL_SLOTS_LAYOUT, CHEST_LAYOUT, ABILITIES,
  baseSpeedByRace, exclusiveSlot, hitDieSides, mod, strengthRequirement,
} from './charrules.js';

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const touch = (id) => user.run('UPDATE characters SET updated_at=? WHERE id=?', [now(), id]);

// ---------------------------------------------------------------------------
// JSON pole

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** Seznam řetězců (podporuje i starší tvar {vybrane:[…]}). */
function decodeList(raw) {
  let d = parseJson(raw, []);
  if (d && !Array.isArray(d) && Array.isArray(d.vybrane)) d = d.vybrane;
  if (!Array.isArray(d)) return [];
  return [...new Set(d.map((x) => String(x).trim()).filter(Boolean))];
}

function hydrate(row) {
  if (!row) return null;
  const c = { ...row };
  for (const k of ['zd_dovednosti', 'kv_dovednosti', 'zd_zachranne_hody', 'kv_zachranne_hody', 'zd_pasivni_dovednosti', 'kv_pasivni_dovednosti', 'zd_pomucky', 'kv_pomucky', 'dostupna_truhla', 'pouzita_truhla']) {
    c[k] = decodeList(row[k]);
  }
  const w = parseJson(row.zd_zbrane, {});
  c.zd_zbrane = { vyber: Array.isArray(w.vyber) ? w.vyber.map(String) : [], jednoduche: w.jednoduche ? 1 : 0, valecne: w.valecne ? 1 : 0 };
  const a = parseJson(row.zd_zbroje, {});
  c.zd_zbroje = { lehke: a.lehke ? 1 : 0, stredni: a.stredni ? 1 : 0, tezke: a.tezke ? 1 : 0 };
  c.pripravena_kouzla = parseJson(row.pripravena_kouzla, {});
  c.pouzita_kouzla = parseJson(row.pouzita_kouzla, {});
  return c;
}

// ---------------------------------------------------------------------------
// Seznam, založení, smazání

export function listCharacters() {
  return user.all('SELECT id, jmeno, rasa, povolani, specializace, uroven, bv_ted, bv_max FROM characters ORDER BY jmeno COLLATE NOCASE');
}

export function getCharacter(id) {
  return hydrate(user.one('SELECT * FROM characters WHERE id=?', [id]));
}

function normalizeSlots(raw) {
  const out = {};
  for (const [lvl, positions] of Object.entries(SPELL_SLOTS_LAYOUT)) {
    const valid = new Set(positions.map(String));
    const picked = (raw?.[lvl] ?? []).map(String).filter((p) => valid.has(p));
    if (picked.length) out[lvl] = [...new Set(picked)];
  }
  return out;
}

function normalizeChest(raw) {
  const valid = new Set(CHEST_LAYOUT.flat().map(String));
  return [...new Set((raw ?? []).map(String).filter((p) => valid.has(p)))];
}

/** Založení postavy (CharacterService::prepareCreateCharacterPayload). Vrací ID nebo vyhodí chybu se seznamem problémů. */
export function createCharacter(input) {
  const errors = [];
  const name = String(input.jmeno ?? '').trim();
  if (!name) errors.push('Jméno postavy je povinné.');
  else if (name.length > 50) errors.push('Jméno postavy je příliš dlouhé (max. 50 znaků).');
  const pick = (v, list, label) => {
    if (!v) {
      errors.push(label + ' je povinné pole.');
      return '';
    }
    return list.includes(v) ? v : (errors.push(label + ' obsahuje neplatnou hodnotu.'), '');
  };
  const rasa = pick(input.rasa, RACES, 'Rasa');
  const zazemi = pick(input.zazemi, BACKGROUNDS, 'Zázemí');
  const povolani = pick(input.povolani, CLASSES, 'Povolání');
  const presvedceni = pick(input.presvedceni, ALIGNMENTS, 'Přesvědčení');
  const kostka = pick(input.kostka_obnovy, HIT_DICE, 'Kostka obnovy');
  const caster = !!input.kouzli;
  const sesilaci = caster ? pick(input.sesilaci_vlastnost, SPELL_ABILITIES, 'Sesílací vlastnost') : '';
  let bojova = String(input.bojova_vlastnost ?? '');
  if (bojova && !ABILITIES.some(([, n]) => n === bojova)) {
    errors.push('Vlastnost pro SO záchrany schopností obsahuje neplatnou hodnotu.');
    bojova = '';
  }
  if (!bojova && sesilaci) bojova = sesilaci;
  if (errors.length) throw new Error(errors.join('\n'));

  // BV na 1. úrovni = kostka obnovy + oprava Odolnosti (výchozí Odolnost 10 → +0).
  const bv = hitDieSides(kostka) + mod(10);
  const money = (v) => Math.max(0, parseInt(v, 10) || 0);

  return user.insert(
    `INSERT INTO characters (jmeno, rasa, zazemi, povolani, presvedceni, uroven, rychlost, kostka_obnovy, pocet_kostek_obnovy,
       sesilaci_vlastnost, bojova_vlastnost, pripravena_kouzla, dostupna_truhla, mesec_zl, mesec_st, mesec_md, bv_max, bv_ted)
     VALUES (?,?,?,?,?,1,?,?,1,?,?,?,?,?,?,?,?,?)`,
    [
      name, rasa, zazemi, povolani, presvedceni, baseSpeedByRace(rasa), kostka,
      sesilaci || null, bojova || null,
      JSON.stringify(caster ? normalizeSlots(input.spell_slots) : {}),
      JSON.stringify(caster ? normalizeChest(input.chest_slots) : []),
      money(input.mesec_zl), money(input.mesec_st), money(input.mesec_md), bv, bv,
    ]
  );
}

export function deleteCharacter(id) {
  user.tx(() => {
    user.run('DELETE FROM character_items WHERE character_id=?', [id]);
    user.run('DELETE FROM character_spells WHERE character_id=?', [id]);
    user.run('DELETE FROM characters WHERE id=?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Textová pole a výběry

const ENUMS = {
  rasa: RACES,
  zazemi: BACKGROUNDS,
  povolani: CLASSES,
  specializace: Object.values(CLASS_SPECS).flat(),
  presvedceni: ALIGNMENTS,
  sesilaci_vlastnost: SPELL_ABILITIES,
  bojova_vlastnost: ABILITIES.map(([, n]) => n),
};
const TEXT_FIELDS = ['jmeno', 'poznamka', 'schopnosti', 'vzhled', 'vztahy'];

export function setField(id, field, value) {
  let v = String(value ?? '');
  if (ENUMS[field]) {
    v = v.trim();
    if (v && !ENUMS[field].includes(v)) throw new Error('Neplatná hodnota.');
  } else if (!TEXT_FIELDS.includes(field)) {
    throw new Error('Neplatné pole.');
  }
  if (field === 'jmeno') {
    v = v.trim().slice(0, 50);
    if (!v) throw new Error('Jméno nesmí být prázdné.');
  }
  user.tx(() => {
    user.run(`UPDATE characters SET ${field}=? WHERE id=?`, [v || (ENUMS[field] ? null : ''), id]);
    // Změna povolání: specializace jiného povolání už neplatí.
    if (field === 'povolani') {
      const spec = user.value('SELECT specializace FROM characters WHERE id=?', [id]);
      if (spec && !(CLASS_SPECS[v] ?? []).includes(spec)) user.run('UPDATE characters SET specializace=NULL WHERE id=?', [id]);
    }
    touch(id);
  });
}

// ---------------------------------------------------------------------------
// Čísla

/** Inspirace, BV teď, počet kostek obnovy – krok ±1 s doménovými mezemi. */
export function applyDelta(id, field, delta) {
  if (!['inspirace', 'bv_ted', 'pocet_kostek_obnovy'].includes(field)) throw new Error('Neplatné pole.');
  const row = user.one(`SELECT ${field} AS v, uroven FROM characters WHERE id=?`, [id]);
  let next = (row.v ?? 0) + (delta < 0 ? -1 : 1);
  if (next < 0) next = 0;
  if (field === 'pocet_kostek_obnovy' && row.uroven > 0 && next > row.uroven) next = row.uroven;
  user.run(`UPDATE characters SET ${field}=?, updated_at=? WHERE id=?`, [next, now(), id]);
  return next;
}

export function setHp(id, cur, max) {
  user.run('UPDATE characters SET bv_ted=?, bv_max=?, updated_at=? WHERE id=?', [cur === null ? null : Math.max(0, cur), max === null ? null : Math.max(0, max), now(), id]);
}

/** Vlastnost ±1 (1–30). Na 1. úrovni změna Odolnosti přepočítá BV (kostka obnovy + oprava ODL). */
export function abilityDelta(id, col, delta) {
  if (!ABILITIES.some(([c]) => c === col)) throw new Error('Neplatná vlastnost.');
  const row = user.one(`SELECT ${col} AS v, uroven, bv_max, bv_ted, kostka_obnovy FROM characters WHERE id=?`, [id]);
  const next = Math.max(1, Math.min(30, (row.v ?? 10) + delta));
  user.tx(() => {
    user.run(`UPDATE characters SET ${col}=? WHERE id=?`, [next, id]);
    const sides = hitDieSides(row.kostka_obnovy);
    if (col === 'odolnost' && row.uroven === 1 && sides > 0) {
      const newMax = Math.max(0, sides + mod(next));
      const diff = newMax - Math.max(0, row.bv_max ?? 0);
      const newTed = Math.min(newMax, Math.max(0, (row.bv_ted ?? 0) + diff));
      user.run('UPDATE characters SET bv_max=?, bv_ted=? WHERE id=?', [newMax, newTed, id]);
    }
    touch(id);
  });
  return next;
}

// ---------------------------------------------------------------------------
// Zdatnosti

const STATE_COLS = {
  skill: ['zd_dovednosti', 'kv_dovednosti'],
  save: ['zd_zachranne_hody', 'kv_zachranne_hody'],
  passive: ['zd_pasivni_dovednosti', 'kv_pasivni_dovednosti'],
  tool: ['zd_pomucky', 'kv_pomucky'],
};

/** Stav položky v páru sloupců zd_ a kv_: 0 = nic, 1 = zdatnost, 2 = kvalifikace (zahrnuje i zdatnost). */
export function setProfState(id, kind, name, state) {
  const cols = STATE_COLS[kind];
  if (!cols) throw new Error('Neplatný druh.');
  const [zdCol, kvCol] = cols;
  const row = user.one(`SELECT ${zdCol} AS zd, ${kvCol} AS kv FROM characters WHERE id=?`, [id]);
  const zd = new Set(decodeList(row.zd));
  const kv = new Set(decodeList(row.kv));
  zd.delete(name);
  kv.delete(name);
  if (state >= 1) zd.add(name);
  if (state === 2) kv.add(name);
  user.run(`UPDATE characters SET ${zdCol}=?, ${kvCol}=?, updated_at=? WHERE id=?`, [JSON.stringify([...zd]), JSON.stringify([...kv]), now(), id]);
}

/** Výběr pomůcek (zdatnost); kvalifikace u odebraných pomůcek zaniká. */
export function setTools(id, list) {
  const keep = new Set(list);
  const kv = decodeList(user.value('SELECT kv_pomucky FROM characters WHERE id=?', [id])).filter((t) => keep.has(t));
  user.run('UPDATE characters SET zd_pomucky=?, kv_pomucky=?, updated_at=? WHERE id=?', [JSON.stringify([...keep]), JSON.stringify(kv), now(), id]);
}

export function setWeapons(id, list) {
  const w = getCharacter(id).zd_zbrane;
  w.vyber = [...new Set(list)];
  user.run('UPDATE characters SET zd_zbrane=?, updated_at=? WHERE id=?', [JSON.stringify(w), now(), id]);
}

export function setWeaponGroup(id, key, on) {
  if (!['jednoduche', 'valecne'].includes(key)) throw new Error('Neplatná skupina.');
  const w = getCharacter(id).zd_zbrane;
  w[key] = on ? 1 : 0;
  user.run('UPDATE characters SET zd_zbrane=?, updated_at=? WHERE id=?', [JSON.stringify(w), now(), id]);
}

export function setArmorProf(id, key, on) {
  if (key === 'stity') {
    user.run('UPDATE characters SET zd_stity=?, updated_at=? WHERE id=?', [on ? 1 : 0, now(), id]);
    return;
  }
  if (!['lehke', 'stredni', 'tezke'].includes(key)) throw new Error('Neplatný typ zbroje.');
  const a = getCharacter(id).zd_zbroje;
  a[key] = on ? 1 : 0;
  user.run('UPDATE characters SET zd_zbroje=?, updated_at=? WHERE id=?', [JSON.stringify(a), now(), id]);
}

// ---------------------------------------------------------------------------
// Měšec

/** Příjem/výdaj s přepočtem (1 Zl = 10 St = 100 Md). Při nedostatku peněz vyhodí chybu. */
export function walletAdjust(id, zl, st, md) {
  const r = user.one('SELECT mesec_zl AS zl, mesec_st AS st, mesec_md AS md FROM characters WHERE id=?', [id]);
  const next = r.zl * 100 + r.st * 10 + r.md + (zl * 100 + st * 10 + md);
  if (next < 0) throw new Error('V měšci není dost peněz.');
  const out = { zl: Math.floor(next / 100), st: Math.floor((next % 100) / 10), md: next % 10 };
  user.run('UPDATE characters SET mesec_zl=?, mesec_st=?, mesec_md=?, updated_at=? WHERE id=?', [out.zl, out.st, out.md, now(), id]);
  return out;
}

// ---------------------------------------------------------------------------
// Inventář

/** Předměty postavy spojené s daty z katalogu. */
export function listItems(id) {
  const cat = catalog().itemById;
  return user
    .all('SELECT * FROM character_items WHERE character_id=?', [id])
    .map((r) => ({ ...(cat.get(r.item_id) ?? { jmeno: 'Neznámý předmět #' + r.item_id }), ...r, row_id: r.id }))
    .sort((a, b) => b.equipped - a.equipped || String(a.jmeno).localeCompare(String(b.jmeno), 'cs'));
}

/** Přidá předmět; pokud už ho postava má, navýší množství. */
export function addItem(id, itemId, qty, note) {
  if (!catalog().itemById.has(itemId)) throw new Error('Předmět nebyl nalezen.');
  qty = Math.max(1, qty | 0);
  note = String(note ?? '').trim().slice(0, 500);
  const ex = user.one('SELECT id, mnozstvi FROM character_items WHERE character_id=? AND item_id=?', [id, itemId]);
  if (ex) {
    user.run('UPDATE character_items SET mnozstvi=?' + (note ? ', poznamka=?' : '') + ' WHERE id=?', note ? [ex.mnozstvi + qty, note, ex.id] : [ex.mnozstvi + qty, ex.id]);
  } else {
    user.run('INSERT INTO character_items (character_id, item_id, mnozstvi, poznamka) VALUES (?,?,?,?)', [id, itemId, qty, note]);
  }
  touch(id);
}

/** Změna množství; při 0 se předmět odhodí. Vrací nové množství (0 = smazán). */
export function itemQtyDelta(id, rowId, delta) {
  const r = user.one('SELECT mnozstvi FROM character_items WHERE id=? AND character_id=?', [rowId, id]);
  if (!r) return 0;
  const next = r.mnozstvi + delta;
  if (next <= 0) user.run('DELETE FROM character_items WHERE id=?', [rowId]);
  else user.run('UPDATE character_items SET mnozstvi=? WHERE id=?', [next, rowId]);
  touch(id);
  return Math.max(0, next);
}

/**
 * Vybavení předmětu. Zbroj a štít smí být vybaveny jen jednou (ostatní se odloží);
 * zbroj s požadavkem na Sílu nejde obléct se slabší postavou.
 */
export function setItemEquipped(id, rowId, on) {
  const row = user.one('SELECT item_id FROM character_items WHERE id=? AND character_id=?', [rowId, id]);
  if (!row) return;
  const it = catalog().itemById.get(row.item_id);
  if (on && it) {
    const req = exclusiveSlot(it) === 'armor' ? strengthRequirement(it) : 0;
    const str = user.value('SELECT sila FROM characters WHERE id=?', [id]) ?? 0;
    if (req > 0 && str < req) throw new Error(`Na tuhle zbroj je potřeba Síla ${req} (postava má ${str}).`);
  }
  user.tx(() => {
    user.run('UPDATE character_items SET equipped=? WHERE id=?', [on ? 1 : 0, rowId]);
    const slot = on && it ? exclusiveSlot(it) : null;
    if (slot) {
      for (const other of user.all('SELECT id, item_id FROM character_items WHERE character_id=? AND id<>? AND equipped=1', [id, rowId])) {
        if (exclusiveSlot(catalog().itemById.get(other.item_id)) === slot) user.run('UPDATE character_items SET equipped=0 WHERE id=?', [other.id]);
      }
    }
    touch(id);
  });
}

export function setItemNote(id, rowId, note) {
  user.run('UPDATE character_items SET poznamka=? WHERE id=? AND character_id=?', [String(note).slice(0, 500), rowId, id]);
}

// ---------------------------------------------------------------------------
// Kouzla

export function listSpells(id) {
  const cat = catalog().spellById;
  return user
    .all('SELECT spell_id, prepared FROM character_spells WHERE character_id=?', [id])
    .map((r) => ({ ...cat.get(r.spell_id), prepared: r.prepared, spell_id: r.spell_id }))
    .filter((s) => s.name)
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name, 'cs'));
}

export function addSpells(id, spellIds) {
  let n = 0;
  user.tx(() => {
    for (const sid of spellIds) {
      if (!catalog().spellById.has(sid)) continue;
      if (user.value('SELECT 1 FROM character_spells WHERE character_id=? AND spell_id=?', [id, sid])) continue;
      user.run('INSERT INTO character_spells (character_id, spell_id, prepared) VALUES (?,?,0)', [id, sid]);
      n++;
    }
    touch(id);
  });
  return n;
}

export function removeSpell(id, spellId) {
  user.run('DELETE FROM character_spells WHERE character_id=? AND spell_id=?', [id, spellId]);
}

export function setSpellPrepared(id, spellId, on) {
  user.run('UPDATE character_spells SET prepared=? WHERE character_id=? AND spell_id=?', [on ? 1 : 0, id, spellId]);
}

/** Použití pozice kouzla (stupeň + pozice). */
export function setSpellSlotUsed(id, level, pos, used) {
  const ch = getCharacter(id);
  const set = new Set((ch.pouzita_kouzla[level] ?? []).map(String));
  if (used) set.add(String(pos));
  else set.delete(String(pos));
  ch.pouzita_kouzla[level] = [...set];
  user.run('UPDATE characters SET pouzita_kouzla=?, updated_at=? WHERE id=?', [JSON.stringify(ch.pouzita_kouzla), now(), id]);
}

export function setChestUsed(id, pos, used) {
  const set = new Set(getCharacter(id).pouzita_truhla);
  if (used) set.add(String(pos));
  else set.delete(String(pos));
  user.run('UPDATE characters SET pouzita_truhla=?, updated_at=? WHERE id=?', [JSON.stringify([...set]), now(), id]);
}

/** Odpočinek: všechny pozice kouzel i truhly znovu volné. */
export function resetSlots(id) {
  user.run("UPDATE characters SET pouzita_kouzla='{}', pouzita_truhla='[]', updated_at=? WHERE id=?", [now(), id]);
}

// ---------------------------------------------------------------------------
// Nová úroveň

export function levelUp(id, { hpGain, profBonus, spellSlots, chestSlots }) {
  hpGain = parseInt(hpGain, 10);
  profBonus = parseInt(profBonus, 10);
  if (!(hpGain >= 0 && hpGain <= 999)) throw new Error('Neplatný přírůstek BV.');
  if (!(profBonus >= 0 && profBonus <= 99)) throw new Error('Neplatný zdatnostní bonus.');
  const r = user.one('SELECT uroven, bv_max, bv_ted FROM characters WHERE id=?', [id]);
  const out = {
    uroven: Math.max(1, r.uroven + 1),
    bv_max: Math.max(0, (r.bv_max ?? 0) + hpGain),
    bv_ted: Math.max(0, (r.bv_ted ?? 0) + hpGain),
  };
  user.run(
    'UPDATE characters SET uroven=?, bv_max=?, bv_ted=?, zdatnostni_bonus=?, pripravena_kouzla=?, dostupna_truhla=?, updated_at=? WHERE id=?',
    [out.uroven, out.bv_max, out.bv_ted, profBonus, JSON.stringify(normalizeSlots(spellSlots)), JSON.stringify(normalizeChest(chestSlots)), now(), id]
  );
  return out;
}
