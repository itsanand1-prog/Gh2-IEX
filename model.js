/*
 * model.js — pure calculation engine for the GDAM Green Hydrogen LCOH Explorer.
 *
 * No DOM access anywhere in this file. Every function is a pure function of
 * its arguments so it can be unit-tested in isolation (see tests/).
 *
 * Loaded as a plain global-scope script (no ES modules): ES module scripts
 * are blocked by CORS under the file:// origin, and this app must run from
 * file:// with zero network requests. The UMD wrapper below exposes the
 * same functions as `window.GDAM_MODEL` in a browser and as a CommonJS
 * export under Node, so the test runner can `require()` this file directly.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GDAM_MODEL = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Coerce an optional numeric input to a finite number, defaulting to 0. */
  function num(x) {
    return Number.isFinite(x) ? x : 0;
  }

  function clamp(x, lo, hi) {
    if (!Number.isFinite(x)) return lo;
    if (lo > hi) { const tmp = lo; lo = hi; hi = tmp; }
    return Math.min(hi, Math.max(lo, x));
  }

  /**
   * Linear interpolation of a sweep array of {t, h, w} rows, sorted
   * ascending by t on a uniform grid. Clamps to the first/last row —
   * never extrapolates beyond the provided grid.
   */
  function interpolateSweep(sweep, t) {
    const n = sweep.length;
    if (!n) return { hours: 0, w: 0 };
    const first = sweep[0].t;
    const last = sweep[n - 1].t;
    const tc = clamp(t, first, last);
    if (tc <= first) return { hours: sweep[0].h, w: sweep[0].w };
    if (tc >= last) return { hours: sweep[n - 1].h, w: sweep[n - 1].w };
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sweep[mid].t <= tc) lo = mid; else hi = mid;
    }
    const a = sweep[lo];
    const b = sweep[hi];
    const span = b.t - a.t;
    const frac = span > 0 ? (tc - a.t) / span : 0;
    return {
      hours: a.h + (b.h - a.h) * frac,
      w: a.w + (b.w - a.w) * frac,
    };
  }

  /** Capital recovery factor. Degenerates to 1/N when r = 0. */
  function CRF(r, N) {
    if (!(N > 0)) return 0;
    if (r === 0) return 1 / N;
    const f = Math.pow(1 + r, N);
    if (!Number.isFinite(f) || f === 1) return 1 / N;
    return (r * f) / (f - 1);
  }

  /** All-in capex per kW from the electrolyser base cost plus uplift percentages. */
  function computeCapexPerKW(electrolyserPerKW, upliftFractions) {
    const upliftSum = upliftFractions.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
    return electrolyserPerKW * (1 + upliftSum);
  }

  const MAX_STACK_ITER = 20000;

  /** The five units the additional-opex field can be entered in. */
  const OPEX_UNITS = ['Rs/kg H2', 'Rs/unit power', 'Rs/MW/year', 'Rs/year', '% of capex/year'];

  /**
   * Convert an additional-opex figure from the user's chosen unit into Rs/kg H2.
   *
   * `Rs/unit power` multiplies by SEC, which equals annual_units ÷ annual_kg.
   * That is deliberate: a per-unit charge such as electricity duty applies only
   * to energy actually drawn, i.e. only during operating hours. Nameplate hours
   * are never used here.
   *
   * ctx: { SEC, MW, annualKg, capexGross }
   */
  function normaliseOpex(value, unit, ctx) {
    if (!Number.isFinite(value) || value === 0) return 0;
    const kg = ctx.annualKg;
    switch (unit) {
      case 'Rs/kg H2': return value;
      case 'Rs/unit power': return value * ctx.SEC;
      case 'Rs/MW/year': return kg > 0 ? (value * ctx.MW) / kg : 0;
      case 'Rs/year': return kg > 0 ? value / kg : 0;
      case '% of capex/year': return kg > 0 ? ((value / 100) * ctx.capexGross) / kg : 0;
      default: return 0;
    }
  }

  /**
   * Core LCOH computation given an already-resolved (hours, w) pair.
   * c: { MW, N, r, capexPerKW, electrolyserPerKW, SEC, loadFactor,
   *      omPct, waterCostPerKg, stackPct, stackLifeHours, residualPct,
   *      additionalCapexPerKW, capexSubsidyPerKW, additionalOpex,
   *      additionalOpexUnit, productionSubsidyPerKg, powerSubsidyPerUnit }
   *
   * Every field on the second line is optional and defaults to zero, so a
   * caller that omits them all gets bit-identical results to the version of
   * this engine that predated them (asserted in tests/charges.test.js).
   */
  function coreLCOH(hours, w, adder, lossFactor, c) {
    const errors = [];   // block the result
    const warnings = []; // informational; the result stays valid and displayable
    const MW = c.MW;
    const SEC = c.SEC;
    const loadFactor = c.loadFactor;
    const N = c.N;
    const r = c.r;

    if (!(MW > 0)) errors.push('Plant capacity must be greater than zero.');
    if (!(SEC > 0)) errors.push('Electrolyser efficiency (SEC) must be greater than zero.');
    if (!(N > 0)) errors.push('Capital recovery period must be greater than zero.');
    if (!(loadFactor > 0)) errors.push('Load factor must be greater than zero.');
    if (hours <= 0) errors.push('No hours are below your ceiling in this year — the plant never runs.');

    const landedAvg = (w + adder) * lossFactor;
    const nameplateTpa = SEC > 0 ? (MW * 1000 * 8760 * loadFactor) / SEC / 1000 : 0;
    const annualKg = SEC > 0 ? (MW * 1000 * hours * loadFactor) / SEC : 0;
    const actualTpa = annualKg / 1000;
    const capacityFactor = hours / 8760;

    // --- capital chain ----------------------------------------------------
    // Gross carries any user-entered additional capex; net deducts a capital
    // subsidy at year zero, before the CRF is applied. O&M is charged on
    // GROSS (the asset needs maintaining regardless of who funded it) while
    // the annuity and residual value work off NET (Ind AS 20: a capital grant
    // reduces the asset's carrying amount).
    const kW = MW * 1000;
    const capexBase = kW * c.capexPerKW;
    const capexExtra = kW * num(c.additionalCapexPerKW);
    const capexGross = capexBase + capexExtra;
    const capexSubsidy = kW * num(c.capexSubsidyPerKW);
    const capexClamped = capexGross - capexSubsidy < 0;
    const capexNet = Math.max(capexGross - capexSubsidy, 0);
    if (capexClamped) {
      // A warning, never an error: the result stays finite and displayable.
      warnings.push('Capital subsidy exceeds gross capex — net capex has been clamped to zero.');
    }

    const capex = capexGross; // headline "total capex" remains the asset cost
    const crf = CRF(r, N);
    const residualValue = capexNet * c.residualPct;
    const denomN = Math.pow(1 + r, N);
    const annualisedCapex = Number.isFinite(denomN) && denomN > 0
      ? (capexNet - residualValue / denomN) * crf
      : capexNet * crf;
    const annualOm = capexGross * c.omPct;

    // Stack cost is unaffected by additional capex or by any subsidy — it is
    // derived from the base electrolyser cost only, and a subsidy on the
    // initial build does not recur at replacement.
    const stackCostTotal = kW * c.electrolyserPerKW * c.stackPct;
    let stackSinking = 0;
    let stackIntervalYears = null;
    if (hours > 0 && c.stackLifeHours > 0) {
      const interval = c.stackLifeHours / hours;
      stackIntervalYears = interval;
      if (interval > 0) {
        let k = 1;
        let sum = 0;
        let iter = 0;
        while (k * interval < N && iter < MAX_STACK_ITER) {
          sum += stackCostTotal / Math.pow(1 + r, k * interval);
          k += 1;
          iter += 1;
        }
        stackSinking = crf * sum;
      }
    }

    const annualKgOk = annualKg > 0 && Number.isFinite(annualKg);
    const capitalPerKg = annualKgOk ? annualisedCapex / annualKg : null;
    const omPerKg = annualKgOk ? annualOm / annualKg : null;
    const stackPerKg = annualKgOk ? stackSinking / annualKg : null;
    const powerPerKg = SEC * landedAvg;
    const waterPerKg = c.waterCostPerKg;

    // --- additional opex and subsidies -----------------------------------
    const opexUnit = OPEX_UNITS.indexOf(c.additionalOpexUnit) !== -1
      ? c.additionalOpexUnit
      : 'Rs/unit power';
    const extraOpexPerKg = annualKgOk
      ? normaliseOpex(num(c.additionalOpex), opexUnit, {
        SEC: SEC, MW: MW, annualKg: annualKg, capexGross: capexGross,
      })
      : 0;
    const subsidyKgPerKg = num(c.productionSubsidyPerKg);
    const subsidyPwrPerKg = num(c.powerSubsidyPerUnit) * SEC;
    const subsidyTotalPerKg = subsidyKgPerKg + subsidyPwrPerKg;

    // Gross of subsidy — the denominator for the breakdown table's shares.
    // Sharing against a subsidised net produces shares above 100%.
    const grossPerKg = annualKgOk
      ? capitalPerKg + omPerKg + stackPerKg + powerPerKg + waterPerKg + extraOpexPerKg
      : NaN;

    const lcoh = annualKgOk ? grossPerKg - subsidyTotalPerKg : NaN;

    // Subsidies are allowed to drive LCOH negative — do not clamp, just say so.
    if (Number.isFinite(lcoh) && lcoh < 0) {
      warnings.push('Subsidies exceed the gross cost of production — LCOH is negative at these settings.');
    }

    const ok = errors.length === 0 && Number.isFinite(lcoh);

    return {
      ok, errors, warnings,
      hours, w, landedAvg,
      nameplateTpa, annualKg, actualTpa, capacityFactor,
      capex, capexBase, capexExtra, capexGross, capexSubsidy, capexNet, capexClamped,
      annualisedCapex, annualOm, stackCostTotal, stackSinking,
      stackIntervalYears,
      capitalPerKg, omPerKg, stackPerKg, powerPerKg, waterPerKg,
      extraOpexPerKg, opexUnit,
      subsidyKgPerKg, subsidyPwrPerKg, subsidyTotalPerKg,
      grossPerKg,
      lcoh,
    };
  }

  /** ceiling (landed Rs/unit) -> MCP threshold t, per state adder/loss_factor. */
  function ceilingToThreshold(ceilingLanded, adder, lossFactor) {
    return ceilingLanded / lossFactor - adder;
  }

  /** MCP threshold t -> equivalent landed ceiling Rs/unit (inverse transform). */
  function thresholdToCeiling(t, adder, lossFactor) {
    return (t + adder) * lossFactor;
  }

  function computeLCOH(sweep, adder, lossFactor, ceilingLanded, c) {
    const t = ceilingToThreshold(ceilingLanded, adder, lossFactor);
    const { hours, w } = interpolateSweep(sweep, t);
    const result = coreLCOH(hours, w, adder, lossFactor, c);
    return Object.assign({ t, ceilingLanded }, result);
  }

  /** Sweeps the full threshold grid (exact rows, no interpolation) to find the LCOH-minimising ceiling. */
  function findOptimum(sweep, adder, lossFactor, c) {
    let best = null;
    for (let i = 0; i < sweep.length; i++) {
      const row = sweep[i];
      const result = coreLCOH(row.h, row.w, adder, lossFactor, c);
      if (result.ok && (!best || result.lcoh < best.lcoh)) {
        best = Object.assign({ t: row.t, ceilingLanded: thresholdToCeiling(row.t, adder, lossFactor) }, result);
      }
    }
    return best;
  }

  function npvOf(cashFlows, r) {
    let s = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const denom = Math.pow(1 + r, i);
      if (!Number.isFinite(denom) || denom === 0) return NaN;
      s += cashFlows[i] / denom;
    }
    return s;
  }

  function irrOf(cashFlows) {
    let lo = -0.99;
    let hi = 5;
    let fLo = npvOf(cashFlows, lo);
    let fHi = npvOf(cashFlows, hi);
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
    let mid = (lo + hi) / 2;
    for (let i = 0; i < 200; i++) {
      mid = (lo + hi) / 2;
      const fMid = npvOf(cashFlows, mid);
      if (!Number.isFinite(fMid)) return null;
      if (Math.abs(fMid) < 1e-7) return mid;
      if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
    }
    return mid;
  }

  /**
   * Three-year regulatory-style repricing schedule with a declining rate base,
   * spanning the full plant life in blocks of `blockLen` years (default 3;
   * the final block is shorter when plantLife is not a multiple of blockLen).
   *
   * base: the coreLCOH() result at the flat/optimum operating point providing
   * hours, landedAvg, annualKg, capexGross, capexNet, stackCostTotal, and the
   * additional-opex / subsidy per-kg lines.
   * c: same cost-parameter bag as coreLCOH, plus { plantLife }.
   *
   * The rate base opens at capexNet, not capexGross: a capital subsidy reduces
   * the balance the developer earns a return on, which is the standard
   * regulatory treatment. Additional capex the developer actually deployed
   * *does* enter the rate base. O&M, as in the flat LCOH, is charged on gross.
   */
  function repricingSchedule(base, c, greyBenchmark, blockLen) {
    blockLen = blockLen || 3;
    const { r, N, plantLife, omPct, waterCostPerKg, SEC } = c;
    const hours = base.hours;
    const annualKg = base.annualKg;
    // Fall back to `capex` so a caller passing a pre-charges result still works.
    const capexGross = Number.isFinite(base.capexGross) ? base.capexGross : base.capex;
    const capexNet = Number.isFinite(base.capexNet) ? base.capexNet : base.capex;
    const stackCostTotal = base.stackCostTotal;
    const landedAvg = base.landedAvg;

    if (!(annualKg > 0) || !(plantLife > 0)) {
      return { ok: false, blocks: [], pvLevelisedPrice: NaN, npv: NaN, irr: null, replacementYear: null };
    }

    const powerPerKg = SEC * landedAvg;
    const omPerKg = (capexGross * omPct) / annualKg;
    const waterPerKg = c.waterCostPerKg;
    // Flat across every block under the constant-price-year assumption, exactly
    // as the power and water lines are, so they shift all block prices equally
    // and leave NPV-neutrality undisturbed.
    const extraOpexPerKg = num(base.extraOpexPerKg);
    const subsidyTotalPerKg = num(base.subsidyTotalPerKg);
    const replacementYear = hours > 0 ? Math.ceil(c.stackLifeHours / hours) : Infinity;

    const capitalCharge = new Array(plantLife + 1).fill(0); // 1-indexed, [0] unused
    let rateBase = capexNet;
    let stackDep = 0;
    const openingRateBase = new Array(plantLife + 1).fill(0);
    for (let tYear = 1; tYear <= plantLife; tYear++) {
      if (tYear === replacementYear) {
        rateBase += stackCostTotal;
        stackDep = stackCostTotal / (plantLife - tYear + 1);
      }
      openingRateBase[tYear] = rateBase;
      const depreciation = tYear <= N ? capexNet / N : 0;
      const ret = r * rateBase;
      capitalCharge[tYear] = (depreciation + stackDep + ret) / annualKg;
      rateBase -= depreciation;
      rateBase -= stackDep;
      if (rateBase < 0) rateBase = 0;
    }

    const blocks = [];
    for (let start = 1; start <= plantLife; start += blockLen) {
      const end = Math.min(start + blockLen - 1, plantLife);
      const len = end - start + 1;
      const crfBlock = CRF(r, len);
      let pv = 0;
      for (let i = 1; i <= len; i++) {
        pv += capitalCharge[start + i - 1] / Math.pow(1 + r, i);
      }
      const capitalAnnuity = crfBlock * pv;
      const price = capitalAnnuity + powerPerKg + omPerKg + waterPerKg
        + extraOpexPerKg - subsidyTotalPerKg;
      blocks.push({
        block: blocks.length + 1,
        startYear: start,
        endYear: end,
        yearsLabel: start === end ? String(start) : (start + '–' + end),
        openingRateBaseCr: openingRateBase[start] / 1e7,
        capitalChargePerKg: capitalAnnuity,
        price,
        revenueCr: (price * annualKg) / 1e7,
        multipleOfGrey: greyBenchmark > 0 ? price / greyBenchmark : null,
      });
    }

    let pvSum = 0;
    for (let tYear = 1; tYear <= plantLife; tYear++) {
      const block = blocks[Math.floor((tYear - 1) / blockLen)];
      pvSum += block.price / Math.pow(1 + r, tYear);
    }
    const pvLevelisedPrice = CRF(r, plantLife) * pvSum;

    // Year 0 outlay is net of any capital subsidy — that is what the developer
    // actually funds. Each year they receive the contract price from the buyer
    // *plus* the per-kg and per-unit subsidies from the grantor (the contract
    // price already has those netted out of it), and pay O&M on gross capex
    // along with power, water and any additional opex.
    const cashFlows = [-capexNet];
    for (let tYear = 1; tYear <= plantLife; tYear++) {
      const block = blocks[Math.floor((tYear - 1) / blockLen)];
      const revenue = (block.price + subsidyTotalPerKg) * annualKg;
      const opex = capexGross * omPct
        + annualKg * (powerPerKg + waterPerKg + extraOpexPerKg);
      const stackOut = tYear === replacementYear ? stackCostTotal : 0;
      cashFlows.push(revenue - opex - stackOut);
    }
    const npv = npvOf(cashFlows, r);
    const irr = irrOf(cashFlows);

    return {
      ok: true, blocks, pvLevelisedPrice, npv, irr, replacementYear, cashFlows,
      openingRateBaseByYear: openingRateBase,
      capitalChargeByYear: capitalCharge,
    };
  }

  return {
    clamp,
    interpolateSweep,
    CRF,
    OPEX_UNITS,
    normaliseOpex,
    computeCapexPerKW,
    ceilingToThreshold,
    thresholdToCeiling,
    coreLCOH,
    computeLCOH,
    findOptimum,
    npvOf,
    irrOf,
    repricingSchedule,
  };
});
