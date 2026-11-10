"""Extract the NASA seven-coefficient polynomials used by the model from the Cantera data files.

Usage: pip install cantera pyyaml; python3 tools/extract_thermo.py
Writes src/thermo.json. ZnO(s) and the FeO correction are defined in src/engine.js.
"""
import cantera, os, yaml, json
from pathlib import Path
d=os.path.join(os.path.dirname(cantera.__file__),'data')
def load(f):
    y=yaml.safe_load(open(os.path.join(d,f)))
    return {str(s['name']):s for s in y['species']}
G=load('nasa_gas.yaml'); C=load('nasa_condensed.yaml')
def segs(sp):
    t=sp['thermo']; assert t['model']=='NASA7', sp['name']
    tr=t['temperature-ranges']; out=[]
    for i,c in enumerate(t['data']):
        out.append([tr[i],tr[i+1]]+[float(x) for x in c])
    return out
def chain(names,src=C):
    out=[]
    for n in names: out+=segs(src[n])
    return out
db={}
for n in ['N2','O2','CO','CO2','H2','H2O','CH4','Zn','Pb','PbO','PbS','SO2','H2S','S2','COS']:
    db[n+'(g)']={'segs':segs(G[n]),'note':G[n]['thermo'].get('note','')}
cond={
 'Fe':['Fe(c)','Fe(d)','Fe(L)'], 'Pb':['Pb(cr)','Pb(L)'], 'Al':['AL(cr)','AL(L)'], 'Si':['Si(cr)','Si(L)'],
 'C(gr)':['C(gr)'], 'Fe3O4(s)':['Fe3O4(s)'],
 'FeO(l)':['FeO(L)'], 'FeO(s,l)':['FeO(s)','FeO(L)'],
 'PbO(l)':['PbO(L)'], 'PbO(s,l)':['PbO(rd)','PbO(yw)','PbO(L)'],
 'SiO2(l)':['SiO2(L)'], 'SiO2(s,l)':['SiO2(Lqz)','SiO2(hqz)','SiO2(L)'],
 'CaO(s)':['CaO(s)'], 'MgO(s)':['MgO(s)'], 'Al2O3(s)':['AL2O3(a)'], 'Fe2O3(s)':['Fe2O3(s)'],
 'H2O(l)':['H2O(L)'], 'Zn(l)':['Zn(cr)','Zn(L)'],
}
for k,v in cond.items():
    db[k]={'segs':chain(v),'note':'; '.join(C[n]['thermo'].get('note','') for n in v)}
json.dump(db,open(Path(__file__).resolve().parent.parent/'src'/'thermo.json','w'))
print(len(db),'species'); 
for k,v in db.items(): print(k,[(s[0],s[1]) for s in v['segs']], v['note'])
