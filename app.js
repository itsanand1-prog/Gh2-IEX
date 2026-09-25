/*
 * app.js — UI, DOM construction, charts and URL-hash handling.
 *
 * No ES modules (blocked by CORS under file://). Pure, DOM-free functions
 * (hash codec, param spec, capex helper wiring) are exposed on
 * `GDAM_APP` via the same UMD pattern as model.js so tests/ can exercise
 * them under Node without a browser. DOM bootstrap only runs when a
 * `document` is present.
 *
 * The single most important rule in this file: never use innerHTML,
 * outerHTML, insertAdjacentHTML or document.write. The URL hash is
 * attacker-controlled input, and building every element by hand with
 * createElement/textContent is what keeps it inert no matter what it
 * contains.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GDAM_APP = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Parameter spec: single source of truth for defaults, ranges and the
  // URL-hash whitelist. Every hash key here is the ONLY input ever read
  // from location.hash; anything else is ignored outright.
  // ---------------------------------------------------------------------

  var YEAR_KEYS = ['AY2022-23', 'AY2023-24', 'AY2024-25', 'AY2025-26'];
  var STATE_KEYS = ['Gujarat', 'Rajasthan'];
  var MIN_RUN_HOURS = [0.5, 1, 2, 4];
  var MIN_RUN_SWEEP_KEYS = ['2', '4', '8', '16']; // index-aligned with MIN_RUN_HOURS
  // The min-run rule depends on which 15-minute blocks are adjacent in time, so
  // it cannot be recomputed in the browser — it needs the raw price series.
  // data.js ships one pre-computed sweep per setting, which is why this is a
  // fixed four-option selector rather than a free numeric input.
  // Kept in step with GDAM_MODEL.OPEX_UNITS; duplicated here so the parameter
  // spec (and therefore the hash whitelist) does not depend on load order.
  var OPEX_UNITS = ['Rs/kg H2', 'Rs/unit power', 'Rs/MW/year', 'Rs/year', '% of capex/year'];

  // NOTE: the numeric reference cases in the spec were validated against
  // sweep key "2" (0.5 h min-run), so that is the default here even
  // though it is displayed to the user as "0.5 h".
  var PARAM_SPEC = [
    { key: 'y', prop: 'year', type: 'enum', options: YEAR_KEYS, def: 'AY2025-26' },
    { key: 'st', prop: 'state', type: 'enum', options: STATE_KEYS, def: 'Gujarat' },
    { key: 'mw', prop: 'mw', type: 'number', min: 0.5, max: 50, def: 5.0 },
    { key: 'c', prop: 'ceiling', type: 'number', min: 1.50, max: 8.00, def: 4.98 },
    { key: 'n', prop: 'n', type: 'number', min: 3, max: 20, def: 7 },
    { key: 'r', prop: 'ratePct', type: 'number', min: 5, max: 18, def: 10 },
    { key: 'rp', prop: 'reprice', type: 'bool', def: false },
    { key: 'ek', prop: 'electrolyserPerKW', type: 'number', min: 5000, max: 300000, def: 39000 },
    { key: 'civ', prop: 'civilPct', type: 'number', min: 0, max: 60, def: 12 },
    { key: 'wt', prop: 'waterTreatPct', type: 'number', min: 0, max: 60, def: 6 },
    { key: 'ev', prop: 'evacPct', type: 'number', min: 0, max: 60, def: 10 },
    { key: 'pu', prop: 'purifyPct', type: 'number', min: 0, max: 60, def: 10 },
    { key: 'ins', prop: 'instruPct', type: 'number', min: 0, max: 60, def: 6 },
    { key: 'own', prop: 'ownerPct', type: 'number', min: 0, max: 60, def: 15 },
    { key: 'sec', prop: 'sec', type: 'number', min: 40, max: 70, def: 52 },
    { key: 'lf', prop: 'loadFactorPct', type: 'number', min: 50, max: 100, def: 100 },
    { key: 'mr', prop: 'minRunHours', type: 'enum-num', options: MIN_RUN_HOURS, def: 2 },
    { key: 'om', prop: 'omPct', type: 'number', min: 0, max: 15, def: 4.0 },
    { key: 'wc', prop: 'waterCostPerKg', type: 'number', min: 0, max: 10, def: 0.90 },
    { key: 'sp', prop: 'stackPct', type: 'number', min: 0, max: 100, def: 40 },
    { key: 'sl', prop: 'stackLifeHours', type: 'number', min: 100, max: 200000, def: 60000 },
    { key: 'res', prop: 'residualPct', type: 'number', min: 0, max: 100, def: 0 },
    { key: 'grey', prop: 'greyBenchmark', type: 'number', min: 1, max: 5000, def: 250 },
    { key: 'pl', prop: 'plantLife', type: 'number', min: 1, max: 40, def: 20 },
    // --- additional charges and subsidies: all zero by default, so the
    // out-of-the-box result is bit-identical to the build without them.
    { key: 'ac', prop: 'additionalCapexPerKW', type: 'number', min: 0, max: 100000, def: 0 },
    { key: 'ao', prop: 'additionalOpex', type: 'number', min: 0, max: 1000000, def: 0 },
    { key: 'au', prop: 'additionalOpexUnit', type: 'enum', options: OPEX_UNITS, def: 'Rs/unit power' },
    { key: 'cs', prop: 'capexSubsidyPerKW', type: 'number', min: 0, max: 60000, def: 0 },
    { key: 'ps', prop: 'productionSubsidyPerKg', type: 'number', min: 0, max: 200, def: 0 },
    { key: 'ws', prop: 'powerSubsidyPerUnit', type: 'number', min: 0, max: 5, def: 0 },
  ];

  function defaultParams() {
    var p = Object.create(null);
    for (var i = 0; i < PARAM_SPEC.length; i++) {
      p[PARAM_SPEC[i].prop] = PARAM_SPEC[i].def;
    }
    return p;
  }

  // ---------------------------------------------------------------------
  // URL hash codec — defensive parsing of attacker-controlled input.
  // Every value is coerced to Number/Boolean, rejected on NaN/Infinity,
  // clamped to its documented range, and enum values are checked against
  // a fixed whitelist array before use. Keys are looked up one at a time
  // from PARAM_SPEC (never derived from the parsed key string itself),
  // so nothing resembling "__proto__"/"constructor"/"prototype" can ever
  // reach an assignment target — prototype pollution is structurally
  // impossible here, not just filtered.
  // ---------------------------------------------------------------------

  function parseHashString(hash) {
    var raw = new Map();
    if (typeof hash !== 'string') return raw;
    var s = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    if (!s) return raw;
    var parts = s.split('&');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var eq = part.indexOf('=');
      if (eq < 0) continue;
      var k = part.slice(0, eq);
      var v = part.slice(eq + 1);
      try {
        k = decodeURIComponent(k);
        v = decodeURIComponent(v);
      } catch (e) {
        continue; // malformed percent-encoding: skip this pair, never throw
      }
      if (typeof k !== 'string' || k.length === 0 || k.length > 32) continue;
      if (typeof v !== 'string' || v.length > 256) continue;
      raw.set(k, v);
    }
    return raw;
  }

  function decodeParams(hash) {
    var raw = parseHashString(hash);
    var out = defaultParams();
    for (var i = 0; i < PARAM_SPEC.length; i++) {
      var spec = PARAM_SPEC[i];
      if (!raw.has(spec.key)) continue;
      var v = raw.get(spec.key);
      if (spec.type === 'enum') {
        if (spec.options.indexOf(v) !== -1) out[spec.prop] = v;
      } else if (spec.type === 'bool') {
        if (v === '1' || v === 'true') out[spec.prop] = true;
        else if (v === '0' || v === 'false') out[spec.prop] = false;
      } else if (spec.type === 'enum-num') {
        var n = Number(v);
        if (Number.isFinite(n) && spec.options.indexOf(n) !== -1) out[spec.prop] = n;
      } else if (spec.type === 'number') {
        var num = Number(v);
        if (Number.isFinite(num)) out[spec.prop] = clampParam(num, spec.min, spec.max);
      }
    }
    return out;
  }

  function clampParam(x, lo, hi) {
    if (!Number.isFinite(x)) return lo;
    return Math.min(hi, Math.max(lo, x));
  }

  function encodeParams(p) {
    var pieces = [];
    for (var i = 0; i < PARAM_SPEC.length; i++) {
      var spec = PARAM_SPEC[i];
      var v = p[spec.prop];
      var str;
      if (spec.type === 'bool') str = v ? '1' : '0';
      else if (spec.type === 'enum') str = String(v);
      else str = String(v);
      pieces.push(encodeURIComponent(spec.key) + '=' + encodeURIComponent(str));
    }
    return '#' + pieces.join('&');
  }

  function minRunToSweepKey(hours) {
    var idx = MIN_RUN_HOURS.indexOf(hours);
    if (idx === -1) idx = 0;
    return MIN_RUN_SWEEP_KEYS[idx];
  }

  // ---------------------------------------------------------------------
  // Bridge from UI params (percentages, hour-based min-run selector) to
  // the cost-parameter bag model.js expects (fractions, sweep key).
  // ---------------------------------------------------------------------

  function buildCostParams(p) {
    var uplifts = [
      p.civilPct / 100, p.waterTreatPct / 100, p.evacPct / 100,
      p.purifyPct / 100, p.instruPct / 100, p.ownerPct / 100,
    ];
    var capexPerKW = GDAM_MODEL.computeCapexPerKW(p.electrolyserPerKW, uplifts);
    return {
      MW: p.mw,
      N: p.n,
      r: p.ratePct / 100,
      capexPerKW: capexPerKW,
      electrolyserPerKW: p.electrolyserPerKW,
      SEC: p.sec,
      loadFactor: p.loadFactorPct / 100,
      omPct: p.omPct / 100,
      waterCostPerKg: p.waterCostPerKg,
      stackPct: p.stackPct / 100,
      stackLifeHours: p.stackLifeHours,
      residualPct: p.residualPct / 100,
      plantLife: p.plantLife,
      capexPerKWAllIn: capexPerKW,
      additionalCapexPerKW: p.additionalCapexPerKW,
      additionalOpex: p.additionalOpex,
      additionalOpexUnit: p.additionalOpexUnit,
      capexSubsidyPerKW: p.capexSubsidyPerKW,
      productionSubsidyPerKg: p.productionSubsidyPerKg,
      powerSubsidyPerUnit: p.powerSubsidyPerUnit,
    };
  }

  /** True when a lump-sum annual cost is in play, which breaks MW-invariance. */
  function breaksMwInvariance(p) {
    return p.additionalOpexUnit === 'Rs/year' && p.additionalOpex > 0;
  }

  // ---------------------------------------------------------------------
  // Small memoizer for the optimum search, keyed on everything that can
  // change its answer EXCEPT the ceiling itself (dragging the ceiling
  // slider must not re-run the ~600-point sweep).
  // ---------------------------------------------------------------------

  function makeOptimumCache() {
    var cache = new Map();
    return function findOptimumMemo(model, sweep, adder, lossFactor, key, c) {
      var cacheKey = key + '|' + c.N + '|' + c.r + '|' + c.capexPerKW + '|' +
        c.electrolyserPerKW + '|' + c.SEC + '|' + c.loadFactor + '|' + c.omPct + '|' +
        c.waterCostPerKg + '|' + c.stackPct + '|' + c.stackLifeHours + '|' + c.residualPct + '|' +
        c.additionalCapexPerKW + '|' + c.additionalOpex + '|' + c.additionalOpexUnit + '|' +
        c.capexSubsidyPerKW + '|' + c.productionSubsidyPerKg + '|' + c.powerSubsidyPerUnit + '|' +
        // MW only matters for the Rs/year lump sum, the one unit that breaks
        // MW-invariance; including it always is cheap and keeps this correct.
        c.MW;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      var result = model.findOptimum(sweep, adder, lossFactor, c);
      cache.set(cacheKey, result);
      return result;
    };
  }

  // GDAM_MODEL is a browser global; guard so this file can be required
  // under Node purely for its DOM-free exports (hash codec, param spec).
  var GDAM_MODEL = (typeof root !== 'undefined' && root.GDAM_MODEL) ||
    (typeof globalThis !== 'undefined' && globalThis.GDAM_MODEL) ||
    (typeof window !== 'undefined' && window.GDAM_MODEL) || null;

  var api = {
    PARAM_SPEC: PARAM_SPEC,
    YEAR_KEYS: YEAR_KEYS,
    STATE_KEYS: STATE_KEYS,
    MIN_RUN_HOURS: MIN_RUN_HOURS,
    MIN_RUN_SWEEP_KEYS: MIN_RUN_SWEEP_KEYS,
    OPEX_UNITS: OPEX_UNITS,
    breaksMwInvariance: breaksMwInvariance,
    defaultParams: defaultParams,
    parseHashString: parseHashString,
    decodeParams: decodeParams,
    encodeParams: encodeParams,
    clampParam: clampParam,
    minRunToSweepKey: minRunToSweepKey,
    buildCostParams: buildCostParams,
    makeOptimumCache: makeOptimumCache,
  };

  // -----------------------------------------------------------------
  // DOM bootstrap — everything below touches `document` and only runs
  // in a browser.
  // -----------------------------------------------------------------
  if (typeof document !== 'undefined') {
    bootstrap(api);
  }

  return api;

  // =====================================================================
  function bootstrap(API) {
    var DATA = window.GDAM_DATA;
    var MODEL = window.GDAM_MODEL;
    var findOptimumMemo = API.makeOptimumCache();

    var params = API.defaultParams();
    var rafHandle = null;
    var chartRafHandle = null;
    var lastState = null; // cached model output, so resize can redraw charts only
    // Which electrolyser chemistry each minimum-operation-time setting suits.
    var MIN_RUN_HINTS = { 0.5: 'PEM', 1: 'PEM', 2: 'alkaline', 4: 'alkaline, conservative' };
    var els = {}; // filled by buildLayout()

    function fmt(n, digits) {
      if (!Number.isFinite(n)) return '—';
      return n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    function fmtInt(n) {
      if (!Number.isFinite(n)) return '—';
      return Math.round(n).toLocaleString('en-IN');
    }

    // -- element helpers (createElement/textContent only, never innerHTML) --
    function el(tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) {
        for (var k in attrs) {
          if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
          if (k === 'text') e.textContent = attrs[k];
          else if (k === 'class') e.className = attrs[k];
          else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
          else e.setAttribute(k, attrs[k]);
        }
      }
      if (children) {
        for (var i = 0; i < children.length; i++) {
          if (children[i]) e.appendChild(children[i]);
        }
      }
      return e;
    }
    function txt(s) { return document.createTextNode(s); }
    function svgEl(tag, attrs) {
      var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
      if (attrs) {
        for (var k in attrs) {
          if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
        }
      }
      return e;
    }
    function clearChildren(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------
    function buildLayout() {
      var root = document.getElementById('app');

      var header = el('header', { class: 'site-header' }, [
        el('div', { class: 'brand' }, [
          el('h1', { text: 'GDAM Green Hydrogen LCOH Explorer' }),
          el('p', { class: 'tagline', text: 'Levelised cost of hydrogen against four years of real IEX GDAM block prices.' }),
        ]),
        el('a', {
          class: 'help-btn', href: 'docs/methodology.pdf', target: '_blank',
          rel: 'noopener noreferrer', text: 'Help / Methodology (PDF)',
          'aria-label': 'Open the GDAM GH2 LCOH methodology document (PDF, opens in a new tab)',
        }),
      ]);

      var intro = el('p', {
        class: 'intro',
        text: 'This dashboard estimates the levelised cost of green hydrogen (LCOH) for an Indian electrolyser that buys power only from the IEX Green Day-Ahead Market, running whenever the 15-minute block price falls below a ceiling you set — with no captive solar/wind and no battery storage. It replays four real historical price years (Aug 2022–Aug 2026) so you can see how the same strategy would have performed across different market conditions. Set the plant size, price ceiling, state and cost assumptions on the left, and the resulting cost per kilogram, the LCOH-minimising ceiling, and a full capital/O&M/stack/power/water breakdown update instantly on the right.',
      });

      var main = el('main', { class: 'layout' });
      var controls = el('section', { class: 'controls', 'aria-label': 'Inputs' });
      var results = el('section', { class: 'results', 'aria-label': 'Results' });
      main.appendChild(controls);
      main.appendChild(results);

      var footer = el('footer', { class: 'site-footer' }, [
        el('p', {}, [
          txt('Zero-network-request static tool. '),
          el('a', { href: 'README.md', rel: 'noopener noreferrer', text: 'README' }),
          txt(' · '),
          el('a', { href: 'SECURITY.md', rel: 'noopener noreferrer', text: 'SECURITY' }),
        ]),
      ]);

      root.appendChild(header);
      root.appendChild(intro);
      root.appendChild(main);
      root.appendChild(footer);

      buildControls(controls);
      buildResults(results);
    }

    function field(labelText, inputEl, extra) {
      var id = inputEl.id;
      var label = el('label', { for: id, text: labelText });
      var wrap = el('div', { class: 'field' }, [label, inputEl]);
      if (extra) wrap.appendChild(extra);
      return wrap;
    }

    /** A bare number input (no slider) for the wide-range charge/subsidy fields. */
    function numberField(id, labelText, min, max, step, value, onChange) {
      var input = el('input', {
        type: 'number', id: id, min: String(min), max: String(max), step: String(step),
        value: String(value), placeholder: String(0), inputmode: 'decimal',
      });
      input.addEventListener('input', function () {
        var v = Number(input.value);
        if (input.value === '' || !Number.isFinite(v)) { onChange(null); return; }
        onChange(API.clampParam(v, min, max));
      });
      return field(labelText, el('div', { class: 'range-row' }, [input]));
    }

    function rangeNumberPair(idBase, labelText, min, max, step, value, onChange, unit) {
      var range = el('input', {
        type: 'range', id: idBase + '-range', min: String(min), max: String(max),
        step: String(step), value: String(value),
      });
      var number = el('input', {
        type: 'number', id: idBase, min: String(min), max: String(max),
        step: String(step), value: String(value), placeholder: String(value),
        inputmode: 'decimal',
      });
      var unitSpan = unit ? el('span', { class: 'unit', text: unit }) : null;
      range.addEventListener('input', function () {
        number.value = range.value;
        onChange(Number(range.value));
      });
      number.addEventListener('input', function () {
        var v = Number(number.value);
        if (number.value === '' || !Number.isFinite(v)) {
          onChange(null); // signals "invalid, keep previous" to caller
          return;
        }
        var clamped = API.clampParam(v, min, max);
        range.value = String(clamped);
        onChange(clamped);
      });
      var row = el('div', { class: 'range-row' }, [range, number]);
      if (unitSpan) row.appendChild(unitSpan);
      return field(labelText, row, null);
    }

    function buildControls(container) {
      var basic = el('div', { class: 'panel basic-panel' });
      basic.appendChild(el('h2', { text: 'Plant & price settings' }));

      var yearSel = el('select', { id: 'in-year' });
      API.YEAR_KEYS.forEach(function (yk) {
        var opt = el('option', { value: yk, text: DATA.years[yk].label + ' (' + yk + ')' });
        if (yk === params.year) opt.selected = true;
        yearSel.appendChild(opt);
      });
      yearSel.addEventListener('change', function () { setParam('year', yearSel.value); });
      basic.appendChild(field('Price year', yearSel));

      var stateSel = el('select', { id: 'in-state' });
      API.STATE_KEYS.forEach(function (sk) {
        var opt = el('option', { value: sk, text: sk });
        if (sk === params.state) opt.selected = true;
        stateSel.appendChild(opt);
      });
      stateSel.addEventListener('change', function () { setParam('state', stateSel.value); });
      basic.appendChild(field('State', stateSel));

      basic.appendChild(rangeNumberPair('in-mw', 'Plant capacity (MW)', 0.5, 50, 0.1, params.mw,
        function (v) { if (v !== null) setParam('mw', v); }));
      var mwNote = el('p', { class: 'note', text: 'Plant size cancels out of the LCOH exactly — capex, output and O&M all scale with MW, so a bigger or smaller plant gives the same Rs/kg. MW only sets the absolute production and capex totals shown below.' });
      basic.appendChild(mwNote);
      // Shown only while a Rs/year lump sum is entered — the one input unit
      // that genuinely breaks MW-invariance.
      els.mwExceptionNote = el('p', { class: 'note note-exception', id: 'mw-exception', hidden: 'hidden' });
      basic.appendChild(els.mwExceptionNote);

      basic.appendChild(rangeNumberPair('in-ceiling', 'Max landed power price (Rs/unit)', 1.50, 8.00, 0.01, params.ceiling,
        function (v) { if (v !== null) setParam('ceiling', v); }));

      basic.appendChild(rangeNumberPair('in-n', 'Capital recovery period (years)', 3, 20, 1, params.n,
        function (v) { if (v !== null) setParam('n', v); }));

      basic.appendChild(rangeNumberPair('in-r', 'Return / discount rate (%)', 5, 18, 0.5, params.ratePct,
        function (v) { if (v !== null) setParam('ratePct', v); }));

      var repriceCheck = el('input', { type: 'checkbox', id: 'in-reprice' });
      repriceCheck.checked = params.reprice;
      repriceCheck.addEventListener('change', function () { setParam('reprice', repriceCheck.checked); });
      var repriceLabel = el('label', { class: 'checkbox-label', for: 'in-reprice' }, [repriceCheck, txt(' Show 3-year repricing')]);
      basic.appendChild(el('div', { class: 'field' }, [repriceLabel]));

      // --- Additional charges ------------------------------------------------
      var charges = el('fieldset', { class: 'subgroup' }, [
        el('legend', { text: 'Additional charges' }),
        el('p', {
          class: 'note subgroup-caption',
          text: 'Costs this model does not include by default — electricity duty, STU demand charges, land, insurance, working capital. Enter them here to see their effect.',
        }),
      ]);
      charges.appendChild(numberField('in-ac', 'Additional capex (Rs/kW)', 0, 100000, 10,
        params.additionalCapexPerKW, function (v) { if (v !== null) setParam('additionalCapexPerKW', v); }));

      var opexNum = numberField('in-ao', 'Additional opex', 0, 1000000, 0.01,
        params.additionalOpex, function (v) { if (v !== null) setParam('additionalOpex', v); });
      charges.appendChild(opexNum);

      var opexUnitSel = el('select', { id: 'in-au' });
      OPEX_UNITS.forEach(function (u) {
        var opt = el('option', { value: u, text: u });
        if (u === params.additionalOpexUnit) opt.selected = true;
        opexUnitSel.appendChild(opt);
      });
      opexUnitSel.addEventListener('change', function () { setParam('additionalOpexUnit', opexUnitSel.value); });
      charges.appendChild(field('Additional opex unit', opexUnitSel));
      // Live conversion readout — the unit conversions are opaque otherwise.
      els.opexReadout = el('p', { class: 'readout', id: 'opex-readout', 'aria-live': 'polite' });
      charges.appendChild(els.opexReadout);
      basic.appendChild(charges);

      var resetBtn = el('button', { type: 'button', id: 'reset-btn', text: 'Reset to defaults' });
      resetBtn.addEventListener('click', function () { resetToDefaults(); });
      basic.appendChild(resetBtn);

      container.appendChild(basic);

      var adv = el('details', { class: 'panel advanced-panel', id: 'advanced-panel' });
      adv.appendChild(el('summary', { text: 'Assumptions' }));

      var capexFieldset = el('fieldset', {}, [el('legend', { text: 'Capex build-up' })]);
      capexFieldset.appendChild(rangeNumberPair('in-ek', 'Electrolyser installed (Rs/kW)', 5000, 300000, 100, params.electrolyserPerKW,
        function (v) { if (v !== null) setParam('electrolyserPerKW', v); }));
      capexFieldset.appendChild(rangeNumberPair('in-civ', 'Civil works / site prep (%)', 0, 60, 0.5, params.civilPct,
        function (v) { if (v !== null) setParam('civilPct', v); }));
      capexFieldset.appendChild(rangeNumberPair('in-wt', 'Water treatment DM/RO (%)', 0, 60, 0.5, params.waterTreatPct,
        function (v) { if (v !== null) setParam('waterTreatPct', v); }));
      capexFieldset.appendChild(rangeNumberPair('in-ev', 'Power evacuation, HT yard, transformer (%)', 0, 60, 0.5, params.evacPct,
        function (v) { if (v !== null) setParam('evacPct', v); }));
      capexFieldset.appendChild(rangeNumberPair('in-pu', 'H2 purification, drying, compression (%)', 0, 60, 0.5, params.purifyPct,
        function (v) { if (v !== null) setParam('purifyPct', v); }));
      capexFieldset.appendChild(rangeNumberPair('in-ins', 'Instrumentation, safety, fire, controls (%)', 0, 60, 0.5, params.instruPct,
        function (v) { if (v !== null) setParam('instruPct', v); }));
      capexFieldset.appendChild(rangeNumberPair('in-own', 'Owner cost, EPC margin, contingency (%)', 0, 60, 0.5, params.ownerPct,
        function (v) { if (v !== null) setParam('ownerPct', v); }));
      var allInRow = el('div', { class: 'field readonly-total' }, [
        el('span', { class: 'label-text', text: 'All-in capex (computed)' }),
        el('output', { id: 'out-allin' }),
      ]);
      capexFieldset.appendChild(allInRow);
      adv.appendChild(capexFieldset);

      var techFieldset = el('fieldset', {}, [el('legend', { text: 'Technical' })]);
      techFieldset.appendChild(rangeNumberPair('in-sec', 'Electrolyser efficiency SEC (kWh/kg)', 40, 70, 0.1, params.sec,
        function (v) { if (v !== null) setParam('sec', v); }));
      techFieldset.appendChild(rangeNumberPair('in-lf', 'Load factor when running (%)', 50, 100, 1, params.loadFactorPct,
        function (v) { if (v !== null) setParam('loadFactorPct', v); }));

      var mrSel = el('select', { id: 'in-mr' });
      API.MIN_RUN_HOURS.forEach(function (h) {
        var opt = el('option', {
          value: String(h),
          text: h + ' h' + (MIN_RUN_HINTS[h] ? ' — ' + MIN_RUN_HINTS[h] : ''),
        });
        if (h === params.minRunHours) opt.selected = true;
        mrSel.appendChild(opt);
      });
      mrSel.addEventListener('change', function () { setParam('minRunHours', Number(mrSel.value)); });
      techFieldset.appendChild(field('Minimum operation time', mrSel));
      techFieldset.appendChild(el('p', {
        class: 'note',
        text: 'Once started, the plant must keep running for at least this long. A stretch of cheap blocks shorter than this is either extended to reach it — taking the cheaper neighbouring block each time — or skipped if the extended window no longer averages below your ceiling. PEM stacks ramp and cycle quickly, so 0.5–1 h is realistic for them; alkaline stacks are slower and tolerate fewer cycles, so 2–4 h is the usual assumption. Only these four values are available: the rule depends on which blocks are adjacent in time, so each setting is pre-computed from the underlying 15-minute price series rather than derived in the browser.',
      }));

      techFieldset.appendChild(rangeNumberPair('in-om', 'Fixed O&M (% of capex/yr)', 0, 15, 0.1, params.omPct,
        function (v) { if (v !== null) setParam('omPct', v); }));
      techFieldset.appendChild(rangeNumberPair('in-wc', 'Water cost (Rs/kg)', 0, 10, 0.01, params.waterCostPerKg,
        function (v) { if (v !== null) setParam('waterCostPerKg', v); }));
      adv.appendChild(techFieldset);

      var stackFieldset = el('fieldset', {}, [el('legend', { text: 'Stack' })]);
      stackFieldset.appendChild(rangeNumberPair('in-sp', 'Stack cost (% of electrolyser capex)', 0, 100, 1, params.stackPct,
        function (v) { if (v !== null) setParam('stackPct', v); }));
      stackFieldset.appendChild(rangeNumberPair('in-sl', 'Stack life (operating hours)', 100, 200000, 100, params.stackLifeHours,
        function (v) { if (v !== null) setParam('stackLifeHours', v); }));
      adv.appendChild(stackFieldset);

      var finFieldset = el('fieldset', {}, [el('legend', { text: 'Financial' })]);
      finFieldset.appendChild(rangeNumberPair('in-res', 'Residual value at end of recovery (% of capex)', 0, 100, 1, params.residualPct,
        function (v) { if (v !== null) setParam('residualPct', v); }));
      finFieldset.appendChild(rangeNumberPair('in-grey', 'Grey H2 benchmark (Rs/kg)', 1, 5000, 1, params.greyBenchmark,
        function (v) { if (v !== null) setParam('greyBenchmark', v); }));
      finFieldset.appendChild(rangeNumberPair('in-pl', 'Plant life (years)', 1, 40, 1, params.plantLife,
        function (v) { if (v !== null) setParam('plantLife', v); }));
      adv.appendChild(finFieldset);

      // --- Subsidies and incentives -----------------------------------------
      var subs = el('fieldset', { class: 'subgroup' }, [
        el('legend', { text: 'Subsidies and incentives' }),
        el('p', {
          class: 'note subgroup-caption',
          text: 'Support other than the transmission and wheeling charge waivers already built into the landed-cost formula. Covers SIGHT Component II, state capital subsidies, GST reimbursement, and per-unit power incentives.',
        }),
      ]);
      subs.appendChild(numberField('in-cs', 'Capital subsidy (Rs/kW)', 0, 60000, 100,
        params.capexSubsidyPerKW, function (v) { if (v !== null) setParam('capexSubsidyPerKW', v); }));
      subs.appendChild(numberField('in-ps', 'Production subsidy (Rs/kg H2)', 0, 200, 0.5,
        params.productionSubsidyPerKg, function (v) { if (v !== null) setParam('productionSubsidyPerKg', v); }));
      subs.appendChild(el('p', {
        class: 'note',
        text: 'Enter a GST reimbursement here — it is economically an offset per unit of output, so it belongs in the production subsidy field rather than a separate one.',
      }));
      subs.appendChild(numberField('in-ws', 'Power subsidy (Rs/unit power)', 0, 5, 0.01,
        params.powerSubsidyPerUnit, function (v) { if (v !== null) setParam('powerSubsidyPerUnit', v); }));
      adv.appendChild(subs);

      container.appendChild(adv);

      els.yearSel = yearSel; els.stateSel = stateSel; els.repriceCheck = repriceCheck; els.mrSel = mrSel;
    }

    function buildResults(container) {
      els.flags = el('div', { id: 'flags', class: 'flags', 'aria-live': 'polite' });
      els.tiles = el('div', { id: 'tiles', class: 'tiles' });
      els.formula = el('div', { id: 'formula', class: 'formula-box', 'aria-live': 'polite' });

      els.breakdownDetails = el('details', { open: 'open' }, [el('summary', { text: 'Cost breakdown' })]);
      els.breakdownTable = el('table', { class: 'data-table', id: 'breakdown-table' });
      els.breakdownExtra = el('div', { id: 'breakdown-extra' });
      els.breakdownDetails.appendChild(els.breakdownTable);
      els.breakdownDetails.appendChild(els.breakdownExtra);

      els.landedDetails = el('details', {}, [el('summary', { text: 'Landed price build-up' })]);
      els.landedBody = el('div', { class: 'buildup', id: 'landed-buildup' });
      els.landedDetails.appendChild(els.landedBody);

      els.chartsWrap = el('div', { class: 'charts' });
      // Heights are the spec's floors: 460 for the centrepiece, 400 for the
      // duration curve, 340 for the rest.
      els.chart1 = chartFigure('chart-lcoh', 'LCOH vs landed power ceiling', 460);
      els.chart2 = chartFigure('chart-stack', 'Cost stack breakdown', 340);
      els.chart3 = chartFigure('chart-duration',
        'Power price duration curve — all blocks ranked cheapest to most expensive', 400);
      els.chart4 = chartFigure('chart-monthly', 'Monthly utilisation', 340);
      els.chart5 = chartFigure('chart-years', 'Year comparison', 340);
      els.chart6 = chartFigure('chart-reprice', 'Repricing schedule', 340);
      els.chart6.root.hidden = true;

      els.chartsWrap.appendChild(els.chart1.root);
      els.chartsWrap.appendChild(els.chart2.root);
      els.chartsWrap.appendChild(els.chart3.root);
      els.chartsWrap.appendChild(els.chart4.root);
      els.chartsWrap.appendChild(els.chart5.root);
      els.chartsWrap.appendChild(els.chart6.root);

      els.repriceDetails = el('details', {}, [el('summary', { text: 'Repricing table' })]);
      els.repriceBody = el('div', { id: 'reprice-body' });
      els.repriceDetails.appendChild(els.repriceBody);
      els.repriceDetails.hidden = true;

      container.appendChild(els.flags);
      container.appendChild(els.tiles);
      container.appendChild(els.formula);
      container.appendChild(els.breakdownDetails);
      container.appendChild(els.landedDetails);
      container.appendChild(els.chartsWrap);
      container.appendChild(els.repriceDetails);
    }

    /**
     * A chart figure. Deliberately NO viewBox: a viewBox with
     * preserveAspectRatio scales text along with the geometry, so a nominal
     * font-size of 14 renders at whatever the container happens to be scaled
     * to. Instead the SVG carries real pixel width/height, everything is drawn
     * in real pixel coordinates, and a ResizeObserver re-renders on resize.
     * That way 14 px means 14 physical pixels at every viewport size.
     */
    function chartFigure(id, title, height) {
      var svg = svgEl('svg', {
        id: id, role: 'img', 'aria-label': title,
        focusable: 'true', tabindex: '0', height: String(height),
      });
      var caption = el('figcaption', { text: title });
      var body = el('div', { class: 'chart-body' }, [svg]);
      var note = el('p', { class: 'chart-caption' });
      note.hidden = true;
      var details = el('details', {}, [el('summary', { text: 'Data table' })]);
      var tableCaption = el('p', { class: 'table-caption' });
      tableCaption.hidden = true;
      var table = el('table', { class: 'data-table' });
      details.appendChild(tableCaption);
      details.appendChild(table);
      var root = el('figure', { class: 'chart-figure' }, [caption, body, note, details]);
      return {
        root: root, svg: svg, table: table, body: body,
        note: note, tableCaption: tableCaption,
        height: height, width: 0,
      };
    }

    /**
     * Current drawing geometry for a figure, in real pixels. Margins clear the
     * spec's floors (64 px left for Y labels, 52 px bottom for X labels and
     * title); the top margin leaves room for the in-SVG legend row.
     */
    function geom(fig, opts) {
      opts = opts || {};
      var margin = {
        top: opts.top === undefined ? 46 : opts.top,
        right: opts.right === undefined ? 30 : opts.right,
        bottom: 56,
        left: 68,
      };
      var w = Math.max(fig.width || 0, 320);
      var h = fig.height;
      return {
        w: w, h: h, margin: margin,
        plotW: Math.max(w - margin.left - margin.right, 40),
        plotH: Math.max(h - margin.top - margin.bottom, 40),
      };
    }

    /** Size the SVG element itself to the measured container width. */
    function sizeSvg(fig, g) {
      fig.svg.setAttribute('width', String(g.w));
      fig.svg.setAttribute('height', String(g.h));
    }

    // ------------------------------------------------------------------
    // Param updates
    // ------------------------------------------------------------------
    function setParam(prop, value) {
      params[prop] = value;
      scheduleRecompute();
    }

    function resetToDefaults() {
      params = API.defaultParams();
      syncControlsFromParams();
      scheduleRecompute();
    }

    function syncControlsFromParams() {
      els.yearSel.value = params.year;
      els.stateSel.value = params.state;
      els.repriceCheck.checked = params.reprice;
      els.mrSel.value = String(params.minRunHours);
      setPair('in-mw', params.mw);
      setPair('in-ceiling', params.ceiling);
      setPair('in-n', params.n);
      setPair('in-r', params.ratePct);
      setPair('in-ek', params.electrolyserPerKW);
      setPair('in-civ', params.civilPct);
      setPair('in-wt', params.waterTreatPct);
      setPair('in-ev', params.evacPct);
      setPair('in-pu', params.purifyPct);
      setPair('in-ins', params.instruPct);
      setPair('in-own', params.ownerPct);
      setPair('in-sec', params.sec);
      setPair('in-lf', params.loadFactorPct);
      setPair('in-om', params.omPct);
      setPair('in-wc', params.waterCostPerKg);
      setPair('in-sp', params.stackPct);
      setPair('in-sl', params.stackLifeHours);
      setPair('in-res', params.residualPct);
      setPair('in-grey', params.greyBenchmark);
      setPair('in-pl', params.plantLife);
      setPair('in-ac', params.additionalCapexPerKW);
      setPair('in-ao', params.additionalOpex);
      setPair('in-cs', params.capexSubsidyPerKW);
      setPair('in-ps', params.productionSubsidyPerKg);
      setPair('in-ws', params.powerSubsidyPerUnit);
      var auSel = document.getElementById('in-au');
      if (auSel) auSel.value = params.additionalOpexUnit;
    }
    function setPair(id, value) {
      var num = document.getElementById(id);
      var range = document.getElementById(id + '-range');
      if (num) num.value = String(value);
      if (range) range.value = String(value);
    }

    function scheduleRecompute() {
      if (rafHandle !== null) return;
      rafHandle = window.requestAnimationFrame(function () {
        rafHandle = null;
        recompute();
      });
    }

    // ------------------------------------------------------------------
    // Core recompute + render
    // ------------------------------------------------------------------
    function recompute() {
      var yearData = DATA.years[params.year];
      var stateData = DATA.states[params.state];
      var sweepKey = API.minRunToSweepKey(params.minRunHours);
      var sweep = yearData.sweep[sweepKey];
      var c = API.buildCostParams(params);

      var allInOut = document.getElementById('out-allin');
      if (allInOut) allInOut.textContent = 'Rs ' + fmtInt(c.capexPerKW) + '/kW';

      var result = MODEL.computeLCOH(sweep, stateData.adder, stateData.loss_factor, params.ceiling, c);

      // Live Rs/kg readout beside the additional-opex field.
      if (els.opexReadout) {
        if (params.additionalOpex > 0 && result.ok) {
          els.opexReadout.textContent = '= Rs ' + fmt(result.extraOpexPerKg, 2) + '/kg at current settings';
          els.opexReadout.hidden = false;
        } else {
          els.opexReadout.textContent = '';
          els.opexReadout.hidden = true;
        }
      }
      if (els.mwExceptionNote) {
        var lumpSum = API.breaksMwInvariance(params);
        els.mwExceptionNote.textContent = lumpSum
          ? 'Note: a Rs/year lump-sum cost is entered, so MW-invariance no longer holds. A fixed annual cost spread over more production gives a lower Rs/kg, and the optimal ceiling shifts slightly with plant size.'
          : '';
        els.mwExceptionNote.hidden = !lumpSum;
      }
      var optimum = findOptimumMemo(MODEL, sweep, stateData.adder, stateData.loss_factor,
        params.year + '|' + params.state + '|' + sweepKey, c);

      renderFlags(result, optimum, yearData);
      renderTiles(result, c);
      renderFormula(result, c);
      renderBreakdown(result);
      renderLandedBuildup(result, stateData);

      els.chart6.root.hidden = !params.reprice;
      els.repriceDetails.hidden = !params.reprice;
      var reprice = null;
      if (params.reprice) {
        reprice = MODEL.repricingSchedule(result, c, params.greyBenchmark, 3);
        renderRepriceTable(reprice, result, c);
      }

      // Cached so a resize can redraw the charts at their new pixel width
      // without re-running the model or the optimum sweep.
      lastState = {
        yearData: yearData, stateData: stateData, sweep: sweep, sweepKey: sweepKey,
        c: c, result: result, optimum: optimum, reprice: reprice,
      };
      renderCharts();

      var hash = API.encodeParams(params);
      if (window.location.hash !== hash) {
        history.replaceState(null, '', hash);
      }
    }

    /** Redraw every chart from the cached model state at the current width. */
    function renderCharts() {
      var s = lastState;
      if (!s) return;
      measureCharts();
      renderChartLCOH(s.sweep, s.stateData, s.c, s.result, s.optimum);
      renderChartStack(s.result);
      renderChartDuration(s.yearData, s.stateData, params.ceiling, s.result.hours);
      renderChartMonthly(s.yearData, s.sweepKey, params.ceiling, s.stateData);
      renderChartYears(s.stateData, s.sweepKey, params.ceiling, s.c);
      if (params.reprice && s.reprice) renderChartReprice(s.reprice);
    }

    /** Measure each visible chart container in real CSS pixels. */
    function measureCharts() {
      [els.chart1, els.chart2, els.chart3, els.chart4, els.chart5, els.chart6].forEach(function (fig) {
        if (!fig) return;
        var w = fig.body.clientWidth;
        if (w > 0) fig.width = w;
        else if (!fig.width) fig.width = 760; // pre-layout fallback
      });
    }

    /** Re-render charts on container resize, coalesced to one frame. */
    function observeChartResizes() {
      if (typeof ResizeObserver !== 'function') {
        window.addEventListener('resize', function () { scheduleChartRedraw(); });
        return;
      }
      var ro = new ResizeObserver(function () { scheduleChartRedraw(); });
      [els.chart1, els.chart2, els.chart3, els.chart4, els.chart5, els.chart6].forEach(function (fig) {
        if (fig) ro.observe(fig.body);
      });
    }

    function scheduleChartRedraw() {
      if (chartRafHandle !== null) return;
      chartRafHandle = window.requestAnimationFrame(function () {
        chartRafHandle = null;
        var changed = [els.chart1, els.chart2, els.chart3, els.chart4, els.chart5, els.chart6]
          .some(function (fig) { return fig && fig.body.clientWidth > 0 && fig.body.clientWidth !== fig.width; });
        if (changed) renderCharts();
      });
    }

    function renderFlags(result, optimum, yearData) {
      clearChildren(els.flags);
      var flags = [];

      if (!result.ok) {
        result.errors.forEach(function (msg) {
          flags.push({ kind: 'error', text: msg });
        });
      } else {
        // Model-level warnings (capex clamp, negative LCOH) are informational
        // and never block the result.
        (result.warnings || []).forEach(function (msg) {
          flags.push({ kind: 'caution', text: msg });
        });
        if (optimum && optimum.ok !== false) {
          var gap = result.lcoh - optimum.lcoh;
          flags.push({
            kind: 'info',
            text: 'Optimum ceiling for these settings: Rs ' + fmt(optimum.ceilingLanded, 2) +
              '/unit → LCOH Rs ' + fmt(optimum.lcoh, 1) + '/kg. You are Rs ' + fmt(Math.max(gap, 0), 1) + '/kg above it.',
            action: { label: 'Snap to optimum', onClick: function () { setParam('ceiling', optimum.ceilingLanded); syncControlsFromParams(); } },
          });
          if (Math.abs(gap) <= 5) {
            flags.push({ kind: 'caution', text: 'You are within Rs 5/kg of the optimum — the curve is shallow here, so treat small ceiling changes as noise, not signal.' });
          }
        }
        if (result.stackIntervalYears !== null && Number.isFinite(result.stackIntervalYears)) {
          var due = result.stackIntervalYears;
          var within = due <= params.n ? 'inside' : 'outside';
          flags.push({ kind: 'info', text: 'Stack replacement due at year ' + fmt(due, 1) + ' — ' + within + ' your recovery period.' });
        }
        if (params.year === 'AY2022-23' || params.year === 'AY2023-24') {
          flags.push({ kind: 'caution', text: 'This year predates the low-price regime (AY2022-23 had 0 h, AY2023-24 had 23 h, below Rs1.50/unit) and will show high LCOH. Shown for trajectory only.' });
        }
        if (result.hours < 2000) {
          flags.push({ kind: 'caution', text: 'Operating hours are below 2,000/yr — capital and stack costs are being spread over very little production.' });
        }
      }

      flags.forEach(function (f) {
        var box = el('div', { class: 'flag flag-' + f.kind, role: f.kind === 'error' ? 'alert' : 'status' });
        box.appendChild(el('p', { text: f.text }));
        if (f.action) {
          var btn = el('button', { type: 'button', text: f.action.label });
          btn.addEventListener('click', f.action.onClick);
          box.appendChild(btn);
        }
        els.flags.appendChild(box);
      });
    }

    function tile(label, value, sub) {
      var t = el('div', { class: 'tile' }, [
        el('div', { class: 'tile-label', text: label }),
        el('div', { class: 'tile-value', text: value }),
      ]);
      if (sub) t.appendChild(el('div', { class: 'tile-sub', text: sub }));
      return t;
    }

    function renderTiles(result, c) {
      clearChildren(els.tiles);
      if (!result.ok) {
        els.tiles.appendChild(el('p', { class: 'muted', text: 'No valid result for the current inputs — see the message above.' }));
        return;
      }
      var multiple = params.greyBenchmark > 0 ? result.lcoh / params.greyBenchmark : NaN;
      els.tiles.appendChild(tile('LCOH', 'Rs ' + fmt(result.lcoh, 1) + '/kg', Number.isFinite(multiple) ? multiple.toFixed(2) + '× grey benchmark' : ''));
      els.tiles.appendChild(tile('Nameplate capacity', fmt(params.mw, 1) + ' MW', fmtInt(result.nameplateTpa) + ' TPA'));
      var pctOfNameplate = result.nameplateTpa > 0 ? (result.actualTpa / result.nameplateTpa) * 100 : NaN;
      els.tiles.appendChild(tile('Actual production', fmtInt(result.actualTpa) + ' TPA', Number.isFinite(pctOfNameplate) ? pctOfNameplate.toFixed(1) + '% of nameplate' : ''));
      els.tiles.appendChild(tile('Operating hours', fmtInt(result.hours) + ' h', (result.capacityFactor * 100).toFixed(1) + '% CF'));
      els.tiles.appendChild(tile('Total capex', 'Rs ' + fmt(result.capex / 1e7, 2) + ' cr', 'Rs ' + fmtInt(c.capexPerKW) + '/kW all-in'));
      els.tiles.appendChild(tile('Weighted landed power', 'Rs ' + fmt(result.landedAvg, 3) + '/unit', 'volume-weighted over selected blocks'));
    }

    function renderFormula(result, c) {
      clearChildren(els.formula);
      if (!result.ok) return;
      var capCr = result.annualisedCapex / 1e7;
      var omCr = result.annualOm / 1e7;
      var stCr = result.stackSinking / 1e7;
      var line = 'LCOH = (Rs ' + fmt(capCr, 2) + ' cr + Rs ' + fmt(omCr, 2) + ' cr + Rs ' + fmt(stCr, 2) +
        ' cr) ÷ ' + fmtInt(result.annualKg) + ' kg + ' + fmt(params.sec, 0) + ' × ' + fmt(result.landedAvg, 3) +
        ' + ' + fmt(params.waterCostPerKg, 2);
      if (result.extraOpexPerKg > 0) line += ' + ' + fmt(result.extraOpexPerKg, 2);
      if (result.subsidyTotalPerKg > 0) line += ' − ' + fmt(result.subsidyTotalPerKg, 2);
      line += ' = Rs ' + fmt(result.lcoh, 1) + '/kg';
      els.formula.appendChild(el('p', { class: 'formula-label', text: 'The formula, with your numbers:' }));
      els.formula.appendChild(el('p', { class: 'formula-line', text: line }));
    }

    function renderBreakdown(result) {
      clearChildren(els.breakdownTable);
      clearChildren(els.breakdownExtra);
      if (!result.ok) return;
      var hasSubsidy = result.subsidyTotalPerKg > 0;
      var gross = result.grossPerKg;

      var head = el('tr', {}, [
        el('th', { text: 'Component' }),
        el('th', { text: 'Rs/kg' }),
        // Shares are taken against gross cost before subsidies; against a
        // subsidised net they would exceed 100% and read as nonsense.
        el('th', { text: hasSubsidy ? '% of gross' : '% of LCOH' }),
      ]);
      els.breakdownTable.appendChild(el('thead', {}, [head]));

      var rows = [
        ['Capital recovery', result.capitalPerKg],
        ['Fixed O&M', result.omPerKg],
        ['Stack replacement', result.stackPerKg],
        ['Power', result.powerPerKg],
        ['Water', result.waterPerKg],
      ];
      if (result.extraOpexPerKg > 0) {
        rows.push(['Additional opex (Rs ' + fmt(params.additionalOpex, 2) + '/' +
          params.additionalOpexUnit.replace(/^Rs\//, '') + ')', result.extraOpexPerKg]);
      }

      var tbody = el('tbody');
      rows.forEach(function (r) {
        var pct = gross > 0 ? (r[1] / gross) * 100 : 0;
        var nameCell = el('td', { text: r[0] });
        if (r[0] === 'Capital recovery' && result.capexSubsidy > 0) {
          // The row value alone no longer reveals the asset cost.
          nameCell.setAttribute('title',
            'Gross capex Rs ' + fmt(result.capexGross / 1e7, 2) + ' cr, less subsidy Rs ' +
            fmt(result.capexSubsidy / 1e7, 2) + ' cr, giving net capex Rs ' +
            fmt(result.capexNet / 1e7, 2) + ' cr. O&M is charged on gross, not net.');
          nameCell.appendChild(txt(' ⓘ'));
        }
        tbody.appendChild(el('tr', {}, [
          nameCell,
          el('td', { text: fmt(r[1], 2) }),
          el('td', { text: fmt(pct, 1) + '%' }),
        ]));
      });

      if (hasSubsidy) {
        tbody.appendChild(el('tr', { class: 'gross-row' }, [
          el('td', { text: 'Gross cost before subsidies' }),
          el('td', { text: fmt(gross, 2) }),
          el('td', { text: '100.0%' }),
        ]));
        var pctSub = gross > 0 ? (result.subsidyTotalPerKg / gross) * 100 : 0;
        tbody.appendChild(el('tr', { class: 'subsidy-row' }, [
          el('td', { text: 'Less: subsidies' }),
          el('td', { text: '−' + fmt(result.subsidyTotalPerKg, 2) }),
          el('td', { text: '−' + fmt(pctSub, 1) + '%' }),
        ]));
      }

      var totalPct = hasSubsidy && gross > 0 ? (result.lcoh / gross) * 100 : 100;
      tbody.appendChild(el('tr', { class: 'total-row' }, [
        el('td', { text: hasSubsidy ? 'Net LCOH' : 'Total' }),
        el('td', { text: fmt(result.lcoh, 2) }),
        el('td', { text: fmt(totalPct, 1) + '%' }),
      ]));
      els.breakdownTable.appendChild(tbody);

      // Subsidy components live here rather than as three more table rows.
      if (hasSubsidy) {
        var det = el('details', { class: 'subsidy-detail' }, [
          el('summary', { text: 'What makes up the subsidy line' }),
        ]);
        var list = el('ul', { class: 'buildup-list' });
        if (result.capexSubsidy > 0) {
          list.appendChild(el('li', {
            text: 'Capital subsidy: Rs ' + fmtInt(params.capexSubsidyPerKW) + '/kW = Rs ' +
              fmt(result.capexSubsidy / 1e7, 2) + ' cr deducted from capex at year zero. This does not appear in the subsidy line itself — it already reduces the capital recovery row above.',
          }));
        }
        if (result.subsidyKgPerKg > 0) {
          list.appendChild(el('li', { text: 'Production subsidy: Rs ' + fmt(result.subsidyKgPerKg, 2) + '/kg, applied directly.' }));
        }
        if (result.subsidyPwrPerKg > 0) {
          list.appendChild(el('li', {
            text: 'Power subsidy: Rs ' + fmt(params.powerSubsidyPerUnit, 2) + '/unit × ' +
              fmt(params.sec, 0) + ' kWh/kg = Rs ' + fmt(result.subsidyPwrPerKg, 2) + '/kg.',
          }));
        }
        det.appendChild(list);
        els.breakdownExtra.appendChild(det);
      }
    }

    function renderLandedBuildup(result, stateData) {
      clearChildren(els.landedBody);
      if (!result.ok) return;
      var steps = [
        'Weighted avg MCP: Rs ' + fmt(result.w, 4) + '/unit',
        '+ adder (' + stateData.label + '): Rs ' + fmt(stateData.adder, 3) + '/unit',
        '× loss factor: ' + fmt(stateData.loss_factor, 3),
        '= Landed: Rs ' + fmt(result.landedAvg, 4) + '/unit',
        '× SEC (' + fmt(params.sec, 0) + ' kWh/kg) = Rs ' + fmt(result.powerPerKg, 2) + '/kg power cost',
      ];
      var list = el('ol', { class: 'buildup-list' });
      steps.forEach(function (s) { list.appendChild(el('li', { text: s })); });
      els.landedBody.appendChild(list);
    }

    // ------------------------------------------------------------------
    // Charts
    // ------------------------------------------------------------------
    // Colour-blind-safe palette; meaning is never carried by colour alone —
    // every series is also labelled in-plot or in the legend.
    var COLORS = ['#1b6ec2', '#c2571b', '#2b8a3e', '#9c36b5', '#868e96'];
    var SUBSIDY_COLOR = '#0b7285';

    function scaleLinear(domain, range) {
      var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1];
      var span = d1 - d0;
      var fn = function (x) {
        if (span === 0) return r0;
        return r0 + ((x - d0) / span) * (r1 - r0);
      };
      fn.invert = function (px) {
        var rspan = r1 - r0;
        if (rspan === 0) return d0;
        return d0 + ((px - r0) / rspan) * span;
      };
      return fn;
    }

    function clearSvg(svg) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    }

    function clampVal(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

    /** Nearest index in an ascending array of numbers. */
    function bisectNearest(xs, x) {
      var n = xs.length;
      if (!n) return -1;
      var lo = 0, hi = n - 1;
      if (x <= xs[0]) return 0;
      if (x >= xs[hi]) return hi;
      while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (xs[mid] <= x) lo = mid; else hi = mid;
      }
      return (x - xs[lo] <= xs[hi] - x) ? lo : hi;
    }

    /** Pointer event -> this SVG's own coordinate space. */
    function svgPoint(svg, evt) {
      var pt = svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      var ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      var p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }

    /** Draw a text label, returned so callers can measure or reposition it. */
    function label(svg, x, y, text, cls, anchor) {
      var t = svgEl('text', { x: x, y: y, class: cls || 'value-label' });
      if (anchor) t.setAttribute('text-anchor', anchor);
      t.textContent = text;
      svg.appendChild(t);
      return t;
    }

    /**
     * An in-plot annotation: text on an opaque plate so it stays readable
     * where it crosses gridlines or the data itself.
     */
    function plaque(svg, x, y, text, anchor, cls) {
      var g = svgEl('g', { class: 'plaque ' + (cls || ''), 'pointer-events': 'none' });
      var bg = svgEl('rect', { class: 'plaque-bg', rx: '3', ry: '3' });
      g.appendChild(bg);
      var t = svgEl('text', { class: 'plaque-text', x: '0', y: '0' });
      t.textContent = text;
      g.appendChild(t);
      svg.appendChild(g);
      var b = t.getBBox();
      var padX = 6, padY = 3;
      var tx = x, ty = y;
      if (anchor === 'end') tx = x - b.width;
      else if (anchor === 'middle') tx = x - b.width / 2;
      // Keep the plate inside the SVG so a label near an edge is never clipped.
      var svgW = Number(svg.getAttribute('width')) || 0;
      if (svgW > 0) {
        var maxX = svgW - b.width - padX - 2;
        if (tx > maxX) tx = maxX;
      }
      if (tx < padX + 2) tx = padX + 2;
      t.setAttribute('x', tx);
      t.setAttribute('y', ty);
      bg.setAttribute('x', tx - padX);
      bg.setAttribute('y', ty - b.height + padY - 1);
      bg.setAttribute('width', b.width + padX * 2);
      bg.setAttribute('height', b.height + padY);
      return g;
    }

    /** A small floating tooltip, built from SVG elements only. */
    function makeTooltip(svg, g) {
      var grp = svgEl('g', { class: 'tooltip-g', visibility: 'hidden', 'pointer-events': 'none' });
      var bg = svgEl('rect', { class: 'tooltip-bg', rx: '4', ry: '4' });
      grp.appendChild(bg);
      var texts = [0, 1, 2].map(function (i) {
        var t = svgEl('text', { class: i === 0 ? 'tooltip-title' : 'tooltip-line', x: '10', y: String(19 + i * 18) });
        grp.appendChild(t);
        return t;
      });
      svg.appendChild(grp);
      return {
        show: function (lines, anchorX, anchorY) {
          var shown = 0;
          texts.forEach(function (t, i) {
            var line = lines[i] || '';
            t.textContent = line;
            if (line) shown++;
          });
          grp.setAttribute('visibility', 'visible');
          var maxW = 0;
          texts.forEach(function (t) {
            if (!t.textContent) return;
            var b = t.getBBox();
            if (b.width > maxW) maxW = b.width;
          });
          var w = maxW + 20;
          var h = shown * 18 + 12;
          bg.setAttribute('width', w);
          bg.setAttribute('height', h);
          var gx = anchorX + 16;
          var gy = anchorY - h - 12;
          if (gx + w > g.w - 4) gx = anchorX - w - 16;
          if (gx < 2) gx = 2;
          if (gy < 2) gy = anchorY + 16;
          grp.setAttribute('transform', 'translate(' + gx + ',' + gy + ')');
        },
        hide: function () { grp.setAttribute('visibility', 'hidden'); },
      };
    }

    /** Compact inline legend, wrapping within maxWidth. */
    function drawLegend(svg, items, originX, originY, maxWidth) {
      var g = svgEl('g', { class: 'legend' });
      svg.appendChild(g);
      var x = 0, y = 0, rowH = 22;
      items.forEach(function (item) {
        var itemG = svgEl('g');
        g.appendChild(itemG);
        var swatch;
        if (item.type === 'dot') {
          swatch = svgEl('circle', { cx: 7, cy: 7, r: 6, fill: item.color });
        } else if (item.type === 'box') {
          swatch = svgEl('rect', { x: 0, y: 1, width: 14, height: 13, fill: item.color });
        } else {
          swatch = svgEl('line', { x1: 0, y1: 7, x2: 22, y2: 7, stroke: item.color, 'stroke-width': item.width || 3 });
          if (item.dash) swatch.setAttribute('stroke-dasharray', item.dash);
        }
        itemG.appendChild(swatch);
        var t = svgEl('text', { x: 28, y: 12, class: 'axis-label' });
        t.textContent = item.label;
        itemG.appendChild(t);
        var bw = itemG.getBBox().width;
        if (x + bw > maxWidth && x > 0) { x = 0; y += rowH; }
        itemG.setAttribute('transform', 'translate(' + x + ',' + y + ')');
        x += bw + 26;
      });
      g.setAttribute('transform', 'translate(' + originX + ',' + originY + ')');
      // Bottom edge in SVG coordinates, so callers can flow content below a
      // legend that has wrapped onto more than one row.
      return originY + y + rowH;
    }

    /** Axes with light gridlines, drawn in real pixel coordinates. */
    function drawAxes(svg, g, xScale, xDomain, yScale, yDomain, xLabel, yLabel, xTickFmt, yTickFmt, xTickValues) {
      var m = g.margin;
      var grp = svgEl('g', { class: 'axes' });
      var xTicks = 5, yTicks = 5;
      var xValues = xTickValues || [0, 1, 2, 3, 4, 5].map(function (i) {
        return xDomain[0] + (i / xTicks) * (xDomain[1] - xDomain[0]);
      });

      for (var j = 0; j <= yTicks; j++) {
        var yv = yDomain[0] + (j / yTicks) * (yDomain[1] - yDomain[0]);
        var py = yScale(yv);
        grp.appendChild(svgEl('line', {
          x1: m.left, y1: py, x2: m.left + g.plotW, y2: py, class: 'gridline',
        }));
        var t2 = svgEl('text', { x: m.left - 10, y: py + 5, 'text-anchor': 'end', class: 'axis-label' });
        t2.textContent = yTickFmt(yv);
        grp.appendChild(t2);
      }

      grp.appendChild(svgEl('line', {
        x1: m.left, y1: m.top + g.plotH, x2: m.left + g.plotW, y2: m.top + g.plotH,
        stroke: 'currentColor', 'stroke-width': '1',
      }));
      grp.appendChild(svgEl('line', {
        x1: m.left, y1: m.top, x2: m.left, y2: m.top + g.plotH,
        stroke: 'currentColor', 'stroke-width': '1',
      }));

      for (var i = 0; i < xValues.length; i++) {
        var px = xScale(xValues[i]);
        grp.appendChild(svgEl('line', {
          x1: px, y1: m.top + g.plotH, x2: px, y2: m.top + g.plotH + 6, stroke: 'currentColor',
        }));
        var t1 = svgEl('text', { x: px, y: m.top + g.plotH + 25, 'text-anchor': 'middle', class: 'axis-label' });
        t1.textContent = xTickFmt(xValues[i]);
        grp.appendChild(t1);
      }

      var xl = svgEl('text', { x: m.left + g.plotW / 2, y: g.h - 8, 'text-anchor': 'middle', class: 'axis-title' });
      xl.textContent = xLabel;
      grp.appendChild(xl);
      var midY = m.top + g.plotH / 2;
      var yl = svgEl('text', {
        x: 18, y: midY, 'text-anchor': 'middle', class: 'axis-title',
        transform: 'rotate(-90 18 ' + midY + ')',
      });
      yl.textContent = yLabel;
      grp.appendChild(yl);
      svg.appendChild(grp);
    }

    function pointsToPath(points, xScale, yScale) {
      var d = '';
      for (var i = 0; i < points.length; i++) {
        var cmd = i === 0 ? 'M' : 'L';
        d += cmd + xScale(points[i][0]).toFixed(2) + ',' + yScale(points[i][1]).toFixed(2) + ' ';
      }
      return d.trim();
    }

    function fillTable(table, headers, rows) {
      clearChildren(table);
      var thead = el('thead', {}, [el('tr', {}, headers.map(function (h) {
        var th = el('th', { text: typeof h === 'string' ? h : h.text });
        if (h && h.title) th.setAttribute('title', h.title);
        return th;
      }))]);
      var tbody = el('tbody');
      rows.forEach(function (r) {
        tbody.appendChild(el('tr', {}, r.map(function (c) { return el('td', { text: String(c) }); })));
      });
      table.appendChild(thead);
      table.appendChild(tbody);
    }

    function curveForYear(yearKey, sweepKey, adder, lossFactor, c) {
      var sweep = DATA.years[yearKey].sweep[sweepKey];
      var pts = [];
      for (var i = 0; i < sweep.length; i++) {
        var row = sweep[i];
        var res = MODEL.coreLCOH(row.h, row.w, adder, lossFactor, c);
        var ceiling = MODEL.thresholdToCeiling(row.t, adder, lossFactor);
        if (ceiling < 1.5 || ceiling > 8.0) continue;
        if (res.ok) pts.push([ceiling, res.lcoh]);
      }
      return pts;
    }

    // =====================================================================
    // 1. LCOH vs landed ceiling — the centrepiece
    // =====================================================================
    function renderChartLCOH(sweep, stateData, c, result, optimum) {
      var fig = els.chart1;
      var svg = fig.svg;
      var g = geom(fig, { top: 52 });
      clearSvg(svg);
      sizeSvg(fig, g);

      var mainPts = curveForYear(params.year, API.minRunToSweepKey(params.minRunHours),
        stateData.adder, stateData.loss_factor, c);
      if (!mainPts.length) return;
      var yMin = 0, yMax = Math.max(params.greyBenchmark, result.ok ? result.lcoh : 0);
      mainPts.forEach(function (p) {
        if (p[1] > yMax) yMax = p[1];
        if (p[1] < yMin) yMin = p[1];
      });
      yMax *= 1.08;
      if (yMin < 0) yMin *= 1.12;

      var xScale = scaleLinear([1.5, 8.0], [g.margin.left, g.margin.left + g.plotW]);
      var yScale = scaleLinear([yMin, yMax], [g.margin.top + g.plotH, g.margin.top]);
      drawAxes(svg, g, xScale, [1.5, 8.0], yScale, [yMin, yMax],
        'Maximum landed power price you will pay (Rs/unit)', 'LCOH (Rs/kg)',
        function (v) { return v.toFixed(1); }, function (v) { return v.toFixed(0); });

      API.YEAR_KEYS.forEach(function (yk) {
        if (yk === params.year) return;
        var pts = curveForYear(yk, API.minRunToSweepKey(params.minRunHours),
          stateData.adder, stateData.loss_factor, c);
        if (pts.length) {
          svg.appendChild(svgEl('path', {
            d: pointsToPath(pts, xScale, yScale), fill: 'none',
            stroke: COLORS[4], 'stroke-width': '1', opacity: '0.35',
          }));
        }
      });

      svg.appendChild(svgEl('path', {
        d: pointsToPath(mainPts, xScale, yScale), fill: 'none', stroke: COLORS[0], 'stroke-width': '2',
      }));

      var greyY = yScale(params.greyBenchmark);
      svg.appendChild(svgEl('line', {
        x1: g.margin.left, y1: greyY, x2: g.margin.left + g.plotW, y2: greyY,
        stroke: COLORS[1], 'stroke-width': '2', 'stroke-dasharray': '6 4',
      }));
      // Anchored left: the current-position marker sits on the right half of
      // the curve at any sensible ceiling, and would collide with it there.
      plaque(svg, g.margin.left + 8, greyY - 9,
        'Grey H2 benchmark: Rs ' + fmt(params.greyBenchmark, 0) + '/kg', 'start');

      // Optimum: vertical line, labelled in-plot with its value.
      if (optimum && optimum.ok !== false) {
        var optX = xScale(clampVal(optimum.ceilingLanded, 1.5, 8.0));
        svg.appendChild(svgEl('line', {
          x1: optX, y1: g.margin.top, x2: optX, y2: g.margin.top + g.plotH,
          stroke: COLORS[2], 'stroke-width': '2', 'stroke-dasharray': '3 3',
        }));
        var optAnchor = optX > g.margin.left + g.plotW * 0.6 ? 'end' : 'start';
        plaque(svg, optAnchor === 'end' ? optX - 8 : optX + 8, g.margin.top + 16,
          'Optimum Rs ' + fmt(optimum.ceilingLanded, 2) + '/unit → Rs ' + fmt(optimum.lcoh, 1) + '/kg',
          optAnchor);
      }

      // Current position: marker, labelled in-plot with its value.
      if (result.ok) {
        var mx = xScale(clampVal(params.ceiling, 1.5, 8.0));
        var my = yScale(result.lcoh);
        svg.appendChild(svgEl('circle', { cx: mx, cy: my, r: '7', fill: COLORS[3], stroke: '#fff', 'stroke-width': '2' }));
        var markAnchor = mx > g.margin.left + g.plotW * 0.7 ? 'end' : 'start';
        plaque(svg, markAnchor === 'end' ? mx - 12 : mx + 12, my - 12,
          'You: Rs ' + fmt(params.ceiling, 2) + '/unit → Rs ' + fmt(result.lcoh, 1) + '/kg',
          markAnchor, 'plaque-current');
      }

      drawLegend(svg, [
        { type: 'line', color: COLORS[0], width: 2, label: 'Current year (' + params.year + ')' },
        { type: 'line', color: COLORS[4], width: 1, label: 'Other price years' },
        { type: 'line', color: COLORS[2], width: 2, dash: '3 3', label: 'Optimum ceiling' },
        { type: 'line', color: COLORS[1], width: 2, dash: '6 4', label: 'Grey benchmark' },
        { type: 'dot', color: COLORS[3], label: 'Your setting' },
      ], g.margin.left, 8, g.plotW);

      var xs = mainPts.map(function (p) { return p[0]; });
      var tooltip;
      var marker = svgEl('circle', { class: 'hover-marker', r: '5.5', visibility: 'hidden' });
      var crosshair = svgEl('line', { class: 'crosshair-line', visibility: 'hidden' });
      svg.appendChild(crosshair);
      svg.appendChild(marker);
      var capture = svgEl('rect', {
        x: g.margin.left, y: g.margin.top, width: g.plotW, height: g.plotH,
        fill: 'transparent', class: 'hover-capture',
      });
      svg.appendChild(capture);
      capture.addEventListener('pointermove', function (evt) {
        var p = svgPoint(svg, evt);
        var idx = bisectNearest(xs, clampVal(xScale.invert(p.x), 1.5, 8.0));
        var pt = mainPts[idx];
        var px = xScale(pt[0]), py = yScale(pt[1]);
        crosshair.setAttribute('x1', px); crosshair.setAttribute('x2', px);
        crosshair.setAttribute('y1', g.margin.top); crosshair.setAttribute('y2', g.margin.top + g.plotH);
        crosshair.setAttribute('visibility', 'visible');
        marker.setAttribute('cx', px); marker.setAttribute('cy', py);
        marker.setAttribute('visibility', 'visible');
        tooltip.show([
          'Current year (' + params.year + ')',
          'Ceiling: Rs ' + pt[0].toFixed(2) + '/unit',
          'LCOH: Rs ' + pt[1].toFixed(1) + '/kg',
        ], px, py);
      });
      capture.addEventListener('pointerleave', function () {
        crosshair.setAttribute('visibility', 'hidden');
        marker.setAttribute('visibility', 'hidden');
        tooltip.hide();
      });
      tooltip = makeTooltip(svg, g);

      fig.tableCaption.textContent = 'LCOH at each landed-price ceiling for ' + params.year +
        ', ' + params.state + ', at your current cost assumptions. Sampled every 20th point of the ceiling sweep.';
      fig.tableCaption.hidden = false;
      fillTable(fig.table, ['Ceiling (Rs/unit)', 'LCOH (Rs/kg)'],
        mainPts.filter(function (_, i) { return i % 20 === 0; })
          .map(function (p) { return [p[0].toFixed(2), p[1].toFixed(1)]; }));
    }

    // =====================================================================
    // 2. Cost stack
    // =====================================================================
    function renderChartStack(result) {
      var fig = els.chart2;
      var svg = fig.svg;
      var g = geom(fig, { top: 40 });
      clearSvg(svg);
      sizeSvg(fig, g);
      if (!result.ok) return;

      var comps = [
        ['Capital recovery', result.capitalPerKg, COLORS[0]],
        ['O&M', result.omPerKg, COLORS[1]],
        ['Stack', result.stackPerKg, COLORS[2]],
        ['Power', result.powerPerKg, COLORS[3]],
        ['Water', result.waterPerKg, COLORS[4]],
      ];
      if (result.extraOpexPerKg > 0) comps.push(['Additional opex', result.extraOpexPerKg, '#5f3dc4']);

      var gross = result.grossPerKg;
      var subsidy = result.subsidyTotalPerKg;
      // Both bars share the same origin at zero: the stack runs right, the
      // subsidy bar runs left. A negative segment inside the stack itself
      // would run backwards past its own origin and be unreadable.
      var xScale = scaleLinear([subsidy > 0 ? -subsidy : 0, gross],
        [g.margin.left, g.margin.left + g.plotW]);
      var zeroX = xScale(0);

      var legendBottom = drawLegend(svg, comps.map(function (comp) {
        return { type: 'box', color: comp[2], label: comp[0] };
      }).concat(subsidy > 0 ? [{ type: 'box', color: SUBSIDY_COLOR, label: 'Less: subsidies' }] : []),
      g.margin.left, 6, g.plotW);

      // Flow below the legend, which may have wrapped onto several rows.
      var barH = subsidy > 0 ? 62 : 74;
      var contentH = (subsidy > 0 ? barH * 2 + 24 : barH) + 96;
      var barY = Math.max(legendBottom + 20, g.margin.top + Math.max(6, (g.plotH - contentH) / 2));

      var acc = 0;
      var tooltip;
      comps.forEach(function (comp) {
        var x0 = xScale(acc), x1 = xScale(acc + comp[1]);
        var wSeg = Math.max(0, x1 - x0);
        var rect = svgEl('rect', { x: x0, y: barY, width: wSeg, height: barH, fill: comp[2], class: 'hover-capture' });
        var share = gross > 0 ? (comp[1] / gross) * 100 : 0;
        rect.addEventListener('pointermove', function () {
          tooltip.show([comp[0], 'Rs ' + comp[1].toFixed(2) + '/kg', share.toFixed(1) + '% of gross'],
            x0 + wSeg / 2, barY);
        });
        rect.addEventListener('pointerleave', function () { tooltip.hide(); });
        svg.appendChild(rect);
        // Label segments above 5% in place; the rest live in the data table.
        if (share > 5 && wSeg > 42) {
          label(svg, x0 + wSeg / 2, barY + barH / 2 + 5, comp[1].toFixed(1), 'value-label on-fill', 'middle');
        }
        acc += comp[1];
      });
      label(svg, g.margin.left, barY - 8, 'Gross cost Rs ' + fmt(gross, 1) + '/kg', 'series-label');

      if (subsidy > 0) {
        var sy = barY + barH + 24;
        var sx0 = xScale(-subsidy);
        var subRect = svgEl('rect', {
          x: sx0, y: sy, width: Math.max(0, zeroX - sx0), height: barH,
          fill: SUBSIDY_COLOR, class: 'hover-capture subsidy-bar',
        });
        subRect.addEventListener('pointermove', function () {
          tooltip.show(['Less: subsidies', 'Rs ' + subsidy.toFixed(2) + '/kg',
            'production + power support'], (sx0 + zeroX) / 2, sy);
        });
        subRect.addEventListener('pointerleave', function () { tooltip.hide(); });
        svg.appendChild(subRect);
        // To the right of the bar, inside the plot: the bar itself starts hard
        // against the left margin, so an end-anchored label would run off-canvas.
        label(svg, zeroX + 10, sy + barH / 2 + 5,
          'Less: subsidies Rs ' + fmt(subsidy, 1) + '/kg', 'series-label', 'start');
      }

      // Baseline plus a labelled tick at the net LCOH beneath both bars.
      var axisY = (subsidy > 0 ? barY + barH * 2 + 24 : barY + barH) + 30;
      svg.appendChild(svgEl('line', {
        x1: g.margin.left, y1: axisY, x2: g.margin.left + g.plotW, y2: axisY, stroke: 'currentColor',
      }));
      var lo = subsidy > 0 ? -subsidy : 0;
      for (var i = 0; i <= 5; i++) {
        var v = lo + ((gross - lo) / 5) * i;
        label(svg, xScale(v), axisY + 22, v.toFixed(0), 'axis-label', 'middle');
      }
      var netX = xScale(clampVal(result.lcoh, lo, gross));
      svg.appendChild(svgEl('line', {
        x1: netX, y1: axisY - 8, x2: netX, y2: axisY + 30, stroke: COLORS[3], 'stroke-width': '3',
      }));
      plaque(svg, netX, axisY + 50,
        'Net LCOH Rs ' + fmt(result.lcoh, 1) + '/kg', 'middle', 'plaque-current');
      label(svg, g.margin.left + g.plotW / 2, g.h - 8, 'Rs/kg H2', 'axis-title', 'middle');
      tooltip = makeTooltip(svg, g);

      var tableRows = comps.map(function (comp) {
        return [comp[0], comp[1].toFixed(2), gross > 0 ? ((comp[1] / gross) * 100).toFixed(1) + '%' : '—'];
      });
      if (subsidy > 0) {
        tableRows.push(['Less: subsidies', '−' + subsidy.toFixed(2),
          '−' + ((subsidy / gross) * 100).toFixed(1) + '%']);
      }
      tableRows.push(['Net LCOH', result.lcoh.toFixed(2), '']);
      fig.tableCaption.textContent = 'Each cost component in Rs per kg of hydrogen, and its share of the gross cost before any subsidy.';
      fig.tableCaption.hidden = false;
      fillTable(fig.table, ['Component', 'Rs/kg', '% of gross'], tableRows);
    }

    // =====================================================================
    // 3. Price duration curve
    // =====================================================================
    function renderChartDuration(yearData, stateData, ceiling, operatingHours) {
      var fig = els.chart3;
      var svg = fig.svg;
      var g = geom(fig, { top: 46, right: 40 });
      clearSvg(svg);
      sizeSvg(fig, g);

      // `duration` is stored in MCP space sorted DESCENDING. Apply the state
      // transform and reverse it so the curve reads cheapest-to-most-expensive
      // left to right, matching the axis title.
      var asc = yearData.duration.slice().reverse();
      var n = asc.length;
      var pts = asc.map(function (mcp, i) {
        return [((i + 1) / n) * 8760, (mcp + stateData.adder) * stateData.loss_factor];
      });
      var yMax = 0;
      pts.forEach(function (p) { if (p[1] > yMax) yMax = p[1]; });
      yMax = Math.max(yMax, ceiling) * 1.05;

      var xScale = scaleLinear([0, 8760], [g.margin.left, g.margin.left + g.plotW]);
      var yScale = scaleLinear([0, yMax], [g.margin.top + g.plotH, g.margin.top]);
      drawAxes(svg, g, xScale, [0, 8760], yScale, [0, yMax],
        'Cumulative hours per year (ranked by price, not chronological)',
        'Landed power price (Rs/unit)',
        function (v) { return v.toFixed(0); }, function (v) { return v.toFixed(1); });

      var runHours = clampVal(operatingHours, 0, 8760);
      var crossX = xScale(runHours);
      var ceilY = yScale(ceiling);

      // Shade the region below the ceiling and left of the crossing point.
      var shaded = pts.filter(function (p) { return p[0] <= runHours; });
      if (shaded.length) {
        var areaPts = [[0, 0]].concat(shaded).concat([[shaded[shaded.length - 1][0], 0]]);
        svg.appendChild(svgEl('path', {
          d: pointsToPath(areaPts, xScale, yScale) + ' Z', fill: COLORS[0], opacity: '0.18',
        }));
      }
      svg.appendChild(svgEl('path', {
        d: pointsToPath(pts, xScale, yScale), fill: 'none', stroke: COLORS[0], 'stroke-width': '2',
      }));

      svg.appendChild(svgEl('line', {
        x1: g.margin.left, y1: ceilY, x2: g.margin.left + g.plotW, y2: ceilY,
        stroke: COLORS[1], 'stroke-width': '2', 'stroke-dasharray': '6 4',
      }));
      svg.appendChild(svgEl('line', {
        x1: crossX, y1: g.margin.top, x2: crossX, y2: g.margin.top + g.plotH,
        stroke: COLORS[2], 'stroke-width': '2', 'stroke-dasharray': '3 3',
      }));

      plaque(svg, g.margin.left + g.plotW - 6, ceilY - 9,
        'Your ceiling: Rs ' + fmt(ceiling, 2) + '/unit', 'end');
      plaque(svg, crossX + 8, g.margin.top + 18, fmtInt(operatingHours) + ' hours', 'start');

      // Region labels — the point of the whole chart.
      var midRunX = g.margin.left + (crossX - g.margin.left) / 2;
      var midIdleX = crossX + (g.margin.left + g.plotW - crossX) / 2;
      var regionY = g.margin.top + g.plotH - 14;
      if (crossX - g.margin.left > 90) {
        label(svg, midRunX, regionY, 'Hours the plant runs', 'series-label', 'middle');
      }
      if (g.margin.left + g.plotW - crossX > 60) {
        label(svg, midIdleX, regionY, 'Idle', 'series-label', 'middle');
      }

      var xs = pts.map(function (p) { return p[0]; });
      var tooltip;
      var marker = svgEl('circle', { class: 'hover-marker', r: '5.5', visibility: 'hidden' });
      var crosshair = svgEl('line', { class: 'crosshair-line', visibility: 'hidden' });
      svg.appendChild(crosshair);
      svg.appendChild(marker);
      var capture = svgEl('rect', {
        x: g.margin.left, y: g.margin.top, width: g.plotW, height: g.plotH,
        fill: 'transparent', class: 'hover-capture',
      });
      svg.appendChild(capture);
      capture.addEventListener('pointermove', function (evt) {
        var p = svgPoint(svg, evt);
        var idx = bisectNearest(xs, clampVal(xScale.invert(p.x), 0, 8760));
        var pt = pts[idx];
        var px = xScale(pt[0]), py = yScale(pt[1]);
        crosshair.setAttribute('x1', px); crosshair.setAttribute('x2', px);
        crosshair.setAttribute('y1', g.margin.top); crosshair.setAttribute('y2', g.margin.top + g.plotH);
        crosshair.setAttribute('visibility', 'visible');
        marker.setAttribute('cx', px); marker.setAttribute('cy', py);
        marker.setAttribute('visibility', 'visible');
        tooltip.show([
          pt[0] <= runHours ? 'Plant runs at this price' : 'Plant idle at this price',
          'Cumulative hours: ' + pt[0].toFixed(0) + ' h',
          'Landed price: Rs ' + pt[1].toFixed(3) + '/unit',
        ], px, py);
      });
      capture.addEventListener('pointerleave', function () {
        crosshair.setAttribute('visibility', 'hidden');
        marker.setAttribute('visibility', 'hidden');
        tooltip.hide();
      });
      tooltip = makeTooltip(svg, g);

      fig.note.textContent = 'Every 15-minute block in the selected year, sorted from cheapest to most expensive. ' +
        'This is not a time series — the horizontal axis is a count of hours, not a calendar. Reading it: at your ceiling of Rs ' +
        fmt(ceiling, 2) + ', the plant runs for the ' + fmtInt(operatingHours) +
        ' hours to the left of the marker and stays idle for the rest of the year.';
      fig.note.hidden = false;

      fig.tableCaption.textContent = 'Landed price thresholds and the cumulative hours per year available at or below each, ' +
        'for ' + params.year + ' and ' + params.state + '. Rows are sampled points along the ranked curve above, cheapest first — not calendar dates.';
      fig.tableCaption.hidden = false;
      fillTable(fig.table, [
        { text: 'Cumulative hours (h/yr)', title: 'Hours per year available at or below the price in this row, counting from the cheapest block upward.' },
        { text: 'Landed price (Rs/unit)', title: 'Market clearing price plus the state adder, multiplied by the state loss factor.' },
        { text: 'Plant status at your ceiling', title: 'Whether the plant would be running during these hours at your current ceiling.' },
      ], pts.filter(function (_, i) { return i % 25 === 0; }).map(function (p) {
        return [p[0].toFixed(0), p[1].toFixed(3), p[0] <= runHours ? 'Running' : 'Idle'];
      }));
    }

    // =====================================================================
    // 4. Monthly utilisation
    // =====================================================================
    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function renderChartMonthly(yearData, sweepKey, ceiling, stateData) {
      var fig = els.chart4;
      var svg = fig.svg;
      var g = geom(fig, { top: 34 });
      clearSvg(svg);
      sizeSvg(fig, g);

      var t = MODEL.ceilingToThreshold(ceiling, stateData.adder, stateData.loss_factor);
      var tc = clampVal(t, 0, 12);
      var snapped = (Math.round(tc / 0.10) * 0.10).toFixed(2);
      var monthly = yearData.monthly[sweepKey][snapped];
      if (!monthly) {
        var keys = Object.keys(yearData.monthly[sweepKey]).map(Number).sort(function (a, b) { return a - b; });
        var nearest = keys.reduce(function (best, k) { return Math.abs(k - tc) < Math.abs(best - tc) ? k : best; }, keys[0]);
        snapped = nearest.toFixed(2);
        monthly = yearData.monthly[sweepKey][snapped];
      }
      var pct = monthly.map(function (h, i) {
        return yearData.month_total_hours[i] > 0 ? (h / yearData.month_total_hours[i]) * 100 : 0;
      });

      var xScale = scaleLinear([0, 12], [g.margin.left, g.margin.left + g.plotW]);
      var yScale = scaleLinear([0, 100], [g.margin.top + g.plotH, g.margin.top]);
      drawAxes(svg, g, xScale, [0, 12], yScale, [0, 100], 'Month', 'Utilisation (%)',
        function (v) { var idx = Math.round(v - 0.5); return MONTH_NAMES[idx] || ''; },
        function (v) { return v.toFixed(0); },
        [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5]);

      var maxPct = Math.max.apply(null, pct);
      var minPct = Math.min.apply(null, pct);
      var maxIdx = pct.indexOf(maxPct);
      var minIdx = pct.indexOf(minPct);
      var slotW = g.plotW / 12;
      var barW = slotW * 0.68;
      var tooltip;

      pct.forEach(function (p, i) {
        var x = xScale(i) + (slotW - barW) / 2;
        var y = yScale(p);
        var h = (g.margin.top + g.plotH) - y;
        var isExtreme = i === maxIdx || i === minIdx;
        var rect = svgEl('rect', {
          x: x, y: y, width: barW, height: h,
          fill: isExtreme ? COLORS[3] : COLORS[0], class: 'hover-capture',
        });
        rect.addEventListener('pointermove', function () {
          tooltip.show([MONTH_NAMES[i], 'Utilisation: ' + p.toFixed(1) + '%',
            monthly[i].toFixed(0) + ' h of ' + yearData.month_total_hours[i].toFixed(0) + ' h'],
          x + barW / 2, y);
        });
        rect.addEventListener('pointerleave', function () { tooltip.hide(); });
        svg.appendChild(rect);
        label(svg, x + barW / 2, y - 7, p.toFixed(0) + '%', 'value-label', 'middle');
      });

      // Name the weakest and strongest months directly on their own bars, and
      // in words rather than by colour alone. Set vertically inside the bar so
      // the badge can never overlap a neighbouring value label.
      [[maxIdx, maxPct, 'Strongest'], [minIdx, minPct, 'Weakest']].forEach(function (m) {
        var cx = xScale(m[0]) + slotW / 2;
        var cy = yScale(m[1]) + 46;
        var t = svgEl('text', {
          x: cx, y: cy, 'text-anchor': 'middle', class: 'value-label on-fill',
          transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
        });
        t.textContent = m[2];
        svg.appendChild(t);
      });
      tooltip = makeTooltip(svg, g);

      fig.note.textContent = 'Computed at the nearest available threshold, Rs ' + snapped +
        '/unit in market-price terms (the stored data is gridded at Rs 0.10 steps). ' +
        'Each bar is the share of that calendar month’s hours during which the plant would run.';
      fig.note.hidden = false;

      fig.tableCaption.textContent = 'Operating hours per calendar month as a percentage of the total hours in that month, for ' +
        params.year + ' and ' + params.state + '.';
      fig.tableCaption.hidden = false;
      fillTable(fig.table, ['Month', 'Utilisation (%)', 'Operating hours (h)', 'Hours in month (h)'],
        pct.map(function (p, i) {
          return [MONTH_NAMES[i], p.toFixed(1), monthly[i].toFixed(0), yearData.month_total_hours[i].toFixed(0)];
        }));
    }

    // =====================================================================
    // 5. Year comparison
    // =====================================================================
    var PRE_REGIME_YEARS = ['AY2022-23', 'AY2023-24'];

    function renderChartYears(stateData, sweepKey, ceiling, c) {
      var fig = els.chart5;
      var svg = fig.svg;
      var g = geom(fig, { top: 40 });
      clearSvg(svg);
      sizeSvg(fig, g);

      var t = MODEL.ceilingToThreshold(ceiling, stateData.adder, stateData.loss_factor);
      var values = API.YEAR_KEYS.map(function (yk) {
        var interp = MODEL.interpolateSweep(DATA.years[yk].sweep[sweepKey], t);
        var res = MODEL.coreLCOH(interp.hours, interp.w, stateData.adder, stateData.loss_factor, c);
        return { year: yk, lcoh: res.ok ? res.lcoh : 0 };
      });
      var yMax = Math.max.apply(null, values.map(function (v) { return v.lcoh; })) * 1.22;
      var yMin = Math.min(0, Math.min.apply(null, values.map(function (v) { return v.lcoh; })) * 1.2);

      var xScale = scaleLinear([0, 4], [g.margin.left, g.margin.left + g.plotW]);
      var yScale = scaleLinear([yMin, yMax], [g.margin.top + g.plotH, g.margin.top]);
      drawAxes(svg, g, xScale, [0, 4], yScale, [yMin, yMax], 'Price year', 'LCOH (Rs/kg)',
        function (v) { var idx = Math.round(v - 0.5); return API.YEAR_KEYS[idx] ? API.YEAR_KEYS[idx].replace('AY', '') : ''; },
        function (v) { return v.toFixed(0); },
        [0.5, 1.5, 2.5, 3.5]);

      var slotW = g.plotW / 4;
      var barW = slotW * 0.56;
      var zeroY = yScale(0);
      var tooltip;

      values.forEach(function (v, i) {
        var x = xScale(i) + (slotW - barW) / 2;
        var y = yScale(Math.max(v.lcoh, 0));
        var h = Math.abs(zeroY - yScale(v.lcoh));
        var isCurrent = v.year === params.year;
        var isPre = PRE_REGIME_YEARS.indexOf(v.year) !== -1;
        var rect = svgEl('rect', {
          x: x, y: y, width: barW, height: h,
          fill: isCurrent ? COLORS[3] : COLORS[0], class: 'hover-capture',
        });
        rect.addEventListener('pointermove', function () {
          tooltip.show([v.year + (isCurrent ? ' (current)' : ''),
            'LCOH: Rs ' + v.lcoh.toFixed(1) + '/kg',
            isPre ? 'Predates the low-price regime' : ''], x + barW / 2, y);
        });
        rect.addEventListener('pointerleave', function () { tooltip.hide(); });
        svg.appendChild(rect);
        label(svg, x + barW / 2, y - 8, 'Rs ' + v.lcoh.toFixed(0), 'value-label', 'middle');
        // A text badge, so the distinction never rests on colour alone.
        if (isPre) {
          plaque(svg, x + barW / 2, y - 28, 'pre-regime', 'middle', 'plaque-warn');
        }
      });
      tooltip = makeTooltip(svg, g);

      fig.note.textContent = 'LCOH in each price year at your current settings. Years badged “pre-regime” ' +
        '(AY2022-23 and AY2023-24) predate the low-price regime and are shown for trajectory, not as a basis on their own.';
      fig.note.hidden = false;

      fig.tableCaption.textContent = 'LCOH computed at your current ceiling and cost assumptions, against each of the four price years.';
      fig.tableCaption.hidden = false;
      fillTable(fig.table, ['Price year', 'LCOH (Rs/kg)', 'Note'],
        values.map(function (v) {
          return [v.year, v.lcoh.toFixed(1),
            PRE_REGIME_YEARS.indexOf(v.year) !== -1 ? 'Predates the low-price regime' : ''];
        }));
    }

    // =====================================================================
    // 6. Repricing schedule
    // =====================================================================
    function renderChartReprice(reprice) {
      var fig = els.chart6;
      var svg = fig.svg;
      // Wider right margin: this chart carries a second Y axis.
      var g = geom(fig, { top: 40, right: 108 });
      clearSvg(svg);
      sizeSvg(fig, g);
      if (!reprice.ok) return;

      var plantLife = params.plantLife;
      var priceByYear = [], rateBaseByYear = [];
      for (var y = 1; y <= plantLife; y++) {
        priceByYear.push(reprice.blocks[Math.floor((y - 1) / 3)].price);
        rateBaseByYear.push(reprice.openingRateBaseByYear[y] / 1e7);
      }
      var yMax = Math.max.apply(null, priceByYear) * 1.22;
      var yMin = Math.min(0, Math.min.apply(null, priceByYear) * 1.2);
      var rbMax = Math.max.apply(null, rateBaseByYear) || 1;

      var xScale = scaleLinear([1, plantLife], [g.margin.left, g.margin.left + g.plotW]);
      var yScale = scaleLinear([yMin, yMax], [g.margin.top + g.plotH, g.margin.top]);
      var yScale2 = scaleLinear([0, rbMax * 1.22], [g.margin.top + g.plotH, g.margin.top]);

      var ticks = [];
      var step = plantLife <= 10 ? 1 : Math.ceil(plantLife / 10);
      for (var tv = 1; tv <= plantLife; tv += step) ticks.push(tv);
      drawAxes(svg, g, xScale, [1, plantLife], yScale, [yMin, yMax],
        'Year of operation', 'Contract price (Rs/kg)',
        function (v) { return v.toFixed(0); }, function (v) { return v.toFixed(0); }, ticks);

      // Second Y axis, explicitly labelled with its own units.
      var rightX = g.margin.left + g.plotW;
      for (var k = 0; k <= 5; k++) {
        var rv = (rbMax * 1.22 / 5) * k;
        var pry = yScale2(rv);
        svg.appendChild(svgEl('line', { x1: rightX, y1: pry, x2: rightX + 6, y2: pry, stroke: COLORS[1] }));
        label(svg, rightX + 11, pry + 5, rv.toFixed(1), 'axis-label', 'start');
      }
      var midY = g.margin.top + g.plotH / 2;
      var ryl = svgEl('text', {
        x: g.w - 10, y: midY, 'text-anchor': 'middle', class: 'axis-title',
        transform: 'rotate(90 ' + (g.w - 10) + ' ' + midY + ')',
      });
      ryl.textContent = 'Opening rate base (Rs cr)';
      svg.appendChild(ryl);

      var stepPts = [];
      for (var i = 0; i < priceByYear.length; i++) {
        stepPts.push([i + 1, priceByYear[i]]);
        stepPts.push([Math.min(i + 2, plantLife), priceByYear[i]]);
      }
      svg.appendChild(svgEl('path', {
        d: pointsToPath(stepPts, xScale, yScale), fill: 'none', stroke: COLORS[0], 'stroke-width': '2',
      }));
      svg.appendChild(svgEl('path', {
        d: pointsToPath(rateBaseByYear.map(function (v, i2) { return [i2 + 1, v]; }), xScale, yScale2),
        fill: 'none', stroke: COLORS[1], 'stroke-width': '2', 'stroke-dasharray': '5 3',
      }));

      // One price label per block, at the block's midpoint.
      reprice.blocks.forEach(function (b) {
        var midYear = (b.startYear + b.endYear) / 2;
        label(svg, xScale(midYear), yScale(b.price) - 10, 'Rs ' + b.price.toFixed(0), 'value-label', 'middle');
      });

      drawLegend(svg, [
        { type: 'line', color: COLORS[0], width: 2, label: 'Contract price (Rs/kg, left axis)' },
        { type: 'line', color: COLORS[1], width: 2, dash: '5 3', label: 'Opening rate base (Rs cr, right axis)' },
      ], g.margin.left, 8, g.plotW);

      var xs6 = priceByYear.map(function (_, i2) { return i2 + 1; });
      var tooltip;
      var marker = svgEl('circle', { class: 'hover-marker', r: '5.5', visibility: 'hidden' });
      var crosshair = svgEl('line', { class: 'crosshair-line', visibility: 'hidden' });
      svg.appendChild(crosshair);
      svg.appendChild(marker);
      var capture = svgEl('rect', {
        x: g.margin.left, y: g.margin.top, width: g.plotW, height: g.plotH,
        fill: 'transparent', class: 'hover-capture',
      });
      svg.appendChild(capture);
      capture.addEventListener('pointermove', function (evt) {
        var p = svgPoint(svg, evt);
        var idx = bisectNearest(xs6, clampVal(xScale.invert(p.x), 1, plantLife));
        var px = xScale(xs6[idx]), py = yScale(priceByYear[idx]);
        crosshair.setAttribute('x1', px); crosshair.setAttribute('x2', px);
        crosshair.setAttribute('y1', g.margin.top); crosshair.setAttribute('y2', g.margin.top + g.plotH);
        crosshair.setAttribute('visibility', 'visible');
        marker.setAttribute('cx', px); marker.setAttribute('cy', py);
        marker.setAttribute('visibility', 'visible');
        tooltip.show(['Year ' + xs6[idx],
          'Contract price: Rs ' + priceByYear[idx].toFixed(1) + '/kg',
          'Rate base: Rs ' + rateBaseByYear[idx].toFixed(2) + ' cr'], px, py);
      });
      capture.addEventListener('pointerleave', function () {
        crosshair.setAttribute('visibility', 'hidden');
        marker.setAttribute('visibility', 'hidden');
        tooltip.hide();
      });
      tooltip = makeTooltip(svg, g);

      fig.tableCaption.textContent = 'Contract price and opening rate base for each year of operation under the three-year repricing schedule.';
      fig.tableCaption.hidden = false;
      fillTable(fig.table, [
        { text: 'Year' },
        { text: 'Contract price (Rs/kg)', title: 'Levelised price within the three-year block containing this year.' },
        { text: 'Opening rate base (Rs cr)', title: 'Undepreciated capital at the start of the year, net of any capital subsidy.' },
      ], priceByYear.map(function (p, i) {
        return [i + 1, p.toFixed(1), rateBaseByYear[i].toFixed(2)];
      }));
    }

    function renderRepriceTable(reprice, result, c) {
      clearChildren(els.repriceBody);
      if (!reprice.ok) return;
      var table = el('table', { class: 'data-table' });
      fillTable(table, ['Block', 'Years', 'Opening rate base (Rs cr)', 'Capital charge (Rs/kg)', 'Contract price (Rs/kg)', 'Annual revenue (Rs cr)', '× grey'],
        reprice.blocks.map(function (b) {
          return [b.block, b.yearsLabel, b.openingRateBaseCr.toFixed(2), b.capitalChargePerKg.toFixed(2),
            b.price.toFixed(1), b.revenueCr.toFixed(2), b.multipleOfGrey !== null ? b.multipleOfGrey.toFixed(2) : '—'];
        }));
      els.repriceBody.appendChild(table);

      var summary = el('div', { class: 'reprice-summary' });
      summary.appendChild(el('p', { text: 'PV-levelised price to the buyer over ' + params.plantLife + ' years: Rs ' + fmt(reprice.pvLevelisedPrice, 1) + '/kg (flat LCOH at this recovery period: Rs ' + fmt(result.lcoh, 1) + '/kg).' }));
      summary.appendChild(el('p', { text: 'Project NPV at the discount rate: Rs ' + fmt(reprice.npv / 1e7, 2) + ' cr. Project IRR: ' + (reprice.irr !== null ? (reprice.irr * 100).toFixed(2) + '%' : 'not solvable for this cash-flow pattern') + '.' }));
      els.repriceBody.appendChild(summary);
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
    function init() {
      params = API.decodeParams(window.location.hash);
      buildLayout();
      syncControlsFromParams();
      recompute();
      observeChartResizes();
      window.addEventListener('hashchange', function () {
        params = API.decodeParams(window.location.hash);
        syncControlsFromParams();
        scheduleRecompute();
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
});
