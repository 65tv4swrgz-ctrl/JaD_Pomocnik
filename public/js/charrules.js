// Číselníky a výpočty deníku postavy – přepis CharacterService a výpočtů z character.php (PHP).

import { norm } from './util.js';

export const RACES = ['Vznešený člověk', 'Člověk seveřan', 'Člověk kočovník', 'Půlelf', 'Lesní elf', 'Vznešený elf', 'Noční elf', 'Krvavý elf', 'Podzemní trpaslík', 'Skalní trpaslík', 'Světlý trpaslík', 'Ohnivý trpaslík', 'Půlčík tichošlápek', 'Půlčík pořízek', 'Půlork', 'Lesní gnóm', 'Skalní gnóm', 'Drakorozený', 'Tiefling'];
export const BACKGROUNDS = ['Akolyta', 'Bylinkář', 'Dělník', 'Chovatel', 'Kramář', 'Lovec', 'Mudrc', 'Pobuda', 'Právník', 'Sluha', 'Strážce', 'Šlechtic', 'Úředník', 'Voják', 'Zasvěcenec', 'Zbojník'];
export const CLASSES = ['Alchymista', 'Barbar', 'Bard', 'Bojovník', 'Čaroděj', 'Černokněžník', 'Druid', 'Klerik', 'Kouzelník', 'Lovec netvorů', 'Tulák'];
export const ALIGNMENTS = ['Zákonné dobro', 'Neutrální dobro', 'Chaotické dobro', 'Zákonná neutralita', 'Čistá neutralita', 'Chaotická neutralita', 'Zákonné zlo', 'Neutrální zlo', 'Chaotické zlo'];
export const HIT_DICE = ['K6', 'K8', 'K10'];
export const HIT_DICE = ['K6', 'K8', 'K10', 'K12'];
export const SPELL_ABILITIES = ['Inteligence', 'Moudrost', 'Charisma'];

export const CLASS_SPECS = {
  Alchymista: ['Divotvůrce', 'Pyrofor', 'Theurg'],
  Barbar: ['Cesta berserkra', 'Cesta bijce', 'Cesta kmenového válečníka', 'Cesta ničitele'],
  Bard: ['Kolej dramatu', 'Kolej romance', 'Kolej světských písní'],
  Bojovník: ['Gardista', 'Chodec', 'Chrámový rytíř', 'Střelec', 'Šampion', 'Veterán', 'Vojevůdce'],
  Čaroděj: ['Fantaskní magie', 'Sférický čaroděj', 'Živlový čaroděj'],
  Černokněžník: ['Bouřný titán', 'Pradávný drak', 'Ztracený mistr'],
  Druid: ['Kruh bylin', 'Kruh města', 'Kruh pohromy', 'Kruh měsíce'],
  Klerik: ['Inkvizitor', 'Kazatel', 'Misionář'],
  Kouzelník: ['Mistr svitků', 'Průzkumník', 'Psychický mág'],
  'Lovec netvorů': ['Řád konečné smrti', 'Řád pozměněnců', 'Řád bestie', 'Řád zaprodanců'],
  Tulák: ['Kejklíř', 'Mistr zloděj', 'Svatokupec', 'Šedá eminence', 'Vykradač hrobek'],
};

const SPEED_BY_RACE = {
  'Podzemní trpaslík': 5, 'Skalní trpaslík': 5, 'Světlý trpaslík': 5, 'Ohnivý trpaslík': 5,
  'Půlčík tichošlápek': 5, 'Půlčík pořízek': 5, 'Lesní gnóm': 5, 'Skalní gnóm': 5,
};
export const baseSpeedByRace = (race) => SPEED_BY_RACE[race] ?? 6;

/** Vlastnosti: [sloupec, název, krátký název, dovednosti] */
export const ABILITIES = [
  ['sila', 'Síla', 'SÍL', ['Atletika']],
  ['obratnost', 'Obratnost', 'OBR', ['Akrobacie', 'Čachry', 'Nenápadnost']],
  ['odolnost', 'Odolnost', 'ODL', []],
  ['inteligence', 'Inteligence', 'INT', ['Historie', 'Mystika', 'Náboženství', 'Pátrání', 'Příroda']],
  ['moudrost', 'Moudrost', 'MOU', ['Lékařství', 'Ovládání zvířat', 'Přežití', 'Vhled', 'Vnímání']],
  ['charisma', 'Charisma', 'CHA', ['Klamání', 'Přesvědčování', 'Vystupování', 'Zastrašování']],
];
export const ABILITY_COL = Object.fromEntries(ABILITIES.map(([col, name]) => [name, col]));
export const SKILL_ABILITY = Object.fromEntries(ABILITIES.flatMap(([col, , , skills]) => skills.map((s) => [s, col])));
export const PASSIVE_BASE = ['Atletika', 'Akrobacie', 'Nenápadnost', 'Vhled', 'Vnímání'];

export const TOOLS = [
  'Bylinkářská souprava', 'Dopravní prostředky - vozy', 'Dopravní prostředky - lodě', 'Navigační pomůcky', 'Balíček karet', 'Sada kostek',
  'Buben', 'Cimbál', 'Dudy', 'Flétna', 'Lesní roh', 'Loutna', 'Lyra', 'Panova flétna', 'Šalmaj', 'Viola',
  'Alchymistická souprava', 'Hrnčířské nástroje', 'Hornické nářadí', 'Kamenické nářadí', 'Kaligrafické náčiní', 'Kartografické pomůcky',
  'Klenotnické náčiní', 'Kovářské nářadí', 'Koželužnická souprava', 'Kuchařské nástroje', 'Kutilské nástroje', 'Malířské náčiní',
  'Pivovarnické nástroje', 'Řezbářské náčiní', 'Sklářské nástroje', 'Ševcovské náčiní', 'Šperkařské náčiní', 'Tesařské nástroje',
  'Tkalcovské nástroje', 'Vinařské nástroje', 'Zednické nářadí', 'Padělatelské nástroje', 'Pomůcky pro přestrojování', 'Travičská souprava', 'Zlodějské náčiní',
];

export const WEAPONS = [
  'Dýka', 'Hůl', 'Kopí', 'Kyj', 'Lehké kladivo', 'Oštěp', 'Palcát', 'Sekera', 'Srp', 'Těžký kyj', 'Bič', 'Cepín', 'Dlouhý meč', 'Dřevec',
  'Halapartna', 'Krátký meč', 'Kropáč', 'Kůsa', 'Obouruční meč', 'Obouruční sekera', 'Palice', 'Píka', 'Rapír', 'Řemdih', 'Šavle', 'Trojzubec',
  'Válečná sekera', 'Válečné kladivo', 'Krátký luk', 'Lehká kuše', 'Prak', 'Šipka', 'Dlouhý luk', 'Foukačka', 'Ruční kuše', 'Síť', 'Těžká kuše',
  'Dlaňová pistole', 'Pistole', 'Mušketa', 'Trombón', 'Hákovnice', 'Ruční hmoždíř', 'Dělo (malé)',
];

/** Pozice kouzel podle stupně a pozice truhly (5 sloupců po 4). */
export const SPELL_SLOTS_LAYOUT = { 1: [1, 2, 3, 4], 2: [1, 2, 3, 4], 3: [1, 2, 3, 4], 4: [1, 2, 3, 4], 5: [1, 2, 3, 4], 6: [1, 2], 7: [1, 2], 8: [1], 9: [1] };
export const CHEST_LAYOUT = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

// ---------------------------------------------------------------------------

/** Modifikátor vlastnosti: floor((skóre − 10) / 2). */
export const mod = (score) => Math.floor(((parseInt(score, 10) || 0) - 10) / 2);
export const signed = (n) => (n >= 0 ? '+' : '') + n;

/** Bonus podle stavu zdatnosti: 0 = nic, 1 = zdatnost, 2 = kvalifikace (dvojnásobek). */
export const profMult = (state) => (state === 2 ? 2 : state === 1 ? 1 : 0);
export const cycleState = (s) => (s === 0 ? 1 : s === 1 ? 2 : 0);

export function hitDieSides(die) {
  const m = String(die ?? '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseSignedInt(raw) {
  const m = String(raw ?? '').match(/([-+]?\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** OČ zbroje: „12 + OBR (max +2)“ apod. */
function armorAc(ocRaw, dexMod) {
  const oc = String(ocRaw ?? '').trim();
  if (!oc) return 10 + dexMod;
  const base = parseInt(oc.match(/(\d+)/)?.[1] ?? '0', 10);
  const addsDex = /obr/i.test(oc);
  const cap = oc.match(/max\s*\+\s*(\d+)/i);
  let dex = addsDex ? dexMod : 0;
  if (addsDex && cap) dex = Math.min(dex, parseInt(cap[1], 10));
  return base + dex;
}

const lc = (s) => String(s ?? '').toLowerCase();

/** Kategorie předmětu → slot, který smí být vybaven jen jednou. */
export function exclusiveSlot(item) {
  const cat = lc(item?.kategorie);
  if (cat.includes('zbroj')) return 'armor';
  if (cat.includes('štít') || cat.includes('stit')) return 'shield';
  return null;
}

/** Požadavek na Sílu u zbroje (sloupec „sila“ v jad_items), 0 = bez požadavku. */
export function strengthRequirement(item) {
  const m = String(item?.sila ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

export function armorProfKey(item) {
  // Bez diakritiky – v datech je i překlep „Ťěžká“.
  const sub = norm(item?.podkategorie);
  if (sub.includes('lehk')) return 'lehke';
  if (sub.includes('stred')) return 'stredni';
  if (sub.includes('tez')) return 'tezke';
  return '';
}

/**
 * Bojové hodnoty. ch = postava (s rozparsovanými JSON poli), items = předměty inventáře s daty z katalogu.
 */
export function combatStats(ch, items) {
  const strMod = mod(ch.sila);
  const dexMod = mod(ch.obratnost);
  const prof = ch.zdatnostni_bonus ?? 0;
  const equipped = items.filter((it) => it.equipped);

  const armor = equipped.find((it) => it.kategorie === 'Zbroj' && String(it.oc ?? '').trim() !== '') ?? null;
  const shield = equipped.find((it) => it.kategorie === 'Štít' && String(it.oc ?? '').trim() !== '') ?? null;
  let ac = 10 + dexMod;
  if (armor) ac = armorAc(armor.oc, dexMod) + parseSignedInt(armor.bonus);
  if (shield) ac += parseSignedInt(shield.oc) + parseSignedInt(shield.bonus);

  const combatCol = ABILITY_COL[ch.bojova_vlastnost] ?? null;
  const saveDc = combatCol ? 8 + prof + mod(ch[combatCol]) : null;

  const w = ch.zd_zbrane;
  const pick = new Set(w.vyber);
  const isProficient = (it) => {
    const druh = String(it.druh_zbrane ?? '').trim();
    if (druh && pick.has(druh)) return true;
    const trida = lc(it.trida);
    if (w.jednoduche && trida.includes('jednoduch')) return true;
    if (w.valecne && (trida.includes('váleč') || trida.includes('valec'))) return true;
    return false;
  };
  const isRanged = (it) => {
    const sub = lc(it.podkategorie);
    if (sub.includes('dálk') || sub.includes('dalk')) return true;
    return String(it.dostrel ?? '').trim() !== '';
  };

  const weapons = [];
  for (const it of equipped) {
    if (it.kategorie !== 'Zbraň') continue;
    let abilityMod = strMod;
    if (isRanged(it)) abilityMod = dexMod;
    else if (it.vytribena && dexMod > strMod) abilityMod = dexMod;
    const wBonus = parseSignedInt(it.bonus);
    const toHit = abilityMod + (isProficient(it) ? prof : 0) + wBonus;
    const dmgAdd = abilityMod + wBonus;
    const raw = String(it.dmg ?? '').trim();
    const type = raw.match(/\(([^)]+)\)/)?.[1]?.trim() ?? '';
    const dice = raw.replace(/\s*\([^)]*\)\s*/g, '').trim();
    const qty = Math.max(1, it.mnozstvi | 0);
    for (let i = 0; i < qty; i++) {
      weapons.push({
        item: it,
        toHit,
        dmg: dice ? dice + (dmgAdd !== 0 ? ' ' + signed(dmgAdd) : '') : '—',
        type: type || '—',
        range: String(it.dostrel ?? '').trim() || '—',
      });
    }
  }

  // Kouzla nejdou sesílat ve zbroji, se kterou postava nemá zdatnost.
  let spellsBlocked = false;
  if (armor) {
    const key = armorProfKey(armor);
    if (key) spellsBlocked = !ch.zd_zbroje[key];
  }

  const speed = ch.rychlost ?? null;
  return {
    initiative: dexMod,
    ac,
    acItems: [armor?.jmeno, shield?.jmeno].filter(Boolean).join(', '),
    saveDc,
    speed: speed === null ? null : { light: speed, medium: speed - 1, heavy: speed - 3 },
    weapons,
    spellsBlocked,
  };
}

/** Sesílací vlastnost → útočný bonus a SO. */
export function spellStats(ch) {
  const col = ABILITY_COL[ch.sesilaci_vlastnost];
  if (!col) return null;
  const m = mod(ch[col]);
  const prof = ch.zdatnostni_bonus ?? 0;
  return { ability: ch.sesilaci_vlastnost, atk: m + prof, dc: 8 + prof + m };
}
