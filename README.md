# Slag fuming furnace – Gibbs energy minimisation model

A browser-based thermodynamic model of copper slag fuming with coal and aluminium reductants. It predicts fume production, zinc, lead and cadmium recovery, and the composition of the discard slag, matte and metal over a fuming cycle.

Open `index.html` in any modern browser, or visit the GitHub Pages site for this repository. Everything runs in the visitor's browser: there is no server, and inputs and pasted plant data never leave the visitor's computer.

## What it does

- Splits the fuming cycle into steps. In each step, part of the bath reaches equilibrium with that step's coal, blast air and aluminium in the tuyere reaction zone. The gas, carrying Zn, Pb, PbO, PbS and Cd vapour, leaves the bath as fume.
- Finds each equilibrium by minimising the total Gibbs energy of the gas, slag, iron alloy, Cu–Pb bullion, matte and pure solid phases (Gordon–McBride/RAND method with automatic phase addition and removal).
- Reports reaction ΔH°, ΔG° and log K for the main fuming reactions, runs sensitivity sweeps, and calibrates the model to measured slag assays with a Nelder–Mead optimiser.

## Verification

- The Gibbs minimiser agrees with Cantera's independent VCS multiphase solver to better than 1 part in 10⁷ across 13 test cases.
- The thermodynamic data were checked against SUPCRT16, NASA CEA, the CRC Handbook, Calphad assessments and the Reed (1971) Ellingham atlas.
- The slag activity coefficients and the reaction-zone turnover are calibration parameters. Fit them to plant data before using the results for decisions.

## Data sources

Most standard-state data are NASA Glenn polynomials (McBride, Zehe and Gordon, 2002). ZnO, ZnS, CdO and Cd(g) are built from 298 K data with heat-capacity equations. Cu₂S follows the Cu–S Calphad assessment of Lee et al. (2007), and FeO(l) is referenced to iron-saturated liquid iron oxide using the Calphad Fe–O description.

## Fonts

Barlow and Barlow Semi Condensed are embedded under the SIL Open Font License.
