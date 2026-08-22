'use strict';
var path = require('path');
var F = require('./framework.js');
// app.js requires GDAM_MODEL to be reachable as a global before its factory
// runs; stub it on `global` since Node has no `window`/`self`.
global.GDAM_MODEL = require(path.join(__dirname, '..', 'model.js'));
var APP = require(path.join(__dirname, '..', 'app.js'));

var describe = F.describe, test = F.test, assert = F.assert, assertEqual = F.assertEqual;

describe('Hash codec: round-trip', function () {
  test('every default parameter survives encode -> decode', function () {
    var defaults = APP.defaultParams();
    var hash = APP.encodeParams(defaults);
    var decoded = APP.decodeParams(hash);
    APP.PARAM_SPEC.forEach(function (spec) {
      assertEqual(decoded[spec.prop], defaults[spec.prop], 'round-trip of ' + spec.prop);
    });
  });

  test('a modified parameter set survives encode -> decode', function () {
    var p = APP.defaultParams();
    p.year = 'AY2022-23';
    p.state = 'Rajasthan';
    p.mw = 12.3;
    p.ceiling = 6.25;
    p.reprice = true;
    p.minRunHours = 4;
    var decoded = APP.decodeParams(APP.encodeParams(p));
    APP.PARAM_SPEC.forEach(function (spec) {
      assertEqual(decoded[spec.prop], p[spec.prop], 'round-trip of ' + spec.prop);
    });
  });
});

describe('Hash codec: defensive parsing of untrusted input', function () {
  test('unknown keys are ignored', function () {
    var decoded = APP.decodeParams('#y=AY2025-26&evil=1&__proto__=polluted');
    assertEqual(decoded.year, 'AY2025-26');
    assert(!Object.prototype.hasOwnProperty.call(decoded, 'evil'));
  });

  test('invalid enum values fall back to default', function () {
    var decoded = APP.decodeParams('#y=NotAYear&st=Nowhere');
    assertEqual(decoded.year, 'AY2025-26');
    assertEqual(decoded.state, 'Gujarat');
  });

  test('NaN/Infinity numeric values fall back to default', function () {
    var decoded = APP.decodeParams('#mw=NaN&c=Infinity&n=-Infinity');
    var d = APP.defaultParams();
    assertEqual(decoded.mw, d.mw);
    assertEqual(decoded.ceiling, d.ceiling);
    assertEqual(decoded.n, d.n);
  });

  test('out-of-range numbers are clamped, not rejected', function () {
    var decoded = APP.decodeParams('#mw=999999&c=-50');
    assertEqual(decoded.mw, 50);
    assertEqual(decoded.ceiling, 1.5);
  });

  test('__proto__ / constructor / prototype keys never pollute Object.prototype', function () {
    APP.decodeParams('#__proto__[polluted]=1&constructor=x&prototype=y');
    assert(({}).polluted === undefined, 'Object.prototype was polluted');
    assert(({}).polluted !== 1, 'Object.prototype was polluted');
  });

  test('malformed percent-encoding does not throw', function () {
    APP.decodeParams('#y=%E0%A4%A');
    // reaching here without throwing is the assertion
  });

  test('script tags and SQL-ish strings never crash the decoder', function () {
    APP.decodeParams('#y=<script>alert(1)</script>&st=\' OR 1=1--');
    // reaching here without throwing is the assertion
  });

  test('empty and hash-only input decodes to defaults', function () {
    var d = APP.defaultParams();
    var decoded1 = APP.decodeParams('');
    var decoded2 = APP.decodeParams('#');
    APP.PARAM_SPEC.forEach(function (spec) {
      assertEqual(decoded1[spec.prop], d[spec.prop]);
      assertEqual(decoded2[spec.prop], d[spec.prop]);
    });
  });
});

