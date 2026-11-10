/* Governing equations of the model, written in LaTeX and rendered to inline SVG at build time (MathJax 3).
   Output: src/formulas.html (HTML fragment for the Formulas tab) and src/formulas_tex.json (LaTeX source for copying).
   Usage: cd tools && npm install && node render_formulas.js, then python3 tools/build.py */
const fs = require('fs');
const path = require('path');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

const r = String.raw;
const SECTIONS = [
  { title: 'Minimisation problem',
    text: 'At bath temperature T and pressure P the model finds the amounts n<sub>i</sub> of all species that minimise the total Gibbs energy while conserving every element. a<sub>ij</sub> is the number of atoms of element j in species i and b<sub>j</sub> is the amount of element j fed. N<sub>g</sub> and N<sub>s</sub> are the total moles of gas and slag. Slag species are single-cation oxides.',
    eqs: [
      r`\min_{n}\; G(T,P,n)=\sum_{i} n_i\,\mu_i \qquad\text{subject to}\qquad \sum_i a_{ij}\,n_i=b_j\;\;(j=1,\dots,E),\qquad n_i\ge 0`,
      r`\text{gas:}\qquad \frac{\mu_i}{RT}=\frac{g_i^\circ(T)}{RT}+\ln\frac{n_i}{N_\mathrm{g}}+\ln\frac{P}{P^\circ}`,
      r`\text{slag:}\qquad \frac{\mu_i}{RT}=\frac{g_i^\circ(T)}{RT}+\ln\gamma_i+\ln x_i,\qquad x_i=\frac{n_i}{N_\mathrm{s}},\qquad a_i=\gamma_i\,x_i`,
      r`\text{pure condensed phase:}\qquad \frac{\mu_c}{RT}=\frac{g_c^\circ(T)}{RT}`,
      r`g_i^\circ(T)=h_i^\circ(T)-T\,s_i^\circ(T)`
    ] },
  { title: 'Conditions at the minimum',
    text: 'The Lagrange multipliers of the element balances are the element potentials λ<sub>j</sub>. At the minimum every species that is present has a chemical potential equal to the sum of its element potentials. A phase that is absent must not be able to lower G by forming. Activities and partial pressures are reported from the element potentials, so they are also defined for species and phases that are absent.',
    eqs: [
      r`\frac{\mu_i}{RT}=\sum_j a_{ij}\,\pi_j \quad\text{for every species present},\qquad \pi_j=\frac{\lambda_j}{RT}`,
      r`\text{pure phase:}\qquad a_c=\exp\!\Big(\sum_j a_{cj}\,\pi_j-\frac{g_c^\circ}{RT}\Big)\;\le 1,\qquad a_c=1\ \text{when the phase is present}`,
      r`\text{absent gas or slag phase }p:\qquad Q_p=\sum_{i\in p}\exp\!\Big(\sum_j a_{ij}\,\pi_j-\frac{g_i^\circ}{RT}-c_i\Big)\le 1,\qquad c_i=\begin{cases}\ln(P/P^\circ) & \text{gas}\\[2pt] \ln\gamma_i & \text{slag}\end{cases}`,
      r`p_i=P^\circ\exp\!\Big(\sum_j a_{ij}\,\pi_j-\frac{g_i^\circ}{RT}\Big),\qquad\text{for example}\quad p_{\mathrm{O_2}}=P^\circ\exp\!\Big(2\,\pi_\mathrm{O}-\frac{g^\circ_{\mathrm{O_2}}}{RT}\Big)`,
      r`G_{\min}=RT\sum_j \pi_j\,b_j`
    ] },
  { title: 'Newton iteration',
    text: 'The unknowns of each iteration are the element potentials π<sub>j</sub>, the change of each solution-phase total Δln N<sub>p</sub>, and the change of each pure-phase amount Δn<sub>c</sub>. The species corrections follow from them. This is the RAND method of White, Johnson and Dantzig as used in NASA CEA, extended to two solution phases. Trace species are also limited so that they cannot rise above a mole fraction of 10<sup>−4</sup> in one step. After convergence a pure phase with a<sub>c</sub> &gt; 1 is added, a pure phase with a negative amount is removed, and a solution phase with Q<sub>p</sub> &gt; 1 is switched on.',
    eqs: [
      r`\Delta\ln n_i=\Delta\ln N_p+\sum_j a_{ij}\,\pi_j-\frac{\mu_i}{RT}\qquad (i\in p)`,
      r`\sum_j\Big(\sum_i a_{ik}\,a_{ij}\,n_i\Big)\pi_j+\sum_p\Big(\sum_{i\in p}a_{ik}\,n_i\Big)\Delta\ln N_p+\sum_c a_{ck}\,\Delta n_c = b_k-\sum_i a_{ik}\,n_i-\sum_c a_{ck}\,n_c+\sum_i a_{ik}\,n_i\,\frac{\mu_i}{RT}`,
      r`\sum_j\Big(\sum_{i\in p}a_{ij}\,n_i\Big)\pi_j+\Big(\sum_{i\in p}n_i-N_p\Big)\Delta\ln N_p = N_p-\sum_{i\in p}n_i+\sum_{i\in p}n_i\,\frac{\mu_i}{RT}`,
      r`\sum_j a_{cj}\,\pi_j=\frac{g_c^\circ}{RT}\qquad\text{for each pure phase present}`,
      r`\ln n_i\leftarrow\ln n_i+\omega\,\Delta\ln n_i,\qquad \ln N_p\leftarrow\ln N_p+\omega\,\Delta\ln N_p,\qquad n_c\leftarrow n_c+\omega\,\Delta n_c`,
      r`\omega=\min\!\Big(1,\ \frac{2}{\max\big(5\,|\Delta\ln N_p|,\ |\Delta\ln n_i|\big)}\Big)`
    ] },
  { title: 'Standard-state functions',
    text: 'Species data are NASA seven-coefficient polynomials. Enthalpies are absolute: the elements in their reference states at T<sub>0</sub> = 298.15 K have zero enthalpy, so h°(T<sub>0</sub>) is the enthalpy of formation. Outside a fitted range, with T<sub>b</sub> the nearest range limit, the heat capacity is held constant. ZnO uses a three-term heat capacity with a = 45.338, b = 7.289×10<sup>−3</sup>, c = −5.732×10<sup>5</sup> (J, mol, K). The FeO correction refers its activity to liquid iron oxide in equilibrium with iron.',
    eqs: [
      r`\frac{c_p^\circ}{R}=a_1+a_2T+a_3T^2+a_4T^3+a_5T^4`,
      r`\frac{h^\circ}{RT}=a_1+\frac{a_2}{2}T+\frac{a_3}{3}T^2+\frac{a_4}{4}T^3+\frac{a_5}{5}T^4+\frac{a_6}{T}`,
      r`\frac{s^\circ}{R}=a_1\ln T+a_2T+\frac{a_3}{2}T^2+\frac{a_4}{3}T^3+\frac{a_5}{4}T^4+a_7`,
      r`h^\circ(T)=h^\circ(T_b)+c_p^\circ(T_b)\,(T-T_b),\qquad s^\circ(T)=s^\circ(T_b)+c_p^\circ(T_b)\,\ln\frac{T}{T_b}\qquad\text{outside the fitted range}`,
      r`\text{ZnO:}\qquad c_p^\circ=a+bT+cT^{-2},\qquad h^\circ(T)=\Delta_\mathrm{f}H^\circ_{298}+a\,(T-T_0)+\frac{b}{2}\,(T^2-T_0^2)-c\Big(\frac{1}{T}-\frac{1}{T_0}\Big)`,
      r`\text{ZnO:}\qquad s^\circ(T)=S^\circ_{298}+a\ln\frac{T}{T_0}+b\,(T-T_0)-\frac{c}{2}\Big(\frac{1}{T^2}-\frac{1}{T_0^2}\Big)`,
      r`g^\circ_{\mathrm{FeO(l)}}=g^{\circ,\,\mathrm{JANAF}}_{\mathrm{FeO(l)}}+5829.5+3.1911\,T\qquad[\mathrm{J\,mol^{-1}}]`
    ] },
  { title: 'Equilibria in the bath',
    text: 'These relations are not imposed. They follow from the conditions at the minimum and are the usual way to read the result. K is the equilibrium constant of the reaction written with pure-species standard states. The Equilibrium tab lists Δ<sub>r</sub>H°, Δ<sub>r</sub>G° and log K at the bath temperature. Aluminium reacts to completion, so its capacity is set by stoichiometry.',
    eqs: [
      r`\Delta_\mathrm{r}G^\circ=\sum_i\nu_i\,g_i^\circ,\qquad \Delta_\mathrm{r}H^\circ=\sum_i\nu_i\,h_i^\circ,\qquad K=\exp\!\Big(-\frac{\Delta_\mathrm{r}G^\circ}{RT}\Big)`,
      r`\mathrm{ZnO_{(slag)}+CO=Zn_{(g)}+CO_2}:\qquad p_\mathrm{Zn}=K_\mathrm{Zn}\;\gamma_\mathrm{ZnO}\,x_\mathrm{ZnO}\;\frac{p_\mathrm{CO}}{p_{\mathrm{CO_2}}}`,
      r`\mathrm{FeO_{(slag)}+CO=Fe+CO_2}:\qquad a_\mathrm{Fe}=K_\mathrm{Fe}\;\gamma_\mathrm{FeO}\,x_\mathrm{FeO}\;\frac{p_\mathrm{CO}}{p_{\mathrm{CO_2}}}`,
      r`\mathrm{FeO+\tfrac14\,O_2=FeO_{1.5}}:\qquad \frac{x_{\mathrm{FeO_{1.5}}}}{x_\mathrm{FeO}}=K_\mathrm{ox}\;\frac{\gamma_\mathrm{FeO}}{\gamma_{\mathrm{FeO_{1.5}}}}\;p_{\mathrm{O_2}}^{1/4}`,
      r`\mathrm{3\,ZnO+2\,Al=3\,Zn_{(g)}+Al_2O_3}:\qquad m_\mathrm{Zn}^{\max}=\frac{3\,M_\mathrm{Zn}}{2\,M_\mathrm{Al}}\;m_\mathrm{Al}=3.63\;m_\mathrm{Al}`
    ] },
  { title: 'Feeds',
    text: 'The slag assay is converted to moles of slag species per kilogram, with w in wt% and f<sub>3</sub> the ferric share of iron. The enthalpy of dry coal at T<sub>0</sub> follows from its higher heating value and the enthalpies of its combustion products, with w the mass fractions of dry coal, m<sub>d</sub> the dry mass and n<sub>w</sub> the moles of moisture. If the heating value is estimated, the Channiwala and Parikh correlation is used with the analysis in wt% dry and A the ash. Blast volume is at 0 °C and 101 325 Pa. f<sub>m</sub> is the metallic share of the aluminium feed.',
    eqs: [
      r`n_\mathrm{ZnO}=\frac{10\,w_\mathrm{Zn}}{M_\mathrm{Zn}},\qquad n_\mathrm{FeO}=\frac{10\,w_\mathrm{Fe}\,(1-f_3)}{M_\mathrm{Fe}},\qquad n_{\mathrm{FeO_{1.5}}}=\frac{10\,w_\mathrm{Fe}\,f_3}{M_\mathrm{Fe}},\qquad n_{\mathrm{AlO_{1.5}}}=\frac{20\,w_{\mathrm{Al_2O_3}}}{M_{\mathrm{Al_2O_3}}}\qquad[\mathrm{mol\,kg^{-1}}]`,
      r`H_\mathrm{coal}(T_0)=m_\mathrm{d}\Big[\mathrm{HHV}+\frac{w_\mathrm{C}}{M_\mathrm{C}}\,h^\circ_{\mathrm{CO_2}}+\frac{w_\mathrm{H}}{2M_\mathrm{H}}\,h^\circ_{\mathrm{H_2O(l)}}+\frac{w_\mathrm{S}}{M_\mathrm{S}}\,h^\circ_{\mathrm{SO_2}}\Big]+n_\mathrm{w}\,h^\circ_{\mathrm{H_2O(l)}}+H_\mathrm{ash}(T_0)`,
      r`\mathrm{HHV}=0.3491\,C+1.1783\,H+0.1005\,S-0.1034\,O-0.0151\,N-0.0211\,A\qquad[\mathrm{MJ\,kg^{-1}}]`,
      r`\dot n_{\mathrm{O_2}}=x_{\mathrm{O_2}}\,\dot V_\mathrm{n}\,\frac{P_\mathrm{n}}{R\,T_\mathrm{n}},\qquad \dot n_{\mathrm{N_2}}=(1-x_{\mathrm{O_2}})\,\dot V_\mathrm{n}\,\frac{P_\mathrm{n}}{R\,T_\mathrm{n}},\qquad \frac{P_\mathrm{n}}{R\,T_\mathrm{n}}=44.62\ \mathrm{mol\,Nm^{-3}}`,
      r`\dot n_\mathrm{Al}=\frac{f_\mathrm{m}\,\dot m_\mathrm{Al}}{M_\mathrm{Al}},\qquad \dot n_{\mathrm{AlO_{1.5}}}=\frac{2\,(1-f_\mathrm{m})\,\dot m_\mathrm{Al}}{M_{\mathrm{Al_2O_3}}}`
    ] },
  { title: 'Heat balance',
    text: 'The enthalpy of a stream or phase is the sum over its species. Because the activity coefficients do not depend on temperature, the slag has no excess enthalpy. The balance is written with total enthalpies, so heats of reaction are included without listing reactions. Q<sub>net</sub> is the surplus in fixed-temperature mode. In heat-balanced mode the bath temperature is the root of f(T) between 800 and 2000 °C, with the equilibrium recomputed at every trial temperature. For display, Q<sub>net</sub> is split into sensible terms relative to T<sub>0</sub> and chemical terms Q<sub>g</sub> for the element groups g: coal (C, H, S), Al, Zn, Pb, Fe and Si. Q<sub>melt</sub> is the heat needed to bring cold charge from its crystalline state to the slag standard state.',
    eqs: [
      r`H=\sum_i n_i\,h_i^\circ(T),\qquad H^{\mathrm{E}}=-T^2\,\frac{\partial}{\partial T}\Big(\frac{G^{\mathrm{E}}}{T}\Big)=0\quad\text{for}\quad G^{\mathrm{E}}=RT\sum_i n_i\ln\gamma_i`,
      r`\sum_k H_k(T_k)=H_\mathrm{slag}(T)+H_\mathrm{gas}(T)+H_\mathrm{cond}(T)+Q_\mathrm{loss}+Q_\mathrm{net}`,
      r`f(T)=H_\mathrm{slag}(T)+H_\mathrm{gas}(T)+H_\mathrm{cond}(T)+Q_\mathrm{loss}-\sum_k H_k(T_k)=0`,
      r`Q_\mathrm{net}=\underbrace{\sum_k\big[H_k(T_k)-H_k(T_0)\big]}_{\text{sensible heat of feeds}}+\underbrace{\sum_g Q_g+Q_\mathrm{melt}}_{\text{chemical heat}}-\underbrace{\sum_{\text{products}}n_i\big[h_i^\circ(T)-h_i^\circ(T_0)\big]}_{\text{sensible heat of products}}-Q_\mathrm{loss}`,
      r`Q_g=\sum_{i\in g}^{\text{feeds}}n_i\,h_i^\circ(T_0)-\sum_{i\in g}^{\text{products}}n_i\,h_i^\circ(T_0)`,
      r`Q_\mathrm{melt}=\sum_i n_i^{\mathrm{cold}}\big[h_i^{\mathrm{cryst}}(T_0)-h_i^{\mathrm{slag}}(T_0)\big]\;\le 0`
    ] },
  { title: 'Batch cycle',
    text: 'In step k the bath left by the previous step is combined with the feeds of one time increment Δt and brought to equilibrium. The gas leaves at the bath temperature T<sub>k</sub> and the condensed phases form the next bath. In heat-balanced mode the step energy balance gives T<sub>k</sub>. Recovery counts the zinc vapour leaving the bath. Direct CO<sub>2</sub> assumes that all coal carbon ends as CO<sub>2</sub> after post-combustion.',
    eqs: [
      r`b_j^{(k)}=\sum_i a_{ij}\,n_i^{\mathrm{bath},(k-1)}+\Delta t\sum_f \dot b_{j,f}`,
      r`H_\mathrm{bath}^{(k-1)}+\Delta t\sum_f \dot H_f=H_\mathrm{bath}^{(k)}(T_k)+H_\mathrm{gas}^{(k)}(T_k)+\dot Q_\mathrm{loss}\,\Delta t`,
      r`R_\mathrm{Zn}=\frac{\sum_k n_{\mathrm{Zn(g)}}^{(k)}}{n_\mathrm{Zn}^{\mathrm{feed}}},\qquad m_{\mathrm{CO_2}}=n_\mathrm{C}^{\mathrm{coal}}\,M_{\mathrm{CO_2}}`
    ] },
  { title: 'Two-zone option',
    text: 'A share φ of the blast does not meet the slag. The bath equilibrates with the remaining blast and releases gas A. Gas A then reacts with the bypassed blast to a gas-only equilibrium B at the bath temperature. A fraction η of the heat released returns to the bath.',
    eqs: [
      r`Q_\mathrm{pc}=H_\mathrm{gas}^{\mathrm{A}}(T)+\varphi\,H_\mathrm{blast}-H_\mathrm{gas}^{\mathrm{B}}(T)`,
      r`\sum_{k\neq\text{blast}}H_k(T_k)+(1-\varphi)\,H_\mathrm{blast}+\eta\,Q_\mathrm{pc}=H_\mathrm{slag}(T)+H_\mathrm{cond}(T)+H_\mathrm{gas}^{\mathrm{A}}(T)+Q_\mathrm{loss}`
    ] }
];
const NOMENCLATURE = [
  ['a<sub>ij</sub>', 'atoms of element j in species i', '–'], ['a<sub>i</sub>, a<sub>c</sub>', 'activity of a slag species or pure phase', '–'],
  ['b<sub>j</sub>', 'amount of element j in the system', 'mol'], ['g°, h°, s°, c<sub>p</sub>°', 'standard molar Gibbs energy, enthalpy, entropy, heat capacity', 'J mol⁻¹, J mol⁻¹ K⁻¹'],
  ['G, H', 'total Gibbs energy and enthalpy', 'J'], ['K', 'equilibrium constant', '–'], ['M', 'molar mass', 'g mol⁻¹'],
  ['n<sub>i</sub>, N<sub>p</sub>', 'amount of species i, total amount in phase p', 'mol'], ['P, P°, p<sub>i</sub>', 'pressure, standard pressure (1 bar), partial pressure', 'bar'],
  ['Q', 'heat term of the balance', 'J or W'], ['T, T<sub>0</sub>', 'temperature, 298.15 K', 'K'], ['w', 'mass fraction or wt%, as stated', '–'],
  ['x<sub>i</sub>, γ<sub>i</sub>', 'mole fraction and activity coefficient in the slag', '–'], ['μ<sub>i</sub>, λ<sub>j</sub>, π<sub>j</sub>', 'chemical potential, element potential, λ<sub>j</sub>/RT', 'J mol⁻¹, –'],
  ['ν<sub>i</sub>', 'stoichiometric coefficient', '–'], ['φ, η', 'blast share burnt above the bath, share of that heat returned', '–'], ['ω', 'step length of the Newton iteration', '–']
];

const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: AllPackages });
const svg = new SVG({ fontCache: 'global' });
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
let n = 0, html = '', texOut = '% Fuming thermodynamic model: governing equations\n';
SECTIONS.forEach(sec => {
  html += '<div class="block fsec"><h2>' + sec.title + '</h2><p class="ftext">' + sec.text + '</p>\n';
  texOut += '\n% ' + sec.title + '\n';
  sec.eqs.forEach(e => {
    n++;
    const node = doc.convert(e, { display: true, em: 16, ex: 8, containerWidth: 1200 });
    let s = adaptor.innerHTML(node);
    if (/data-mjx-error|merror/.test(s)) throw new Error('TeX error in equation ' + n + ': ' + e);
    s = s.replace('<svg ', '<svg aria-hidden="true" ').replace(/ data-[a-z-]+="[^"]*"/g, '');
    html += '<div class="eq" role="math" aria-label="' + esc(e) + '"><div class="eqm">' + s + '</div><span class="eqn">(' + n + ')</span></div>\n';
    texOut += '\\begin{equation}\n' + e + '\n\\end{equation}\n';
  });
  html += '</div>\n';
});
html += '<div class="block"><h2>Symbols</h2><div class="scroll"><table><thead><tr><th>Symbol</th><th>Meaning</th><th>Unit</th></tr></thead><tbody>' +
  NOMENCLATURE.map(r0 => '<tr class="row"><td>' + r0[0] + '</td><td>' + r0[1] + '</td><td>' + r0[2] + '</td></tr>').join('') + '</tbody></table></div></div>\n';
/* glyph outlines shared by all equations */
html = '<svg style="display:none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' + adaptor.outerHTML(svg.fontCache.getCache()).replace(/ data-[a-z-]+="[^"]*"/g, '') + '</svg>\n' + html;
const out = path.join(__dirname, '..', 'src');
fs.writeFileSync(path.join(out, 'formulas.html'), html);
fs.writeFileSync(path.join(out, 'formulas_tex.json'), JSON.stringify(texOut));
console.log(n, 'equations,', html.length, 'bytes of HTML');
