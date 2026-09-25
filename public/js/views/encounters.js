import { deleteEncounter, listEncounters } from '../store.js';
import { DIFF_LABEL, LOOT_LABEL, PHASE_LABEL } from '../rules.js';
import { confirmDialog, esc, fmtDate, toast } from '../util.js';

export function render(root) {
  const draw = () => {
    const rows = listEncounters();
    root.innerHTML = `
      <div class="page-head"><h1>Střetnutí</h1><a class="btn btn-sm" href="#/generate">+ Nové střetnutí</a></div>
      <div class="card">
        ${
          rows.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>Název</th><th>Obtížnost</th><th>Stav</th><th class="t-center">Protivníci</th><th>Upraveno</th><th style="width:1%"></th></tr></thead>
                <tbody>
                  ${rows
                    .map(
                      (e) => `<tr class="rowlink" data-id="${e.id}" data-phase="${esc(e.phase)}">
                      <td><strong>${esc(e.name)}</strong><div class="small muted">${esc(e.party_name)} · loot: ${esc(LOOT_LABEL[e.loot_mode] ?? e.loot_mode)}</div></td>
                      <td><span class="badge diff--${esc(e.difficulty)}">${esc(DIFF_LABEL[e.difficulty] ?? e.difficulty)}</span></td>
                      <td><span class="badge ${e.phase === 'playing' ? 'badge--ok' : e.phase === 'ended' ? 'badge--muted' : ''}">${esc(PHASE_LABEL[e.phase] ?? e.phase)}${
                        e.phase === 'playing' ? ' · kolo ' + e.round_no : ''
                      }</span></td>
                      <td class="t-center num">${e.enemy_count}</td>
                      <td class="small muted nowrap">${esc(fmtDate(e.updated_at))}</td>
                      <td class="nowrap">
                        <a class="btn btn-sm ${e.phase === 'ended' ? 'btn-secondary' : ''}" href="#/play/${e.id}" data-stop>${
                          e.phase === 'prepared' ? 'Hrát' : e.phase === 'playing' ? 'Pokračovat' : 'Zobrazit boj'
                        }</a>
                        <button class="btn btn-danger btn-sm btn-icon" type="button" data-del aria-label="Smazat">✕</button>
                      </td>
                    </tr>`
                    )
                    .join('')}
                </tbody></table></div>`
            : '<div class="empty">Zatím žádná střetnutí. Vytvoř první v <a href="#/generate">generátoru</a>.</div>'
        }
      </div>`;

    root.querySelectorAll('tr[data-id]').forEach((tr) => {
      const id = Number(tr.dataset.id);
      tr.addEventListener('click', async (e) => {
        if (e.target.closest('[data-stop]')) return;
        if (e.target.closest('[data-del]')) {
          if (!(await confirmDialog('Opravdu smazat toto střetnutí včetně lootu a stavů?', { danger: true, okText: 'Smazat' }))) return;
          deleteEncounter(id);
          toast('Střetnutí smazáno.');
          draw();
          return;
        }
        location.hash = '#/encounter/' + id;
      });
    });
  };
  draw();
}
