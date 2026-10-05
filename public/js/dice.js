// Házeč kostkami – plovoucí tlačítko vpravo dole a nabídka kostek nad všemi stránkami.
// 3D scéna (dice3d.js + three.js + cannon-es) se načte až při prvním hodu.

import { loadPref, savePref, toast } from './util.js';

const TYPES = [
  ['d4', 'K4'],
  ['d6', 'K6'],
  ['d8', 'K8'],
  ['d10', 'K10'],
  ['d12', 'K12'],
  ['d20', 'K20'],
  ['d100', 'K100'],
];

// Obrysy kostek pro nabídku (pohled shora).
const ICON = {
  d4: '<polygon points="12,3 21,20 3,20"/>',
  d6: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  d8: '<polygon points="12,2 21,12 12,22 3,12"/><line x1="3" y1="12" x2="21" y2="12"/>',
  d10: '<polygon points="12,2 21,10 12,22 3,10"/><polyline points="3,10 12,14 21,10"/><line x1="12" y1="14" x2="12" y2="22"/>',
  d12: '<polygon points="12,2 21,8.5 17.6,19.5 6.4,19.5 3,8.5"/><polygon points="12,7 16.5,10.2 14.8,15.5 9.2,15.5 7.5,10.2"/>',
  d20: '<polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/><polygon points="12,6 17.5,15.5 6.5,15.5"/>',
  d100: '<polygon points="9,2 16,8 9,17 2,8"/><polygon points="16,7 23,13 16,22 9,13"/>',
};
const iconSvg = (t, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${ICON[t]}</svg>`;

let engine = null;
async function loadEngine() {
  engine ||= import('./dice3d.js');
  return engine;
}

export function mountDice() {
  const counts = loadPref('dice', Object.fromEntries(TYPES.map(([t]) => [t, t === 'd20' ? 1 : 0])));

  const wrap = document.createElement('div');
  wrap.className = 'dice-ui';
  wrap.innerHTML = `
    <div class="dice-menu" role="dialog" aria-label="Házeč kostkami" hidden>
      <div class="dice-menu__rows">
        ${TYPES.map(
          ([t, l]) => `<div class="dice-row" data-type="${t}">
            <span class="dice-row__die">${iconSvg(t)}<span>${l}</span></span>
            <span class="qty">
              <button class="btn btn-secondary btn-sm btn-icon" type="button" data-d="-1" aria-label="${l} méně">−</button>
              <span class="qty__val" data-count>0</span>
              <button class="btn btn-secondary btn-sm btn-icon" type="button" data-d="1" aria-label="${l} více">+</button>
            </span>
          </div>`
        ).join('')}
      </div>
      <div class="dice-menu__sum" data-sum></div>
      <div class="dice-menu__foot">
        <button class="btn btn-ghost btn-sm" type="button" data-clear>Vynulovat</button>
        <button class="btn dice-menu__roll" type="button" data-roll>HOD</button>
      </div>
    </div>
    <button class="dice-fab" type="button" aria-label="Házeč kostkami" aria-expanded="false">${iconSvg('d20', 30)}</button>`;
  document.body.appendChild(wrap);

  const menu = wrap.querySelector('.dice-menu');
  const fab = wrap.querySelector('.dice-fab');
  const rollBtn = wrap.querySelector('[data-roll]');

  const sync = () => {
    wrap.querySelectorAll('.dice-row').forEach((r) => {
      const n = counts[r.dataset.type] ?? 0;
      r.querySelector('[data-count]').textContent = n;
      r.classList.toggle('is-active', n > 0);
    });
    const total = TYPES.reduce((s, [t]) => s + (counts[t] ?? 0), 0);
    rollBtn.disabled = total === 0;
    wrap.querySelector('[data-sum]').textContent = total ? describe() : 'Vyber kostky';
    savePref('dice', counts);
  };
  const describe = () =>
    TYPES.filter(([t]) => counts[t] > 0)
      .map(([t, l]) => (counts[t] > 1 ? counts[t] : '') + l)
      .join(' + ');

  const setOpen = (open) => {
    menu.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    fab.classList.toggle('is-open', open);
  };

  async function roll() {
    const spec = TYPES.map(([t]) => ({ type: t, count: counts[t] ?? 0 })).filter((s) => s.count > 0);
    if (!spec.length) return;
    setOpen(false);
    try {
      const mod = await loadEngine();
      mod.roll(spec, { onReroll: roll });
    } catch (e) {
      console.error(e);
      engine = null;
      toast('Házeč se nepodařilo načíst. Při prvním použití musí být zařízení online.', 'err', 5000);
    }
  }

  fab.addEventListener('click', () => setOpen(menu.hidden));
  wrap.addEventListener('click', (e) => {
    const step = e.target.closest('[data-d]');
    if (step) {
      const t = step.closest('.dice-row').dataset.type;
      counts[t] = Math.max(0, Math.min(20, (counts[t] ?? 0) + Number(step.dataset.d)));
      sync();
    } else if (e.target.closest('[data-clear]')) {
      for (const [t] of TYPES) counts[t] = 0;
      sync();
    } else if (e.target.closest('[data-roll]')) {
      roll();
    }
  });
  // Zavření nabídky klepnutím mimo ni nebo Esc.
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !wrap.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', async (e) => {
    if (e.key !== 'Escape') return;
    if (!menu.hidden) setOpen(false);
    else if (engine) (await engine).close();
  });

  // Při prvním otevření nabídky si engine stáhneme dopředu, ať je hod okamžitý.
  fab.addEventListener('click', () => loadEngine().catch(() => (engine = null)), { once: true });

  sync();
}
