/**
 * lib/audit.js
 *
 * Core logic for Page Pulse. Kept separate from server.js so it can be
 * unit-tested without spinning up an HTTP server (see tests/audit.test.js).
 */

const axios = require('axios');
const cheerio = require('cheerio');

const REQUEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'PagePulse/1.0 (+https://digitalheroesco.com)';

/**
 * Custom error class so the route layer can map failures to the right
 * HTTP status code instead of guessing from generic Error messages.
 */
class AuditError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'AuditError';
    this.code = code; // machine-readable identifier, e.g. "INVALID_URL"
    this.statusCode = statusCode; // HTTP status to send back to the client
  }
}

/**
 * Validates that a string is a well-formed, fetchable http(s) URL.
 * Throws AuditError (400) if not.
 */
function validateUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    throw new AuditError('INVALID_URL', 'A non-empty "url" string is required.', 400);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (e) {
    throw new AuditError('INVALID_URL', `"${rawUrl}" is not a valid URL.`, 400);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AuditError(
      'INVALID_URL',
      `Unsupported protocol "${parsed.protocol}". Only http and https are allowed.`,
      400
    );
  }

  return parsed.toString();
}

/**
 * Fetches a URL and returns { response, elapsedMs }.
 * Maps axios/network failures into AuditError with sensible status codes.
 */
async function fetchPage(url) {
  const startedAt = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      responseType: 'text',
      // Accept any status < 500 so we can still report on 4xx pages
      // instead of throwing away useful info (e.g. auditing a 404 page).
      validateStatus: (status) => status < 500,
      headers: { 'User-Agent': USER_AGENT },
    });
    const elapsedMs = Date.now() - startedAt;
    return { response, elapsedMs };
  } catch (err) {
    if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
      throw new AuditError('TIMEOUT', `The request to ${url} timed out after ${REQUEST_TIMEOUT_MS}ms.`, 504);
    }
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      throw new AuditError('DNS_ERROR', `Could not resolve host for ${url}.`, 502);
    }
    if (err.code === 'ECONNREFUSED') {
      throw new AuditError('CONNECTION_REFUSED', `Connection refused by ${url}.`, 502);
    }
    if (err.response) {
      // Server responded with 5xx (validateStatus lets <500 through already)
      throw new AuditError(
        'UPSTREAM_ERROR',
        `Upstream server responded with status ${err.response.status}.`,
        502
      );
    }
    throw new AuditError('FETCH_FAILED', `Failed to fetch ${url}: ${err.message}`, 502);
  }
}

/**
 * Parses HTML with cheerio and computes the report metrics.
 */
function parseHtml(html) {
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim() || null;

  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    null;

  const h1Count = $('h1').length;

  const images = $('img');
  let imagesMissingAlt = 0;
  images.each((_, el) => {
    const alt = $(el).attr('alt');
    // Missing alt attribute entirely, OR present but empty/whitespace-only
    // both count as "missing" for accessibility/SEO purposes -- an
    // explicitly empty alt="" is only meaningful for decorative images,
    // which we can't distinguish here, so we flag it and let the human decide.
    if (alt === undefined || alt.trim() === '') {
      imagesMissingAlt += 1;
    }
  });

  // Approximate word count: strip script/style (non-visible content),
  // grab visible text, split on whitespace.
  $('script, style, noscript').remove();
  const bodyText = $('body').text() || $.root().text();
  const words = bodyText
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);

  return {
    title,
    metaDescription,
    h1Count,
    imageCount: images.length,
    imagesMissingAlt,
    wordCount: words.length,
  };
}

/**
 * Main entry point: validate -> fetch -> parse -> assemble report.
 * Throws AuditError on any failure; callers (routes, tests) handle it.
 */
async function auditPage(rawUrl) {
  const url = validateUrl(rawUrl);
  const { response, elapsedMs } = await fetchPage(url);

  const contentType = String(response.headers?.['content-type'] || '');
  if (!contentType.includes('text/html')) {
    throw new AuditError(
      'NOT_HTML',
      `Response from ${url} has content-type "${contentType || 'unknown'}", expected text/html.`,
      415
    );
  }

  const parsed = parseHtml(response.data || '');

  return {
    url,
    httpStatus: response.status,
    responseTimeMs: elapsedMs,
    ...parsed,
  };
}

module.exports = { auditPage, validateUrl, fetchPage, parseHtml, AuditError };
