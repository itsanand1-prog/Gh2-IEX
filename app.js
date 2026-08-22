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
    { key: 'mr', prop: 'minRunHours', type: 'enum-num', options: MIN_RUN_HOURS, def: 0.5 },
    { key: 'om', prop: 'omPct', type: 'number', min: 0, max: 15, def: 4.0 },
    { key: 'wc', prop: 'waterCostPerKg', type: 'number', min: 0, max: 10, def: 0.90 },
    { key: 'sp', prop: 'stackPct', type: 'number', min: 0, max: 100, def: 40 },
    { key: 'sl', prop: 'stackLifeHours', type: 'number', min: 100, max: 200000, def: 60000 },
    { key: 'res', prop: 'residualPct', type: 'number', min: 0, max: 100, def: 0 },
    { key: 'grey', prop: 'greyBenchmark', type: 'number', min: 1, max: 5000, def: 250 },
    { key: 'pl', prop: 'plantLife', type: 'number', min: 1, max: 40, def: 20 },
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
    };
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
        c.waterCostPerKg + '|' + c.stackPct + '|' + c.stackLifeHours + '|' + c.residualPct;
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
        var opt = el('option', { value: String(h), text: h + ' h' });
        if (h === params.minRunHours) opt.selected = true;
        mrSel.appendChild(opt);
      });
      mrSel.addEventListener('change', function () { setParam('minRunHours', Number(mrSel.value)); });
      techFieldset.appendChild(field('Minimum run block', mrSel));

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

      container.appendChild(adv);

      els.yearSel = yearSel; els.stateSel = stateSel; els.repriceCheck = repriceCheck; els.mrSel = mrSel;
    }

    function buildResults(container) {
      els.flags = el('div', { id: 'flags', class: 'flags', 'aria-live': 'polite' });
      els.tiles = el('div', { id: 'tiles', class: 'tiles' });
      els.formula = el('div', { id: 'formula', class: 'formula-box', 'aria-live': 'polite' });

      els.breakdownDetails = el('details', { open: 'open' }, [el('summary', { text: 'Cost breakdown' })]);
      els.breakdownTable = el('table', { class: 'data-table', id: 'breakdown-table' });
      els.breakdownDetails.appendChild(els.breakdownTable);

      els.landedDetails = el('details', {}, [el('summary', { text: 'Landed price build-up' })]);
      els.landedBody = el('div', { class: 'buildup', id: 'landed-buildup' });
      els.landedDetails.appendChild(els.landedBody);

      els.chartsWrap = el('div', { class: 'charts' });
      els.chart1 = chartFigure('chart-lcoh', 'LCOH vs landed power ceiling');
      els.chart2 = chartFigure('chart-stack', 'Cost stack breakdown');
      els.chart3 = chartFigure('chart-duration', 'Price duration curve');
      els.chart4 = chartFigure('chart-monthly', 'Monthly utilisation');
      els.chart5 = chartFigure('chart-years', 'Year comparison');
      els.chart6 = chartFigure('chart-reprice', 'Repricing schedule');
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

    function chartFigure(id, title) {
      var svg = svgEl('svg', {
        id: id, viewBox: '0 0 640 360', role: 'img', 'aria-label': title,
        preserveAspectRatio: 'xMidYMid meet', focusable: 'true', tabindex: '0',
      });
      var caption = el('figcaption', { text: title });
      var details = el('details', {}, [el('summary', { text: 'Data table' })]);
      var table = el('table', { class: 'data-table' });
      details.appendChild(table);
      var root = el('figure', { class: 'chart-figure' }, [caption, svg, details]);
      return { root: root, svg: svg, table: table };
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
      var optimum = findOptimumMemo(MODEL, sweep, stateData.adder, stateData.loss_factor,
        params.year + '|' + params.state + '|' + sweepKey, c);

      renderFlags(result, optimum, yearData);
      renderTiles(result, c);
      renderFormula(result, c);
      renderBreakdown(result);
      renderLandedBuildup(result, stateData);
      renderChartLCOH(sweep, stateData, c, result, optimum);
      renderChartStack(result);
      renderChartDuration(yearData, stateData, params.ceiling);
      renderChartMonthly(yearData, sweepKey, params.ceiling, stateData);
      renderChartYears(stateData, sweepKey, params.ceiling, c);

      els.chart6.root.hidden = !params.reprice;
      els.repriceDetails.hidden = !params.reprice;
      if (params.reprice) {
        var reprice = MODEL.repricingSchedule(result, c, params.greyBenchmark, 3);
        renderRepriceTable(reprice, result, c);
        renderChartReprice(reprice);
      }

      var hash = API.encodeParams(params);
      if (window.location.hash !== hash) {
        history.replaceState(null, '', hash);
      }
    }

    function renderFlags(result, optimum, yearData) {
      clearChildren(els.flags);
      var flags = [];

      if (!result.ok) {
        result.errors.forEach(function (msg) {
          flags.push({ kind: 'error', text: msg });
        });
      } else {
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
        ' + ' + fmt(params.waterCostPerKg, 2) + ' = Rs ' + fmt(result.lcoh, 1) + '/kg';
      els.formula.appendChild(el('p', { class: 'formula-label', text: 'The formula, with your numbers:' }));
      els.formula.appendChild(el('p', { class: 'formula-line', text: line }));
    }

    function renderBreakdown(result) {
      clearChildren(els.breakdownTable);
      if (!result.ok) return;
      var head = el('tr', {}, [el('th', { text: 'Component' }), el('th', { text: 'Rs/kg' }), el('th', { text: '% of LCOH' })]);
      els.breakdownTable.appendChild(el('thead', {}, [head]));
      var rows = [
        ['Capital recovery', result.capitalPerKg],
        ['Fixed O&M', result.omPerKg],
        ['Stack replacement', result.stackPerKg],
        ['Power', result.powerPerKg],
        ['Water', result.waterPerKg],
      ];
      var tbody = el('tbody');
      rows.forEach(function (r) {
        var pct = result.lcoh > 0 ? (r[1] / result.lcoh) * 100 : 0;
        tbody.appendChild(el('tr', {}, [
          el('td', { text: r[0] }),
          el('td', { text: fmt(r[1], 2) }),
          el('td', { text: fmt(pct, 1) + '%' }),
        ]));
      });
      tbody.appendChild(el('tr', { class: 'total-row' }, [
        el('td', { text: 'Total' }),
        el('td', { text: fmt(result.lcoh, 2) }),
        el('td', { text: '100.0%' }),
      ]));
      els.breakdownTable.appendChild(tbody);
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
    var CHART_W = 640, CHART_H = 360;
    var MARGIN = { top: 16, right: 16, bottom: 40, left: 56 };
    var PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
    var PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;
    var COLORS = ['#1b6ec2', '#c2571b', '#2b8a3e', '#9c36b5', '#868e96'];

    function scaleLinear(domain, range) {
      var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1];
      var span = d1 - d0;
      return function (x) {
        if (span === 0) return r0;
        return r0 + ((x - d0) / span) * (r1 - r0);
      };
    }

    function clearSvg(svg) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    }

    function drawAxes(svg, xScale, xDomain, yScale, yDomain, xLabel, yLabel, xTickFmt, yTickFmt) {
      var g = svgEl('g', { class: 'axes' });
      g.appendChild(svgEl('line', {
        x1: MARGIN.left, y1: MARGIN.top + PLOT_H, x2: MARGIN.left + PLOT_W, y2: MARGIN.top + PLOT_H,
        stroke: 'currentColor', 'stroke-width': '1',
      }));
      g.appendChild(svgEl('line', {
        x1: MARGIN.left, y1: MARGIN.top, x2: MARGIN.left, y2: MARGIN.top + PLOT_H,
        stroke: 'currentColor', 'stroke-width': '1',
      }));
      var xTicks = 5, yTicks = 5;
      for (var i = 0; i <= xTicks; i++) {
        var xv = xDomain[0] + (i / xTicks) * (xDomain[1] - xDomain[0]);
        var px = xScale(xv);
        g.appendChild(svgEl('line', { x1: px, y1: MARGIN.top + PLOT_H, x2: px, y2: MARGIN.top + PLOT_H + 4, stroke: 'currentColor' }));
        var t1 = svgEl('text', { x: px, y: MARGIN.top + PLOT_H + 16, 'text-anchor': 'middle', class: 'axis-label' });
        t1.textContent = xTickFmt(xv);
        g.appendChild(t1);
      }
      for (var j = 0; j <= yTicks; j++) {
        var yv = yDomain[0] + (j / yTicks) * (yDomain[1] - yDomain[0]);
        var py = yScale(yv);
        g.appendChild(svgEl('line', { x1: MARGIN.left - 4, y1: py, x2: MARGIN.left, y2: py, stroke: 'currentColor' }));
        var t2 = svgEl('text', { x: MARGIN.left - 8, y: py + 3, 'text-anchor': 'end', class: 'axis-label' });
        t2.textContent = yTickFmt(yv);
        g.appendChild(t2);
      }
      var xl = svgEl('text', { x: MARGIN.left + PLOT_W / 2, y: CHART_H - 4, 'text-anchor': 'middle', class: 'axis-title' });
      xl.textContent = xLabel;
      g.appendChild(xl);
      var yl = svgEl('text', {
        x: 12, y: MARGIN.top + PLOT_H / 2, 'text-anchor': 'middle', class: 'axis-title',
        transform: 'rotate(-90 12 ' + (MARGIN.top + PLOT_H / 2) + ')',
      });
      yl.textContent = yLabel;
      g.appendChild(yl);
      svg.appendChild(g);
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
      var thead = el('thead', {}, [el('tr', {}, headers.map(function (h) { return el('th', { text: h }); }))]);
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

    function renderChartLCOH(sweep, stateData, c, result, optimum) {
      var svg = els.chart1.svg;
      clearSvg(svg);
      var mainPts = curveForYear(params.year, API.minRunToSweepKey(params.minRunHours), stateData.adder, stateData.loss_factor, c);
      if (!mainPts.length) return;
      var yMax = Math.max(params.greyBenchmark, result.ok ? result.lcoh : 0);
      mainPts.forEach(function (p) { if (p[1] > yMax) yMax = p[1]; });
      yMax *= 1.08;
      var xScale = scaleLinear([1.5, 8.0], [MARGIN.left, MARGIN.left + PLOT_W]);
      var yScale = scaleLinear([0, yMax], [MARGIN.top + PLOT_H, MARGIN.top]);
      drawAxes(svg, xScale, [1.5, 8.0], yScale, [0, yMax], 'Landed ceiling (Rs/unit)', 'LCOH (Rs/kg)',
        function (v) { return v.toFixed(1); }, function (v) { return v.toFixed(0); });

      API.YEAR_KEYS.forEach(function (yk, idx) {
        if (yk === params.year) return;
        var pts = curveForYear(yk, API.minRunToSweepKey(params.minRunHours), stateData.adder, stateData.loss_factor, c);
        if (pts.length) {
          svg.appendChild(svgEl('path', { d: pointsToPath(pts, xScale, yScale), fill: 'none', stroke: COLORS[4], 'stroke-width': '1', opacity: '0.35' }));
        }
      });

      svg.appendChild(svgEl('path', { d: pointsToPath(mainPts, xScale, yScale), fill: 'none', stroke: COLORS[0], 'stroke-width': '2' }));

      var greyY = yScale(params.greyBenchmark);
      svg.appendChild(svgEl('line', { x1: MARGIN.left, y1: greyY, x2: MARGIN.left + PLOT_W, y2: greyY, stroke: COLORS[1], 'stroke-dasharray': '4 3' }));

      if (optimum && optimum.ok !== false) {
        var optX = xScale(clampVal(optimum.ceilingLanded, 1.5, 8.0));
        svg.appendChild(svgEl('line', { x1: optX, y1: MARGIN.top, x2: optX, y2: MARGIN.top + PLOT_H, stroke: COLORS[2], 'stroke-dasharray': '2 2' }));
      }
      if (result.ok) {
        var mx = xScale(clampVal(params.ceiling, 1.5, 8.0));
        var my = yScale(result.lcoh);
        svg.appendChild(svgEl('circle', { cx: mx, cy: my, r: '5', fill: COLORS[3] }));
      }

      fillTable(els.chart1.table, ['Ceiling (Rs/unit)', 'LCOH (Rs/kg)'],
        mainPts.filter(function (_, i) { return i % 20 === 0; }).map(function (p) { return [p[0].toFixed(2), p[1].toFixed(1)]; }));
    }

    function clampVal(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

    function renderChartStack(result) {
      var svg = els.chart2.svg;
      clearSvg(svg);
      if (!result.ok) return;
      var comps = [
        ['Capital', result.capitalPerKg, COLORS[0]],
        ['O&M', result.omPerKg, COLORS[1]],
        ['Stack', result.stackPerKg, COLORS[2]],
        ['Power', result.powerPerKg, COLORS[3]],
        ['Water', result.waterPerKg, COLORS[4]],
      ];
      var total = result.lcoh;
      var xScale = scaleLinear([0, total], [MARGIN.left, MARGIN.left + PLOT_W]);
      var barY = MARGIN.top + PLOT_H / 2 - 30;
      var acc = 0;
      comps.forEach(function (c) {
        var x0 = xScale(acc);
        var x1 = xScale(acc + c[1]);
        svg.appendChild(svgEl('rect', { x: x0, y: barY, width: Math.max(0, x1 - x0), height: 60, fill: c[2] }));
        acc += c[1];
      });
      svg.appendChild(svgEl('line', { x1: MARGIN.left, y1: barY + 70, x2: MARGIN.left + PLOT_W, y2: barY + 70, stroke: 'currentColor' }));
      for (var i = 0; i <= 5; i++) {
        var v = (total / 5) * i;
        var px = xScale(v);
        var t = svgEl('text', { x: px, y: barY + 86, 'text-anchor': 'middle', class: 'axis-label' });
        t.textContent = v.toFixed(0);
        svg.appendChild(t);
      }
      var legend = svgEl('g', { transform: 'translate(' + MARGIN.left + ',' + (barY - 20) + ')' });
      comps.forEach(function (c, i) {
        var gx = i * 120;
        legend.appendChild(svgEl('rect', { x: gx, y: 0, width: 10, height: 10, fill: c[2] }));
        var t = svgEl('text', { x: gx + 14, y: 9, class: 'axis-label' });
        t.textContent = c[0];
        legend.appendChild(t);
      });
      svg.appendChild(legend);

      fillTable(els.chart2.table, ['Component', 'Rs/kg'], comps.map(function (c) { return [c[0], c[1].toFixed(2)]; }));
    }

    function renderChartDuration(yearData, stateData, ceiling) {
      var svg = els.chart3.svg;
      clearSvg(svg);
      var duration = yearData.duration;
      var n = duration.length;
      var pts = duration.map(function (mcp, i) {
        var hrs = (i / (n - 1)) * 8760;
        var landed = (mcp + stateData.adder) * stateData.loss_factor;
        return [hrs, landed];
      });
      var yMax = 0;
      pts.forEach(function (p) { if (p[1] > yMax) yMax = p[1]; });
      yMax = Math.max(yMax, ceiling) * 1.05;
      var xScale = scaleLinear([0, 8760], [MARGIN.left, MARGIN.left + PLOT_W]);
      var yScale = scaleLinear([0, yMax], [MARGIN.top + PLOT_H, MARGIN.top]);
      drawAxes(svg, xScale, [0, 8760], yScale, [0, yMax], 'Hours', 'Landed price (Rs/unit)',
        function (v) { return v.toFixed(0); }, function (v) { return v.toFixed(1); });

      var shadedPts = pts.filter(function (p) { return p[1] <= ceiling; });
      if (shadedPts.length) {
        var lastHr = shadedPts[shadedPts.length - 1][0];
        var areaPts = [[0, 0]].concat(shadedPts).concat([[lastHr, 0]]);
        svg.appendChild(svgEl('path', { d: pointsToPath(areaPts, xScale, yScale) + ' Z', fill: COLORS[0], opacity: '0.15' }));
      }
      svg.appendChild(svgEl('path', { d: pointsToPath(pts, xScale, yScale), fill: 'none', stroke: COLORS[0], 'stroke-width': '2' }));
      var cy = yScale(ceiling);
      svg.appendChild(svgEl('line', { x1: MARGIN.left, y1: cy, x2: MARGIN.left + PLOT_W, y2: cy, stroke: COLORS[1], 'stroke-dasharray': '4 3' }));

      fillTable(els.chart3.table, ['Hours', 'Landed price (Rs/unit)'],
        pts.filter(function (_, i) { return i % 25 === 0; }).map(function (p) { return [p[0].toFixed(0), p[1].toFixed(3)]; }));
    }

    function renderChartMonthly(yearData, sweepKey, ceiling, stateData) {
      var svg = els.chart4.svg;
      clearSvg(svg);
      var t = MODEL.ceilingToThreshold(ceiling, stateData.adder, stateData.loss_factor);
      var tc = clampVal(t, 0, 12);
      var snapped = (Math.round(tc / 0.10) * 0.10).toFixed(2);
      var monthly = yearData.monthly[sweepKey][snapped];
      if (!monthly) {
        var keys = Object.keys(yearData.monthly[sweepKey]).map(Number).sort(function (a, b) { return a - b; });
        var nearest = keys.reduce(function (best, k) { return Math.abs(k - tc) < Math.abs(best - tc) ? k : best; }, keys[0]);
        monthly = yearData.monthly[sweepKey][nearest.toFixed(2)];
      }
      var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var pct = monthly.map(function (h, i) { return yearData.month_total_hours[i] > 0 ? (h / yearData.month_total_hours[i]) * 100 : 0; });
      var xScale = scaleLinear([0, 12], [MARGIN.left, MARGIN.left + PLOT_W]);
      var yScale = scaleLinear([0, 100], [MARGIN.top + PLOT_H, MARGIN.top]);
      drawAxes(svg, xScale, [0, 12], yScale, [0, 100], 'Month', 'Utilisation (%)',
        function (v) { var idx = Math.round(v); return monthNames[idx] || ''; }, function (v) { return v.toFixed(0); });
      var barW = PLOT_W / 12 * 0.7;
      pct.forEach(function (p, i) {
        var x = xScale(i) + (PLOT_W / 12 - barW) / 2;
        var y = yScale(p);
        svg.appendChild(svgEl('rect', { x: x, y: y, width: barW, height: (MARGIN.top + PLOT_H) - y, fill: COLORS[0] }));
      });
      var titleEl = els.chart4.root.querySelector('figcaption');
      titleEl.textContent = 'Monthly utilisation (snapped to nearest Rs ' + snapped + '/unit threshold)';

      fillTable(els.chart4.table, ['Month', 'Utilisation (%)'], pct.map(function (p, i) { return [monthNames[i], p.toFixed(1)]; }));
    }

    function renderChartYears(stateData, sweepKey, ceiling, c) {
      var svg = els.chart5.svg;
      clearSvg(svg);
      var t = MODEL.ceilingToThreshold(ceiling, stateData.adder, stateData.loss_factor);
      var values = API.YEAR_KEYS.map(function (yk) {
        var sweep = DATA.years[yk].sweep[sweepKey];
        var interp = MODEL.interpolateSweep(sweep, t);
        var res = MODEL.coreLCOH(interp.hours, interp.w, stateData.adder, stateData.loss_factor, c);
        return { year: yk, lcoh: res.ok ? res.lcoh : 0 };
      });
      var yMax = Math.max.apply(null, values.map(function (v) { return v.lcoh; })) * 1.15;
      var xScale = scaleLinear([0, 4], [MARGIN.left, MARGIN.left + PLOT_W]);
      var yScale = scaleLinear([0, yMax], [MARGIN.top + PLOT_H, MARGIN.top]);
      drawAxes(svg, xScale, [0, 4], yScale, [0, yMax], 'Price year', 'LCOH (Rs/kg)',
        function (v) { var idx = Math.floor(v); return API.YEAR_KEYS[idx] ? API.YEAR_KEYS[idx].replace('AY', '') : ''; },
        function (v) { return v.toFixed(0); });
      var barW = PLOT_W / 4 * 0.6;
      values.forEach(function (v, i) {
        var x = xScale(i) + (PLOT_W / 4 - barW) / 2;
        var y = yScale(v.lcoh);
        var isCurrent = v.year === params.year;
        svg.appendChild(svgEl('rect', { x: x, y: y, width: barW, height: (MARGIN.top + PLOT_H) - y, fill: isCurrent ? COLORS[3] : COLORS[0] }));
      });
      fillTable(els.chart5.table, ['Year', 'LCOH (Rs/kg)'], values.map(function (v) { return [v.year, v.lcoh.toFixed(1)]; }));
    }

    function renderChartReprice(reprice) {
      var svg = els.chart6.svg;
      clearSvg(svg);
      if (!reprice.ok) return;
      var plantLife = params.plantLife;
      var priceByYear = [];
      var rateBaseByYear = [];
      for (var t = 1; t <= plantLife; t++) {
        var block = reprice.blocks[Math.floor((t - 1) / 3)];
        priceByYear.push(block.price);
        rateBaseByYear.push(reprice.openingRateBaseByYear[t] / 1e7);
      }
      var yMax = Math.max.apply(null, priceByYear) * 1.15;
      var xScale = scaleLinear([1, plantLife], [MARGIN.left, MARGIN.left + PLOT_W]);
      var yScale = scaleLinear([0, yMax], [MARGIN.top + PLOT_H, MARGIN.top]);
      drawAxes(svg, xScale, [1, plantLife], yScale, [0, yMax], 'Year', 'Contract price (Rs/kg)',
        function (v) { return v.toFixed(0); }, function (v) { return v.toFixed(0); });

      var stepPts = [];
      for (var i = 0; i < priceByYear.length; i++) {
        stepPts.push([i + 1, priceByYear[i]]);
        stepPts.push([i + 2, priceByYear[i]]);
      }
      svg.appendChild(svgEl('path', { d: pointsToPath(stepPts, xScale, yScale), fill: 'none', stroke: COLORS[0], 'stroke-width': '2' }));

      var rbMax = Math.max.apply(null, rateBaseByYear) || 1;
      var yScale2 = scaleLinear([0, rbMax * 1.15], [MARGIN.top + PLOT_H, MARGIN.top]);
      var rbPts = rateBaseByYear.map(function (v, i) { return [i + 1, v]; });
      svg.appendChild(svgEl('path', { d: pointsToPath(rbPts, xScale, yScale2), fill: 'none', stroke: COLORS[1], 'stroke-width': '2', 'stroke-dasharray': '5 3' }));

      fillTable(els.chart6.table, ['Year', 'Contract price (Rs/kg)', 'Opening rate base (Rs cr)'],
        priceByYear.map(function (p, i) { return [i + 1, p.toFixed(1), rateBaseByYear[i].toFixed(2)]; }));
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
