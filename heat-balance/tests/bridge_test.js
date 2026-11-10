/* End-to-end test of tools/thermo_bridge.py through HTTP, as the page uses it.
   TDB backend (pycalphad): standard states and slag activity coefficients against closed-form answers.
   Cantera backend: data of Cantera's own NASA file and an ideal-condensed slag phase.
   JSON backend: a data set with a temperature table of activity coefficients.
   Usage: node tests/bridge_test.js   (needs python3 with pycalphad and cantera) */
const fs = require('fs'), path = require('path'), { spawn, execSync } = require('child_process');
const E = require('./load_engine.js'), DB = require('../src/dbio.js');
const D = path.join(__dirname, 'data'), BR = path.join(__dirname, '..', 'tools', 'thermo_bridge.py');
let fail = 0; const R = E.R;
const line = (ok, tag, txt) => { if (!ok) fail++; console.log((ok ? 'ok   ' : 'FAIL ') + tag.padEnd(48), txt); };

/* synthetic TDB (one command per line, as pycalphad's reader expects): ZnO as zincite (closed form of the built-in heat capacity), a substitutional slag of FEO, ZNO, SIO2 with regular interactions */
const a = 45.338, b = 7.289e-3, c = -5.732e5, H = -350460, S = 43.65, T0 = 298.15;
const A = H - a * T0 - b / 2 * T0 * T0 + c / T0, B = a * (Math.log(T0) + 1) + b * T0 - c / (2 * T0 * T0) - S, C = -a, Dd = -b / 2, Ee = -c / 2;
const f = x => (x >= 0 ? '+' : '') + x.toPrecision(15);
const W = { FZ: -10000, FS: -30000, ZS: -15000 }, dZ = [20000, -8];
const tdb = `ELEMENT /-   ELECTRON_GAS 0 0 0 !
ELEMENT VA   VACUUM 0 0 0 !
ELEMENT FE   BCC_A2 55.845 4489 27.28 !
ELEMENT O    1/2_MOLE_O2(G) 15.999 4341 102.57 !
ELEMENT SI   DIAMOND_A4 28.085 3217 18.81 !
ELEMENT ZN   HCP_ZN 65.38 5657 41.63 !
SPECIES FEO FE1O1 !
SPECIES ZNO ZN1O1 !
SPECIES SIO2 SI1O2 !
TYPE_DEFINITION % SEQ * !
FUNCTION GZNO 298.15 ${f(A)}${f(B)}*T${f(C)}*T*LN(T)${f(Dd)}*T**2${f(Ee)}*T**(-1); 6000 N !
PHASE ZINCITE % 2 1 1 !
CONSTITUENT ZINCITE :ZN:O: !
PARAMETER G(ZINCITE,ZN:O;0) 298.15 +GZNO#; 6000 N !
PHASE SLAG % 1 1.0 !
CONSTITUENT SLAG :FEO,SIO2,ZNO: !
PARAMETER G(SLAG,ZNO;0) 298.15 +GZNO#${f(dZ[0])}${f(dZ[1])}*T; 6000 N !
PARAMETER G(SLAG,FEO;0) 298.15 -330000+140*T-50*T*LN(T); 6000 N !
PARAMETER G(SLAG,SIO2;0) 298.15 -940000+400*T-85*T*LN(T); 6000 N !
PARAMETER L(SLAG,FEO,ZNO;0) 298.15 ${W.FZ}; 6000 N !
PARAMETER L(SLAG,FEO,SIO2;0) 298.15 ${W.FS}; 6000 N !
PARAMETER L(SLAG,SIO2,ZNO;0) 298.15 ${W.ZS}; 6000 N !
`;
fs.writeFileSync(path.join(D, 'bridge.tdb'), tdb);
fs.writeFileSync(path.join(D, 'bridge_map.json'), JSON.stringify({
  species: { 'ZnO(s)': { phase: 'ZINCITE' }, 'FeO(l)': { phase: 'SLAG', endmember: [['FEO']] }, 'SiO2(l)': { phase: 'SLAG', endmember: [['SIO2']] } },
  slag: { phase: 'SLAG', oxides: { ZnO: { std: 'ZnO(s)', factor: 1 }, FeO: { std: 'FeO(l)', factor: 1 }, SiO2: { std: 'SiO2(l)', factor: 1 } } } }, null, 1));

function serve(args, port) {
  return new Promise((res, rej) => {
    const p = spawn('python3', [BR].concat(args, ['--port', String(port)]), { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; p.stderr.on('data', d => { err += d; });
    p.stdout.on('data', d => { if (/Serving/.test(String(d))) res(p); });
    p.on('exit', code => rej(new Error('server exited ' + code + ': ' + err.slice(-400))));
    setTimeout(() => rej(new Error('server did not start: ' + err.slice(-400))), 60000);
  });
}
const get = (port, p) => fetch('http://127.0.0.1:' + port + p).then(r => r.json());
const post = (port, p, body) => fetch('http://127.0.0.1:' + port + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

(async () => {
  /* ---- 1. TDB through pycalphad ---- */
  let srv = await serve(['--tdb', path.join(D, 'bridge.tdb'), '--map', path.join(D, 'bridge_map.json')], 8791);
  try {
    const info = await get(8791, '/info');
    line(info.backend === 'pycalphad' && info.activity && info.species.length === 3, 'TDB: /info', info.species.map(s => s.name + ' ' + JSON.stringify(s.composition)).join(', '));
    const sp = await post(8791, '/species', { names: ['ZnO(s)', 'FeO(l)'], Tmin: 700, Tmax: 2500, dT: 10 });
    const r = DB.parse(JSON.stringify(sp), 'server.json'), z = r.species.find(s => s.name === 'ZnO(s)');
    let w = 0; for (const T of [800, 1234.5, 1523.15, 2000]) { const p = E.builtinProps('ZnO(s)', T), q = E.evalRecord(z.record, T); w = Math.max(w, Math.abs(p[0] - q[0]), T * Math.abs(p[1] - q[1])); }
    line(w < 0.05, 'TDB: ZnO(s) from zincite vs built-in', 'largest |dh| or |T ds| = ' + w.toExponential(1) + ' J/mol (tabulated every 10 K)');
    const fe = r.species.find(s => s.name === 'FeO(l)'), T = 1523.15, gF = E.evalRecord(fe.record, T), gFe = gF[0] - T * gF[1], exF = -330000 + 140 * T - 50 * T * Math.log(T);
    line(Math.abs(gFe - exF) < 1, 'TDB: end member FeO of the slag phase', 'G = ' + gFe.toFixed(2) + ' J/mol, expected ' + exF.toFixed(2));
    const moles = { FeO: 0.6, ZnO: 0.1, SiO2: 0.3, CaO: 0.1 };
    const ac = await post(8791, '/activity', { T, P: 101325, moles });
    const x = { F: 0.6, Z: 0.1, S: 0.3 }, GE = W.FZ * x.F * x.Z + W.FS * x.F * x.S + W.ZS * x.Z * x.S;
    const gZ = Math.exp((dZ[0] + dZ[1] * T) / (R * T)) * Math.exp((W.FZ * x.F + W.ZS * x.S - GE) / (R * T));
    const gFeO = Math.exp((W.FZ * x.Z + W.FS * x.S - GE) / (R * T));
    /* pycalphad converges chemical potentials to about 0.1 J/mol, i.e. about 1e-5 in gamma */
    const eZ = Math.abs(ac.gamma.ZnO / gZ - 1), eF = Math.abs(ac.gamma.FeO / gFeO - 1);
    line(eZ < 1e-4 && eF < 1e-4 && ac.ignored.join() === 'CaO', 'TDB: slag activity coefficients (pycalphad)',
      'ZnO ' + ac.gamma.ZnO.toFixed(5) + ' (analytic ' + gZ.toFixed(5) + ', rel. error ' + eZ.toExponential(1) + '), FeO ' + ac.gamma.FeO.toFixed(5) + ' (analytic ' + gFeO.toFixed(5) + ', ' + eF.toExponential(1) + '), ignored: ' + ac.ignored.join(','));
  } catch (e) { line(false, 'TDB backend', e.message); } finally { srv.kill(); }

  /* ---- 2. Cantera: the NASA file shipped with Cantera, and a slag phase for activities ---- */
  const dir = execSync('python3 -c "import cantera,os;print(os.path.join(os.path.dirname(cantera.__file__),\'data\'))"').toString().trim();
  srv = await serve(['--cantera', path.join(dir, 'nasa_condensed.yaml')], 8792);
  try {
    const info = await get(8792, '/info');
    const sp = await post(8792, '/species', { names: ['CaO(s)', 'Fe3O4(s)'], Tmin: 700, Tmax: 2500, dT: 10 });
    const r = DB.parse(JSON.stringify(sp), 's.json'); let w = 0;
    for (const [k, n] of [['CaO(s)', 'CaO(s)'], ['Fe3O4(s)', 'Fe3O4(s)']]) { const s = r.species.find(q => q.name === n); for (const T of [800, 1523.15, 2100]) { const p = E.builtinProps(k, T), q = E.evalRecord(s.record, T); w = Math.max(w, Math.abs(p[0] - q[0]), T * Math.abs(p[1] - q[1])); } }
    line(w < 0.05 && /not declared/.test(info.note || ''), 'Cantera: NASA condensed data, 1 bar assumed', 'largest difference ' + w.toExponential(1) + ' J/mol; note shown: ' + info.note);
  } catch (e) { line(false, 'Cantera backend', e.message); } finally { srv.kill(); }
  const Tz = 1523.15, pz = E.builtinProps('ZnO(s)', Tz);
  const yml = `units: {length: m, quantity: mol, activation-energy: J/mol}
phases:
- name: slag
  thermo: ideal-condensed
  standard-concentration-basis: unity
  elements: [Zn, Fe, O]
  species: [ZNO_L, FEO_L]
species:
- name: ZnO_s
  composition: {Zn: 1, O: 1}
  thermo: {model: constant-cp, T0: ${Tz} K, h0: ${pz[0]} J/mol, s0: ${pz[1]} J/mol/K, cp0: ${pz[2]} J/mol/K, reference-pressure: 1 bar}
  equation-of-state: {model: constant-volume, molar-volume: 0.0145 m^3/kmol}
- name: ZNO_L
  composition: {Zn: 1, O: 1}
  thermo: {model: constant-cp, T0: ${Tz} K, h0: ${pz[0] + 25000} J/mol, s0: ${pz[1] + 10} J/mol/K, cp0: ${pz[2]} J/mol/K, reference-pressure: 1 bar}
  equation-of-state: {model: constant-volume, molar-volume: 0.0145 m^3/kmol}
- name: FEO_L
  composition: {Fe: 1, O: 1}
  thermo: {model: constant-cp, T0: ${Tz} K, h0: -250000 J/mol, s0: 80 J/mol/K, cp0: 68 J/mol/K, reference-pressure: 1 bar}
  equation-of-state: {model: constant-volume, molar-volume: 0.016 m^3/kmol}
`;
  fs.writeFileSync(path.join(D, 'slag_ideal.yaml'), yml);
  fs.writeFileSync(path.join(D, 'slag_ideal_map.json'), JSON.stringify({ species: { 'ZnO(s)': { species: 'ZnO_s' } }, slag: { phase: 'slag', oxides: { ZnO: { std: 'ZnO(s)' }, FeO: { std: 'FEO_L' } }, species: { ZnO: 'ZNO_L', FeO: 'FEO_L' } } }));
  srv = await serve(['--cantera', path.join(D, 'slag_ideal.yaml'), '--slag-phase', 'slag', '--map', path.join(D, 'slag_ideal_map.json')], 8793);
  try {
    const ac = await post(8793, '/activity', { T: Tz, P: 1e5, moles: { FeO: 0.8, ZnO: 0.2 } });
    const ex = Math.exp((25000 - Tz * 10) / (R * Tz));
    line(Math.abs(ac.gamma.ZnO / ex - 1) < 1e-6, 'Cantera: activity from an ideal-condensed slag phase', 'gamma ZnO ' + ac.gamma.ZnO.toFixed(6) + ', expected ' + ex.toFixed(6));
  } catch (e) { line(false, 'Cantera activity', e.message); } finally { srv.kill(); }

  /* ---- 3. JSON data set with a temperature table of activity coefficients ---- */
  const js = { format: 'fuming-thermo-1', species: [{ name: 'ZnO(s)', composition: { Zn: 1, O: 1 }, model: 'mk', H298: -350460, S298: 43.65, mk: [45.338, 7.289e-3, -5.732e5] }],
    activity: { table: { ZnO: { T: [1373.15, 1673.15], gamma: [2.6, 1.7] } } } };
  fs.writeFileSync(path.join(D, 'set_with_gamma.json'), JSON.stringify(js));
  srv = await serve(['--json', path.join(D, 'set_with_gamma.json')], 8794);
  try {
    const ac = await post(8794, '/activity', { T: 1523.15, P: 101325, moles: { ZnO: 1 } });
    const m = E.activityModel({ mode: 'const', g: {}, table: { ZnO: { T: [1373.15, 1673.15], g: [2.6, 1.7] } } }), ex = Math.exp(m.lng('ZnO', 1523.15));
    const sp = await post(8794, '/species', { names: ['ZnO(s)'] }), r = DB.parse(JSON.stringify(sp), 'x.json');
    line(Math.abs(ac.gamma.ZnO - ex) < 1e-9 && r.species.length === 1, 'JSON: activity table and species record', 'gamma ZnO at 1250 C ' + ac.gamma.ZnO.toFixed(6) + ' (engine ' + ex.toFixed(6) + ')');
  } catch (e) { line(false, 'JSON backend', e.message); } finally { srv.kill(); }

  /* ---- 4. CORS preflight answer that browsers need to reach 127.0.0.1 from a web page ---- */
  srv = await serve(['--json', path.join(D, 'set_with_gamma.json')], 8795);
  try {
    const r = await fetch('http://127.0.0.1:8795/activity', { method: 'OPTIONS' });
    line(r.headers.get('access-control-allow-origin') === '*' && r.headers.get('access-control-allow-private-network') === 'true', 'CORS and private-network preflight', 'status ' + r.status);
  } catch (e) { line(false, 'preflight', e.message); } finally { srv.kill(); }
  console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
