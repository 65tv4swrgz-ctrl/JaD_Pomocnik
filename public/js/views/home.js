import { esc, installState, isStandalone, platform } from '../util.js';
import { catalog } from '../catalog.js';
import { listEncounters } from '../store.js';
import { DIFF_LABEL, PHASE_LABEL } from '../rules.js';

/** Návod k instalaci podle zařízení (zobrazuje se jen mimo nainstalovanou aplikaci). */
function installTipHtml() {
  const btn = installState.prompt
    ? '<button class="btn btn-sm" type="button" data-install style="margin-top:10px">Nainstalovat aplikaci</button>'
    : '';
  switch (platform()) {
    case 'ios':
      return `<div class="alert alert--warn" style="margin-top:14px">
          <strong>Instalace na iPad / iPhone:</strong> v Safari klepni na <em>Sdílet → Přidat na plochu</em>. Aplikace pak poběží přes celou
          obrazovku a offline. Pozor: data v Safari a v aplikaci z plochy jsou oddělená – postavy a střetnutí zakládej až v nainstalované aplikaci.
        </div>`;
    case 'android':
      return `<div class="alert alert--warn" style="margin-top:14px">
          <strong>Instalace na Android:</strong> v Chromu otevři menu <em>⋮ → Nainstalovat aplikaci</em> (případně <em>Přidat na plochu</em>).
          Aplikace pak poběží jako samostatná a offline. Data jsou společná pro aplikaci i prohlížeč.${btn ? '<br>' + btn : ''}
        </div>`;
    default:
      return `<div class="alert" style="margin-top:14px">
          <strong>Instalace na počítač:</strong> v Chromu nebo Edgi klepni na ikonu instalace v adresním řádku (případně menu <em>⋮ → Nainstalovat</em>).
          Aplikace funguje i bez instalace a po první návštěvě i offline. Data se ukládají jen v tomto prohlížeči – mezi zařízeními je přeneseš přes stránku <a href="#/settings">Data</a>.${
            btn ? '<br>' + btn : ''
          }
        </div>`;
  }
}

export function render(root) {
  const c = catalog();
  const open = listEncounters().filter((e) => e.phase !== 'ended').slice(0, 5);

  root.innerHTML = `
    <h1>JaD Herní pomocník</h1>
    <p class="muted" style="margin:6px 0 0">Příručka a vedení střetnutí – funguje i bez internetu.</p>

    ${isStandalone() ? '' : installTipHtml()}

    <div class="tiles">
      <a class="tile" href="#/generate"><span class="tile__title">Nové střetnutí</span><span class="tile__desc">Generátor s výpočtem síly a lootem</span></a>
      <a class="tile" href="#/encounters"><span class="tile__title">Střetnutí</span><span class="tile__desc">Připravená, probíhající i ukončená</span></a>
      <a class="tile" href="#/characters"><span class="tile__title">Postavy</span><span class="tile__desc">Deníky hráčských postav</span></a>
      <a class="tile" href="#/parties"><span class="tile__title">Družiny</span><span class="tile__desc">Hrdinové pro střetnutí, úrovně a BV</span></a>
      <a class="tile" href="#/monsters"><span class="tile__title">Protivníci</span><span class="tile__desc">${c.monsters.length} v bestiáři</span></a>
      <a class="tile" href="#/items"><span class="tile__title">Předměty</span><span class="tile__desc">${c.items.length} předmětů</span></a>
      <a class="tile" href="#/spells"><span class="tile__title">Kouzla</span><span class="tile__desc">${c.spells.length} kouzel</span></a>
    </div>

    ${
      open.length
        ? `<div class="card">
            <h2>Rozehraná a připravená střetnutí</h2>
            <div class="table-wrap"><table class="table"><tbody>
              ${open
                .map(
                  (e) => `<tr class="rowlink" data-href="#/${e.phase === 'playing' ? 'play' : 'encounter'}/${e.id}">
                    <td><strong>${esc(e.name)}</strong><div class="small muted">${esc(e.party_name)}</div></td>
                    <td><span class="badge diff--${esc(e.difficulty)}">${esc(DIFF_LABEL[e.difficulty] ?? e.difficulty)}</span></td>
                    <td class="t-right"><span class="badge ${e.phase === 'playing' ? 'badge--ok' : ''}">${esc(PHASE_LABEL[e.phase] ?? e.phase)}${
                      e.phase === 'playing' ? ' · kolo ' + e.round_no : ''
                    }</span></td>
                  </tr>`
                )
                .join('')}
            </tbody></table></div>
          </div>`
        : ''
    }
  `;

  root.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => (location.hash = tr.dataset.href)));

  // Systémový dialog instalace (Chrome/Edge); po volbě se úvodní stránka překreslí bez tlačítka.
  root.querySelector('[data-install]')?.addEventListener('click', async () => {
    const p = installState.prompt;
    if (!p) return;
    installState.prompt = null;
    p.prompt();
    await p.userChoice.catch(() => null);
    render(root);
  });
}
