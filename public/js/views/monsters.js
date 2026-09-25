import { catalog, spellsForMonster } from '../catalog.js';
import { backButton, bindBack, dash, debounce, esc, fmtMod, isBlank, loadPref, norm, openModal, savePref } from '../util.js';

// ---------------------------------------------------------------------------
// Sdílené formátování statbloku (detail, generátor, hraní)

/** Útoky pro detail: odstavce, tučně první věta (do tečky/dvojtečky). */
function formatAttacksParagraphs(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return t
    .split(/\r?\n\s*\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^([\s\S]{1,250}?[.:])([\s\S]*)$/);
      if (!m) return `<div class="statblock__attack">${esc(p)}</div>`;
      return `<div class="statblock__attack"><strong>${esc(m[1].trim())}</strong> ${esc(m[2].trim())}</div>`;
    })
    .join('');
}

/** Útoky pro kartu v boji: po řádcích, tučně část do dvojtečky. */
export function formatAttackLines(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return t
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.{1,160}?:)(.*)$/s) || line.match(/^(.{1,250}?[.:])(.*)$/s);
      if (!m) return `<div class="statblock__attack">${esc(line)}</div>`;
      return `<div class="statblock__attack"><strong>${esc(m[1].trim())}</strong>${m[2].trim() ? ' ' + esc(m[2].trim()) : ''}</div>`;
    })
    .join('');
}

/** Z textu kouzel („MDR, SO 12, Útok +4: …“) vytáhne sesílací vlastnost, SO a útok. */
export function parseCasting(txt) {
  const head = String(txt ?? '').trim().split(':')[0];
  const ability = head.match(/^\s*([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]{2,4})\s*,/u)?.[1] ?? null;
  const dc = head.match(/SO\s*(\d+)/u)?.[1] ?? null;
  const atk = head.match(/Útok\s*([+-]\s*\d+)/u)?.[1]?.replace(/\s/g, '') ?? null;
  return { ability, dc, atk };
}

const ABILITIES = [
  ['SÍL', 'sila'],
  ['OBR', 'obratnost'],
  ['ODL', 'odolnost'],
  ['INT', 'inteligence'],
  ['MOU', 'moudrost'],
  ['CHA', 'charisma'],
];

const TEXT_SECTIONS = [
  ['Záchranné hody', 'zachranne_hody'],
  ['Zdatnosti', 'zdatnost'],
  ['Odolnosti', 'odolnosti'],
  ['Imunity', 'imunita'],
  ['Schopnosti', 'schopnosti'],
  ['Akce', 'akce'],
  ['Kouzla', 'kouzla'],
  ['Reakce', 'reakce'],
  ['Legendární akce', 'legendarni_akce'],
];

/** Kompaktní statblok (karta v boji, rychlý náhled). hpOverride = max BV instance. */
export function statblockHtml(m, { hpOverride = null } = {}) {
  if (!m) return '<div class="small muted">Bez detailu.</div>';
  const top = [
    ['OČ', m.obranne_cislo],
    ['BV', hpOverride ?? m.vydrz],
    ['Rych', m.rychlost],
    ['Vel', m.velikost],
    ['Neb.', m.nebezpecnost],
    ['Pas. V.', m.pasivni_vnimani],
  ].filter(([, v]) => !isBlank(v) && String(v) !== '0');
  const hasAb = ABILITIES.some(([, k]) => m[k] !== null && m[k] !== undefined);
  const texts = TEXT_SECTIONS.filter(([, k]) => !isBlank(m[k]));
  const attacks = formatAttackLines(m.utoky);

  return `<div class="statblock">
    ${top.length ? `<div class="statblock__row">${top.map(([k, v]) => `<div class="statblock__stat"><span class="statblock__label">${k}</span><span class="statblock__val">${esc(v)}</span></div>`).join('')}</div>` : ''}
    ${
      hasAb
        ? `<div class="statblock__abilities">${ABILITIES.map(
            ([k, f]) => `<div class="statblock__ab"><span class="statblock__ab-label">${k}</span><span class="statblock__ab-score">${fmtMod(m[f])}</span></div>`
          ).join('')}</div>`
        : ''
    }
    ${!isBlank(m.presvedceni) && m.presvedceni !== '?' ? `<div class="statblock__text"><span class="statblock__text-label">Přesvědčení:</span> ${esc(m.presvedceni)}</div>` : ''}
    ${texts.map(([lbl, k]) => `<div class="statblock__text"><span class="statblock__text-label">${lbl}:</span> ${esc(m[k])}</div>`).join('')}
    ${attacks ? `<div class="statblock__text"><span class="statblock__text-label">Útoky:</span>${attacks}</div>` : ''}
  </div>`;
}

function spellsBlockHtml(m, spells) {
  if (!spells.length) return '';
  const c = parseCasting(m.kouzla);
  return `
    <div class="stat-strip" style="margin-bottom:10px">
      <div><div class="stat-strip__k">Sesílací vlastnost</div><div class="stat-strip__v">${esc(dash(c.ability))}</div></div>
      <div><div class="stat-strip__k">SO</div><div class="stat-strip__v">${esc(dash(c.dc))}</div></div>
      <div><div class="stat-strip__k">Útočný bonus</div><div class="stat-strip__v">${esc(dash(c.atk))}</div></div>
    </div>
    ${spells
      .map((s) => {
        const lvl = s.level === 0 ? 'Trik' : (s.level ?? 0) + '. stupeň';
        const kv = [
          ['Seslání', s.casting_time],
          ['Dosah', s.range_text],
          ['Složky', s.components_text],
          ['Trvání', s.duration_text],
        ].filter(([, v]) => !isBlank(v));
        return `<hr class="sep">
          <div>
            <div style="font-weight:800;font-size:1.05rem"><a href="#/spell/${s.spell_id}">${esc(s.name)}</a></div>
            <div class="small muted">${esc(lvl)}${s.school ? ' • ' + esc(s.school) : ''}${s.usage_text ? ' • ' + esc(s.usage_text) : ''}</div>
            ${kv.map(([k, v]) => `<div class="kv"><div class="kv__k">${k}</div><div class="kv__v">${esc(v)}</div></div>`).join('')}
            ${!isBlank(s.description) ? `<div class="pre" style="margin-top:8px">${esc(s.description)}</div>` : ''}
          </div>`;
      })
      .join('')}`;
}

/** Plný detail protivníka (stránka i modal). */
export function monsterDetailHtml(m) {
  const spells = spellsForMonster(m.id);
  const top = [
    ['Nebezpečnost', m.nebezpecnost],
    ['Velikost', m.velikost],
    ['Přesvědčení', m.presvedceni],
    ['OČ', m.obranne_cislo],
    ['Výdrž', m.vydrz],
    ['Rychlost', m.rychlost],
    ['Pas. vnímání', m.pasivni_vnimani],
  ];
  const rows = [
    ['Záchranné hody', m.zachranne_hody],
    ['Zdatnost', m.zdatnost],
    ['Odolnost', m.odolnosti],
    ['Imunita', m.imunita],
    ['Schopnosti', m.schopnosti],
  ].filter(([, v]) => !isBlank(v));
  const rows2 = [
    ['Akce', m.akce],
    ['Reakce', m.reakce],
    ['Legendární akce', m.legendarni_akce],
    ['Unikátní', m.unikatni],
    ['Poznámka', m.poznamka],
  ].filter(([, v]) => !isBlank(v));
  const attacks = formatAttacksParagraphs(m.utoky);

  return `
    <div class="card mt-0">
      <div class="stat-strip">${top.map(([k, v]) => `<div><div class="stat-strip__k">${k}</div><div class="stat-strip__v">${esc(dash(v))}</div></div>`).join('')}</div>
      <hr class="sep">
      <div class="stat-strip">${ABILITIES.map(([k, f]) => `<div><div class="stat-strip__k">${k}</div><div class="stat-strip__v">${fmtMod(m[f])}</div></div>`).join('')}</div>
      ${
        spells.length
          ? `<hr class="sep"><div class="tabs" role="tablist">
              <button class="btn btn-secondary btn-sm" type="button" role="tab" data-tab="actions" aria-selected="true">Schopnosti a akce</button>
              <button class="btn btn-secondary btn-sm" type="button" role="tab" data-tab="spells" aria-selected="false">Kouzla (${spells.length})</button>
            </div>`
          : ''
      }
    </div>
    <div class="card" data-panel="actions">
      ${rows.map(([k, v]) => `<div class="kv"><div class="kv__k">${k}</div><div class="kv__v">${esc(v)}</div></div>`).join('')}
      ${attacks ? `<div class="kv"><div class="kv__k">Útoky / Zbraně</div><div class="kv__v" style="white-space:normal">${attacks}</div></div>` : ''}
      ${!isBlank(m.kouzla) ? `<div class="kv"><div class="kv__k">Kouzla</div><div class="kv__v">${esc(m.kouzla)}</div></div>` : ''}
      ${rows2.map(([k, v]) => `<div class="kv"><div class="kv__k">${k}</div><div class="kv__v">${esc(v)}</div></div>`).join('')}
      ${!rows.length && !attacks && !rows2.length && isBlank(m.kouzla) ? '<div class="empty">Bez dalších údajů.</div>' : ''}
    </div>
    ${spells.length ? `<div class="card" data-panel="spells" hidden>${spellsBlockHtml(m, spells)}</div>` : ''}`;
}

export function bindDetailTabs(root) {
  const btns = root.querySelectorAll('[data-tab]');
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      btns.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      root.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
    })
  );
}

/** Rychlý náhled protivníka v modalu. */
export function showMonsterModal(monsterId) {
  const m = catalog().monsterById.get(monsterId);
  if (!m) return;
  const modal = openModal({
    title: m.jmeno,
    wide: true,
    body: `<div class="small muted" style="margin-bottom:8px">${esc([m.kategorie, m.prostredi].filter(Boolean).join(' • '))}</div>${monsterDetailHtml(m)}`,
  });
  bindDetailTabs(modal.body);
}

// ---------------------------------------------------------------------------
// Seznam

const CR_STEPS = [0, 1 / 8, 1 / 4, 1 / 2, ...Array.from({ length: 24 }, (_, i) => i + 1)];
const crLabel = (v) => ({ 0: '0', 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[v] ?? String(v));

const DEFAULTS = { q: '', kategorie: '', prostredi: '', kouzli: false, crMin: 0, crMax: CR_STEPS.length - 1 };

export function renderList(root) {
  const c = catalog();
  const st = loadPref('monsters', DEFAULTS);
  const opt = (arr, cur) => arr.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

  root.innerHTML = `
    <h1>Protivníci</h1>
    <div class="card">
      <div class="grid grid-4">
        <label class="field">Vyhledat<input type="search" id="m_q" placeholder="např. Goblin, Troll…" value="${esc(st.q)}" autocomplete="off"></label>
        <label class="field">Kategorie<select id="m_cat"><option value="">Vše</option>${opt(c.monsterCats, st.kategorie)}</select></label>
        <label class="field">Prostředí<select id="m_env"><option value="">Vše</option>${opt(c.monsterEnvs, st.prostredi)}</select></label>
        <label class="toggle" style="align-self:end"><input type="checkbox" id="m_spell" ${st.kouzli ? 'checked' : ''}><span class="toggle__slider"></span>Jen kouzlící</label>
      </div>
      <div class="field" style="margin-top:12px">
        <span class="small muted">Nebezpečnost <span class="badge" id="m_cr_label"></span></span>
        <div class="range2">
          <input type="range" id="m_crmin" min="0" max="${CR_STEPS.length - 1}" step="1" value="${st.crMin}" aria-label="Nebezpečnost od">
          <input type="range" id="m_crmax" min="0" max="${CR_STEPS.length - 1}" step="1" value="${st.crMax}" aria-label="Nebezpečnost do">
        </div>
      </div>
    </div>
    <div class="card">
      <div class="list-count" id="m_count"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Jméno</th><th>Kategorie</th><th>Prostředí</th><th class="t-center">Neb.</th></tr></thead>
        <tbody id="m_tbody"></tbody>
      </table></div>
      <p class="empty" id="m_empty" hidden>Nic nenalezeno. Zkus ubrat filtry.</p>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);
  const minEl = $('m_crmin');
  const maxEl = $('m_crmax');

  function syncRange(changed) {
    let a = +minEl.value;
    let b = +maxEl.value;
    if (a > b) {
      if (changed === 'min') b = a;
      else a = b;
      minEl.value = a;
      maxEl.value = b;
    }
    // Posouvaný jezdec navrch, aby šel dovést i na kraj.
    minEl.style.zIndex = changed === 'min' ? 4 : 2;
    maxEl.style.zIndex = changed === 'min' ? 3 : 4;
    st.crMin = a;
    st.crMax = b;
    $('m_cr_label').textContent = crLabel(CR_STEPS[a]) + ' – ' + crLabel(CR_STEPS[b]);
  }

  function apply() {
    const q = norm(st.q);
    const full = st.crMin === 0 && st.crMax === CR_STEPS.length - 1;
    const lo = CR_STEPS[st.crMin] - 1e-6;
    const hi = CR_STEPS[st.crMax] + 1e-6;
    const rows = c.monsters.filter((m) => {
      if (q && !m._n.includes(q)) return false;
      if (st.kategorie && m.kategorie !== st.kategorie) return false;
      if (st.prostredi && m.prostredi !== st.prostredi) return false;
      if (st.kouzli && isBlank(m.kouzla)) return false;
      if (!full && (!Number.isFinite(m._crv) || m._crv < lo || m._crv > hi)) return false;
      return true;
    });
    $('m_tbody').innerHTML = rows
      .map(
        (m) => `<tr class="rowlink" data-id="${m.id}"><td><strong>${esc(m.jmeno)}</strong></td><td>${esc(m.kategorie)}</td><td>${esc(m.prostredi)}</td><td class="t-center">${esc(m.nebezpecnost)}</td></tr>`
      )
      .join('');
    $('m_count').textContent = `Zobrazeno ${rows.length} z ${c.monsters.length}`;
    $('m_empty').hidden = rows.length > 0;
    savePref('monsters', st);
  }

  const later = debounce(apply, 80);
  $('m_q').addEventListener('input', (e) => {
    st.q = e.target.value;
    later();
  });
  $('m_cat').addEventListener('change', (e) => {
    st.kategorie = e.target.value;
    apply();
  });
  $('m_env').addEventListener('change', (e) => {
    st.prostredi = e.target.value;
    apply();
  });
  $('m_spell').addEventListener('change', (e) => {
    st.kouzli = e.target.checked;
    apply();
  });
  minEl.addEventListener('input', () => {
    syncRange('min');
    later();
  });
  maxEl.addEventListener('input', () => {
    syncRange('max');
    later();
  });
  $('m_tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = '#/monster/' + tr.dataset.id;
  });

  syncRange('max');
  apply();
}

// ---------------------------------------------------------------------------
// Detail

export function renderDetail(root, id) {
  const m = catalog().monsterById.get(id);
  if (!m) {
    root.innerHTML = `<div class="page-head"><h1>Protivník nenalezen</h1>${backButton('#/monsters')}</div>`;
    bindBack(root);
    return;
  }
  root.innerHTML = `
    <div class="page-head"><h1>${esc(m.jmeno)}</h1>${backButton('#/monsters')}</div>
    <div class="page-head__meta" style="margin-bottom:12px">${esc([m.kategorie, m.prostredi].filter(Boolean).join(' • '))}</div>
    ${monsterDetailHtml(m)}`;
  bindBack(root);
  bindDetailTabs(root);
}
