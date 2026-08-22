# GDAM Green Hydrogen LCOH Explorer

A zero-dependency, zero-network-request static dashboard that computes the
**levelised cost of hydrogen (LCOH, Rs/kg)** for an Indian green-hydrogen
developer who buys grid power from the **IEX Green Day-Ahead Market (GDAM)**
at 15-minute block prices — no captive renewable plant, no battery storage —
and runs an alkaline electrolyser only when the landed power price is below
a chosen ceiling.

It is computed against **four full years of real historical GDAM block
prices**, so you can see how the economics would have played out in each of
the last four years, not just a single averaged assumption.

The full derivation is in [`docs/methodology.pdf`](docs/methodology.pdf) —
also reachable from the **Help / Methodology** button in the app header.

## What the tool does

1. You set a plant size, a state, a price year, a **maximum landed power
   price (ceiling)**, and the usual capex/opex/financial assumptions.
2. The electrolyser is assumed to run in every 15-minute block whose landed
   price is at or below your ceiling (subject to a configurable minimum
   run-length rule — see below), across the whole year.
3. From that, the tool derives operating hours, annual hydrogen output,
   capex, and the LCOH — split out by capital recovery, O&M, stack
   replacement, power and water.
4. It also finds the LCOH-minimising ceiling for your settings, and can
   model a 3-year regulatory-style repricing schedule as an alternative to
   a single flat tariff.

## Method

### Landed cost

```
landed (Rs/unit) = (MCP + adder) × loss_factor
```

`MCP` is the IEX GDAM unconstrained market-clearing price (Rs/kWh). `adder`
and `loss_factor` are state-specific open-access charges/losses:

| State | Adder (Rs/unit) | Loss factor | Notes |
|---|---|---|---|
| Gujarat | 0.250 | 1.065 | 50% wheeling waiver, ISTS waived |
| Rajasthan | 0.365 | 1.088 | 50% wheeling waiver, ISTS waived |

### Why the sweep is computed once, in MCP space

`landed = (MCP + adder) × loss_factor` is a monotonic affine transform of
MCP for any fixed state. Affine monotonic maps preserve both **ordering**
and **means**, so:

- the set of 15-minute blocks selected at a landed-price ceiling `C` is
  identical to the set selected at the MCP threshold `t = C / loss_factor − adder`;
- the minimum-run "extend the window until its mean price still clears the
  ceiling" test gives the same answer in either space.

So a single sweep, built in MCP space, serves every state — the browser
applies the state's own affine transform at lookup time. Adding a new state
later only means adding its `{adder, loss_factor}` pair; it never requires
recomputing the sweep. The minimum-run filter itself is *not*
threshold-invariant (it depends on which blocks are temporally adjacent),
which is why `generate_data.py` emits a separate sweep per minimum-run
setting (0.5 h / 1 h / 2 h / 4 h).

### Minimum-run rule

A block qualifies if its price is at or below the threshold. Runs of
qualifying blocks shorter than the minimum run length are extended
outward — always taking the cheaper of the two adjacent blocks — until they
reach the minimum length, and are kept only if the extended window's mean
price is still at or below the threshold; otherwise the whole window is
discarded. See `generate_data.py` (`apply_minrun`) for the exact algorithm.

### LCOH formula

```
t              = ceiling_landed / loss_factor − adder
(hours, w_mcp) = interpolate(sweep[min_run], t)      // clamped, never extrapolated
landed_avg     = (w_mcp + adder) × loss_factor

annual_kg      = MW × 1000 × hours × load_factor ÷ SEC
capex          = MW × 1000 × capex_per_kW
CRF(r, N)      = r(1+r)^N / ((1+r)^N − 1),  and = 1/N when r = 0

annualised_capex = (capex − capex × residual_pct / (1+r)^N) × CRF(r, N)
annual_om        = capex × om_pct
stack_sinking     = CRF(r, N) × Σ stack_cost / (1+r)^(k × stack_life_hours/hours)
                                 for k = 1, 2, … while k × interval < N

LCOH = (annualised_capex + annual_om + stack_sinking) ÷ annual_kg
       + SEC × landed_avg
       + water_cost_per_kg
```

**Plant size (MW) cancels out of the LCOH entirely** — `annual_kg`, `capex`,
`annual_om` and `stack_sinking` are all linear in MW, so the ratio is
MW-independent. The optimal ceiling, hours and capacity factor are
therefore invariant to plant size; the app notes this next to the capacity
slider and the test suite asserts it directly (`tests/model.test.js`).

### 3-year repricing module

An alternative, regulatory-style cost-of-service tariff with a declining
rate base, computed year-by-year across the full plant life and then
grouped into 3-year blocks (the final block is shorter when plant life
isn't a multiple of three). See `model.js` (`repricingSchedule`) for the
exact recursion. The dashboard displays a validation line showing that the
PV-levelised price over the full plant life matches the flat LCOH — this is
what proves the repricing structure is NPV-neutral rather than a hidden
cross-subsidy.

## Price years

| Key | Period |
|---|---|
| `AY2022-23` | Aug 2022 – Aug 2023 |
| `AY2023-24` | Aug 2023 – Aug 2024 |
| `AY2024-25` | Aug 2024 – Aug 2025 |
| `AY2025-26` | Aug 2025 – Aug 2026 (default) |

Source: IEX GDAM 15-minute block unconstrained MCP, `snapshot_2021_to_2026.xlsx`
(field `MCP (Rs/MWh)` to 2024-02-20, `unconstrained_m_c_p` from 2024-02-21).
`AY2022-23` and `AY2023-24` predate the low-price regime (0 h and 23 h below
Rs1.50/unit respectively) and will show high LCOH — the app flags this and
shows them for trajectory, not as a basis on their own.

## Every default and its provenance

| Field | Default | Provenance |
|---|---|---|
| Price year | AY2025-26 | Most recent full year |
| State | Gujarat | Lower adder/loss factor of the two modelled states |
| Plant capacity | 5.0 MW | Illustrative mid-size electrolyser |
| Max landed power price | Rs 4.98/unit | ≈ the LCOH-minimising ceiling for AY2025-26 Gujarat at the other defaults |
| Capital recovery period | 7 years | Typical debt tenor for this asset class |
| Return / discount rate | 10% | Typical blended cost of capital used in the reference model |
| Electrolyser installed | Rs 39,000/kW | Reference alkaline electrolyser system cost |
| Civil works / site prep | 12% | Reference EPC cost build-up |
| Water treatment DM/RO | 6% | Reference EPC cost build-up |
| Power evacuation, HT yard, transformer | 10% | Reference EPC cost build-up |
| H2 purification, drying, compression | 10% | Reference EPC cost build-up |
| Instrumentation, safety, fire, controls | 6% | Reference EPC cost build-up |
| Owner cost, EPC margin, contingency | 15% | Reference EPC cost build-up |
| **All-in capex (computed)** | **Rs 62,010/kW** | 39,000 × (1 + sum of the above) |
| SEC | 52 kWh/kg | Reference alkaline electrolyser efficiency at rated load |
| Load factor when running | 100% | Assumes full-rate operation whenever the plant runs |
| Minimum run block | 0.5 h (2 blocks) | Matches the numerical reference cases used to validate this build |
| Fixed O&M | 4.0% of capex/yr | Typical industry assumption |
| Water cost | Rs 0.90/kg H₂ | Reference DM water cost at this SEC |
| Stack cost | 40% of electrolyser capex | Reference stack cost share |
| Stack life | 60,000 operating hours | Reference alkaline stack life |
| Residual value | 0% | Conservative default |
| Grey H2 benchmark | Rs 250/kg | Illustrative comparison point, adjustable |
| Plant life | 20 years | Typical electrolyser plant design life |

## What this does NOT model

- No storage or battery — the plant only runs when the live block price
  clears the ceiling, with no ability to shift or firm output.
- No captive renewable generation or PPA — all power is bought from GDAM.
- No price escalation — all figures are real (inflation-adjusted); power is
  held at the chosen representative historical year, not forecast forward.
- Only Gujarat and Rajasthan are modelled.
- **No electricity duty.**
- **No STU demand charges** — roughly Rs 0.30–0.35/unit for EHV-connected
  buyers at high load factor in practice. This is material and is excluded
  here.
- No SIGHT (or any other) subsidy.
- No GST, land cost, insurance, or working capital.
- Four years of price history is a thin statistical basis for a
  twenty-year investment decision, and the low-price regime the tool
  highlights is itself only about two and a half years old — treat the
  optimum ceiling as a starting point for sensitivity analysis, not a
  forecast.

## Regenerating the data

`data.js` and `data.json` are pre-generated and **must not be edited by
hand** — they are produced by `generate_data.py` from a private IEX GDAM
snapshot (`snapshot_2021_to_2026.xlsx`) that is not part of this
repository. To regenerate from your own snapshot:

```bash
pip install pandas numpy openpyxl
python generate_data.py   # edit XLSX/OUT paths at the top of the script first
```

This writes both `data.json` (for reuse by other tools) and `data.js`
(`window.GDAM_DATA = {...}; Object.freeze(...)`, loaded by `index.html` via
a plain `<script src>` — this works from `file://`, unlike `fetch()` on a
local JSON file, which is blocked by the file-scheme CORS restriction).

## Running it locally

No build step, no server required:

```bash
open index.html   # or just double-click it — everything runs from file://
```

To run the full state space through a real browser instead (recommended
before you trust a change):

```bash
python3 -m http.server 8000   # any static file server works
# open http://localhost:8000/
```

## Testing

```bash
node tests/run.js
```

This runs a dependency-free Node test suite covering the numerical
reference cases from the specification (tolerance ±Rs1.0/kg), the four
years' optima, property tests (MW invariance, hours monotonicity in the
ceiling, the weighted-mean-≤-threshold bound, state ordering, repricing
NPV-neutrality, CRF identities, URL-hash round-tripping), a battery of
documented edge cases, and a 1,000-case fuzz test of adversarial URL
hashes. See `tests/` for the individual suites.

## Security

See [`SECURITY.md`](SECURITY.md). In short: zero runtime network requests,
a strict CSP, no `innerHTML`/`eval`, and defensive whitelist parsing of the
URL hash (the only piece of attacker-controlled input this app has).

## Repository layout

```
index.html          shell only, no inline JS/CSS
app.js               UI, DOM, charts, URL-hash handling
model.js              pure calculation engine, no DOM access
data.js / data.json    generated data, do not edit
generate_data.py       generator for the above, do not edit
styles.css
tests/                 Node test suite (tests/run.js is the entry point)
docs/methodology.pdf    full LCOH methodology (linked from the Help button)
.github/workflows/      CI (tests) + GitHub Pages deploy
```

## License

MIT — see [`LICENSE`](LICENSE).
