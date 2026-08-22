# Changelog

All notable changes to this project are documented in this file.

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
