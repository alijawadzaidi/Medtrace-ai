'use strict';

/**
 * Generates the OpenAPI spec by walking the **live Express router**.
 *
 * A hand-written spec documents the API someone meant to build. This one is
 * read out of the router that is actually mounted, so an endpoint cannot exist
 * without appearing here, and a deleted one cannot linger in the docs. Request
 * bodies come from the same Zod validators the middleware enforces, converted
 * with `z.toJSONSchema`, so the documented shape is the validated shape by
 * construction rather than by discipline.
 *
 * What is still hand-maintained is prose: the one-line summary and the role
 * each route requires. Those live in ROUTE_NOTES below, and any route missing
 * from it is reported at the end rather than silently shipped undescribed.
 *
 * Usage: node scripts/generate-openapi.js [--out ../docs/openapi.json]
 */

const fs = require('node:fs');
const path = require('node:path');

const { z } = require('zod');

const app = require('../src/app');
const { version } = require('../package.json');

const authValidators = require('../src/validators/auth.validators');
const catalogueValidators = require('../src/validators/catalogue.validators');
const shipmentValidators = require('../src/validators/shipment.validators');
const verifyValidators = require('../src/validators/verify.validators');
const alertValidators = require('../src/validators/alert.validators');

/** Prose and access, keyed by "METHOD /path". */
const ROUTE_NOTES = {
  'GET /': { summary: 'Service banner and endpoint index', auth: 'public' },
  'GET /health': { summary: 'Liveness — never touches the database', auth: 'public' },
  'GET /health/ready': { summary: 'Readiness — 503 when the database is unreachable', auth: 'public' },

  'POST /auth/register': { summary: 'Create an account against an organization', auth: 'public', body: authValidators.registerSchema },
  'POST /auth/login': { summary: 'Exchange credentials for a JWT', auth: 'public', body: authValidators.loginSchema },
  'GET /auth/me': { summary: 'The signed-in user and their organization', auth: 'any role' },
  'PATCH /auth/me': { summary: 'Update your own name or password', auth: 'any role', body: authValidators.updateMeSchema },

  'GET /organizations': { summary: 'Your own organization; regulators see all', auth: 'any role' },
  'GET /organizations/partners': { summary: 'Who the custody rules let you ship to', auth: 'any role' },
  'GET /organizations/:id': { summary: 'One organization; 403 across organizations', auth: 'any role' },

  'GET /medicines': { summary: 'Your catalogue; regulators see all', auth: 'any role' },
  'GET /medicines/:id': { summary: 'One product', auth: 'any role' },
  'POST /medicines': { summary: 'Register a product', auth: 'manufacturer', body: catalogueValidators.createMedicineSchema },
  'PATCH /medicines/:id': { summary: 'Update your own product', auth: 'manufacturer', body: catalogueValidators.updateMedicineSchema },
  'DELETE /medicines/:id': { summary: 'Deactivate a product — never deletes', auth: 'manufacturer' },

  'GET /batches': { summary: 'Your batches; regulators see all', auth: 'any role' },
  'GET /batches/:id': { summary: 'Batch detail with pack completeness', auth: 'any role' },
  'GET /batches/:id/packs': { summary: 'Paginated serial list', auth: 'any role' },
  'GET /batches/:id/labels': { summary: 'Print-ready label sheet (HTML)', auth: 'any role' },
  'POST /batches': { summary: 'Create a batch and every one of its packs, atomically', auth: 'manufacturer', body: catalogueValidators.createBatchSchema },
  'POST /batches/:id/recall': { summary: 'Recall a batch and every pack in it', auth: 'regulator', body: catalogueValidators.recallSchema },

  'GET /packs/:serial': { summary: 'Pack detail — your own or ones you hold', auth: 'any role' },
  'GET /packs/:serial/qr.png': { summary: 'QR image, rendered on demand', auth: 'any role' },
  'GET /packs/:serial/history': { summary: 'Full chain of custody', auth: 'any role' },
  'POST /packs/:serial/dispense': { summary: 'Terminal step — hand the pack to a patient', auth: 'pharmacy' },

  'GET /shipments': { summary: 'Your inbound and outbound shipments', auth: 'any role' },
  'GET /shipments/:id': { summary: 'Shipment detail with its packs', auth: 'any role' },
  'POST /shipments': { summary: 'Create a draft shipment', auth: 'manufacturer, distributor', body: shipmentValidators.createShipmentSchema },
  'POST /shipments/:id/dispatch': { summary: 'Packs leave — state becomes in_transit', auth: 'the sending organization' },
  'POST /shipments/:id/receive': { summary: 'Packs arrive — custody moves', auth: 'the destination organization' },
  'POST /shipments/:id/cancel': { summary: 'Cancel a draft', auth: 'the sending organization' },

  'GET /verify/:serial': { summary: 'Public verification — what a scanned QR code opens', auth: 'none' },
  'POST /verify': { summary: 'Public verification with browser-granted coordinates', auth: 'none', body: verifyValidators.verifySchema },
  'GET /verify/:serial/qr.png': { summary: 'QR image for a printed label', auth: 'none' },

  'GET /alerts': { summary: 'Triage queue, worst first', auth: 'regulator' },
  'GET /alerts/:id': { summary: 'One alert with the features behind it', auth: 'regulator' },
  'PATCH /alerts/:id': { summary: 'Confirm, dismiss, or take up an alert', auth: 'regulator', body: alertValidators.triageSchema },
  'POST /detection/run': { summary: 'Score every pack, or one batch', auth: 'regulator', body: alertValidators.runSchema },
  'GET /detection/health': { summary: 'Whether the scoring service is reachable', auth: 'regulator' },

  'GET /audit-logs': { summary: 'Audit trail, filterable by entity and action', auth: 'regulator' },

  'GET /docs': { summary: 'This API reference', auth: 'public' },
  'GET /docs/openapi.json': { summary: 'The OpenAPI document itself', auth: 'public' },
};

/** Walks the mounted router, including routers mounted inside routers. */
function collectRoutes(stack, prefix = '') {
  const routes = [];

  for (const layer of stack) {
    if (layer.route) {
      const routePath = prefix + layer.route.path;
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled && method !== '_all') {
          routes.push({ method: method.toUpperCase(), path: routePath });
        }
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      routes.push(...collectRoutes(layer.handle.stack, prefix));
    }
  }

  return routes;
}

/** Express ':serial' -> OpenAPI '{serial}'. */
function toOpenApiPath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function parametersFor(routePath) {
  const names = [...routePath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: name === 'serial' ? 'A MedTrace pack serial, case and dash insensitive.' : undefined,
  }));
}

function bodyFor(schema) {
  if (!schema) return undefined;
  try {
    return {
      required: true,
      content: { 'application/json': { schema: z.toJSONSchema(schema, { io: 'input' }) } },
    };
  } catch {
    // A validator that cannot be represented as JSON Schema should not stop
    // the whole document being generated.
    return { required: true, content: { 'application/json': { schema: { type: 'object' } } } };
  }
}

function tagFor(routePath) {
  if (routePath.startsWith('/auth')) return 'Authentication';
  if (routePath.startsWith('/organizations')) return 'Organizations';
  if (routePath.startsWith('/medicines') || routePath.startsWith('/batches') || routePath.startsWith('/packs')) return 'Catalogue';
  if (routePath.startsWith('/shipments')) return 'Custody';
  if (routePath.startsWith('/verify')) return 'Public verification';
  if (routePath.startsWith('/alerts') || routePath.startsWith('/detection')) return 'Detection';
  if (routePath.startsWith('/audit-logs')) return 'Audit';
  if (routePath.startsWith('/health')) return 'Operations';
  return 'General';
}

function main() {
  const outIndex = process.argv.indexOf('--out');
  const out =
    outIndex > -1
      ? path.resolve(process.argv[outIndex + 1])
      : path.join(__dirname, '..', '..', 'docs', 'openapi.json');

  const stack = app._router?.stack || app.router?.stack;
  if (!stack) throw new Error('Could not read the Express router stack.');

  const routes = collectRoutes(stack)
    .filter((r) => !r.path.includes('*'))
    // Swagger UI's own static assets are how the reference is rendered, not
    // part of the API it describes.
    .filter((r) => !r.path.startsWith('/docs/assets'));
  const paths = {};
  const undocumented = [];

  for (const route of routes.sort((a, b) => a.path.localeCompare(b.path))) {
    const key = `${route.method} ${route.path}`;
    const notes = ROUTE_NOTES[key];
    if (!notes) undocumented.push(key);

    const openApiPath = toOpenApiPath(route.path);
    paths[openApiPath] = paths[openApiPath] || {};

    const isPublic = notes?.auth === 'public' || notes?.auth === 'none';

    paths[openApiPath][route.method.toLowerCase()] = {
      tags: [tagFor(route.path)],
      summary: notes?.summary || 'Undocumented',
      description: notes ? `**Access:** ${notes.auth}` : undefined,
      security: isPublic ? [] : [{ bearerAuth: [] }],
      parameters: parametersFor(route.path),
      requestBody: bodyFor(notes?.body),
      responses: {
        200: { description: 'Success' },
        ...(route.method === 'POST' ? { 201: { description: 'Created' } } : {}),
        400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        ...(isPublic
          ? {}
          : {
              401: { description: 'No or invalid token' },
              403: { description: 'Wrong role, or another organization\'s record' },
            }),
        404: { description: 'Not found — also returned for records outside your organization' },
      },
    };
  }

  const document = {
    openapi: '3.1.0',
    info: {
      title: 'MedTrace AI API',
      version,
      description: [
        'Medicine traceability with per-pack serialization.',
        '',
        'Two things are worth knowing before reading the endpoints:',
        '',
        '- **`/verify` needs no account, ever.** A customer holding a box is the last',
        '  line of defence against a counterfeit, and any friction means they will not',
        '  check. An unknown serial returns `200` with a `counterfeit` verdict rather',
        '  than a `404`, because a 404 tells a counterfeiter which guesses were closer.',
        '- **A `404` often means "not yours".** Record lookups are organization-scoped,',
        '  so another company\'s batch is indistinguishable from one that does not',
        '  exist. A `403` would confirm it is real and let a competitor map the',
        '  catalogue by walking ids.',
        '',
        'This document is generated from the live Express router by',
        '`api/scripts/generate-openapi.js`; request bodies come from the same Zod',
        'validators the middleware enforces.',
      ].join('\n'),
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
    tags: [
      { name: 'Public verification', description: 'Unauthenticated. The only surface a customer touches.' },
      { name: 'Authentication', description: 'Staff identity and JWTs.' },
      { name: 'Organizations', description: 'Scoping: which distributor, not a distributor.' },
      { name: 'Catalogue', description: 'Medicines, batches, and per-pack serials.' },
      { name: 'Custody', description: 'Shipments and the chain-of-custody state machine.' },
      { name: 'Detection', description: 'Rules, the model, and the regulator triage queue.' },
      { name: 'Audit', description: 'Every write, attributed.' },
      { name: 'Operations', description: 'Liveness and readiness.' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                details: { type: 'array', items: { type: 'object' } },
              },
              required: ['message'],
            },
          },
        },
      },
    },
    paths,
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);

  console.log(`Wrote ${out}`);
  console.log(`  ${routes.length} routes across ${Object.keys(paths).length} paths`);

  if (undocumented.length) {
    console.log(`\n  ${undocumented.length} route(s) with no entry in ROUTE_NOTES:`);
    for (const key of undocumented) console.log(`    ${key}`);
  }
}

main();
