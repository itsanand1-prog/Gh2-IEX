# Changelog

All notable changes to this project are documented in this file.

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
