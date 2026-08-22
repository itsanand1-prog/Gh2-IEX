'use strict';
var path = require('path');
var F = require('./framework.js');
global.GDAM_MODEL = require(path.join(__dirname, '..', 'model.js'));
var APP = require(path.join(__dirname, '..', 'app.js'));
var MODEL = global.GDAM_MODEL;
var DATA = require(path.join(__dirname, '..', 'data.json'));

var describe = F.describe, test = F.test, assert = F.assert;

// Deterministic PRNG so failures are reproducible across CI runs.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var ADVERSARIAL_HASHES = [
  '', '#', '#=', '#&&&&', '#y=', '#y=&st=&mw=',
  '#__proto__=1', '#__proto__[x]=1', '#constructor=x', '#prototype=y',
  '#constructor[prototype][polluted]=1',
  '#mw=NaN', '#mw=Infinity', '#mw=-Infinity', '#mw=1e999', '#mw=-1e999',
  '#mw=' + '9'.repeat(400),
  '#y=<script>alert(1)</script>', '#st=\'; DROP TABLE users; --',
  '#y=' + encodeURIComponent('日本語テスト'), '#st=' + encodeURIComponent('🚀💥'),
  '#mw=%00', '#mw=%zz', '#y=%', '#y=%E0%A4', '#%=%',
  '#' + 'a=1&'.repeat(500),
  '#a'.repeat(2000) + '=1',
  '#mw=5&mw=10&mw=15', // duplicate keys
  '#c=1.50e0&n=0x10', // odd numeric formats
  '#rp=yes&rp=no&rp=1',
  '#mr=3', '#mr=abc',
  null, undefined, 42, {}, [],
];

function randomHash(rand) {
  var keys = APP.PARAM_SPEC.map(function (s) { return s.key; }).concat(
    ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'evil', '']
  );
  var nPairs = 1 + Math.floor(rand() * 20);
  var pieces = [];
  for (var i = 0; i < nPairs; i++) {
    var k = keys[Math.floor(rand() * keys.length)];
    var vRoll = rand();
    var v;
    if (vRoll < 0.15) v = String((rand() - 0.5) * 1e12);
    else if (vRoll < 0.25) v = 'NaN';
    else if (vRoll < 0.35) v = rand() < 0.5 ? 'Infinity' : '-Infinity';
    else if (vRoll < 0.45) v = '';
    else if (vRoll < 0.55) v = '__proto__';
    else if (vRoll < 0.65) v = '<img src=x onerror=alert(1)>';
    else if (vRoll < 0.75) v = 'AY2025-26';
    else if (vRoll < 0.85) v = String(Math.floor((rand() - 0.5) * 100000));
    else v = Array.from({ length: Math.floor(rand() * 20) }, function () {
      return String.fromCharCode(32 + Math.floor(rand() * 95));
    }).join('');
    pieces.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  return '#' + pieces.join('&');
}

function assertNoPollution() {
  assert(({}).polluted === undefined, 'Object.prototype.polluted was set');
  assert(({}).__proto__ === Object.prototype, 'Object.prototype chain was tampered');
  assert(typeof ({}).evil === 'undefined', 'Object.prototype.evil was set');
}

function assertParamsSane(p) {
  assert(p !== null && typeof p === 'object', 'decoded params must be an object');
  assert(APP.YEAR_KEYS.indexOf(p.year) !== -1, 'year must be a known key, got ' + p.year);
  assert(APP.STATE_KEYS.indexOf(p.state) !== -1, 'state must be a known key, got ' + p.state);
  assert(APP.MIN_RUN_HOURS.indexOf(p.minRunHours) !== -1, 'minRunHours must be a known value');
  ['mw', 'ceiling', 'n', 'ratePct', 'electrolyserPerKW', 'civilPct', 'waterTreatPct',
    'evacPct', 'purifyPct', 'instruPct', 'ownerPct', 'sec', 'loadFactorPct', 'omPct',
    'waterCostPerKg', 'stackPct', 'stackLifeHours', 'residualPct', 'greyBenchmark', 'plantLife']
    .forEach(function (k) {
      assert(Number.isFinite(p[k]), k + ' must be a finite number, got ' + p[k]);
    });
  assert(typeof p.reprice === 'boolean', 'reprice must be boolean');
}

describe('Fuzz: adversarial fixed hash strings', function () {
  ADVERSARIAL_HASHES.forEach(function (h, i) {
    test('adversarial case #' + i + ' (' + String(h).slice(0, 40) + ')', function () {
      var decoded;
      decoded = APP.decodeParams(h);
      assertParamsSane(decoded);
      assertNoPollution();
      var c = APP.buildCostParams(decoded);
      var yd = DATA.years[decoded.year];
      var sd = DATA.states[decoded.state];
      var sweepKey = APP.minRunToSweepKey(decoded.minRunHours);
      var result = MODEL.computeLCOH(yd.sweep[sweepKey], sd.adder, sd.loss_factor, decoded.ceiling, c);
      assert(result.ok === true || result.ok === false, 'result.ok must be a boolean');
      if (result.ok) assert(Number.isFinite(result.lcoh), 'ok result must have finite LCOH');
      var reEncoded = APP.encodeParams(decoded);
      assert(typeof reEncoded === 'string' && reEncoded.charAt(0) === '#', 'encodeParams must return a hash string');
    });
  });
});

describe('Fuzz: 1000 randomised hash strings', function () {
  var rand = mulberry32(20260822);
  var failures = [];
  for (var i = 0; i < 1000; i++) {
    var hash = randomHash(rand);
    try {
      var decoded = APP.decodeParams(hash);
      assertParamsSane(decoded);
      assertNoPollution();
      var c = APP.buildCostParams(decoded);
      var yd = DATA.years[decoded.year];
      var sd = DATA.states[decoded.state];
      var sweepKey = APP.minRunToSweepKey(decoded.minRunHours);
      var result = MODEL.computeLCOH(yd.sweep[sweepKey], sd.adder, sd.loss_factor, decoded.ceiling, c);
      if (result.ok && !Number.isFinite(result.lcoh)) {
        failures.push('case ' + i + ' (' + hash + '): ok but non-finite LCOH');
      }
      var reEncoded = APP.encodeParams(decoded);
      if (typeof reEncoded !== 'string') failures.push('case ' + i + ': encodeParams did not return a string');
    } catch (e) {
      failures.push('case ' + i + ' (' + hash + ') threw: ' + e.message);
    }
  }
  test('zero exceptions, zero NaN results, zero prototype pollution across 1000 cases', function () {
    if (failures.length) {
      throw new Error(failures.length + ' failures, first: ' + failures[0]);
    }
  });
});

