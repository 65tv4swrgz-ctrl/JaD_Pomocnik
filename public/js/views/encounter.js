import { catalog } from '../catalog.js';
import { DIFF_LABEL, LOOT_LABEL, PHASE_LABEL } from '../rules.js';
import {
  addEnemyInstances,
  deleteEncounter,
  deleteInstance,
  getEncounter,
  instanceLabel,
  isPc,
  isSimple,
  listInstances,
  renameInstance,
  setEncounterField,
} from '../store.js';
import { backButton, bindBack, confirmDialog, debounce, esc, norm, toast } from '../util.js';
import { mountLoot } from './loot.js';
import { showMonsterModal } from './monsters.js';

export function render(root, eid) {
  const enc = getEncounter(eid);
  if (!enc) {
    root.innerHTML = `<div class="page-head"><h1>Střetnutí nenalezeno</h1>${backButton('#/encounters')}</div>`;
    bindBack(root);
    return;
  }
  const c = catalog();
  const ended = enc.phase === 'ended';

  root.innerHTML = `
    <div class="page-head">
      <input id="e_name" value="${esc(enc.name)}" aria-label="Název střetnutí" style="font-size:1.4rem;font-weight:800;max-width:560px;flex:1" ${ended ? 'readonly' : ''}>
      ${backButton('#/encounters')}
    </div>
    <div class="row-gap" style="margin-top:10px">
      <span class="badge diff--${esc(enc.difficulty)}">${esc(DIFF_LABEL[enc.difficulty] ?? enc.difficulty)}</span>
      <span class="badge ${enc.phase === 'playing' ? 'badge--ok' : ''}">${esc(PHASE_LABEL[enc.phase] ?? enc.phase)}</span>
      <span class="badge">Loot: ${esc(LOOT_LABEL[enc.loot_mode] ?? enc.loot_mode)}${enc.base_items_only ? ' (jen běžné)' : ''}</span>
      <span class="small muted">${esc(enc.party_name)} · síla ${enc.strength != null ? Number(enc.strength).toFixed(2) : '—'} · XP ${enc.base_xp} (×${enc.multiplier} = ${enc.adjusted_xp})</span>
    </div>
    <div class="row-gap" style="margin-top:14px">
      <a class="btn" href="#/play/${eid}">${enc.phase === 'prepared' ? 'Zahájit boj' : enc.phase === 'playing' ? 'Pokračovat v boji' : 'Zobrazit boj'}</a>
      <button class="btn btn-danger" type="button" id="e_delete">Smazat střetnutí</button>
    </div>

    <div class="card">
      <label class="field">Poznámka ke střetnutí<textarea id="e_note" rows="3" maxlength="4000" placeholder="Poznámka…">${esc(enc.note)}</textarea></label>
      <div class="small muted" id="e_note_status" style="min-height:1.2em;margin-top:4px"></div>
    </div>

    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr);align-items:start" id="e_grid">
      <div class="card"><h2>Hrdinové</h2><div id="e_pcs"></div></div>
      <div class="card"><h2>Protivníci</h2><div id="e_enemies"></div>
        ${
          ended
            ? ''
            : `<hr class="sep"><h3>Přidat protivníky</h3>
              <input type="search" id="e_search" placeholder="Hledat v bestiáři…" autocomplete="off">
              <div class="pick-list" id="e_results" style="margin-top:8px;max-height:300px"></div>`
        }
      </div>
    </div>

    <div class="card"><h2>Loot</h2><div id="e_loot"></div></div>`;

  if (window.matchMedia('(max-width: 700px)').matches) root.querySelector('#e_grid').style.gridTemplateColumns = '1fr';
  bindBack(root);
  const $ = (id) => root.querySelector('#' + id);

  // ---- Název a poznámka
  $('e_name').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (v) setEncounterField(eid, 'name', v);
  });
  const saveNote = debounce(() => {
    setEncounterField(eid, 'note', $('e_note').value);
    $('e_note_status').textContent = 'Uloženo';
    setTimeout(() => ($('e_note_status').textContent = ''), 1500);
  }, 600);
  $('e_note').addEventListener('input', saveNote);

  $('e_delete').addEventListener('click', async () => {
    if (!(await confirmDialog('Opravdu smazat toto střetnutí?', { danger: true, okText: 'Smazat' }))) return;
    deleteEncounter(eid);
    toast('Střetnutí smazáno.');
    location.hash = '#/encounters';
  });

  // ---- Účastníci
  function drawInstances() {
    const all = listInstances(eid);
    const pcs = all.filter(isPc);
    const enemies = all.filter((i) => !isPc(i)).sort((a, b) => b.is_boss - a.is_boss || a.id - b.id);

    $('e_pcs').innerHTML = pcs.length
      ? pcs
          .map(
            (p) => `<div class="row-between" style="padding:9px 0;border-bottom:1px solid var(--faint);flex-wrap:nowrap">
              <span>${esc(instanceLabel(p))}${p.level ? ` <span class="muted">(${p.level})</span>` : ''}</span>
              <span class="num nowrap muted">BV ${p.hp_current ?? '—'}/${p.hp_max ?? '—'}</span></div>`
          )
          .join('')
      : '<div class="empty">Žádní hrdinové.</div>';

    $('e_enemies').innerHTML = enemies.length
      ? enemies
          .map((i) => {
            const m = c.monsterById.get(i.monster_id);
            const meta = isSimple(i)
              ? ['zjednodušený', i.simple_ac != null ? 'OČ ' + i.simple_ac : '', i.simple_attack].filter(Boolean)
              : [m?.nebezpecnost ? 'CR ' + m.nebezpecnost : '', m?.obranne_cislo ? 'OČ ' + m.obranne_cislo : '', m?.kategorie ?? ''].filter(Boolean);
            return `<div class="pick-item" data-iid="${i.id}">
              <div class="pick-item__main">
                <input data-rename value="${esc(instanceLabel(i))}" aria-label="Jméno" style="min-height:38px;padding:6px 10px" ${ended ? 'readonly' : ''}>
                <div class="pick-item__meta" style="margin-top:4px">${meta.map(esc).join(' · ')} · BV ${i.hp_max ?? '—'}
                  ${i.is_boss ? ' <span class="badge badge--danger">BOSS</span>' : ''}${i.is_defeated ? ' <span class="badge badge--muted">vyřazen</span>' : ''}</div>
              </div>
              ${m ? `<button class="btn btn-ghost btn-sm btn-icon" type="button" data-info="${m.id}" aria-label="Detail">ⓘ</button>` : ''}
              ${ended ? '' : '<button class="btn btn-danger btn-sm btn-icon" type="button" data-remove aria-label="Odebrat">✕</button>'}
            </div>`;
          })
          .join('')
      : '<div class="empty">Žádní protivníci.</div>';
  }

  $('e_enemies').addEventListener('click', async (e) => {
    const info = e.target.closest('[data-info]');
    if (info) {
      showMonsterModal(Number(info.dataset.info));
      return;
    }
    if (e.target.closest('[data-remove]')) {
      const iid = Number(e.target.closest('[data-iid]').dataset.iid);
      if (!(await confirmDialog('Odebrat protivníka ze střetnutí?', { danger: true, okText: 'Odebrat' }))) return;
      deleteInstance(eid, iid);
      drawInstances();
    }
  });
  $('e_enemies').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-rename]');
    if (inp && inp.value.trim()) renameInstance(eid, Number(inp.closest('[data-iid]').dataset.iid), inp.value);
  });

  // ---- Přidání protivníků
  if (!ended) {
    const doSearch = debounce(() => {
      const q = norm($('e_search').value);
      if (q.length < 2) {
        $('e_results').innerHTML = '';
        return;
      }
      const hits = c.monsters.filter((m) => m._n.includes(q)).slice(0, 20);
      $('e_results').innerHTML =
        hits
          .map(
            (m) => `<div class="pick-item" data-mid="${m.id}">
            <div class="pick-item__main"><div class="pick-item__name">${esc(m.jmeno)}</div>
              <div class="pick-item__meta">${[m.nebezpecnost ? 'CR ' + m.nebezpecnost : '', m.obranne_cislo ? 'OČ ' + m.obranne_cislo : '', m.vydrz ? 'BV ' + m.vydrz : ''].filter(Boolean).join(' · ')}</div></div>
            <div class="qty"><button class="btn btn-secondary btn-sm btn-icon" type="button" data-q="-1">−</button><span class="qty__val" data-qv>1</span><button class="btn btn-secondary btn-sm btn-icon" type="button" data-q="1">+</button></div>
            <label class="toggle small" title="První kus jako boss"><input type="checkbox" data-boss><span class="toggle__slider"></span>Boss</label>
            <button class="btn btn-sm" type="button" data-add>Přidat</button>
          </div>`
          )
          .join('') || '<div class="empty">Nic nenalezeno.</div>';
    }, 150);
    $('e_search').addEventListener('input', doSearch);
    $('e_results').addEventListener('click', (e) => {
      const row = e.target.closest('[data-mid]');
      if (!row) return;
      const qv = row.querySelector('[data-qv]');
      const qb = e.target.closest('[data-q]');
      if (qb) {
        qv.textContent = Math.max(1, Math.min(50, Number(qv.textContent) + Number(qb.dataset.q)));
        return;
      }
      if (e.target.closest('[data-add]')) {
        addEnemyInstances(eid, Number(row.dataset.mid), Number(qv.textContent), row.querySelector('[data-boss]').checked);
        toast('Protivníci přidáni.');
        drawInstances();
      }
    });
  }

  drawInstances();
  mountLoot($('e_loot'), eid, { readOnly: ended });
}
