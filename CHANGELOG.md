# Changelog

All notable changes to this project are documented in this file.

## [2.1.2] - 2026-09-25

### Fixed
- **The repricing NPV-neutrality check compared against the wrong baseline.**
  It measured the PV-levelised block price against the headline LCOH, which
  amortises capital over the user's recovery period, while the block prices
  span the whole plant life and the rate base credits no residual. At the
  application's own defaults (N=7, plant life 20) this displayed Rs 268.5/kg
  beside Rs 312.1/kg — a Rs 43.7/kg gap on the one line the specification
  describes as "a key trust signal". It now compares like-for-like against a
  flat price recovering the same capital over the same horizon, which agrees
  to Rs 0.37/kg, and separately explains why the headline tile differs.
  Found by auditing the scenario space rather than by the test suite, which
  had only ever exercised the case where N equals plant life.

### Added
- Ten further tests pinning the neutrality identity across N = 3…20 and plant
  lives of 10–30, asserting it holds against the plant-life benchmark and
  *not* against the headline LCOH, that capital recovery alone is exact to
  1e-6 at every plant life, and that the known stack-financing divergence
  beyond one replacement stays bounded.
- On-screen explanations when the check is affected by a residual credit or
  by more than one stack replacement, instead of an unexplained number.

### Known limitation
- The flat LCOH funds every stack replacement through a sinking fund; the
  repricing schedule follows the specification's pseudocode and funds one.
  They agree at zero or one replacement, covering the default 20-year plant
  life; beyond ~21 years they diverge by about Rs 1.7/kg. Documented in the
  README and surfaced in the dashboard.

## [2.1.1] - 2026-09-25

### Changed
- Minimum operation time options are now plain values — `0.5 h`, `1 h`,
  `2 h`, `4 h` — with no electrolyser-chemistry annotation. The chemistry
  does not enter the LCOH formula, so labelling the options by it implied a
  distinction the model does not make. It is presented as what it is: a
  dispatch constraint the user sets.

## [2.1.0] - 2026-09-25

### Fixed
- **The minimum operation time defaulted to 0.5 h instead of 2 h.** The
  specification states its reference cases at a 2 h minimum run, and 2 h is
  the only setting that reproduces the published operating hours: summed
  across the seven reference cases the error is 1 h at a 2 h minimum,
  against 116 h at 0.5 h, 89 h at 1 h and 150 h at 4 h. The published
  optimum ceilings match to ±0.01 at 2 h, against +0.04 to +0.06 at 0.5 h.
  Displayed LCOH is unaffected — it is ≈ Rs 268.1/kg at the reference case
  under every setting, which is precisely why the original test suite did
  not catch this. Operating hours, capacity factor and the optimum ceiling
  all shift slightly as a result of the correction.

### Added
- Regression tests that would have caught the above: the reference cases now
  assert published **hours and capacity factor** alongside LCOH; a new suite
  asserts that 2 h reproduces the published hours, that every other setting
  is materially worse, and that the application's own default resolves to
  that same sweep key.

### Changed
- "Minimum run block" is now labelled **Minimum operation time**, with help
  text explaining the extend-or-discard rule and why only four values are
  offered.
- README documents the setting, the chemistry choice, and the data
  constraint that makes it a fixed four-option selector rather than a free
  numeric input.

## [2.0.0] - 2026-08-22

Implements revision 2 of the specification. `data.js`, `data.json` and
`generate_data.py` are unchanged — the pre-computed sweep is a function of
GDAM prices only and is unaffected by cost-side parameters.

### Added
- **Additional charges and subsidies.** Six new inputs, all defaulting to
  zero so out-of-the-box output is numerically identical to 1.0.0:
  additional capex (Rs/kW) and additional opex with a five-way unit
  selector in the basic panel; capital, production and power subsidies in
  the Assumptions panel. A live `= Rs X/kg` readout converts the entered
  opex into per-kg terms at current settings.
- Cost breakdown gains a conditional additional-opex row and a conditional
  combined subsidies row, with shares taken against gross cost before
  subsidies, a `<details>` breakdown of the subsidy components, and a
  gross/net capex tooltip on the capital recovery row.
- Cost stack chart gains an additional-opex segment and, when subsidies are
  present, a separate leftward bar from the same origin plus a labelled net
  LCOH tick.
- On-screen note beside the capacity slider when a `Rs/year` lump sum is
  entered, the one input unit that legitimately breaks MW-invariance.
- Test suite grows to 152 cases: zero-default inertness, the
  specification's worked cases A–I, exact additivity of the combined case,
  MW-invariance with charges applied and the lump-sum exception, subsidy
  monotonicity across every year and state, the capex clamp, O&M
  independence from capital subsidy, and repricing NPV-neutrality with
  charges applied.

### Changed
- **Charts are now drawn in real pixels.** The `viewBox` +
  `preserveAspectRatio` scaling that shrank chart text has been removed
  entirely; each chart measures its container, sets real `width`/`height`,
  draws in pixel coordinates, and re-renders through a `ResizeObserver`.
  Axis labels are 14 px, axis titles 15 px and chart titles 17 px at every
  viewport size. Chart heights are 460 px for the LCOH centrepiece, 400 px
  for the duration curve and 340 px for the rest.
- **The price duration curve now reads cheapest to most expensive, left to
  right.** It previously ran descending, contradicting its own axis title.
  It gains the mandated title and axis titles, in-plot `Your ceiling` and
  operating-hours labels, shaded "Hours the plant runs" and "Idle" regions,
  and a standing explanatory caption in body text.
- Charts carry in-plot value labels throughout: the current position and
  optimum on the LCOH curve, per-segment values above 5% on the cost stack,
  per-bar percentages plus named weakest/strongest months on monthly
  utilisation, per-bar values and text "pre-regime" badges on the year
  comparison, and per-block prices on the repricing schedule.
- The repricing rate base and depreciation now work off net capex, while
  O&M continues to be charged on gross.
- Data tables under each chart gained explanatory captions, units in every
  numeric column header, and tooltips on non-obvious columns.
- `docs/methodology.pdf` updated to revision 2.

### Fixed
- Grid items could not shrink below the intrinsic width of the SVG they
  contained, so charts never got narrower once rendered wide. Charts now
  track their container in both directions.
- The year-comparison x-axis drew six evenly spaced ticks against four
  categories, duplicating a label.

## [1.0.0] - 2026-08-22

### Added
- Initial release of the GDAM Green Hydrogen LCOH Explorer.
- Pure calculation engine (`model.js`): sweep interpolation, LCOH formula,
  CRF, stack sinking fund, optimum search, and the 3-year regulatory
  repricing module.
- Full dashboard UI (`app.js`, `index.html`, `styles.css`): basic and
  advanced input panels, headline result tiles, persistent LCOH formula
  display, cost breakdown table, landed-price build-up, advisory flags
  (optimum marker, flat-bottom caution, stack timing, historical-context
  note, low-hours caution), six hand-rolled inline-SVG charts with
  accessible data tables, and defensive URL-hash state encoding.
- `docs/methodology.pdf` — the full GDAM GH2 LCOH methodology document,
  linked from the README and from a Help button in the app header.
- Dependency-free Node test suite (`tests/`) covering the numerical
  reference cases, four years' optima, property tests (MW invariance,
  monotonicity, weighted-mean bound, state ordering, repricing
  NPV-neutrality, CRF identities, hash round-trip), documented edge cases,
  and a 1,000-case fuzz test of adversarial URL hashes.
- CI workflow running the test suite on every push, and a GitHub Pages
  deploy workflow.
- `SECURITY.md` documenting the (deliberately minimal) attack surface.
