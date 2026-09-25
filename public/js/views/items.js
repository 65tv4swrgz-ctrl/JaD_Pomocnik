import { catalog } from '../catalog.js';
import { backButton, bindBack, cmp, debounce, esc, isBlank, loadPref, norm, openModal, savePref } from '../util.js';

const DEFAULTS = { q: '', vzacnost: '', kategorie: '', podkategorie: '', trida: '', bonus: '', sort: 'name_asc' };

const SORTS = [
  ['name_asc', 'Abecedně (A→Z)'],
  ['name_desc', 'Abecedně (Z→A)'],
  ['rarity_asc', 'Vzácnost (↑)'],
  ['rarity_desc', 'Vzácnost (↓)'],
  ['category_asc', 'Kategorie (↑)'],
  ['category_desc', 'Kategorie (↓)'],
];

function sorter(sort) {
  switch (sort) {
    case 'name_desc':
      return (a, b) => cmp(b.jmeno, a.jmeno);
    case 'rarity_asc':
      return (a, b) => a._rar - b._rar || cmp(a.jmeno, b.jmeno);
    case 'rarity_desc':
      return (a, b) => b._rar - a._rar || cmp(a.jmeno, b.jmeno);
    case 'category_asc':
      return (a, b) => cmp(a.kategorie, b.kategorie) || cmp(a.jmeno, b.jmeno);
    case 'category_desc':
      return (a, b) => cmp(b.kategorie, a.kategorie) || cmp(a.jmeno, b.jmeno);
    default:
      return (a, b) => cmp(a.jmeno, b.jmeno);
  }
}

export function renderList(root) {
  const c = catalog();
  const st = loadPref('items', DEFAULTS);
  const opt = (arr, cur) => arr.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

  root.innerHTML = `
    <h1>Předměty</h1>
    <div class="card">
      <div class="grid grid-4">
        <label class="field">Vyhledat<input type="search" id="i_q" placeholder="např. Meč, Lektvar…" value="${esc(st.q)}" autocomplete="off"></label>
        <label class="field">Vzácnost<select id="i_rar"><option value="">Vše</option>${opt(c.rarities, st.vzacnost)}</select></label>
        <label class="field">Kategorie<select id="i_cat"><option value="">Vše</option>${opt(c.itemCats, st.kategorie)}</select></label>
        <label class="field">Podkategorie<select id="i_sub"></select></label>
        <label class="field">Třída<select id="i_class"><option value="">Vše</option>${opt(c.itemClasses, st.trida)}</select></label>
        <label class="field">Bonus<select id="i_bonus"><option value="">Vše</option>${opt(c.itemBonuses, st.bonus)}</select></label>
        <label class="field">Řazení<select id="i_sort">${SORTS.map(([v, l]) => `<option value="${v}" ${v === st.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="card">
      <div class="list-count" id="i_count"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Předmět</th><th>Vzácnost</th><th>Kategorie</th></tr></thead>
        <tbody id="i_tbody"></tbody>
      </table></div>
      <p class="empty" id="i_empty" hidden>Nic nenalezeno. Zkus ubrat filtry.</p>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);

  function fillSubs() {
    const subs = st.kategorie ? c.itemSubByCat[st.kategorie] || [] : c.itemSubs;
    if (st.podkategorie && !subs.includes(st.podkategorie)) st.podkategorie = '';
    $('i_sub').innerHTML = `<option value="">Vše</option>${opt(subs, st.podkategorie)}`;
  }

  function apply() {
    const q = norm(st.q);
    const rows = c.items
      .filter(
        (it) =>
          (!q || it._n.includes(q)) &&
          (!st.vzacnost || it.vzacnost === st.vzacnost) &&
          (!st.kategorie || it.kategorie === st.kategorie) &&
          (!st.podkategorie || it.podkategorie === st.podkategorie) &&
          (!st.trida || it.trida === st.trida) &&
          (!st.bonus || it.bonus === st.bonus)
      )
      .sort(sorter(st.sort));
    $('i_tbody').innerHTML = rows
      .map((it) => `<tr class="rowlink" data-id="${it.id}"><td><strong>${esc(it.jmeno)}</strong></td><td>${esc(it.vzacnost)}</td><td>${esc(it.kategorie)}</td></tr>`)
      .join('');
    $('i_count').textContent = `Zobrazeno ${rows.length} z ${c.items.length}`;
    $('i_empty').hidden = rows.length > 0;
    savePref('items', st);
  }

  $('i_q').addEventListener('input', debounce((e) => {
    st.q = e.target.value;
    apply();
  }, 80));
  const bindSel = (id, key, after) =>
    $(id).addEventListener('change', (e) => {
      st[key] = e.target.value;
      if (after) after();
      apply();
    });
  bindSel('i_rar', 'vzacnost');
  bindSel('i_cat', 'kategorie', fillSubs);
  bindSel('i_sub', 'podkategorie');
  bindSel('i_class', 'trida');
  bindSel('i_bonus', 'bonus');
  bindSel('i_sort', 'sort');
  $('i_tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = '#/item/' + tr.dataset.id;
  });

  fillSubs();
  apply();
}

/** Řádky detailu předmětu (stejné složení jako item.php). */
export function itemDetailHtml(it) {
  const isWeapon = it.kategorie === 'Zbraň' || !isBlank(it.druh_zbrane);
  let catLabel = it.kategorie ?? '';
  if (isWeapon && it.vytribena && catLabel) catLabel += ' • Vytříbená';

  const hit = [
    it.dmg,
    !isBlank(it.vlastnosti) ? 'Vlastnosti: ' + it.vlastnosti : '',
    !isBlank(it.bonus) ? 'Bonus: ' + it.bonus : '',
    !isBlank(it.efekt) ? 'Efekt: ' + it.efekt : '',
  ]
    .filter((x) => !isBlank(x))
    .join(' • ');
  const ac = [it.oc, !isBlank(it.sila) ? 'Síla: ' + it.sila : ''].filter((x) => !isBlank(x)).join(' • ');

  const pairs = [
    ['Kategorie', catLabel],
    ['Podkategorie', it.podkategorie],
    ['Třída', it.trida],
    ['Druh zbraně', it.druh_zbrane],
    ['Zásah', hit],
    ['Dostřel', it.dostrel],
    ['OČ', ac],
    ['Nevýhoda', it.nevyhoda],
    ['Účel', it.ucel],
    ['Interakce', it.interakce],
    ['Obsah', it.obsah],
    ['Limit', it.limit],
    ['Trvání', it.trvani],
    ['Váha', it.vaha],
    ['Popis', it.popis],
  ].filter(([, v]) => !isBlank(v));

  return pairs.map(([k, v]) => `<div class="kv"><div class="kv__k">${k}</div><div class="kv__v">${esc(v)}</div></div>`).join('') || '<div class="empty">Bez dalších údajů.</div>';
}

export function itemMetaLine(it) {
  return [it.vzacnost, it.kategorie, !isBlank(it.cena) ? 'Cena: ' + it.cena : '', !isBlank(it.sladeni) ? 'Sladění: ' + it.sladeni : '']
    .filter((x) => !isBlank(x))
    .join(' • ');
}

export function showItemModal(itemId) {
  const it = catalog().itemById.get(itemId);
  if (!it) return;
  openModal({ title: it.jmeno, body: `<div class="small muted" style="margin-bottom:8px">${esc(itemMetaLine(it))}</div>${itemDetailHtml(it)}` });
}

export function renderDetail(root, id) {
  const it = catalog().itemById.get(id);
  if (!it) {
    root.innerHTML = `<div class="page-head"><h1>Předmět nenalezen</h1>${backButton('#/items')}</div>`;
    bindBack(root);
    return;
  }
  root.innerHTML = `
    <div class="page-head"><h1>${esc(it.jmeno)}</h1>${backButton('#/items')}</div>
    <div class="page-head__meta">${esc(itemMetaLine(it))}</div>
    <div class="card">${itemDetailHtml(it)}</div>`;
  bindBack(root);
}
