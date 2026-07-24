# Page Pulse

A small tool that audits any URL: HTTP status, response time, page title, meta
description, H1 count, images missing `alt` text, and approximate word count.

Live demo: **[ADD YOUR DEPLOYED URL HERE]**

---

## Setup

Requirements: Node.js 18+.

```bash
git clone https://github.com/<your-username>/page-pulse.git
cd page-pulse
npm install
npm start          # runs on http://localhost:3000
```

Open `http://localhost:3000` in a browser and paste a URL.

Run tests:

```bash
npm test           # Jest, with coverage
```

---

## API Contract

### `POST /api/audit`

**Request body**

```json
{ "url": "https://example.com" }
```

**Success — `200 OK`**

```json
{
  "url": "https://example.com/",
  "httpStatus": 200,
  "responseTimeMs": 184,
  "title": "Example Domain",
  "metaDescription": "Example description",
  "h1Count": 1,
  "imageCount": 3,
  "imagesMissingAlt": 1,
  "wordCount": 42
}
```

**Failure — error shape (all failure modes use this envelope)**

```json
{ "error": { "code": "TIMEOUT", "message": "The request to https://... timed out after 8000ms." } }
```

| Status | `error.code`          | When it happens                                            |
|--------|-----------------------|-------------------------------------------------------------|
| 400    | `INVALID_URL`         | Missing/empty body, malformed URL, or non-http(s) protocol   |
| 415    | `NOT_HTML`            | Response `content-type` isn't `text/html`                    |
| 502    | `DNS_ERROR`           | Host could not be resolved                                    |
| 502    | `CONNECTION_REFUSED`  | Target server refused the connection                          |
| 502    | `UPSTREAM_ERROR`      | Target server returned a 5xx                                   |
| 502    | `FETCH_FAILED`        | Any other network-level failure                                |
| 504    | `TIMEOUT`             | Request exceeded the 8s timeout                                 |
| 500    | `INTERNAL_ERROR`      | Unexpected server-side error (caught, never crashes the process)|

### `GET /api/health`

Returns `{ "status": "ok" }`. Used for uptime checks / deploy-platform health probes.

---

## Design Decisions

**1. Separated parsing/fetch logic (`lib/audit.js`) from the HTTP layer (`server.js`).**
The Express route only does two things: call `auditPage()` and map the result/error
to an HTTP response. All the actual logic — URL validation, fetching, HTML
parsing — lives in a plain module with no dependency on `req`/`res`. This is
what makes the Task B unit tests possible without spinning up a server or
mocking Express: the tests call `auditPage()` directly and mock `axios`.

**2. A custom `AuditError` class carrying a `code` and `statusCode`, instead of
throwing generic `Error`s or returning `{ok: false}` objects.**
This keeps error handling centralized and exhaustive — the route handler has
one `catch` block that either recognizes an `AuditError` (known, expected
failure — map to its status code) or doesn't (truly unexpected — log it and
return a generic 500, but never let it crash the process). It also makes the
API contract self-documenting: every documented failure mode maps 1:1 to a
`code` in the code itself, not a comment that can drift out of date.

**3. `validateStatus: (status) => status < 500` when fetching, instead of only
accepting 200.**
A URL audit tool's whole purpose includes catching problems — a 404 or 403
page is a valid (if unhappy) thing to audit and report on, not a crash
condition. Only treating 5xx as a genuine upstream failure (mapped to
`UPSTREAM_ERROR`) means a user auditing a broken link gets a real report
(`httpStatus: 404`, plus whatever HTML/title the error page actually has)
instead of an opaque error, which is more useful and mirrors what a human
checking the page in a browser would see.

**Other notable choices, briefly:**
- 8-second timeout: long enough for slow real-world pages, short enough that
  the demo doesn't hang and the tool stays usable as a quick check.
- "Missing alt" counts both a fully absent `alt` attribute and an empty
  `alt=""`. This is a deliberate simplification — `alt=""` is technically
  valid for decorative images — flagged here as a known limitation (see the
  Loom walkthrough) rather than silently guessing intent.
- Word count is approximate by design: it strips `<script>`/`<style>` and
  splits visible body text on whitespace. It will over/undercount for content
  rendered client-side by JS frameworks after the initial HTML load, since
  Page Pulse only reads the raw HTML response (no headless browser).

---

## Known Limitations (things I'd fix with another day)

- No JS rendering — pages that build their content via client-side JS
  (SPAs) will report near-zero word count / missing title, because Page
  Pulse only sees the initial HTML, not the post-render DOM. A headless
  browser (Playwright/Puppeteer) would fix this but adds real latency and
  infra weight.
- `alt=""` vs missing `alt` are currently treated identically; a more
  correct implementation would report them as separate counts and let the
  caller decide what counts as a violation.
- No caching/rate-limiting — repeated audits of the same URL hit it fresh
  every time. Fine for a demo tool, but a public deployment would want basic
  per-IP rate limiting to avoid being used as an open proxy/scanner.

---

## Footer Credit

Per the task's live-build requirement, the deployed page includes a footer
crediting **Digital Heroes Training Task**, linked to
[digitalheroesco.com](https://digitalheroesco.com).
