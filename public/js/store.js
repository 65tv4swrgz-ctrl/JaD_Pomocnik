// Operace nad uživatelskou DB: družiny a střetnutí. Přepis EncounterRepository / PartyRepository.

import { user } from './db.js';
import { catalog, normalizeCrKey } from './catalog.js';
import { d20 } from './util.js';
import { bossHpMultiplier, clampLevel, evaluate, generateLoot, lootMinRarity } from './rules.js';

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const touch = (eid) => user.run('UPDATE encounters SET updated_at=? WHERE id=?', [now(), eid]);

export const isPc = (inst) => inst.monster_id === null || inst.monster_id === undefined;
export const isSimple = (inst) => inst.monster_id === -1;

// ===========================================================================
// Družiny

export function listParties() {
  const parties = user.all('SELECT * FROM parties ORDER BY name COLLATE NOCASE');
  const members = user.all('SELECT * FROM party_members ORDER BY sort_order, id');
  for (const p of parties) p.members = members.filter((m) => m.party_id === p.id);
  return parties;
}

export function getParty(id) {
  const p = user.one('SELECT * FROM parties WHERE id=?', [id]);
  if (!p) return null;
  p.members = user.all('SELECT * FROM party_members WHERE party_id=? ORDER BY sort_order, id', [id]);
  return p;
}

export function createParty(name) {
  return user.insert('INSERT INTO parties (name) VALUES (?)', [name.trim() || 'Družina']);
}

export function renameParty(id, name) {
  user.run('UPDATE parties SET name=? WHERE id=?', [name.trim() || 'Družina', id]);
}

export function deleteParty(id) {
  user.tx(() => {
    user.run('DELETE FROM party_members WHERE party_id=?', [id]);
    user.run('DELETE FROM parties WHERE id=?', [id]);
  });
}

export function addMember(partyId, { name, level, bv_max }) {
  const ord = (user.value('SELECT MAX(sort_order) FROM party_members WHERE party_id=?', [partyId]) ?? 0) + 1;
  const max = bv_max ?? null;
  return user.insert('INSERT INTO party_members (party_id, name, level, bv_ted, bv_max, sort_order) VALUES (?,?,?,?,?,?)', [
    partyId,
    name.trim(),
    clampLevel(level),
    max,
    max,
    ord,
  ]);
}

export function updateMember(id, fields) {
  const allowed = ['name', 'level', 'bv_ted', 'bv_max'];
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    user.run(`UPDATE party_members SET ${k}=? WHERE id=?`, [k === 'level' ? clampLevel(v) : v, id]);
  }
}

export function deleteMember(id) {
  user.run('DELETE FROM party_members WHERE id=?', [id]);
}

/** Dlouhý odpočinek: všem členům BV na maximum. */
export function restParty(partyId) {
  user.run('UPDATE party_members SET bv_ted=bv_max WHERE party_id=? AND bv_max IS NOT NULL', [partyId]);
}

// ===========================================================================
// Střetnutí – základ

export function listEncounters() {
  return user.all(
    `SELECT e.*,
            (SELECT COUNT(*) FROM encounter_instances i WHERE i.encounter_id=e.id AND i.monster_id IS NOT NULL) AS enemy_count,
            (SELECT COUNT(*) FROM encounter_instances i WHERE i.encounter_id=e.id AND i.monster_id IS NULL) AS pc_count
       FROM encounters e
      ORDER BY CASE e.phase WHEN 'playing' THEN 0 WHEN 'prepared' THEN 1 ELSE 2 END, e.updated_at DESC, e.id DESC`
  );
}

export function getEncounter(id) {
  return user.one('SELECT * FROM encounters WHERE id=?', [id]);
}

export function setEncounterField(id, field, value) {
  if (!['name', 'note', 'phase'].includes(field)) throw new Error('Neplatné pole.');
  user.run(`UPDATE encounters SET ${field}=?, updated_at=? WHERE id=?`, [value, now(), id]);
}

export function deleteEncounter(id) {
  user.tx(() => {
    for (const t of ['encounter_effects', 'encounter_loot', 'encounter_instances']) {
      user.run(`DELETE FROM ${t} WHERE encounter_id=?`, [id]);
    }
    user.run('DELETE FROM encounters WHERE id=?', [id]);
  });
}

function makeEnemyInstances(eid, monster, qty, { asBoss, difficulty, startNo }) {
  const baseName = (monster.jmeno ?? '').trim() || 'Protivník #' + monster.id;
  const cr = normalizeCrKey(monster.nebezpecnost);
  const baseHp = Math.max(0, parseInt(monster.vydrz, 10) || 0);
  for (let i = 0; i < qty; i++) {
    const no = startNo + i;
    const boss = asBoss && i === 0 ? 1 : 0;
    let hpMax = baseHp > 0 ? baseHp : null;
    if (hpMax !== null && boss) hpMax = Math.round(hpMax * bossHpMultiplier(cr, difficulty));
    user.run(
      'INSERT INTO encounter_instances (encounter_id, monster_id, instance_no, name_override, is_boss, hp_current, hp_max) VALUES (?,?,?,?,?,?,?)',
      [eid, monster.id, no, `${baseName} #${no}`, boss, hpMax, hpMax]
    );
  }
}

function nextInstanceNo(eid, monsterId) {
  return (user.value('SELECT MAX(instance_no) FROM encounter_instances WHERE encounter_id=? AND monster_id=?', [eid, monsterId]) ?? 0) + 1;
}

/**
 * Vytvoří střetnutí (jako generate.php + EncounterRepository::create).
 * picks: [{ monster, qty, boss }]
 */
export function createEncounter({ partyId, name, picks, lootMode, baseItemsOnly }) {
  const party = getParty(partyId);
  if (!party) throw new Error('Vyber družinu.');
  if (!party.members.length) throw new Error('Družina nemá žádné členy.');
  if (!name.trim()) throw new Error('Název střetnutí je povinný.');
  if (!lootMode) throw new Error('Vyber režim lootu.');
  picks = picks.filter((p) => p.qty > 0);
  if (!picks.length) throw new Error('Nejdřív vyber alespoň jednoho protivníka.');

  const levels = party.members.map((m) => clampLevel(m.level));
  const ev = evaluate(picks, levels);

  return user.tx(() => {
    const eid = user.insert(
      `INSERT INTO encounters (party_id, party_name, name, difficulty, strength, base_xp, multiplier, adjusted_xp, loot_mode, base_items_only, phase)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'prepared')`,
      [party.id, party.name, name.trim(), ev.difficulty, ev.strengthTotal, ev.baseXp, ev.mult, ev.adjustedXp, lootMode, baseItemsOnly ? 1 : 0]
    );

    for (const p of picks) {
      makeEnemyInstances(eid, p.monster, p.qty, { asBoss: !!p.boss, difficulty: ev.difficulty, startNo: 1 });
    }

    party.members.forEach((m, i) => {
      user.run(
        'INSERT INTO encounter_instances (encounter_id, monster_id, party_member_id, level, instance_no, name_override, hp_current, hp_max) VALUES (?,NULL,?,?,?,?,?,?)',
        [eid, m.id, clampLevel(m.level), i + 1, m.name, m.bv_ted ?? m.bv_max ?? null, m.bv_max ?? null]
      );
    });

    // Loot se generuje hned při vytvoření (stejně jako na webu).
    generateLootIfEmpty(eid);
    return eid;
  });
}

// ===========================================================================
// Instance (účastníci)

const PLAY_ORDER = `ORDER BY is_defeated ASC, (initiative IS NULL) ASC, initiative DESC, id ASC`;
const TURN_ORDER = `ORDER BY (initiative IS NULL) ASC, initiative DESC, id ASC`;

export function listInstances(eid) {
  return user.all(`SELECT * FROM encounter_instances WHERE encounter_id=? ${PLAY_ORDER}`, [eid]);
}

export function getInstance(eid, iid) {
  return user.one('SELECT * FROM encounter_instances WHERE encounter_id=? AND id=?', [eid, iid]);
}

/** Popisek účastníka (jméno, případně „Monstrum #n“). */
export function instanceLabel(inst) {
  const lbl = (inst.name_override ?? '').trim();
  if (lbl) return lbl;
  if (isPc(inst)) return 'PC #' + inst.instance_no;
  const m = catalog().monsterById.get(inst.monster_id);
  return (m ? m.jmeno : 'Protivník') + ' #' + inst.instance_no;
}

export function addEnemyInstances(eid, monsterId, qty, asBoss) {
  const monster = catalog().monsterById.get(monsterId);
  if (!monster) throw new Error('Protivník nenalezen.');
  const enc = getEncounter(eid);
  qty = Math.max(1, Math.min(50, qty | 0));
  user.tx(() => {
    makeEnemyInstances(eid, monster, qty, { asBoss, difficulty: enc?.difficulty ?? 'medium', startNo: nextInstanceNo(eid, monsterId) });
    touch(eid);
  });
}

export function renameInstance(eid, iid, name) {
  user.run('UPDATE encounter_instances SET name_override=? WHERE encounter_id=? AND id=?', [name.trim().slice(0, 200), eid, iid]);
}

export function deleteInstance(eid, iid) {
  user.tx(() => {
    user.run('DELETE FROM encounter_effects WHERE encounter_id=? AND instance_id=?', [eid, iid]);
    user.run('DELETE FROM encounter_instances WHERE encounter_id=? AND id=?', [eid, iid]);
    const enc = getEncounter(eid);
    if (enc && enc.active_instance_id === iid) user.run('UPDATE encounters SET active_instance_id=NULL WHERE id=?', [eid]);
    touch(eid);
  });
}

/** Přidání protivníka z bestiáře do běžícího boje (s hodem na iniciativu, bez bosse). */
export function spawnMonster(eid, monsterId, qty) {
  const m = catalog().monsterById.get(monsterId);
  if (!m) throw new Error('Protivník nenalezen.');
  qty = Math.max(1, Math.min(20, qty | 0));
  const hp = (parseInt(m.vydrz, 10) || 0) > 0 ? parseInt(m.vydrz, 10) : null;
  const added = [];
  user.tx(() => {
    let no = nextInstanceNo(eid, monsterId) - 1;
    for (let i = 0; i < qty; i++) {
      no++;
      const label = `${m.jmeno} #${no}`;
      const init = d20();
      const id = user.insert(
        'INSERT INTO encounter_instances (encounter_id, monster_id, instance_no, name_override, hp_current, hp_max, initiative) VALUES (?,?,?,?,?,?,?)',
        [eid, monsterId, no, label, hp, hp, init]
      );
      added.push({ id, label, initiative: init });
    }
    touch(eid);
  });
  return added;
}

/** Zjednodušený protivník (jméno, BV, OČ, útok). */
export function spawnSimple(eid, { name, hp, ac, attack }) {
  if (!name.trim()) throw new Error('Zadej jméno.');
  const no = nextInstanceNo(eid, -1);
  let label = name.trim();
  if (!label.includes('#')) label += ' #' + no;
  const init = d20();
  const id = user.insert(
    'INSERT INTO encounter_instances (encounter_id, monster_id, instance_no, name_override, hp_current, hp_max, simple_ac, simple_attack, initiative) VALUES (?,-1,?,?,?,?,?,?,?)',
    [eid, no, label, hp ?? null, hp ?? null, ac ?? null, (attack ?? '').trim(), init]
  );
  touch(eid);
  return { id, label, initiative: init };
}

// ===========================================================================
// Hraní

/** Přenese BV z družiny do PC účastníků (jako syncCharactersBvToPcInstances). */
export function syncPcHpFromParty(eid) {
  const rows = user.all(
    `SELECT i.id, i.hp_current, i.hp_max, m.bv_ted, m.bv_max
       FROM encounter_instances i JOIN party_members m ON m.id = i.party_member_id
      WHERE i.encounter_id=? AND i.monster_id IS NULL`,
    [eid]
  );
  for (const r of rows) {
    if (r.bv_ted === null && r.bv_max === null) continue;
    if (r.bv_ted !== r.hp_current || r.bv_max !== r.hp_max) {
      user.run('UPDATE encounter_instances SET hp_current=?, hp_max=? WHERE id=?', [r.bv_ted, r.bv_max, r.id]);
    }
  }
}

/** Zahájení boje: připravené → probíhá, hod iniciativy protivníkům, kolo 1. */
export function startEncounter(eid) {
  const enc = getEncounter(eid);
  if (!enc || enc.phase !== 'prepared') return;
  user.tx(() => {
    user.run('UPDATE encounter_instances SET initiative=NULL WHERE encounter_id=? AND monster_id IS NULL', [eid]);
    for (const r of user.all('SELECT id FROM encounter_instances WHERE encounter_id=? AND monster_id IS NOT NULL', [eid])) {
      user.run('UPDATE encounter_instances SET initiative=? WHERE id=?', [d20(), r.id]);
    }
    user.run(
      "UPDATE encounters SET phase='playing', round_no=1, active_instance_id=NULL, pc_init_done=0, pc_tie_pending=NULL, updated_at=? WHERE id=?",
      [now(), eid]
    );
    syncPcHpFromParty(eid);
    if (!user.value('SELECT COUNT(*) FROM encounter_instances WHERE encounter_id=? AND monster_id IS NULL', [eid])) {
      recomputeActive(eid);
    }
  });
}

function topLivingId(eid) {
  return user.value(`SELECT id FROM encounter_instances WHERE encounter_id=? AND is_defeated=0 ${TURN_ORDER} LIMIT 1`, [eid]);
}

export function recomputeActive(eid) {
  user.run('UPDATE encounters SET active_instance_id=? WHERE id=?', [topLivingId(eid) ?? null, eid]);
}

export function setActive(eid, iid) {
  user.run('UPDATE encounters SET active_instance_id=? WHERE id=?', [iid ?? null, eid]);
}

/** Pokud chybí aktivní účastník (a není co doplňovat), nastaví prvního podle iniciativy. */
export function ensureActive(eid) {
  const enc = getEncounter(eid);
  if (!enc || enc.phase !== 'playing' || enc.active_instance_id) return;
  if (enc.pc_tie_pending) return;
  recomputeActive(eid);
}

export function rollInitiativeOne(eid, iid) {
  const v = d20();
  user.run('UPDATE encounter_instances SET initiative=? WHERE encounter_id=? AND id=?', [v, eid, iid]);
  return v;
}

export function setInitiative(eid, iid, value) {
  const v = parseInt(value, 10);
  user.run('UPDATE encounter_instances SET initiative=? WHERE encounter_id=? AND id=?', [Number.isFinite(v) ? v : null, eid, iid]);
}

export function rollInitiativeAll(eid, includePcs) {
  user.tx(() => {
    const rows = user.all(
      `SELECT id FROM encounter_instances WHERE encounter_id=? ${includePcs ? '' : 'AND monster_id IS NOT NULL'}`,
      [eid]
    );
    for (const r of rows) user.run('UPDATE encounter_instances SET initiative=? WHERE id=?', [d20(), r.id]);
    recomputeActive(eid);
  });
}

export function initiativeDuplicates(eid) {
  const rows = user.all(
    'SELECT id, monster_id, initiative FROM encounter_instances WHERE encounter_id=? AND is_defeated=0 AND initiative > 0',
    [eid]
  );
  const by = {};
  for (const r of rows) (by[r.initiative] ||= []).push(r);
  return Object.values(by).filter((l) => l.length > 1);
}

/** Shody iniciativ: protivníkům se přehodí, u postav vrátí ID k novému zadání. */
export function resolveInitiativeTies(eid) {
  for (let i = 0; i < 30; i++) {
    const dups = initiativeDuplicates(eid);
    if (!dups.length) return [];
    const pcNeed = new Set();
    const reroll = new Set();
    for (const list of dups) for (const r of list) (r.monster_id === null ? pcNeed : reroll).add(r.id);
    for (const iid of reroll) rollInitiativeOne(eid, iid);
    if (pcNeed.size) return [...pcNeed];
  }
  return [];
}

/**
 * Uloží iniciativy postav (map: instanceId -> hodnota) a vyřeší shody.
 * Vrací seznam ID postav, které musí zadat novou iniciativu (prázdný = hotovo).
 */
export function setPcInitiatives(eid, map) {
  return user.tx(() => {
    for (const [iid, val] of Object.entries(map)) {
      const v = parseInt(val, 10);
      user.run('UPDATE encounter_instances SET initiative=? WHERE encounter_id=? AND id=? AND monster_id IS NULL', [
        v > 0 ? v : null,
        eid,
        Number(iid),
      ]);
    }
    const pending = resolveInitiativeTies(eid);
    if (pending.length) {
      user.run('UPDATE encounters SET pc_init_done=1, pc_tie_pending=?, active_instance_id=NULL WHERE id=?', [JSON.stringify(pending), eid]);
    } else {
      user.run('UPDATE encounters SET pc_init_done=1, pc_tie_pending=NULL WHERE id=?', [eid]);
      recomputeActive(eid);
    }
    return pending;
  });
}

/** Zapíše BV účastníka; u postavy i zpět do družiny. HP 0 = vyřazen. */
export function setHp(eid, iid, cur, max = undefined) {
  const inst = getInstance(eid, iid);
  if (!inst) return null;
  const hpCur = cur === null ? null : Math.max(0, cur | 0);
  const hpMax = max === undefined ? inst.hp_max : max === null ? null : Math.max(0, max | 0);
  const defeated = hpCur !== null && hpCur <= 0 ? 1 : inst.is_defeated;
  user.run('UPDATE encounter_instances SET hp_current=?, hp_max=?, is_defeated=? WHERE id=?', [hpCur, hpMax, defeated, iid]);
  if (isPc(inst) && inst.party_member_id) {
    user.run('UPDATE party_members SET bv_ted=?, bv_max=? WHERE id=?', [hpCur, hpMax, inst.party_member_id]);
  }
  return { hp_current: hpCur, hp_max: hpMax, is_defeated: defeated };
}

export function setDefeated(eid, iid, defeated) {
  user.run('UPDATE encounter_instances SET is_defeated=? WHERE encounter_id=? AND id=?', [defeated ? 1 : 0, eid, iid]);
}

/** Oživení: 1 BV, zpět do boje. */
export function revive(eid, iid) {
  setHp(eid, iid, 1);
  setDefeated(eid, iid, false);
}

export function setInstanceNote(eid, iid, note) {
  user.run('UPDATE encounter_instances SET notes=? WHERE encounter_id=? AND id=?', [note.slice(0, 120), eid, iid]);
}

/** Reset: iniciativy pryč, BV na maximum, nikdo vyřazen (jako EncounterRepository::resetInstances). */
export function resetInstances(eid) {
  user.tx(() => {
    user.run('UPDATE encounter_instances SET initiative=NULL, hp_current=hp_max, is_defeated=0 WHERE encounter_id=?', [eid]);
    user.run(
      'UPDATE party_members SET bv_ted=bv_max WHERE id IN (SELECT party_member_id FROM encounter_instances WHERE encounter_id=? AND party_member_id IS NOT NULL) AND bv_max IS NOT NULL',
      [eid]
    );
    user.run('UPDATE encounters SET pc_init_done=0, pc_tie_pending=NULL, active_instance_id=NULL, round_no=1 WHERE id=?', [eid]);
  });
}

// ---- Efekty (stavy)

export function listEffects(eid) {
  return user.all('SELECT * FROM encounter_effects WHERE encounter_id=? ORDER BY id', [eid]);
}

export function addEffect(eid, iid, name, duration, notes) {
  if (!name.trim()) throw new Error('Zadej název stavu.');
  if (!iid) throw new Error('Vyber účastníka.');
  user.insert('INSERT INTO encounter_effects (encounter_id, instance_id, name, duration_rounds, notes, is_active) VALUES (?,?,?,?,?,1)', [
    eid,
    iid,
    name.trim(),
    duration ?? null,
    (notes ?? '').trim(),
  ]);
}

export function toggleEffect(eid, effId) {
  user.run('UPDATE encounter_effects SET is_active = 1 - is_active WHERE encounter_id=? AND id=?', [eid, effId]);
}

export function deleteEffect(eid, effId) {
  user.run('DELETE FROM encounter_effects WHERE encounter_id=? AND id=?', [eid, effId]);
}

/** Konec tahu účastníka: aktivním časovaným efektům ubere 1, s 0 je smaže. */
function tickEffects(eid, iid) {
  const rows = user.all(
    'SELECT id, duration_rounds FROM encounter_effects WHERE encounter_id=? AND instance_id=? AND is_active=1 AND duration_rounds IS NOT NULL',
    [eid, iid]
  );
  for (const r of rows) {
    const d = r.duration_rounds - 1;
    if (d <= 0) user.run('DELETE FROM encounter_effects WHERE id=?', [r.id]);
    else user.run('UPDATE encounter_effects SET duration_rounds=? WHERE id=?', [d, r.id]);
  }
}

/** Další tah (EncounterRepository::advanceTurn + tick efektů). */
export function nextTurn(eid) {
  return user.tx(() => {
    const enc = getEncounter(eid);
    const activeId = enc.active_instance_id || 0;
    if (activeId) tickEffects(eid, activeId);

    const ids = user.all(`SELECT id FROM encounter_instances WHERE encounter_id=? AND is_defeated=0 ${TURN_ORDER}`, [eid]).map((r) => r.id);
    if (!ids.length) return { round_no: enc.round_no, active_instance_id: null };

    let nextId = ids[0];
    let wrapped = false;
    if (activeId) {
      const pos = ids.indexOf(activeId);
      if (pos >= 0 && pos + 1 < ids.length) nextId = ids[pos + 1];
      else if (pos >= 0) wrapped = true;
      else {
        // Aktivní mezitím vypadl (vyřazen) – pokračuje první s nižší iniciativou.
        const act = getInstance(eid, activeId);
        const after = act
          ? user.value(
              `SELECT id FROM encounter_instances WHERE encounter_id=? AND is_defeated=0 AND (initiative < ? OR (initiative = ? AND id > ?)) ${TURN_ORDER} LIMIT 1`,
              [eid, act.initiative ?? -999, act.initiative ?? -999, act.id]
            )
          : null;
        if (after) nextId = after;
        else wrapped = true;
      }
    }
    const round = wrapped ? enc.round_no + 1 : enc.round_no;
    user.run('UPDATE encounters SET round_no=?, active_instance_id=?, updated_at=? WHERE id=?', [round, nextId, now(), eid]);
    return { round_no: round, active_instance_id: nextId, wrapped };
  });
}

export function endCombat(eid) {
  user.run("UPDATE encounters SET phase='ended', active_instance_id=NULL, updated_at=? WHERE id=?", [now(), eid]);
}

export function reopenCombat(eid) {
  user.run("UPDATE encounters SET phase='playing', updated_at=? WHERE id=?", [now(), eid]);
  ensureActive(eid);
}

// ===========================================================================
// Loot

export function listLoot(eid) {
  return user.all('SELECT * FROM encounter_loot WHERE encounter_id=? ORDER BY id', [eid]);
}

function maxPcLevel(eid) {
  return clampLevel(user.value('SELECT MAX(level) FROM encounter_instances WHERE encounter_id=? AND monster_id IS NULL', [eid]) ?? 1);
}

/** Vygeneruje loot, pokud střetnutí žádný nemá. Vrací počet vytvořených položek. */
export function generateLootIfEmpty(eid) {
  const enc = getEncounter(eid);
  if (!enc || enc.loot_mode === 'none') return 0;
  if (user.value('SELECT COUNT(*) FROM encounter_loot WHERE encounter_id=?', [eid])) return 0;
  const opponents = user.all('SELECT is_boss FROM encounter_instances WHERE encounter_id=? AND monster_id IS NOT NULL', [eid]);
  const items = generateLoot({
    opponents,
    maxLevel: maxPcLevel(eid),
    mode: enc.loot_mode,
    baseItemsOnly: !!enc.base_items_only,
  });
  for (const it of items) {
    user.run('INSERT INTO encounter_loot (encounter_id, item_id, name, note, rarity, category, source) VALUES (?,?,?,?,?,?,?)', [
      eid,
      it.item_id,
      it.name,
      '',
      it.rarity,
      it.category,
      it.source,
    ]);
  }
  return items.length;
}

export function addLootItem(eid, itemId, note = '', source = 'manual') {
  const it = catalog().itemById.get(itemId);
  if (!it) throw new Error('Předmět nebyl nalezen.');
  user.insert('INSERT INTO encounter_loot (encounter_id, item_id, name, note, rarity, category, source) VALUES (?,?,?,?,?,?,?)', [
    eid,
    itemId,
    it.jmeno,
    note.slice(0, 255),
    lootMinRarity(it.vzacnost),
    (it.kategorie ?? '').trim(),
    source,
  ]);
}

export function addLootCustom(eid, { name, rarity, category, note }) {
  if (!name.trim()) throw new Error('Zadej název předmětu.');
  user.insert("INSERT INTO encounter_loot (encounter_id, item_id, name, note, rarity, category, source) VALUES (?,NULL,?,?,?,?,'manual')", [
    eid,
    name.trim().slice(0, 255),
    (note ?? '').slice(0, 255),
    rarity ?? '',
    (category ?? '').trim(),
  ]);
}

const idList = (ids) => ids.map((x) => Number(x)).filter((x) => x > 0);

export function deleteLoot(eid, ids) {
  const list = idList(ids);
  if (!list.length) return;
  user.run(`DELETE FROM encounter_loot WHERE encounter_id=? AND id IN (${list.map(() => '?').join(',')})`, [eid, ...list]);
}

export function setLootNote(eid, ids, note) {
  const list = idList(ids);
  if (!list.length) return;
  user.run(`UPDATE encounter_loot SET note=? WHERE encounter_id=? AND id IN (${list.map(() => '?').join(',')})`, [note.slice(0, 255), eid, ...list]);
}

/** Předání předmětu postavě (offline: jen se zapíše komu). */
export function giveLoot(eid, ids, toName) {
  const list = idList(ids);
  if (!list.length || !toName) return;
  user.run(`UPDATE encounter_loot SET given_to=? WHERE encounter_id=? AND id IN (${list.map(() => '?').join(',')})`, [toName, eid, ...list]);
}

export function ungiveLoot(eid, ids) {
  const list = idList(ids);
  if (!list.length) return;
  user.run(`UPDATE encounter_loot SET given_to=NULL WHERE encounter_id=? AND id IN (${list.map(() => '?').join(',')})`, [eid, ...list]);
}

/** Seskupení stejných položek (předmět + poznámka + komu) jako na webu. */
export function groupLoot(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = [r.item_id ?? 0, r.name, r.rarity, r.category, r.note, r.given_to ?? ''].join('\u0001');
    if (!map.has(key)) map.set(key, { ...r, ids: [], qty: 0 });
    const g = map.get(key);
    g.ids.push(r.id);
    g.qty++;
  }
  return [...map.values()];
}
