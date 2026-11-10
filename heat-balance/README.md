# Fuming thermodynamic model: Gibbs energy minimisation with heat balance

A browser-based model of zinc slag fuming with coal and aluminium as reductants. It finds the equilibrium phase assemblage by minimising the total Gibbs energy and closes an enthalpy balance on the result.

Live page: https://mehrdadmesgarpour.github.io/slag-fuming-model/heat-balance/

Everything runs in the browser. `index.html` is a single self-contained file and can also be opened from disk.

## What it does

- **Batch cycle.** The bath is brought to equilibrium with each time increment of blast, coal and aluminium. The gas then leaves. Output: zinc in slag, fuming rate, bath temperature and oxygen potential against time.
- **Continuous.** One well-mixed stage with product slag and off-gas in mutual equilibrium.
- **Thermal modes.** Heat-balanced mode solves for the bath temperature. Fixed-temperature mode reports the heat surplus or deficit.
- **Heat balance.** Sensible terms, and chemical terms split by element group, so coal oxidation, aluminium oxidation and ZnO reduction appear as separate lines. A mass balance is shown next to it.
- **Equilibrium view.** Slag, gas and pure condensed phases, activities, element potentials, and ΔH°, ΔG° and log K of the main reactions at bath temperature.
- **Sweeps.** Aluminium rate (with an optional coal reduction per kg of aluminium), coal, blast, oxygen enrichment, heat loss, cold charge, γ ZnO and the two-zone share.
- **Formulas.** The governing equations, numbered, with a button that copies them as LaTeX.

The model in the repository root covers more phases and elements (alloy, bullion, matte, copper, cadmium) and can be fitted to plant assays. This page is built around the enthalpy balance. Coal enters with its heat of formation from the heating value, the bath temperature can be solved from the balance, and the heat sources and sinks are itemised. It uses a smaller species set.

## Model in brief

- Gas (ideal): N₂, O₂, CO, CO₂, H₂, H₂O, CH₄, Zn, Pb, PbO, PbS, SO₂, H₂S, S₂, COS.
- Slag: FeO, FeO₁.₅, ZnO, PbO, SiO₂, CaO, AlO₁.₅, MgO on a single-cation mole fraction basis. ZnO, PbO, FeO and FeO₁.₅ carry constant activity coefficients set by the user.
- Pure condensed phases: iron, lead, graphite, magnetite, and aluminium and silicon as sinks for excess reductant.
- Solver: Lagrangian Newton iteration on the element potentials (RAND method, as in NASA CEA), extended to two solution phases, with phase addition and removal.
- Heat balance: total enthalpies with the elements at 298.15 K as zero, so heats of reaction need no reaction list.
- Optional two-zone setting: a share of the blast burns the bath gas without meeting the slag. It is zero by default and is a fitting parameter.

## Data and standard states

- NASA Glenn seven-coefficient polynomials (McBride, Gordon and Reno, NASA TM-4513, 1993), read from the Cantera 3.2 data files. Outside a fitted range the heat capacity is held constant.
- ZnO(s): CODATA values at 298.15 K with Cp = 45.338 + 7.289×10⁻³ T − 5.732×10⁵ T⁻² J/(mol·K). Same data as the root model.
- FeO(l): JANAF FeO(l) with G raised by 5829.5 + 3.1911 T J/mol, so that the activity refers to liquid iron oxide in equilibrium with iron. Same correction as the root model. An independent estimate from Fe + ½O₂ = FeO(s), ΔG° = −263 700 + 64.35 T J, with the JANAF fusion data gives about 8.1 kJ/mol at 1250 °C against 10.7 kJ/mol here. The difference is absorbed by γ FeO.
- Slag standard states: liquid FeO, PbO and SiO₂; solid ZnO, CaO, MgO, α-Al₂O₃ and hematite. For ZnO, PbO, FeO and FeO₁.₅ these match the root model, so activity coefficients fitted there carry over as long as copper and cadmium oxides are minor.
- Coal: dry ultimate analysis and higher heating value. The heating value can be estimated with the Channiwala and Parikh (2002) correlation. Ash is carried as 60 % SiO₂ and 40 % Al₂O₃.

## Verification

Run from this folder:

```
node tests/stress_cases.js          # 13 cases plus energy closure, writes tests/cases.json
node tests/random_cases.js 20000    # randomised cases, optional arguments: N, seed, share without coal or blast
python3 tests/verify_scipy.py       # needs cantera, scipy, numpy
```

Results for this version:

- 44 000 randomised equilibrium cases converged without failure. The chemical potential of every species equals the sum of its element potentials to better than 10⁻⁹ in μ/RT.
- In 13 cases the minimum G/RT was compared with an independent SciPy (SLSQP) minimisation that uses Cantera to evaluate the species data. It agreed within 5×10⁻⁸ in all cases and within 3×10⁻⁹ in eleven, which is the level of the SciPy element balance residual.
- The heat balance items add up to the residual within 10⁻⁸ MW in batch and continuous mode.

These checks cover the numerics and the data handling. The model has not been validated against plant data or FactSage.

## Limits

- The result is an equilibrium limit for one well-mixed zone. Tuyere-blown furnaces fume faster than this at the same coal and air rates (Richards, Brimacombe and Toop, Metall. Trans. B, 1985). The two-zone setting can be used to calibrate against plant data.
- Constant activity coefficients are a coarse slag model. The defaults are placeholders. Zinc recovery is very sensitive to γ ZnO.
- Slag enthalpy is the sum of the component oxides. Heats of mixing, including the heat of dissolving Al₂O₃ formed from aluminium, are neglected.
- Liquidus, viscosity and kinetics are not modelled. Sulfur does not dissolve in the slag. Metallic iron is pure iron. No matte, speiss or alloy phase is included.

## Files

| Path | Content |
|---|---|
| `index.html` | The built page |
| `src/engine.js` | Thermodynamic functions, Gibbs minimiser, feeds, heat balance, batch and continuous models |
| `src/thermo.json` | NASA polynomial coefficients for the species used |
| `src/ui.js`, `src/style.css`, `src/body.html` | Interface |
| `src/formulas.html`, `src/formulas_tex.json` | Rendered equations and their LaTeX source |
| `tools/build.py` | Builds `index.html` from `src/` (Python standard library only) |
| `tools/render_formulas.js` | Renders the equations with MathJax (`cd tools && npm install && node render_formulas.js`) |
| `tools/extract_thermo.py` | Extracts `src/thermo.json` from the Cantera data files |
| `tests/` | Verification scripts |

To rebuild after editing anything in `src/`:

```
python3 tools/build.py
```
