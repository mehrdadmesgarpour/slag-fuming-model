/* Furnace cell model (every cell solved in every step): conservation of elements and energy, agreement with the
   well-mixed batch model when the grid is reduced to two identical cells without circulation or hydrostatic pressure,
   and the inspector's cold-start solve against the stepped solution.
   Usage: node tests/cell_model.js */
const { E, base } = require('./common.js');
const mk = (mod) => { const i = base(); i.mode = 'batch'; i.thermal = 'auto'; i.slag.rate = 50; i.coal.rate = 3000; i.al.rate = 300; i.blast.rate = 18000; i.batch.time = 120; i.batch.dt = 2; if (mod) mod(i); return i; };
let fail = 0;
function runSim(inp, cfg) { const t0 = Date.now(); const sim = E.createCellModel(inp, cfg); while (sim.step()) {} return { sim, ms: Date.now() - t0 }; }
const line = (ok, tag, txt) => { if (!ok) fail++; console.log((ok ? 'ok   ' : 'FAIL ') + tag.padEnd(34), txt); };

/* 1. two cells, no circulation, no depth: must reproduce the batch model */
for (const thermal of ['auto', 'fixed']) {
  const inp = mk(i => { i.thermal = thermal; }), rb = E.run(inp);
  const { sim } = runSim(inp, { nx: 2, ny: 1, tau: 0, spread: 0, depth: 0, entrain: 0 });
  const s = sim.summary(), a = sim.audit();
  const dRec = Math.abs(s.znRec - rb.k.znRec), dT = Math.abs(s.bulk.Tavg - (rb.T - 273.15));
  line(dRec < 1e-3 && dT < 0.05 && s.converged, 'two cells vs batch, ' + thermal, 'Zn recovery ' + s.znRec.toFixed(4) + ' vs ' + rb.k.znRec.toFixed(4) + ' %, T ' + s.bulk.Tavg.toFixed(2) + ' vs ' + (rb.T - 273.15).toFixed(2) + ' C, elements ' + a.elements.toExponential(1));
}
/* 2. conservation on full grids */
const cfgs = [
  ['8 x 5 default', mk(), { nx: 8, ny: 5, tau: 3, spread: 25, depth: 1, entrain: 0 }],
  ['8 x 5 fixed T', mk(i => { i.thermal = 'fixed'; }), { nx: 8, ny: 5, tau: 3, spread: 25, depth: 1, entrain: 0 }],
  ['6 x 4, coal entrained 30 %', mk(), { nx: 6, ny: 4, tau: 2, spread: 30, depth: 1.2, entrain: 30 }],
  ['8 x 5, Al on the left only', mk(i => { i.al.rate = 600; }), { nx: 8, ny: 5, tau: 3, spread: 25, depth: 1, entrain: 0, alSide: 'left' }],
  ['12 x 6, cold charge 15 %', mk(i => { i.slag.cold = 15; }), { nx: 12, ny: 6, tau: 4, spread: 20, depth: 1, entrain: 10 }],
  ['4 x 3, Al with lean air', mk(i => { i.coal.rate = 0; i.al.rate = 1800; i.blast.rate = 8000; i.blast.o2 = 10; }), { nx: 4, ny: 3, tau: 2, spread: 25, depth: 1, entrain: 0 }]
];
for (const [tag, inp, cfg] of cfgs) {
  const { sim, ms } = runSim(inp, cfg), s = sim.summary(), a = sim.audit();
  const ok = s.converged && a.elements < 1e-10 && a.energy < 1e-10;
  line(ok, tag, 'steps ' + sim.steps + ' (dt ' + sim.dt.toFixed(1) + ' s), ' + s.solves + ' Gibbs solves in ' + ms + ' ms | Zn recovery ' + s.znRec.toFixed(1) + ' %, bath Zn ' + s.bulk.Zn.toFixed(2) + ' wt%, T ' + s.bulk.Tmin.toFixed(0) + ' to ' + s.bulk.Tmax.toFixed(0) + ' C | elements ' + a.elements.toExponential(1) + ', energy ' + a.energy.toExponential(1) + (s.bound ? ' | T limit hit' : ''));
}
/* 3. the inspector reproduces the stepped solution of a cell */
{
  const { sim } = runSim(mk(), { nx: 8, ny: 5, tau: 3, spread: 25, depth: 1, entrain: 0 });
  const fi = Math.floor(sim.frames.length / 2); let worst = 0, its = 0;
  for (let c = 0; c < sim.N; c++) { const q = sim.inspect(fi, c); worst = Math.max(worst, Math.abs(q.T - 273.15 - sim.frames[fi].cells[c].T)); its = Math.max(its, q.eq.iters); if (!q.eq.converged) fail++; }
  line(worst < 0.05, 'inspector vs stepped solution', 'largest temperature difference ' + worst.toExponential(1) + ' K over ' + sim.N + ' cells, at most ' + its + ' Newton iterations from a cold start');
}
console.log(fail ? fail + ' FAILED' : 'all passed');
process.exit(fail ? 1 : 0);
