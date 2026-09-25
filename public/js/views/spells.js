import { catalog, spellLevelLabel } from '../catalog.js';
import { backButton, bindBack, cmp, debounce, esc, isBlank, loadPref, norm, savePref } from '../util.js';

const DEFAULTS = { q: '', level: '', school: '', cls: '', sort: 'level', ritual: false };

export function renderList(root) {
  const c = catalog();
  const st = loadPref('spells', DEFAULTS);
  const opt = (arr, cur) => arr.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const levels = Array.from({ length: 10 }, (_, i) => `<option value="${i}" ${String(i) === st.level ? 'selected' : ''}>${spellLevelLabel(i)}</option>`).join('');

  root.innerHTML = `
    <h1>Kouzla</h1>
    <div class="card">
      <div class="grid grid-3">
        <label class="field">Vyhledat<input type="search" id="s_q" placeholder="např. Ohnivá koule…" value="${esc(st.q)}" autocomplete="off"></label>
        <label class="field">Úroveň<select id="s_lvl"><option value="">Vše</option>${levels}</select></label>
        <label class="field">Škola<select id="s_school"><option value="">Vše</option>${opt(c.spellSchools, st.school)}</select></label>
        <label class="field">Povolání<select id="s_class"><option value="">Vše</option>${opt(c.spellClasses, st.cls)}</select></label>
        <label class="field">Řazení<select id="s_sort">
          <option value="level" ${st.sort === 'level' ? 'selected' : ''}>Úroveň</option>
          <option value="school" ${st.sort === 'school' ? 'selected' : ''}>Škola</option>
          <option value="name" ${st.sort === 'name' ? 'selected' : ''}>Abecedně</option>
        </select></label>
        <label class="toggle" style="align-self:end"><input type="checkbox" id="s_ritual" ${st.ritual ? 'checked' : ''}><span class="toggle__slider"></span>Jen rituály</label>
      </div>
    </div>
    <div class="card">
      <div class="list-count" id="s_count"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Kouzlo</th><th>Úroveň</th><th>Škola</th><th>Povolání</th></tr></thead>
        <tbody id="s_tbody"></tbody>
      </table></div>
      <p class="empty" id="s_empty" hidden>Nic nenalezeno. Zkus ubrat filtry.</p>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);

  function apply() {
    const q = norm(st.q);
    const rows = c.spells.filter(
      (s) =>
        (!q || s._n.includes(q)) &&
        (st.level === '' || String(s.level ?? '') === st.level) &&
        (!st.school || s.school === st.school) &&
        (!st.cls || s._classes.includes(st.cls)) &&
        (!st.ritual || s.ritual === 1)
    );
    const byName = (a, b) => cmp(a.name, b.name);
    if (st.sort === 'school') rows.sort((a, b) => cmp(a.school, b.school) || (a.level ?? 0) - (b.level ?? 0) || byName(a, b));
    else if (st.sort === 'name') rows.sort(byName);
    else rows.sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || byName(a, b));

    $('s_tbody').innerHTML = rows
      .map(
        (s) => `<tr class="rowlink" data-id="${s.id}"><td><strong>${esc(s.name)}</strong>${s.ritual ? ' <span class="badge badge--accent">R</span>' : ''}${
          s.concentration ? ' <span class="badge badge--muted" title="Soustředění">S</span>' : ''
        }</td><td class="nowrap">${spellLevelLabel(s.level)}</td><td>${esc(s.school)}</td><td class="small">${esc(s.classes_text)}</td></tr>`
      )
      .join('');
    $('s_count').textContent = `Zobrazeno ${rows.length} z ${c.spells.length}`;
    $('s_empty').hidden = rows.length > 0;
    savePref('spells', st);
  }

  $('s_q').addEventListener('input', debounce((e) => {
    st.q = e.target.value;
    apply();
  }, 80));
  const bindSel = (id, key) =>
    $(id).addEventListener('change', (e) => {
      st[key] = e.target.value;
      apply();
    });
  bindSel('s_lvl', 'level');
  bindSel('s_school', 'school');
  bindSel('s_class', 'cls');
  bindSel('s_sort', 'sort');
  $('s_ritual').addEventListener('change', (e) => {
    st.ritual = e.target.checked;
    apply();
  });
  $('s_tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = '#/spell/' + tr.dataset.id;
  });
  apply();
}

export function renderDetail(root, id) {
  const s = catalog().spellById.get(id);
  if (!s) {
    root.innerHTML = `<div class="page-head"><h1>Kouzlo nenalezeno</h1>${backButton('#/spells')}</div>`;
    bindBack(root);
    return;
  }
  const kv = [
    ['Seslání', s.casting_time],
    ['Dosah', s.range_text],
    ['Složky', s.components_text],
    ['Materiál', s.material],
    ['Trvání', s.duration_text],
    ['Soustředění', s.concentration ? 'Ano' : 'Ne'],
    ['Povolání', s.classes_text],
  ].filter(([, v]) => !isBlank(v));

  root.innerHTML = `
    <div class="page-head"><h1>${esc(s.name)}</h1>${backButton('#/spells')}</div>
    <div class="page-head__meta">${esc([spellLevelLabel(s.level), s.school].filter(Boolean).join(' • '))}
      ${s.ritual ? ' <span class="badge badge--accent">Rituál</span>' : ''}</div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr);align-items:start" id="spellGrid">
      <div class="card">${kv.map(([k, v]) => `<div class="kv"><div class="kv__k">${k}</div><div class="kv__v">${esc(v)}</div></div>`).join('')}</div>
      <div class="card"><h3>Popis</h3>${!isBlank(s.description) ? `<div class="pre" style="line-height:1.5">${esc(s.description)}</div>` : '<p class="muted">Bez popisu.</p>'}</div>
    </div>`;
  if (window.matchMedia('(max-width: 700px)').matches) root.querySelector('#spellGrid').style.gridTemplateColumns = '1fr';
  bindBack(root);
}
