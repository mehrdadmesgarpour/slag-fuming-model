# Fuming thermodynamic model: Gibbs energy minimisation with heat balance

A browser-based model of zinc slag fuming with coal and aluminium as reductants. It finds the equilibrium phase assemblage by minimising the total Gibbs energy and closes an enthalpy balance on the result. Standard-state data and slag activity coefficients can come from an external thermodynamic database.

Live page: https://mehrdadmesgarpour.github.io/slag-fuming-model/heat-balance/

Everything runs in the browser. `index.html` is a single self-contained file and can also be opened from disk.

## What it does

- **Batch cycle.** The bath is brought to equilibrium with each time increment of blast, coal and aluminium. The gas then leaves. Output: zinc in slag, fuming rate, bath temperature and oxygen potential against time.
- **Continuous.** One well-mixed stage with product slag and off-gas in mutual equilibrium.
- **Thermal modes.** Heat-balanced mode solves for the bath temperature. Fixed-temperature mode reports the heat surplus or deficit.
- **Heat balance.** Sensible terms, and chemical terms split by element group, so coal oxidation, aluminium oxidation and ZnO reduction appear as separate lines. A mass balance is shown next to it.
- **Equilibrium view.** Slag, gas and pure condensed phases, activities, saturation checks, element potentials, and ΔH°, ΔG° and log K of the main reactions at bath temperature.
- **Sweeps.** Aluminium rate (with an optional coal reduction per kg of aluminium), coal, blast, oxygen enrichment, heat loss, cold charge, γ ZnO and the two-zone share.
- **Database.** Import of external standard-state data and activity coefficients, and a live link to a local database server (below).
- **Formulas.** The 60 governing equations, numbered, with a button that copies them as LaTeX.

The model in the repository root covers more phases and elements (alloy, bullion, matte, copper, cadmium) and can be fitted to plant assays. This page is built around the enthalpy balance. Coal enters with its heat of formation from the heating value, the bath temperature can be solved from the balance, and the heat sources and sinks are itemised. It uses a smaller species set.

## Model in brief

- Gas (ideal, 1 bar standard state): N₂, O₂, CO, CO₂, H₂, H₂O, CH₄, Zn, Pb, PbO, PbS, SO₂, H₂S, S₂, COS.
- Slag: FeO, FeO₁.₅, ZnO, PbO, SiO₂, CaO, AlO₁.₅, MgO on a single-cation mole fraction basis. ZnO, PbO, FeO and FeO₁.₅ carry activity coefficients: constant, regular-solution (ln γ ∝ 1/T), a temperature table, or values from a database server. Their partial excess enthalpies enter the heat balance.
- Pure condensed phases: iron, lead, graphite, magnetite, liquid FeS (matte), and aluminium and silicon as sinks for excess reductant.
- Saturation checks outside the minimisation: CaS (sulfur would dissolve in slag as sulfide) and liquid zinc (low temperature, high pressure).
- Solver: Lagrangian Newton iteration on the element potentials (RAND method, as in NASA CEA), extended to two solution phases, with phase addition and removal, cycle detection and a restart for a vanishing vapour-only gas phase.
- Heat balance: total enthalpies with the elements at 298.15 K as zero, so heats of reaction need no reaction list.
- Optional two-zone setting: a share of the blast burns the bath gas without meeting the slag. It is zero by default and is a fitting parameter.

## Data and standard states

- NASA Glenn seven-coefficient polynomials (McBride, Gordon and Reno, NASA TM-4513, 1993), read from the Cantera 3.2 data files. They refer to 1 bar; the tabulated entropies match the 1-bar JANAF values. Cantera reads these files as 1 atm data because they do not state a pressure. Outside a fitted range the heat capacity is held constant; at bath temperature this applies to liquid FeO (fitted from 1650 K) and liquid SiO₂ (from 1696 K).
- ZnO(s): CODATA values at 298.15 K with Cp = 45.338 + 7.289×10⁻³ T − 5.732×10⁵ T⁻² J/(mol·K). Same data as the root model.
- FeO(l): JANAF FeO(l) with G raised by 5829.5 + 3.1911 T J/mol, so that the activity refers to liquid iron oxide in equilibrium with iron. Same correction as the root model. An independent estimate from Fe + ½O₂ = FeO(s), ΔG° = −263 700 + 64.35 T J, with the JANAF fusion data gives about 8.1 kJ/mol at 1250 °C against 10.7 kJ/mol here. The difference is absorbed by γ FeO.
- Coal: dry ultimate analysis and higher heating value; Channiwala and Parikh (2002) if estimated. Ash is carried as 60 % SiO₂ and 40 % Al₂O₃ and enters as crystalline oxides at 25 °C.

## Linking an external database

All external data must use J/mol and J/(mol K), enthalpy relative to the elements at 298.15 K (SER, as in Calphad and in the NASA and JANAF formation-enthalpy convention) and absolute entropy. Gas data are converted to the model's 1 bar standard pressure.

**By file**, on the Database tab:

| Format | What is read |
|---|---|
| JSON (this model) | any record type below, plus activity coefficients; the page exports this format |
| NASA-7, Chemkin THERMO | 7-coefficient polynomials, composition, phase |
| NASA-9, CEA `thermo.inp` | 9-coefficient polynomials |
| Cantera YAML | NASA7, NASA9, Shomate and constant-cp species (needs the js-yaml script from cdnjs) |
| Calphad TDB | `FUNCTION` and `PARAMETER G(...;0)` of stoichiometric phases and of end members of substitutional solutions; G is differentiated exactly |
| CSV | `species,T,h,s,cp` tables, or `T` (or `T_C`) with columns `ZnO, PbO, FeO, FeO1.5` of activity coefficients |

Records with the formula of a model standard state are matched by composition and name. A record is applied automatically only if it is within 30 kJ/mol of the built-in value at 1250 °C. Others can be chosen in the table, which shows Δg° against the built-in value.

**Live, through a local server.** `tools/thermo_bridge.py` serves data from your computer at `http://127.0.0.1:8765`:

```
python3 tools/thermo_bridge.py --tdb mydatabase.tdb --map map.json      # Calphad, through pycalphad (pip install pycalphad)
python3 tools/thermo_bridge.py --cantera mydata.yaml [--slag-phase NAME --map map.json]
python3 tools/thermo_bridge.py --json dataset.json
```

On the Database tab, connect, load standard states, and ask for activity coefficients of the current slag. "Iterate γ until it settles" repeats the server call and the model solve until ln γ changes by less than 2×10⁻³. With a TDB file the server computes the element chemical potentials of the slag phase alone at the given composition with pycalphad and converts them to activity coefficients relative to the model's standard states, taken from the same database. The map file tells the server which database phases correspond to the model's standard states and slag oxides; the format is in the header of `thermo_bridge.py` and an example is `tests/data/bridge_map.json`.

The live link works when the page is opened from GitHub Pages or from a file in Chrome, Edge or Firefox. Inside the Claude app the page cannot open network connections. A connection to FactSage through ChemApp or to Thermo-Calc through TC-Python can be added as a backend class in `thermo_bridge.py` (`TemplateBackend`); none is included because they need licensed software.

## Verification

Run from this folder:

```
node tests/stress_cases.js          # 13 cases and energy closure in 20 configurations; writes tests/cases.json
node tests/random_cases.js 20000    # randomised cases; optional arguments: N, seed, share without coal or blast
node tests/dbio_tests.js            # file readers (npm install js-yaml for the YAML test)
node tests/bridge_test.js           # local server with TDB (pycalphad), Cantera and JSON backends
python3 tests/verify_cantera.py     # independent minimisation with Cantera's VCS and Gibbs solvers
python3 tests/verify_scipy.py       # independent minimisation with SciPy
```

Results for this version:

- Cantera's VCS and Gibbs multiphase solvers, given the same species data, reach the same minimum within 5.2×10⁻⁷ in G/RT and 10⁻⁶ in species amounts in all 13 cases. The residual is the P·v term of condensed phases in Cantera. SciPy agrees within 3.4×10⁻⁹.
- 44 000 randomised cases over the full input range and 6000 cases at low temperature and high pressure converged. The chemical potential of every species equals the sum of its element potentials to better than 10⁻⁹ in μ/RT.
- The polynomial evaluation reproduces Cantera within 10⁻⁴ J/mol, and the reaction relations on the formula sheet hold on solved states to 10⁻¹⁴.
- Adiabatic flame temperatures of CO and CH₄ in air agree with Cantera within 0.5 K, the effect of Cantera's 1 atm labelling.
- The heat balance items add up to the residual within 10⁻⁸ MW in all modes, with constant, regular and tabulated γ, post-combustion and cold charge.
- Halving the batch time step from 2 to 1 min changes zinc recovery by 0.1 percentage points.
- Built-in data written in each file format and read back are reproduced exactly (CSV tables within 0.005 J/mol). Activity coefficients from a Calphad regular-solution slag through pycalphad match the analytic values within 10⁻⁵.

These checks cover the numerics and the data handling. The model has not been validated against plant data or FactSage.

## Limits

- The result is an equilibrium limit for one well-mixed zone. Tuyere-blown furnaces fume faster than this at the same coal and air rates (Richards, Brimacombe and Toop, Metall. Trans. B, 1985). The two-zone setting can be used to calibrate against plant data.
- The built-in activity coefficients are placeholders that depend on temperature only. Zinc recovery is very sensitive to γ ZnO. Calibrate them or link a database with a slag model.
- The slag enthalpy is that of the component oxides plus the excess enthalpy of the four oxides with activity coefficients. For a fayalite composition the heat to take cold slag to liquid at 1250 °C is 1.36 MJ/kg in the model against 1.54 MJ/kg from the data of Stebbins and Carmichael (Am. Mineral. 69, 1984), so the heat demand of cold charge is about 12 % low.
- Sulfur has no sulfide capacity in the slag. Liquidus, viscosity and kinetics are not modelled. Metallic iron is pure iron and the matte is pure FeS.

## Files

| Path | Content |
|---|---|
| `index.html` | The built page |
| `src/engine.js` | Thermodynamic functions and data formats, Gibbs minimiser, activity models, feeds, heat balance, batch and continuous models |
| `src/dbio.js` | Readers for external data files and matching to the model's standard states |
| `src/thermo.json` | NASA polynomial coefficients for the species used |
| `src/ui.js`, `src/style.css`, `src/body.html` | Interface |
| `src/formulas.html`, `src/formulas_tex.json` | Rendered equations and their LaTeX source |
| `tools/build.py` | Builds `index.html` from `src/` (Python standard library only) |
| `tools/thermo_bridge.py` | Local thermodynamic data server for the live link |
| `tools/render_formulas.js` | Renders the equations with MathJax (`cd tools && npm install && node render_formulas.js`) |
| `tools/extract_thermo.py` | Extracts `src/thermo.json` from the Cantera data files |
| `tests/` | Verification scripts and test data |

To rebuild after editing anything in `src/`:

```
python3 tools/build.py
```
