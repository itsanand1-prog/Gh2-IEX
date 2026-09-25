'use strict';
/* Additional charges and subsidies: zero-default inertness, the specification's
 * worked cases A-I, and the property tests that go with them. */
var path = require('path');
var F = require('./framework.js');
var M = require(path.join(__dirname, '..', 'model.js'));
var DATA = require(path.join(__dirname, '..', 'data.json'));

// The specification states every reference case and optimum at min-run 2 h,
// which is sweep key "8" (2 h = 8 blocks of 15 minutes). This is also the
// application's default. Using the wrong key here still reproduces the
// published LCOH -- LCOH barely moves with min-run -- but throws the
// published operating HOURS out by ~100 h across the reference set, which is
// exactly how a wrong default slipped through before.
var REF_SWEEP = '8';

var describe = F.describe, test = F.test, assert = F.assert, assertClose = F.assertClose;

var DEFAULTS = {
  N: 20, r: 0.10, capexPerKW: 62010, electrolyserPerKW: 39000,
  SEC: 52, loadFactor: 1.0, omPct: 0.04, waterCostPerKg: 0.90,
  stackPct: 0.40, stackLifeHours: 60000, residualPct: 0.0, plantLife: 20,
};

/** The six new fields, all at their documented defaults. */
var ZERO_FIELDS = {
  additionalCapexPerKW: 0,
  capexSubsidyPerKW: 0,
  additionalOpex: 0,
  additionalOpexUnit: 'Rs/unit power',
  productionSubsidyPerKg: 0,
  powerSubsidyPerUnit: 0,
};

function run(yearKey, state, ceiling, overrides) {
  var yd = DATA.years[yearKey];
  var sd = DATA.states[state];
  var c = Object.assign({}, DEFAULTS, overrides || {});
  return M.computeLCOH(yd.sweep[REF_SWEEP], sd.adder, sd.loss_factor, ceiling, c);
}

// Base case used by every worked case below.
var BASE = { MW: 4.599, N: 20, residualPct: 0 };
function base(extra) {
  return run('AY2025-26', 'Gujarat', 4.98, Object.assign({}, BASE, extra || {}));
}

// ---------------------------------------------------------------------------
describe('Zero-default regression — the new fields must be provably inert', function () {
  var CASES = [
    ['AY2025-26', 'Gujarat', 4.98, 4.599, 20, 0],
    ['AY2024-25', 'Gujarat', 5.32, 4.33, 20, 0],
    ['AY2023-24', 'Gujarat', 6.18, 4.59, 20, 0],
    ['AY2022-23', 'Gujarat', 6.39, 4.52, 20, 0],
    ['AY2025-26', 'Rajasthan', 5.20, 4.60, 20, 0],
    ['AY2025-26', 'Gujarat', 5.92, 4.01, 7, 0],
    ['AY2025-26', 'Gujarat', 5.55, 4.30, 7, 0.35],
  ];
  CASES.forEach(function (row) {
    var yearKey = row[0], state = row[1], ceiling = row[2];
    var opts = { MW: row[3], N: row[4], residualPct: row[5] };
    test(yearKey + ' ' + state + ' @ ' + ceiling + ': fields-at-zero === fields-absent', function () {
      var without = run(yearKey, state, ceiling, opts);
      var withZeros = run(yearKey, state, ceiling, Object.assign({}, opts, ZERO_FIELDS));
      assert(without.ok && withZeros.ok, 'both variants must produce a valid result');
      // Far tighter than the ±Rs0.01 the spec asks for: these must be identical.
      assertClose(withZeros.lcoh, without.lcoh, 1e-9, 'LCOH');
      assertClose(withZeros.capitalPerKg, without.capitalPerKg, 1e-9, 'capital per kg');
      assertClose(withZeros.omPerKg, without.omPerKg, 1e-9, 'O&M per kg');
      assertClose(withZeros.stackPerKg, without.stackPerKg, 1e-9, 'stack per kg');
      assertClose(withZeros.extraOpexPerKg, 0, 0, 'additional opex must be exactly zero');
      assertClose(withZeros.subsidyTotalPerKg, 0, 0, 'subsidies must be exactly zero');
    });
  });

  test('repricing with fields at zero is identical to fields absent', function () {
    var c = Object.assign({}, DEFAULTS, BASE, { N: 7 });
    var cz = Object.assign({}, c, ZERO_FIELDS);
    var a = M.repricingSchedule(base({ N: 7 }), c, 250, 3);
    var b = M.repricingSchedule(base(Object.assign({ N: 7 }, ZERO_FIELDS)), cz, 250, 3);
    assertClose(b.pvLevelisedPrice, a.pvLevelisedPrice, 1e-9, 'PV-levelised price');
    a.blocks.forEach(function (blk, i) {
      assertClose(b.blocks[i].price, blk.price, 1e-9, 'block ' + (i + 1) + ' price');
    });
  });
});

// ---------------------------------------------------------------------------
describe('Worked cases A-H from the specification (tolerance ±Rs1.0/kg)', function () {
  var SEC = DEFAULTS.SEC;
  var b = base();
  var annualKg = b.annualKg;

  var CASES = [
    ['A  additional opex Rs 10.00/kg', { additionalOpex: 10, additionalOpexUnit: 'Rs/kg H2' }, 278.1],
    ['B  additional opex Rs 0.10/unit', { additionalOpex: 0.10, additionalOpexUnit: 'Rs/unit power' }, 273.3],
    ['C  additional opex Rs 50 lakh/yr', { additionalOpex: 5000000, additionalOpexUnit: 'Rs/year' }, 278.1],
    ['D  additional opex Rs 10 lakh/MW/yr', { additionalOpex: 1000000, additionalOpexUnit: 'Rs/MW/year' }, 277.3],
    ['E  production subsidy Rs 50/kg', { productionSubsidyPerKg: 50 }, 218.1],
    ['F  power subsidy Rs 0.50/unit', { powerSubsidyPerUnit: 0.50 }, 242.1],
    ['G  capital subsidy Rs 10,000/kW', { capexSubsidyPerKW: 10000 }, 257.3],
    ['H  additional capex Rs 5,000/kW', { additionalCapexPerKW: 5000 }, 275.4],
  ];
  CASES.forEach(function (row) {
    test(row[0] + ' -> Rs ' + row[2] + '/kg', function () {
      var res = base(row[1]);
      assert(res.ok, 'expected a valid result: ' + JSON.stringify(res.errors));
      assertClose(res.lcoh, row[2], 1.0, 'LCOH');
    });
  });

  test('A: the Rs/kg unit is passed through with no conversion at all', function () {
    assertClose(base({ additionalOpex: 10, additionalOpexUnit: 'Rs/kg H2' }).extraOpexPerKg, 10, 1e-12);
  });
  test('B: the Rs/unit conversion multiplies by SEC, not by nameplate hours', function () {
    assertClose(base({ additionalOpex: 0.10, additionalOpexUnit: 'Rs/unit power' }).extraOpexPerKg, 0.10 * SEC, 1e-12);
  });
  test('C: the Rs/year lump sum divides by annual kg', function () {
    assertClose(base({ additionalOpex: 5000000, additionalOpexUnit: 'Rs/year' }).extraOpexPerKg, 5000000 / annualKg, 1e-9);
  });
  test('D: the Rs/MW/year unit scales by MW then divides by annual kg', function () {
    assertClose(base({ additionalOpex: 1000000, additionalOpexUnit: 'Rs/MW/year' }).extraOpexPerKg, 1000000 * 4.599 / annualKg, 1e-9);
  });
  test('% of capex/year is charged on gross capex', function () {
    var res = base({ additionalOpex: 0.4, additionalOpexUnit: '% of capex/year', additionalCapexPerKW: 5000 });
    assertClose(res.extraOpexPerKg, 0.004 * res.capexGross / res.annualKg, 1e-9);
  });

  test('G: capital recovery falls but O&M is untouched by the capital subsidy', function () {
    var g = base({ capexSubsidyPerKW: 10000 });
    assert(g.capitalPerKg < b.capitalPerKg, 'capital recovery must fall');
    assertClose(g.omPerKg, b.omPerKg, 1e-12, 'O&M must be identical — it is charged on gross');
    assertClose(g.stackPerKg, b.stackPerKg, 1e-12, 'stack cost must be unaffected by a subsidy');
    assertClose(g.capexNet, g.capexGross - 4599 * 10000, 1e-6, 'net capex');
  });

  test('H: additional capex raises BOTH capital recovery and O&M', function () {
    var h = base({ additionalCapexPerKW: 5000 });
    assert(h.capitalPerKg > b.capitalPerKg, 'capital recovery must rise');
    assert(h.omPerKg > b.omPerKg, 'O&M must rise too');
    assertClose(h.stackPerKg, b.stackPerKg, 1e-12, 'stack cost must be unaffected by additional capex');
    assertClose(h.capexGross, h.capexNet, 1e-9, 'with no subsidy, net equals gross');
    assertClose(h.omPerKg, h.capexGross * 0.04 / h.annualKg, 1e-9, 'O&M charged on gross');
  });
});

// ---------------------------------------------------------------------------
describe('Case I — all five fields at once, and exact additivity', function () {
  var CASE_I = {
    additionalCapexPerKW: 5000,
    additionalOpex: 0.10, additionalOpexUnit: 'Rs/unit power',
    capexSubsidyPerKW: 10000,
    productionSubsidyPerKg: 20,
    powerSubsidyPerUnit: 0.05,
  };

  test('equals the base case adjusted by each effect computed independently', function () {
    var b = base().lcoh;
    var deltas =
      (base({ additionalCapexPerKW: 5000 }).lcoh - b) +
      (base({ capexSubsidyPerKW: 10000 }).lcoh - b) +
      (base({ additionalOpex: 0.10, additionalOpexUnit: 'Rs/unit power' }).lcoh - b) +
      (base({ productionSubsidyPerKg: 20 }).lcoh - b) +
      (base({ powerSubsidyPerUnit: 0.05 }).lcoh - b);
    var combined = base(CASE_I).lcoh;
    // Exactly additive: every term is linear in the capital chain, so any
    // discrepancy here would indicate an ordering bug.
    assertClose(combined, b + deltas, 1e-9, 'combined vs sum of independent deltas');
  });

  test('produces a finite, sane result', function () {
    var res = base(CASE_I);
    assert(res.ok, 'expected a valid result');
    assert(Number.isFinite(res.lcoh), 'LCOH must be finite');
    assert(res.lcoh > 0, 'LCOH should still be positive at these settings');
  });

  test('repricing stays NPV-neutral with all charges and subsidies applied', function () {
    var c = Object.assign({}, DEFAULTS, BASE, CASE_I);
    var flat = base(CASE_I);
    var rp = M.repricingSchedule(flat, c, 250, 3);
    assert(rp.ok, 'repricing must succeed');
    assertClose(rp.pvLevelisedPrice, flat.lcoh, 1.0, 'PV-levelised block price vs flat LCOH');
  });

  test('repricing stays NPV-neutral for several other charge combinations', function () {
    var COMBOS = [
      { additionalOpex: 10, additionalOpexUnit: 'Rs/kg H2' },
      { productionSubsidyPerKg: 40 },
      { powerSubsidyPerUnit: 0.25 },
      { capexSubsidyPerKW: 20000 },
      { additionalCapexPerKW: 12000, capexSubsidyPerKW: 5000, productionSubsidyPerKg: 15 },
    ];
    COMBOS.forEach(function (combo, i) {
      var c = Object.assign({}, DEFAULTS, BASE, combo);
      var flat = base(combo);
      var rp = M.repricingSchedule(flat, c, 250, 3);
      assert(rp.ok, 'combo ' + i + ' must produce a schedule');
      assertClose(rp.pvLevelisedPrice, flat.lcoh, 1.0, 'combo ' + i + ' PV-levelised vs flat');
    });
  });
});

// ---------------------------------------------------------------------------
describe('Property: MW invariance holds with the new fields populated', function () {
  var MWS = [1, 2, 5, 10, 20, 50];
  var sd = DATA.states.Gujarat;
  var yd = DATA.years['AY2025-26'];

  function optimumAt(mw, extra) {
    var c = Object.assign({}, DEFAULTS, { MW: mw, N: 20 }, extra || {});
    return M.findOptimum(yd.sweep[REF_SWEEP], sd.adder, sd.loss_factor, c);
  }

  test('with every new field at zero', function () {
    var ref = optimumAt(MWS[0], ZERO_FIELDS);
    MWS.forEach(function (mw) {
      var r = optimumAt(mw, ZERO_FIELDS);
      assertClose(r.ceilingLanded, ref.ceilingLanded, 1e-6, 'ceiling at MW=' + mw);
      assertClose(r.hours, ref.hours, 1e-6, 'hours at MW=' + mw);
      assertClose(r.capacityFactor, ref.capacityFactor, 1e-9, 'CF at MW=' + mw);
      assertClose(r.lcoh, ref.lcoh, 1e-6, 'LCOH at MW=' + mw);
    });
  });

  test("with case I's settings applied", function () {
    var CASE_I = {
      additionalCapexPerKW: 5000,
      additionalOpex: 0.10, additionalOpexUnit: 'Rs/unit power',
      capexSubsidyPerKW: 10000,
      productionSubsidyPerKg: 20,
      powerSubsidyPerUnit: 0.05,
    };
    var ref = optimumAt(MWS[0], CASE_I);
    MWS.forEach(function (mw) {
      var r = optimumAt(mw, CASE_I);
      assertClose(r.ceilingLanded, ref.ceilingLanded, 1e-6, 'ceiling at MW=' + mw);
      assertClose(r.hours, ref.hours, 1e-6, 'hours at MW=' + mw);
      assertClose(r.capacityFactor, ref.capacityFactor, 1e-9, 'CF at MW=' + mw);
      assertClose(r.lcoh, ref.lcoh, 1e-6, 'LCOH at MW=' + mw);
    });
  });

  test('but a Rs/year lump sum DOES break it — the documented exception', function () {
    var LUMP = { additionalOpex: 5000000, additionalOpexUnit: 'Rs/year' };
    var small = optimumAt(1, LUMP);
    var large = optimumAt(50, LUMP);
    assert(large.lcoh < small.lcoh,
      'a fixed annual cost spread over more production must give a lower Rs/kg: ' +
      small.lcoh + ' vs ' + large.lcoh);
    // And it must not have been silently normalised away to nothing.
    assert(small.lcoh - large.lcoh > 1.0, 'the difference must be material, not floating-point noise');
  });
});

// ---------------------------------------------------------------------------
describe('Property: monotonicity in charges and subsidies', function () {
  var YEARS = Object.keys(DATA.years);
  var STATES = Object.keys(DATA.states);

  YEARS.forEach(function (yk) {
    STATES.forEach(function (st) {
      test(yk + ' ' + st + ': LCOH non-decreasing in charges, non-increasing in subsidies', function () {
        function at(extra) {
          return run(yk, st, 4.98, Object.assign({ MW: 5, N: 20 }, extra)).lcoh;
        }
        var prev, i;
        // additional capex: non-decreasing
        prev = -Infinity;
        for (i = 0; i <= 100000; i += 10000) {
          var v = at({ additionalCapexPerKW: i });
          assert(v >= prev - 1e-9, 'additional capex ' + i + ' decreased LCOH');
          prev = v;
        }
        // additional opex: non-decreasing
        prev = -Infinity;
        for (i = 0; i <= 20; i += 2) {
          var vo = at({ additionalOpex: i, additionalOpexUnit: 'Rs/kg H2' });
          assert(vo >= prev - 1e-9, 'additional opex ' + i + ' decreased LCOH');
          prev = vo;
        }
        // capital subsidy: non-increasing
        prev = Infinity;
        for (i = 0; i <= 60000; i += 6000) {
          var vc = at({ capexSubsidyPerKW: i });
          assert(vc <= prev + 1e-9, 'capital subsidy ' + i + ' increased LCOH');
          prev = vc;
        }
        // production subsidy: non-increasing
        prev = Infinity;
        for (i = 0; i <= 200; i += 20) {
          var vp = at({ productionSubsidyPerKg: i });
          assert(vp <= prev + 1e-9, 'production subsidy ' + i + ' increased LCOH');
          prev = vp;
        }
        // power subsidy: non-increasing
        prev = Infinity;
        for (i = 0; i <= 50; i += 5) {
          var vw = at({ powerSubsidyPerUnit: i / 10 });
          assert(vw <= prev + 1e-9, 'power subsidy ' + (i / 10) + ' increased LCOH');
          prev = vw;
        }
      });
    });
  });
});

// ---------------------------------------------------------------------------
describe('Property: O&M is independent of the capital subsidy', function () {
  test('sweeping the capital subsidy 0 -> 60,000 Rs/kW leaves O&M per kg constant', function () {
    var ref = base({ capexSubsidyPerKW: 0 }).omPerKg;
    for (var s = 0; s <= 60000; s += 2000) {
      var res = base({ capexSubsidyPerKW: s });
      assertClose(res.omPerKg, ref, 1e-12, 'O&M per kg at subsidy ' + s);
    }
  });

  test('and O&M still tracks additional capex while ignoring the subsidy', function () {
    var withExtra = base({ additionalCapexPerKW: 5000, capexSubsidyPerKW: 30000 });
    var noSubsidy = base({ additionalCapexPerKW: 5000 });
    assertClose(withExtra.omPerKg, noSubsidy.omPerKg, 1e-12, 'O&M must not respond to the subsidy');
  });
});

// ---------------------------------------------------------------------------
describe('Property: capex clamp', function () {
  test('a subsidy larger than gross capex clamps net capex to zero', function () {
    var res = base({ capexSubsidyPerKW: 200000 });
    assertClose(res.capexNet, 0, 0, 'net capex must clamp to exactly zero');
    assert(res.capexClamped === true, 'the clamp flag must be raised');
    assert(Number.isFinite(res.lcoh), 'LCOH must remain finite');
    assert(res.capitalPerKg >= 0, 'capital recovery must never go negative');
    assert(res.warnings.some(function (m) { return /exceeds gross capex/i.test(m); }),
      'the documented warning must be present');
    assert(res.ok, 'a clamped result is still a displayable result, not an error');
  });

  test('O&M survives the clamp unchanged — it is charged on gross', function () {
    assertClose(base({ capexSubsidyPerKW: 200000 }).omPerKg, base().omPerKg, 1e-12);
  });
});

// ---------------------------------------------------------------------------
describe('Property: subsidies may drive LCOH negative without clamping', function () {
  test('a very large production subsidy yields a negative LCOH plus a warning', function () {
    var res = base({ productionSubsidyPerKg: 400 });
    assert(Number.isFinite(res.lcoh), 'LCOH must be finite');
    assert(res.lcoh < 0, 'LCOH must be allowed to go negative, got ' + res.lcoh);
    assert(res.warnings.some(function (m) { return /negative/i.test(m); }),
      'the informational flag must be raised');
  });

  test('gross cost stays positive even when the net is negative', function () {
    var res = base({ productionSubsidyPerKg: 400 });
    assert(res.grossPerKg > 0, 'gross cost before subsidies must remain positive');
    assertClose(res.lcoh, res.grossPerKg - res.subsidyTotalPerKg, 1e-9, 'net = gross - subsidies');
  });
});

// ---------------------------------------------------------------------------
describe('Repricing NPV-neutrality is stated against the right benchmark', function () {
  // The block prices span the full plant life and the regulatory rate base
  // credits no residual, so the comparable flat price is one recovering the
  // same capital over the same horizon on the same terms -- N = plantLife,
  // residual 0. Comparing against the headline LCOH instead (which amortises
  // over the user's shorter recovery period) makes a correct model look wrong
  // by tens of rupees per kg, which is what the dashboard used to display.
  function neutralPair(overrides) {
    var c = Object.assign({}, DEFAULTS, BASE, overrides);
    var flat = base(overrides);
    var rp = M.repricingSchedule(flat, c, 250, 3);
    var benchC = Object.assign({}, c, { N: c.plantLife, residualPct: 0 });
    var bench = run('AY2025-26', 'Gujarat', 4.98, benchC);
    return { rp: rp, bench: bench, flat: flat };
  }

  [3, 5, 7, 10, 15, 20].forEach(function (N) {
    test('N=' + N + ' with a 20-year plant life: PV-levelised matches the like-for-like flat price', function () {
      var p = neutralPair({ N: N, plantLife: 20 });
      assert(p.rp.ok, 'repricing must succeed');
      assertClose(p.rp.pvLevelisedPrice, p.bench.lcoh, 1.0,
        'PV-levelised vs flat price over the same horizon');
    });
  });

  test('the identity is specifically against plant life, not the recovery period', function () {
    // Guards the regression directly: at N=7 the headline LCOH is far from the
    // PV-levelised price, and that is expected rather than a failure.
    var p = neutralPair({ N: 7, plantLife: 20 });
    assertClose(p.rp.pvLevelisedPrice, p.bench.lcoh, 1.0, 'against plant-life benchmark');
    assert(Math.abs(p.rp.pvLevelisedPrice - p.flat.lcoh) > 10,
      'the headline LCOH at N=7 should differ materially; if it does not, this test has stopped being meaningful');
  });

  test('varying plant life keeps the identity while the stack treatments agree', function () {
    // Up to ~21 years at the default stack life there is at most one
    // replacement, which both modules fund identically.
    [10, 15, 20].forEach(function (pl) {
      var p = neutralPair({ N: 7, plantLife: pl });
      assertClose(p.rp.pvLevelisedPrice, p.bench.lcoh, 1.0, 'plantLife=' + pl);
    });
  });

  test('capital recovery alone is exact at every plant life', function () {
    // With no stack cost the two modules must agree to floating-point
    // precision, which isolates capital recovery from stack financing and
    // proves the neutrality result itself is not approximate.
    [10, 20, 30, 40].forEach(function (pl) {
      var p = neutralPair({ N: 7, plantLife: pl, stackPct: 0 });
      assertClose(p.rp.pvLevelisedPrice, p.bench.lcoh, 1e-6, 'plantLife=' + pl + ' with no stack cost');
    });
  });

  test('beyond one stack replacement the two modules diverge, by design', function () {
    // Documented limitation rather than a defect: the flat LCOH runs a sinking
    // fund covering every replacement while k * interval < N, whereas the
    // specification's repricing pseudocode triggers exactly once
    // (`if t == ceil(stack_life_hours / hours)`). At the default 20-year plant
    // life this never bites. This test pins the behaviour so that a future
    // change to either module is a deliberate decision, not a silent drift.
    var p = neutralPair({ N: 7, plantLife: 30 });
    var gap = Math.abs(p.rp.pvLevelisedPrice - p.bench.lcoh);
    assert(gap > 1.0, 'expected the known divergence at a 30-year plant life, got Rs ' + gap.toFixed(2));
    assert(gap < 5.0, 'divergence should stay small; a large jump means something else broke: Rs ' + gap.toFixed(2));
  });
});
