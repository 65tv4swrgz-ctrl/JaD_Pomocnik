// Panel lootu – detail střetnutí i modal během boje.

import { catalog } from '../catalog.js';
import { LOOT_LABEL, RARITY_KEYS, rarityLabel } from '../rules.js';
import {
  addLootCustom,
  addLootItem,
  deleteLoot,
  generateLootIfEmpty,
  getEncounter,
  giveLoot,
  groupLoot,
  instanceLabel,
  isPc,
  listInstances,
  listLoot,
  setLootNote,
  ungiveLoot,
} from '../store.js';
import { confirmDialog, debounce, esc, norm, openModal, toast } from '../util.js';
import { showItemModal } from './items.js';

const SOURCE_LABEL = { boss: 'boss', drop: 'drop', manual: 'ručně', db: 'ručně', random: 'náhodně' };

export function mountLoot(container, eid, { readOnly = false } = {}) {
  const draw = () => {
    const enc = getEncounter(eid);
    const groups = groupLoot(listLoot(eid));
    const avail = groups.filter((g) => !g.given_to);
    const given = groups.filter((g) => g.given_to);

    container.innerHTML = `
      ${
        avail.length
          ? avail
              .map(
                (g) => `<div class="loot-row" data-key="${esc(g.ids.join(','))}">
            <div>
              ${g.item_id ? `<button class="link-btn loot-row__name" type="button" data-item="${g.item_id}">${esc(g.name)}</button>` : `<span class="loot-row__name">${esc(g.name)}</span>`}
              <div class="loot-row__meta">${[rarityLabel(g.rarity), g.category, SOURCE_LABEL[g.source] ?? g.source].filter(Boolean).map(esc).join(' · ')}</div>
            </div>
            ${
              readOnly
                ? `<span class="badge">${g.qty}×</span>`
                : `<div class="qty">
                    <button class="btn btn-secondary btn-sm btn-icon" type="button" data-dec aria-label="Ubrat">−</button>
                    <span class="qty__val">${g.qty}</span>
                    <button class="btn btn-secondary btn-sm btn-icon" type="button" data-inc aria-label="Přidat" ${g.item_id ? '' : 'disabled'}>+</button>
                  </div>
                  <button class="btn btn-primary-outline btn-sm" type="button" data-give>Předat</button>
                  <button class="btn btn-danger btn-sm btn-icon" type="button" data-del aria-label="Smazat">✕</button>`
            }
            <div class="loot-row__note">${
              readOnly
                ? g.note
                  ? `<span class="small muted">${esc(g.note)}</span>`
                  : ''
                : `<input type="text" data-note value="${esc(g.note)}" placeholder="Poznámka" maxlength="255">`
            }</div>
          </div>`
              )
              .join('')
          : `<div class="empty">Žádný loot.${
              !readOnly && enc.loot_mode !== 'none'
                ? ` <button class="btn btn-secondary btn-sm" type="button" data-generate>Vygenerovat (${esc(LOOT_LABEL[enc.loot_mode])})</button>`
                : ''
            }</div>`
      }

      ${
        given.length
          ? `<h3 style="margin-top:16px">Předáno</h3>
            ${given
              .map(
                (g) => `<div class="loot-row" data-key="${esc(g.ids.join(','))}" style="grid-template-columns:1fr auto">
                  <div>
                    <span class="loot-row__name">${esc(g.name)}</span> <span class="badge">${g.qty}×</span>
                    <div class="loot-row__meta">→ <strong>${esc(g.given_to)}</strong>${g.note ? ' · ' + esc(g.note) : ''}</div>
                  </div>
                  ${readOnly ? '' : '<button class="btn btn-secondary btn-sm" type="button" data-ungive>Vrátit</button>'}
                </div>`
              )
              .join('')}`
          : ''
      }

      ${
        readOnly
          ? ''
          : `<hr class="sep">
            <div class="row-between"><strong>Přidat předmět</strong>
              <button class="btn btn-ghost btn-sm" type="button" data-custom>Vlastní předmět…</button></div>
            <input type="search" data-search placeholder="Začni psát název předmětu (od 2 znaků)…" autocomplete="off" style="margin-top:8px">
            <div class="pick-list" data-results style="margin-top:8px;max-height:260px"></div>`
      }`;

    // Výsledky hledání zůstanou po překreslení prázdné.
  };

  const groupIds = (el) => el.closest('[data-key]').dataset.key.split(',').map(Number);
  const findGroup = (ids) => groupLoot(listLoot(eid)).find((g) => g.ids.join(',') === ids.join(','));

  container.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-item]')) {
      showItemModal(Number(t.closest('[data-item]').dataset.item));
      return;
    }
    if (readOnly) return;

    if (t.closest('[data-generate]')) {
      const n = generateLootIfEmpty(eid);
      toast(n ? `Vygenerováno ${n} předmětů.` : 'Nic se nevygenerovalo.', n ? 'ok' : 'warn');
      draw();
      return;
    }
    if (t.closest('[data-dec]')) {
      const ids = groupIds(t);
      deleteLoot(eid, [ids[ids.length - 1]]);
      draw();
      return;
    }
    if (t.closest('[data-inc]')) {
      const g = findGroup(groupIds(t));
      if (g?.item_id) addLootItem(eid, g.item_id, g.note, g.source);
      draw();
      return;
    }
    if (t.closest('[data-del]')) {
      const ids = groupIds(t);
      const g = findGroup(ids);
      if (ids.length > 1 && !(await confirmDialog(`Smazat všechny kusy předmětu „${g?.name ?? ''}“?`, { danger: true, okText: 'Smazat' }))) return;
      deleteLoot(eid, ids);
      draw();
      return;
    }
    if (t.closest('[data-ungive]')) {
      ungiveLoot(eid, groupIds(t));
      draw();
      return;
    }
    if (t.closest('[data-give]')) {
      openGive(groupIds(t));
      return;
    }
    if (t.closest('[data-custom]')) {
      openCustom();
      return;
    }
    const res = t.closest('[data-add-item]');
    if (res) {
      addLootItem(eid, Number(res.dataset.addItem));
      toast('Přidáno do lootu.');
      draw();
    }
  });

  container.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-note]');
    // Bez překreslení – jinak by se na iPadu ztratilo klepnutí, které změnu vyvolalo (blur).
    if (inp) setLootNote(eid, groupIds(inp), inp.value);
  });

  const search = debounce((inp) => {
    const box = container.querySelector('[data-results]');
    const q = norm(inp.value);
    if (q.length < 2) {
      box.innerHTML = '';
      return;
    }
    const words = q.split(/\s+/);
    const hits = catalog()
      .items.filter((it) => words.every((w) => it._n.includes(w)))
      .sort((a, b) => Number(!a._n.startsWith(q)) - Number(!b._n.startsWith(q)))
      .slice(0, 20);
    box.innerHTML = hits.length
      ? hits
          .map(
            (it) => `<div class="pick-item"><div class="pick-item__main"><div class="pick-item__name">${esc(it.jmeno)}</div>
              <div class="pick-item__meta">${esc([it.vzacnost, it.kategorie].filter(Boolean).join(' · '))}</div></div>
              <button class="btn btn-sm" type="button" data-add-item="${it.id}">Přidat</button></div>`
          )
          .join('')
      : '<div class="empty">Nic nenalezeno.</div>';
  }, 150);
  container.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-search]');
    if (inp) search(inp);
  });

  function openGive(ids) {
    const g = findGroup(ids);
    if (!g) return;
    const pcs = listInstances(eid).filter(isPc);
    if (!pcs.length) {
      toast('Ve střetnutí nejsou žádní hrdinové.', 'warn');
      return;
    }
    let qty = 1;
    const m = openModal({
      title: 'Předat: ' + g.name,
      body: `<label class="field">Komu<select data-to>${pcs.map((p) => `<option>${esc(instanceLabel(p))}</option>`).join('')}</select></label>
        <div class="field" style="margin-top:12px"><span>Množství (k dispozici ${ids.length})</span>
          <div class="qty"><button class="btn btn-secondary btn-sm btn-icon" type="button" data-q="-1">−</button>
          <span class="qty__val" data-qv>1</span>
          <button class="btn btn-secondary btn-sm btn-icon" type="button" data-q="1">+</button></div></div>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Předat</button>',
    });
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (b) {
        qty = Math.max(1, Math.min(ids.length, qty + Number(b.dataset.q)));
        m.el.querySelector('[data-qv]').textContent = qty;
      }
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      giveLoot(eid, ids.slice(0, qty), m.el.querySelector('[data-to]').value);
      m.close();
      toast('Předáno.');
      draw();
    });
  }

  function openCustom() {
    const m = openModal({
      title: 'Vlastní předmět',
      body: `<div class="grid">
        <label class="field">Název<input data-f="name" maxlength="255" autofocus></label>
        <div class="grid grid-2">
          <label class="field">Vzácnost<select data-f="rarity">${RARITY_KEYS.map((k) => `<option value="${k}">${rarityLabel(k)}</option>`).join('')}</select></label>
          <label class="field">Kategorie<input data-f="category" maxlength="120"></label>
        </div>
        <label class="field">Poznámka<input data-f="note" maxlength="255"></label></div>`,
      foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Přidat</button>',
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      const v = (k) => m.el.querySelector(`[data-f="${k}"]`).value;
      try {
        addLootCustom(eid, { name: v('name'), rarity: v('rarity'), category: v('category'), note: v('note') });
        m.close();
        draw();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  }

  draw();
  return { refresh: draw };
}
