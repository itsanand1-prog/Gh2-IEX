/* Minimal, dependency-free test runner for tests/. Node only. */
'use strict';

var suites = [];
var current = null;

function describe(name, fn) {
  current = { name: name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

function test(name, fn) {
  if (!current) describe('(root)', function () {});
  var target = suites[suites.length - 1];
  target.tests.push({ name: name, fn: fn });
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}
function assertClose(actual, expected, tol, message) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error((message || 'value mismatch') + ': got ' + actual + ', expected ' + expected + ' ± ' + tol);
  }
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || 'not equal') + ': got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
  }
}

function run() {
  var pass = 0, fail = 0;
  var failures = [];
  suites.forEach(function (suite) {
    if (!suite.tests.length) return;
    console.log('\n' + suite.name);
    suite.tests.forEach(function (t) {
      try {
        t.fn();
        pass++;
        console.log('  ✓ ' + t.name);
      } catch (e) {
        fail++;
        failures.push(suite.name + ' > ' + t.name + ': ' + e.message);
        console.log('  ✗ ' + t.name + ' -- ' + e.message);
      }
    });
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed (' + (pass + fail) + ' total)');
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(function (f) { console.log('  - ' + f); });
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

module.exports = { describe: describe, test: test, assert: assert, assertClose: assertClose, assertEqual: assertEqual, run: run };
