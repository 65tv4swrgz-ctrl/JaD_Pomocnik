// Seznam hráčských postav + založení nové postavy (characters.php).

import { ABILITIES, ALIGNMENTS, BACKGROUNDS, CLASSES, HIT_DICE, RACES, SPELL_ABILITIES } from '../charrules.js';
import { createCharacter, deleteCharacter, listCharacters } from '../charstore.js';
import { bindSteppers, confirmDialog, esc, openModal, stepperHtml, toast } from '../util.js';
import { chestGridHtml, readChestGrid, readSlotGrid, slotGridHtml } from './character.js';

const classLine = (c) => (c.povolani ? c.povolani + (c.specializace ? ` (${c.specializace})` : '') : '—');

export function render(host) {
  const root = document.createElement('div');
  host.appendChild(root);

  const draw = () => {
    const rows = listCharacters();
    root.innerHTML = `
      <div class="page-head"><h1>Postavy</h1><button class="btn btn-sm" type="button" data-new>+ Nová postava</button></div>
      <div class="card">
        ${
          rows.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>Postava</th><th>Rasa</th><th>Povolání</th><th class="t-center">Úroveň</th><th class="t-center">BV</th><th style="width:1%"></th></tr></thead>
                <tbody>${rows
                  .map(
                    (c) => `<tr class="rowlink" data-id="${c.id}">
                      <td><strong>${esc(c.jmeno)}</strong></td>
                      <td>${esc(c.rasa ?? '—')}</td>
                      <td>${esc(classLine(c))}</td>
                      <td class="t-center num">${c.uroven}</td>
                      <td class="t-center num nowrap">${c.bv_ted ?? '—'}/${c.bv_max ?? '—'}</td>
                      <td><button class="btn btn-danger btn-sm btn-icon" type="button" data-del aria-label="Smazat">✕</button></td>
                    </tr>`
                  )
                  .join('')}</tbody></table></div>`
            : '<div class="empty">Zatím tu nemáš žádné postavy. Založ první tlačítkem „Nová postava“.</div>'
        }
      </div>`;
  };

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new]')) {
      openCreate();
      return;
    }
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    if (e.target.closest('[data-del]')) {
      const name = tr.querySelector('strong').textContent;
      if (!(await confirmDialog(`Opravdu smazat postavu „${name}“ včetně inventáře a kouzel?`, { danger: true, okText: 'Smazat' }))) return;
      deleteCharacter(id);
      toast('Postava smazána.');
      draw();
      return;
    }
    location.hash = '#/character/' + id;
  });

  draw();
}

function openCreate() {
  const opt = (list) => list.map((v) => `<option>${esc(v)}</option>`).join('');
  const m = openModal({
    title: 'Nová postava',
    wide: true,
    body: `<form class="grid" data-form>
      <div class="grid grid-2">
        <label class="field">Jméno<input name="jmeno" maxlength="50" placeholder="Např. Eldrin" autocomplete="off" autofocus></label>
        <label class="field">Přesvědčení<select name="presvedceni"><option value="">— vyber —</option>${opt(ALIGNMENTS)}</select></label>
      </div>
      <div class="grid grid-3">
        <label class="field">Rasa<select name="rasa"><option value="">— vyber —</option>${opt(RACES)}</select></label>
        <label class="field">Zázemí<select name="zazemi"><option value="">— vyber —</option>${opt(BACKGROUNDS)}</select></label>
        <label class="field">Povolání<select name="povolani"><option value="">— vyber —</option>${opt(CLASSES)}</select></label>
      </div>
      <div class="grid grid-2">
        <label class="field">Kostka obnovy<select name="kostka_obnovy"><option value="">—</option>${opt(HIT_DICE)}</select></label>
        <label class="field">Vlastnost pro SO záchrany schopností<select name="bojova_vlastnost"><option value="">— volitelné —</option>${opt(ABILITIES.map(([, n]) => n))}</select></label>
      </div>

      <div class="caster-box">
        <label class="toggle"><input type="checkbox" name="kouzli" data-caster><span class="toggle__slider"></span><strong style="color:var(--text)">Kouzlí</strong></label>
        <div data-caster-fields hidden>
          <label class="field" style="max-width:320px;margin:8px 0 12px">Sesílací vlastnost<select name="sesilaci_vlastnost"><option value="">— vyber —</option>${opt(SPELL_ABILITIES)}</select></label>
          <div class="slots-row">
            <div><div class="slots-title">Pozice kouzel</div><div class="small muted">Zaškrtni dostupné pozice kouzel.</div>${slotGridHtml({ mode: 'pick', selected: {} })}</div>
            <div><div class="slots-title">Použití truhly</div><div class="small muted">Zaškrtni dostupné pozice truhly.</div>${chestGridHtml({ mode: 'pick', selected: [] })}</div>
          </div>
        </div>
      </div>

      <div class="field"><span>Měšec <span class="muted">(1 Zl = 10 St, 1 St = 10 Md)</span></span>
        <div class="row-gap">
          <span class="coin-field"><img class="coin" src="icons/zl_mince.png" alt="Zl">${stepperHtml('name="mesec_zl"', 0, { min: 0, label: 'Zl' })}</span>
          <span class="coin-field"><img class="coin" src="icons/st_mince.png" alt="St">${stepperHtml('name="mesec_st"', 0, { min: 0, label: 'St' })}</span>
          <span class="coin-field"><img class="coin" src="icons/md_mince.png" alt="Md">${stepperHtml('name="mesec_md"', 0, { min: 0, label: 'Md' })}</span>
        </div>
      </div>
      <p class="small" style="color:#ffcf8a;margin:0">Ostatní údaje a hodnoty nastavíš po vytvoření postavy v jejím deníku.</p>
      <div class="alert alert--danger pre" data-err hidden></div>
    </form>`,
    foot: '<button class="btn btn-secondary" type="button" data-close>Zrušit</button><button class="btn" type="button" data-ok>Vytvořit postavu</button>',
  });
  bindSteppers(m.el);
  const f = m.el.querySelector('[data-form]');
  m.el.querySelector('[data-caster]').addEventListener('change', (e) => {
    m.el.querySelector('[data-caster-fields]').hidden = !e.target.checked;
  });
  m.el.querySelector('[data-ok]').addEventListener('click', () => {
    const v = (n) => f.elements[n].value;
    try {
      const id = createCharacter({
        jmeno: v('jmeno'),
        presvedceni: v('presvedceni'),
        rasa: v('rasa'),
        zazemi: v('zazemi'),
        povolani: v('povolani'),
        kostka_obnovy: v('kostka_obnovy'),
        bojova_vlastnost: v('bojova_vlastnost'),
        kouzli: f.elements.kouzli.checked,
        sesilaci_vlastnost: v('sesilaci_vlastnost'),
        spell_slots: readSlotGrid(m.el),
        chest_slots: readChestGrid(m.el),
        mesec_zl: v('mesec_zl'),
        mesec_st: v('mesec_st'),
        mesec_md: v('mesec_md'),
      });
      m.close();
      toast('Postava vytvořena.');
      location.hash = '#/character/' + id;
    } catch (err) {
      const box = m.el.querySelector('[data-err]');
      box.textContent = err.message;
      box.hidden = false;
      box.scrollIntoView({ block: 'nearest' });
    }
  });
}
