/* Randomised equilibrium cases over a wide input range. Every case must converge and satisfy the optimality conditions.
   Usage: node tests/random_cases.js [N=20000] [seed=12345] [share of cases without coal or blast=0.15] */
const { E, base, gamOf, elements, kkt } = require('./common.js');
const N = +process.argv[2] || 20000; let seed = +process.argv[3] || 12345; const pz = process.argv[4] ? +process.argv[4] : 0.15;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const U = (a, b) => a + (b - a) * rnd();
let fail = 0, maxIt = 0, sumIt = 0, worst = 0;
for (let c = 0; c < N; c++) {
  const inp = base();
  inp.slag = { rate: U(5, 60), T: 1250, cold: 0, Zn: U(0, 20), Pb: rnd() < 0.2 ? 0 : U(0, 5), Fe: U(10, 40), fe3: U(0, 60), SiO2: U(10, 35), CaO: U(0, 20), Al2O3: U(0, 10), MgO: U(0, 5) };
  inp.coal = { rate: rnd() < pz ? 0 : U(0, 8000), C: U(50, 90), H: U(0, 6), O: U(0, 15), N: U(0, 2), S: rnd() < 0.3 ? 0 : U(0, 3), ash: U(0, 20), moist: U(0, 15), hhvAuto: true, hhv: 30, bypass: 0 };
  inp.al = { rate: rnd() < 0.4 ? 0 : U(0, 6000), metal: U(30, 100) };
  inp.blast = { rate: rnd() < pz ? 0 : U(0, 60000), o2: U(21, 100), T: 25, pc: 0, hte: 100 };
  inp.op = { T: U(1000, 1700), loss: 6, P: U(0.5, 3) };
  inp.gam = { ZnO: U(0.3, 5), PbO: U(0.1, 3), FeO: U(0.3, 4), FeO15: U(0.3, 5) };
  const b = elements(inp), gam = gamOf(inp);
  const eq = E.equilibrate(b, inp.op.T + 273.15, inp.op.P * 1.01325, gam, null), k = kkt(eq, b, gam);
  maxIt = Math.max(maxIt, eq.iters); sumIt += eq.iters; if (eq.converged) worst = Math.max(worst, k.stat);
  if (!eq.converged || k.stat > 1e-6 || k.elem > 1e-9 || k.bad) { fail++; if (fail <= 5) console.log('FAIL case', c, JSON.stringify(inp)); }
}
console.log('cases', N, ' failures', fail, ' mean iterations', (sumIt / N).toFixed(1), ' max iterations', maxIt, ' worst stationarity', worst.toExponential(1));
process.exit(fail ? 1 : 0);
