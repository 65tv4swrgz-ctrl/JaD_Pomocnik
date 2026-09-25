import { catalog, crToFloat } from '../catalog.js';
import { crToXp, DIFF_LABEL, evaluate } from '../rules.js';
import { createEncounter, getParty, listParties, startEncounter } from '../store.js';
import { cmp, debounce, esc, loadPref, norm, savePref, toast } from '../util.js';
import { showMonsterModal } from './monsters.js';

const DRAFT_DEFAULTS = {
  name: '',
  partyId: 0,
  lootMode: '',
  baseOnly: false,
  picks: [], // [{ id, qty, boss }]
  env: '',
  cat: '',
  crMin: '',
  crMax: '',
  sort: 'cr',
  q: '',
};

export function render(root) {
  const c = catalog();
  const parties = listParties();
  const d = loadPref('gen-draft', DRAFT_DEFAULTS);
  d.picks = (d.picks || []).filter((p) => c.monsterById.has(p.id));
  if (!parties.some((p) => p.id === d.partyId)) d.partyId = parties.length === 1 ? parties[0].id : 0;
  const save = () => savePref('gen-draft', d);

  const crs = [...new Set(c.monsters.map((m) => m._cr).filter(Boolean))].sort((a, b) => crToFloat(a) - crToFloat(b) || cmp(a, b));
  const opt = (arr, cur) => arr.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

  root.innerHTML = `
    <div class="page-head"><h1>Generátor střetnutí</h1><a class="btn btn-secondary btn-sm" href="#/encounters">Seznam střetnutí</a></div>

    <div class="card gen-sticky">
      <div class="grid grid-2">
        <label class="field">Název střetnutí<input id="g_name" maxlength="200" placeholder="Např. Přepadení na hrázi" value="${esc(d.name)}"></label>
        <div class="field">
          <span>Síla střetnutí</span>
          <div class="row-gap" style="min-height:var(--tap)">
            <span class="badge" id="g_badge" style="font-size:14px;padding:6px 12px">—</span>
            <span class="small muted" id="g_line"></span>
          </div>
        </div>
        <label class="field">Družina
          <select id="g_party">
            <option value="0" ${d.partyId ? '' : 'selected'} disabled>— vyber družinu —</option>
            ${parties.map((p) => `<option value="${p.id}" ${p.id === d.partyId ? 'selected' : ''}>${esc(p.name)} (${p.members.length})</option>`).join('')}
          </select>
        </label>
        <div class="field"><span>Hrdinové</span><div class="small" id="g_members" style="min-height:var(--tap);display:flex;align-items:center"></div></div>
      </div>
      ${parties.length ? '' : '<div class="alert alert--warn" style="margin-top:12px">Nejdřív si v sekci <a href="#/parties">Družiny</a> založ skupinu hrdinů.</div>'}
    </div>

    <div class="card">
      <h2>Výběr protivníků</h2>
      <div class="grid grid-4">
        <label class="field">Prostředí<select id="g_env"><option value="">— libovolné —</option>${opt(c.monsterEnvs, d.env)}</select></label>
        <label class="field">Kategorie<select id="g_cat"><option value="">— libovolná —</option>${opt(c.monsterCats, d.cat)}</select></label>
        <div class="field"><span>CR od – do</span>
          <div class="row-gap" style="flex-wrap:nowrap">
            <select id="g_crmin"><option value="">min</option>${opt(crs, d.crMin)}</select>
            <select id="g_crmax"><option value="">max</option>${opt(crs, d.crMax)}</select>
          </div>
        </div>
        <label class="field">Řazení<select id="g_sort">
          <option value="cr" ${d.sort === 'cr' ? 'selected' : ''}>CR (od nejnižšího)</option>
          <option value="name" ${d.sort === 'name' ? 'selected' : ''}>Abecedně</option>
          <option value="category" ${d.sort === 'category' ? 'selected' : ''}>Kategorie</option>
        </select></label>
      </div>
      <label class="field" style="margin-top:12px">Vyhledat<input type="search" id="g_q" placeholder="kostlivec, vlk, goblin…" value="${esc(d.q)}" autocomplete="off"></label>
      <div class="list-count" id="g_count" style="margin:8px 0"></div>
      <div class="pick-list" id="g_list"></div>
    </div>

    <div class="card">
      <div class="row-between"><h2 style="margin:0">Vybraní protivníci</h2><button class="btn btn-secondary btn-sm" type="button" id="g_clear">Vyčistit</button></div>
      <div class="table-wrap" style="margin-top:8px"><table class="table">
        <thead><tr><th>Protivník</th><th class="t-right">XP</th><th class="t-center">Počet</th><th class="t-center">Boss</th><th style="width:1%"></th></tr></thead>
        <tbody id="g_picked"></tbody>
      </table></div>

      <div class="grid grid-2" style="margin-top:14px">
        <label class="field">Loot
          <select id="g_loot">
            <option value="" disabled ${d.lootMode ? '' : 'selected'}>— vyber loot —</option>
            ${[
              ['none', 'Bez lootu'],
              ['frugal', 'Střídmý'],
              ['balanced', 'Vyvážený'],
              ['rich', 'Bohatý'],
            ]
              .map(([v, l]) => `<option value="${v}" ${v === d.lootMode ? 'selected' : ''}>${l}</option>`)
              .join('')}
          </select>
        </label>
        <label class="toggle" style="align-self:end"><input type="checkbox" id="g_base" ${d.baseOnly ? 'checked' : ''}><span class="toggle__slider"></span>Pouze základní (běžné) předměty</label>
      </div>
      <div class="row-gap" style="margin-top:16px">
        <button class="btn" type="button" id="g_create">Vytvořit střetnutí</button>
        <button class="btn btn-primary-outline" type="button" id="g_create_play">Vytvořit a hrát</button>
      </div>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);

  // ---- Družina

  function partyLevels() {
    const p = d.partyId ? getParty(d.partyId) : null;
    return p ? p.members.map((m) => m.level) : [];
  }

  function drawMembers() {
    const p = d.partyId ? getParty(d.partyId) : null;
    $('g_members').innerHTML = p
      ? p.members.length
        ? p.members.map((m) => `${esc(m.name)} <span class="muted">(${m.level})</span>`).join(', ')
        : '<span class="muted">Družina je prázdná – <a href="#/parties">přidej postavy</a>.</span>'
      : '<span class="muted">—</span>';
  }

  // ---- Seznam protivníků

  function filtered() {
    const q = norm(d.q);
    const lo = d.crMin ? crToFloat(d.crMin) : NaN;
    const hi = d.crMax ? crToFloat(d.crMax) : NaN;
    const rows = c.monsters.filter((m) => {
      if (d.env && m.prostredi !== d.env) return false;
      if (d.cat && m.kategorie !== d.cat) return false;
      if (q && !m._n.includes(q)) return false;
      if (d.crMin || d.crMax) {
        if (!Number.isFinite(m._crv)) return false;
        if (Number.isFinite(lo) && m._crv < lo) return false;
        if (Number.isFinite(hi) && m._crv > hi) return false;
      }
      return true;
    });
    const byName = (a, b) => cmp(a.jmeno, b.jmeno);
    if (d.sort === 'category') rows.sort((a, b) => cmp(a.kategorie, b.kategorie) || byName(a, b));
    else if (d.sort === 'cr') rows.sort((a, b) => (Number.isFinite(a._crv) ? a._crv : 1e9) - (Number.isFinite(b._crv) ? b._crv : 1e9) || byName(a, b));
    else rows.sort(byName);
    return rows;
  }

  function drawList() {
    const rows = filtered();
    const picked = new Map(d.picks.map((p) => [p.id, p]));
    $('g_list').innerHTML =
      rows
        .map((m) => {
          const p = picked.get(m.id);
          const xp = crToXp(m._cr);
          return `<div class="pick-item ${p ? 'is-picked' : ''}" data-id="${m.id}">
            <div class="pick-item__main">
              <div class="pick-item__name">${esc(m.jmeno)}</div>
              <div class="pick-item__meta">${[m._cr ? 'CR ' + esc(m._cr) : '', xp ? xp + ' XP' : '', esc(m.kategorie ?? ''), esc(m.prostredi ?? '')].filter(Boolean).join(' · ')}</div>
            </div>
            ${p ? `<span class="badge badge--accent">${p.qty}×</span>` : ''}
            <button class="btn btn-ghost btn-sm btn-icon" type="button" data-info aria-label="Detail">ⓘ</button>
            <button class="btn btn-sm btn-icon" type="button" data-add aria-label="Přidat">+</button>
          </div>`;
        })
        .join('') || '<div class="empty">Nic nenalezeno.</div>';
    $('g_count').textContent = `Zobrazeno ${rows.length} / ${c.monsters.length}`;
  }

  // ---- Vybraní

  function drawPicked() {
    $('g_picked').innerHTML = d.picks.length
      ? d.picks
          .map((p) => {
            const m = c.monsterById.get(p.id);
            return `<tr data-id="${p.id}">
              <td><strong>${esc(m.jmeno)}</strong><div class="small muted">${[m._cr ? 'CR ' + esc(m._cr) : '', esc(m.kategorie ?? '')].filter(Boolean).join(' · ')}</div></td>
              <td class="t-right num">${crToXp(m._cr)}</td>
              <td class="t-center"><div class="qty">
                <button class="btn btn-secondary btn-sm btn-icon" type="button" data-dec aria-label="Méně">−</button>
                <span class="qty__val">${p.qty}</span>
                <button class="btn btn-secondary btn-sm btn-icon" type="button" data-inc aria-label="Více">+</button>
              </div></td>
              <td class="t-center"><label class="toggle" title="Boss (posílený)"><input type="checkbox" data-boss ${p.boss ? 'checked' : ''} aria-label="Boss"><span class="toggle__slider"></span></label></td>
              <td><button class="btn btn-danger btn-sm btn-icon" type="button" data-remove aria-label="Odebrat">✕</button></td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="5" class="empty">Zatím nic. Přidej protivníky tlačítkem + v seznamu výše.</td></tr>';
  }

  function recompute() {
    const levels = partyLevels();
    const picks = d.picks.map((p) => ({ monster: c.monsterById.get(p.id), qty: p.qty, boss: p.boss }));
    const badge = $('g_badge');
    badge.className = 'badge';
    if (!levels.length) {
      badge.textContent = '—';
      $('g_line').textContent = 'Vyber družinu s postavami.';
      return;
    }
    if (!picks.length) {
      badge.textContent = '—';
      $('g_line').textContent = 'Vyber protivníky.';
      return;
    }
    const ev = evaluate(picks, levels);
    badge.textContent = DIFF_LABEL[ev.difficulty];
    badge.classList.add('diff--' + ev.difficulty);
    $('g_line').innerHTML =
      `Síla: <strong>${ev.strengthTotal.toFixed(2)}</strong> (≈ ekv. postav) · Úroveň: ${ev.partyLevel} · ${levels.length} hrdinů` +
      (ev.missing.length ? `<br><span style="color:#ffb3b1">Mimo tabulku síly: ${esc(ev.missing.join(', '))}</span>` : '');
  }

  function refreshAll() {
    drawList();
    drawPicked();
    recompute();
    save();
  }

  // ---- Události

  $('g_name').addEventListener('input', (e) => {
    d.name = e.target.value;
    save();
  });
  $('g_party').addEventListener('change', (e) => {
    d.partyId = Number(e.target.value);
    drawMembers();
    recompute();
    save();
  });
  const later = debounce(() => {
    drawList();
    save();
  }, 80);
  $('g_q').addEventListener('input', (e) => {
    d.q = e.target.value;
    later();
  });
  for (const [id, key] of [
    ['g_env', 'env'],
    ['g_cat', 'cat'],
    ['g_crmin', 'crMin'],
    ['g_crmax', 'crMax'],
    ['g_sort', 'sort'],
  ]) {
    $(id).addEventListener('change', (e) => {
      d[key] = e.target.value;
      drawList();
      save();
    });
  }
  $('g_loot').addEventListener('change', (e) => {
    d.lootMode = e.target.value;
    save();
  });
  $('g_base').addEventListener('change', (e) => {
    d.baseOnly = e.target.checked;
    save();
  });

  $('g_list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const id = Number(row.dataset.id);
    if (e.target.closest('[data-info]')) {
      showMonsterModal(id);
      return;
    }
    if (e.target.closest('[data-add]')) {
      const p = d.picks.find((x) => x.id === id);
      if (p) p.qty++;
      else d.picks.push({ id, qty: 1, boss: false });
      refreshAll();
    }
  });

  $('g_picked').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    const p = d.picks.find((x) => x.id === id);
    if (!p) return;
    if (e.target.closest('[data-inc]')) p.qty++;
    else if (e.target.closest('[data-dec]')) p.qty = Math.max(1, p.qty - 1);
    else if (e.target.closest('[data-remove]')) d.picks = d.picks.filter((x) => x.id !== id);
    else return;
    refreshAll();
  });
  $('g_picked').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-boss]');
    if (!cb) return;
    const p = d.picks.find((x) => x.id === Number(cb.closest('tr').dataset.id));
    if (p) p.boss = cb.checked;
    recompute();
    save();
  });
  $('g_clear').addEventListener('click', () => {
    d.picks = [];
    refreshAll();
  });

  function create(andPlay) {
    try {
      const eid = createEncounter({
        partyId: d.partyId,
        name: d.name,
        picks: d.picks.map((p) => ({ monster: c.monsterById.get(p.id), qty: p.qty, boss: p.boss })),
        lootMode: d.lootMode,
        baseItemsOnly: d.baseOnly,
      });
      // Úspěch: vyčistíme koncept (filtry necháme).
      d.name = '';
      d.picks = [];
      save();
      toast('Střetnutí vytvořeno.');
      if (andPlay) {
        startEncounter(eid);
        location.hash = '#/play/' + eid;
      } else {
        location.hash = '#/encounter/' + eid;
      }
    } catch (err) {
      toast(err.message || String(err), 'err', 4000);
    }
  }
  $('g_create').addEventListener('click', () => create(false));
  $('g_create_play').addEventListener('click', () => create(true));

  drawMembers();
  refreshAll();
}
