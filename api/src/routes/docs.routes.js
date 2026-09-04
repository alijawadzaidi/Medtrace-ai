'use strict';

const fs = require('node:fs');
const path = require('node:path');

const express = require('express');
const swaggerUiDist = require('swagger-ui-dist');

const router = express.Router();

/**
 * The API reference, served from the generated document.
 *
 * Read from disk per request rather than cached at boot, so regenerating the
 * spec during development shows up on a refresh. The file is small and this
 * route is not on any hot path.
 */
const SPEC_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'openapi.json');

router.get('/docs/openapi.json', (_req, res) => {
  if (!fs.existsSync(SPEC_PATH)) {
    return res.status(503).json({
      error: { message: 'No OpenAPI document. Generate it with: npm run docs:api' },
    });
  }
  return res.type('application/json').send(fs.readFileSync(SPEC_PATH, 'utf8'));
});

/**
 * Swagger UI is served from the installed package, not a CDN.
 *
 * The first version loaded it from unpkg and rendered a blank page: `helmet`
 * sets a Content-Security-Policy of `script-src 'self'`, and the browser
 * refused the script without anything obvious in the console. The fix could
 * have been a CSP exception for one CDN, but serving the bundle locally is
 * better on both counts — the security header stays strict for every route,
 * and the reference works with no internet at all, which matters more on demo
 * day than it sounds.
 */
const SWAGGER_ASSETS = swaggerUiDist.getAbsoluteFSPath();

/**
 * The initialiser is a served file rather than an inline <script>, for the
 * same CSP reason: helmet's default policy forbids inline script, and
 * weakening it for one page is a poor trade for a header protecting every
 * other one. Declared before the static mount so it wins over any file of the
 * same name inside the package.
 */
router.get('/docs/assets/init.js', (_req, res) => {
  res.type('application/javascript').send(`window.ui = SwaggerUIBundle({
  url: '/docs/openapi.json',
  dom_id: '#swagger',
  deepLinking: true,
  docExpansion: 'list',
  defaultModelsExpandDepth: -1,
  persistAuthorization: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  layout: 'BaseLayout',
});`);
});

router.use(
  '/docs/assets',
  express.static(SWAGGER_ASSETS, {
    index: false,
    maxAge: '1d',
    // The bundle ships its own default page that points at the petstore demo.
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
  })
);

router.get('/docs', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MedTrace API reference</title>
    <link rel="stylesheet" href="/docs/assets/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .swagger-ui .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger"></div>
    <script src="/docs/assets/swagger-ui-bundle.js"></script>
    <script src="/docs/assets/swagger-ui-standalone-preset.js"></script>
    <script src="/docs/assets/init.js"></script>
  </body>
</html>`);
});

module.exports = router;
