// For verify_cantera.py: per case, the engine's h, s, cp of every species at T, the element amounts and the engine's solution
const { E, base, gamOf, elements } = require('./common.js');
const cases = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'cases.json'), 'utf8')).cases;
const out = cases.map(c => {
  const sp = E.SP.map((s, i) => { const p = E.spProps(i, c.T); return { id: s.id, phase: s.phase, comp: s.comp, h: p[0], s: p[1], cp: p[2] }; });
  const eq = E.equilibrate(Float64Array.from(c.b), c.T, c.P, c.gam, null);
  return { name: c.name, T: c.T, P: c.P, gam: c.gam, b: c.b, sp, n: Array.from(eq.n), G: eq.G };
});
console.log(JSON.stringify({ els: E.ELS, out }));
