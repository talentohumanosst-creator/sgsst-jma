/* SG-SST J.M.A · Sincronización con el servidor de Google (solo en la app instalada)
   - Todo se guarda primero en el equipo. Cuando hay señal, se envía al servidor.
   - El servidor guarda la fila en la hoja de Google, las fotos y firmas en Drive y crea el PDF con número oficial.
   - Usuarios, equipos, vehículos, conductores, firmas e inspecciones llegan desde el servidor a todos los equipos. */
(function () {
  if (!PROD) return;
  const CFG_KEY = 'sgsst-jma-conexion';
  let cfg = {}; try { cfg = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} };
  let busy = false, timer = null, lastErr = '', logoData = '';
  S.sh = S.sh || {};

  /* logo embebido para los PDF */
  fetch(LOGO_H).then(r => r.ok ? r.blob() : null).then(b => { if (!b) return; const fr = new FileReader(); fr.onload = () => logoData = fr.result; fr.readAsDataURL(b); }).catch(() => {});

  /* enlace de conexión: …/#c=<url del servidor>~<clave> */
  function readLink() {
    const h = location.hash;
    if (!h.startsWith('#c=')) return;
    const [u, t] = decodeURIComponent(h.slice(3)).split('~');
    if (u && t) { cfg.url = u.trim(); cfg.token = t.trim(); saveCfg(); toast('Este equipo quedó conectado al servidor'); }
    history.replaceState(null, '', location.pathname);
    pull(true);
  }

  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
  const H = o => hash(JSON.stringify(o));

  /* registros que deben llegar al servidor */
  function collect() {
    const out = [];
    S.permits.filter(p => p.status !== 'borrador' && !p.ejemplo).forEach(p => out.push({ key: p.tipo + ':' + p.id, t: p.tipo, id: p.id, data: p,
      nombre: (p.tipo === 'ats' ? (p.gen.actividad || '') : (p.gen.area || '')).slice(0, 60), doc: () => { ui.pid = p.id; return vDoc(); } }));
    (S.insps || []).filter(i => !i.ejemplo && !i.remoto && !i.borrador).forEach(i => out.push({ key: 'insp:' + i.id, t: 'insp', id: i.id, data: i,
      nombre: i.code + ' ' + i.fecha, doc: () => { ui.insp = i.id; return vInspDoc(); } }));
    (S.preops || []).filter(x => !x.remoto).forEach(x => out.push({ key: 'preop:' + x.id, t: 'preop', id: x.id, data: x,
      nombre: x.placa + ' ' + x.fecha, doc: () => { ui.pre = x.id; return vPreDoc(); } }));
    (S.equipos || []).filter(e => !e.ejemplo).forEach(e => out.push({ key: 'equipo:' + e.code, t: 'equipo', id: e.code, data: e }));
    (S.vehiculos || []).filter(v => !v.ejemplo).forEach(v => out.push({ key: 'vehiculo:' + v.placa, t: 'vehiculo', id: v.placa, data: v }));
    (S.conductores || []).forEach(c => out.push({ key: 'conductor:' + c.cedula, t: 'conductor', id: c.cedula, data: { cedula: c.cedula, nombre: c.nombre, cat: c.cat, licVence: c.licVence } }));
    Object.entries(S.firmasReg || {}).forEach(([c, img]) => out.push({ key: 'firma:' + c, t: 'firma', id: c, data: { cedula: c, img } }));
    return out;
  }
  const pending = () => collect().filter(r => H(r.data) !== S.sh[r.key]);

  /* documento para el PDF */
  const PDF_CSS = 'body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;margin:16px}table{width:100%;border-collapse:collapse;margin-top:8px}td,th{border:1px solid #777;padding:3px 5px;vertical-align:top;text-align:left}th{background:#134680;color:#fff;font-size:9px;text-transform:uppercase}.hdr td{text-align:center;vertical-align:middle}.ttl{font-weight:bold;font-size:12px}.c{text-align:center;width:30px;font-weight:bold}.no{color:#d51631}img{max-height:40px}.hdr img{max-height:50px}.dsig img{max-height:26px}';
  function pdfHtml(r) {
    const keep = { ...ui }; ui.__pdf = true; let inner = '';
    try { const box = document.createElement('div'); box.innerHTML = r.doc(); const d = box.querySelector('.doc'); inner = d ? d.innerHTML : ''; }
    finally { Object.keys(ui).forEach(k => delete ui[k]); Object.assign(ui, keep); }
    if (logoData) inner = inner.split('src="' + LOGO_H + '"').join('src="' + logoData + '"');
    return '<html><head><meta charset="utf-8"><style>' + PDF_CSS + '</style></head><body>' + inner + '</body></html>';
  }

  async function push() {
    const list = pending(); if (!list.length) return 0;
    let sent = 0;
    for (let i = 0; i < list.length; i += 4) {
      const batch = list.slice(i, i + 4);
      batch.forEach(r => { if (r.t !== 'conductor' && r.t !== 'firma') r.data.upd = new Date().toISOString(); });
      const body = { token: cfg.token, usuario: S.user ? S.user.nombre : '', equipo: cfg.equipo || '',
        records: batch.map(r => ({ key: r.key, t: r.t, id: r.id, data: r.data, nombre: r.nombre || '', html: r.doc ? pdfHtml(r) : '' })) };
      const res = await fetch(cfg.url, { method: 'POST', body: JSON.stringify(body) }).then(x => x.json());
      if (!res.ok) throw new Error(res.error || 'El servidor no aceptó los datos');
      batch.forEach(r => {
        const g = res.guardados[r.key];
        if (g) { if (g.numero) r.data.numero = g.numero; if (g.pdf) r.data.pdf = g.pdf; S.sh[r.key] = H(r.data); sent++; }
        else if (res.errores[r.key]) lastErr = r.key + ': ' + res.errores[r.key];
      });
      _save();
    }
    return sent;
  }

  const stripDrive = o => { Object.keys(o).forEach(k => { const v = o[k]; if (typeof v === 'string' && v.startsWith('drive:')) o[k] = ''; else if (v && typeof v === 'object') stripDrive(v); }); return o; };
  function mergeBy(list, items, key, t) {
    (items || []).forEach(d => {
      const loc = list.find(x => String(x[key]) === String(d[key]));
      if (!loc) list.push(d); else if ((d.upd || '') >= (loc.upd || '')) Object.assign(loc, d); else return;   // lo local es más reciente: se enviará
      S.sh[t + ':' + d[key]] = H(list.find(x => String(x[key]) === String(d[key])));
    });
  }
  async function pull(full) {
    if (!cfg.url || !cfg.token) return;
    const since = full ? '' : (S.lastPull || '');
    const res = await fetch(cfg.url + '?action=pull&token=' + encodeURIComponent(cfg.token) + '&since=' + encodeURIComponent(since)).then(x => x.json());
    if (!res.ok) throw new Error(res.error || 'No se pudo leer el servidor');
    S.usuarios = res.usuarios;
    mergeBy(S.equipos, res.equipo, 'code', 'equipo');
    mergeBy(S.vehiculos, res.vehiculo, 'placa', 'vehiculo');
    (res.conductor || []).forEach(d => { const c = S.conductores.find(x => x.cedula === d.cedula); if (c) Object.assign(c, d); else S.conductores.push(d); S.sh['conductor:' + d.cedula] = H({ cedula: d.cedula, nombre: d.nombre, cat: d.cat, licVence: d.licVence }); });
    (res.firma || []).forEach(d => { if (d.img) { regSet(d.cedula, d.img); S.sh['firma:' + d.cedula] = H({ cedula: d.cedula, img: d.img }); } });
    (res.insp || []).forEach(d => { if (!S.insps.find(x => x.id === d.id)) S.insps.push({ ...stripDrive(d), remoto: true }); });
    (res.preop || []).forEach(d => { if (!S.preops.find(x => x.id === d.id)) S.preops.push({ ...stripDrive(d), remoto: true }); });
    S.lastPull = res.ahora; _save();
  }

  async function sync(manual) {
    if (busy) return; if (!cfg.url || !cfg.token) { if (manual) toast('Primero configura la conexión'); return; }
    if (!navigator.onLine) { if (manual) toast('Sin señal: se enviará cuando vuelva el internet'); chip(); return; }
    busy = true; chip();
    try { const n = await push(); await pull(false); cfg.last = new Date().toISOString(); lastErr = lastErr && pending().length ? lastErr : ''; saveCfg(); if (manual || n) toast(n ? n + ' registro(s) enviados al servidor' : 'Todo está al día'); }
    catch (e) { lastErr = String(e.message || e); if (manual) toast('No se pudo sincronizar: ' + lastErr); }
    finally { busy = false; chip(); if (ui.view === 'conexion' || ui.view === 'login') _render(); }
  }

  /* guardar → programar envío; dibujar → actualizar indicador */
  const _save = window.save, _render = window.render;
  window.save = function () { _save(); clearTimeout(timer); timer = setTimeout(() => sync(false), 4000); };
  window.render = function () { _render(); chip(); };

  /* indicador en la barra superior */
  const net = document.getElementById('net');
  const btn = document.createElement('button'); btn.id = 'syncchip'; btn.className = 'net'; btn.style.border = '0'; btn.style.cursor = 'pointer';
  net.hidden = true; net.after(btn); btn.onclick = () => { ui.view = 'conexion'; render(); };
  function chip() {
    const n = pending().length, on = navigator.onLine;
    btn.classList.toggle('off', !on || n > 0 || !cfg.url);
    btn.innerHTML = '<i></i><span>' + (!cfg.url ? 'Sin conectar' : busy ? 'Enviando…' : !on ? (n ? n + ' por enviar · sin señal' : 'Sin señal') : n ? n + ' por enviar' : 'Al día') + '</span>';
  }

  /* pantalla de conexión */
  window.renderS = function (v, app, bar, bi) {
    if (v !== 'conexion') return;
    const n = pending().length;
    app.innerHTML = `<div class="stephead"><span class="eyebrow">Servidor de Google · SG-SST JMA</span><h1>Conexión y envío</h1></div>
    <div class="stack">
      <div class="kpis"><div class="kpi ${n ? 'k-warn' : 'k-ok'}"><b>${n}</b><span>Registros por enviar</span></div><div class="kpi k-az"><b>${(S.usuarios || []).length}</b><span>Usuarios cargados</span></div><div class="kpi k-az"><b>${cfg.last ? new Date(cfg.last).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—'}</b><span>Último envío</span></div></div>
      ${lastErr ? `<p class="no-msg">Último error: ${esc(lastErr)}</p>` : ''}
      <button class="btn primary block" id="cx-sync">Enviar y actualizar ahora</button>
      <div class="card"><h3>Datos de conexión</h3><p class="muted" style="margin:0;font-size:14px">Lo hace SST una sola vez por equipo. Lo más fácil es abrir el enlace de conexión de la hoja "Configuración".</p>
        <label class="f">URL del servidor<input class="in" id="cx-url" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <label class="f">Clave de conexión<input class="in" id="cx-tok" value="${esc(cfg.token || '')}"></label>
        <label class="f">Nombre de este equipo<input class="in" id="cx-eq" value="${esc(cfg.equipo || '')}" placeholder="Ej: Tablet obra Mirador"></label>
        <button class="btn" id="cx-save">Guardar y probar conexión</button></div>
    </div>`;
    bar.hidden = false; bi.innerHTML = `<button class="btn" data-act="${S.user ? 'home' : 'login-back'}">Volver</button>`;
    document.getElementById('cx-sync').onclick = () => sync(true);
    document.getElementById('cx-save').onclick = async () => {
      cfg.url = document.getElementById('cx-url').value.trim(); cfg.token = document.getElementById('cx-tok').value.trim(); cfg.equipo = document.getElementById('cx-eq').value.trim(); saveCfg();
      try { const r = await fetch(cfg.url + '?action=ping&token=' + encodeURIComponent(cfg.token)).then(x => x.json()); if (!r.ok) throw new Error(r.error); toast('Conexión correcta'); await pull(true); }
      catch (e) { toast('No se pudo conectar: ' + (e.message || e)); }
      _render();
    };
  };
  document.addEventListener('click', e => { if (e.target.closest('[data-act="login-back"]')) { ui.view = 'login'; render(); } });

  addEventListener('online', () => sync(false));
  addEventListener('offline', chip);
  setInterval(() => { if (pending().length) sync(false); }, 90000);
  window.sgsstPendientes = () => pending().map(r => r.key);
  readLink();
  chip();
  setTimeout(() => sync(false), 1500);
  if (!S.user) _render();
})();
