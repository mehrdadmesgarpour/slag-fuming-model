/* Fuming thermodynamic engine.
   Expects THERMO (species thermochemical records) in scope.
   Units: mol, J, K, bar. Enthalpies are absolute (elements at 298.15 K = 0). */
const R = 8.314462618, T0 = 298.15, NM3 = 101325 / (R * 273.15);
const AW = { C: 12.011, H: 1.008, O: 15.999, N: 14.007, S: 32.06, Zn: 65.38, Pb: 207.2, Fe: 55.845,
  Si: 28.085, Ca: 40.078, Al: 26.9815, Mg: 24.305, X: 60.083 };
const ELS = ['C', 'H', 'O', 'N', 'S', 'Zn', 'Pb', 'Fe', 'Si', 'Ca', 'Al', 'Mg', 'X'];
const EI = {}; ELS.forEach((e, i) => { EI[e] = i; });
const NE = ELS.length;

/* ZnO(s) is not in the NASA file. 298 K values: CODATA key values. Cp = a + bT + cT^-2, J/(mol K).
   Same data as the slag-fuming-model repository, which records agreement with SUPCRT16 zincite within 1.3 kJ. */
THERMO['ZnO(s)'] = { mk: [45.338, 7.289e-3, -5.732e5], H298: -350460, S298: 43.65 };
/* JANAF FeO is the hypothetical stoichiometric compound and is more stable than iron-saturated iron oxide.
   G is shifted by 5829.5 + 3.1911 T J/mol (about +10.7 kJ at 1250 C) so that FeO activities refer to liquid iron oxide
   in equilibrium with metallic iron (Calphad Fe-O wustite plus fusion; same correction as the slag-fuming-model repository).
   An independent estimate from Fe + 1/2 O2 = FeO(s), dG = -263700 + 64.35 T J, with JANAF fusion gives about +8.1 kJ. */
const FEO_DH = 5829.5, FEO_DS = -3.1911;
THERMO['FeO(l)'].dH = FEO_DH; THERMO['FeO(l)'].dS = FEO_DS; THERMO['FeO(s,l)'].dH = FEO_DH; THERMO['FeO(s,l)'].dS = FEO_DS;

function nasa7(a, T) {
  const a0 = a[2], a1 = a[3], a2 = a[4], a3 = a[5], a4 = a[6];
  return [
    R * T * (a0 + T * (a1 / 2 + T * (a2 / 3 + T * (a3 / 4 + T * a4 / 5))) + a[7] / T),
    R * (a0 * Math.log(T) + T * (a1 + T * (a2 / 2 + T * (a3 / 3 + T * a4 / 4))) + a[8]),
    R * (a0 + T * (a1 + T * (a2 + T * (a3 + T * a4))))
  ];
}
/* [h, s, cp] in J/mol, J/(mol K). Outside the fitted range the heat capacity is held constant. */
function props(key, T) {
  const d = THERMO[key];
  if (d.mk) {
    const a = d.mk[0], b = d.mk[1], c = d.mk[2];
    return [
      d.H298 + a * (T - T0) + b / 2 * (T * T - T0 * T0) - c * (1 / T - 1 / T0),
      d.S298 + a * Math.log(T / T0) + b * (T - T0) - c / 2 * (1 / (T * T) - 1 / (T0 * T0)),
      a + b * T + c / (T * T)
    ];
  }
  const segs = d.segs;
  let Tb = null, seg = null;
  if (T < segs[0][0]) { seg = segs[0]; Tb = seg[0]; }
  else if (T > segs[segs.length - 1][1]) { seg = segs[segs.length - 1]; Tb = seg[1]; }
  else { for (let i = 0; i < segs.length; i++) { if (T <= segs[i][1]) { seg = segs[i]; break; } } }
  let out;
  if (Tb === null) out = nasa7(seg, T);
  else { const p = nasa7(seg, Tb); out = [p[0] + p[2] * (T - Tb), p[1] + p[2] * Math.log(T / Tb), p[2]]; }
  if (d.dH) { out[0] += d.dH; out[1] += d.dS; }
  return out;
}

/* ---- model species ---- */
const SP = [];
function addSp(id, phase, comp, th, f, group, cold) {
  const a = new Float64Array(NE); let M = 0;
  for (const e in comp) { a[EI[e]] = comp[e]; M += comp[e] * AW[e]; }
  SP.push({ id, phase, comp, a, th, f, group, M, cold: cold || th });
}
[['N2', { N: 2 }, 'none'], ['O2', { O: 2 }, 'none'], ['CO', { C: 1, O: 1 }, 'fuel'], ['CO2', { C: 1, O: 2 }, 'fuel'],
 ['H2', { H: 2 }, 'fuel'], ['H2O', { H: 2, O: 1 }, 'fuel'], ['CH4', { C: 1, H: 4 }, 'fuel'],
 ['Zn', { Zn: 1 }, 'Zn'], ['Pb', { Pb: 1 }, 'Pb'], ['PbO', { Pb: 1, O: 1 }, 'Pb'], ['PbS', { Pb: 1, S: 1 }, 'Pb'],
 ['SO2', { S: 1, O: 2 }, 'fuel'], ['H2S', { H: 2, S: 1 }, 'fuel'], ['S2', { S: 2 }, 'fuel'], ['COS', { C: 1, O: 1, S: 1 }, 'fuel']
].forEach(r => addSp(['Zn', 'Pb', 'PbO', 'PbS'].includes(r[0]) ? r[0] + '(g)' : r[0], 'gas', r[1], r[0] + '(g)', 1, r[2]));
addSp('FeO', 'slag', { Fe: 1, O: 1 }, 'FeO(l)', 1, 'Fe', 'FeO(s,l)');
addSp('FeO1.5', 'slag', { Fe: 1, O: 1.5 }, 'Fe2O3(s)', 0.5, 'Fe');
addSp('ZnO', 'slag', { Zn: 1, O: 1 }, 'ZnO(s)', 1, 'Zn');
addSp('PbO', 'slag', { Pb: 1, O: 1 }, 'PbO(l)', 1, 'Pb', 'PbO(s,l)');
addSp('SiO2', 'slag', { Si: 1, O: 2 }, 'SiO2(l)', 1, 'Si', 'SiO2(s,l)');
addSp('CaO', 'slag', { Ca: 1, O: 1 }, 'CaO(s)', 1, 'none');
addSp('AlO1.5', 'slag', { Al: 1, O: 1.5 }, 'Al2O3(s)', 0.5, 'Al');
addSp('MgO', 'slag', { Mg: 1, O: 1 }, 'MgO(s)', 1, 'none');
addSp('Other', 'slag', { X: 1 }, 'SiO2(l)', 1, 'none', 'SiO2(s,l)');
addSp('Fe', 'pure', { Fe: 1 }, 'Fe', 1, 'Fe');
addSp('Pb', 'pure', { Pb: 1 }, 'Pb', 1, 'Pb');
addSp('C', 'pure', { C: 1 }, 'C(gr)', 1, 'fuel');
addSp('Fe3O4', 'pure', { Fe: 3, O: 4 }, 'Fe3O4(s)', 1, 'Fe');
addSp('Al', 'pure', { Al: 1 }, 'Al', 1, 'Al');
addSp('Si', 'pure', { Si: 1 }, 'Si', 1, 'Si');
const NS = SP.length;
const SI = {}; SP.forEach((s, i) => { SI[s.id] = i; });
const GROUPS = ['fuel', 'Al', 'Zn', 'Pb', 'Fe', 'Si'];

function spProps(i, T, cold) { const s = SP[i]; const p = props(cold ? s.cold : s.th, T); return [p[0] * s.f, p[1] * s.f, p[2] * s.f]; }
function hSp(i, T, cold) { return spProps(i, T, cold)[0]; }

function solveLinear(A, rhs, n) {
  for (let c = 0; c < n; c++) {
    let piv = c, mx = Math.abs(A[c][c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(A[r][c]); if (v > mx) { mx = v; piv = r; } }
    if (mx < 1e-300) return false;
    if (piv !== c) { const t = A[c]; A[c] = A[piv]; A[piv] = t; const u = rhs[c]; rhs[c] = rhs[piv]; rhs[piv] = u; }
    const d = A[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d; if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      rhs[r] -= f * rhs[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = rhs[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * rhs[k];
    rhs[r] = s / A[r][r];
  }
  return true;
}

/* Gibbs energy minimisation at fixed T and P for element amounts b (mol).
   Gas: ideal. Slag: solution of single-cation oxides with constant activity coefficients gam.
   Other condensed phases: pure. Method: Lagrangian (RAND / White-Johnson-Dantzig) Newton iteration
   on element potentials, phase totals and pure-phase amounts, with phase addition and removal. */
function equilibrate(b, T, P, gam, warm) {
  let btot = 0; for (let k = 0; k < NE; k++) btot += Math.max(b[k], 0);
  const bs = new Float64Array(NE);
  for (let k = 0; k < NE; k++) { bs[k] = Math.max(b[k], 0) / btot; if (bs[k] < 1e-12) bs[k] = 0; }
  /* elements that only gas species can carry keep a gas phase open; if they are absent the gas phase may vanish */
  const volat = bs[EI.N] + bs[EI.H] + bs[EI.S] + bs[EI.C];
  if (volat < 1e-9) { bs[EI.N] = 0; bs[EI.H] = 0; bs[EI.S] = 0; bs[EI.C] = 0; }
  const gasRemovable = volat < 1e-9;
  /* likewise the oxide phase can vanish when no non-volatile cation is present (gas-only systems) */
  const slagRemovable = bs[EI.Fe] + bs[EI.Si] + bs[EI.Ca] + bs[EI.Al] + bs[EI.Mg] + bs[EI.X] < 1e-9;
  const el = []; for (let k = 0; k < NE; k++) if (bs[k] > 0) el.push(k);
  const nE = el.length;
  const elOn = new Uint8Array(NE); el.forEach(k => { elOn[k] = 1; });
  const sol = [], pure = [];
  for (let i = 0; i < NS; i++) {
    let ok = true; for (let k = 0; k < NE; k++) if (SP[i].a[k] !== 0 && !elOn[k]) { ok = false; break; }
    if (!ok) continue;
    (SP[i].phase === 'pure' ? pure : sol).push(i);
  }
  const phases = []; const phOf = [];
  sol.forEach(i => { let p = phases.indexOf(SP[i].phase); if (p < 0) { phases.push(SP[i].phase); p = phases.length - 1; } phOf.push(p); });
  const nS = sol.length, nP = phases.length, nC = pure.length;
  const pGas = phases.indexOf('gas'), pSlag = phases.indexOf('slag');
  const pOn = new Uint8Array(nP).fill(1);
  const canVanish = new Uint8Array(nP), flips = new Uint8Array(nP);
  const lnP = Math.log(P);
  const g = new Float64Array(nS), gc = new Float64Array(nC), g0 = new Float64Array(nS);
  const a = [], ac = [];
  for (let q = 0; q < nS; q++) {
    const i = sol[q], p = spProps(i, T);
    g0[q] = (p[0] - T * p[1]) / (R * T);
    g[q] = g0[q] + (SP[i].phase === 'gas' ? lnP : 0) +
      (SP[i].phase === 'slag' && gam && gam[SP[i].id] ? Math.log(gam[SP[i].id]) : 0);
    a.push(el.map(k => SP[i].a[k]));
  }
  for (let c = 0; c < nC; c++) {
    const i = pure[c], p = spProps(i, T);
    gc[c] = (p[0] - T * p[1]) / (R * T);
    ac.push(el.map(k => SP[i].a[k]));
  }
  const be = el.map(k => bs[k]);
  const lnn = new Float64Array(nS), lnN = new Float64Array(nP), ncond = new Float64Array(nC);
  const active = new Uint8Array(nC);
  const pi = new Float64Array(nE);
  const dln = new Float64Array(nS), mu = new Float64Array(nS), nn = new Float64Array(nS);
  let iters = 0;

  /* Oxygen needed by the oxide and gas species when no reduced pure phase is available as a sink.
     If it exceeds the oxygen present, the element balance cannot be met by the solution phases alone. */
  const cIdx = id => pure.indexOf(SI[id]);
  const sinkDef = [['Pb', 1], ['C', 1], ['Fe', 1], ['Si', 2], ['Al', 1.5]];
  const sinks = sinkDef.map(r => ({ id: r[0], c: cIdx(r[0]), b: bs[EI[r[0]]], o: r[1] }));
  const gasOff = () => pGas < 0 || !pOn[pGas];
  function oxygenShort() {
    let need = bs[EI.Ca] + bs[EI.Mg];
    const off = gasOff();
    if (off) need += bs[EI.Zn];
    sinks.forEach(r => { if (r.id === 'Pb' && !off) return; if (r.c < 0 || !active[r.c]) need += r.b * r.o; });
    return need > bs[EI.O] * (1 - 1e-9);
  }
  /* oxygen beyond what the condensed oxides can hold must leave as gas */
  const oCapacity = 1.5 * bs[EI.Fe] + bs[EI.Zn] + bs[EI.Pb] + 2 * bs[EI.Si] + bs[EI.Ca] + 1.5 * bs[EI.Al] + bs[EI.Mg];
  const gasRequired = bs[EI.O] > oCapacity * (1 - 1e-9);
  if (pGas >= 0 && gasRemovable && !gasRequired) canVanish[pGas] = 1;
  if (pSlag >= 0 && slagRemovable) canVanish[pSlag] = 1;
  function addSink(usePi) {
    let best = -1, bv = Infinity;
    const off = gasOff();
    sinks.forEach((r, j) => {
      if (r.c < 0 || active[r.c] || r.b <= 0 || (r.id === 'Pb' && !off)) return;
      let d = j; // default order: Pb, C, Fe, Si, Al
      if (usePi) { d = gc[r.c]; for (let k = 0; k < nE; k++) d -= ac[r.c][k] * pi[k]; }
      if (d < bv) { bv = d; best = r.c; }
    });
    if (best >= 0) { active[best] = 1; ncond[best] = 0; return true; }
    if (off && pGas >= 0) { gasOn(1); return true; }
    return false;
  }
  function coldStart() {
    const n0 = new Float64Array(NS).fill(1e-9);
    const B = k => bs[EI[k]];
    n0[SI.N2] = B('N') / 2; n0[SI.CO] = 0.5 * B('C'); n0[SI.CO2] = 0.5 * B('C');
    n0[SI.H2] = 0.25 * B('H'); n0[SI.H2O] = 0.25 * B('H');
    n0[SI.FeO] = 0.9 * B('Fe'); n0[SI['FeO1.5']] = 0.1 * B('Fe');
    n0[SI.ZnO] = B('Zn'); n0[SI['Zn(g)']] = 1e-3 * B('Zn'); n0[SI.PbO] = 0.9 * B('Pb');
    n0[SI.SiO2] = B('Si'); n0[SI.CaO] = B('Ca'); n0[SI['AlO1.5']] = B('Al'); n0[SI.MgO] = B('Mg'); n0[SI.Other] = B('X');
    const tot = new Float64Array(nP);
    for (let q = 0; q < nS; q++) { const v = Math.max(n0[sol[q]], 1e-9); lnn[q] = Math.log(v); tot[phOf[q]] += v; }
    for (let p = 0; p < nP; p++) lnN[p] = Math.log(tot[p]);
    ncond.fill(0); active.fill(0); pOn.fill(1); flips.fill(0);
    for (let j = 0; j < 4 && oxygenShort(); j++) if (!addSink(false)) break;
  }
  function warmStart() {
    const tot = new Float64Array(nP);
    for (let q = 0; q < nS; q++) { const v = Math.max(warm.n[sol[q]] / btot, 1e-30); lnn[q] = Math.log(v); tot[phOf[q]] += v; }
    for (let p = 0; p < nP; p++) lnN[p] = Math.log(tot[p]);
    pOn.fill(1); flips.fill(0);
    for (let p = 0; p < nP; p++) if (canVanish[p] && tot[p] < 1e-12) pOn[p] = 0;
    for (let c = 0; c < nC; c++) { const v = warm.n[pure[c]] / btot; ncond[c] = v > 0 ? v : 0; active[c] = v > 0 ? 1 : 0; }
  }
  /* stability of a switched-off solution phase: sum over its species of exp(element potentials - standard potential).
     For the gas this is the sum of equilibrium partial pressures over the total pressure. */
  function saturation(p) {
    let Q = 0;
    for (let q = 0; q < nS; q++) if (phOf[q] === p) { let d = -g[q]; for (let k = 0; k < nE; k++) if (a[q][k] !== 0) d += a[q][k] * pi[k]; Q += Math.exp(d); }
    return Q;
  }
  function phaseOn(p, Q) {
    const amount = 1e-5;
    if (!(Q > 0) || !isFinite(Q)) Q = 1;
    for (let q = 0; q < nS; q++) if (phOf[q] === p) { let d = -g[q]; for (let k = 0; k < nE; k++) if (a[q][k] !== 0) d += a[q][k] * pi[k]; lnn[q] = Math.min(Math.max(d - Math.log(Q) + Math.log(amount), -600), 0); }
    lnN[p] = Math.log(amount); pOn[p] = 1;
  }
  function gasOn(Q) { phaseOn(pGas, Q); }

  function newton(maxIt, damp) {
    let lastAdd = -10; const shrink = new Uint8Array(nP);
    for (let it = 0; it < maxIt; it++) {
      iters++;
      const actC = []; for (let c = 0; c < nC; c++) if (active[c]) actC.push(c);
      const m = nE + nP + actC.length;
      const A = []; for (let r = 0; r < m; r++) A.push(new Float64Array(m));
      const rhs = new Float64Array(m);
      const Np = new Float64Array(nP), sumn = new Float64Array(nP);
      for (let p = 0; p < nP; p++) Np[p] = pOn[p] ? Math.exp(lnN[p]) : 0;
      for (let k = 0; k < nE; k++) rhs[k] = be[k];
      for (let q = 0; q < nS; q++) {
        const p = phOf[q]; if (!pOn[p]) { nn[q] = 0; continue; }
        const n = Math.exp(lnn[q]); nn[q] = n; sumn[p] += n;
        const m_ = g[q] + lnn[q] - lnN[p]; mu[q] = m_;
        const aq = a[q];
        for (let k = 0; k < nE; k++) {
          const ak = aq[k]; if (ak === 0) continue;
          const w = ak * n;
          for (let j = 0; j < nE; j++) if (aq[j] !== 0) A[k][j] += w * aq[j];
          A[k][nE + p] += w; A[nE + p][k] += w;
          rhs[k] += w * (m_ - 1);
        }
        rhs[nE + p] += n * (m_ - 1);
      }
      for (let p = 0; p < nP; p++) {
        if (pOn[p]) { A[nE + p][nE + p] = sumn[p] - Np[p]; rhs[nE + p] += Np[p]; }
        else { A[nE + p][nE + p] = 1; rhs[nE + p] = 0; }
      }
      actC.forEach((c, x) => {
        const row = nE + nP + x;
        for (let k = 0; k < nE; k++) { A[k][row] = ac[c][k]; A[row][k] = ac[c][k]; rhs[k] -= ac[c][k] * ncond[c]; }
        rhs[row] = gc[c];
      });
      if (!solveLinear(A, rhs, m)) return false;
      for (let k = 0; k < nE; k++) pi[k] = rhs[k];
      let l1 = 0, l2 = 1;
      for (let p = 0; p < nP; p++) l1 = Math.max(l1, 5 * Math.abs(rhs[nE + p]));
      let ntot = 0; for (let p = 0; p < nP; p++) ntot += Np[p];
      let err = 0;
      for (let q = 0; q < nS; q++) {
        const p = phOf[q]; if (!pOn[p]) continue;
        let d = rhs[nE + p] - mu[q];
        const aq = a[q]; for (let k = 0; k < nE; k++) if (aq[k] !== 0) d += aq[k] * pi[k];
        dln[q] = d;
        const rel = lnn[q] - lnN[p];
        if (rel > -18.42) l1 = Math.max(l1, Math.abs(d));
        else if (d > 0) { const den = d - rhs[nE + p]; if (den > 0) l2 = Math.min(l2, Math.abs((-rel - 9.2103404) / den)); }
        if (lnn[q] > -590) err = Math.max(err, Math.abs(d) * Math.min(1, Math.exp(rel) * 1e12));
      }
      for (let p = 0; p < nP; p++) err = Math.max(err, Math.abs(rhs[nE + p]));
      actC.forEach((c, x) => { err = Math.max(err, Math.abs(rhs[nE + nP + x]) / ntot); });
      const lam = Math.min(1, l1 > 0 ? 2 / l1 : 1, l2) * damp;
      for (let q = 0; q < nS; q++) { if (!pOn[phOf[q]]) continue; lnn[q] += lam * dln[q]; if (lnn[q] < -600) lnn[q] = -600; }
      for (let p = 0; p < nP; p++) if (pOn[p]) lnN[p] += lam * rhs[nE + p];
      actC.forEach((c, x) => { ncond[c] += lam * rhs[nE + nP + x]; });
      if (err < 1e-9 && lam > 0.999 * damp) {
        let res = 0;
        for (let k = 0; k < nE; k++) {
          let s = -be[k];
          for (let q = 0; q < nS; q++) if (pOn[phOf[q]]) s += a[q][k] * Math.exp(lnn[q]);
          for (let c = 0; c < nC; c++) if (active[c]) s += ac[c][k] * ncond[c];
          res = Math.max(res, Math.abs(s));
        }
        if (res < 1e-11) return true;
      }
      for (let p = 0; p < nP; p++) if (pOn[p] && !(lnN[p] > -60 && lnN[p] < 20)) return false; // diverged
      /* a phase that no element depends on can vanish: switch it off when it keeps shrinking */
      for (let p = 0; p < nP; p++) if (pOn[p] && canVanish[p]) {
        shrink[p] = rhs[nE + p] < -1 ? shrink[p] + 1 : 0;
        if (shrink[p] >= 4 || lnN[p] < -27.6) { pOn[p] = 0; shrink[p] = 0; }
      }
      /* without a reduced pure phase the oxygen balance cannot close: bring in a sink */
      if (it >= 2 && it - lastAdd >= 3 && oxygenShort()) { if (addSink(true)) lastAdd = it; }
    }
    return false;
  }

  let converged = false;
  function run(useWarm, damp) {
    if (useWarm) warmStart(); else coldStart();
    for (let outer = 0; outer < 60; outer++) {
      const ok = newton(damp < 1 ? 1500 : 400, damp);
      if (!ok) return false;
      let turned = false;
      for (let p = 0; p < nP && !turned; p++) if (!pOn[p] && flips[p] < 3) {
        const Q = saturation(p);
        if (Q > 1 + 1e-9) { phaseOn(p, Q); flips[p]++; turned = true; }
      }
      if (turned) continue;
      let best = -1, bv = -1e-9;
      for (let c = 0; c < nC; c++) {
        if (active[c]) continue;
        let d = gc[c]; for (let k = 0; k < nE; k++) d -= ac[c][k] * pi[k];
        if (d < bv) { bv = d; best = c; }
      }
      if (best >= 0) { active[best] = 1; ncond[best] = 0; continue; }
      let worst = -1, wv = -1e-14;
      for (let c = 0; c < nC; c++) if (active[c] && ncond[c] < wv) { wv = ncond[c]; worst = c; }
      if (worst >= 0) { active[worst] = 0; ncond[worst] = 0; continue; }
      return true;
    }
    return false;
  }
  if (warm && warm.n) converged = run(true, 1);
  if (!converged) converged = run(false, 1);
  if (!converged) converged = run(false, 0.3);
  if (!converged) converged = run(false, 0.1);

  const n = new Float64Array(NS), act = new Float64Array(NS);
  const phaseMol = { gas: 0, slag: 0 };
  for (let q = 0; q < nS; q++) {
    if (!pOn[phOf[q]]) continue;
    const v = Math.exp(lnn[q]) * btot; n[sol[q]] = v;
    phaseMol[phases[phOf[q]]] += v;
  }
  for (let q = 0; q < nS; q++) {
    let d = -g0[q]; for (let k = 0; k < nE; k++) if (a[q][k] !== 0) d += a[q][k] * pi[k];
    act[sol[q]] = Math.exp(d); // gas: partial pressure in bar; slag: activity
  }
  for (let c = 0; c < nC; c++) {
    n[pure[c]] = active[c] ? Math.max(ncond[c], 0) * btot : 0;
    let d = gc[c]; for (let k = 0; k < nE; k++) d -= ac[c][k] * pi[k];
    act[pure[c]] = Math.exp(-d);
  }
  let G = 0; for (let k = 0; k < nE; k++) G += pi[k] * be[k];
  const piFull = new Float64Array(NE).fill(NaN); el.forEach((k, j) => { piFull[k] = pi[j]; });
  return { n, act, pi: piFull, T, P, G: G * R * T * btot, converged, iters, phaseMol, noGas: pGas < 0 || !pOn[pGas] };
}

/* total enthalpy (J) of species amounts n at T, model states */
function enthalpy(n, T, phase) {
  let H = 0;
  for (let i = 0; i < NS; i++) if (n[i] !== 0 && (!phase || SP[i].phase === phase)) H += n[i] * hSp(i, T);
  return H;
}
function heatCap(n, T) { let c = 0; for (let i = 0; i < NS; i++) if (n[i] !== 0) c += n[i] * spProps(i, T)[2]; return c; }

/* ---- feed streams ---- */
const MOX = { ZnO: AW.Zn + AW.O, PbO: AW.Pb + AW.O, FeO: AW.Fe + AW.O, Fe2O3: 2 * AW.Fe + 3 * AW.O,
  SiO2: AW.Si + 2 * AW.O, CaO: AW.Ca + AW.O, Al2O3: 2 * AW.Al + 3 * AW.O, MgO: AW.Mg + AW.O };

/* slag assay (wt%) -> mol of slag species per kg slag */
function slagPerKg(s) {
  const f3 = Math.min(Math.max(s.fe3 / 100, 0), 1);
  const ox = {
    ZnO: s.Zn * MOX.ZnO / AW.Zn, PbO: s.Pb * MOX.PbO / AW.Pb,
    FeO: s.Fe * (1 - f3) * MOX.FeO / AW.Fe, Fe2O3: s.Fe * f3 * MOX.Fe2O3 / (2 * AW.Fe),
    SiO2: s.SiO2, CaO: s.CaO, Al2O3: s.Al2O3, MgO: s.MgO
  };
  let sum = 0; for (const k in ox) { ox[k] = Math.max(ox[k] || 0, 0); sum += ox[k]; }
  let scale = 1, other = 100 - sum;
  if (sum > 100) { scale = 100 / sum; other = 0; }
  const n = new Float64Array(NS);
  const g = k => ox[k] * scale * 10; // g per kg slag
  n[SI.ZnO] = g('ZnO') / MOX.ZnO; n[SI.PbO] = g('PbO') / MOX.PbO; n[SI.FeO] = g('FeO') / MOX.FeO;
  n[SI['FeO1.5']] = 2 * g('Fe2O3') / MOX.Fe2O3; n[SI.SiO2] = g('SiO2') / MOX.SiO2; n[SI.CaO] = g('CaO') / MOX.CaO;
  n[SI['AlO1.5']] = 2 * g('Al2O3') / MOX.Al2O3; n[SI.MgO] = g('MgO') / MOX.MgO; n[SI.Other] = other * 10 / AW.X;
  return { n, oxideSum: sum, other };
}
function hhvEstimate(c) { // Channiwala and Parikh (2002), MJ/kg dry
  return 0.3491 * c.C + 1.1783 * c.H + 0.1005 * c.S - 0.1034 * c.O - 0.0151 * c.N - 0.0211 * c.ash;
}
const ASH_SIO2 = 0.6;

function elemOf(n) { const b = new Float64Array(NE); for (let i = 0; i < NS; i++) if (n[i] !== 0) for (let k = 0; k < NE; k++) b[k] += n[i] * SP[i].a[k]; return b; }
function groupH298(n, out) { for (let i = 0; i < NS; i++) if (n[i] !== 0) { const gk = SP[i].group; if (gk !== 'none') out[gk] = (out[gk] || 0) + n[i] * hSp(i, T0); } return out; }
function massOf(n, phase) { let m = 0; for (let i = 0; i < NS; i++) if (!phase || SP[i].phase === phase) m += n[i] * SP[i].M; return m / 1000; }

/* Feed rates per hour. Each stream: b (mol/h of elements), H (J/h at inlet state), sens (J/h above 25 C),
   g298 (J/h, enthalpy at 25 C by element group), melt (J/h, crystalline minus slag-state enthalpy at 25 C). */
function buildFeeds(inp) {
  const warn = [];
  const sp = slagPerKg(inp.slag);
  if (sp.oxideSum > 100.05) warn.push('Slag oxides sum to ' + sp.oxideSum.toFixed(1) + ' wt%. They were scaled to 100 %.');
  const cold = Math.min(Math.max(inp.slag.cold / 100, 0), 1);
  const mSlag = inp.slag.rate * 1000; // kg per hour (continuous) or kg per batch
  const Tf = inp.slag.T + 273.15;
  const mk = (name) => ({ name, b: new Float64Array(NE), H: 0, sens: 0, g298: {}, melt: 0, mass: 0, n: null });
  const hot = mk('Molten slag'), cld = mk('Cold charge');
  hot.n = sp.n.map(v => v * mSlag * (1 - cold)); cld.n = sp.n.map(v => v * mSlag * cold);
  hot.b = elemOf(hot.n); cld.b = elemOf(cld.n); hot.mass = mSlag * (1 - cold); cld.mass = mSlag * cold;
  hot.H = enthalpy(hot.n, Tf); hot.sens = hot.H - enthalpy(hot.n, T0); groupH298(hot.n, hot.g298);
  for (let i = 0; i < NS; i++) if (cld.n[i] !== 0) { const hc = hSp(i, T0, true); cld.H += cld.n[i] * hc; cld.melt += cld.n[i] * (hc - hSp(i, T0)); }
  groupH298(cld.n, cld.g298);

  /* coal */
  const c = inp.coal, coal = mk('Coal');
  let sumU = c.C + c.H + c.O + c.N + c.S + c.ash;
  if (Math.abs(sumU - 100) > 0.5) warn.push('Coal analysis sums to ' + sumU.toFixed(1) + ' wt% (dry). It was scaled to 100 %.');
  const sc = sumU > 0 ? 100 / sumU : 0;
  const u = { C: c.C * sc, H: c.H * sc, O: c.O * sc, N: c.N * sc, S: c.S * sc, ash: c.ash * sc };
  const hhv = c.hhvAuto ? hhvEstimate(u) : c.hhv;
  const eff = c.rate * (1 - Math.min(Math.max(c.bypass / 100, 0), 1));
  const mDry = eff * (1 - c.moist / 100), mW = eff * c.moist / 100;
  const nC = mDry * 10 * u.C / AW.C, nH = mDry * 10 * u.H / AW.H, nO = mDry * 10 * u.O / AW.O, nN = mDry * 10 * u.N / AW.N, nS = mDry * 10 * u.S / AW.S;
  const nW = mW * 1000 / (2 * AW.H + AW.O);
  const ashN = new Float64Array(NS);
  ashN[SI.SiO2] = mDry * 10 * u.ash * ASH_SIO2 / MOX.SiO2; ashN[SI['AlO1.5']] = 2 * mDry * 10 * u.ash * (1 - ASH_SIO2) / MOX.Al2O3;
  coal.b = elemOf(ashN);
  coal.b[EI.C] += nC; coal.b[EI.H] += nH + 2 * nW; coal.b[EI.O] += nO + nW; coal.b[EI.N] += nN; coal.b[EI.S] += nS;
  const hOrg = mDry * hhv * 1e6 + nC * props('CO2(g)', T0)[0] + nH / 2 * props('H2O(l)', T0)[0] + nS * props('SO2(g)', T0)[0];
  const hWat = nW * props('H2O(l)', T0)[0];
  coal.g298 = groupH298(ashN, {}); coal.g298.fuel = (coal.g298.fuel || 0) + hOrg + hWat;
  coal.H = hOrg + hWat + enthalpy(ashN, T0); coal.mass = eff;
  coal.info = { hhv, lhv: hhv - 0.2182 * u.H, nCtotal: c.rate * (1 - c.moist / 100) * 10 * u.C / AW.C, u };

  /* aluminium */
  const al = mk('Aluminium'), fm = Math.min(Math.max(inp.al.metal / 100, 0), 1);
  const alN = new Float64Array(NS);
  alN[SI.Al] = inp.al.rate * 1000 * fm / AW.Al; alN[SI['AlO1.5']] = 2 * inp.al.rate * 1000 * (1 - fm) / MOX.Al2O3;
  al.b = elemOf(alN); al.mass = inp.al.rate;
  al.H = alN[SI.Al] * props('Al', T0)[0] + alN[SI['AlO1.5']] * hSp(SI['AlO1.5'], T0);
  al.g298 = { Al: al.H };

  /* blast */
  const bl = mk('Blast'), xo = Math.min(Math.max(inp.blast.o2 / 100, 0), 1), Tb = inp.blast.T + 273.15;
  const blN = new Float64Array(NS);
  blN[SI.O2] = inp.blast.rate * NM3 * xo; blN[SI.N2] = inp.blast.rate * NM3 * (1 - xo);
  bl.b = elemOf(blN); bl.H = enthalpy(blN, Tb); bl.sens = bl.H; bl.mass = massOf(blN);
  return { hot, cld, coal, al, bl, warn, slagInfo: sp };
}

function describe(eq, P) {
  const n = eq.n, gasMol = eq.phaseMol.gas || 0, slagMol = eq.phaseMol.slag || 0;
  const mg = id => n[SI[id]] * SP[SI[id]].M / 1000;
  const slagMass = massOf(n, 'slag');
  const ox = {
    ZnO: mg('ZnO'), PbO: mg('PbO'), FeO: mg('FeO'), Fe2O3: mg('FeO1.5'), SiO2: mg('SiO2'), CaO: mg('CaO'),
    Al2O3: mg('AlO1.5'), MgO: mg('MgO'), Other: mg('Other')
  };
  const wt = {}; for (const k in ox) wt[k] = slagMass > 0 ? 100 * ox[k] / slagMass : 0;
  const el = {
    Zn: 100 * n[SI.ZnO] * AW.Zn / 1000 / slagMass, Pb: 100 * n[SI.PbO] * AW.Pb / 1000 / slagMass,
    Fe: 100 * (n[SI.FeO] + n[SI['FeO1.5']]) * AW.Fe / 1000 / slagMass
  };
  const gas = {}; SP.forEach((s, i) => { if (s.phase === 'gas') gas[s.id] = gasMol > 0 ? n[i] / gasMol : 0; });
  return {
    slagMass, wt, el, gas, gasMol, slagMol,
    fe3: n[SI['FeO1.5']] / Math.max(n[SI.FeO] + n[SI['FeO1.5']], 1e-300),
    pO2: eq.act[SI.O2] / 1.01325, coco2: gas.CO2 > 0 ? gas.CO / gas.CO2 : NaN,
    aFe: eq.act[SI.Fe], aC: eq.act[SI.C], aMag: eq.act[SI.Fe3O4],
    aZnO: eq.act[SI.ZnO], aFeO: eq.act[SI.FeO], pZn: eq.act[SI['Zn(g)']] / 1.01325,
    solids: { Fe: mg('Fe'), Pb: mg('Pb'), C: mg('C'), Fe3O4: mg('Fe3O4'), Al: mg('Al'), Si: mg('Si') }
  };
}

/* solve T (K) such that fn(T) = 0, fn increasing in T */
function solveT(fn, Tg, lo, hi) {
  let a = lo, b = hi, T = Math.min(Math.max(Tg, lo), hi), f = fn(T), last = null;
  for (let it = 0; it < 60; it++) {
    if (Math.abs(f.val) < f.tol) return { T, res: f, bound: 0 };
    if (f.val > 0) b = T; else a = T;
    let Tn;
    if (last && Math.abs(f.val - last.f) > 0) Tn = T - f.val * (T - last.T) / (f.val - last.f);
    else Tn = T - f.val / f.slope;
    if (!(Tn > a && Tn < b)) Tn = 0.5 * (a + b);
    if (b - a < 0.02) { if (a <= lo + 0.03) return { T: lo, res: fn(lo), bound: -1 }; if (b >= hi - 0.03) return { T: hi, res: fn(hi), bound: 1 }; return { T, res: f, bound: 0 }; }
    last = { T, f: f.val }; T = Tn; f = fn(T);
  }
  return { T, res: f, bound: 0 };
}
const TMIN = 1073.15, TMAX = 2273.15;

function gamOf(inp) { return { ZnO: inp.gam.ZnO, PbO: inp.gam.PbO, FeO: inp.gam.FeO, 'FeO1.5': inp.gam.FeO15 }; }

/* One equilibrium stage: bath contents nBath (mol, enthalpy Hbath) plus the feed streams for a duration dt (h).
   Optional second zone: a share of the blast does not equilibrate with the slag. It burns the bath gas
   (gas-only equilibrium at bath temperature, ZnO and PbO fume allowed) and a fraction hte of that heat returns to the bath. */
function stage(nBath, Hbath, feeds, dt, inp, Tfix, Tguess, warm) {
  const P = inp.op.P * 1.01325, gam = gamOf(inp);
  const fpc = Math.min(Math.max((inp.blast.pc || 0) / 100, 0), 0.95), hte = Math.min(Math.max((inp.blast.hte == null ? 100 : inp.blast.hte) / 100, 0), 1);
  const b = nBath ? elemOf(nBath) : new Float64Array(NE);
  let Hin = Hbath || 0;
  const list = [feeds.coal, feeds.al].concat(nBath ? [feeds.cld] : [feeds.hot, feeds.cld]);
  list.forEach(s => { for (let k = 0; k < NE; k++) b[k] += s.b[k] * dt; Hin += s.H * dt; });
  for (let k = 0; k < NE; k++) b[k] += feeds.bl.b[k] * dt * (1 - fpc);
  Hin += feeds.bl.H * dt * (1 - fpc);
  const bPc = feeds.bl.b.map(v => v * dt * fpc), HinPc = feeds.bl.H * dt * fpc;
  const loss = inp.op.loss * 1e6 * 3600 * dt;
  let eq = null, eqB = null, w = warm, wB = warm && warm.eqB ? warm.eqB : null;
  const evalAt = T => {
    eq = equilibrate(b, T, P, gam, w); w = eq.converged ? eq : null;
    const Hout = enthalpy(eq.n, T);
    let Qpc = 0, HgasB = 0; eqB = null;
    if (fpc > 0) {
      const nGas = new Float64Array(NS); let HgasA = 0;
      for (let i = 0; i < NS; i++) if (SP[i].phase === 'gas') { nGas[i] = eq.n[i]; HgasA += eq.n[i] * hSp(i, T); }
      const bB = elemOf(nGas); for (let k = 0; k < NE; k++) bB[k] += bPc[k];
      eqB = equilibrate(bB, T, P, null, wB); wB = eqB.converged ? eqB : null;
      HgasB = enthalpy(eqB.n, T);
      Qpc = HgasA + HinPc - HgasB;
    }
    return { val: Hout + loss - Hin - hte * Qpc, slope: Math.max(heatCap(eq.n, T), 1), tol: 1e-7 * Math.abs(Hin) + 1, Hout, Qpc, HgasB };
  };
  let T, bound = 0, r;
  if (Tfix != null) { T = Tfix; r = evalAt(T); }
  else { const s = solveT(evalAt, Tguess, TMIN, TMAX); T = s.T; r = s.res; bound = s.bound; if (eq.T !== T) r = evalAt(T); }
  /* what leaves the stage as gas (and fume), and what stays as bath */
  const gasOut = new Float64Array(NS), bath = new Float64Array(NS);
  for (let i = 0; i < NS; i++) { if (SP[i].phase === 'gas') gasOut[i] = eq.n[i]; else bath[i] = eq.n[i]; }
  if (eqB) { gasOut.fill(0); for (let i = 0; i < NS; i++) gasOut[i] = eqB.n[i]; }
  const pcLost = (1 - hte) * r.Qpc;
  if (eq) eq.eqB = eqB;
  return { eq, eqB, T, loss, pcLost, gasOut, bath, bound, b,
    surplus: Hin + HinPc - enthalpy(bath, T) - enthalpy(gasOut, T) - loss - pcLost,
    converged: eq.converged && (!eqB || eqB.converged) };
}

/* heat balance items (J). Positive values are heat sources, negative values are heat sinks. */
const GROUP_NAMES = { fuel: 'Coal oxidation (C, H, S)', Al: 'Aluminium oxidation', Zn: 'ZnO reduction and Zn vaporisation',
  Pb: 'PbO reduction and Pb vaporisation', Fe: 'Iron oxide redox', Si: 'Silica reduction' };
function sensibleOf(n, T, phase) { let h = 0; for (let i = 0; i < NS; i++) if (n[i] !== 0 && (!phase || SP[i].phase === phase)) h += n[i] * (hSp(i, T) - hSp(i, T0)); return h; }
function balanceItems(inList, gOut, sens, loss, meltJ, pcLost) {
  const items = [], gIn = {};
  inList.forEach(s => {
    for (const k in s.g298) gIn[k] = (gIn[k] || 0) + s.g298[k];
    if (Math.abs(s.sens) > 0) items.push({ key: 'sens:' + s.name, label: 'Sensible heat, ' + s.name.toLowerCase(), val: s.sens, kind: 'sens' });
  });
  GROUPS.forEach(gk => { const v = (gIn[gk] || 0) - (gOut[gk] || 0); if (Math.abs(v) > 1) items.push({ key: 'chem:' + gk, label: GROUP_NAMES[gk], val: v, kind: 'chem' }); });
  if (Math.abs(meltJ) > 0) items.push({ key: 'melt', label: 'Melting of cold charge', val: meltJ, kind: 'chem' });
  items.push({ key: 'out:slag', label: 'Sensible heat, product slag', val: -sens.slag, kind: 'sens' });
  items.push({ key: 'out:gas', label: 'Sensible heat, off-gas', val: -sens.gas, kind: 'sens' });
  if (Math.abs(sens.pure) > 0) items.push({ key: 'out:solids', label: 'Sensible heat, metal and solids', val: -sens.pure, kind: 'sens' });
  if (pcLost) items.push({ key: 'pc', label: 'Post-combustion heat not returned to bath', val: -pcLost, kind: 'loss' });
  if (loss !== 0) items.push({ key: 'loss', label: 'Heat loss to cooling', val: -loss, kind: 'loss' });
  return items;
}

function kpis(feeds, basisH, znIn, pbIn, znGas, pbGas, inp, slagTonnes) {
  const cTot = feeds.coal.info.nCtotal * basisH;
  return {
    znRec: znIn > 0 ? 100 * znGas / znIn : NaN, pbRec: pbIn > 0 ? 100 * pbGas / pbIn : NaN,
    znFumed: znGas * AW.Zn / 1000, co2: cTot * 44.009 / 1000, co2PerT: slagTonnes > 0 ? cTot * 44.009 / 1000 / slagTonnes : NaN,
    co2PerZn: znGas > 0 ? cTot * 44.009 / (znGas * AW.Zn) : NaN
  };
}

function gasFractions(nGas) {
  let tot = 0; SP.forEach((sp, i) => { if (sp.phase === 'gas') tot += nGas[i]; });
  const o = {}; SP.forEach((sp, i) => { if (sp.phase === 'gas') o[sp.id] = tot > 0 ? nGas[i] / tot : 0; });
  return { x: o, mol: tot };
}
function fumeKg(nGas) { return { ZnO: nGas[SI.ZnO] * SP[SI.ZnO].M / 1000, PbO: nGas[SI.PbO] * SP[SI.PbO].M / 1000 }; }
function volatilised(st) { const n = st.eq.n; return { zn: n[SI['Zn(g)']], pb: n[SI['Pb(g)']] + n[SI['PbO(g)']] + n[SI['PbS(g)']] }; }

/* Continuous, well-mixed stage: off-gas and product slag leave in mutual equilibrium. Basis one hour. */
function runContinuous(inp, warm) {
  const feeds = buildFeeds(inp);
  const Tfix = inp.thermal === 'fixed' ? inp.op.T + 273.15 : null;
  const st = stage(null, 0, feeds, 1, inp, Tfix, inp.op.T + 273.15, warm);
  const inList = [feeds.hot, feeds.cld, feeds.coal, feeds.al, feeds.bl];
  const gOut = groupH298(st.gasOut, groupH298(st.bath, {}));
  const items = balanceItems(inList, gOut, { slag: sensibleOf(st.bath, st.T, 'slag'), gas: sensibleOf(st.gasOut, st.T), pure: sensibleOf(st.bath, st.T, 'pure') }, st.loss, feeds.cld.melt, st.pcLost);
  const d = describe(st.eq, inp.op.P * 1.01325);
  const znIn = feeds.hot.b[EI.Zn] + feeds.cld.b[EI.Zn], pbIn = feeds.hot.b[EI.Pb] + feeds.cld.b[EI.Pb];
  const v = volatilised(st);
  const k = kpis(feeds, 1, znIn, pbIn, v.zn, v.pb, inp, inp.slag.rate);
  const off = st.eqB ? gasFractions(st.gasOut) : null;
  return { mode: 'cont', feeds, eq: st.eq, T: st.T, bound: st.bound, items, surplus: st.surplus, basisH: 1, d, k,
    warn: feeds.warn.slice(), converged: st.converged, Gmin: st.eq.G, gasOut: st.gasOut, offgas: off, fume: fumeKg(st.gasOut) };
}

/* Batch cycle: the bath is brought to equilibrium with each increment of blast and reductant; the gas then leaves. */
function runBatch(inp) {
  const feeds = buildFeeds(inp);
  const total = Math.max(inp.batch.time, 1) / 60, steps = Math.max(1, Math.min(600, Math.round(inp.batch.time / Math.max(inp.batch.dt, 0.1))));
  const dt = total / steps;
  /* cold charge is fed evenly over the cycle: convert the batch amount to an hourly rate */
  const cldRate = { name: feeds.cld.name, b: feeds.cld.b.map(v => v / total), H: feeds.cld.H / total, sens: 0, g298: {}, melt: feeds.cld.melt / total };
  const f2 = { coal: feeds.coal, al: feeds.al, bl: feeds.bl, cld: cldRate, hot: feeds.hot };
  const fixed = inp.thermal === 'fixed';
  let T = fixed ? inp.op.T + 273.15 : inp.slag.T + 273.15;
  let nBath = Float64Array.from(feeds.hot.n), Hbath = feeds.hot.H;
  const P = inp.op.P * 1.01325;
  const gasCum = new Float64Array(NS), bathGasCum = new Float64Array(NS);
  const series = []; let surplusCum = 0, lossCum = 0, pcCum = 0, sensGas = 0, warm = null, allConv = true, bound = 0, znCum = 0, pbCum = 0;
  const m0 = massOf(nBath, 'slag');
  series.push({ t: 0, T, Zn: 100 * nBath[SI.ZnO] * AW.Zn / 1000 / m0, Pb: 100 * nBath[SI.PbO] * AW.Pb / 1000 / m0,
    fe3: nBath[SI['FeO1.5']] / Math.max(nBath[SI.FeO] + nBath[SI['FeO1.5']], 1e-300), rate: NaN, pO2: NaN, coco2: NaN, q: NaN, feMet: 0, slagMass: m0, pZn: NaN, rec: 0 });
  const znIn = feeds.hot.b[EI.Zn] + feeds.cld.b[EI.Zn], pbIn = feeds.hot.b[EI.Pb] + feeds.cld.b[EI.Pb];
  let last = null;
  for (let s = 0; s < steps; s++) {
    const st = stage(nBath, Hbath, f2, dt, inp, fixed ? T : null, T, warm);
    warm = st.eq.converged ? st.eq : null; allConv = allConv && st.converged; if (st.bound) bound = st.bound;
    T = st.T;
    for (let i = 0; i < NS; i++) { gasCum[i] += st.gasOut[i]; if (SP[i].phase === 'gas') bathGasCum[i] += st.eq.n[i]; }
    sensGas += sensibleOf(st.gasOut, T);
    const d = describe(st.eq, P), v = volatilised(st);
    znCum += v.zn; pbCum += v.pb;
    surplusCum += st.surplus; lossCum += st.loss; pcCum += st.pcLost;
    series.push({ t: (s + 1) * dt * 60, T, Zn: d.el.Zn, Pb: d.el.Pb, fe3: d.fe3, rate: v.zn * AW.Zn / 1000 / (dt * 60),
      pO2: d.pO2, coco2: d.coco2, q: st.surplus / (dt * 3600) / 1e6, feMet: d.solids.Fe, slagMass: d.slagMass, pZn: d.pZn, rec: znIn > 0 ? 100 * znCum / znIn : 0 });
    nBath = st.bath; Hbath = enthalpy(nBath, T); last = { st, d };
  }
  const inList = [feeds.hot, feeds.cld, scaleStream(feeds.coal, total), scaleStream(feeds.al, total), scaleStream(feeds.bl, total)];
  const gOut = groupH298(gasCum, groupH298(nBath, {}));
  const items = balanceItems(inList, gOut, { slag: sensibleOf(nBath, T, 'slag'), gas: sensGas, pure: sensibleOf(nBath, T, 'pure') }, lossCum, feeds.cld.melt, pcCum);
  const d = last.d;
  const bg = gasFractions(bathGasCum); d.gas = bg.x; d.gasMol = bg.mol;
  const fpc = (inp.blast.pc || 0) > 0;
  const k = kpis(feeds, total, znIn, pbIn, znCum, pbCum, inp, inp.slag.rate);
  return { mode: 'batch', feeds, eq: last.st.eq, T, bound, items, surplus: surplusCum, basisH: total, d, k, series,
    warn: feeds.warn.slice(), converged: allConv, Gmin: last.st.eq.G, gasOut: gasCum, offgas: fpc ? gasFractions(gasCum) : null, fume: fumeKg(gasCum), steps, dtMin: dt * 60 };
}
function scaleStream(s, f) { const o = { name: s.name, sens: s.sens * f, g298: {}, H: s.H * f, b: s.b.map(v => v * f), mass: s.mass * f, melt: 0 }; for (const k in s.g298) o.g298[k] = s.g298[k] * f; return o; }

function run(inp) { return inp.mode === 'batch' ? runBatch(inp) : runContinuous(inp); }

/* standard reaction properties at T: list of [coefficient, thermo key, factor] */
const REACTIONS = [
  { eq: 'ZnO(s) + CO = Zn(g) + CO2', t: [[-1, 'ZnO(s)'], [-1, 'CO(g)'], [1, 'Zn(g)'], [1, 'CO2(g)']] },
  { eq: 'ZnO(s) + C = Zn(g) + CO', t: [[-1, 'ZnO(s)'], [-1, 'C(gr)'], [1, 'Zn(g)'], [1, 'CO(g)']] },
  { eq: 'ZnO(s) + H2 = Zn(g) + H2O', t: [[-1, 'ZnO(s)'], [-1, 'H2(g)'], [1, 'Zn(g)'], [1, 'H2O(g)']] },
  { eq: '3 ZnO(s) + 2 Al(l) = 3 Zn(g) + Al2O3(s)', t: [[-3, 'ZnO(s)'], [-2, 'Al'], [3, 'Zn(g)'], [1, 'Al2O3(s)']] },
  { eq: 'FeO(l) + CO = Fe + CO2', t: [[-1, 'FeO(l)'], [-1, 'CO(g)'], [1, 'Fe'], [1, 'CO2(g)']] },
  { eq: '3 FeO(l) + 2 Al(l) = 3 Fe + Al2O3(s)', t: [[-3, 'FeO(l)'], [-2, 'Al'], [3, 'Fe'], [1, 'Al2O3(s)']] },
  { eq: 'Fe2O3(s) + CO = 2 FeO(l) + CO2', t: [[-1, 'Fe2O3(s)'], [-1, 'CO(g)'], [2, 'FeO(l)'], [1, 'CO2(g)']] },
  { eq: 'PbO(l) + CO = Pb(g) + CO2', t: [[-1, 'PbO(l)'], [-1, 'CO(g)'], [1, 'Pb(g)'], [1, 'CO2(g)']] },
  { eq: 'C + CO2 = 2 CO', t: [[-1, 'C(gr)'], [-1, 'CO2(g)'], [2, 'CO(g)']] },
  { eq: 'C + O2 = CO2', t: [[-1, 'C(gr)'], [-1, 'O2(g)'], [1, 'CO2(g)']] },
  { eq: '2 Al(l) + 1.5 O2 = Al2O3(s)', t: [[-2, 'Al'], [-1.5, 'O2(g)'], [1, 'Al2O3(s)']] }
];
function reactionTable(T) {
  return REACTIONS.map(r => {
    let dH = 0, dS = 0; r.t.forEach(x => { const p = props(x[1], T); dH += x[0] * p[0]; dS += x[0] * p[1]; });
    const dG = dH - T * dS;
    return { eq: r.eq, dH: dH / 1000, dG: dG / 1000, logK: -dG / (R * T) / Math.LN10 };
  });
}

const FumeEngine = { R, T0, AW, ELS, EI, SP, SI, NS, NE, MOX, props, spProps, equilibrate, enthalpy, heatCap, buildFeeds, slagPerKg,
  hhvEstimate, describe, runContinuous, runBatch, run, reactionTable, elemOf, massOf, TMIN, TMAX, NM3 };
