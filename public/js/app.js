// Vstupní bod: inicializace DB, service workeru a hash routeru.

import { initDatabases } from './db.js';
import { closeAllModals, esc, navState } from './util.js';
import * as home from './views/home.js';
import * as monsters from './views/monsters.js';
import * as items from './views/items.js';
import * as spells from './views/spells.js';
import * as parties from './views/parties.js';
import * as generate from './views/generate.js';
import * as encounters from './views/encounters.js';
import * as encounter from './views/encounter.js';
import * as play from './views/play.js';
import * as settings from './views/settings.js';

const ROUTES = [
  [/^$/, home.render, ''],
  [/^monsters$/, monsters.renderList, 'monster'],
  [/^monster\/(\d+)$/, monsters.renderDetail, 'monster'],
  [/^items$/, items.renderList, 'item'],
  [/^item\/(\d+)$/, items.renderDetail, 'item'],
  [/^spells$/, spells.renderList, 'spell'],
  [/^spell\/(\d+)$/, spells.renderDetail, 'spell'],
  [/^parties$/, parties.render, 'part'],
  [/^generate$/, generate.render, 'encounter'],
  [/^encounters$/, encounters.render, 'encounter'],
  [/^encounter\/(\d+)$/, encounter.render, 'encounter'],
  [/^play\/(\d+)$/, play.render, 'encounter'],
  [/^settings$/, settings.render, 'settings'],
];

const app = document.getElementById('app');
let cleanup = null;

function route() {
  const path = location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  closeAllModals();
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  navState.count++;

  let matched = false;
  for (const [re, fn, navKey] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    matched = true;
    document.querySelectorAll('[data-nav-link]').forEach((a) => a.classList.toggle('is-active', navKey !== '' && a.dataset.navLink === navKey));
    app.innerHTML = '';
    try {
      cleanup = fn(app, ...m.slice(1).map(Number));
    } catch (e) {
      console.error(e);
      app.innerHTML = `<div class="card alert--danger"><h2>Chyba</h2><p>${esc(e.message || e)}</p><a class="btn btn-secondary" href="#/">Domů</a></div>`;
    }
    break;
  }
  if (!matched) {
    app.innerHTML = '<div class="card"><h2>Stránka nenalezena</h2><a class="btn btn-secondary" href="#/">Domů</a></div>';
  }
  window.scrollTo(0, 0);
  document.querySelector('[data-nav]')?.classList.remove('is-open');
}

// Mobilní menu
document.querySelector('[data-nav-toggle]')?.addEventListener('click', (e) => {
  const nav = document.querySelector('[data-nav]');
  const open = !nav.classList.contains('is-open');
  nav.classList.toggle('is-open', open);
  e.currentTarget.setAttribute('aria-expanded', String(open));
});

// Výška topbaru pro sticky prvky
function measureTopbar() {
  const tb = document.querySelector('.topbar');
  if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight - (parseInt(getComputedStyle(tb).paddingTop, 10) || 0) + 'px');
}
window.addEventListener('resize', measureTopbar);

// Service worker + nabídka aktualizace
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Při vývoji na localhostu by cache servírovala staré soubory – SW jen s ?sw=1.
  if (['localhost', '127.0.0.1'].includes(location.hostname) && !new URLSearchParams(location.search).has('sw')) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    return;
  }
  const bar = document.getElementById('updateBar');
  const btn = document.getElementById('updateBtn');
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      const offer = (w) => {
        if (!w || !navigator.serviceWorker.controller) return;
        bar.hidden = false;
        btn.onclick = () => w.postMessage('skipWaiting');
      };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed') offer(w);
        });
      });
      // Kontrola aktualizace při návratu do aplikace
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn('Service worker se nepodařilo registrovat', e));
}

async function boot() {
  measureTopbar();
  initServiceWorker();
  try {
    await initDatabases();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card alert--danger"><h2>Aplikaci se nepodařilo spustit</h2><p>${esc(e.message || e)}</p>
      <p class="small muted">Při úplně prvním spuštění musí být iPad připojený k internetu, aby si aplikace stáhla databázi a knihovnu sql.js. Pak už funguje offline.</p>
      <button class="btn" onclick="location.reload()">Zkusit znovu</button></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
