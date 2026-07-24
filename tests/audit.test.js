/**
 * tests/audit.test.js
 *
 * Unit tests for lib/audit.js. axios is mocked so these tests are fast,
 * deterministic, and don't depend on the network.
 */

jest.mock('axios');
const axios = require('axios');
const { auditPage, parseHtml, AuditError } = require('../lib/audit');

function makeAxiosResponse({ status = 200, contentType = 'text/html; charset=utf-8', data = '' }) {
  return {
    status,
    headers: { 'content-type': contentType },
    data,
  };
}

describe('parseHtml (pure parsing logic)', () => {
  test('extracts title, meta description, h1 count, alt-missing images, and word count', () => {
    const html = `
      <html>
        <head>
          <title>  My Test Page  </title>
          <meta name="description" content="A page about testing." />
        </head>
        <body>
          <h1>Welcome</h1>
          <h1>Second H1</h1>
          <img src="a.png" alt="a nice photo" />
          <img src="b.png" alt="" />
          <img src="c.png" />
          <p>Hello world this is some body text for counting words.</p>
        </body>
      </html>
    `;
    const result = parseHtml(html);

    expect(result.title).toBe('My Test Page');
    expect(result.metaDescription).toBe('A page about testing.');
    expect(result.h1Count).toBe(2);
    expect(result.imageCount).toBe(3);
    expect(result.imagesMissingAlt).toBe(2); // empty alt + missing alt
    expect(result.wordCount).toBeGreaterThanOrEqual(9);
  });

  test('returns null title/description when absent, without throwing', () => {
    const html = '<html><body><p>No head tags here.</p></body></html>';
    const result = parseHtml(html);
    expect(result.title).toBeNull();
    expect(result.metaDescription).toBeNull();
    expect(result.h1Count).toBe(0);
  });
});

describe('auditPage — happy path', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns a complete report for a valid HTML page', async () => {
    axios.get.mockResolvedValueOnce(
      makeAxiosResponse({
        status: 200,
        data: `
          <html>
            <head><title>Example Domain</title>
            <meta name="description" content="Example description" /></head>
            <body><h1>Example</h1><img src="x.png" alt="x" /></body>
          </html>
        `,
      })
    );

    const report = await auditPage('https://example.com');

    expect(report.url).toBe('https://example.com/');
    expect(report.httpStatus).toBe(200);
    expect(typeof report.responseTimeMs).toBe('number');
    expect(report.title).toBe('Example Domain');
    expect(report.metaDescription).toBe('Example description');
    expect(report.h1Count).toBe(1);
    expect(report.imagesMissingAlt).toBe(0);
    expect(report.wordCount).toBeGreaterThan(0);
  });
});

describe('auditPage — failure case: invalid URL', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects with AuditError(INVALID_URL) for a malformed URL, without calling axios', async () => {
    await expect(auditPage('not a url')).rejects.toThrow(AuditError);
    await expect(auditPage('not a url')).rejects.toMatchObject({ code: 'INVALID_URL', statusCode: 400 });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('rejects non-http(s) protocols such as ftp://', async () => {
    await expect(auditPage('ftp://example.com/file.txt')).rejects.toMatchObject({
      code: 'INVALID_URL',
      statusCode: 400,
    });
  });

  test('rejects empty/missing input', async () => {
    await expect(auditPage('')).rejects.toMatchObject({ code: 'INVALID_URL', statusCode: 400 });
    await expect(auditPage(undefined)).rejects.toMatchObject({ code: 'INVALID_URL', statusCode: 400 });
  });
});

describe('auditPage — failure case: non-HTML response', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects with AuditError(NOT_HTML) when content-type is not text/html', async () => {
    axios.get.mockResolvedValueOnce(
      makeAxiosResponse({ status: 200, contentType: 'application/json', data: '{"ok":true}' })
    );

    await expect(auditPage('https://api.example.com/data.json')).rejects.toMatchObject({
      code: 'NOT_HTML',
      statusCode: 415,
    });
  });
});

describe('auditPage — failure case: timeout', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects with AuditError(TIMEOUT) when the request times out', async () => {
    const timeoutErr = new Error('timeout of 8000ms exceeded');
    timeoutErr.code = 'ECONNABORTED';
    axios.get.mockRejectedValueOnce(timeoutErr);

    await expect(auditPage('https://slow.example.com')).rejects.toMatchObject({
      code: 'TIMEOUT',
      statusCode: 504,
    });
  });
});

describe('auditPage — failure case: DNS / unreachable host', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects with AuditError(DNS_ERROR) when the host cannot be resolved', async () => {
    const dnsErr = new Error('getaddrinfo ENOTFOUND doesnotexist.invalid');
    dnsErr.code = 'ENOTFOUND';
    axios.get.mockRejectedValueOnce(dnsErr);

    await expect(auditPage('https://doesnotexist.invalid')).rejects.toMatchObject({
      code: 'DNS_ERROR',
      statusCode: 502,
    });
  });
});
