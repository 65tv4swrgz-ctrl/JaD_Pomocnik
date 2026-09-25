import { dataVersion, exportUserBytes, flushUser, importUserBytes, resetUserData, SQLJS_VERSION, storageInfo, user } from '../db.js';
import { APP_VERSION } from '../version.js';
import { confirmDialog, esc, fmtDate, toast } from '../util.js';

const fmtBytes = (n) => (n == null ? '—' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB');

export function render(root) {
  const counts = {
    parties: user.value('SELECT COUNT(*) FROM parties'),
    members: user.value('SELECT COUNT(*) FROM party_members'),
    encounters: user.value('SELECT COUNT(*) FROM encounters'),
  };
  const dv = dataVersion || {};

  root.innerHTML = `
    <h1>Data a záloha</h1>

    <div class="card">
      <h2>Moje data</h2>
      <p class="muted small" style="margin-top:0">Družiny a střetnutí jsou uložené jen v tomto zařízení (v prohlížeči). Občas si udělej zálohu –
        smazáním aplikace nebo dat Safari by se ztratila.</p>
      <div class="kv"><div class="kv__k">Družiny</div><div class="kv__v">${counts.parties} (${counts.members} postav)</div></div>
      <div class="kv"><div class="kv__k">Střetnutí</div><div class="kv__v">${counts.encounters}</div></div>
      <div class="kv"><div class="kv__k">Trvalé úložiště</div><div class="kv__v" id="st_persist">…</div></div>
      <div class="kv"><div class="kv__k">Využito místa</div><div class="kv__v" id="st_usage">…</div></div>
      <div class="row-gap" style="margin-top:14px">
        <button class="btn" type="button" id="st_export">Zálohovat…</button>
        <label class="btn btn-secondary" style="position:relative;overflow:hidden">Obnovit ze zálohy…
          <input type="file" id="st_import" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>
        <button class="btn btn-danger" type="button" id="st_reset">Smazat všechna moje data</button>
      </div>
    </div>

    <div class="card">
      <h2>Herní databáze</h2>
      <div class="kv"><div class="kv__k">Verze dat</div><div class="kv__v">${esc(dv.version ?? '—')}${dv.built ? ' · ' + esc(fmtDate(dv.built)) : ''}</div></div>
      ${
        dv.counts
          ? `<div class="kv"><div class="kv__k">Obsah</div><div class="kv__v">${dv.counts.jad_monsters} protivníků, ${dv.counts.jad_items} předmětů, ${dv.counts.spells} kouzel</div></div>`
          : ''
      }
      <div class="kv"><div class="kv__k">Aplikace</div><div class="kv__v">${esc(APP_VERSION)} · sql.js ${esc(SQLJS_VERSION)}</div></div>
      <div class="kv"><div class="kv__k">Režim</div><div class="kv__v">${
        window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'nainstalovaná aplikace' : 'v prohlížeči'
      } · ${navigator.onLine ? 'online' : 'offline'}</div></div>
      <p class="small muted" style="margin-bottom:0">Herní data se aktualizují spolu s aplikací – když je k dispozici nová verze, nahoře se objeví lišta „Aktualizovat“.</p>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);

  storageInfo().then((s) => {
    $('st_persist').textContent = s.persisted === null ? 'nezjištěno' : s.persisted ? 'ano – prohlížeč data neuklidí' : 'ne (prohlížeč je může při nedostatku místa smazat)';
    $('st_usage').textContent = s.usage == null ? '—' : `${fmtBytes(s.usage)}${s.quota ? ' z ' + fmtBytes(s.quota) : ''}`;
  });

  $('st_export').addEventListener('click', async () => {
    await flushUser();
    const bytes = exportUserBytes();
    const name = `jad-zaloha-${new Date().toISOString().slice(0, 10)}.sqlite`;
    const file = new File([bytes], name, { type: 'application/x-sqlite3' });
    // Na iPadu je nejpohodlnější sdílecí list (Uložit do Souborů, AirDrop…).
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Záloha JaD Pomocníka' });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  $('st_import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!(await confirmDialog(`Obnovit data ze souboru „${f.name}“? Současné družiny a střetnutí budou nahrazeny.`, { okText: 'Obnovit', danger: true }))) return;
    try {
      await importUserBytes(new Uint8Array(await f.arrayBuffer()));
      toast('Data obnovena.');
      render(root);
    } catch (err) {
      toast('Obnova selhala: ' + (err.message || err), 'err', 5000);
    }
  });

  $('st_reset').addEventListener('click', async () => {
    if (!(await confirmDialog('Opravdu smazat všechny družiny a střetnutí v tomto zařízení? Nejde to vrátit.', { okText: 'Smazat vše', danger: true }))) return;
    await resetUserData();
    toast('Data smazána.');
    render(root);
  });
}
