// Drobné pomocné funkce sdílené všemi pohledy.

/** HTML escape. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Normalizace pro vyhledávání: malá písmena, bez diakritiky. */
export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export const collator = new Intl.Collator('cs', { numeric: true, sensitivity: 'base' });
export const cmp = (a, b) => collator.compare(String(a ?? ''), String(b ?? ''));

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Náhodné celé číslo v intervalu <min, max> (kryptograficky, jako random_int v PHP). */
export function randInt(min, max) {
  const range = max - min + 1;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / range) * range;
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return min + (x % range);
}

export const d20 = () => randInt(1, 20);

export function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

export function fmtMod(v) {
  if (isBlank(v)) return '—';
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return String(v);
  if (n === 0) return '0';
  return (n > 0 ? '+' : '') + n;
}

export function dash(v) {
  return isBlank(v) ? '—' : String(v);
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Uložené preference (filtry apod.) – jen pohodlí, aplikace funguje i bez nich.

export function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem('jad:' + key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem('jad:' + key, JSON.stringify(value));
  } catch {
    /* soukromý režim apod. */
  }
}

// ---------------------------------------------------------------------------
// Toasty

export function toast(msg, type = 'ok', ms = 2600) {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast toast--' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------------------------------------------------------------------------
// Modální okna

let modalStack = [];

/**
 * Otevře modal. `body` je HTML string nebo Node. Vrací objekt s `el`, `body`, `close()`.
 * `onClose` se zavolá při zavření (i backdropem / Esc), pokud `dismissible` není false.
 */
export function openModal({ title = '', body = '', foot = '', wide = false, dismissible = true, onClose = null } = {}) {
  const el = document.createElement('div');
  el.className = 'modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="modal__backdrop" ${dismissible ? 'data-close' : ''}></div>
    <div class="modal__dialog ${wide ? 'modal__dialog--wide' : ''}">
      <div class="modal__head">
        <h2 class="modal__title">${esc(title)}</h2>
        ${dismissible ? '<button type="button" class="btn btn-sm btn-ghost btn-icon" data-close aria-label="Zavřít">✕</button>' : ''}
      </div>
      <div class="modal__body"></div>
      ${foot ? '<div class="modal__foot"></div>' : ''}
    </div>`;
  const bodyEl = el.querySelector('.modal__body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  const footEl = el.querySelector('.modal__foot');
  if (footEl) {
    if (typeof foot === 'string') footEl.innerHTML = foot;
    else footEl.appendChild(foot);
  }

  const api = {
    el,
    body: bodyEl,
    foot: footEl,
    closed: false,
    close() {
      if (api.closed) return;
      api.closed = true;
      el.remove();
      modalStack = modalStack.filter((m) => m !== api);
      if (!modalStack.length) document.body.classList.remove('modal-open');
      if (onClose) onClose();
    },
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      e.preventDefault();
      api.close();
    }
  });
  api.dismissible = dismissible;
  document.body.appendChild(el);
  document.body.classList.add('modal-open');
  modalStack.push(api);
  const focusEl = bodyEl.querySelector('[autofocus]');
  if (focusEl) setTimeout(() => focusEl.focus(), 30);
  return api;
}

export function closeAllModals() {
  [...modalStack].forEach((m) => m.close());
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !modalStack.length) return;
  const top = modalStack[modalStack.length - 1];
  if (top.dismissible) top.close();
});

/** Potvrzovací dialog – Promise<boolean>. */
export function confirmDialog(message, { title = 'Potvrzení', okText = 'Ano', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      title,
      body: `<p style="margin:0">${esc(message)}</p>`,
      foot: `<button type="button" class="btn btn-secondary" data-close>Zrušit</button>
             <button type="button" class="btn ${danger ? 'btn-danger' : ''}" data-ok>${esc(okText)}</button>`,
      onClose: () => resolve(result),
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      result = true;
      m.close();
    });
  });
}

/**
 * Dialog pro zadání čísel. fields: [{name,label,value,placeholder}]. Vrací Promise<object|null>.
 */
export function numberDialog({ title, fields, okText = 'Uložit', hint = '' }) {
  return new Promise((resolve) => {
    let result = null;
    const inputs = fields
      .map(
        (f, i) => `<label class="field">${esc(f.label)}
          <input type="number" inputmode="numeric" name="${esc(f.name)}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder ?? '')}" ${i === 0 ? 'autofocus' : ''}></label>`
      )
      .join('');
    const m = openModal({
      title,
      body: `<form class="grid ${fields.length > 1 ? 'grid-2' : ''}" data-form>${inputs}</form>${hint ? `<p class="small muted" style="margin:10px 0 0">${esc(hint)}</p>` : ''}`,
      foot: `<button type="button" class="btn btn-secondary" data-close>Zrušit</button><button type="button" class="btn" data-ok>${esc(okText)}</button>`,
      onClose: () => resolve(result),
    });
    const submit = () => {
      const out = {};
      m.el.querySelectorAll('input[name]').forEach((inp) => {
        const v = inp.value.trim();
        out[inp.name] = v === '' ? null : parseInt(v, 10);
      });
      result = out;
      m.close();
    };
    m.el.querySelector('[data-ok]').addEventListener('click', submit);
    m.el.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
  });
}

// ---------------------------------------------------------------------------
// Číselné pole s tlačítky − / + (dotykové ovládání)

/**
 * attrs: HTML atributy pro <input> (např. 'data-new="level"'), value: výchozí hodnota,
 * start: hodnota, na kterou skočí „+“/„−“ z prázdného pole.
 */
export function stepperHtml(attrs, value, { min = null, max = null, start = null, placeholder = '', label = '' } = {}) {
  return `<span class="stepper">
    <button class="btn btn-secondary btn-sm btn-icon" type="button" data-step="-1" aria-label="${esc(label)} −">−</button>
    <input type="number" inputmode="numeric" ${attrs} value="${esc(value ?? '')}" placeholder="${esc(placeholder)}"
      ${min !== null ? `min="${min}"` : ''} ${max !== null ? `max="${max}"` : ''} ${start !== null ? `data-start="${start}"` : ''} aria-label="${esc(label)}">
    <button class="btn btn-secondary btn-sm btn-icon" type="button" data-step="1" aria-label="${esc(label)} +">+</button>
  </span>`;
}

/** Jeden delegovaný posluchač pro všechny steppery uvnitř root. */
export function bindSteppers(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.stepper [data-step]');
    if (!b) return;
    const inp = b.closest('.stepper').querySelector('input');
    const step = Number(b.dataset.step);
    const min = inp.min !== '' ? Number(inp.min) : -Infinity;
    const max = inp.max !== '' ? Number(inp.max) : Infinity;
    const cur = parseInt(inp.value, 10);
    let next;
    if (Number.isFinite(cur)) next = cur + step;
    else next = inp.dataset.start !== undefined ? Number(inp.dataset.start) : step > 0 ? Math.max(min, 1) : Math.max(min, 0);
    inp.value = String(Math.max(min, Math.min(max, next)));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------

export const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M15 8a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 0 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 7.5H14.5A.5.5 0 0 1 15 8z"/></svg>';

export const DICE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="4" cy="4" r="1.3"/><circle cx="12" cy="4" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="4" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/></svg>';

/** Tlačítko zpět – použije historii, jinak fallback. */
export function backButton(fallbackHash) {
  return `<button type="button" class="btn btn-secondary btn-sm btn-icon" aria-label="Zpět" data-back="${esc(fallbackHash)}">${BACK_ICON}</button>`;
}

/** Počet navigací uvnitř aplikace (router ho zvyšuje) – když je 1, není kam „zpět“. */
export const navState = { count: 0 };

export function bindBack(root) {
  root.querySelectorAll('[data-back]').forEach((b) =>
    b.addEventListener('click', () => {
      if (navState.count > 1) history.back();
      else location.hash = b.getAttribute('data-back');
    })
  );
}
