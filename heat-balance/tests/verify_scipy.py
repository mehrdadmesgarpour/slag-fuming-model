"""Independent check of the equilibrium solver.

Standard-state data are evaluated by Cantera from its own NASA files and the Gibbs energy is minimised by SciPy (SLSQP),
starting from a strongly perturbed point. The minimum G/RT is compared with the JavaScript result.

Usage: node tests/stress_cases.js   (writes tests/cases.json)
       pip install cantera scipy numpy; python3 tests/verify_scipy.py
"""
import json, math, os, numpy as np, cantera as ct
from pathlib import Path
from scipy.optimize import minimize
R=8.314462618
d=os.path.join(os.path.dirname(ct.__file__),'data')
gas={str(s.name):s for s in ct.Species.list_from_file(os.path.join(d,'nasa_gas.yaml'))}
con={str(s.name):s for s in ct.Species.list_from_file(os.path.join(d,'nasa_condensed.yaml'))}
def hs(sp,T):
    return sp.thermo.h(T)/1000.0, sp.thermo.s(T)/1000.0   # J/mol, J/mol/K
def ext(names,T):
    # piecewise list of condensed NASA entries with constant-Cp continuation outside the fitted range
    segs=[(con[n].thermo.min_temp,con[n].thermo.max_temp,con[n]) for n in names]
    if T<segs[0][0]: sp=segs[0][2]; Tb=segs[0][0]
    elif T>segs[-1][1]: sp=segs[-1][2]; Tb=segs[-1][1]
    else:
        for lo,hi,sp_ in segs:
            if T<=hi: sp=sp_; Tb=None; break
    if Tb is None: return hs(sp,T)
    h,s=hs(sp,Tb); cp=sp.thermo.cp(Tb)/1000.0
    return h+cp*(T-Tb), s+cp*math.log(T/Tb)
def zno(T):
    a,b,c=45.338,7.289e-3,-5.732e5; T0=298.15  # same ZnO data as src/engine.js
    return (-350460+a*(T-T0)+b/2*(T*T-T0*T0)-c*(1/T-1/T0), 43.65+a*math.log(T/T0)+b*(T-T0)-c/2*(1/T**2-1/T0**2))
MAP={'FeO(l)':['FeO(L)'],'Fe2O3(s)':['Fe2O3(s)'],'PbO(l)':['PbO(L)'],'SiO2(l)':['SiO2(L)'],'CaO(s)':['CaO(s)'],'Al2O3(s)':['AL2O3(a)'],'MgO(s)':['MgO(s)'],
     'Fe':['Fe(c)','Fe(d)','Fe(L)'],'Pb':['Pb(cr)','Pb(L)'],'C(gr)':['C(gr)'],'Fe3O4(s)':['Fe3O4(s)'],'Al':['AL(cr)','AL(L)'],'Si':['Si(cr)','Si(L)'],'Zn(l)':['Zn(cr)','Zn(L)'],'FeS(l)':['FeS(L)']}
def g0(sp,T):
    th=sp['th']
    if th.endswith('(g)'): h,s=hs(gas[th[:-3]],T)
    elif th=='ZnO(s)': h,s=zno(T)
    else:
        h,s=ext(MAP[th],T)
        if th=='FeO(l)': h+=5829.5; s+=-3.1911  # same FeO correction as src/engine.js
    return sp['f']*(h-T*s)/(R*T)
data=json.load(open(Path(__file__).resolve().parent/'cases.json')); els=data['els']; S=data['species']
A=np.array([[sp['comp'].get(e,0.0) for sp in S] for e in els])
for case in data['cases']:
    T,P,gam=case['T'],case['P'],case['gam']; b=np.array(case['b']); njs=np.array(case['n'])
    keep_e=[k for k in range(len(els)) if b[k]>1e-9*b.sum()]
    keep=[i for i,sp in enumerate(S) if all((A[k,i]==0) or (k in keep_e) for k in range(len(els)))]
    Ak=A[np.ix_(keep_e,keep)]; bk=b[keep_e]; sc=bk.sum(); bk=bk/sc
    g=np.array([g0(S[i],T) for i in keep]); ph=[S[i]['phase'] for i in keep]
    extra=np.array([math.log(P) if p=='gas' else (math.log(gam.get(S[i]['id'],1.0)) if p=='slag' else 0.0) for i,p in zip(keep,ph)])
    ig=[j for j,p in enumerate(ph) if p=='gas']; isl=[j for j,p in enumerate(ph) if p=='slag']
    def G(n):
        n=np.maximum(n,1e-300); tot=float(n@(g+extra))
        for idx in (ig,isl):
            if idx:
                x=n[idx]; tot+=float(x@np.log(x/x.sum()))
        return tot
    x0=np.maximum(njs[keep]/sc,1e-12)
    Gjs=G(x0)
    # start SciPy away from the JS answer: perturb strongly, then minimise
    rng=np.random.default_rng(1); best=None
    for trial in range(8):   # several perturbed starts; only starts that meet the element balance count
        xs=np.maximum(x0*np.exp(rng.normal(0,1.0,len(x0)))+1e-4*rng.random(len(x0)),1e-10)
        res=minimize(G,xs,method='SLSQP',constraints=[{'type':'eq','fun':lambda n:Ak@n-bk,'jac':lambda n:Ak}],bounds=[(1e-14,None)]*len(xs),options={'maxiter':3000,'ftol':1e-15})
        if float(np.abs(Ak@res.x-bk).max())>1e-9: continue
        if best is None or res.fun<best.fun: best=res
    if best is None:
        print(f"{case['name']:20s} SciPy found no start that meets the element balance"); continue
    feas=float(np.abs(Ak@best.x-bk).max())
    big=[j for j in range(len(keep)) if x0[j]>1e-4]
    dev=max(abs(best.x[j]-x0[j])/x0[j] for j in big)
    print(f"{case['name']:20s} G/RT model={Gjs:+.9f} scipy={best.fun:+.9f} difference={Gjs-best.fun:+.1e}  scipy element residual={feas:.0e}  largest relative deviation of a major species={dev:.0e}")
