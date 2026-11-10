/* Readers for external thermodynamic data.
   Every reader returns { species: [...], gamma: {...} | null, warnings: [...] } where each species is
   { name, comp, phase ('gas' | 'cond' | null), record, Tmin, Tmax, src, notes } and record is a standard-state
   record that FumeEngine.evalRecord can evaluate (models nasa7, nasa9, shomate, gpoly, table, mk).
   Conventions of the model: J/mol, enthalpy relative to the elements in their stable states at 298.15 K and 1 bar
   (the SER convention of Calphad and the NASA/JANAF formation-enthalpy convention), absolute entropy, standard pressure 1 bar. */
var FumeDB = (function () {
  'use strict';
  const R = 8.314462618, ATM = 101325;
  const ELEMENTS = ['C', 'H', 'O', 'N', 'S', 'Zn', 'Pb', 'Fe', 'Si', 'Ca', 'Al', 'Mg', 'Cu', 'Cd', 'Na', 'K', 'Ti', 'Mn', 'Cr', 'Ni', 'Co', 'Sn', 'As', 'Sb', 'Bi', 'Ar', 'He', 'Cl', 'F', 'P', 'B', 'Ba', 'Sr', 'Li', 'Mo', 'V', 'W', 'Ag', 'Au', 'In', 'Ge', 'Se', 'Te', 'Zr', 'E'];
  const ELU = {}; ELEMENTS.forEach(e => { ELU[e.toUpperCase()] = e; });
  const normEl = e => ELU[String(e).toUpperCase()] || (e.charAt(0).toUpperCase() + e.slice(1).toLowerCase());

  /* ---------- names and formulas ---------- */
  /* "Fe2O3(s)" -> {Fe:2, O:3}; "AlO1.5" -> {Al:1, O:1.5}; phase tags in brackets are ignored */
  function parseFormula(name) {
    const f = String(name).replace(/\(.*$/, '').replace(/\[.*$/, '').trim();
    const re = /([A-Z][a-z]?)(\d*\.?\d*)/g; const c = {}; let m, used = 0;
    while ((m = re.exec(f)) !== null) { if (!m[0]) break; c[m[1]] = (c[m[1]] || 0) + (m[2] ? parseFloat(m[2]) : 1); used += m[0].length; }
    return used === f.length && used > 0 ? c : null;
  }
  function sameComp(a, b) {
    if (!a || !b) return false;
    const ka = Object.keys(a).filter(k => Math.abs(a[k]) > 1e-12), kb = Object.keys(b).filter(k => Math.abs(b[k]) > 1e-12);
    if (ka.length !== kb.length) return false;
    return ka.every(k => b[k] !== undefined && Math.abs(a[k] - b[k]) < 1e-6 * Math.max(1, Math.abs(a[k])));
  }
  /* phase tag of a name: 'l' liquid, 's' solid, 'g' gas, '' none */
  function phaseTag(name) {
    const m = /\(([^)]*)\)\s*$/.exec(String(name)); const t = m ? m[1].toLowerCase() : '';
    if (/^(l|liq|liquid)$/.test(t)) return 'l';
    if (/^(g|gas)$/.test(t)) return 'g';
    if (/^(s|cr|c|a|b|d|solid|s,l|cr,l|rd|yw|lqz|hqz|gr)$/.test(t) || /^(cr|s)\d*$/.test(t)) return 's';
    return '';
  }
  const fnum = s => parseFloat(String(s).trim().replace(/[dD]/, 'E'));
  const rangeOf = segs => [segs[0][0], segs[segs.length - 1][1]];

  /* ---------- 1. JSON (this model's own exchange format, also used by the local server) ---------- */
  function recordFromJSON(o, prefDefault) {
    const r = recordModel(o, prefDefault);
    if (o.dH || o.dS) { r.dH = o.dH || 0; r.dS = o.dS || 0; } // constant offsets of h (J/mol) and s (J/(mol K)), e.g. the FeO correction
    return r;
  }
  function recordModel(o, prefDefault) {
    const pref = o['reference-pressure-Pa'] || o.pref || prefDefault;
    switch (o.model) {
      case 'nasa7': case 'nasa9': case 'shomate': case 'gpoly': return { model: o.model, segs: o.segs, pref };
      case 'table': return { model: 'table', T: o.T, h: o.h, s: o.s, cp: o.cp, pref };
      case 'mk': return { mk: o.mk || [o.a, o.b, o.c], H298: o.H298, S298: o.S298, pref };
      default: throw new Error('unknown model "' + o.model + '" for ' + o.name);
    }
  }
  function parseJSON(text, opts) {
    const d = JSON.parse(text), out = { species: [], gamma: null, warnings: [] };
    const pref = d['reference-pressure-Pa'] || opts.pref;
    (d.species || []).forEach(o => {
      const rec = recordFromJSON(o, pref);
      const comp = o.composition || parseFormula(o.name);
      const T = rec.model === 'table' ? rec.T : null;
      const rng = rec.segs ? rangeOf(rec.segs) : T ? [T[0], T[T.length - 1]] : [298.15, 6000];
      out.species.push({ name: o.name, comp, phase: o.phase || null, record: rec, Tmin: rng[0], Tmax: rng[1], src: o.source || d.source || 'JSON', notes: o.note || '' });
    });
    if (d.activity) out.gamma = d.activity;
    return out;
  }

  /* ---------- 2. NASA 7-coefficient polynomials in Chemkin THERMO format ---------- */
  function parseNASA7(text, opts) {
    const lines = text.split(/\r?\n/), out = { species: [], gamma: null, warnings: [] };
    let i = 0, defaults = [300, 1000, 5000];
    for (; i < lines.length; i++) {
      const L = lines[i];
      if (/^\s*THERMO/i.test(L)) { const nx = lines[i + 1] || ''; const v = nx.trim().split(/\s+/).map(Number); if (v.length >= 3 && v.every(isFinite)) { defaults = v.slice(0, 3); i++; } continue; }
      if (/^\s*(!|$)/.test(L) || /^\s*END/i.test(L)) continue;
      if (L.length >= 80 && L.charAt(79) === '1' && i + 3 < lines.length && (lines[i + 1].charAt(79) === '2')) {
        const name = L.slice(0, 18).trim().split(/\s+/)[0];
        const comp = {};
        for (let k = 0; k < 4; k++) { const el = L.slice(24 + 5 * k, 26 + 5 * k).trim(), n = L.slice(26 + 5 * k, 29 + 5 * k).trim(); if (el && n && el !== '0' && parseFloat(n) !== 0) comp[normEl(el)] = (comp[normEl(el)] || 0) + parseFloat(n); }
        const ext = L.length > 80 ? L.slice(80).trim() : ''; // optional fifth element in columns 74-78 (some files)
        const ph = L.charAt(44).toUpperCase();
        const Tl = fnum(L.slice(45, 55)) || defaults[0], Th = fnum(L.slice(55, 65)) || defaults[2], Tc = fnum(L.slice(65, 73)) || defaults[1];
        const nums = [];
        for (let k = 1; k <= 3; k++) { const LL = lines[i + k]; for (let j = 0; j < 5; j++) { const v = LL.slice(15 * j, 15 * j + 15); if (v.trim()) nums.push(fnum(v)); } }
        if (nums.length < 14 || nums.some(x => !isFinite(x))) { out.warnings.push('Skipped ' + name + ': could not read 14 coefficients.'); i += 3; continue; }
        const hi = nums.slice(0, 7), lo = nums.slice(7, 14);
        out.species.push({ name, comp, phase: ph === 'G' ? 'gas' : (ph === 'S' || ph === 'L' || ph === 'C') ? 'cond' : null,
          record: { model: 'nasa7', segs: [[Tl, Tc].concat(lo), [Tc, Th].concat(hi)], pref: opts.pref },
          Tmin: Tl, Tmax: Th, src: 'NASA-7', notes: ext });
        i += 3;
      }
    }
    if (!out.species.length) out.warnings.push('No NASA-7 entries found. Each entry has four 80-column lines numbered 1 to 4 in column 80.');
    return out;
  }

  /* ---------- 3. NASA 9-coefficient polynomials in the format of the CEA thermo.inp file ---------- */
  function parseNASA9(text, opts) {
    const L = text.split(/\r?\n/), out = { species: [], gamma: null, warnings: [] };
    let i = 0;
    while (i < L.length) {
      const a = L[i];
      if (!a.trim() || /^\s*(!|#)/.test(a) || /^\s*thermo\b/i.test(a) || /^\s*END/i.test(a) || /^\s*[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s*/.test(a) && !/[A-Za-z]/.test(a.slice(0, 15))) { i++; continue; }
      const b = L[i + 1] || '';
      const nInt = parseInt(b.slice(0, 2), 10);
      if (!isFinite(nInt) || b.length < 52) { i++; continue; }
      const name = a.slice(0, 24).trim().split(/\s+/)[0];
      const comp = {};
      for (let k = 0; k < 5; k++) { const el = b.slice(10 + 8 * k, 12 + 8 * k).trim(), n = b.slice(12 + 8 * k, 18 + 8 * k).trim(); if (el && n && parseFloat(n) !== 0 && el !== 'E') comp[normEl(el)] = (comp[normEl(el)] || 0) + parseFloat(n); else if (el === 'E' && parseFloat(n)) comp.E = parseFloat(n); }
      const phaseFlag = parseInt(b.slice(50, 52), 10) || 0;
      if (nInt === 0) { out.warnings.push('Skipped ' + name + ': no temperature intervals (single-temperature entry).'); i += 3; continue; }
      const segs = []; let j = i + 2, ok = true;
      for (let k = 0; k < nInt; k++) {
        const t = L[j], c1 = L[j + 1] || '', c2 = L[j + 2] || '';
        const Tlo = fnum(t.slice(0, 11)), Thi = fnum(t.slice(11, 22));
        const exps = t.slice(23, 63).trim().split(/\s+/).map(Number);
        if (exps.length < 7 || exps.slice(0, 7).join(',') !== '-2,-1,0,1,2,3,4') { ok = false; out.warnings.push('Skipped ' + name + ': only the standard exponents -2 to 4 are supported.'); }
        const a1 = [0, 1, 2, 3, 4].map(q => fnum(c1.slice(16 * q, 16 * q + 16)));
        const a2 = [0, 1].map(q => fnum(c2.slice(16 * q, 16 * q + 16)));
        const b12 = [3, 4].map(q => fnum(c2.slice(16 * q, 16 * q + 16)));
        const seg = [Tlo, Thi].concat(a1, a2, b12);
        if (seg.some(x => !isFinite(x))) { ok = false; out.warnings.push('Skipped ' + name + ': unreadable coefficients.'); }
        segs.push(seg); j += 3;
      }
      if (ok) out.species.push({ name, comp, phase: phaseFlag === 0 ? 'gas' : 'cond', record: { model: 'nasa9', segs, pref: opts.pref }, Tmin: segs[0][0], Tmax: segs[segs.length - 1][1], src: 'NASA-9', notes: (a.slice(18).trim()) });
      i = j;
    }
    if (!out.species.length) out.warnings.push('No NASA-9 entries found.');
    return out;
  }

  /* ---------- 4. Cantera YAML (species with NASA7, NASA9, Shomate or constant-cp thermo) ---------- */
  const UNIT = { 'J/mol': 1, 'kJ/mol': 1000, 'cal/mol': 4.184, 'kcal/mol': 4184, 'J/kmol': 1e-3, 'kJ/kmol': 1, 'cal/kmol': 4.184e-3, 'kcal/kmol': 4.184 };
  function qty(v, kind) { // kind 'e' energy per mol, 's' entropy per mol K, 'T', 'P'
    if (typeof v === 'number') return v;
    const m = /^\s*([-+0-9.eE]+)\s*(.*)$/.exec(String(v)); if (!m) return NaN;
    const x = parseFloat(m[1]), u = m[2].trim();
    if (kind === 'T') return u === 'K' || !u ? x : NaN;
    if (kind === 'P') return u === 'bar' ? x * 1e5 : u === 'atm' ? x * ATM : u === 'Pa' || !u ? x : u === 'kPa' ? x * 1e3 : u === 'MPa' ? x * 1e6 : NaN;
    const base = u.replace(/\/K$/, '').replace(/\/K\//, '/');
    if (UNIT[base] === undefined) return NaN;
    return x * UNIT[base];
  }
  function parseYAML(text, opts) {
    const out = { species: [], gamma: null, warnings: [] };
    if (typeof jsyaml === 'undefined') { out.warnings.push('The YAML reader (js-yaml) is not loaded, so YAML files cannot be read here.'); return out; }
    const d = jsyaml.load(text);
    const units = d.units || {};
    const eU = units.energy === 'cal' ? 4.184 : units.energy === 'kcal' ? 4184 : units.energy === 'kJ' ? 1000 : 1;
    const qU = (units.quantity || 'kmol') === 'kmol' ? 1e-3 : 1; // Cantera's default quantity is kmol
    (d.species || []).forEach(sp => {
      const t = sp.thermo || {}, name = String(sp.name), comp = {};
      for (const e in (sp.composition || {})) comp[normEl(e)] = sp.composition[e];
      let pref = t['reference-pressure'] !== undefined ? qty(t['reference-pressure'], 'P') : opts.pref;
      if (t['reference-pressure'] === undefined) out.noPref = true;
      const tr = (t['temperature-ranges'] || []).map(x => qty(x, 'T'));
      let rec = null;
      if (t.model === 'NASA7') rec = { model: 'nasa7', segs: t.data.map((c, k) => [tr[k], tr[k + 1]].concat(c.slice(0, 7))), pref };
      else if (t.model === 'NASA9') rec = { model: 'nasa9', segs: t.data.map((c, k) => [tr[k], tr[k + 1]].concat(c.slice(0, 9))), pref };
      else if (t.model === 'Shomate') rec = { model: 'shomate', segs: t.data.map((c, k) => [tr[k], tr[k + 1]].concat(c.slice(0, 7))), pref };
      else if (t.model === 'constant-cp') {
        /* G = h0 + cp0 (T - T0) - T [s0 + cp0 ln(T/T0)] = (h0 - cp0 T0) + T (cp0 - s0 + cp0 ln T0) - cp0 T ln T */
        const num = (v, kind) => typeof v === 'number' ? v * eU * qU : qty(v, kind);
        const T0 = qty(t.T0 || 298.15, 'T'), h0 = num(t.h0 || 0, 'e'), s0 = num(t.s0 || 0, 's'), cp0 = num(t.cp0 || 0, 's');
        rec = { model: 'gpoly', segs: [[t['T-min'] ? qty(t['T-min'], 'T') : 200, t['T-max'] ? qty(t['T-max'], 'T') : 6000,
          [[h0 - cp0 * T0, 0, 0], [cp0 - s0 + cp0 * Math.log(T0), 1, 0], [-cp0, 1, 1]]]], pref };
      } else { out.warnings.push('Skipped ' + name + ': thermo model "' + t.model + '" is not supported.'); return; }
      const rng = rec.segs ? rangeOf(rec.segs) : [200, 6000];
      out.species.push({ name, comp, phase: null, record: rec, Tmin: rng[0], Tmax: rng[1], src: 'Cantera YAML', notes: t.note || '' });
    });
    /* phase membership tells gas from condensed */
    (d.phases || []).forEach(ph => {
      const gas = /ideal-gas/.test(ph.thermo || '');
      let names = [];
      (ph.species || []).forEach(x => { if (typeof x === 'string') names.push(x); else if (x && typeof x === 'object') for (const k in x) if (Array.isArray(x[k])) names = names.concat(x[k]); });
      out.species.forEach(s => { if (names.indexOf(s.name) >= 0 && !s.phase) s.phase = gas ? 'gas' : 'cond'; });
    });
    if (out.noPref) out.warnings.push('The file does not state a reference pressure. Cantera itself would assume 1 atm; the setting on this page was used instead.');
    return out;
  }

  /* ---------- 5. Calphad TDB: FUNCTION and PARAMETER G of stoichiometric phases and end members ---------- */
  /* Gibbs energies are kept as piecewise sums of c T^n (ln T)^m, so that h, s and cp follow exactly. */
  const P0 = { '0,0': 0 };
  const poly = (o) => o; // map "n,m" -> coefficient
  function pAdd(a, b, k) { const o = Object.assign({}, a); for (const key in b) o[key] = (o[key] || 0) + (k === undefined ? 1 : k) * b[key]; return o; }
  function pMul(a, b) { const o = {}; for (const x in a) for (const y in b) { const [n1, m1] = x.split(',').map(Number), [n2, m2] = y.split(',').map(Number); const key = (n1 + n2) + ',' + (m1 + m2); o[key] = (o[key] || 0) + a[x] * b[y]; } return o; }
  const pConst = c => ({ '0,0': c });
  const pIsConst = a => Object.keys(a).every(k => k === '0,0' || a[k] === 0);
  /* piecewise: [{lo, hi, p}] on contiguous intervals */
  function pwMerge(A, B, op) {
    const cuts = Array.from(new Set(A.concat(B).reduce((s, x) => s.concat([x.lo, x.hi]), []))).sort((x, y) => x - y);
    const lo = Math.max(A[0].lo, B[0].lo), hi = Math.min(A[A.length - 1].hi, B[B.length - 1].hi), out = [];
    const at = (P, T) => { for (const x of P) if (T >= x.lo - 1e-9 && T <= x.hi + 1e-9) return x.p; return null; };
    for (let k = 0; k < cuts.length - 1; k++) { const a = cuts[k], b = cuts[k + 1]; if (b <= lo || a >= hi) continue; const mid = 0.5 * (a + b); const pa = at(A, mid), pb = at(B, mid); if (pa && pb) out.push({ lo: a, hi: b, p: op(pa, pb) }); }
    return out;
  }
  const pwConst = (c) => [{ lo: 0, hi: 1e6, p: pConst(c) }];
  function tdbTokens(s) {
    const t = []; const re = /\s*([0-9]*\.?[0-9]+(?:[eE][-+]?\d+)?|[A-Za-z_][A-Za-z0-9_]*#?|\*\*|[-+*/()^,])/y; let m, pos = 0;
    s = s.replace(/\s+/g, ' ');
    while (pos < s.length) { re.lastIndex = pos; m = re.exec(s); if (!m) { if (s.slice(pos).trim() === '') break; throw new Error('cannot read "' + s.slice(pos, pos + 20) + '"'); } t.push(m[1]); pos = re.lastIndex; }
    return t;
  }
  function tdbExpr(src, funcs) {
    const tk = tdbTokens(src); let k = 0;
    const peek = () => tk[k], next = () => tk[k++];
    function primary() {
      const t = next();
      if (t === undefined) throw new Error('unexpected end of expression');
      if (t === '(') { const v = sum(); if (next() !== ')') throw new Error('missing )'); return v; }
      if (t === '-') return mulC(primary(), -1);
      if (t === '+') return primary();
      if (/^[0-9.]/.test(t)) return pwConst(parseFloat(t));
      const u = t.toUpperCase().replace(/#$/, '');
      if (u === 'T') return [{ lo: 0, hi: 1e6, p: { '1,0': 1 } }];
      if (u === 'P') return pwConst(1e5); // standard pressure; gas parameters carry R T ln(1E-05 P) = 0 at 1 bar
      if (u === 'R') return pwConst(R);
      if (u === 'LN' || u === 'LOG' || u === 'EXP') {
        if (next() !== '(') throw new Error(u + ' without (');
        const a = sum(); if (next() !== ')') throw new Error('missing )');
        if (a.length === 1 && pIsConst(a[0].p)) { const c = a[0].p['0,0'] || 0; return pwConst(u === 'EXP' ? Math.exp(c) : Math.log(c)); }
        if (u !== 'EXP' && a.length === 1) { const keys = Object.keys(a[0].p).filter(x => a[0].p[x] !== 0); if (keys.length === 1 && keys[0] === '1,0') return [{ lo: 0, hi: 1e6, p: { '0,0': Math.log(a[0].p['1,0']), '0,1': 1 } }]; }
        throw new Error(u + ' of a temperature-dependent expression is not supported');
      }
      if (funcs[u]) return funcs[u]();
      throw new Error('unknown name ' + t);
    }
    function power() {
      let b = primary();
      while (peek() === '**' || peek() === '^') {
        next(); let sign = 1; if (peek() === '-') { next(); sign = -1; } else if (peek() === '+') next();
        const e = next(); let ex;
        if (e === '(') { let s2 = 1; if (peek() === '-') { next(); s2 = -1; } ex = s2 * parseFloat(next()); if (next() !== ')') throw new Error('missing )'); } else ex = parseFloat(e);
        ex *= sign;
        if (!Number.isInteger(ex)) throw new Error('non-integer power');
        if (b.length === 1 && Object.keys(b[0].p).filter(x => b[0].p[x] !== 0).length === 1) { const key = Object.keys(b[0].p).find(x => b[0].p[x] !== 0); const [n, m] = key.split(',').map(Number); b = [{ lo: b[0].lo, hi: b[0].hi, p: { [(n * ex) + ',' + (m * ex)]: Math.pow(b[0].p[key], ex) } }]; if (m && ex < 0) throw new Error('negative power of ln T'); }
        else if (ex >= 0) { let r = pwConst(1); for (let q = 0; q < ex; q++) r = pwMerge(r, b, pMul); b = r; }
        else throw new Error('negative power of a sum');
      }
      return b;
    }
    const mulC = (a, c) => a.map(x => ({ lo: x.lo, hi: x.hi, p: pAdd({}, x.p, c) }));
    function product() {
      let a = power();
      while (peek() === '*' || peek() === '/') {
        const op = next(), b = power();
        if (op === '*') a = pwMerge(a, b, pMul);
        else {
          const ok = b.every(x => Object.keys(x.p).filter(y => x.p[y] !== 0).length === 1 && Object.keys(x.p).find(y => x.p[y] !== 0).split(',')[1] === '0');
          if (!ok) throw new Error('division by a sum or by ln T');
          a = pwMerge(a, b, (pa, pb) => { const key = Object.keys(pb).find(y => pb[y] !== 0); const n = Number(key.split(',')[0]); return pMul(pa, { [(-n) + ',0']: 1 / pb[key] }); });
        }
      }
      return a;
    }
    function sum() {
      let a;
      if (peek() === '-') { next(); a = mulC(product(), -1); } else { if (peek() === '+') next(); a = product(); }
      while (peek() === '+' || peek() === '-') { const op = next(); const b = product(); a = pwMerge(a, b, (x, y) => pAdd(x, y, op === '-' ? -1 : 1)); }
      return a;
    }
    const v = sum(); if (k < tk.length) throw new Error('unexpected "' + tk[k] + '"'); return v;
  }
  /* "298.15 expr1; 700 Y expr2; 3000 N REF !" -> piecewise */
  function tdbRanges(body, funcs) {
    const parts = body.trim(); const m = /^([0-9.Ee+-]+)\s+([\s\S]*)$/.exec(parts); if (!m) throw new Error('no lower temperature');
    let lo = fnum(m[1]); let rest = m[2]; const out = [];
    while (true) {
      const sc = rest.indexOf(';'); if (sc < 0) throw new Error('missing ;');
      const expr = rest.slice(0, sc); rest = rest.slice(sc + 1).trim();
      const mm = /^([0-9.Ee+-]+)\s+([YN])\b\s*([\s\S]*)$/i.exec(rest); if (!mm) throw new Error('missing upper temperature and Y or N');
      const hi = fnum(mm[1]); const pw = tdbExpr(expr, funcs);
      pw.forEach(x => { const a = Math.max(lo, x.lo), b = Math.min(hi, x.hi); if (b > a) out.push({ lo: a, hi: b, p: x.p }); });
      lo = hi; rest = mm[3];
      if (mm[2].toUpperCase() === 'N') break;
    }
    return out;
  }
  function parseTDB(text, opts) {
    const out = { species: [], gamma: null, warnings: [] };
    const clean = text.split(/\r?\n/).map(l => l.replace(/\$.*$/, '')).join(' ');
    const stm = clean.split('!').map(s => s.trim()).filter(Boolean);
    const funcSrc = {}, funcs = {}, phases = {}, spc = {}, params = [];
    stm.forEach(s => {
      const w = s.split(/\s+/), kw = w[0].toUpperCase();
      if (/^FUNC/.test(kw)) funcSrc[w[1].toUpperCase().replace(/#$/, '')] = s.slice(s.indexOf(w[1]) + w[1].length);
      else if (/^PARA/.test(kw)) params.push(s.slice(w[0].length).trim());
      else if (/^PHAS/.test(kw)) phases[w[1].toUpperCase().split(':')[0]] = { sites: w.slice(4, 4 + parseInt(w[3], 10)).map(Number), type: w[2] };
      else if (/^SPEC/.test(kw)) spc[w[1].toUpperCase()] = w[2];
    });
    const cache = {};
    for (const name in funcSrc) {
      funcs[name] = () => {
        if (cache[name] === 'busy') throw new Error('circular function ' + name);
        if (!cache[name]) { cache[name] = 'busy'; cache[name] = tdbRanges(funcSrc[name], funcs); }
        return cache[name];
      };
    }
    const spComp = name => {
      const u = name.toUpperCase(); if (u === 'VA' || u === '/-') return {};
      if (spc[u]) { const f = spc[u].replace(/\/.*$/, ''); const c = {}; const re = /([A-Z][A-Z]?)([0-9.]*)/g; let m; while ((m = re.exec(f.toUpperCase())) !== null) { if (!m[0]) break; c[normEl(m[1])] = (c[normEl(m[1])] || 0) + (m[2] ? parseFloat(m[2]) : 1); } return c; }
      const base = u.replace(/[+-]\d*$/, ''); if (ELU[base] || /^[A-Z][A-Z]?$/.test(base)) return { [normEl(base)]: 1 };
      return null;
    };
    params.forEach(p => {
      const m = /^G\s*\(\s*([^,]+?)\s*,\s*([^;)]+?)\s*;\s*0\s*\)\s*([\s\S]*)$/i.exec(p);
      if (!m) return; // L, TC, BMAGN and other parameters are solution or magnetic terms
      const ph = m[1].toUpperCase(), cons = m[2].split(':').map(x => x.trim()), phase = phases[ph];
      if (!phase) { out.warnings.push('Parameter for undeclared phase ' + ph + ' skipped.'); return; }
      if (cons.some(c => c.indexOf(',') >= 0)) return;
      if (cons.some(c => /[+-]\d*$/.test(c) && !/^VA$/i.test(c))) { out.warnings.push('End member ' + ph + '(' + cons.join(':') + ') of an ionic model skipped. Use the local server with pycalphad for ionic liquids.'); return; }
      const comp = {}; let okc = true;
      cons.forEach((c, k) => { const sc = spComp(c); if (!sc) { okc = false; return; } for (const e in sc) comp[e] = (comp[e] || 0) + sc[e] * (phase.sites[k] || 1); });
      if (!okc) { out.warnings.push('Unknown constituent in ' + ph + '(' + cons.join(':') + ').'); return; }
      try {
        const pw = tdbRanges(m[3], funcs);
        const segs = pw.map(x => [x.lo, x.hi, Object.keys(x.p).filter(key => x.p[key] !== 0).map(key => { const [n, mm] = key.split(',').map(Number); return [x.p[key], n, mm]; })]);
        const isGas = /^GAS/.test(ph);
        out.species.push({ name: ph + '(' + cons.join(':') + ')', comp, phase: isGas ? 'gas' : 'cond', record: { model: 'gpoly', segs, pref: 1e5 },
          Tmin: segs[0][0], Tmax: segs[segs.length - 1][1], src: 'TDB', notes: phase.sites.length > 1 ? 'sites ' + phase.sites.join(':') : '' });
      } catch (e) { out.warnings.push(ph + '(' + cons.join(':') + '): ' + e.message); }
    });
    if (!out.species.length) out.warnings.push('No G parameters of stoichiometric phases or end members were found.');
    return out;
  }

  /* ---------- 6. CSV: tabulated standard-state data, or activity coefficients against temperature ---------- */
  function parseCSV(text, opts, filename) {
    const out = { species: [], gamma: null, warnings: [] };
    const rows = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^#/.test(l)).map(l => l.split(/[,;\t]/).map(x => x.trim()));
    if (rows.length < 2) { out.warnings.push('The CSV file has no data rows.'); return out; }
    const head = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ''));
    const col = re => head.findIndex(h => re.test(h));
    let iT = col(/^t(\(k\)|_k|k)?$/), Tc = false;
    if (iT < 0) { iT = col(/^t(\(c\)|_c|c|\(°c\))$/); Tc = iT >= 0; }
    if (iT < 0) { out.warnings.push('No temperature column (T in K, or T_C in degrees C).'); return out; }
    const data = rows.slice(1).map(r => r.map(Number));
    const Tof = r => r[iT] + (Tc ? 273.15 : 0);
    const ih = col(/^h(\(j\/mol\))?$/), is = col(/^s(\(j\/molk\))?$/), icp = col(/^cp(\(j\/molk\))?$/), isp = col(/^(species|name)$/), ig = col(/^g(\(j\/mol\))?$/);
    if (ih >= 0 && is >= 0 && icp >= 0) {
      const groups = {};
      data.forEach((r, k) => { const nm = isp >= 0 ? rows[k + 1][isp] : (filename || 'species').replace(/\.[^.]*$/, ''); (groups[nm] = groups[nm] || []).push(r); });
      for (const nm in groups) {
        const g = groups[nm].filter(r => [Tof(r), r[ih], r[is], r[icp]].every(isFinite)).sort((a, b) => Tof(a) - Tof(b));
        if (g.length < 2) { out.warnings.push(nm + ': fewer than two valid rows.'); continue; }
        out.species.push({ name: nm, comp: parseFormula(nm), phase: phaseTag(nm) === 'g' ? 'gas' : phaseTag(nm) ? 'cond' : null,
          record: { model: 'table', T: g.map(Tof), h: g.map(r => r[ih]), s: g.map(r => r[is]), cp: g.map(r => r[icp]), pref: opts.pref },
          Tmin: Tof(g[0]), Tmax: Tof(g[g.length - 1]), src: 'CSV table', notes: '' });
      }
      return out;
    }
    if (ig >= 0) { out.warnings.push('A G column alone is not enough. Give h, s and cp so that the heat balance is defined.'); return out; }
    /* activity coefficients: T and one column per slag oxide */
    const ox = { zno: 'ZnO', pbo: 'PbO', feo: 'FeO', 'feo1.5': 'FeO1.5', feo15: 'FeO1.5' }, table = {};
    head.forEach((h, k) => { const key = ox[h.replace(/^(gamma|γ|g)_?/, '').replace(/[()]/g, '')]; if (key && k !== iT) table[key] = { T: [], g: [] }; if (key && k !== iT) table[key].col = k; });
    if (!Object.keys(table).length) { out.warnings.push('The CSV file has neither h, s, cp columns nor activity-coefficient columns (ZnO, PbO, FeO, FeO1.5).'); return out; }
    for (const id in table) { data.forEach(r => { const T = Tof(r), g = r[table[id].col]; if (isFinite(T) && g > 0) { table[id].T.push(T); table[id].g.push(g); } }); delete table[id].col; }
    out.gamma = { table };
    return out;
  }

  /* ---------- dispatch ---------- */
  function detect(text, filename) {
    const f = (filename || '').toLowerCase(), t = text.slice(0, 4000);
    if (/\.json$/.test(f) || /^\s*\{/.test(t)) return 'json';
    if (/\.ya?ml$/.test(f) || /^\s*(species|phases|units|description|generator)\s*:/m.test(t)) return 'yaml';
    if (/\.tdb$/.test(f) || /^\s*(ELEMENT|FUNCTION|PARAMETER|PHASE|TYPE_DEFINITION)\b/im.test(t)) return 'tdb';
    if (/\.csv$/.test(f) || /^\s*(t|t_c|t\(k\)|species)\s*[,;\t]/i.test(t)) return 'csv';
    const lines = t.split(/\r?\n/);
    if (lines.some(l => l.length >= 80 && l.charAt(79) === '1') && lines.some(l => l.length >= 80 && l.charAt(79) === '2')) return 'nasa7';
    if (/^\s*thermo\b/im.test(t) || lines.some(l => /^\s?\d\s/.test(l) && l.length > 60)) return 'nasa9';
    return 'unknown';
  }
  function parse(text, filename, opts) {
    opts = Object.assign({ pref: 1e5 }, opts || {});
    const fmt = opts.format && opts.format !== 'auto' ? opts.format : detect(text, filename);
    let r;
    switch (fmt) {
      case 'json': r = parseJSON(text, opts); break;
      case 'nasa7': r = parseNASA7(text, opts); break;
      case 'nasa9': r = parseNASA9(text, opts); break;
      case 'yaml': r = parseYAML(text, opts); break;
      case 'tdb': r = parseTDB(text, opts); break;
      case 'csv': r = parseCSV(text, opts, filename); break;
      default: return { format: 'unknown', species: [], gamma: null, warnings: ['The format of ' + filename + ' was not recognised. Choose it in the format list.'] };
    }
    r.format = fmt;
    r.species.forEach(s => { if (!s.comp) s.comp = parseFormula(s.name); if (s.comp) for (const e in s.comp) if (s.comp[e] === 0) delete s.comp[e]; });
    return r;
  }

  /* ---------- matching imported species to the model's standard-state records ---------- */
  function canonical(name) { return String(name).toLowerCase().replace(/\s+/g, '').replace(/\((cr|c|a|s|solid)\)$/, '(s)').replace(/\((l|liq|liquid)\)$/, '(l)').replace(/\((g|gas)\)$/, '(g)'); }
  function compatible(key, sp) {
    if (!sp.comp || !sameComp(key.comp, sp.comp)) return false;
    if (sp.phase && key.phase && sp.phase !== key.phase) return false;
    const tk = phaseTag(key.key), ts = phaseTag(sp.name);
    if (key.phase === 'cond' && ts === 'g') return false;
    if (key.phase === 'gas' && (ts === 's' || ts === 'l')) return false;
    if (tk && ts && tk !== ts && !/\(s,l\)$/.test(key.key)) return false;
    return true;
  }
  function autoMatch(keys, list) {
    const out = {};
    keys.forEach(k => {
      const cands = list.filter(s => compatible(k, s));
      const exact = cands.filter(s => canonical(s.name) === canonical(k.key));
      if (exact.length === 1) out[k.key] = exact[0];
      else if (cands.length === 1 && !/\(s,l\)$/.test(k.key)) out[k.key] = cands[0];
    });
    return out;
  }

  /* ---------- export of a data set in the JSON exchange format ---------- */
  function toJSON(entries, activity, source) {
    const sp = entries.map(e => {
      const r = e.record, o = { name: e.name, composition: e.comp, phase: e.phase || undefined, source: e.src };
      if (r.mk) Object.assign(o, { model: 'mk', H298: r.H298, S298: r.S298, mk: r.mk });
      else if (r.model === 'table') Object.assign(o, { model: 'table', T: r.T, h: r.h, s: r.s, cp: r.cp });
      else Object.assign(o, { model: r.model || 'nasa7', segs: r.segs });
      if (r.pref && r.pref !== 1e5) o['reference-pressure-Pa'] = r.pref;
      if (r.dH || r.dS) { o.dH = r.dH || 0; o.dS = r.dS || 0; }
      return o;
    });
    return JSON.stringify({ format: 'fuming-thermo-1', source: source || 'Fuming Thermodynamic Model', 'reference-pressure-Pa': 1e5,
      units: 'J/mol, J/(mol K); enthalpy relative to the elements at 298.15 K (SER); absolute entropy', species: sp, activity: activity || undefined }, null, 1);
  }

  return { parse, detect, parseFormula, sameComp, phaseTag, autoMatch, compatible, canonical, toJSON, ATM };
})();
if (typeof module !== 'undefined') module.exports = FumeDB;
