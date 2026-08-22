#!/usr/bin/env python3
"""
generate_data.py — build data.json for the GDAM Green Hydrogen LCOH Dashboard.

Source: IEX GDAM 15-minute block market clearing prices, Apr 2022 - Aug 2026.

Why the sweep is computed in MCP space
--------------------------------------
Every state's landed cost is a monotonic affine transform of MCP:
    landed = (MCP + adder) * loss_factor,   adder >= 0, loss_factor > 0
Affine monotonic maps preserve both ORDERING and MEANS. Therefore:
  (a) the set of blocks selected at a landed ceiling C equals the set selected
      at the MCP threshold t = C/loss_factor - adder;
  (b) the min-run "extended window mean <= ceiling" test is identical in either
      space, since mean(landed) <= C  <=>  mean(MCP) <= t.
So one sweep in MCP space serves every state. The browser applies the transform.

The min-run filter is NOT threshold-invariant (it depends on temporal
adjacency), so a separate sweep is emitted for each min-run setting.
"""

import json, sys
import numpy as np
import pandas as pd

XLSX = "/mnt/user-data/uploads/snapshot_2021_to_2026.xlsx"
OUT  = "/home/claude/dash/data.json"

THRESH_STEP   = 0.02
THRESH_MAX    = 12.00
MONTH_STEP    = 0.10
DURATION_PTS  = 500
MINRUN_BLOCKS = [2, 4, 8, 16]          # 0.5 h, 1 h, 2 h, 4 h

YEARS = [
    ("AY2022-23", "2022-08-22", "2023-08-21", "Aug 2022 – Aug 2023"),
    ("AY2023-24", "2023-08-22", "2024-08-21", "Aug 2023 – Aug 2024"),
    ("AY2024-25", "2024-08-22", "2025-08-21", "Aug 2024 – Aug 2025"),
    ("AY2025-26", "2025-08-22", "2026-08-21", "Aug 2025 – Aug 2026"),
]

STATES = {
    "Gujarat":   {"adder": 0.250, "loss_factor": 1.065,
                  "label": "Gujarat GH2 open access (50% wheeling waiver, ISTS waived)"},
    "Rajasthan": {"adder": 0.365, "loss_factor": 1.088,
                  "label": "Rajasthan GH2 open access (50% wheeling waiver, ISTS waived)"},
}


def load_series():
    df = pd.read_excel(XLSX)
    old = df["MCP (Rs/MWh) "]
    new = df["unconstrained_m_c_p"]
    mcp = (old.fillna(new) / 1000.0).to_numpy(dtype=np.float64)   # Rs/kWh
    dt  = pd.to_datetime(df["date"])
    order = np.argsort(dt.values, kind="stable")
    mcp, dt = mcp[order], dt.iloc[order].reset_index(drop=True)
    assert np.isfinite(mcp).all(), "non-finite MCP values present"
    assert (mcp >= 0).all(), "negative MCP values present"
    return mcp, dt


def runs_of_true(mask):
    """[start, end) index pairs of contiguous True runs."""
    m = np.concatenate(([False], mask, [False]))
    idx = np.flatnonzero(m[1:] != m[:-1])
    return idx[0::2], idx[1::2]


def apply_minrun(price, thresh, min_blocks):
    """
    Extend-or-discard rule:
      1. blocks with price <= thresh qualify
      2. runs of >= min_blocks pass through unchanged
      3. shorter runs extend outward one block at a time, always taking the
         cheaper of the two adjacent blocks, until min_blocks is reached
      4. the extended window is kept ONLY if its mean price is still <= thresh,
         otherwise the whole window is discarded
    Runs may cross day boundaries; the series is treated as continuous.
    Returns a boolean mask of blocks actually run.
    """
    n = len(price)
    base = price <= thresh
    out = np.zeros(n, dtype=bool)
    starts, ends = runs_of_true(base)
    for s, e in zip(starts, ends):
        if e - s >= min_blocks:
            out[s:e] = True
            continue
        a, b = int(s), int(e)
        ok = True
        while b - a < min_blocks:
            left  = price[a - 1] if a - 1 >= 0 else np.inf
            right = price[b]     if b < n      else np.inf
            if not np.isfinite(left) and not np.isfinite(right):
                ok = False
                break
            if left <= right:
                a -= 1
            else:
                b += 1
        if ok and price[a:b].mean() <= thresh:
            out[a:b] = True
    return out


def build_year(mcp, dt, key, start, end, label):
    m = ((dt >= pd.Timestamp(start)) & (dt <= pd.Timestamp(end))).to_numpy()
    p = mcp[m]
    months = dt[m].dt.month.to_numpy()
    nblk = len(p)
    period_h = nblk * 0.25
    days = period_h / 24.0
    ann = 8760.0 / period_h                      # annualisation factor

    if abs(days - 365) > 2:
        print(f"  WARNING {key}: {days:.1f} days", file=sys.stderr)

    thresh_grid = np.round(np.arange(0.0, THRESH_MAX + 1e-9, THRESH_STEP), 2)
    month_grid  = np.round(np.arange(0.0, THRESH_MAX + 1e-9, MONTH_STEP), 2)

    sweeps, monthly = {}, {}
    for mb in MINRUN_BLOCKS:
        rows = []
        prev_h = -1.0
        for t in thresh_grid:
            run = apply_minrun(p, t, mb)
            nsel = int(run.sum())
            if nsel == 0:
                rows.append({"t": float(t), "h": 0.0, "w": 0.0})
                continue
            h = nsel * 0.25 * ann
            w = float(p[run].mean())
            rows.append({"t": float(t), "h": round(h, 3), "w": round(w, 5)})
            # monotonicity guard: hours must never decrease as the ceiling rises
            assert h >= prev_h - 1e-6, f"{key} mb={mb} t={t}: hours decreased"
            prev_h = h
        sweeps[str(mb)] = rows

        mrows = {}
        for t in month_grid:
            run = apply_minrun(p, t, mb)
            mh = [round(float(((months == k) & run).sum()) * 0.25, 2) for k in range(1, 13)]
            mrows[f"{t:.2f}"] = mh
        monthly[str(mb)] = mrows

    srt = np.sort(p)[::-1]
    idx = np.linspace(0, len(srt) - 1, DURATION_PTS).astype(int)
    duration = [round(float(x), 4) for x in srt[idx]]

    # month-hours denominator, for utilisation percentages in the UI
    month_total_h = [round(float((months == k).sum()) * 0.25, 2) for k in range(1, 13)]

    return {
        "label": label,
        "start": start,
        "end": end,
        "days": round(days, 2),
        "blocks": nblk,
        "annualisation_factor": round(ann, 6),
        "stats": {
            "mean":   round(float(p.mean()), 4),
            "p10":    round(float(np.percentile(p, 10)), 4),
            "p25":    round(float(np.percentile(p, 25)), 4),
            "median": round(float(np.median(p)), 4),
            "p75":    round(float(np.percentile(p, 75)), 4),
            "min":    round(float(p.min()), 4),
            "max":    round(float(p.max()), 4),
            "h_le_1_5": round(float((p <= 1.5).sum()) * 0.25, 2),
            "h_le_2_5": round(float((p <= 2.5).sum()) * 0.25, 2),
            "h_le_3_5": round(float((p <= 3.5).sum()) * 0.25, 2),
        },
        "month_total_hours": month_total_h,
        "sweep": sweeps,
        "monthly": monthly,
        "duration": duration,
    }


def main():
    mcp, dt = load_series()
    print(f"loaded {len(mcp):,} blocks, {dt.min().date()} to {dt.max().date()}")

    out = {
        "meta": {
            "source": "IEX Green Day-Ahead Market (GDAM), 15-minute block MCP",
            "span": f"{dt.min().date()} to {dt.max().date()}",
            "blocks_total": int(len(mcp)),
            "price_field": "unconstrained MCP; 'MCP (Rs/MWh)' to 2024-02-20, "
                           "'unconstrained_m_c_p' from 2024-02-21",
            "congestion_note": "679 of 87,648 flagged blocks (0.77%) were congested. "
                               "Unconstrained MCP is used throughout.",
            "units": "Rs/kWh",
            "threshold_step": THRESH_STEP,
            "threshold_max": THRESH_MAX,
            "minrun_blocks_available": MINRUN_BLOCKS,
            "block_minutes": 15,
            "generator": "generate_data.py",
        },
        "states": STATES,
        "years": {},
    }

    for key, s, e, label in YEARS:
        print(f"building {key} ...", flush=True)
        out["years"][key] = build_year(mcp, dt, key, s, e, label)
        st = out["years"][key]["stats"]
        print(f"  {key}: {out['years'][key]['days']:.0f} d  mean {st['mean']:.2f}  "
              f"p10 {st['p10']:.2f}  p25 {st['p25']:.2f}  median {st['median']:.2f}  "
              f"h<=1.5 {st['h_le_1_5']:.0f}  h<=2.5 {st['h_le_2_5']:.0f}  h<=3.5 {st['h_le_3_5']:.0f}")

    import os
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"\nwrote {OUT}  ({os.path.getsize(OUT)/1e6:.2f} MB)")

    # data.js so the page works from file:// with zero network calls
    JS = OUT.replace(".json", ".js")
    with open(JS, "w") as f:
        f.write("window.GDAM_DATA=")
        json.dump(out, f, separators=(",", ":"))
        f.write(";\nObject.freeze(window.GDAM_DATA);\n")
    print(f"wrote {JS}  ({os.path.getsize(JS)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
