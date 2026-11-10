/* Round-trip tests of the external-data readers: built-in data are written in each format, read back,
   and must reproduce h, s and cp. Usage: node tests/dbio_tests.js (needs js-yaml for the YAML test: npm install js-yaml) */
const fs = require('fs'), path = require('path');
const E = require('./load_engine.js'), DB = require('../src/dbio.js');
try { global.jsyaml = require('js-yaml'); } catch (e) { try { global.jsyaml = require('/home/claude/fuming/mj/node_modules/js-yaml'); } catch (e2) { } }
const TH = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'thermo.json'), 'utf8'));
let fail = 0;
const Ts = [300, 650, 999, 1001, 1300, 1523.15, 1800, 2400];
function compare(tag, key, rec, tol, temps) {
  let worst = 0;
  for (const T of temps || Ts) {
    const a = E.builtinProps(key, T), b = E.evalRecord(rec, T);
    worst = Math.max(worst, Math.abs(a[0] - b[0]), T * Math.abs(a[1] - b[1]), T * Math.abs(a[2] - b[2]));
  }
  const ok = worst < tol; if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + tag.padEnd(46), 'largest |dh|, |T ds|, |T dcp| =', worst.toExponential(1), 'J/mol');
  return worst;
}
const e15 = x => { let s = x.toExponential(8).toUpperCase().replace(/E([+-])(\d)$/, 'E$10$2'); return (x < 0 ? '' : ' ') + s; }; // 15 characters
const d16 = x => { let s = x.toExponential(9).toUpperCase().replace('E', 'D').replace(/D([+-])(\d)$/, 'D$10$2'); return s.padStart(16); };

/* 1. JSON round trip of every built-in record */
{
  const keys = E.thermoKeys(); const entries = keys.map(k => ({ name: k.key, comp: k.comp, phase: k.phase, record: E.builtinRecord(k.key), src: 'built-in' }));
  const r = DB.parse(DB.toJSON(entries), 'set.json');
  let w = 0; r.species.forEach(s => { const k = keys.find(x => x.key === s.name); for (const T of Ts) { const a = E.builtinProps(k.key, T), b = E.evalRecord(s.record, T); w = Math.max(w, Math.abs(a[0] - b[0]), T * Math.abs(a[1] - b[1])); } });
  const ok = r.species.length === keys.length && w < 1e-6; if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + ('JSON, ' + r.species.length + ' records').padEnd(46), 'largest difference', w.toExponential(1), 'J/mol, FeO offset included');
}
/* 2. NASA-7 in Chemkin THERMO format */
{
  const gasKeys = Object.keys(TH).filter(k => /\(g\)$/.test(k));
  let txt = 'THERMO ALL\n   200.000  1000.000  6000.000\n';
  gasKeys.forEach(k => {
    const [lo, hi] = TH[k].segs, comp = E.thermoKeys().find(x => x.key === k).comp;
    const el = Object.keys(comp).slice(0, 4).map(e => (e.toUpperCase().padEnd(2) + String(comp[e]).padStart(3))).join('').padEnd(20);
    const head = (k.replace('(g)', '').padEnd(18) + 'TEST  ' + el + 'G' + lo[0].toFixed(3).padStart(10) + hi[1].toFixed(3).padStart(10) + lo[1].toFixed(2).padStart(8)).padEnd(79) + '1';
    const c = hi.slice(2, 9).concat(lo.slice(2, 9));
    const l2 = c.slice(0, 5).map(e15).join('').padEnd(79) + '2', l3 = c.slice(5, 10).map(e15).join('').padEnd(79) + '3', l4 = c.slice(10, 14).map(e15).join('').padEnd(79) + '4';
    txt += [head, l2, l3, l4].join('\n') + '\n';
  });
  txt += 'END\n'; fs.writeFileSync(path.join(__dirname, 'data', 'gas_nasa7.dat'), txt);
  const r = DB.parse(txt, 'gas_nasa7.dat');
  let w = 0, n = 0;
  r.species.forEach(s => { const key = s.name + '(g)'; if (!TH[key]) return; n++; for (const T of Ts) { const a = E.builtinProps(key, T), b = E.evalRecord(s.record, T); w = Math.max(w, Math.abs(a[0] - b[0]), T * Math.abs(a[1] - b[1])); }
    if (!DB.sameComp(s.comp, E.thermoKeys().find(x => x.key === key).comp) || s.phase !== 'gas') { fail++; console.log('FAIL composition or phase of', s.name); } });
  const ok = r.format === 'nasa7' && n === gasKeys.length && w < 1e-3; if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + ('NASA-7 (Chemkin), ' + n + ' gas species').padEnd(46), 'largest difference', w.toExponential(1), 'J/mol (8 significant digits in the file)');
}
/* 3. NASA-9 in CEA thermo.inp format: a NASA-7 segment written as NASA-9 with a1 = a2 = 0 */
{
  const keys = ['CO2(g)', 'Zn(g)', 'H2O(g)'];
  let txt = 'thermo\n    200.000   1000.000   6000.000  20000.000   9/09/04\n';
  keys.forEach(k => {
    const comp = E.thermoKeys().find(x => x.key === k).comp;
    txt += (k.replace('(g)', '').padEnd(24) + 'Test record').padEnd(80) + '\n';
    const f = Object.keys(comp).map(e => e.toUpperCase().padEnd(2) + comp[e].toFixed(2).padStart(6)).join('').padEnd(40);
    /* line 2: I2 intervals, A6 code in columns 4-9, formula 5(A2,F6.2) from column 11, I2 phase in 51-52, molar mass, enthalpy of formation */
    txt += (' 2 ' + 'test'.padEnd(6) + ' ' + f).slice(0, 50).padEnd(50) + ' 0' + '44.00950'.padStart(13) + '0.000'.padStart(15) + '\n';
    TH[k].segs.forEach(sg => {
      /* 2F11.3 range, I1 number of coefficients, 8F5.1 exponents, 2X, F15.3 H(298.15)-H(0) */
      txt += sg[0].toFixed(3).padStart(11) + sg[1].toFixed(3).padStart(11) + '7' + [-2, -1, 0, 1, 2, 3, 4, 0].map(x => x.toFixed(1).padStart(5)).join('') + '  ' + '0.000'.padStart(15) + '\n';
      txt += [0, 0, sg[2], sg[3], sg[4]].map(d16).join('') + '\n';
      txt += [sg[5], sg[6]].map(d16).join('') + ' '.repeat(16) + [sg[7], sg[8]].map(d16).join('') + '\n';
    });
  });
  txt += 'END PRODUCTS\nEND REACTANTS\n'; fs.writeFileSync(path.join(__dirname, 'data', 'cea_nasa9.inp'), txt);
  const r = DB.parse(txt, 'cea_nasa9.inp'); let w = 0;
  r.species.forEach(s => { const key = s.name + '(g)'; for (const T of Ts) { const a = E.builtinProps(key, T), b = E.evalRecord(s.record, T); w = Math.max(w, Math.abs(a[0] - b[0]), T * Math.abs(a[1] - b[1]), T * Math.abs(a[2] - b[2])); } });
  const ok = r.format === 'nasa9' && r.species.length === keys.length && w < 1e-4; if (!ok) { fail++; console.log(r.warnings); }
  console.log((ok ? 'ok   ' : 'FAIL ') + ('NASA-9 (CEA), ' + r.species.length + ' species').padEnd(46), 'largest difference', w.toExponential(1), 'J/mol');
}
/* 4. Cantera YAML: the real NASA data files shipped with Cantera, and a constant-cp record */
if (typeof jsyaml !== 'undefined') {
  let dir = null; try { dir = require('child_process').execSync('python3 -c "import cantera,os;print(os.path.join(os.path.dirname(cantera.__file__),\'data\'))"').toString().trim(); } catch (e) { }
  if (dir) {
    for (const f of ['nasa_gas.yaml', 'nasa_condensed.yaml']) {
      const r = DB.parse(fs.readFileSync(path.join(dir, f), 'utf8'), f); let w = 0, n = 0;
      const pairs = f === 'nasa_gas.yaml' ? Object.keys(TH).filter(k => /\(g\)$/.test(k)).map(k => [k, k.replace('(g)', '')]) : [['CaO(s)', 'CaO(s)'], ['MgO(s)', 'MgO(s)'], ['Fe3O4(s)', 'Fe3O4(s)'], ['FeS(l)', 'FeS(L)'], ['CaS(s)', 'CaS(s)'], ['Al2O3(s)', 'AL2O3(a)']];
      pairs.forEach(([key, nm]) => { const s = r.species.find(x => x.name === nm); if (!s) { fail++; console.log('FAIL missing', nm); return; } n++; for (const T of Ts) { if (T < s.Tmin || T > s.Tmax) continue; const a = E.builtinProps(key, T), b = E.evalRecord(s.record, T); w = Math.max(w, Math.abs(a[0] - b[0]), T * Math.abs(a[1] - b[1])); } });
      const ok = w < 1e-6 && n === pairs.length; if (!ok) fail++;
      console.log((ok ? 'ok   ' : 'FAIL ') + ('Cantera ' + f + ', ' + r.species.length + ' species read').padEnd(46), 'largest difference on ' + n + ' model species', w.toExponential(1), 'J/mol |', r.warnings[0] ? 'warning shown: no reference pressure in file' : '');
    }
  }
  const y = 'units: {length: cm, quantity: mol, activation-energy: J/mol}\nspecies:\n- name: ZnO(s)\n  composition: {Zn: 1, O: 1}\n  thermo: {model: constant-cp, T0: 1523.15 K, h0: ' + E.builtinProps('ZnO(s)', 1523.15)[0] / 1000 + ' kJ/mol, s0: ' + E.builtinProps('ZnO(s)', 1523.15)[1] + ' J/mol/K, cp0: ' + E.builtinProps('ZnO(s)', 1523.15)[2] + ' J/mol/K, reference-pressure: 1 bar}\n';
  const r = DB.parse(y, 'zno.yaml'), b = E.evalRecord(r.species[0].record, 1523.15), a = E.builtinProps('ZnO(s)', 1523.15);
  const d = Math.max(Math.abs(a[0] - b[0]), 1523.15 * Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])), ok = d < 1e-6; if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + 'Cantera constant-cp record'.padEnd(46), 'difference at its T0', d.toExponential(1), 'J/mol');
} else console.log('skip YAML tests: js-yaml not installed');
/* 5. Calphad TDB: ZnO as a stoichiometric phase whose G polynomial is the closed form of the built-in heat capacity,
      written through a piecewise function and a function reference */
{
  const a = 45.338, b = 7.289e-3, c = -5.732e5, H = -350460, S = 43.65, T0 = 298.15;
  const C = -a, D = -b / 2, Ec = -c / 2, A = H - a * T0 - b / 2 * T0 * T0 + c / T0, B = a * (Math.log(T0) + 1) + b * T0 - c / (2 * T0 * T0) - S;
  const f = x => (x >= 0 ? '+' : '') + x.toPrecision(15);
  const tdb = `$ synthetic test database
ELEMENT ZN HCP_ZN 65.38 0 0 ! ELEMENT O 1/2_MOLE_O2(G) 15.999 0 0 !
FUNCTION GHALF 298.15 ${f(A / 2)}${f(B / 2)}*T${f(C / 2)}*T*LN(T)${f(D / 2)}*T**2${f(Ec / 2)}*T**(-1); 1200 Y ${f(A / 2)}${f(B / 2)}*T${f(C / 2)}*T*LN(T)${f(D / 2)}*T**2${f(Ec / 2)}/T; 6000 N REF0 !
FUNCTION GZNO 298.15 2*GHALF#; 6000 N !
PHASE ZINCITE % 2 1 1 ! CONSTITUENT ZINCITE :ZN:O: !
PARAMETER G(ZINCITE,ZN:O;0) 298.15 +GZNO#+0*R#*T*LN(1E-05*P); 6000 N REF1 !
PHASE GAS:G % 1 1.0 ! CONSTITUENT GAS:G :ZN: !
PARAMETER G(GAS,ZN;0) 298.15 +130000-20*T+R#*T*LN(1E-05*P); 6000 N !
PHASE SLAG % 1 1.0 ! CONSTITUENT SLAG :FEO,ZNO: !  SPECIES FEO FE1O1 ! SPECIES ZNO ZN1O1 !
PARAMETER G(SLAG,ZNO;0) 298.15 +GZNO#+20000-8*T; 6000 N !
PARAMETER L(SLAG,FEO,ZNO;0) 298.15 -10000; 6000 N !
`;
  fs.writeFileSync(path.join(__dirname, 'data', 'test.tdb'), tdb);
  const r = DB.parse(tdb, 'test.tdb');
  const z = r.species.find(s => s.name === 'ZINCITE(ZN:O)');
  compare('TDB stoichiometric phase vs built-in ZnO', 'ZnO(s)', z.record, 1e-6);
  const sl = r.species.find(s => s.name === 'SLAG(ZNO)'), g1 = E.evalRecord(sl.record, 1500), g0 = E.evalRecord(z.record, 1500);
  const d = (g1[0] - 1500 * g1[1]) - (g0[0] - 1500 * g0[1]) - (20000 - 8 * 1500), ok = Math.abs(d) < 1e-6 && DB.sameComp(sl.comp, { Zn: 1, O: 1 }) && r.species.find(s => s.name === 'GAS(ZN)').phase === 'gas';
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + 'TDB end member of a solution, gas pressure term'.padEnd(46), 'G difference error', Math.abs(d).toExponential(1), 'J/mol; species read:', r.species.map(s => s.name).join(', '));
}
/* 6. CSV table with Hermite interpolation, compared between the nodes */
{
  let csv = 'species,T,h,s,cp\n'; for (let T = 300; T <= 2500; T += 25) { const p = E.builtinProps('ZnO(s)', T); csv += ['ZnO(s)', T, p[0], p[1], p[2]].join(',') + '\n'; }
  fs.writeFileSync(path.join(__dirname, 'data', 'zno_table.csv'), csv);
  const r = DB.parse(csv, 'zno_table.csv');
  compare('CSV table, 25 K steps, read between nodes', 'ZnO(s)', r.species[0].record, 0.05, [312.5, 987.5, 1512.5, 1523.15, 2012.5]);
  const g = DB.parse('T_C,ZnO,FeO\n1150,2.4,1.1\n1350,1.8,0.9\n', 'gamma.csv');
  const ok = g.gamma && g.gamma.table.ZnO.T[0] === 1423.15 && g.gamma.table.FeO.g[1] === 0.9; if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + 'CSV activity-coefficient table'.padEnd(46), JSON.stringify(g.gamma.table.ZnO));
}
/* 7. reference-pressure conversion for gas data given at 1 atm */
{
  const rec = Object.assign({}, TH['CO2(g)'], { pref: 101325 }), a = E.builtinProps('CO2(g)', 1500), b = E.evalRecord(rec, 1500);
  const ok = Math.abs((b[1] - a[1]) - E.R * Math.log(1.01325)) < 1e-12; if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + 'gas data at 1 atm converted to 1 bar'.padEnd(46), 'entropy shift', (b[1] - a[1]).toFixed(6), 'J/(mol K), expected R ln(1.01325) =', (E.R * Math.log(1.01325)).toFixed(6));
}
/* 8. matching and use in the model: imported data identical to built-in data give identical results */
{
  const keys = E.thermoKeys(), r = DB.parse(fs.readFileSync(path.join(__dirname, 'data', 'test.tdb'), 'utf8'), 'test.tdb');
  const m = DB.autoMatch(keys, r.species.concat([{ name: 'ZnO(cr)', comp: { Zn: 1, O: 1 }, phase: 'cond' }]));
  const { base } = require('./common.js'), inp = base(); inp.mode = 'batch'; inp.thermal = 'auto'; inp.slag.rate = 50; inp.coal.rate = 3000; inp.al.rate = 300; inp.blast.rate = 18000;
  const r0 = E.run(inp); E.setThermoOverrides({ 'ZnO(s)': r.species.find(s => s.name === 'ZINCITE(ZN:O)').record }); const r1 = E.run(inp); E.setThermoOverrides(null);
  const ok = Math.abs(r0.k.znRec - r1.k.znRec) < 1e-6 && Math.abs(r0.T - r1.T) < 1e-6 && m['ZnO(s)'] && m['ZnO(s)'].name === 'ZnO(cr)';
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + 'model run with imported ZnO data'.padEnd(46), 'Zn recovery', r0.k.znRec.toFixed(6), 'vs', r1.k.znRec.toFixed(6), '%; with two candidates the exact name ZnO(cr) was matched to ZnO(s):', !!(m['ZnO(s)'] && m['ZnO(s)'].name === 'ZnO(cr)'));
}
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
