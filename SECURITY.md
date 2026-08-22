# Security policy

This is a static, client-side-only dashboard with a deliberately minimal
attack surface: there is no server, no database, no authentication, and no
user data of any kind ever leaves the browser.

## Attack surface

The **only** attacker-controlled input this application ever reads is the
**URL hash** (everything after `#`). Everything else — `data.js`,
`model.js`, `app.js`, `styles.css` — is a static file shipped with the
repository and served as-is.

### Controls in place

- **Zero runtime network requests.** No CDN, no web fonts, no analytics, no
  telemetry, no external images, no `fetch`/`XMLHttpRequest`/`WebSocket` of
  any kind. `data.js` is loaded via a local `<script src>` tag, which works
  from `file://` (unlike `fetch()` on a local JSON file, which the
  file-scheme CORS restriction blocks). Verify with the Network tab open:
  it should show exactly five local requests (`index.html`, `styles.css`,
  `data.js`, `model.js`, `app.js`) and nothing else.
- **Strict Content-Security-Policy**, set via a `<meta>` tag in
  `index.html`:
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  No `unsafe-inline`, no `unsafe-eval`. (Browsers correctly ignore the
  `frame-ancestors` directive when it is delivered via `<meta>` rather than
  an HTTP header — this is expected and does not weaken the policy in a
  meaningful way for a page with no framing use case; GitHub Pages does not
  allow custom response headers on the free tier, which is why the policy
  is delivered this way.)
- **No `eval`, `new Function`, or string-argument `setTimeout`/`setInterval`**
  anywhere in the codebase.
- **No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write`
  anywhere.** Every DOM node is built with `createElement`/`createElementNS`
  and text is set with `textContent` only. This is the single most
  important control in the app: the URL hash is the one piece of input an
  attacker can fully control (e.g. by getting a victim to click a crafted
  link), and building the DOM exclusively through these APIs means nothing
  parsed from it can ever be interpreted as markup, regardless of its
  contents.
- **Defensive URL-hash parsing** (`app.js`, `decodeParams`/`parseHashString`):
  only a fixed whitelist of known parameter keys is ever read; every value
  is coerced with `Number()`/strict boolean checks, rejected outright on
  `NaN`/`Infinity`, clamped to its documented range, and enum-typed values
  (year, state) are checked against `Object.keys(GDAM_DATA...)`-derived
  whitelists before use. Object keys are never used to dynamically index
  into an object or assign properties — every assignment target comes from
  the fixed `PARAM_SPEC` table, never from the attacker's key string — so
  `__proto__`/`constructor`/`prototype` pollution is structurally
  impossible rather than merely filtered. See `tests/hash.test.js` and
  `tests/fuzz.test.js` (1,000 randomised/adversarial hashes) for the
  automated checks.
- **No persistence of any kind.** No `localStorage`, `sessionStorage`,
  cookies, IndexedDB, or cache API usage. Nothing about a visitor is
  stored, and nothing survives a page reload except what is encoded,
  visibly, in the URL itself.
- **External links** (the Help button, footer links) all carry
  `rel="noopener noreferrer"`, and `<meta name="referrer" content="no-referrer">`
  is set page-wide.

## Reporting a vulnerability

If you find a security issue in this repository, please open a GitHub
issue describing the problem and, if possible, a minimal reproduction
(for a hash-parsing issue, the exact `#...` string is enough). Given the
minimal attack surface described above, most genuine findings will be in
the hash parser or in a DOM-construction path that turns out to use
unsanitised text unsafely — both are straightforward to fix and to add a
regression test for in `tests/`.
