/* Thirteen hand-picked cases from oxidising to strongly over-reduced. Checks convergence and optimality,
   checks energy closure of the full model, and writes tests/cases.json for verify_scipy.py.
   Usage: node tests/stress_cases.js */
const fs = require('fs'), path = require('path');
const { E, base, gamOf, elements, kkt } = require('./common.js');
const cases = [];
const add = (name, mod) => { const inp = base(); mod(inp); cases.push([name, inp]); };
add('base', i => {});
add('reducing', i => { i.blast.rate = 13000; });
add('very reducing', i => { i.blast.rate = 6000; });
add('oxidising, no coal', i => { i.coal.rate = 0; });
add('Al 600', i => { i.al.rate = 600; i.coal.rate = 2000; i.blast.rate = 12000; });
add('Al only', i => { i.al.rate = 1500; i.coal.rate = 0; i.blast.rate = 2000; });
add('Al in large excess', i => { i.al.rate = 9000; i.coal.rate = 0; i.blast.rate = 500; });
add('no Pb, no S', i => { i.slag.Pb = 0; i.coal.S = 0; });
add('1400 C', i => { i.op.T = 1400; i.blast.rate = 15000; });
add('1100 C', i => { i.op.T = 1100; i.blast.rate = 15000; });
add('O2 enriched', i => { i.blast.o2 = 30; i.blast.rate = 11000; });
add('no blast', i => { i.blast.rate = 0; });
add('slag only', i => { i.blast.rate = 0; i.coal.rate = 0; });
const dump = []; let fail = 0;
for (const [name, inp] of cases) {
  const b = elements(inp), gam = gamOf(inp), T = inp.op.T + 273.15, P = inp.op.P * 1.01325;
  const eq = E.equilibrate(b, T, P, gam, null), k = kkt(eq, b, gam), d = E.describe(eq, P);
  const ok = eq.converged && k.stat < 1e-9 && k.elem < 1e-11 && !k.bad; if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name.padEnd(20), 'iterations', String(eq.iters).padStart(3), 'stationarity', k.stat.toExponential(1), 'elements', k.elem.toExponential(1),
    '| Zn in slag', d.el.Zn.toFixed(2), 'wt%  log pO2', Math.log10(d.pO2).toFixed(2), ' solids:', Object.entries(d.solids).filter(x => x[1] > 1e-6).map(x => x[0] + ' ' + x[1].toFixed(0) + ' kg').join(', ') || 'none');
  dump.push({ name, T, P, gam, b: Array.from(b), n: Array.from(eq.n) });
}
fs.writeFileSync(path.join(__dirname, 'cases.json'), JSON.stringify({ els: E.ELS, species: E.SP.map(s => ({ id: s.id, phase: s.phase, comp: s.comp, th: s.th, f: s.f })), cases: dump }));
/* energy closure of the full model: the heat balance items must add up to the residual */
for (const [mode, thermal] of [['cont', 'fixed'], ['cont', 'auto'], ['batch', 'fixed'], ['batch', 'auto']]) {
  const inp = base(); inp.mode = mode; inp.thermal = thermal; inp.al.rate = 300; inp.coal.rate = 3000; inp.blast.rate = 18000; if (mode === 'batch') inp.slag.rate = 50;
  const r = E.run(inp); let s = 0; r.items.forEach(it => { s += it.val; });
  const err = Math.abs(s - r.surplus) / 3.6e9, ok = r.converged && err < 1e-6; if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + (mode + ' ' + thermal).padEnd(20), 'T', (r.T - 273.15).toFixed(1), 'C  Zn recovery', r.k.znRec.toFixed(1), '%  energy closure error', err.toExponential(1), 'MW');
}
console.log(fail ? fail + ' FAILED' : 'all passed');
process.exit(fail ? 1 : 0);
