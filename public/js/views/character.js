// Deník postavy (character.php): Postava, Vlastnosti a zdatnosti, Bojová výbava, Kouzla, Inventář.

import { catalog, spellLevelLabel } from '../catalog.js';
import {
  ABILITIES, ALIGNMENTS, BACKGROUNDS, CHEST_LAYOUT, CLASS_SPECS, CLASSES, PASSIVE_BASE, RACES, SKILL_ABILITY, SPELL_ABILITIES,
  SPELL_SLOTS_LAYOUT, TOOLS, WEAPONS, combatStats, cycleState, mod, profMult, signed, spellStats,
} from '../charrules.js';
import {
  abilityDelta, addItem, addSpells, applyDelta, getCharacter, itemQtyDelta, levelUp, listItems, listSpells, removeSpell, resetSlots,
  setArmorProf, setChestUsed, setField, setHp, setItemEquipped, setItemNote, setProfState, setSpellPrepared, setSpellSlotUsed, setTools,
  setWeaponGroup, setWeapons, walletAdjust,
} from '../charstore.js';
import { backButton, bindBack, bindSteppers, confirmDialog, debounce, esc, isBlank, loadPref, norm, openModal, savePref, stepperHtml, toast } from '../util.js';
import { showItemModal } from './items.js';

// ---------------------------------------------------------------------------
// Mřížky pozic kouzel a truhly (sdílené se zakládáním postavy)

/**
 * mode 'pick': všechny pozice, zaškrtnuté = selected (dostupné). Pro založení a novou úroveň.
 * mode 'use': jen dostupné pozice, zaškrtnuté = použité.
 */
export function slotGridHtml({ mode, selected = {}, available = {}, used = {} }) {
  const cols = Object.entries(SPELL_SLOTS_LAYOUT)
    .map(([lvl, positions]) => {
      const avail = new Set((available[lvl] ?? []).map(String));
      const shown = mode === 'pick' ? positions : positions.filter((p) => avail.has(String(p)));
      if (!shown.length) return '';
      const on = new Set(((mode === 'pick' ? selected : used)[lvl] ?? []).map(String));
      return `<div class="slots__col"><div class="slots__head">${lvl}</div>${shown
        .map(
          (p) => `<label class="slot" title="${lvl}. stupeň – pozice ${p}"><input type="checkbox" data-slot-lvl="${lvl}" data-slot-pos="${p}" ${on.has(String(p)) ? 'checked' : ''}><span></span></label>`
        )
        .join('')}</div>`;
    })
    .join('');
  return cols ? `<div class="slots">${cols}</div>` : '<div class="small muted">Žádné dostupné pozice.</div>';
}

export function chestGridHtml({ mode, selected = [], available = [], used = [] }) {
  const avail = new Set(available.map(String));
  const on = new Set((mode === 'pick' ? selected : used).map(String));
  const cols = CHEST_LAYOUT.map((col) => {
    const shown = mode === 'pick' ? col : col.filter((p) => avail.has(String(p)));
    if (!shown.length) return '';
    return `<div class="slots__col"><div class="slots__head">&nbsp;</div>${shown
      .map((p) => `<label class="slot slot--chest" title="Truhla – pozice ${p}"><input type="checkbox" data-chest-pos="${p}" ${on.has(String(p)) ? 'checked' : ''}><span></span></label>`)
      .join('')}</div>`;
  }).join('');
  return cols ? `<div class="slots">${cols}</div>` : '<div class="small muted">Žádné dostupné pozice.</div>';
}

export function readSlotGrid(el) {
  const out = {};
  el.querySelectorAll('[data-slot-lvl]:checked').forEach((cb) => (out[cb.dataset.slotLvl] ||= []).push(cb.dataset.slotPos));
  return out;
}

export function readChestGrid(el) {
  return [...el.querySelectorAll('[data-chest-pos]:checked')].map((cb) => cb.dataset.chestPos);
}

// ---------------------------------------------------------------------------

const TABS = [
  ['postava', 'Postava'],
  ['vlastnosti', 'Vlastnosti a zdatnosti'],
  ['boj', 'Bojová výbava'],
  ['kouzla', 'Kouzla'],
  ['inventar', 'Inventář'],
];

const STAR = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.9-4.8 4.7 1.2 6.6-5.9-3.1-5.9 3.1 1.2-6.6L2.5 9.5l6.6-.9L12 2.6z"/></svg>';

const sel = (field, list, cur, placeholder = '—') =>
  `<select data-field="${field}"><option value="">${placeholder}</option>${list.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;

/** Řádek se zdatností (hvězdička: prázdná / zdatnost / kvalifikace). */
const profRow = (kind, name, state, value, label = name) =>
  `<button type="button" class="skill" data-act="prof" data-kind="${kind}" data-name="${esc(name)}" data-state="${state}" aria-label="${esc(label)} – změnit zdatnost">
    <span class="skill__star">${STAR}</span><span class="skill__label">${esc(label)}</span>${value !== null ? `<span class="skill__val">${esc(value)}</span>` : ''}
  </button>`;

const toggleRow = (act, key, label, on) =>
  `<button type="button" class="skill" data-act="${act}" data-key="${key}" data-state="${on ? 1 : 0}" aria-pressed="${on ? 'true' : 'false'}">
    <span class="skill__star">${STAR}</span><span class="skill__label">${esc(label)}</span></button>`;

export function render(host, id) {
  const root = document.createElement('div');
  host.appendChild(root);
  if (!getCharacter(id)) {
    root.innerHTML = `<div class="page-head"><h1>Postava nenalezena</h1>${backButton('#/characters')}</div>`;
    bindBack(root);
    return;
  }
  bindSteppers(root);

  let tab = loadPref('char-tab', { tab: 'postava' }).tab;
  if (!TABS.some(([k]) => k === tab)) tab = 'postava';

  root.innerHTML = `
    <div class="page-head">
      <h1 id="c_name" class="char-name"></h1>
      <div class="row-gap" style="flex-wrap:nowrap">
        <button class="btn btn-sm" type="button" data-act="levelup">Nová úroveň</button>
        ${backButton('#/characters')}
      </div>
    </div>
    <div class="page-head__meta" id="c_meta"></div>
    <div class="tabs char-tabs" role="tablist" style="margin-top:12px">
      ${TABS.map(([k, l]) => `<button class="btn btn-secondary btn-sm" type="button" role="tab" data-act="tab" data-tab="${k}">${l}</button>`).join('')}
    </div>
    <div id="c_tab"></div>
    <div class="card">
      <label class="field">Poznámka<textarea data-text="poznamka" rows="2" placeholder="Poznámka k postavě…"></textarea></label>
    </div>`;
  bindBack(root);
  const $ = (s) => root.querySelector(s);

  // ---------------------------------------------------------------------
  // Vykreslení

  function drawHead() {
    const c = getCharacter(id);
    $('#c_name').innerHTML = `${esc(c.jmeno)} <button class="btn btn-ghost btn-sm btn-icon" type="button" data-act="rename" aria-label="Přejmenovat">✎</button>`;
    const cls = c.povolani ? c.povolani + (c.specializace ? ` (${c.specializace})` : '') : '';
    $('#c_meta').textContent = [c.rasa, cls, 'Úroveň ' + c.uroven].filter(Boolean).join(' • ');
    root.querySelectorAll('[data-act="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  }

  function hpHtml(c) {
    const over = c.bv_ted !== null && c.bv_max !== null && c.bv_ted > c.bv_max;
    return `<span class="hp">
      <button class="btn btn-secondary btn-sm btn-icon" type="button" data-act="delta" data-field="bv_ted" data-d="-1" aria-label="Snížit BV">−</button>
      <button class="hp__val ${over ? 'is-over' : ''}" type="button" data-act="hp-edit">${c.bv_ted ?? '—'}/${c.bv_max ?? '—'}</button>
      <button class="btn btn-secondary btn-sm btn-icon" type="button" data-act="delta" data-field="bv_ted" data-d="1" aria-label="Zvýšit BV">+</button>
    </span>`;
  }

  const deltaHtml = (field, value, label) => `<span class="hp">
      <button class="btn btn-secondary btn-sm btn-icon" type="button" data-act="delta" data-field="${field}" data-d="-1" aria-label="Snížit: ${label}">−</button>
      <span class="hp__val hp__val--static">${value ?? '—'}</span>
      <button class="btn btn-secondary btn-sm btn-icon" type="button" data-act="delta" data-field="${field}" data-d="1" aria-label="Zvýšit: ${label}">+</button>
    </span>`;

  const textArea = (field, value, placeholder) =>
    `<textarea class="autosize" data-text="${field}" rows="3" placeholder="${placeholder}">${esc(value)}</textarea>`;

  function tabPostava(c) {
    return `<p class="small muted">Změny se ukládají automaticky.</p>
      <div class="card mt-0">
        <div class="grid grid-4">
          <label class="field">Rasa${sel('rasa', RACES, c.rasa)}</label>
          <label class="field">Zázemí${sel('zazemi', BACKGROUNDS, c.zazemi)}</label>
          <label class="field">Povolání${sel('povolani', CLASSES, c.povolani)}</label>
          <label class="field">Specializace${sel('specializace', CLASS_SPECS[c.povolani] ?? [], c.specializace, c.povolani ? '— specializace —' : '— nejdřív povolání —')}</label>
          <label class="field">Přesvědčení${sel('presvedceni', ALIGNMENTS, c.presvedceni)}</label>
        </div>
        <div class="stat-row">
          <div class="stat-row__item"><span class="pcard__ctrl-label">Inspirace</span>${deltaHtml('inspirace', c.inspirace, 'inspirace')}</div>
          <div class="stat-row__item"><span class="pcard__ctrl-label">Body výdrže</span>${hpHtml(c)}</div>
          <div class="stat-row__item"><span class="pcard__ctrl-label">Kostky obnovy ${esc(c.kostka_obnovy ?? '—')} ×</span>${deltaHtml('pocet_kostek_obnovy', c.pocet_kostek_obnovy, 'kostky obnovy')}</div>
        </div>
        <label class="field" style="margin-top:14px">Schopnosti${textArea('schopnosti', c.schopnosti, 'Schopnosti…')}</label>
        <label class="field" style="margin-top:12px">Vzhled${textArea('vzhled', c.vzhled, 'Vzhled…')}</label>
        <label class="field" style="margin-top:12px">Vztahy${textArea('vztahy', c.vztahy, 'Vztahy…')}</label>
      </div>`;
  }

  function tabVlastnosti(c) {
    const prof = c.zdatnostni_bonus ?? 0;
    const st = (zd, kv, n) => (kv.includes(n) ? 2 : zd.includes(n) ? 1 : 0);
    const cards = ABILITIES.map(([col, name, , skills]) => {
      const m = mod(c[col]);
      return `<div class="ability">
        <div class="ability__name">${name.toUpperCase()}</div>
        <div class="ability__arch" aria-label="Oprava"><span class="ability__mod">${signed(m)}</span></div>
        <div class="ability__score" aria-label="Hodnota vlastnosti">
          <button class="ability__pm" type="button" data-act="ab" data-col="${col}" data-d="-1" aria-label="Snížit ${name}">−</button>
          <span class="ability__val">${c[col]}</span>
          <button class="ability__pm" type="button" data-act="ab" data-col="${col}" data-d="1" aria-label="Zvýšit ${name}">+</button>
        </div>
        <div class="skills">${skills
          .map((s) => {
            const state = st(c.zd_dovednosti, c.kv_dovednosti, s);
            return profRow('skill', s, state, signed(m + prof * profMult(state)));
          })
          .join('')}</div>
      </div>`;
    }).join('');

    const saves = ABILITIES.map(([col, name]) => {
      const state = st(c.zd_zachranne_hody, c.kv_zachranne_hody, name);
      return profRow('save', name, state, signed(mod(c[col]) + prof * profMult(state)));
    }).join('');

    const passiveVal = (s, state) => String(10 + mod(c[SKILL_ABILITY[s]]) + prof * profMult(state));
    const other = [...c.zd_pasivni_dovednosti, ...c.kv_pasivni_dovednosti].find((s) => !PASSIVE_BASE.includes(s) && SKILL_ABILITY[s]);
    const passives =
      PASSIVE_BASE.map((s) => {
        const state = st(c.zd_pasivni_dovednosti, c.kv_pasivni_dovednosti, s);
        return profRow('passive', s, state, passiveVal(s, state));
      }).join('') +
      (other
        ? profRow('passive', other, st(c.zd_pasivni_dovednosti, c.kv_pasivni_dovednosti, other), passiveVal(other, st(c.zd_pasivni_dovednosti, c.kv_pasivni_dovednosti, other)))
        : `<button type="button" class="skill" data-act="passive-other" data-state="0"><span class="skill__star">${STAR}</span><span class="skill__label">Jiné…</span><span class="skill__val muted">—</span></button>`);

    const tools = [...new Set([...c.zd_pomucky, ...c.kv_pomucky])];
    const toolRows = tools.length
      ? tools.map((t) => {
          const state = c.kv_pomucky.includes(t) ? 2 : 1;
          return profRow('tool', t, state, signed(prof * profMult(state)));
        }).join('')
      : '<div class="small muted" style="padding:6px 2px">—</div>';

    const w = c.zd_zbrane;
    const a = c.zd_zbroje;
    return `<p class="small muted">Klepnutím na řádek se přepíná: bez zdatnosti → zdatnost (★) → kvalifikace (dvojnásobný bonus). Zdatnostní bonus: <strong>${signed(prof)}</strong></p>
      <div class="ability-grid">${cards}</div>
      <div class="prof-cards">
        <div class="ability"><div class="ability__name">Záchranné hody</div><div class="skills">${saves}</div></div>
        <div class="ability"><div class="ability__name">Pasivní dovednosti</div><div class="skills">${passives}</div></div>
        <div class="ability"><div class="ability__name">Zdatnost s pomůckami</div><div class="skills">${toolRows}
          <button type="button" class="skill skill--add" data-act="tools-pick"><span class="skill__label">Vybrat pomůcky…</span><span class="skill__val">+</span></button></div></div>
        <div class="ability"><div class="ability__name">Zdatnost se zbraněmi</div><div class="skills">
          ${toggleRow('wgroup', 'jednoduche', 'Jednoduché', w.jednoduche)}${toggleRow('wgroup', 'valecne', 'Válečné', w.valecne)}
          <div class="small" style="padding:6px 2px"><span class="muted">Vybrané:</span> ${w.vyber.length ? esc(w.vyber.join(', ')) : '—'}</div>
          <button type="button" class="skill skill--add" data-act="weapons-pick"><span class="skill__label">Vybrat zbraně…</span><span class="skill__val">+</span></button></div></div>
        <div class="ability"><div class="ability__name">Zdatnost se zbrojemi a štíty</div><div class="skills">
          ${toggleRow('armor', 'lehke', 'Lehké', a.lehke)}${toggleRow('armor', 'stredni', 'Střední', a.stredni)}${toggleRow('armor', 'tezke', 'Těžké', a.tezke)}${toggleRow('armor', 'stity', 'Štíty', c.zd_stity)}
        </div></div>
      </div>`;
  }

  function tabBoj(c) {
    const items = listItems(id);
    const s = combatStats(c, items);
    return `<p class="small muted">Útočný bonus, zásah a OČ se počítají automaticky podle vybavení v inventáři.</p>
      <div class="card mt-0">
        <div class="combat-grid">
          <div><div class="combat__k">Iniciativa</div><div class="combat__v">${signed(s.initiative)}</div></div>
          <div><div class="combat__k">Body výdrže</div>${hpHtml(c)}</div>
          <div><div class="combat__k">OČ</div><div class="combat__v">${s.ac}</div>${s.acItems ? `<div class="small muted">${esc(s.acItems)}</div>` : ''}</div>
          <div><div class="combat__k">SO záchrany schopností</div><div class="combat__v">${s.saveDc ?? '—'}</div>
            <div style="margin-top:4px">${sel('bojova_vlastnost', ABILITIES.map(([, n]) => n), c.bojova_vlastnost, '— vlastnost —')}</div></div>
          <div><div class="combat__k">Rychlost</div>${
            s.speed
              ? `<div class="small">Lehké naložení: <strong>${s.speed.light}</strong><br>Střední: <strong>${s.speed.medium}</strong><br>Těžké: <strong>${s.speed.heavy}</strong></div>`
              : '<div class="combat__v">—</div>'
          }</div>
        </div>
        <hr class="sep">
        <h3>Vybavené zbraně</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Název</th><th>Bonus</th><th>Zásah</th><th>Typ zásahu</th><th>Dosah</th><th>Poznámka</th></tr></thead>
          <tbody>${
            s.weapons.length
              ? s.weapons
                  .map(
                    (w) => `<tr><td>${esc(w.item.jmeno)}</td><td class="nowrap"><span class="badge badge--accent">${signed(w.toHit)}</span></td>
                      <td class="nowrap"><strong>${esc(w.dmg)}</strong></td><td>${esc(w.type)}</td><td class="nowrap">${esc(w.range)}</td>
                      <td style="min-width:180px"><input data-item-note="${w.item.row_id}" value="${esc(w.item.poznamka)}" placeholder="Poznámka…"></td></tr>`
                  )
                  .join('')
              : '<tr><td colspan="6" class="empty">Žádné vybavené zbraně. Vybav je v záložce Inventář.</td></tr>'
          }</tbody>
        </table></div>
        <hr class="sep">
        <label class="field">Schopnosti${textArea('schopnosti', c.schopnosti, 'Schopnosti…')}</label>
      </div>`;
  }

  function tabKouzla(c) {
    const ss = spellStats(c);
    const spells = listSpells(id);
    const blocked = combatStats(c, listItems(id)).spellsBlocked;
    return `<p class="small muted">Pozice v Použití truhly můžeš využít pro jakékoliv sloty tvého povolání.</p>
      <div class="card mt-0">
        ${
          ss
            ? `<div class="combat-grid">
                <div><div class="combat__k">Sesílací vlastnost</div><div class="combat__v">${esc(ss.ability)}</div></div>
                <div><div class="combat__k">Útočný bonus</div><div class="combat__v">${signed(ss.atk)}</div></div>
                <div><div class="combat__k">SO záchrany</div><div class="combat__v">${ss.dc}</div></div>
              </div>`
            : `<label class="field" style="max-width:320px">Sesílací vlastnost${sel('sesilaci_vlastnost', SPELL_ABILITIES, c.sesilaci_vlastnost, '— vyber sesílací vlastnost —')}</label>`
        }
        <hr class="sep">
        <div class="slots-row">
          <div><div class="slots-title">Pozice kouzel <span class="small muted">(zaškrtnuto = použito)</span></div>
            ${slotGridHtml({ mode: 'use', available: c.pripravena_kouzla, used: c.pouzita_kouzla })}</div>
          <div><div class="slots-title">Použití truhly</div>
            ${chestGridHtml({ mode: 'use', available: c.dostupna_truhla, used: c.pouzita_truhla })}</div>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" data-act="slots-reset" style="margin-top:10px">Odpočinek – uvolnit všechny pozice</button>
        <hr class="sep">
        <div class="row-between"><h3 style="margin:0">Kouzla postavy</h3><button class="btn btn-sm" type="button" data-act="spell-add">+ Přidat kouzlo</button></div>
        ${blocked ? '<div class="alert alert--danger" style="margin-top:10px"><strong>S právě nasazenou zbrojí nemůžeš používat žádná kouzla.</strong></div>' : ''}
        <div ${blocked ? 'hidden' : ''}>
          ${
            spells.length
              ? `<div class="spell-chips">${spells
                  .map((s) => `<button type="button" class="spell-chip ${s.prepared ? 'is-prepared' : ''}" data-act="spell-jump" data-id="${s.spell_id}">${esc(s.name)}</button>`)
                  .join('')}</div>
                <div class="spell-list">${spells.map(spellCard).join('')}</div>`
              : '<div class="empty">Žádná kouzla.</div>'
          }
        </div>
      </div>`;
  }

  function spellCard(s) {
    const meta = [
      ['Vyvolání', s.casting_time],
      ['Dosah', s.range_text],
      ['Složky', s.components_text ? s.components_text + (s.material ? ` (${s.material})` : '') : ''],
      ['Trvání', s.duration_text ? s.duration_text + (s.concentration ? ' (Soustředění)' : '') : ''],
    ].filter(([, v]) => !isBlank(v));
    return `<div class="spell" id="spell-${s.spell_id}">
      <div class="spell__head">
        <div><strong>${esc(s.name)}</strong> <span class="small muted">${s.level === 0 ? 'Trik' : s.level + '. stupeň'}${s.school ? ' · ' + esc(s.school) : ''}${s.ritual ? ' · rituál' : ''}</span></div>
        <div class="row-gap" style="flex-wrap:nowrap">
          <label class="toggle small"><input type="checkbox" data-prepared="${s.spell_id}" ${s.prepared ? 'checked' : ''}><span class="toggle__slider"></span>Připravené</label>
          <button class="btn btn-danger btn-sm btn-icon" type="button" data-act="spell-remove" data-id="${s.spell_id}" aria-label="Odebrat kouzlo">✕</button>
        </div>
      </div>
      <div class="spell__detail" ${s.prepared ? '' : 'hidden'}>
        <div class="spell__meta">${meta.map(([k, v]) => `<div><span class="muted">${k}:</span> ${esc(v)}</div>`).join('')}</div>
        ${!isBlank(s.description) ? `<div class="pre" style="margin-top:6px;line-height:1.45">${esc(s.description)}</div>` : ''}
      </div>
    </div>`;
  }

  function tabInventar(c) {
    const items = listItems(id);
    return `<p class="small muted">Když předmět v katalogu nenajdeš, přidej předmět s názvem „Další“ a popiš ho v poznámce.</p>
      <div class="card mt-0">
        <div class="row-between">
          <div class="row-gap">
            <strong style="margin-right:6px">Měšec</strong>
            <span class="coin-val"><strong>${c.mesec_zl}</strong><img class="coin" src="icons/zl_mince.png" alt="Zl"></span>
            <span class="coin-val"><strong>${c.mesec_st}</strong><img class="coin" src="icons/st_mince.png" alt="St"></span>
            <span class="coin-val"><strong>${c.mesec_md}</strong><img class="coin" src="icons/md_mince.png" alt="Md"></span>
            <button class="btn btn-primary-outline btn-sm" type="button" data-act="wallet" data-mode="income">Příjem</button>
            <button class="btn btn-danger btn-sm" type="button" data-act="wallet" data-mode="expense">Výdaj</button>
          </div>
          <button class="btn btn-sm" type="button" data-act="item-add">+ Přidat předmět</button>
        </div>
        <hr class="sep">
        ${
          items.length
            ? `<div class="table-wrap"><table class="table inv-table">
                <thead><tr><th>Název</th><th class="t-center">Množství</th><th class="t-center">Vybaveno</th></tr></thead>
                <tbody>${items
                  .map(
                    (it) => `<tr class="inv-row">
                      <td><button class="link-btn" type="button" data-act="item-info" data-id="${it.item_id}">${esc(it.jmeno)}</button>
                        <div class="small muted">${esc([it.kategorie, it.podkategorie].filter(Boolean).join(' / '))}</div></td>
                      <td class="t-center"><div class="qty">
                        <button class="btn btn-secondary btn-sm btn-icon" type="button" data-act="item-qty" data-row="${it.row_id}" data-d="-1" aria-label="Méně">−</button>
                        <span class="qty__val">${it.mnozstvi}</span>
                        <button class="btn btn-secondary btn-sm btn-icon" type="button" data-act="item-qty" data-row="${it.row_id}" data-d="1" aria-label="Více">+</button></div></td>
                      <td class="t-center"><label class="toggle" aria-label="Vybaveno"><input type="checkbox" data-equip="${it.row_id}" ${it.equipped ? 'checked' : ''}><span class="toggle__slider"></span></label></td>
                    </tr>
                    <tr class="inv-note"><td colspan="3"><input data-item-note="${it.row_id}" value="${esc(it.poznamka)}" placeholder="Poznámka…"></td></tr>`
                  )
                  .join('')}</tbody></table></div>`
            : '<div class="empty">Inventář je prázdný.</div>'
        }
      </div>`;
  }

  function drawTab() {
    const c = getCharacter(id);
    const fn = { postava: tabPostava, vlastnosti: tabVlastnosti, boj: tabBoj, kouzla: tabKouzla, inventar: tabInventar }[tab];
    $('#c_tab').innerHTML = fn(c);
    root.querySelectorAll('textarea.autosize').forEach(autosize);
  }

  function redraw() {
    drawHead();
    const y = window.scrollY;
    drawTab();
    window.scrollTo(0, y);
  }

  function autosize(t) {
    t.style.height = 'auto';
    t.style.height = Math.max(t.scrollHeight, 70) + 'px';
  }

  // ---------------------------------------------------------------------
  // Modální okna

  function openRename() {
    const c = getCharacter(id);
    const m = openModal({
      title: 'Přejmenovat postavu',
      body: `<label class="field">Jméno<input data-v maxlength="50" value="${esc(c.jmeno)}" autofocus></label>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Uložit</button>',
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      try {
        setField(id, 'jmeno', m.el.querySelector('[data-v]').value);
        m.close();
        drawHead();
      } catch (e) {
        toast(e.message, 'err');
      }
    });
  }

  function openHp() {
    const c = getCharacter(id);
    const m = openModal({
      title: 'Body výdrže',
      body: `<div class="grid grid-2">
          <div class="field"><span>BV teď</span>${stepperHtml('data-cur', c.bv_ted ?? '', { min: 0, placeholder: '—', label: 'BV teď' })}</div>
          <div class="field"><span>BV max</span>${stepperHtml('data-max', c.bv_max ?? '', { min: 0, placeholder: '—', label: 'BV max' })}</div>
        </div>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Uložit</button>',
    });
    bindSteppers(m.el);
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      const num = (s) => {
        const v = parseInt(m.el.querySelector(s).value, 10);
        return Number.isFinite(v) ? v : null;
      };
      setHp(id, num('[data-cur]'), num('[data-max]'));
      m.close();
      redraw();
    });
  }

  function openChecklist(title, all, selected, onSave) {
    const set = new Set(selected);
    const m = openModal({
      title,
      wide: true,
      body: `<div class="checklist">${all
        .map((o) => `<label class="check checklist__item"><input type="checkbox" value="${esc(o)}" ${set.has(o) ? 'checked' : ''}>${esc(o)}</label>`)
        .join('')}</div>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Uložit</button>',
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      onSave([...m.el.querySelectorAll('.checklist input:checked')].map((i) => i.value));
      m.close();
      redraw();
    });
  }

  function openPassiveOther() {
    const opts = Object.keys(SKILL_ABILITY).filter((s) => !PASSIVE_BASE.includes(s));
    const m = openModal({
      title: 'Jiná pasivní dovednost',
      body: `<label class="field">Dovednost<select data-v><option value="">Vyber dovednost…</option>${opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Vybrat</button>',
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      const v = m.el.querySelector('[data-v]').value;
      if (!v) return;
      setProfState(id, 'passive', v, 1);
      m.close();
      redraw();
    });
  }

  function openWallet(mode) {
    const m = openModal({
      title: mode === 'income' ? 'Měšec – příjem' : 'Měšec – výdaj',
      body: `<div class="grid">
          ${['zl', 'st', 'md']
            .map(
              (k) => `<div class="field"><span class="row-gap"><img class="coin" src="icons/${k}_mince.png" alt="">${k === 'zl' ? 'Zlaťáky' : k === 'st' ? 'Stříbrňáky' : 'Měďáky'}</span>
                ${stepperHtml(`data-coin="${k}"`, 0, { min: 0, label: k })}</div>`
            )
            .join('')}
          <p class="small muted" style="margin:0">Přepočet: 1 Zl = 10 St, 1 St = 10 Md. ${mode === 'expense' ? 'Drobné se rozmění automaticky.' : ''}</p>
        </div>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Potvrdit</button>',
    });
    bindSteppers(m.el);
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      const v = (k) => Math.max(0, parseInt(m.el.querySelector(`[data-coin="${k}"]`).value, 10) || 0) * (mode === 'income' ? 1 : -1);
      try {
        walletAdjust(id, v('zl'), v('st'), v('md'));
        m.close();
        redraw();
      } catch (e) {
        toast(e.message, 'err');
      }
    });
  }

  function openAddItem() {
    let picked = null;
    const m = openModal({
      title: 'Přidat předmět',
      body: `<div class="grid">
          <label class="field">Název<input type="search" data-q placeholder="Začni psát název…" autocomplete="off" autofocus></label>
          <div class="pick-list" data-results style="max-height:240px"></div>
          <div class="small" data-picked></div>
          <div class="grid" style="grid-template-columns:auto 1fr;align-items:end">
            <div class="field"><span>Počet ks</span>${stepperHtml('data-qty', 1, { min: 1, label: 'Počet' })}</div>
            <label class="field">Poznámka<input data-note maxlength="255" placeholder="Volitelné…"></label>
          </div>
        </div>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Přidat</button>',
    });
    bindSteppers(m.el);
    const box = m.el.querySelector('[data-results]');
    m.el.querySelector('[data-q]').addEventListener(
      'input',
      debounce((e) => {
        const q = norm(e.target.value);
        if (q.length < 2) {
          box.innerHTML = '';
          return;
        }
        const hits = catalog().items.filter((it) => it._n.includes(q)).slice(0, 20);
        box.innerHTML =
          hits
            .map(
              (it) => `<button type="button" class="pick-item pick-item--tap" data-pick="${it.id}"><span class="pick-item__main"><span class="pick-item__name">${esc(it.jmeno)}</span>
                <span class="pick-item__meta">${esc([it.kategorie, it.podkategorie, it.vzacnost].filter(Boolean).join(' · '))}</span></span></button>`
            )
            .join('') || '<div class="empty">Nic nenalezeno.</div>';
      }, 150)
    );
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      picked = Number(b.dataset.pick);
      box.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('is-picked', x === b));
      m.el.querySelector('[data-picked]').innerHTML = `Vybráno: <strong>${esc(catalog().itemById.get(picked).jmeno)}</strong>`;
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      if (!picked) return toast('Vyber předmět ze seznamu.', 'warn');
      addItem(id, picked, parseInt(m.el.querySelector('[data-qty]').value, 10) || 1, m.el.querySelector('[data-note]').value);
      m.close();
      toast('Předmět přidán.');
      redraw();
    });
  }

  function openSpellPicker() {
    const c = getCharacter(id);
    const owned = new Set(listSpells(id).map((s) => s.spell_id));
    const chosen = new Set();
    const m = openModal({
      title: 'Přidat kouzlo',
      wide: true,
      body: `<label class="field">Vyhledat kouzlo (hledá i mimo povolání postavy)<input type="search" data-q placeholder="Začni psát název kouzla…" autocomplete="off"></label>
        <p class="small muted">Bez vyhledávání se zobrazují <strong>triky</strong> a kouzla pro povolání${c.povolani ? ` <strong>${esc(c.povolani)}</strong>` : ''}. Klepnutím kouzlo vybereš.</p>
        <div class="pick-list" data-list style="max-height:min(55vh,560px)"></div>`,
      foot: '<span class="small muted" data-count style="margin-right:auto"></span><button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Přidat vybraná</button>',
    });
    const list = m.el.querySelector('[data-list]');
    const draw = () => {
      const q = norm(m.el.querySelector('[data-q]').value);
      const classMatch = (s) => s.level === 0 || (c.povolani && s._classes.includes(c.povolani));
      const rows = catalog()
        .spells.filter((s) => (q ? s._n.includes(q) : classMatch(s)))
        .sort((a, b) => owned.has(a.id) - owned.has(b.id) || classMatch(b) - classMatch(a) || (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name, 'cs'))
        .slice(0, 150);
      list.innerHTML =
        rows
          .map((s) => {
            const has = owned.has(s.id);
            return `<button type="button" class="pick-item pick-item--tap ${chosen.has(s.id) ? 'is-picked' : ''}" data-sid="${s.id}" ${has ? 'disabled' : ''}>
              <span class="pick-item__main"><span class="pick-item__name">${esc(s.name)}</span>
              <span class="pick-item__meta">${esc([spellLevelLabel(s.level), s.school, s.casting_time, s.range_text, s.duration_text].filter(Boolean).join(' · '))}</span></span>
              <span class="badge ${has ? 'badge--muted' : chosen.has(s.id) ? 'badge--accent' : ''}">${has ? 'přidáno' : chosen.has(s.id) ? '✓' : '+'}</span></button>`;
          })
          .join('') || '<div class="empty">Nic nenalezeno.</div>';
      m.el.querySelector('[data-count]').textContent = chosen.size ? `Vybráno: ${chosen.size}` : '';
    };
    m.el.querySelector('[data-q]').addEventListener('input', debounce(draw, 120));
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sid]');
      if (!b || b.disabled) return;
      const sid = Number(b.dataset.sid);
      if (chosen.has(sid)) chosen.delete(sid);
      else chosen.add(sid);
      draw();
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      if (!chosen.size) return toast('Nevybral jsi žádná kouzla.', 'warn');
      const n = addSpells(id, [...chosen]);
      m.close();
      toast(`Přidáno kouzel: ${n}`);
      redraw();
    });
    draw();
  }

  function openLevelUp() {
    const c = getCharacter(id);
    const m = openModal({
      title: `Nová úroveň (${c.uroven} → ${c.uroven + 1})`,
      wide: true,
      body: `<div class="grid">
          <div class="grid grid-2">
            <div class="field"><span>O kolik se zvedají body výdrže</span>${stepperHtml('data-hp', 0, { min: 0, max: 999, label: 'Přírůstek BV' })}</div>
            <div class="field"><span>Zdatnostní bonus</span>${stepperHtml('data-prof', c.zdatnostni_bonus ?? 2, { min: 0, max: 99, label: 'Zdatnostní bonus' })}</div>
          </div>
          <div class="slots-row">
            <div><div class="slots-title">Pozice kouzel</div><div class="small muted">Zaškrtni pozice, které má postava k dispozici.</div>${slotGridHtml({ mode: 'pick', selected: c.pripravena_kouzla })}</div>
            <div><div class="slots-title">Použití truhly</div><div class="small muted">Zaškrtni dostupné pozice truhly.</div>${chestGridHtml({ mode: 'pick', selected: c.dostupna_truhla })}</div>
          </div>
          <p class="small" style="margin:0;line-height:1.5">Nové schopnosti přidáš v záložce <strong>Postava</strong>, vlastnosti a zdatnosti v záložce <strong>Vlastnosti a zdatnosti</strong>, nová kouzla v záložce <strong>Kouzla</strong>.</p>
          <p class="small" style="color:#ffcf8a;margin:0">Před uložením vše zkontroluj. Uložení zvýší úroveň postavy o 1.</p>
        </div>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Uložit novou úroveň</button>',
    });
    bindSteppers(m.el);
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      try {
        const r = levelUp(id, {
          hpGain: m.el.querySelector('[data-hp]').value || 0,
          profBonus: m.el.querySelector('[data-prof]').value,
          spellSlots: readSlotGrid(m.el),
          chestSlots: readChestGrid(m.el),
        });
        m.close();
        toast(`Úroveň ${r.uroven}! BV ${r.bv_ted}/${r.bv_max}`);
        redraw();
      } catch (e) {
        toast(e.message, 'err');
      }
    });
  }

  // ---------------------------------------------------------------------
  // Události

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = b.dataset;
    try {
      switch (d.act) {
        case 'tab':
          tab = d.tab;
          savePref('char-tab', { tab });
          drawHead();
          drawTab();
          break;
        case 'rename':
          openRename();
          break;
        case 'levelup':
          openLevelUp();
          break;
        case 'delta':
          applyDelta(id, d.field, Number(d.d));
          redraw();
          break;
        case 'hp-edit':
          openHp();
          break;
        case 'ab':
          abilityDelta(id, d.col, Number(d.d));
          redraw();
          break;
        case 'prof':
          setProfState(id, d.kind, d.name, cycleState(Number(d.state)));
          redraw();
          break;
        case 'passive-other':
          openPassiveOther();
          break;
        case 'tools-pick': {
          const c = getCharacter(id);
          openChecklist('Zdatnost s pomůckami', TOOLS, [...new Set([...c.zd_pomucky, ...c.kv_pomucky])], (list) => setTools(id, list));
          break;
        }
        case 'weapons-pick':
          openChecklist('Zdatnost se zbraněmi', WEAPONS, getCharacter(id).zd_zbrane.vyber, (list) => setWeapons(id, list));
          break;
        case 'wgroup':
          setWeaponGroup(id, d.key, d.state !== '1');
          redraw();
          break;
        case 'armor':
          setArmorProf(id, d.key, d.state !== '1');
          redraw();
          break;
        case 'wallet':
          openWallet(d.mode);
          break;
        case 'item-add':
          openAddItem();
          break;
        case 'item-info':
          showItemModal(Number(d.id));
          break;
        case 'item-qty': {
          const row = Number(d.row);
          const delta = Number(d.d);
          const qty = Number(b.closest('.qty')?.querySelector('.qty__val')?.textContent);
          if (delta < 0 && qty === 1 && !(await confirmDialog('Odhodit předmět?', { okText: 'Odhodit', danger: true }))) return;
          itemQtyDelta(id, row, delta);
          redraw();
          break;
        }
        case 'spell-add':
          openSpellPicker();
          break;
        case 'spell-remove': {
          const s = catalog().spellById.get(Number(d.id));
          if (!(await confirmDialog(`Odebrat kouzlo „${s?.name ?? ''}“ z postavy?`, { okText: 'Odebrat', danger: true }))) return;
          removeSpell(id, Number(d.id));
          redraw();
          break;
        }
        case 'spell-jump': {
          const el = root.querySelector('#spell-' + d.id);
          if (el) {
            // Kouzlo pod přilepený seznam (horní lišta + seznam kouzel).
            const chips = root.querySelector('.spell-chips');
            const stuckTop = parseFloat(getComputedStyle(chips).top) || 0;
            const bar = stuckTop + chips.getBoundingClientRect().height;
            window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - bar - 10), behavior: 'smooth' });
            el.classList.remove('flash');
            void el.offsetWidth;
            el.classList.add('flash');
          }
          break;
        }
        case 'slots-reset':
          if (!(await confirmDialog('Uvolnit všechny použité pozice kouzel a truhly?', { okText: 'Uvolnit' }))) return;
          resetSlots(id);
          redraw();
          break;
      }
    } catch (err) {
      toast(err.message || String(err), 'err');
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    try {
      if (t.matches('select[data-field]')) {
        setField(id, t.dataset.field, t.value);
        redraw();
      } else if (t.matches('[data-item-note]')) {
        setItemNote(id, Number(t.dataset.itemNote), t.value);
      } else if (t.matches('[data-equip]')) {
        try {
          setItemEquipped(id, Number(t.dataset.equip), t.checked);
        } catch (err) {
          t.checked = false;
          throw err;
        }
        redraw();
      } else if (t.matches('[data-prepared]')) {
        setSpellPrepared(id, Number(t.dataset.prepared), t.checked);
        t.closest('.spell').querySelector('.spell__detail').hidden = !t.checked;
        root.querySelector(`.spell-chip[data-id="${t.dataset.prepared}"]`)?.classList.toggle('is-prepared', t.checked);
      } else if (t.matches('[data-slot-lvl]')) {
        setSpellSlotUsed(id, t.dataset.slotLvl, t.dataset.slotPos, t.checked);
      } else if (t.matches('[data-chest-pos]')) {
        setChestUsed(id, t.dataset.chestPos, t.checked);
      }
    } catch (err) {
      toast(err.message || String(err), 'err');
    }
  });

  // Texty: ukládání průběžně, bez překreslení (kurzor zůstane).
  // Každé pole má vlastní odklad, aby se rychlé psaní do dvou polí navzájem nepřepsalo.
  const savers = {};
  const saveText = (field, value) => {
    savers[field] ||= debounce((v) => setField(id, field, v), 500);
    savers[field](value);
  };
  root.addEventListener('input', (e) => {
    const t = e.target.closest('textarea[data-text]');
    if (!t) return;
    autosize(t);
    saveText(t.dataset.text, t.value);
  });

  const note = $('textarea[data-text="poznamka"]');
  note.value = getCharacter(id).poznamka ?? '';
  autosize(note);
  note.classList.add('autosize');

  drawHead();
  drawTab();
}
