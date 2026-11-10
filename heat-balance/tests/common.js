/* Shared helpers: a base case and a check of the optimality (KKT) conditions of a solution. */
const E = require('./load_engine.js');

const base = () => ({
  mode: 'cont', thermal: 'fixed',
  slag: { rate: 30, T: 1250, cold: 0, Zn: 12, Pb: 1.5, Fe: 28, fe3: 10, SiO2: 26, CaO: 14, Al2O3: 5, MgO: 2 },
  coal: { rate: 3300, C: 75, H: 4.5, O: 7, N: 1.5, S: 0.8, ash: 11.2, moist: 2, hhvAuto: true, hhv: 30, bypass: 0 },
  al: { rate: 0, metal: 95 }, blast: { rate: 20000, o2: 21, T: 25, pc: 0, hte: 100 }, op: { T: 1250, loss: 6, P: 1 },
  gam: { ZnO: 2.0, PbO: 0.3, FeO: 1.0, FeO15: 1.5 }, batch: { time: 120, dt: 2 }
});
const gamOf = inp => ({ ZnO: inp.gam.ZnO, PbO: inp.gam.PbO, FeO: inp.gam.FeO, 'FeO1.5': inp.gam.FeO15 });
function elements(inp) {
  const f = E.buildFeeds(inp), b = new Float64Array(E.NE);
  [f.hot, f.cld, f.coal, f.al, f.bl].forEach(s => { for (let k = 0; k < E.NE; k++) b[k] += s.b[k]; });
  return b;
}
/* gam: activity model or map of constant gammas.
   stat: largest |mu_i/RT - sum_j a_ij pi_j| over species present; elem: element balance error relative to total moles;
   bad: number of absent pure phases that would lower G by forming */
function kkt(eq, b, gam) {
  const T = eq.T, P = eq.P, act = E.activityModel(gam); let stat = 0, bad = 0;
  E.SP.forEach((s, i) => {
    const p = E.spProps(i, T, false, act); let g = (p[0] - T * p[1]) / (E.R * T), ap = 0;
    for (let k = 0; k < E.NE; k++) if (s.a[k]) ap += s.a[k] * eq.pi[k];
    if (isNaN(ap)) return;
    if (s.phase === 'gas') { if (eq.noGas) return; g += Math.log(P) + Math.log(eq.n[i] / eq.phaseMol.gas); }
    else if (s.phase === 'slag') g += Math.log(eq.n[i] / eq.phaseMol.slag); // ln gamma is inside spProps
    else if (eq.n[i] === 0) { if (g - ap < -1e-7) bad++; return; }
    if (eq.n[i] > 1e-200) stat = Math.max(stat, Math.abs(g - ap));
  });
  const bb = E.elemOf(eq.n); let elem = 0, bt = 0;
  for (let k = 0; k < E.NE; k++) bt += b[k];
  for (let k = 0; k < E.NE; k++) elem = Math.max(elem, Math.abs(bb[k] - b[k]) / bt);
  return { stat, elem, bad };
}
module.exports = { E, base, gamOf, elements, kkt };
