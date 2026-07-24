/**
 * server.js
 * Page Pulse — a small tool that audits any URL.
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const { auditPage, AuditError } = require('./lib/audit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /api/audit
 * Body:    { "url": "https://example.com" }
 * Success: 200 { "url", "httpStatus", "responseTimeMs", "title",
 *                "metaDescription", "h1Count", "imageCount",
 *                "imagesMissingAlt", "wordCount" }
 * Failure: { "error": { "code", "message" } } with an appropriate status
 *          (400 invalid input, 415 non-HTML, 502 upstream/network, 504 timeout)
 */
app.post('/api/audit', async (req, res) => {
  const { url } = req.body || {};

  try {
    const report = await auditPage(url);
    return res.status(200).json(report);
  } catch (err) {
    if (err instanceof AuditError) {
      return res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    }
    // Anything unexpected: never crash the process, never leak stack traces.
    console.error('Unexpected error in /api/audit:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong while auditing that URL.' },
    });
  }
});

// Simple health check — handy for uptime monitors and deploy platforms.
app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// Fallback 404 for unknown API routes (keep JSON, not Express's default HTML page).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
});

app.listen(PORT, () => {
  console.log(`Page Pulse running on http://localhost:${PORT}`);
});

module.exports = app; // exported for supertest in future integration tests
