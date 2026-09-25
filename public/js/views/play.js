// Vedení boje – přepis encounter_play.php (iniciativa, tahy, kola, BV, stavy, spawn, loot).

import { catalog } from '../catalog.js';
import {
  addEffect,
  deleteEffect,
  endCombat,
  ensureActive,
  getEncounter,
  getInstance,
  instanceLabel,
  isPc,
  isSimple,
  listEffects,
  listInstances,
  nextTurn,
  reopenCombat,
  resetInstances,
  revive,
  rollInitiativeAll,
  rollInitiativeOne,
  setDefeated,
  setEncounterField,
  setHp,
  setInitiative,
  setInstanceNote,
  setPcInitiatives,
  spawnMonster,
  spawnSimple,
  startEncounter,
  syncPcHpFromParty,
  toggleEffect,
} from '../store.js';
import { d20, debounce, DICE_ICON, esc, isBlank, norm, openModal, confirmDialog, toast, BACK_ICON } from '../util.js';
import { mountLoot } from './loot.js';
import { showMonsterModal, statblockHtml } from './monsters.js';

const EFFECT_PRESETS = [
  'Otřesení', 'Omráčení', 'Paralyzování', 'Bezvědomí', 'Ležení', 'Chycení', 'Zadržení', 'Zakleknutí',
  'Ohluchnutí', 'Oslepnutí', 'Otrávení', 'Únava', 'Neviditelnost', 'Zkamenění', 'Zmámení', 'Vystrašení',
];

export function render(host, eid) {
  let enc = getEncounter(eid);
  if (!enc) {
    host.innerHTML = `<div class="card"><h2>Střetnutí nenalezeno</h2><a class="btn btn-secondary" href="#/encounters">Zpět</a></div>`;
    return;
  }
  // Vlastní obal – posluchače nesmí viset na #app, který přežívá přechody mezi stránkami.
  const root = document.createElement('div');
  host.appendChild(root);
  if (enc.phase === 'prepared') startEncounter(eid);
  else if (enc.phase === 'playing') syncPcHpFromParty(eid);
  enc = getEncounter(eid);

  const c = catalog();
  let order = []; // pořadí karet (ID) – mění se jen při plném překreslení
  let wakeLock = null;

  const byId = () => new Map(listInstances(eid).map((i) => [i.id, i]));
  const effectsFor = (iid) => listEffects(eid).filter((e) => e.instance_id === iid);
  const ended = () => getEncounter(eid).phase === 'ended';

  // -------------------------------------------------------------------------
  // Kostra stránky

  root.innerHTML = `
    <div class="page-head">
      <h1 id="p_title"></h1>
      <a class="btn btn-secondary btn-sm btn-icon" href="#/encounter/${eid}" aria-label="Detail střetnutí">${BACK_ICON}</a>
    </div>

    <div class="roundbar" id="p_bar">
      <div class="roundbar__round"><span class="roundbar__label">Kolo</span><span class="roundbar__num" id="p_round">1</span></div>
      <div class="roundbar__active" id="p_active"></div>
      <div class="roundbar__btns" id="p_btns"></div>
    </div>

    <div class="card" id="p_quick">
      <div class="row-gap" id="p_actions">
        <button class="btn btn-primary-outline" type="button" data-act="roll_all">Hodit iniciativu všem</button>
        <button class="btn btn-secondary" type="button" data-act="sort">Seřadit podle iniciativy</button>
        <button class="btn btn-danger" type="button" data-act="reset">Reset boje</button>
      </div>
      <label class="field" style="margin-top:12px">Poznámka ke střetnutí
        <textarea id="p_note" rows="2" maxlength="4000" placeholder="Poznámka…"></textarea></label>
      <div class="small muted" id="p_note_status" style="min-height:1.2em"></div>
    </div>

    <div class="play-layout">
      <aside class="play-side">
        <details class="card card--tight" open>
          <summary><strong style="color:var(--text);font-size:15px">Přehled pořadí</strong></summary>
          <ul class="overview" id="p_overview" style="margin-top:6px"></ul>
        </details>
        <details class="card card--tight" id="p_states_box">
          <summary><strong style="color:var(--text);font-size:15px">Stavy</strong></summary>
          <div class="grid" style="margin-top:8px" id="p_states">
            <label class="field">Účastník<select id="ef_inst"></select></label>
            <label class="field">Stav<select id="ef_preset"><option value="">— stav —</option>${EFFECT_PRESETS.map((p) => `<option>${p}</option>`).join('')}</select></label>
            <label class="field">Vlastní stav<input id="ef_name" placeholder="vlastní stav…"></label>
            <label class="field">Trvání (tahy)<input id="ef_dur" type="number" inputmode="numeric" placeholder="bez omezení"></label>
            <label class="field">Poznámka<input id="ef_notes" placeholder="poznámka"></label>
            <button class="btn btn-primary-outline" type="button" id="ef_add">Přidat stav</button>
          </div>
        </details>
      </aside>
      <section>
        <div class="pcards" id="p_cards"></div>
      </section>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);

  // -------------------------------------------------------------------------
  // Vykreslení

  function subLine(i) {
    if (isPc(i)) return 'hráčská postava' + (i.level ? ' · úroveň ' + i.level : '');
    if (isSimple(i)) return ['zjednodušený protivník', i.simple_ac != null ? 'OČ ' + i.simple_ac : ''].filter(Boolean).join(' · ');
    const m = c.monsterById.get(i.monster_id);
    return [m?.kategorie, m?.nebezpecnost ? 'CR ' + m.nebezpecnost : ''].filter(Boolean).join(' · ');
  }

  function cardHtml(i, activeId) {
    const pc = isPc(i);
    const dead = !!i.is_defeated;
    const active = i.id === activeId;
    const m = !pc && !isSimple(i) ? c.monsterById.get(i.monster_id) : null;
    const effs = effectsFor(i.id);
    const pct = i.hp_max ? Math.max(0, Math.min(100, ((i.hp_current ?? 0) / i.hp_max) * 100)) : null;
    const low = pct !== null && pct <= 25;

    return `<article class="pcard ${active ? 'is-active' : ''} ${dead ? 'is-dead' : ''} ${pc ? 'is-pc' : ''}" id="inst-${i.id}" data-iid="${i.id}">
      <div class="pcard__head">
        <div class="pcard__title">
          <span class="pcard__name">${esc(instanceLabel(i))}</span>
          ${i.is_boss && !pc ? '<span class="badge badge--danger">BOSS</span>' : ''}
          ${dead ? '<span class="badge badge--muted">VYŘAZEN</span>' : ''}
          ${active ? '<span class="badge badge--ok">NA TAHU</span>' : ''}
        </div>
        <label class="toggle small" title="Mrtvý / mimo boj"><input type="checkbox" data-defeat ${dead ? 'checked' : ''}><span class="toggle__slider"></span>mimo boj</label>
      </div>
      <div class="pcard__sub">${esc(subLine(i))}</div>

      <div class="pcard__ctrls">
        <div class="pcard__ctrl">
          <span class="pcard__ctrl-label">Iniciativa</span>
          <button class="btn btn-ghost btn-sm pcard__init" type="button" data-init-edit title="Zadat ručně">${i.initiative ?? '—'}</button>
          <button class="btn btn-secondary btn-sm btn-icon" type="button" data-roll title="Hodit d20">${DICE_ICON}</button>
        </div>
        <div class="pcard__ctrl hp">
          <span class="pcard__ctrl-label">BV</span>
          <button class="btn btn-secondary btn-sm btn-icon" type="button" data-hp="-1" aria-label="Ubrat 1">−</button>
          <button class="hp__val ${low ? 'is-low' : ''}" type="button" data-hp-edit>${i.hp_current ?? '—'}/${i.hp_max ?? '—'}</button>
          <button class="btn btn-secondary btn-sm btn-icon" type="button" data-hp="1" aria-label="Přidat 1">+</button>
        </div>
      </div>
      ${pct !== null ? `<div class="hp-bar"><div class="hp-bar__fill ${pct <= 25 ? 'is-low' : pct <= 50 ? 'is-mid' : ''}" style="width:${pct}%"></div></div>` : ''}

      <div class="pcard__note"><input type="text" data-note value="${esc(i.notes)}" maxlength="120" placeholder="krátká poznámka…" aria-label="Poznámka"></div>

      ${
        effs.length
          ? `<div class="effects">${effs
              .map(
                (ef) => `<span class="effect ${ef.is_active ? '' : 'is-off'}" data-eff="${ef.id}">${esc(ef.name)}${
                  ef.duration_rounds != null ? ` (${ef.duration_rounds})` : ''
                }${ef.notes ? ' · ' + esc(ef.notes) : ''}
                  <button type="button" data-eff-toggle title="Zapnout/vypnout">⟲</button><button type="button" data-eff-del title="Smazat">✕</button></span>`
              )
              .join('')}</div>`
          : ''
      }

      ${
        isSimple(i) && !isBlank(i.simple_attack)
          ? `<div class="pcard__details statblock"><span class="statblock__text-label">Útok:</span> ${esc(i.simple_attack)}</div>`
          : ''
      }
      ${
        m
          ? `<details class="pcard__details" ${dead ? '' : 'open'}>
              <summary>Staty a detaily</summary>
              ${statblockHtml(m, { hpOverride: i.hp_max })}
              <button class="link-btn small" type="button" data-full="${m.id}" data-keep style="margin-top:8px">Celý detail včetně kouzel</button>
            </details>`
          : ''
      }
    </article>`;
  }

  function drawHeader() {
    const e = getEncounter(eid);
    $('p_title').textContent = e.name;
    $('p_round').textContent = e.round_no;
    const act = e.active_instance_id ? getInstance(eid, e.active_instance_id) : null;
    $('p_active').innerHTML = e.phase === 'ended' ? '<strong>Boj ukončen</strong> – jen pro čtení' : act ? `Na tahu: <strong>${esc(instanceLabel(act))}</strong>` : '';
    $('p_btns').innerHTML =
      e.phase === 'ended'
        ? `<button class="btn btn-secondary btn-sm" type="button" data-act="loot">Loot</button>
           <button class="btn btn-ghost btn-sm" type="button" data-act="reopen">Znovu otevřít boj</button>`
        : `<button class="btn" type="button" data-act="next">Další tah ▸</button>
           <button class="btn btn-secondary btn-sm" type="button" data-act="loot">Loot</button>
           <button class="btn btn-secondary btn-sm" type="button" data-act="spawn">+ Protivník</button>
           <button class="btn btn-danger btn-sm" type="button" data-act="end">Konec boje</button>`;
    root.classList.toggle('is-readonly', e.phase === 'ended');
    $('p_actions').hidden = e.phase === 'ended';
    $('p_states_box').hidden = e.phase === 'ended';
  }

  function drawOverview() {
    const e = getEncounter(eid);
    const map = byId();
    $('p_overview').innerHTML = order
      .map((id) => map.get(id))
      .filter(Boolean)
      .map(
        (i) => `<li class="${i.id === e.active_instance_id ? 'is-active' : ''} ${i.is_defeated ? 'is-dead' : ''}">
          <button type="button" data-focus="${i.id}"><span class="overview__name">${esc(instanceLabel(i))}${i.is_boss && !isPc(i) ? ' ★' : ''}</span>
          <span class="overview__init">${i.initiative ?? '—'}</span></button></li>`
      )
      .join('');
    // Výběr účastníka pro stavy
    const sel = $('ef_inst');
    const cur = sel.value;
    sel.innerHTML =
      '<option value="">— vyber účastníka —</option>' +
      order
        .map((id) => map.get(id))
        .filter(Boolean)
        .map((i) => `<option value="${i.id}">${esc(instanceLabel(i))}</option>`)
        .join('');
    sel.value = cur || (e.active_instance_id ? String(e.active_instance_id) : '');
  }

  function drawCards() {
    const e = getEncounter(eid);
    const map = byId();
    $('p_cards').innerHTML = order.length
      ? order
          .map((id) => map.get(id))
          .filter(Boolean)
          .map((i) => cardHtml(i, e.active_instance_id))
          .join('')
      : '<div class="card empty">Střetnutí nemá žádné účastníky.</div>';
  }

  function updateCard(iid) {
    const el = root.querySelector('#inst-' + iid);
    const i = getInstance(eid, iid);
    if (!el || !i) return;
    const wasOpen = el.querySelector('details')?.open;
    el.outerHTML = cardHtml(i, getEncounter(eid).active_instance_id);
    const d = root.querySelector('#inst-' + iid + ' details');
    if (d && wasOpen !== undefined) d.open = wasOpen;
  }

  function fullRender({ resort = true } = {}) {
    if (resort) order = listInstances(eid).map((i) => i.id);
    drawHeader();
    drawOverview();
    drawCards();
  }

  function scrollToCard(iid, flash = false) {
    const el = root.querySelector('#inst-' + iid);
    if (!el) return;
    const bar = $('p_bar').getBoundingClientRect().height;
    const top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'), 10) || 60;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - top - bar - 24), behavior: 'smooth' });
    if (flash) {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }

  // -------------------------------------------------------------------------
  // Iniciativa postav (modal na začátku boje a při shodě)

  function maybeAskPcInitiative() {
    const e = getEncounter(eid);
    if (e.phase !== 'playing') return;
    const pcs = listInstances(eid).filter(isPc);
    const pending = e.pc_tie_pending ? JSON.parse(e.pc_tie_pending) : [];
    if (!e.pc_init_done && pcs.length && pcs.some((p) => !(p.initiative > 0))) {
      askInitiative(pcs, false);
    } else if (pending.length) {
      askInitiative(pcs.filter((p) => pending.includes(p.id)), true);
    } else {
      ensureActive(eid);
    }
  }

  function askInitiative(pcs, isTie) {
    const m = openModal({
      title: isTie ? 'Shoda iniciativ' : 'Iniciativa hráčů',
      dismissible: false,
      body: `<p class="muted" style="margin-top:0">${
        isTie
          ? 'Shoda iniciativ – protivníkům se přehodila automaticky, hrdinům zadej novou hodnotu.'
          : 'Zadej iniciativu hrdinů (hod d20 + bonus). Po potvrzení se všichni seřadí.'
      }</p>
      <div class="grid">
        ${pcs
          .map(
            (p, idx) => `<div class="row-gap" style="flex-wrap:nowrap">
              <label class="field" style="flex:1">${esc(instanceLabel(p))}
                <input type="number" inputmode="numeric" min="1" max="40" data-pc="${p.id}" value="${!isTie && p.initiative > 0 ? p.initiative : ''}" placeholder="d20+" ${idx === 0 ? 'autofocus' : ''}></label>
              <button class="btn btn-secondary btn-icon" type="button" data-rnd="${p.id}" title="Hodit d20" style="align-self:end">${DICE_ICON}</button>
            </div>`
          )
          .join('')}
      </div>`,
      foot: '<button class="btn" type="button" data-ok>Potvrdit iniciativu</button>',
    });
    m.el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-rnd]');
      if (r) m.el.querySelector(`[data-pc="${r.dataset.rnd}"]`).value = d20();
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      const map = {};
      m.el.querySelectorAll('[data-pc]').forEach((inp) => (map[inp.dataset.pc] = inp.value));
      const pending = setPcInitiatives(eid, map);
      m.close();
      fullRender();
      if (pending.length) {
        toast('Shoda iniciativ – zadej prosím nové hodnoty.', 'warn');
        askInitiative(listInstances(eid).filter((p) => pending.includes(p.id)), true);
      } else {
        toast(isTie ? 'Shody iniciativ vyřešeny.' : 'Iniciativa hráčů uložena.');
        const a = getEncounter(eid).active_instance_id;
        if (a) scrollToCard(a);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Dialog BV

  function openHpDialog(iid) {
    const i = getInstance(eid, iid);
    if (!i) return;
    const m = openModal({
      title: 'Body výdrže – ' + instanceLabel(i),
      body: `<div class="grid">
        <label class="field">Hodnota<input type="number" inputmode="numeric" data-amount min="0" placeholder="např. 7" autofocus></label>
        <div class="grid grid-3">
          <button class="btn btn-danger" type="button" data-mode="dmg">Zranit</button>
          <button class="btn btn-primary-outline" type="button" data-mode="heal">Vyléčit</button>
          <button class="btn btn-secondary" type="button" data-mode="set">Nastavit</button>
        </div>
        <hr class="sep" style="margin:4px 0">
        <label class="field">Maximum BV<input type="number" inputmode="numeric" data-max min="0" value="${i.hp_max ?? ''}" placeholder="—"></label>
        <p class="small muted" style="margin:0">Aktuálně ${i.hp_current ?? '—'} / ${i.hp_max ?? '—'}. Léčení nepřekročí maximum.</p>
      </div>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zavřít</button><button class="btn" type="button" data-save-max>Uložit maximum</button>',
    });
    const amount = () => parseInt(m.el.querySelector('[data-amount]').value, 10);
    const maxVal = () => {
      const v = parseInt(m.el.querySelector('[data-max]').value, 10);
      return Number.isFinite(v) ? v : null;
    };
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) {
        const a = amount();
        if (!Number.isFinite(a)) return toast('Zadej hodnotu.', 'warn');
        const cur = getInstance(eid, iid);
        const max = maxVal();
        let next = cur.hp_current ?? max ?? 0;
        if (b.dataset.mode === 'dmg') next -= a;
        else if (b.dataset.mode === 'heal') next = max !== null ? Math.min(max, next + a) : next + a;
        else next = a;
        applyHp(iid, next, max);
        m.close();
      }
      if (e.target.closest('[data-save-max]')) {
        const cur = getInstance(eid, iid);
        const max = maxVal();
        applyHp(iid, cur.hp_current ?? max, max);
        m.close();
      }
    });
  }

  function applyHp(iid, cur, max) {
    const before = getInstance(eid, iid);
    const r = setHp(eid, iid, cur, max);
    if (r && r.is_defeated && !before.is_defeated) toast(instanceLabel(before) + ' je vyřazen.', 'warn');
    updateCard(iid);
    drawOverview();
  }

  // -------------------------------------------------------------------------
  // Přidání protivníka během boje

  function openSpawn() {
    const m = openModal({
      title: 'Přidat protivníky',
      wide: true,
      body: `<div class="tabs" role="tablist">
          <button class="btn btn-secondary btn-sm" type="button" data-tab="db" aria-selected="true">Z bestiáře</button>
          <button class="btn btn-secondary btn-sm" type="button" data-tab="simple" aria-selected="false">Zjednodušený</button>
        </div>
        <div data-pane="db" style="margin-top:12px">
          <div class="grid" style="grid-template-columns:1fr 130px">
            <label class="field">Vyhledat protivníka<input type="search" data-q placeholder="např. kostlivec, skřet…" autocomplete="off" autofocus></label>
            <label class="field">Počet<input type="number" inputmode="numeric" data-qty value="1" min="1" max="20"></label>
          </div>
          <div class="pick-list" data-results style="margin-top:10px"></div>
        </div>
        <div data-pane="simple" hidden style="margin-top:12px">
          <div class="grid grid-3">
            <label class="field">Jméno<input data-s="name" placeholder="Vyvolaný stín"></label>
            <label class="field">BV<input data-s="hp" type="number" inputmode="numeric" placeholder="12"></label>
            <label class="field">OČ<input data-s="ac" type="number" inputmode="numeric" placeholder="14"></label>
          </div>
          <label class="field" style="margin-top:10px">Útok (text)<input data-s="attack" placeholder="+5 na zásah, 1k6+3 sečné"></label>
          <button class="btn" type="button" data-simple-add style="margin-top:12px">Přidat</button>
        </div>`,
    });
    const after = (msg) => {
      m.close();
      toast(msg);
      fullRender();
    };
    m.el.querySelectorAll('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        m.el.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        m.el.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
      })
    );
    const results = m.el.querySelector('[data-results]');
    m.el.querySelector('[data-q]').addEventListener(
      'input',
      debounce((e) => {
        const q = norm(e.target.value);
        if (q.length < 2) {
          results.innerHTML = '';
          return;
        }
        const hits = c.monsters.filter((x) => x._n.includes(q)).slice(0, 20);
        results.innerHTML =
          hits
            .map(
              (x) => `<div class="pick-item"><div class="pick-item__main"><div class="pick-item__name">${esc(x.jmeno)}</div>
                <div class="pick-item__meta">${[x.nebezpecnost ? 'CR ' + x.nebezpecnost : '', x.obranne_cislo ? 'OČ ' + x.obranne_cislo : '', x.vydrz ? 'BV ' + x.vydrz : '']
                  .filter(Boolean)
                  .join(' · ')}</div></div>
                <button class="btn btn-sm" type="button" data-spawn="${x.id}">Přidat</button></div>`
            )
            .join('') || '<div class="empty">Nic nenalezeno.</div>';
      }, 150)
    );
    results.addEventListener('click', (e) => {
      const b = e.target.closest('[data-spawn]');
      if (!b) return;
      const qty = parseInt(m.el.querySelector('[data-qty]').value, 10) || 1;
      const added = spawnMonster(eid, Number(b.dataset.spawn), qty);
      after(`Přidáno: ${added.map((a) => `${a.label} (init ${a.initiative})`).join(', ')}`);
    });
    m.el.querySelector('[data-simple-add]').addEventListener('click', () => {
      const v = (k) => m.el.querySelector(`[data-s="${k}"]`).value.trim();
      const num = (k) => (v(k) === '' ? null : parseInt(v(k), 10));
      try {
        const r = spawnSimple(eid, { name: v('name'), hp: num('hp'), ac: num('ac'), attack: v('attack') });
        after(`Přidáno: ${r.label} (init ${r.initiative})`);
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  }

  function openLoot() {
    const m = openModal({ title: 'Loot', wide: true, body: '<div data-loot></div>' });
    mountLoot(m.el.querySelector('[data-loot]'), eid, { readOnly: ended() });
  }

  // -------------------------------------------------------------------------
  // Akce

  async function onAction(act) {
    switch (act) {
      case 'next': {
        const prev = getEncounter(eid).active_instance_id;
        const st = nextTurn(eid);
        if (prev) updateCard(prev); // tick efektů + zrušení zvýraznění
        if (st.active_instance_id) updateCard(st.active_instance_id);
        drawHeader();
        drawOverview();
        if (st.wrapped) toast('Kolo ' + st.round_no);
        if (st.active_instance_id) scrollToCard(st.active_instance_id);
        break;
      }
      case 'end':
        if (!(await confirmDialog('Opravdu ukončit boj? Po ukončení bude střetnutí jen pro čtení.', { okText: 'Ukončit boj', danger: true }))) return;
        endCombat(eid);
        toast('Boj ukončen.');
        fullRender({ resort: false });
        break;
      case 'reopen':
        reopenCombat(eid);
        fullRender({ resort: false });
        break;
      case 'loot':
        openLoot();
        break;
      case 'spawn':
        openSpawn();
        break;
      case 'roll_all':
        if (!(await confirmDialog('Přehodit iniciativu všem (d20), včetně hrdinů?', { okText: 'Hodit' }))) return;
        rollInitiativeAll(eid, true);
        toast('Iniciativa byla hozena a seřazena.');
        fullRender();
        break;
      case 'sort':
        fullRender();
        break;
      case 'reset':
        if (!(await confirmDialog('Resetovat boj? Iniciativy se smažou, BV se obnoví na maximum, všichni se vrátí do boje a začne se od 1. kola.', { okText: 'Resetovat', danger: true })))
          return;
        resetInstances(eid);
        rollInitiativeAll(eid, false);
        toast('Stav účastníků byl resetován.');
        fullRender();
        maybeAskPcInitiative();
        fullRender();
        break;
    }
  }

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (a) {
      onAction(a.dataset.act);
      return;
    }
    const focus = e.target.closest('[data-focus]');
    if (focus) {
      const iid = Number(focus.dataset.focus);
      $('ef_inst').value = String(iid);
      scrollToCard(iid, true);
      return;
    }
    const full = e.target.closest('[data-full]');
    if (full) {
      showMonsterModal(Number(full.dataset.full));
      return;
    }

    const card = e.target.closest('[data-iid]');
    if (!card || ended()) return;
    const iid = Number(card.dataset.iid);

    if (e.target.closest('[data-roll]')) {
      rollInitiativeOne(eid, iid);
      updateCard(iid);
      drawOverview();
    } else if (e.target.closest('[data-init-edit]')) {
      const i = getInstance(eid, iid);
      const m = openModal({
        title: 'Iniciativa – ' + instanceLabel(i),
        body: `<label class="field">Iniciativa<input type="number" inputmode="numeric" data-v value="${i.initiative ?? ''}" autofocus></label>`,
        foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Uložit</button>',
      });
      m.el.querySelector('[data-ok]').addEventListener('click', () => {
        setInitiative(eid, iid, m.el.querySelector('[data-v]').value);
        m.close();
        updateCard(iid);
        drawOverview();
      });
    } else if (e.target.closest('[data-hp]')) {
      const i = getInstance(eid, iid);
      const delta = Number(e.target.closest('[data-hp]').dataset.hp);
      const cur = i.hp_current ?? i.hp_max ?? 0;
      applyHp(iid, Math.max(0, cur + delta), i.hp_max);
    } else if (e.target.closest('[data-hp-edit]')) {
      openHpDialog(iid);
    } else if (e.target.closest('[data-eff-toggle]')) {
      toggleEffect(eid, Number(e.target.closest('[data-eff]').dataset.eff));
      updateCard(iid);
    } else if (e.target.closest('[data-eff-del]')) {
      deleteEffect(eid, Number(e.target.closest('[data-eff]').dataset.eff));
      updateCard(iid);
    }
  });

  root.addEventListener('change', async (e) => {
    if (ended()) return;
    const card = e.target.closest('[data-iid]');
    if (!card) return;
    const iid = Number(card.dataset.iid);

    const def = e.target.closest('[data-defeat]');
    if (def) {
      if (def.checked) {
        setDefeated(eid, iid, true);
      } else {
        if (!(await confirmDialog('Opravdu oživit tohoto účastníka? Obnoví se mu 1 bod výdrže.', { okText: 'Oživit' }))) {
          def.checked = true;
          return;
        }
        revive(eid, iid);
      }
      updateCard(iid);
      drawOverview();
      return;
    }
    const note = e.target.closest('[data-note]');
    if (note) setInstanceNote(eid, iid, note.value);
  });

  // Stavy
  $('ef_preset').addEventListener('change', (e) => {
    if (e.target.value) $('ef_name').value = e.target.value;
  });
  $('ef_name').addEventListener('input', (e) => {
    if (e.target.value) $('ef_preset').value = '';
  });
  $('ef_add').addEventListener('click', () => {
    const iid = Number($('ef_inst').value);
    const dur = parseInt($('ef_dur').value, 10);
    try {
      addEffect(eid, iid, $('ef_name').value, Number.isFinite(dur) && dur > 0 ? dur : null, $('ef_notes').value);
      ['ef_name', 'ef_dur', 'ef_notes'].forEach((id) => ($(id).value = ''));
      $('ef_preset').value = '';
      updateCard(iid);
      toast('Stav přidán.');
    } catch (err) {
      toast(err.message, 'warn');
    }
  });

  // Poznámka ke střetnutí
  $('p_note').value = enc.note ?? '';
  $('p_note').addEventListener(
    'input',
    debounce(() => {
      setEncounterField(eid, 'note', $('p_note').value);
      $('p_note_status').textContent = 'Uloženo';
      setTimeout(() => ($('p_note_status').textContent = ''), 1500);
    }, 600)
  );

  // Displej nezhasíná během boje (Screen Wake Lock – Safari 16.4+).
  async function lockScreen() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !ended()) wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* není podporováno / zamítnuto */
    }
  }
  const onVis = () => {
    if (document.visibilityState === 'visible') lockScreen();
  };
  document.addEventListener('visibilitychange', onVis);
  lockScreen();

  // Start
  fullRender();
  maybeAskPcInitiative();
  fullRender();
  const a = getEncounter(eid).active_instance_id;
  if (a && getEncounter(eid).round_no > 1) setTimeout(() => scrollToCard(a), 50);

  return () => {
    document.removeEventListener('visibilitychange', onVis);
    try {
      wakeLock?.release();
    } catch {
      /* nic */
    }
  };
}
