import { addMember, createParty, deleteMember, deleteParty, listParties, renameParty, restParty, updateMember } from '../store.js';
import { bindSteppers, confirmDialog, esc, stepperHtml, toast } from '../util.js';

const intOrNull = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

export function render(host) {
  // Vlastní obal – delegovaný posluchač stepperů nesmí viset na #app.
  const root = document.createElement('div');
  host.appendChild(root);
  bindSteppers(root);

  const draw = () => {
    const parties = listParties();
    root.innerHTML = `
      <div class="page-head"><h1>Družiny</h1><a class="btn btn-secondary btn-sm" href="#/generate">Nové střetnutí</a></div>
      <p class="muted small" style="margin:6px 0 0">Družina je skupina hrdinů pro generátor střetnutí. Body výdrže (BV) se během boje průběžně zapisují zpět sem.</p>

      <form class="card row-gap" id="newParty">
        <label class="field" style="flex:1;min-width:220px">Nová družina<input name="name" placeholder="např. Stříbrní vlci" maxlength="100" required></label>
        <button class="btn" type="submit" style="align-self:end">Založit</button>
      </form>

      ${parties.length ? '' : '<div class="card empty">Zatím žádná družina. Založ první a přidej do ní postavy.</div>'}

      ${parties
        .map(
          (p) => `
        <div class="card" data-party="${p.id}">
          <div class="row-between">
            <input class="party-name" value="${esc(p.name)}" aria-label="Název družiny" style="font-weight:800;font-size:1.1rem;max-width:420px">
            <div class="row-gap">
              <button class="btn btn-secondary btn-sm" type="button" data-rest title="Všem nastaví BV na maximum">Dlouhý odpočinek</button>
              <button class="btn btn-danger btn-sm" type="button" data-del-party>Smazat</button>
            </div>
          </div>
          <div class="table-wrap" style="margin-top:10px"><table class="table">
            <thead><tr><th>Postava</th><th style="width:90px">Úroveň</th><th style="width:110px">BV teď</th><th style="width:110px">BV max</th><th style="width:1%"></th></tr></thead>
            <tbody>
              ${p.members
                .map(
                  (m) => `<tr data-member="${m.id}">
                  <td><input data-f="name" value="${esc(m.name)}" aria-label="Jméno" maxlength="100"></td>
                  <td><input data-f="level" type="number" inputmode="numeric" min="1" max="20" value="${m.level}" aria-label="Úroveň"></td>
                  <td><input data-f="bv_ted" type="number" inputmode="numeric" value="${m.bv_ted ?? ''}" placeholder="—" aria-label="BV teď"></td>
                  <td><input data-f="bv_max" type="number" inputmode="numeric" value="${m.bv_max ?? ''}" placeholder="—" aria-label="BV max"></td>
                  <td><button class="btn btn-danger btn-sm btn-icon" type="button" data-del-member aria-label="Odebrat">✕</button></td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table></div>
          <div class="add-member">
            <label class="field" style="flex:1 1 220px">Nová postava<input data-new="name" placeholder="Jméno nové postavy" maxlength="100"></label>
            <div class="field"><span>Úroveň</span>${stepperHtml('data-new="level"', 1, { min: 1, max: 20, label: 'Úroveň' })}</div>
            <div class="field"><span>BV max (nepovinné)</span>${stepperHtml('data-new="bv_max"', '', { min: 0, start: 10, placeholder: '—', label: 'BV max' })}</div>
            <button class="btn" type="button" data-add-member>Přidat postavu</button>
          </div>
          ${
            p.members.length
              ? `<div class="small muted">Úroveň družiny (průměr): <strong>${Math.max(1, Math.min(20, Math.round(p.members.reduce((s, m) => s + m.level, 0) / p.members.length)))}</strong> · ${p.members.length} ${
                  p.members.length === 1 ? 'postava' : p.members.length < 5 ? 'postavy' : 'postav'
                }</div>`
              : ''
          }
        </div>`
        )
        .join('')}`;

    root.querySelector('#newParty').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) return;
      createParty(name);
      toast('Družina založena.');
      draw();
    });

    root.querySelectorAll('[data-party]').forEach((card) => {
      const pid = Number(card.dataset.party);
      card.querySelector('.party-name').addEventListener('change', (e) => renameParty(pid, e.target.value));
      card.querySelector('[data-rest]').addEventListener('click', () => {
        restParty(pid);
        toast('BV obnoveny na maximum.');
        draw();
      });
      card.querySelector('[data-del-party]').addEventListener('click', async () => {
        if (!(await confirmDialog('Smazat družinu včetně postav? Už vytvořená střetnutí zůstanou.', { danger: true, okText: 'Smazat' }))) return;
        deleteParty(pid);
        draw();
      });
      card.querySelectorAll('tr[data-member]').forEach((tr) => {
        const mid = Number(tr.dataset.member);
        tr.querySelectorAll('input[data-f]').forEach((inp) =>
          inp.addEventListener('change', () => {
            const f = inp.dataset.f;
            const v = f === 'name' ? inp.value.trim() : intOrNull(inp.value);
            if (f === 'name' && !v) return;
            updateMember(mid, { [f]: f === 'level' ? v ?? 1 : v });
          })
        );
        tr.querySelector('[data-del-member]').addEventListener('click', async () => {
          if (!(await confirmDialog('Odebrat postavu z družiny?', { danger: true, okText: 'Odebrat' }))) return;
          deleteMember(mid);
          draw();
        });
      });
      const add = () => {
        const name = card.querySelector('[data-new="name"]').value.trim();
        if (!name) {
          toast('Zadej jméno postavy.', 'warn');
          return;
        }
        addMember(pid, {
          name,
          level: intOrNull(card.querySelector('[data-new="level"]').value) ?? 1,
          bv_max: intOrNull(card.querySelector('[data-new="bv_max"]').value),
        });
        draw();
        root.querySelector(`[data-party="${pid}"] [data-new="name"]`)?.focus();
      };
      card.querySelector('[data-add-member]').addEventListener('click', add);
      card.querySelectorAll('[data-new]').forEach((inp) =>
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        })
      );
    });
  };
  draw();
}
