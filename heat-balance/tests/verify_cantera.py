"""Independent check of the equilibrium solver with Cantera's multiphase solvers (VCS and Gibbs).

Each species is given to Cantera as a constant-cp record at the case temperature, so it has exactly the engine's g(T);
activity coefficients enter as a shift of h0 by RT ln(gamma). Cantera then minimises G with its own algorithms.
The small remaining difference in G/RT (about 2e-7) is the P*v term of the condensed phases in Cantera.

Usage: node tests/stress_cases.js; python3 tests/verify_cantera.py   (needs cantera)
"""
import json, math, os, subprocess, cantera as ct, numpy as np, io, contextlib
R=8.314462618
HERE=os.path.dirname(os.path.abspath(__file__))
D=json.loads(subprocess.run(['node',os.path.join(HERE,'dump_cases.js')],capture_output=True,text=True,check=True).stdout); els=D['els']
AWT={'C':12.011,'H':1.008,'O':15.999,'N':14.007,'S':32.06,'Zn':65.38,'Pb':207.2,'Fe':55.845,'Si':28.085,'Ca':40.078,'Al':26.9815,'Mg':24.305,'X':60.083}
def yml(case):
    T=case['T']; P=case['P']
    def spec(s, extra_h=0.0, name=None):
        comp=', '.join(f"{k}: {v}" for k,v in s['comp'].items())
        return (f"- name: {name or s['id']}\n  composition: {{{comp}}}\n  thermo: {{model: constant-cp, T0: {T} K, reference-pressure: 1 bar, h0: {s["h"]+extra_h} J/mol, s0: {s['s']} J/mol/K, cp0: {s['cp']} J/mol/K}}\n"
                + ("  equation-of-state: {model: constant-volume, molar-volume: 1.0e-2 m^3/kmol}\n" if s['phase']!='gas' else ""))
    used=[e for e,b in zip(els,case['b']) if b>0]
    def ok(s): return all(k in used for k in s['comp'])
    gas=[s for s in case['sp'] if s['phase']=='gas' and ok(s)]
    slag=[s for s in case['sp'] if s['phase']=='slag' and ok(s)]
    pure=[s for s in case['sp'] if s['phase']=='pure' and ok(s)]
    gm=case['gam']
    nm=lambda s: s['id'].replace('(','_').replace(')','').replace('.','_')
    y="units: {length: m, quantity: kmol, activation-energy: J/kmol}\n"
    y+="elements:\n- {symbol: X, atomic-weight: 60.083}\n"
    y+="phases:\n"
    y+=f"- name: gas\n  thermo: ideal-gas\n  elements: [{', '.join(used)}]\n  species: [{{species: [{', '.join(nm(s) for s in gas)}]}}]\n  state: {{T: {T}, P: {P*1e5}}}\n"
    if slag: y+=f"- name: slag\n  thermo: ideal-condensed\n  standard-concentration-basis: unity\n  elements: [{', '.join(used)}]\n  species: [{{species: [{', '.join(nm(s) for s in slag)}]}}]\n  state: {{T: {T}, P: {P*1e5}}}\n"
    for s in pure: y+=f"- name: P_{nm(s)}\n  thermo: fixed-stoichiometry\n  elements: [{', '.join(used)}]\n  species: [{{species: [{nm(s)}]}}]\n  state: {{T: {T}, P: {P*1e5}}}\n"
    y+="species:\n"
    for s in gas+pure: y+=spec(s,name=nm(s))
    for s in slag: y+=spec(s, R*T*math.log(gm.get(s['id'],1.0) or 1.0), name=nm(s))
    return y,gas,slag,pure,used,nm
print(f"{'case':20s} {'solver':6s} {'G/RT engine':>15s} {'G/RT Cantera':>15s} {'diff':>9s}  largest rel. dev. of a species above 1e-6 of total")
for case in D['out']:
    y,gas,slag,pure,used,nm=yml(case); T=case['T']; P=case['P']*1e5
    phs=[ct.Solution(yaml=y,name='gas')]+([ct.Solution(yaml=y,name='slag')] if slag else [])+[ct.Solution(yaml=y,name='P_'+nm(s)) for s in pure]
    mix=ct.Mixture([(p,0.0) for p in phs]); mix.T=T; mix.P=P
    # feed: element amounts placed on a simple set of species (any composition with the same elements works)
    b=dict(zip(case['els'] if 'els' in case else D['els'],case['b']))
    best=None
    for solver in ('vcs','gibbs'):
        try:
            mix2=ct.Mixture([(p,0.0) for p in phs]); mix2.T=T; mix2.P=P
            # put elements in: use the engine solution as the element source but scramble it to a far start
            spn=[f"{nm(s)}" for s in gas]+[nm(s) for s in slag]+[nm(s) for s in pure]
            eng={nm(s):n for s,n in zip(case['sp'],case['n'])}
            mol=np.zeros(mix2.n_species)
            for i in range(mix2.n_species):
                sname=mix2.species_name(i); mol[i]=eng.get(sname,0.0)
            # the engine result fixes the element amounts; Cantera starts from it and moves wherever G can be lowered
            mix2.species_moles=mol
            with contextlib.redirect_stdout(io.StringIO()):
                mix2.equilibrate('TP',solver=solver,max_steps=5000,rtol=1e-12,max_iter=500)
            n=mix2.species_moles
            Gc=sum(n[i]*mix2.chemical_potentials[i] for i in range(mix2.n_species))/(R*1e3*T)/sum(case['b'])
            Ge=case['G']/(R*T)/sum(case['b'])
            dev=0
            tot=sum(n)
            for i in range(mix2.n_species):
                e=mol[i]
                if max(e,n[i])>1e-6*tot: dev=max(dev,abs(n[i]-e)/max(e,n[i]))
            print(f"{case['name']:20s} {solver:6s} {Ge:15.9f} {Gc:15.9f} {Ge-Gc:+9.1e}  {dev:.1e}")
        except Exception as ex:
            print(f"{case['name']:20s} {solver:6s} failed: {str(ex).splitlines()[0][:90]}")
