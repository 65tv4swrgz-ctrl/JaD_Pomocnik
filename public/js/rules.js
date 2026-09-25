// Pravidla střetnutí – přepis App\EncounterService a generátoru lootu z EncounterRepository (PHP).

import { catalog, normalizeCrKey, crToFloat } from './catalog.js';
import { norm, randInt } from './util.js';

export const BOSS_XP_FACTOR = 1.3;
export const BOSS_STRENGTH_FACTOR = 1.25;

export const DIFF_LABEL = { easy: 'Lehké', medium: 'Střední', hard: 'Těžké', deadly: 'Smrtící' };
export const LOOT_LABEL = { none: 'Bez lootu', frugal: 'Střídmý', balanced: 'Vyvážený', rich: 'Bohatý' };
export const PHASE_LABEL = { prepared: 'Připravené', playing: 'Probíhá', ended: 'Ukončené' };

const XP_BY_CR = {
  0: 10, '1/8': 25, '1/4': 50, '1/2': 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900,
  8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000,
  18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000,
  27: 105000, 28: 120000, 29: 135000, 30: 155000,
};

export function crToXp(cr) {
  const k = normalizeCrKey(cr);
  return k === '' ? 0 : XP_BY_CR[k] ?? 0;
}

const isCr0 = (cr) => cr === '0' || cr === '0.0';

export function encounterMultiplier(monsterCount, partySize) {
  const bands = [
    [1, 1.0],
    [2, 1.5],
    [6, 2.0],
    [10, 2.5],
    [14, 3.0],
    [Number.MAX_SAFE_INTEGER, 4.0],
  ];
  let idx = 0;
  for (let i = 0; i < bands.length; i++) {
    if (monsterCount <= bands[i][0]) {
      idx = i;
      break;
    }
  }
  if (partySize <= 2) idx = Math.min(idx + 1, bands.length - 1);
  if (partySize >= 6) idx = Math.max(idx - 1, 0);
  return bands[idx][1];
}

export function clampLevel(l) {
  return Math.max(1, Math.min(20, parseInt(l, 10) || 1));
}

/** JaD úroveň družiny = zaokrouhlený průměr úrovní. */
export function partyLevel(levels) {
  if (!levels.length) return 1;
  const avg = levels.reduce((s, l) => s + (parseInt(l, 10) || 0), 0) / levels.length;
  return clampLevel(Math.round(avg));
}

export function strengthMapForLevel(level) {
  return catalog().strength[clampLevel(level)] ?? {};
}

/**
 * Vyhodnocení síly střetnutí.
 * picks: [{ monster, qty, boss }] (boss = první kus daného protivníka je boss)
 * levels: úrovně postav
 */
export function evaluate(picks, levels) {
  const partySize = levels.length;
  const pl = partyLevel(levels);
  const map = strengthMapForLevel(pl);

  let baseXp = 0;
  let monsterCount = 0;
  let strengthTotal = 0;
  const missing = [];

  for (const p of picks) {
    const qty = p.qty | 0;
    if (qty <= 0) continue;
    const cr = normalizeCrKey(p.monster.nebezpecnost);
    if (isCr0(cr)) continue; // CR 0 nezvyšuje obtížnost

    const xp = crToXp(cr);
    baseXp += xp * qty;
    if (p.boss && xp > 0) baseXp += Math.round(xp * (BOSS_XP_FACTOR - 1));
    monsterCount += qty;

    const v = map[cr];
    if (typeof v !== 'number') {
      missing.push(p.monster.jmeno);
      continue;
    }
    strengthTotal += v * qty;
    if (p.boss) strengthTotal += v * (BOSS_STRENGTH_FACTOR - 1);
  }

  const mult = encounterMultiplier(monsterCount, partySize);
  const adjustedXp = Math.round(baseXp * mult);

  let difficulty = 'medium';
  if (missing.length) {
    difficulty = 'deadly';
  } else {
    const ratio = partySize > 0 ? strengthTotal / partySize : 0;
    if (ratio < (2 / 3 + 1) / 2) difficulty = 'easy';
    else if (ratio < (1 + 1.5) / 2) difficulty = 'medium';
    else if (ratio < (1.5 + 2) / 2) difficulty = 'hard';
    else difficulty = 'deadly';
  }

  return { baseXp, mult, adjustedXp, strengthTotal, missing, difficulty, partyLevel: pl, monsterCount };
}

export function bossHpMultiplier(cr, difficulty = 'medium') {
  const v = crToFloat(cr) || 0;
  let base;
  if (v <= 1) base = 1.9;
  else if (v <= 4) base = 1.75;
  else if (v <= 10) base = 1.6;
  else if (v <= 16) base = 1.5;
  else base = 1.45;
  const f = { easy: 0.95, hard: 1.08, deadly: 1.15 }[difficulty] ?? 1.0;
  return base * f;
}

// ---------------------------------------------------------------------------
// Loot

export const RARITY_KEYS = ['bezny', 'neobvykly', 'vzacny', 'velmi_vzacny', 'legendarny', 'artefakt'];
export const RARITY_KEY_LABEL = {
  bezny: 'běžný',
  neobvykly: 'neobvyklý',
  vzacny: 'vzácný',
  velmi_vzacny: 'velmi vzácný',
  legendarny: 'legendární',
  artefakt: 'artefakt',
};

export function rarityLabel(k) {
  return RARITY_KEY_LABEL[k] ?? k ?? '';
}

function lootNorm(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '');
}

/** Převede text vzácnosti předmětu na klíč (u „a/b“ bere nižší). */
export function lootMinRarity(txt) {
  const t = String(txt ?? '').trim();
  if (!t) return 'bezny';
  const parts = norm(t)
    .split(/[\\/|,;]+/)
    .map(lootNorm)
    .filter(Boolean);
  const found = [];
  for (const p of parts) {
    if (p.includes('bez')) found.push('bezny');
    if (p.includes('neob')) found.push('neobvykly');
    // Pozn.: webová verze tu u „Velmi vzácný“ omylem vracela „vzacny“ (obsahuje i „vzac“).
    if (p.includes('velmi') && p.includes('vzac')) found.push('velmi_vzacny');
    else if (p.includes('vzac')) found.push('vzacny');
    if (p.includes('legen')) found.push('legendarny');
    if (p.includes('arte')) found.push('artefakt');
  }
  if (!found.length) {
    const n = lootNorm(t);
    if (n.includes('veryrare')) return 'velmi_vzacny';
    if (n.includes('uncommon')) return 'neobvykly';
    if (n.includes('common')) return 'bezny';
    if (n.includes('rare')) return 'vzacny';
    if (n.includes('legendary')) return 'legendarny';
    if (n.includes('artifact')) return 'artefakt';
    return 'bezny';
  }
  return found.reduce((best, k) => (RARITY_KEYS.indexOf(k) < RARITY_KEYS.indexOf(best) ? k : best), found[0]);
}

export function lootAllowedRarities(maxLevel) {
  const out = ['bezny', 'neobvykly'];
  if (maxLevel >= 5) out.push('vzacny');
  if (maxLevel >= 11) out.push('velmi_vzacny');
  if (maxLevel >= 17) out.push('legendarny');
  if (maxLevel >= 20) out.push('artefakt');
  return out;
}

function prevRarity(r) {
  const i = RARITY_KEYS.indexOf(r);
  return i <= 0 ? '' : RARITY_KEYS[i - 1];
}

function rollRarity(maxLevel) {
  const allowed = lootAllowedRarities(maxLevel);
  const probs = { neobvykly: 15, vzacny: 10, velmi_vzacny: 7, legendarny: 5, artefakt: 3 };
  const eligible = Object.entries(probs).filter(([k]) => allowed.includes(k));
  const common = Math.max(0, 100 - eligible.reduce((s, [, p]) => s + p, 0));
  let roll = randInt(1, 100);
  if (roll <= common) return 'bezny';
  roll -= common;
  for (const [k, p] of eligible) {
    if (roll <= p) return k;
    roll -= p;
  }
  return 'bezny';
}

function lootCountForInstance(isBoss, mode) {
  if (mode === 'frugal') return randInt(0, 1);
  if (mode === 'balanced') return 1 + randInt(0, 1);
  return isBoss ? 3 : 2; // rich
}

/**
 * Vygeneruje loot. opponents: [{ is_boss }] – jeden záznam na každého protivníka.
 * Vrací [{ item_id, name, rarity, category, source }].
 */
export function generateLoot({ opponents, maxLevel, mode, baseItemsOnly }) {
  if (!['frugal', 'balanced', 'rich'].includes(mode) || !opponents.length) return [];
  maxLevel = clampLevel(maxLevel);

  const allowed = baseItemsOnly ? ['bezny'] : lootAllowedRarities(maxLevel);
  const buckets = {};
  for (const it of catalog().items) {
    const name = (it.jmeno ?? '').trim();
    if (!name) continue;
    const r = lootMinRarity(it.vzacnost);
    if (!allowed.includes(r)) continue;
    (buckets[r] ||= []).push({ item_id: it.id, name, rarity: r, category: (it.kategorie ?? '').trim() });
  }
  if (!Object.keys(buckets).length) return [];

  const pick = (r) => {
    const arr = buckets[r] || [];
    return arr.length ? arr[randInt(0, arr.length - 1)] : null;
  };
  const degrade = (r) => {
    while (r && !(buckets[r] || []).length) r = prevRarity(r);
    return r || 'bezny';
  };
  const highest = [...RARITY_KEYS].reverse().find((r) => allowed.includes(r)) || 'bezny';

  const out = [];
  for (const o of opponents) {
    const n = lootCountForInstance(!!o.is_boss, mode);
    if (n <= 0) continue;
    if (o.is_boss) {
      const r = degrade(highest);
      const picked = new Set();
      for (let i = 0; i < n; i++) {
        let it = null;
        for (let tries = 0; tries < 10; tries++) {
          const cand = pick(r);
          if (!cand) break;
          if (!picked.has(cand.item_id)) {
            it = cand;
            picked.add(cand.item_id);
            break;
          }
        }
        it = it || pick(r);
        if (it) out.push({ ...it, source: 'boss' });
      }
    } else {
      for (let i = 0; i < n; i++) {
        let r = rollRarity(maxLevel);
        while (r && !allowed.includes(r)) r = prevRarity(r);
        const it = pick(degrade(r || 'bezny'));
        if (it) out.push({ ...it, source: 'drop' });
      }
    }
  }
  return out;
}
