'use strict';
var path = require('path');
var F = require('./framework.js');
var M = require(path.join(__dirname, '..', 'model.js'));
var DATA = require(path.join(__dirname, '..', 'data.json'));

var describe = F.describe, test = F.test, assert = F.assert, assertClose = F.assertClose;

var DEFAULTS = {
  N: 20, r: 0.10, capexPerKW: 62010, electrolyserPerKW: 39000,
  SEC: 52, loadFactor: 1.0, omPct: 0.04, waterCostPerKg: 0.90,
  stackPct: 0.40, stackLifeHours: 60000, residualPct: 0.0, plantLife: 20,
};

function withDefaults(overrides) {
  var c = Object.assign({}, DEFAULTS, overrides);
  return c;
}

function computeCase(yearKey, state, ceiling, c) {
  var yd = DATA.years[yearKey];
  var sd = DATA.states[state];
  return M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, ceiling, c);
}

describe('Numerical reference cases (tolerance ±Rs1.0/kg)', function () {
  var cases = [
    ['AY2025-26', 'Gujarat', 4.98, 4.599, 20, 0, 5654, 64.5, 268.1],
    ['AY2024-25', 'Gujarat', 5.32, 4.33, 20, 0, 6000, 68.5, 284.8],
    ['AY2023-24', 'Gujarat', 6.18, 4.59, 20, 0, 5658, 64.6, 330.7],
    ['AY2022-23', 'Gujarat', 6.39, 4.52, 20, 0, 5749, 65.6, 342.8],
    ['AY2025-26', 'Rajasthan', 5.20, 4.60, 20, 0, 5641, 64.4, 278.3],
    ['AY2025-26', 'Gujarat', 5.92, 4.01, 7, 0, 6483, 74.0, 308.7],
    ['AY2025-26', 'Gujarat', 5.55, 4.30, 7, 0.35, 6049, 69.1, 289.9],
  ];
  cases.forEach(function (row) {
    var yearKey = row[0], state = row[1], ceiling = row[2], MW = row[3], N = row[4], residualPct = row[5];
    var expLCOH = row[8];
    test(yearKey + ' ' + state + ' ceiling ' + ceiling + ' N=' + N + ' resid=' + residualPct, function () {
      var c = withDefaults({ MW: MW, N: N, residualPct: residualPct });
      var res = computeCase(yearKey, state, ceiling, c);
      assert(res.ok, 'expected a valid result, got errors: ' + JSON.stringify(res.errors));
      assertClose(res.lcoh, expLCOH, 1.0, 'LCOH');
    });
  });
});

describe('Optima (Gujarat, N=20, min-run 2h)', function () {
  var cases = [
    ['AY2022-23', 6.40, 342.8],
    ['AY2023-24', 6.19, 330.7],
    ['AY2024-25', 5.32, 284.8],
    ['AY2025-26', 4.98, 268.1],
  ];
  cases.forEach(function (row) {
    var yearKey = row[0], expCeiling = row[1], expLCOH = row[2];
    test(yearKey + ' optimum', function () {
      var c = withDefaults({ MW: 4.6, N: 20 });
      var yd = DATA.years[yearKey];
      var sd = DATA.states.Gujarat;
      var best = M.findOptimum(yd.sweep['2'], sd.adder, sd.loss_factor, c);
      assert(!!best, 'optimum search returned nothing');
      assertClose(best.ceilingLanded, expCeiling, 0.15, 'optimum ceiling');
      assertClose(best.lcoh, expLCOH, 1.0, 'optimum LCOH');
    });
  });
});

describe('Property: MW invariance', function () {
  test('optimum ceiling/hours/CF/LCOH identical across MW in {1,2,5,10,20,50}', function () {
    var sd = DATA.states.Gujarat;
    var yd = DATA.years['AY2025-26'];
    var mws = [1, 2, 5, 10, 20, 50];
    var results = mws.map(function (mw) {
      var c = withDefaults({ MW: mw, N: 20 });
      return M.findOptimum(yd.sweep['2'], sd.adder, sd.loss_factor, c);
    });
    var ref = results[0];
    results.forEach(function (r, i) {
      assertClose(r.ceilingLanded, ref.ceilingLanded, 1e-6, 'ceiling for MW=' + mws[i]);
      assertClose(r.hours, ref.hours, 1e-6, 'hours for MW=' + mws[i]);
      assertClose(r.capacityFactor, ref.capacityFactor, 1e-9, 'CF for MW=' + mws[i]);
      assertClose(r.lcoh, ref.lcoh, 1e-6, 'LCOH for MW=' + mws[i]);
    });
  });
});

describe('Property: monotonicity of hours in ceiling', function () {
  Object.keys(DATA.years).forEach(function (yk) {
    ['2', '4', '8', '16'].forEach(function (mb) {
      test(yk + ' minrun=' + mb, function () {
        var rows = DATA.years[yk].sweep[mb];
        var prev = -1;
        for (var i = 0; i < rows.length; i++) {
          assert(rows[i].h >= prev - 1e-6, 'hours decreased at t=' + rows[i].t);
          prev = rows[i].h;
        }
      });
    });
  });
});

describe('Property: weighted-mean bound (w <= t, within data rounding tolerance)', function () {
  Object.keys(DATA.years).forEach(function (yk) {
    ['2', '4', '8', '16'].forEach(function (mb) {
      test(yk + ' minrun=' + mb, function () {
        var rows = DATA.years[yk].sweep[mb];
        for (var i = 0; i < rows.length; i++) {
          // Provided data.json is generated (not modified by this app) and
          // carries independently-rounded t/w values, so allow a small
          // rounding tolerance rather than requiring an exact bound.
          assert(rows[i].w <= rows[i].t + 0.02, 'w=' + rows[i].w + ' > t=' + rows[i].t + ' at index ' + i);
        }
      });
    });
  });
});

describe('Property: state ordering (Rajasthan LCOH > Gujarat LCOH, ~Rs10/kg)', function () {
  test('AY2025-26 at default ceiling', function () {
    var c = withDefaults({ MW: 5, N: 20 });
    var gj = computeCase('AY2025-26', 'Gujarat', 4.98, c);
    var rj = computeCase('AY2025-26', 'Rajasthan', 4.98, c);
    assert(rj.lcoh > gj.lcoh, 'expected Rajasthan LCOH > Gujarat LCOH');
    assertClose(rj.lcoh - gj.lcoh, 10, 5, 'state gap roughly Rs10/kg');
  });
});

describe('Property: repricing NPV-neutrality', function () {
  test('AY2025-26 Gujarat 4.599MW N=7: block prices and PV-levelised match spec', function () {
    var c = withDefaults({ MW: 4.599, N: 7, plantLife: 20 });
    var base = computeCase('AY2025-26', 'Gujarat', 4.98, c);
    assert(base.ok, 'base flat calc failed');
    var rp = M.repricingSchedule(base, c, 250, 3);
    assert(rp.ok, 'repricing schedule failed');
    var expected = [326, 301, 228, 213, 220, 215, 212];
    assertEqualLen(rp.blocks.length, expected.length);
    rp.blocks.forEach(function (b, i) {
      assertClose(b.price, expected[i], 2.0, 'block ' + (i + 1) + ' price');
    });
    assertClose(rp.pvLevelisedPrice, 268.5, 2.0, 'PV-levelised price');
  });
  function assertEqualLen(a, b) {
    if (a !== b) throw new Error('expected ' + b + ' blocks, got ' + a);
  }
});

describe('Property: CRF', function () {
  test('CRF(0.10, 20) ≈ 0.117460', function () { assertClose(M.CRF(0.10, 20), 0.117460, 1e-5); });
  test('CRF(0.10, 7) ≈ 0.205405', function () { assertClose(M.CRF(0.10, 7), 0.205405, 1e-5); });
  test('CRF(0, 10) = 0.1', function () { assertClose(M.CRF(0, 10), 0.1, 1e-12); });
});

describe('Robustness: edge cases never NaN/Infinity/throw', function () {
  var sd = DATA.states.Gujarat;
  var yd = DATA.years['AY2025-26'];

  test('hours = 0 (ceiling below year minimum)', function () {
    var c = withDefaults({ MW: 5 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 0.0, c);
    assert(res.ok === false, 'expected ok=false when hours are zero');
    assert(res.errors.length > 0, 'expected an explanatory message');
  });

  test('ceiling above year maximum clamps, plant runs continuously', function () {
    var c = withDefaults({ MW: 5 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 999, c);
    assert(Number.isFinite(res.lcoh), 'LCOH should be finite');
    assert(res.hours <= 8760 + 1, 'hours should be clamped near a full year');
  });

  test('MW = 0', function () {
    var c = withDefaults({ MW: 0 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 4.98, c);
    assert(res.ok === false);
  });
  test('MW negative', function () {
    var c = withDefaults({ MW: -5 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 4.98, c);
    assert(res.ok === false);
  });
  test('SEC = 0', function () {
    var c = withDefaults({ MW: 5, SEC: 0 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 4.98, c);
    assert(res.ok === false);
  });
  test('N = 0', function () {
    var c = withDefaults({ MW: 5, N: 0 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 4.98, c);
    assert(res.ok === false);
  });
  test('r = 0 degrades gracefully', function () {
    var c = withDefaults({ MW: 5, r: 0 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 4.98, c);
    assert(res.ok, 'expected a valid result at r=0');
    assert(Number.isFinite(res.lcoh));
  });
  test('residual = 100%', function () {
    var c = withDefaults({ MW: 5, residualPct: 1.0 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 4.98, c);
    assert(res.ok);
    assert(Number.isFinite(res.lcoh));
  });
  test('stack life shorter than one year of operation (multiple replacements)', function () {
    var c = withDefaults({ MW: 5, stackLifeHours: 500 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 4.98, c);
    assert(res.ok);
    assert(Number.isFinite(res.lcoh));
    assert(res.stackSinking > 0);
  });
  test('load factor = 0', function () {
    var c = withDefaults({ MW: 5, loadFactor: 0 });
    var res = M.computeLCOH(yd.sweep['2'], sd.adder, sd.loss_factor, 4.98, c);
    assert(res.ok === false);
  });
});

