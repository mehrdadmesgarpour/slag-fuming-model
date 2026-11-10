#!/usr/bin/env python3
"""Local thermodynamic data server for the Fuming Thermodynamic Model.

The web page can fetch standard-state data and slag activity coefficients from this server, so that a database on
your own computer (a Calphad TDB file, a Cantera YAML file or a data set in the model's JSON format) is used
in the Gibbs energy minimisation and the heat balance. Nothing leaves your computer: the server listens on
127.0.0.1 only.

Usage
  python3 thermo_bridge.py --json data.json
  python3 thermo_bridge.py --cantera mechanism.yaml [--assume-pref 1bar|1atm] [--slag-phase NAME --map map.json]
  python3 thermo_bridge.py --tdb database.tdb --map map.json          (needs: pip install pycalphad)
  options: --port 8765

Protocol (JSON over HTTP)
  GET  /info      -> {"name", "backend", "source", "species": [{"name", "composition", "phase"}], "activity": {...} or null}
  POST /species   {"names": [...], "Tmin": 700, "Tmax": 2500, "dT": 10}
                  -> {"format": "fuming-thermo-1", "species": [{"name", "composition", "phase", "model": "table", "T", "h", "s", "cp"}]}
  POST /activity  {"T": K, "P": Pa, "moles": {"FeO": n, "FeO1.5": n, "ZnO": n, "PbO": n, "SiO2": n, "CaO": n, "AlO1.5": n, "MgO": n}}
                  -> {"gamma": {...}, "ignored": [...], "standard_states": {...}}
  Units: J/mol and J/(mol K) at 1 bar; enthalpy relative to the elements at 298.15 K (SER); absolute entropy.
  Activity coefficients refer to the model's standard states (ZnO(s), FeO(l), PbO(l), 1/2 Fe2O3(s)) and to mole fractions
  on a single-cation basis over the oxides the database describes; oxides it does not describe are reported as ignored.

Map file (for --tdb, and for --cantera with --slag-phase)
  {
    "species": {                               model standard-state name -> database phase or species
      "ZnO(s)": {"phase": "ZINCITE"},                                   stoichiometric phase (TDB)
      "FeO(l)": {"phase": "SLAG", "endmember": [["FEO"]]},              end member of a solution, one list per sublattice (TDB)
      "Fe2O3(s)": {"species": "Fe2O3(s)"}                               species name (Cantera)
    },
    "slag": {
      "phase": "SLAG",
      "oxides": {"ZnO": {"std": "ZnO(s)", "factor": 1}, "FeO": {"std": "FeO(l)", "factor": 1},
                 "FeO1.5": {"std": "Fe2O3(s)", "factor": 0.5}, "SiO2": {"std": "SiO2(l)", "factor": 1},
                 "PbO": {"std": "PbO(l)", "factor": 1}},
      "species": {"ZnO": "ZNO"}                                          Cantera only: oxide -> species name in the slag phase
    }
  }

Other databases (FactSage through ChemApp, Thermo-Calc through TC-Python) can be connected by writing a backend
class with the same three methods as the ones below; see TemplateBackend at the end of this file.
"""
import argparse, json, math, re, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

R = 8.314462618
OXIDES = {'FeO': {'Fe': 1, 'O': 1}, 'FeO1.5': {'Fe': 1, 'O': 1.5}, 'ZnO': {'Zn': 1, 'O': 1}, 'PbO': {'Pb': 1, 'O': 1},
          'SiO2': {'Si': 1, 'O': 2}, 'CaO': {'Ca': 1, 'O': 1}, 'AlO1.5': {'Al': 1, 'O': 1.5}, 'MgO': {'Mg': 1, 'O': 1}}
ACTIVE = ['ZnO', 'PbO', 'FeO', 'FeO1.5']


def grid(Tmin, Tmax, dT):
    n = max(2, int(round((Tmax - Tmin) / dT)) + 1)
    return [Tmin + (Tmax - Tmin) * k / (n - 1) for k in range(n)]


def gamma_from_mu(mu, g_std, x, T):
    """mu, g_std in J/mol; x the mole fraction of the oxide in the described subset"""
    return math.exp((mu - g_std) / (R * T)) / x


# ---------------------------------------------------------------------------------------------------------------------
class JsonBackend:
    """Serves a data set in the model's own JSON format unchanged; constant or tabulated activity coefficients if given."""
    def __init__(self, path):
        self.path = path
        with open(path) as f:
            self.d = json.load(f)
        self.species = {s['name']: s for s in self.d.get('species', [])}

    def info(self):
        act = self.d.get('activity')
        return {'backend': 'json', 'source': self.path,
                'species': [{'name': n, 'composition': s.get('composition'), 'phase': s.get('phase')} for n, s in self.species.items()],
                'activity': {'oxides': sorted(set((act or {}).get('gamma', {})) | set((act or {}).get('table', {})))} if act else None}

    def species_data(self, names, Tmin, Tmax, dT):
        out = [self.species[n] for n in names if n in self.species]
        return {'format': 'fuming-thermo-1', 'source': self.d.get('source', self.path), 'reference-pressure-Pa': self.d.get('reference-pressure-Pa', 1e5), 'species': out}

    def activity(self, T, P, moles):
        act = self.d.get('activity') or {}
        g = {}
        for ox, t in (act.get('table') or {}).items():
            pts = sorted(zip([1 / x for x in t['T']], [math.log(v) for v in t['gamma']]))
            if len(pts) == 1:
                g[ox] = math.exp(pts[0][1]); continue
            x = 1 / T; j = 0
            while j < len(pts) - 2 and x > pts[j + 1][0]:
                j += 1
            sl = (pts[j + 1][1] - pts[j][1]) / (pts[j + 1][0] - pts[j][0])
            g[ox] = math.exp(pts[j][1] + sl * (x - pts[j][0]))
        for ox, v in (act.get('gamma') or {}).items():
            g.setdefault(ox, v)
        return {'gamma': g, 'ignored': [], 'standard_states': {}, 'note': 'composition-independent values from ' + self.path}


# ---------------------------------------------------------------------------------------------------------------------
class CanteraBackend:
    """Standard-state data of every species in a Cantera YAML file; activities from one condensed solution phase."""
    def __init__(self, path, assume_pref, slag_phase=None, mapping=None):
        import cantera as ct
        self.ct, self.path = ct, path
        text = open(path).read()
        self.declared = 'reference-pressure' in text
        self.assume_pref = assume_pref
        self.sp = {s.name: s for s in ct.Species.list_from_file(path)}
        self.mapping = mapping or {}
        self.phase = ct.Solution(path, slag_phase) if slag_phase else None
        self.gasnames = set()
        try:
            import yaml
            for ph in yaml.safe_load(text).get('phases', []):
                if 'ideal-gas' in str(ph.get('thermo', '')):
                    for x in ph.get('species', []):
                        if isinstance(x, dict):
                            for v in x.values():
                                if isinstance(v, list):
                                    self.gasnames.update(v)
                        elif isinstance(x, str):
                            self.gasnames.add(x)
        except Exception:
            pass

    def pref(self, s):
        return s.thermo.reference_pressure if self.declared else self.assume_pref

    def info(self):
        sp = [{'name': n, 'composition': dict(s.composition), 'phase': 'gas' if n in self.gasnames else None} for n, s in self.sp.items()]
        act = None
        if self.phase is not None:
            act = {'phase': self.phase.name, 'oxides': sorted(self.mapping.get('slag', {}).get('oxides', {}))}
        return {'backend': 'cantera', 'source': self.path, 'species': sp, 'activity': act,
                'note': None if self.declared else 'reference pressure not declared in the file; %.0f Pa assumed' % self.assume_pref}

    def table(self, s, Ts):
        th = s.thermo; shift = R * math.log(self.pref(s) / 1e5)
        return {'model': 'table', 'T': Ts, 'h': [th.h(T) / 1e3 for T in Ts], 's': [th.s(T) / 1e3 + shift for T in Ts], 'cp': [th.cp(T) / 1e3 for T in Ts]}

    def species_data(self, names, Tmin, Tmax, dT):
        Ts = grid(Tmin, Tmax, dT); out = []
        for n in names:
            s = self.sp.get(n)
            if s is None:
                continue
            o = {'name': n, 'composition': dict(s.composition), 'phase': 'gas' if n in self.gasnames else None, 'source': self.path}
            o.update(self.table(s, Ts)); out.append(o)
        return {'format': 'fuming-thermo-1', 'source': self.path, 'reference-pressure-Pa': 1e5, 'species': out}

    def g_std(self, key, T):
        m = self.mapping.get('species', {}).get(key, {'species': key})
        s = self.sp[m.get('species', key)]
        return s.thermo.h(T) / 1e3 - T * (s.thermo.s(T) / 1e3 + R * math.log(self.pref(s) / 1e5))

    def activity(self, T, P, moles):
        if self.phase is None:
            raise ValueError('start the server with --slag-phase to get activity coefficients')
        sl = self.mapping['slag']; ox = sl['oxides']; names = sl['species']
        use = {k: v for k, v in moles.items() if k in ox and k in names and v > 0}
        ignored = [k for k, v in moles.items() if v > 0 and k not in use]
        tot = sum(use.values())
        X = {names[k]: v / tot for k, v in use.items()}
        self.phase.TPX = T, P, X
        mu = dict(zip(self.phase.species_names, self.phase.chemical_potentials / 1e3))
        g = {k: gamma_from_mu(mu[names[k]], ox[k].get('factor', 1) * self.g_std(ox[k]['std'], T), use[k] / tot, T) for k in use if k in ACTIVE}
        return {'gamma': g, 'ignored': ignored, 'standard_states': {k: ox[k]['std'] for k in use}}


# ---------------------------------------------------------------------------------------------------------------------
class TdbBackend:
    """Calphad TDB database through pycalphad: standard states from mapped phases or end members,
    slag activity coefficients from an equilibrium of the slag phase alone at the given composition."""
    def __init__(self, path, mapping):
        from pycalphad import Database
        self.path, self.dbf, self.map = path, Database(path), mapping
        self.ELS = sorted(e for e in self.dbf.elements if e not in ('VA', '/-'))

    @staticmethod
    def el(e):
        return e.capitalize() if len(e) > 1 else e

    def info(self):
        sp = []
        for key, m in self.map.get('species', {}).items():
            sp.append({'name': key, 'composition': self.comp(m), 'phase': 'gas' if m['phase'].upper().startswith('GAS') else 'cond'})
        sl = self.map.get('slag')
        return {'backend': 'pycalphad', 'source': self.path, 'species': sp,
                'activity': {'phase': sl['phase'], 'oxides': sorted(sl['oxides'])} if sl else None}

    def _model(self, phase):
        from pycalphad import Model
        comps = self.ELS + ['VA']
        return Model(self.dbf, comps, phase), comps

    def _point(self, m):
        """site fractions of the end member (or of the only point of a stoichiometric phase), in pycalphad's order"""
        mod, comps = self._model(m['phase'])
        end = m.get('endmember')
        pt = []
        for k, sub in enumerate(mod.constituents):
            names = sorted(str(s.name) for s in sub)
            want = [w.upper() for w in end[k]] if end else names
            for nm in names:
                pt.append(1.0 if nm in want and (end or len(names) == 1) else 0.0)
        return mod, comps, pt

    def comp(self, m):
        mod, comps, pt = self._point(m)
        c = {}; k = 0
        for s_idx, sub in enumerate(mod.constituents):
            ratio = float(mod.site_ratios[s_idx])
            for spc in sorted(sub, key=lambda s: str(s.name)):
                y = pt[k]; k += 1
                for e, n in spc.constituents.items():
                    if e != 'VA' and y > 0:
                        c[self.el(e)] = c.get(self.el(e), 0) + ratio * y * float(n)
        return c

    def props(self, key, Ts):
        """h, s, cp per formula unit of the mapped standard state"""
        import numpy as np
        from pycalphad import calculate
        m = self.map['species'][key]
        mod, comps, pt = self._point(m)
        atoms = sum(self.comp(m).values())
        out = {}
        for q in ('HM', 'SM', 'CPM'):
            r = calculate(self.dbf, comps, m['phase'], T=Ts, P=101325, N=1, output=q, points=np.array([pt]), model={m['phase']: mod})
            out[q] = [float(v) * atoms for v in np.asarray(r[q]).reshape(-1)[:len(Ts)]]
        return out

    def species_data(self, names, Tmin, Tmax, dT):
        Ts = grid(Tmin, Tmax, dT); out = []
        for n in names:
            m = self.map.get('species', {}).get(n)
            if not m:
                continue
            p = self.props(n, Ts)
            out.append({'name': n, 'composition': self.comp(m), 'phase': 'gas' if m['phase'].upper().startswith('GAS') else 'cond',
                        'model': 'table', 'T': Ts, 'h': p['HM'], 's': p['SM'], 'cp': p['CPM'], 'source': self.path + ' / ' + m['phase']})
        return {'format': 'fuming-thermo-1', 'source': self.path, 'reference-pressure-Pa': 1e5, 'species': out}

    def g_std(self, key, T):
        p = self.props(key, [T])
        return p['HM'][0] - T * p['SM'][0]

    def activity(self, T, P, moles):
        import numpy as np
        from pycalphad import equilibrium, variables as v
        sl = self.map['slag']; ox = sl['oxides']
        known = set(self.el(e) for e in self.ELS)
        use = {k: n for k, n in moles.items() if n > 0 and k in ox and k in OXIDES and set(OXIDES[k]) <= known}
        ignored = [k for k, n in moles.items() if n > 0 and k not in use]
        el = {}
        for k, n in use.items():
            for e, c in OXIDES[k].items():
                el[e] = el.get(e, 0) + n * c
        tot_el = sum(el.values()); tot = sum(use.values())
        upper = {self.el(e).upper(): e for e in el}
        dep = 'O'
        conds = {v.T: T, v.P: P, v.N: 1}
        for E, e in upper.items():
            if e != dep:
                conds[v.X(E)] = el[e] / tot_el
        comps = self.ELS + ['VA']
        eq = equilibrium(self.dbf, comps, [sl['phase']], conds)
        names = [str(c) for c in np.asarray(eq.component)]
        MU = np.asarray(eq.MU).reshape(-1)
        mu_el = {self.el(c): float(MU[i]) for i, c in enumerate(names)}
        if any(not math.isfinite(mu_el.get(e, float('nan'))) for e in el):
            raise ValueError('the slag phase has no solution at this composition and temperature')
        g = {}
        for k in use:
            if k not in ACTIVE:
                continue
            mu = sum(c * mu_el[e] for e, c in OXIDES[k].items())
            g[k] = gamma_from_mu(mu, ox[k].get('factor', 1) * self.g_std(ox[k]['std'], T), use[k] / tot, T)
        return {'gamma': g, 'ignored': ignored, 'standard_states': {k: ox[k]['std'] for k in use if k in ox}}


# ---------------------------------------------------------------------------------------------------------------------
class TemplateBackend:
    """Starting point for a connection to another program (for example ChemApp or TC-Python).
    Fill in the three methods with calls to that program's own interface; keep the units and conventions in the
    module docstring. This class is not used unless you select it in main()."""
    def info(self):
        return {'backend': 'template', 'source': '', 'species': [], 'activity': None}

    def species_data(self, names, Tmin, Tmax, dT):
        raise NotImplementedError('return h, s, cp tables for each requested standard state')

    def activity(self, T, P, moles):
        raise NotImplementedError('return activity coefficients of ZnO, PbO, FeO and FeO1.5 for this slag composition')


# ---------------------------------------------------------------------------------------------------------------------
def make_handler(backend, name):
    class H(BaseHTTPRequestHandler):
        def _send(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')  # lets a page on the web reach 127.0.0.1 in Chromium
            self.end_headers()

        def do_GET(self):
            if self.path.rstrip('/') == '/info':
                i = backend.info(); i['name'] = name; i['protocol'] = 1
                self._send(200, i)
            else:
                self._send(404, {'error': 'unknown path'})

        def do_POST(self):
            try:
                n = int(self.headers.get('Content-Length', 0))
                req = json.loads(self.rfile.read(n) or b'{}')
                if self.path.rstrip('/') == '/species':
                    self._send(200, backend.species_data(req.get('names', []), float(req.get('Tmin', 700)), float(req.get('Tmax', 2500)), float(req.get('dT', 10))))
                elif self.path.rstrip('/') == '/activity':
                    self._send(200, backend.activity(float(req['T']), float(req.get('P', 101325)), req['moles']))
                else:
                    self._send(404, {'error': 'unknown path'})
            except Exception as e:
                self._send(400, {'error': str(e)})

        def log_message(self, fmt, *args):
            sys.stderr.write('%s %s\n' % (self.command, self.path))
    return H


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--json'); g.add_argument('--cantera'); g.add_argument('--tdb')
    ap.add_argument('--map', help='map file (JSON), needed for --tdb and for --cantera with --slag-phase')
    ap.add_argument('--slag-phase', help='Cantera phase that gives the slag activity coefficients')
    ap.add_argument('--assume-pref', default='1bar', choices=['1bar', '1atm'], help='reference pressure of Cantera data that do not declare one')
    ap.add_argument('--port', type=int, default=8765)
    a = ap.parse_args(argv)
    mapping = json.load(open(a.map)) if a.map else {}
    if a.json:
        b = JsonBackend(a.json)
    elif a.cantera:
        b = CanteraBackend(a.cantera, 1e5 if a.assume_pref == '1bar' else 101325.0, a.slag_phase, mapping)
    else:
        if not mapping:
            ap.error('--tdb needs --map')
        b = TdbBackend(a.tdb, mapping)
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), make_handler(b, 'Fuming model thermodynamic server'))
    print('Serving %s data on http://127.0.0.1:%d  (Ctrl+C to stop)' % (b.info()['backend'], a.port), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
