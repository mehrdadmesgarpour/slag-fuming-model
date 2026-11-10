(function () {
  'use strict';
  const E = FumeEngine;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  const DEFAULTS = {
    'slag.rateB': 50, 'slag.rateC': 25, 'slag.T': 1250, 'slag.cold': 0, 'slag.Zn': 12, 'slag.Pb': 1.5, 'slag.Fe': 28, 'slag.fe3': 10,
    'slag.SiO2': 26, 'slag.CaO': 14, 'slag.Al2O3': 5, 'slag.MgO': 2,
    'coal.rate': 3000, 'coal.moist': 2, 'coal.bypass': 0, 'coal.C': 75, 'coal.H': 4.5, 'coal.O': 7, 'coal.N': 1.5, 'coal.S': 0.8, 'coal.ash': 11.2, 'coal.hhv': 30.6,
    'al.rate': 300, 'al.metal': 95, 'blast.rate': 18000, 'blast.o2': 21, 'blast.T': 25, 'blast.pc': 0, 'blast.hte': 100,
    'op.T': 1250, 'op.loss': 6, 'op.P': 1, 'batch.time': 120, 'batch.dt': 2,
    'gam.ZnO': 2.0, 'gam.PbO': 0.3, 'gam.FeO': 1.0, 'gam.FeO15': 1.5
  };
  const state = { mode: 'batch', thermal: 'auto', hhvAuto: true, tab: 'heat' };
  // [key, label, unit, min, max, step, show]
  const F = (k, label, unit, min, max, step, show) => ({ k, label, unit, min, max, step: step || 'any', show });
  const GROUPS = [
    { id: 'slag', title: 'Slag', open: true, parts: [
      { fields: [F('slag.rateB', 'Charge', 't', 1, 500, 1, 'batch'), F('slag.rateC', 'Feed rate', 't/h', 1, 500, 1, 'cont'),
        F('slag.T', 'Temperature', '°C', 900, 1700, 10), F('slag.cold', 'Share charged cold', '%', 0, 80, 1)] },
      { sub: 'Assay, wt%', cls: 'three', fields: [F('slag.Zn', 'Zn', '', 0, 40), F('slag.Pb', 'Pb', '', 0, 20), F('slag.Fe', 'Fe total', '', 0, 60),
        F('slag.SiO2', 'SiO₂', '', 0, 60), F('slag.CaO', 'CaO', '', 0, 50), F('slag.Al2O3', 'Al₂O₃', '', 0, 40), F('slag.MgO', 'MgO', '', 0, 30), F('slag.fe3', 'Fe³⁺ / Fe, %', '', 0, 100)] },
      { note: 'note-slag' }] },
    { id: 'coal', title: 'Coal', open: true, parts: [
      { fields: [F('coal.rate', 'Rate', 'kg/h', 0, 50000, 50), F('coal.moist', 'Moisture', '%', 0, 40)] },
      { sub: 'Ultimate analysis, dry wt%', cls: 'three', fields: [F('coal.C', 'C', '', 0, 100), F('coal.H', 'H', '', 0, 20), F('coal.O', 'O', '', 0, 40), F('coal.N', 'N', '', 0, 10), F('coal.S', 'S', '', 0, 10), F('coal.ash', 'Ash', '', 0, 60)] },
      { check: 'hhvAuto', label: 'Estimate the heating value from the analysis' },
      { fields: [F('coal.hhv', 'HHV, dry', 'MJ/kg', 5, 45), F('coal.bypass', 'Leaves unreacted', '%', 0, 90)] },
      { note: 'note-coal' }] },
    { id: 'al', title: 'Aluminium', open: true, parts: [
      { fields: [F('al.rate', 'Rate', 'kg/h', 0, 20000, 50), F('al.metal', 'Metallic Al', '%', 0, 100)] },
      { note: 'note-al' }] },
    { id: 'blast', title: 'Blast', open: true, parts: [
      { fields: [F('blast.rate', 'Rate', 'Nm³/h', 0, 200000, 500), F('blast.o2', 'Oxygen', 'vol%', 0, 100), F('blast.T', 'Temperature', '°C', 0, 1200, 25)] },
      { note: 'note-blast' },
      { sub: 'Two-zone option', fields: [F('blast.pc', 'Burnt above the bath', '%', 0, 95), F('blast.hte', 'Heat returned to bath', '%', 0, 100)] }] },
    { id: 'op', title: 'Furnace', open: true, parts: [
      { fields: [F('op.T', 'Bath temperature', '°C', 900, 1800, 10, 'fixed'), F('op.loss', 'Heat loss', 'MW', 0, 100, 0.5), F('op.P', 'Pressure', 'atm', 0.2, 5, 0.1),
        F('batch.time', 'Cycle time', 'min', 4, 600, 10, 'batch'), F('batch.dt', 'Time step', 'min', 0.5, 30, 0.5, 'batch')] }] },
    { id: 'gam', title: 'Slag activity coefficients', open: false, parts: [
      { fields: [F('gam.ZnO', 'γ ZnO, solid', '', 0.05, 20), F('gam.PbO', 'γ PbO, liquid', '', 0.02, 20), F('gam.FeO', 'γ FeO, liquid', '', 0.05, 20), F('gam.FeO15', 'γ FeO₁.₅, hematite', '', 0.05, 20)] },
      { noteText: 'Single-cation mole fractions. The state after each oxide is its standard state.' }] }
  ];
  const PRESETS = [
    ['Coal only', { 'coal.rate': 3300, 'al.rate': 0, 'blast.rate': 20000, 'blast.o2': 21 }],
    ['Coal and aluminium', { 'coal.rate': 3000, 'al.rate': 300, 'blast.rate': 18000, 'blast.o2': 21 }],
    ['Aluminium, lean air', { 'coal.rate': 0, 'al.rate': 1800, 'blast.rate': 8000, 'blast.o2': 10 }]
  ];
  const fieldByKey = {}; GROUPS.forEach(g => g.parts.forEach(p => (p.fields || []).forEach(f => { fieldByKey[f.k] = f; })));
  const inId = k => 'in-' + k.replace(/\./g, '-');

  /* ---------- persistence (per-viewer convenience only) ---------- */
  const STORE = 'fuming-model-v2';
  function load() { try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); return s && typeof s === 'object' ? s : null; } catch (e) { return null; } }
  function save() {
    try {
      const vals = {}; for (const k in DEFAULTS) { const i = $(inId(k)); if (i) vals[k] = i.value; }
      localStorage.setItem(STORE, JSON.stringify({ vals, mode: state.mode, thermal: state.thermal, hhvAuto: state.hhvAuto, tab: state.tab }));
    } catch (e) { /* storage unavailable */ }
  }

  /* ---------- build inputs ---------- */
  function buildInputs(saved) {
    const host = $('inputs');
    const pr = el('div', 'presets'); pr.appendChild(el('span', null, 'Start from'));
    PRESETS.forEach((p, j) => { const b = el('button', 'chip', p[0]); b.type = 'button'; b.id = 'preset-' + j; b.addEventListener('click', () => { for (const k in p[1]) $(inId(k)).value = p[1][k]; compute(); }); pr.appendChild(b); });
    host.appendChild(pr);
    const wide = window.matchMedia('(min-width: 941px)').matches;
    GROUPS.forEach(g => {
      const d = el('details', 'group'); d.id = 'grp-' + g.id; if (g.open && (wide || g.id === 'slag')) d.open = true;
      d.appendChild(el('summary', null, g.title));
      const body = el('div', 'body');
      g.parts.forEach(p => {
        if (p.sub) body.appendChild(el('div', 'sub', p.sub));
        if (p.fields) {
          const grid = el('div', 'fields' + (p.cls ? ' ' + p.cls : ''));
          p.fields.forEach(f => {
            const w = el('div', 'field'); w.id = 'fld-' + f.k.replace(/\./g, '-'); if (f.show) w.dataset.show = f.show;
            const lab = el('label', null, f.label); lab.htmlFor = inId(f.k);
            const box = el('div', 'box'); const inp = el('input'); inp.type = 'number'; inp.id = inId(f.k); inp.step = f.step; inp.min = f.min; inp.max = f.max; inp.inputMode = 'decimal';
            inp.value = saved && saved.vals && saved.vals[f.k] != null && saved.vals[f.k] !== '' ? saved.vals[f.k] : DEFAULTS[f.k];
            inp.addEventListener('input', schedule);
            box.appendChild(inp); if (f.unit) box.appendChild(el('span', 'unit', f.unit));
            w.appendChild(lab); w.appendChild(box); grid.appendChild(w);
          });
          body.appendChild(grid);
        }
        if (p.check) {
          const lab = el('label', 'check'); const c = el('input'); c.type = 'checkbox'; c.id = 'chk-' + p.check; c.checked = state[p.check];
          c.addEventListener('change', () => { state[p.check] = c.checked; compute(); });
          lab.appendChild(c); lab.appendChild(el('span', null, p.label)); body.appendChild(lab);
        }
        if (p.note) { const n = el('p', 'note'); n.id = p.note; body.appendChild(n); }
        if (p.noteText) body.appendChild(el('p', 'note', p.noteText));
      });
      d.appendChild(body); host.appendChild(d);
    });
    const rs = el('button', 'linkbtn', 'Reset all inputs to the defaults'); rs.type = 'button'; rs.id = 'btn-reset';
    rs.addEventListener('click', () => { for (const k in DEFAULTS) $(inId(k)).value = DEFAULTS[k]; state.hhvAuto = true; $('chk-hhvAuto').checked = true; compute(); });
    host.appendChild(rs);
  }
  function val(k) {
    const i = $(inId(k)), f = fieldByKey[k]; let v = parseFloat(i.value);
    const bad = !isFinite(v) || v < f.min || v > f.max;
    i.setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (!isFinite(v)) v = DEFAULTS[k];
    return Math.min(Math.max(v, f.min), f.max);
  }
  function readInp() {
    const o = { mode: state.mode, thermal: state.thermal, slag: {}, coal: {}, al: {}, blast: {}, op: {}, gam: {}, batch: {} };
    for (const k in DEFAULTS) { const [a, b] = k.split('.'); o[a][b] = val(k); }
    o.slag.rate = state.mode === 'batch' ? o.slag.rateB : o.slag.rateC;
    o.coal.hhvAuto = state.hhvAuto;
    return o;
  }
  function syncVisibility() {
    document.querySelectorAll('[data-show]').forEach(n => { const s = n.dataset.show; n.hidden = !(s === state.mode || s === state.thermal); });
    $(inId('coal.hhv')).disabled = state.hhvAuto;
    const cyc = $('tabbtn-cycle'); cyc.disabled = state.mode !== 'batch';
    if (state.mode !== 'batch' && state.tab === 'cycle') setTab('heat');
  }

  /* ---------- formatting ---------- */
  const fx = (x, d) => {
    if (x == null || !isFinite(x)) return '–';
    if (Math.abs(x) < 0.5 * Math.pow(10, -d)) x = 0;
    let s = Math.abs(x).toFixed(d);
    if (Math.abs(x) >= 10000) { const p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f'); s = p.join('.'); }
    return (x < 0 ? '−' : '') + s;
  };
  const sig = (x, n) => { if (!isFinite(x)) return '–'; if (x === 0) return '0'; const d = Math.max(0, Math.min(6, n - 1 - Math.floor(Math.log10(Math.abs(x))))); return fx(x, d); };
  const lg = x => (x > 0 && isFinite(x)) ? fx(Math.log10(x), 2) : '–';
  const basisWord = r => r.mode === 'batch' ? 'cycle' : 'hour';

  /* ---------- status and KPIs ---------- */
  const ICON = { ok: 'M3 8.5l3.2 3.2L13 4.8', warn: 'M8 2.2l6.3 11H1.7zM8 6.6v3.2M8 11.6v.4', crit: 'M8 2.2l6.3 11H1.7zM8 6.6v3.2M8 11.6v.4' };
  function msg(level, text) {
    const m = el('div', 'msg ' + level); const s = sv('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' });
    s.appendChild(sv('path', { d: ICON[level], fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    m.appendChild(s); m.appendChild(el('span', null, text)); return m;
  }
  function renderStatus(r, inp) {
    const host = $('status'); host.textContent = ''; const out = [];
    const so = r.d.solids, tC = r.T - 273.15, per = r.mode === 'batch' ? '' : ' per hour';
    if (!r.converged) out.push(['crit', 'The equilibrium solver did not converge for this input. Treat the numbers below as unreliable.']);
    if (r.bound) out.push(['crit', 'The heat balance does not close between 800 and 2000 °C. The bath temperature shown is the ' + (r.bound < 0 ? 'lower' : 'upper') + ' limit of the model.']);
    else if (inp.thermal === 'auto' && tC < 1150) out.push(['warn', 'The bath ends at ' + fx(tC, 0) + ' °C. The slag may not be fully liquid. The model does not check the liquidus.']);
    else if (inp.thermal === 'auto' && tC > 1450) out.push(['warn', 'The bath ends at ' + fx(tC, 0) + ' °C, above the usual operating window. Less blast oxygen, less reductant or more cold charge would hold it down.']);
    if (r.eq.noGas) out.push(['warn', 'No gas phase forms. The equilibrium partial pressures add up to less than the total pressure, so nothing is fumed. A carrier gas is needed.']);
    if (so.Fe > 0.5) out.push(['warn', 'Metallic iron forms (' + fx(so.Fe, 0) + ' kg' + per + '). Reduction has passed iron saturation.']);
    if (so.Fe3O4 > 0.5) out.push(['warn', 'Solid magnetite forms (' + fx(so.Fe3O4, 0) + ' kg' + per + '). The bath is over-oxidised.']);
    if (so.C > 0.5) out.push(['warn', 'Unreacted carbon remains in the bath (' + fx(so.C, 0) + ' kg' + per + ').']);
    if (so.Si > 0.5 || so.Al > 0.5) out.push(['crit', 'The reductant exceeds what the iron, zinc and lead oxides can consume. Silicon or aluminium metal appears. This is outside the range the slag model is meant for.']);
    if (so.Pb > 0.5) out.push(['warn', 'Liquid lead forms (' + fx(so.Pb, 0) + ' kg' + per + ').']);
    r.warn.forEach(w => out.push(['warn', w]));
    if (!out.length) out.push(['ok', 'Converged. Mass and energy balances close.']);
    out.forEach(o => host.appendChild(msg(o[0], o[1])));
  }
  function kpi(label, value, unit, sub) {
    const k = el('div', 'kpi'); k.appendChild(el('div', 'k', label));
    const v = el('div', 'v', value); if (unit) v.appendChild(el('small', null, unit)); k.appendChild(v);
    k.appendChild(el('div', 's', sub || ' ')); return k;
  }
  function renderKpis(r, inp) {
    const host = $('kpis'); host.textContent = ''; const d = r.d, k = r.k, batch = r.mode === 'batch';
    host.appendChild(kpi('Zinc recovery to fume', fx(k.znRec, 1), '%', batch ? fx(k.znFumed / 1000, 2) + ' t Zn per cycle' : fx(k.znFumed, 0) + ' kg Zn per hour'));
    host.appendChild(kpi('Zinc in product slag', fx(d.el.Zn, 2), 'wt%', 'feed ' + fx(inp.slag.Zn, 1) + ' wt%, Pb recovery ' + fx(k.pbRec, 0) + ' %'));
    if (inp.thermal === 'auto') {
      let sub = 'heat-balanced';
      if (batch) { const ts = r.series.map(s => s.T - 273.15); sub = 'end of cycle, range ' + fx(Math.min.apply(null, ts), 0) + ' to ' + fx(Math.max.apply(null, ts), 0); }
      host.appendChild(kpi('Bath temperature', fx(r.T - 273.15, 0), '°C', sub));
    } else {
      const mw = r.surplus / 3.6e9 / r.basisH;
      host.appendChild(kpi(mw >= 0 ? 'Heat surplus' : 'Heat deficit', fx(Math.abs(mw), 2), 'MW', 'at a fixed ' + fx(inp.op.T, 0) + ' °C' + (batch ? ', cycle average' : '')));
    }
    host.appendChild(kpi('Oxygen potential', lg(d.pO2), 'log pO₂', 'CO/CO₂ ' + (isFinite(d.coco2) ? sig(d.coco2, 3) : '–') + (batch ? ', end of cycle' : '')));
    host.appendChild(kpi('Iron activity', fx(Math.min(d.aFe, 1), 2), '', d.solids.Fe > 0.5 ? 'metallic iron present' : 'metallic iron forms at 1'));
    host.appendChild(kpi('Direct CO₂', fx(k.co2PerT, 0), 'kg/t slag', isFinite(k.co2PerZn) && k.co2PerZn > 0 ? fx(k.co2PerZn, 2) + ' t per t Zn fumed' : 'all coal carbon as CO₂'));
  }

  /* ---------- heat and mass balance ---------- */
  function renderHeat(r, inp) {
    const toMW = 1 / (3.6e9 * r.basisH), toGJ = 1e-9, batch = r.mode === 'batch';
    $('heat-basis').textContent = batch ? 'Integrated over the ' + fx(inp.batch.time, 0) + ' min cycle. MW is the cycle average.' : 'Steady state.';
    const t = $('heat-table'); t.textContent = '';
    const max = Math.max.apply(null, r.items.map(i => Math.abs(i.val)));
    const src = r.items.filter(i => i.val > 1e-6 * max).sort((a, b) => b.val - a.val);
    const snk = r.items.filter(i => i.val < -1e-6 * max).sort((a, b) => a.val - b.val);
    const head = el('tr'); ['Item', '', 'MW', batch ? 'GJ per cycle' : 'GJ/h', 'Share'].forEach((h, j) => { const th = el('th', j >= 2 ? 'n' : null, h); head.appendChild(th); });
    const th = el('thead'); th.appendChild(head); t.appendChild(th);
    const tb = el('tbody'); t.appendChild(tb);
    const sum = a => a.reduce((s, i) => s + i.val, 0);
    const section = (title, list, cls) => {
      const g = el('tr', 'grp'); const gd = el('td', null, title); gd.colSpan = 5; g.appendChild(gd); tb.appendChild(g);
      const tot = Math.abs(sum(list));
      list.forEach(i => {
        const tr = el('tr', 'row'); tr.appendChild(el('td', null, i.label));
        const bc = el('td', 'barcell'); const b = el('div', 'bar ' + cls); b.style.width = (100 * Math.abs(i.val) / max).toFixed(2) + '%'; bc.appendChild(b); tr.appendChild(bc);
        tr.appendChild(el('td', 'n', fx(Math.abs(i.val) * toMW, 2))); tr.appendChild(el('td', 'n', fx(Math.abs(i.val) * toGJ, 1)));
        tr.appendChild(el('td', 'n', tot > 0 ? fx(100 * Math.abs(i.val) / tot, 1) + ' %' : '–')); tb.appendChild(tr);
      });
      const tr = el('tr', 'tot'); tr.appendChild(el('td', null, 'Total')); tr.appendChild(el('td'));
      tr.appendChild(el('td', 'n', fx(tot * toMW, 2))); tr.appendChild(el('td', 'n', fx(tot * toGJ, 1))); tr.appendChild(el('td', 'n', '')); tb.appendChild(tr);
    };
    section('Heat sources', src, 'src'); section('Heat sinks', snk, 'sink');
    const bal = el('tr', 'bal'); const net = r.surplus;
    bal.appendChild(el('td', null, inp.thermal === 'fixed' ? (net >= 0 ? 'Surplus at the set temperature' : 'Deficit at the set temperature') : 'Residual')); bal.appendChild(el('td'));
    bal.appendChild(el('td', 'n', fx(Math.abs(net) * toMW, 2))); bal.appendChild(el('td', 'n', fx(Math.abs(net) * toGJ, 1))); bal.appendChild(el('td', 'n', '')); tb.appendChild(bal);

    /* mass balance */
    const m = $('mass-table'); m.textContent = ''; const f = r.feeds, bh = batch ? r.basisH : 1;
    $('mass-basis').textContent = batch ? 'tonnes per cycle' : 'tonnes per hour';
    const ins = [['Molten slag', f.hot.mass], ['Cold charge', f.cld.mass], ['Coal reacting in the bath', f.coal.mass * bh], ['Aluminium', f.al.mass * bh], ['Blast', f.bl.mass * bh]];
    const bath = Float64Array.from(r.eq.n); E.SP.forEach((s, i) => { if (s.phase === 'gas') bath[i] = 0; });
    const outs = [['Product slag', E.massOf(bath, 'slag')], [r.fume.ZnO + r.fume.PbO > 0.5 ? 'Off-gas and fume' : 'Off-gas', E.massOf(r.gasOut)], ['Metal and solids', E.massOf(bath, 'pure')]];
    const mh = el('tr'); ['In', 't', 'Out', 't'].forEach((h, j) => mh.appendChild(el('th', j % 2 ? 'n' : null, h))); const mth = el('thead'); mth.appendChild(mh); m.appendChild(mth);
    const mb = el('tbody'); m.appendChild(mb); let si = 0, so = 0;
    for (let j = 0; j < Math.max(ins.length, outs.length); j++) {
      const tr = el('tr', 'row'); const a = ins[j], b = outs[j];
      tr.appendChild(el('td', null, a ? a[0] : '')); tr.appendChild(el('td', 'n', a ? fx(a[1] / 1000, 3) : '')); if (a) si += a[1];
      tr.appendChild(el('td', null, b ? b[0] : '')); tr.appendChild(el('td', 'n', b ? fx(b[1] / 1000, 3) : '')); if (b) so += b[1];
      mb.appendChild(tr);
    }
    const tr = el('tr', 'tot'); tr.appendChild(el('td', null, 'Total')); tr.appendChild(el('td', 'n', fx(si / 1000, 3))); tr.appendChild(el('td', null, 'Total')); tr.appendChild(el('td', 'n', fx(so / 1000, 3))); mb.appendChild(tr);
  }

  /* ---------- equilibrium tab ---------- */
  function fact(host, k, v) { const f = el('div', 'fact'); f.appendChild(el('span', 'k', k)); f.appendChild(el('span', 'v', v)); host.appendChild(f); }
  function simpleTable(id, head, rows, numCols) {
    const t = $(id); t.textContent = ''; const th = el('thead'), hr = el('tr');
    head.forEach((h, j) => hr.appendChild(el('th', numCols.indexOf(j) >= 0 ? 'n' : null, h))); th.appendChild(hr); t.appendChild(th);
    const tb = el('tbody'); rows.forEach(r => { const tr = el('tr', 'row' + (r.tot ? ' tot' : '')); r.c.forEach((c, j) => tr.appendChild(el('td', numCols.indexOf(j) >= 0 ? 'n' : null, c))); tb.appendChild(tr); }); t.appendChild(tb);
  }
  function renderEq(r, inp) {
    const d = r.d, batch = r.mode === 'batch', eq = r.eq, RT = E.R * eq.T;
    $('eq-basis').textContent = batch ? 'State of the bath and its gas in the last time step' : 'State of the stage';
    const fh = $('eq-facts'); fh.textContent = '';
    fact(fh, 'G at the minimum, GJ', fx(r.Gmin / 1e9, 2));
    fact(fh, 'Temperature, °C', fx(eq.T - 273.15, 1));
    fact(fh, 'log pO₂ (atm)', lg(d.pO2));
    fact(fh, 'CO/CO₂', isFinite(d.coco2) ? sig(d.coco2, 3) : '–');
    fact(fh, 'p Zn, atm', sig(d.pZn, 3));
    fact(fh, 'a ZnO, solid', sig(d.aZnO, 3));
    fact(fh, 'a FeO, liquid', sig(d.aFeO, 3));
    fact(fh, 'Fe³⁺ / Fe total, %', fx(100 * d.fe3, 1));
    fact(fh, 'Newton iterations', String(eq.iters));
    /* slag */
    const per = r.feeds.slagInfo.n, mk = id => per[E.SI[id]] * E.SP[E.SI[id]].M / 10;
    const feed = { ZnO: mk('ZnO'), PbO: mk('PbO'), FeO: mk('FeO'), Fe2O3: mk('FeO1.5'), SiO2: mk('SiO2'), CaO: mk('CaO'), Al2O3: mk('AlO1.5'), MgO: mk('MgO'), Other: mk('Other') };
    const names = { ZnO: 'ZnO', PbO: 'PbO', FeO: 'FeO', Fe2O3: 'Fe₂O₃', SiO2: 'SiO₂', CaO: 'CaO', Al2O3: 'Al₂O₃', MgO: 'MgO', Other: 'Other (inert)' };
    const rows = Object.keys(names).filter(k => feed[k] > 0.005 || d.wt[k] > 0.005).map(k => ({ c: [names[k], fx(feed[k], 2), fx(d.wt[k], 2)] }));
    rows.push({ c: ['Zn', fx(inp.slag.Zn, 2), fx(d.el.Zn, 2)], tot: true }, { c: ['Pb', fx(inp.slag.Pb, 2), fx(d.el.Pb, 3)] }, { c: ['Fe', fx(inp.slag.Fe, 2), fx(d.el.Fe, 2)] });
    rows.push({ c: [batch ? 'Mass, t' : 'Mass, t/h', fx(inp.slag.rate, 2), fx(d.slagMass / 1000, 2)] });
    simpleTable('slag-table', ['', 'Feed', 'Product'], rows, [1, 2]);
    /* gas */
    const two = !!r.offgas; $('gas-basis').textContent = batch ? 'vol%, average over the cycle' : 'vol%';
    const gnames = { 'N2': 'N₂', 'CO': 'CO', 'CO2': 'CO₂', 'H2': 'H₂', 'H2O': 'H₂O', 'Zn(g)': 'Zn', 'Pb(g)': 'Pb', 'PbO(g)': 'PbO', 'PbS(g)': 'PbS', 'SO2': 'SO₂', 'H2S': 'H₂S', 'COS': 'COS', 'S2': 'S₂', 'CH4': 'CH₄', 'O2': 'O₂' };
    const pc = x => x >= 0.0001 ? fx(100 * x, 2) : (x > 0 ? '< 0.01' : '0');
    const grows = Object.keys(gnames).filter(k => d.gas[k] > 5e-6 || (two && r.offgas.x[k] > 5e-6)).map(k => ({ c: two ? [gnames[k], pc(d.gas[k]), pc(r.offgas.x[k])] : [gnames[k], pc(d.gas[k])] }));
    const nm3 = mol => fx(mol / E.NM3, 0);
    grows.push({ c: two ? ['Volume, Nm³' + (batch ? '' : '/h'), nm3(d.gasMol), nm3(r.offgas.mol)] : ['Volume, Nm³' + (batch ? '' : '/h'), nm3(d.gasMol)], tot: true });
    if (r.fume.ZnO + r.fume.PbO > 0.5) grows.push({ c: two ? ['Oxide fume, kg', '', fx(r.fume.ZnO + r.fume.PbO, 0)] : ['Oxide fume, kg', '0'] });
    simpleTable('gas-table', two ? ['', 'Leaving the bath', 'After burning above the bath'] : ['', 'Leaving the bath'], grows, two ? [1, 2] : [1]);
    /* condensed */
    const sn = { Fe: 'Iron', Pb: 'Lead (liquid)', C: 'Graphite', Fe3O4: 'Magnetite', Al: 'Aluminium', Si: 'Silicon' };
    const srows = Object.keys(sn).map(k => { const a = eq.act[E.SI[k]]; return { c: [sn[k], fx(d.solids[k], 0), isFinite(a) ? (a < 1e-3 ? a.toExponential(1).replace('-', '−') : fx(Math.min(a, 1), 3)) : '–'] }; });
    simpleTable('solid-table', ['Phase', batch ? 'kg in bath' : 'kg/h', 'Activity'], srows, [1, 2]);
    /* reactions */
    $('rx-basis').textContent = 'Pure-species standard states at ' + fx(eq.T - 273.15, 0) + ' °C, per reaction as written';
    simpleTable('rx-table', ['Reaction', 'ΔH°, kJ', 'ΔG°, kJ', 'log K'], E.reactionTable(eq.T).map(x => ({ c: [x.eq.replace(/([A-Za-z)])(\d)/g, (m0, a1, d1) => a1 + '₀₁₂₃₄₅₆₇₈₉'[+d1]), fx(x.dH, 1), fx(x.dG, 1), fx(x.logK, 2)] })), [1, 2, 3]);
    simpleTable('pot-table', ['Element', 'μ/RT', 'μ, kJ/mol'], E.ELS.map((e, k) => ({ e, k })).filter(o => isFinite(eq.pi[o.k]) && o.e !== 'X').map(o => ({ c: [o.e, fx(eq.pi[o.k], 3), fx(eq.pi[o.k] * RT / 1000, 1)] })), [1, 2]);
  }

  /* ---------- line chart (single series, crosshair and tooltip) ---------- */
  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) { const p = Math.abs(lo) > 0 ? Math.abs(lo) * 0.05 : 1; lo -= p; hi += p; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), nrm = raw / mag;
    const step = (nrm < 1.5 ? 1 : nrm < 3 ? 2 : nrm < 7 ? 5 : 10) * mag;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, t = [];
    for (let v = a; v <= b + step * 1e-6; v += step) t.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { t, step, lo: a, hi: b };
  }
  const tickFmt = step => { const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9))); return v => fx(v, d); };
  const tip = $('tip');
  function showTip(ev, value, label) {
    tip.textContent = ''; tip.appendChild(el('b', null, value)); tip.appendChild(document.createTextNode(label)); tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight; let x = ev.clientX + 12, y = ev.clientY - h - 10;
    if (x + w > window.innerWidth - 6) x = ev.clientX - w - 12; if (y < 6) y = ev.clientY + 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function drawCharts(host, list) {
    host.textContent = '';
    const cards = list.map(c => {
      const card = el('div', 'chart'), hd = el('header'); hd.appendChild(el('span', 't', c.title));
      c.pts = c.x.map((x, i) => [x, c.y[i]]).filter(p => isFinite(p[0]) && isFinite(p[1]));
      const lastP = c.pts[c.pts.length - 1];
      hd.appendChild(el('span', 'e', lastP ? fx(lastP[1], c.digits) + (c.unit ? ' ' + c.unit : '') : 'no data')); card.appendChild(hd); host.appendChild(card);
      return card;
    });
    /* all cards are in the grid now, so each one has its final width */
    cards.forEach((card, j) => lineChart(card, list[j]));
  }
  function lineChart(card, c) {
    // c: {title, unit, x[], y[], xLabel, xUnit, digits, zero, pts}
    const pts = c.pts, lastP = pts[pts.length - 1];
    const W = Math.max(250, Math.round(card.clientWidth || 320)), H = 170, m = { l: 46, r: 12, t: 8, b: 34 };
    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': c.title + (c.unit ? ', ' + c.unit : '') + ' against ' + c.xLabel });
    card.appendChild(svg);
    if (pts.length < 2) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let ylo = Math.min.apply(null, ys), yhi = Math.max.apply(null, ys); if (c.zero) ylo = Math.min(ylo, 0);
    const yt = niceTicks(ylo, yhi, 4), xt = niceTicks(Math.min.apply(null, xs), Math.max.apply(null, xs), W < 340 ? 4 : 6);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const X = v => m.l + (W - m.l - m.r) * (v - x0) / (x1 - x0 || 1), Y = v => H - m.b - (H - m.t - m.b) * (v - yt.lo) / (yt.hi - yt.lo || 1);
    const yf = tickFmt(yt.step), xf = tickFmt(xt.step);
    yt.t.forEach(v => { svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === yt.lo ? 'base' : 'gridl' })); const tx = sv('text', { x: m.l - 6, y: Y(v) + 3.5, 'text-anchor': 'end', class: 'axis' }); tx.textContent = yf(v); svg.appendChild(tx); });
    xt.t.filter(v => v >= x0 - 1e-9 && v <= x1 + 1e-9).forEach(v => { const tx = sv('text', { x: X(v), y: H - m.b + 14, 'text-anchor': 'middle', class: 'axis' }); tx.textContent = xf(v); svg.appendChild(tx); });
    const xl = sv('text', { x: m.l + (W - m.l - m.r) / 2, y: H - 3, 'text-anchor': 'middle', class: 'xl' }); xl.textContent = c.xLabel + (c.xUnit ? ', ' + c.xUnit : ''); svg.appendChild(xl);
    svg.appendChild(sv('path', { class: 'ln', d: pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('') }));
    svg.appendChild(sv('circle', { class: 'dot', cx: X(lastP[0]), cy: Y(lastP[1]), r: 4 }));
    const cross = sv('line', { class: 'cross', y1: m.t, y2: H - m.b, visibility: 'hidden' }), hov = sv('circle', { class: 'dot', r: 4, visibility: 'hidden' });
    svg.appendChild(cross); svg.appendChild(hov);
    const hit = sv('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H - m.b, fill: 'transparent' }); svg.appendChild(hit);
    const move = ev => {
      const bb = svg.getBoundingClientRect(), px = (ev.clientX - bb.left) * W / bb.width; let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const dd = Math.abs(X(p[0]) - px); if (dd < bd) { bd = dd; best = i; } });
      const p = pts[best]; cross.setAttribute('x1', X(p[0])); cross.setAttribute('x2', X(p[0])); cross.setAttribute('visibility', 'visible');
      hov.setAttribute('cx', X(p[0])); hov.setAttribute('cy', Y(p[1])); hov.setAttribute('visibility', 'visible');
      showTip(ev, fx(p[1], c.digits) + (c.unit ? ' ' + c.unit : ''), c.xLabel + ' ' + String(+p[0].toPrecision(4)) + (c.xUnit ? ' ' + c.xUnit : ''));
    };
    const leave = () => { cross.setAttribute('visibility', 'hidden'); hov.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', leave);
  }

  /* ---------- cycle tab ---------- */
  let cycleCols = null;
  function renderCycle(r, inp) {
    const host = $('cycle-charts');
    if (r.mode !== 'batch') { host.textContent = ''; }
    if (r.mode !== 'batch') { $('cycle-basis').textContent = 'Available in batch mode.'; return; }
    const s = r.series, t = s.map(p => p.t);
    $('cycle-basis').textContent = r.steps + ' equilibrium steps of ' + sig(r.dtMin, 3) + ' min';
    const auto = inp.thermal === 'auto';
    cycleCols = [
      ['Time, min', t, 1], ['Zn in slag, wt%', s.map(p => p.Zn), 3], ['Zn recovery, %', s.map(p => p.rec), 2], ['Bath temperature, C', s.map(p => p.T - 273.15), 1],
      ['Heat surplus, MW', s.map(p => p.q), 3], ['Zn fuming rate, kg/min', s.map(p => p.rate), 2], ['log10 pO2 (atm)', s.map(p => p.pO2 > 0 ? Math.log10(p.pO2) : NaN), 3],
      ['CO/CO2', s.map(p => p.coco2), 3], ['Fe3+/Fe total, %', s.map(p => 100 * p.fe3), 2], ['Pb in slag, wt%', s.map(p => p.Pb), 4], ['Metallic iron, kg', s.map(p => p.feMet), 1], ['Slag mass, t', s.map(p => p.slagMass / 1000), 3]
    ];
    const C = (title, unit, y, digits, zero) => ({ title, unit, x: t, y, xLabel: 'Time', xUnit: 'min', digits, zero });
    drawCharts(host, [
      C('Zinc in slag', 'wt%', s.map(p => p.Zn), 2, true),
      C('Zinc fuming rate', 'kg/min', s.map(p => p.rate), 1, true),
      auto ? C('Bath temperature', '°C', s.map(p => p.T - 273.15), 0, false) : C('Heat surplus', 'MW', s.map(p => p.q), 2, true),
      C('Oxygen potential, log pO₂', '', s.map(p => p.pO2 > 0 ? Math.log10(p.pO2) : NaN), 2, false),
      C('Ferric share of iron', '%', s.map(p => 100 * p.fe3), 1, true),
      C('Lead in slag', 'wt%', s.map(p => p.Pb), 3, true)]);
    dataTable('cycle-table', cycleCols);
  }
  function dataTable(id, cols) {
    simpleTable(id, cols.map(c => c[0]), cols[0][1].map((_, i) => ({ c: cols.map(c => fx(c[1][i], c[2])) })), cols.map((_, j) => j));
  }
  function csv(cols) {
    const rows = [cols.map(c => '"' + c[0] + '"').join(',')];
    cols[0][1].forEach((_, i) => rows.push(cols.map(c => isFinite(c[1][i]) ? String(+c[1][i].toPrecision(7)) : '').join(',')));
    return rows.join('\n');
  }
  function copyText(text, msgId, boxId, done) {
    const m = $(msgId), box = $(boxId);
    const fallback = () => { box.textContent = ''; const ta = el('textarea', 'copybox'); ta.value = text; ta.readOnly = true; ta.setAttribute('aria-label', 'Text to copy'); box.appendChild(ta); ta.focus(); ta.select(); m.textContent = 'Copying was blocked here. The text is selected below. Copy it with your keyboard.'; };
    try { navigator.clipboard.writeText(text).then(() => { m.textContent = done; box.textContent = ''; }, fallback); } catch (e) { fallback(); }
  }
  function copyCsv(cols, msgId, boxId) {
    if (!cols) return; const text = csv(cols);
    copyText(text, msgId, boxId, 'Copied ' + (text.split('\n').length - 1) + ' rows.');
  }

  /* ---------- sweep ---------- */
  const SWEEPS = {
    al: { label: 'Aluminium rate', unit: 'kg/h', from: 0, to: 1200, set: (i, v, b, sub) => { i.al.rate = v; i.coal.rate = Math.max(0, b.coal.rate - sub * (v - b.al.rate)); } },
    coal: { label: 'Coal rate', unit: 'kg/h', from: 1500, to: 4500, set: (i, v) => { i.coal.rate = v; } },
    blast: { label: 'Blast rate', unit: 'Nm³/h', from: 12000, to: 24000, set: (i, v) => { i.blast.rate = v; } },
    o2: { label: 'Oxygen in blast', unit: 'vol%', from: 15, to: 35, set: (i, v) => { i.blast.o2 = v; } },
    loss: { label: 'Heat loss', unit: 'MW', from: 2, to: 10, set: (i, v) => { i.op.loss = v; } },
    cold: { label: 'Share charged cold', unit: '%', from: 0, to: 40, set: (i, v) => { i.slag.cold = v; } },
    T: { label: 'Bath temperature (fixed)', unit: '°C', from: 1150, to: 1400, set: (i, v) => { i.thermal = 'fixed'; i.op.T = v; } },
    gZnO: { label: 'γ ZnO', unit: '', from: 1, to: 5, set: (i, v) => { i.gam.ZnO = v; } },
    pc: { label: 'Blast burnt above the bath', unit: '%', from: 0, to: 40, set: (i, v) => { i.blast.pc = v; } }
  };
  let sweepCols = null, sweepRun = 0, sweepStale = true, sweepDraw = null;
  function setupSweep() {
    const sel = $('sw-var'); for (const k in SWEEPS) { const o = el('option', null, SWEEPS[k].label + (SWEEPS[k].unit ? ', ' + SWEEPS[k].unit : '')); o.value = k; sel.appendChild(o); }
    const apply = () => { const s = SWEEPS[sel.value]; $('sw-from').value = s.from; $('sw-to').value = s.to; $('sw-sub-wrap').hidden = sel.value !== 'al'; };
    sel.addEventListener('change', () => { apply(); runSweep(); }); apply();
    $('sw-run').addEventListener('click', runSweep);
    $('sweep-copy').addEventListener('click', () => copyCsv(sweepCols, 'sweep-copy-msg', 'sweep-copy-box'));
    $('cycle-copy').addEventListener('click', () => copyCsv(cycleCols, 'cycle-copy-msg', 'cycle-copy-box'));
    $('tex-copy').addEventListener('click', () => copyText(typeof FORMULA_TEX === 'string' ? FORMULA_TEX : '', 'tex-copy-msg', 'tex-copy-box', 'Copied. Each equation is in its own equation environment.'));
  }
  function runSweep() {
    const key = $('sw-var').value, S = SWEEPS[key], base = readInp();
    let a = parseFloat($('sw-from').value), b = parseFloat($('sw-to').value), n = Math.round(parseFloat($('sw-n').value));
    if (!isFinite(a)) a = S.from; if (!isFinite(b)) b = S.to; if (!isFinite(n)) n = 13; n = Math.min(41, Math.max(3, n));
    const sub = parseFloat($('sw-sub').value) || 0, my = ++sweepRun, btn = $('sw-run'), msgEl = $('sw-msg');
    const xs = [], res = []; btn.disabled = true; sweepStale = false;
    const fixed = key === 'T' || base.thermal === 'fixed';
    const step = j => {
      if (my !== sweepRun) return;
      if (j >= n) { btn.disabled = false; finish(); return; }
      const v = a + (b - a) * j / (n - 1), inp = JSON.parse(JSON.stringify(base)); S.set(inp, v, base, sub);
      let r = null; try { r = E.run(inp); } catch (e) { r = null; }
      xs.push(v); res.push(r); msgEl.textContent = 'Running point ' + (j + 1) + ' of ' + n + '.';
      setTimeout(() => step(j + 1), 0);
    };
    const finish = () => {
      const g = fn => res.map(r => r ? fn(r) : NaN);
      const bad = res.filter(r => !r || !r.converged || r.bound).length;
      msgEl.textContent = (base.mode === 'batch' ? 'Each point is a full batch cycle. ' : '') + (key === 'al' && sub ? 'Coal falls by ' + sig(sub, 3) + ' kg for each kg of aluminium added. ' : '') + (bad ? bad + ' point(s) did not converge or hit a temperature limit.' : '');
      const xl = S.label, xu = S.unit;
      const rec = g(r => r.k.znRec), zn = g(r => r.d.el.Zn), T = g(r => r.T - 273.15), q = g(r => r.surplus / 3.6e9 / r.basisH), aFe = g(r => Math.min(r.d.aFe, 1)),
        co2 = g(r => r.k.co2PerZn), po2 = g(r => r.d.pO2 > 0 ? Math.log10(r.d.pO2) : NaN), feM = g(r => r.d.solids.Fe), coal = g(r => r.feeds.coal.mass), alr = g(r => r.feeds.al.mass);
      sweepCols = [[xl + (xu ? ', ' + xu : ''), xs, 4], ['Coal, kg/h', coal, 1], ['Aluminium, kg/h', alr, 1], ['Zn recovery, %', rec, 2], ['Zn in product slag, wt%', zn, 3], ['Bath temperature, C', T, 1], ['Heat surplus, MW', q, 3],
        ['Iron activity', aFe, 3], ['Metallic iron, kg', feM, 1], ['CO2, t per t Zn fumed', co2, 3], ['log10 pO2 (atm)', po2, 3]];
      const C = (title, unit, y, digits, zero) => ({ title, unit, x: xs, y, xLabel: xl, xUnit: xu, digits, zero });
      sweepDraw = () => drawCharts($('sweep-charts'), [
        C('Zinc recovery to fume', '%', rec, 1, true), C('Zinc in product slag', 'wt%', zn, 2, true),
        fixed ? C('Heat surplus', 'MW', q, 2, true) : C('Bath temperature', '°C', T, 0, false),
        C('Iron activity', '', aFe, 2, true), C('Direct CO₂ per tonne of zinc fumed', 't/t', co2, 2, true), C('Oxygen potential, log pO₂', '', po2, 2, false)]);
      sweepDraw();
      dataTable('sweep-table', sweepCols);
    };
    step(0);
  }

  /* ---------- input notes ---------- */
  function renderNotes(r, inp) {
    const si = r.feeds.slagInfo;
    $('note-slag').textContent = 'Oxides sum to ' + fx(si.oxideSum, 1) + ' wt%.' + (si.other > 0.05 ? ' The remaining ' + fx(si.other, 1) + ' wt% is carried as inert oxide with the properties of silica.' : '');
    const ci = r.feeds.coal.info, u = ci.u;
    const o2coal = 10 * (u.C / E.AW.C + u.H / E.AW.H / 4 + u.S / E.AW.S - u.O / E.AW.O / 2) * (1 - inp.coal.moist / 100); // mol O2 per kg as fed
    $('note-coal').textContent = 'Heating value used: ' + fx(ci.hhv, 1) + ' MJ/kg dry (lower ' + fx(ci.lhv, 1) + '). Stoichiometric air ' + fx(o2coal / 0.21 / E.NM3, 2) + ' Nm³ per kg as fed.';
    $('note-al').textContent = 'Enters at 25 °C. The rest is carried as Al₂O₃. ' + fx(inp.al.rate * inp.al.metal / 100 / E.AW.Al * 1.5 * E.AW.Zn, 0) + ' kg/h Zn is the most this metal could reduce.';
    const need = o2coal * inp.coal.rate * (1 - inp.coal.bypass / 100) + 0.75 * inp.al.rate * 1000 * inp.al.metal / 100 / E.AW.Al;
    const have = inp.blast.rate * E.NM3 * inp.blast.o2 / 100;
    $('note-blast').textContent = need > 0 ? 'Blast oxygen is ' + fx(100 * have / need, 0) + ' % of what the coal and aluminium need for complete oxidation.' : 'No reductant is fed.';
  }

  /* ---------- orchestration ---------- */
  let last = null, timer = null;
  function compute() {
    syncVisibility();
    const inp = readInp(); let r;
    try { r = E.run(inp); } catch (e) { $('status').textContent = ''; $('status').appendChild(msg('crit', 'The model could not run with these inputs: ' + e.message)); return; }
    last = { r, inp }; sweepStale = true;
    renderStatus(r, inp); renderKpis(r, inp); renderNotes(r, inp); renderPanel(); save();
  }
  function renderPanel() {
    if (!last) return; const r = last.r, inp = last.inp;
    if (state.tab === 'heat') renderHeat(r, inp);
    else if (state.tab === 'eq') renderEq(r, inp);
    else if (state.tab === 'cycle') renderCycle(r, inp);
    else if (state.tab === 'sweep' && sweepStale) runSweep();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(compute, 180); }
  function setTab(t) {
    state.tab = t;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
    ['heat', 'eq', 'cycle', 'sweep', 'formulas', 'model'].forEach(k => { $('tab-' + k).hidden = k !== t; });
    renderPanel(); save();
  }
  function init() {
    const saved = load();
    if (saved) { if (saved.mode === 'cont' || saved.mode === 'batch') state.mode = saved.mode; if (saved.thermal === 'fixed' || saved.thermal === 'auto') state.thermal = saved.thermal; if (typeof saved.hhvAuto === 'boolean') state.hhvAuto = saved.hhvAuto; if (['heat', 'eq', 'cycle', 'sweep', 'formulas', 'model'].indexOf(saved.tab) >= 0) state.tab = saved.tab; }
    buildInputs(saved); setupSweep();
    $('mode-' + state.mode).checked = true; $('thermal-' + state.thermal).checked = true;
    document.querySelectorAll('input[name="mode"]').forEach(i => i.addEventListener('change', () => { state.mode = i.value; compute(); }));
    document.querySelectorAll('input[name="thermal"]').forEach(i => i.addEventListener('change', () => { state.thermal = i.value; compute(); }));
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { if (!b.disabled) setTab(b.dataset.tab); }));
    syncVisibility(); if (state.mode !== 'batch' && state.tab === 'cycle') state.tab = 'heat';
    compute(); setTab(state.tab);
    let rz = null; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (state.tab === 'cycle') renderPanel(); else if (state.tab === 'sweep' && sweepDraw) sweepDraw(); }, 250); });
  }
  init();
})();
