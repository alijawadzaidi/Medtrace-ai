# MedTrace API

Express + Sequelize backend for MedTrace AI.

## Setup

```bash
npm install
cp .env.example .env
npm run db:reset   # undo seeds + migrations -> migrate -> seed
npm run dev
```

Then: <http://localhost:4000/health>

## Scripts

| Script                | Does                                       |
| --------------------- | ------------------------------------------ |
| `npm run dev`         | nodemon, reloads on change                 |
| `npm start`           | plain node                                 |
| `npm run lint`        | ESLint (flat config)                       |
| `npm run db:migrate`  | apply pending migrations                   |
| `npm run db:seed`     | insert demo organizations, users, catalogue and a supply chain |
| `npm run db:reset`    | rebuild the database from scratch          |
| `npm test`            | Jest + supertest integration suite          |
| `npm run test:coverage` | the same, with a coverage report          |
| `npm run docs`        | regenerate the ER diagram and OpenAPI spec  |

`db:reset` undoes **seeders first**, then migrations. Seeder runs are tracked in
`sequelize_seeds`, and that table is not owned by any migration — so undoing
only the migrations left the tracking rows behind and `db:seed:all` then
reported "No seeders found" against an empty database.

## Database

SQLite is the default so a fresh clone runs with no database server installed.
MySQL is the deployment target; migrations use only the portable subset both
dialects share, so switching is a config change.

To switch to MySQL, install a server, create the schema, then in `.env`:

```
DB_DIALECT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=medtrace
DB_USER=root
DB_PASSWORD=your-password
```

```sql
CREATE DATABASE medtrace CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Then `npm run db:reset`. No application code changes.

## Endpoints

| Method | Path                 | Auth      | Description                            |
| ------ | -------------------- | --------- | -------------------------------------- |
| GET    | `/`                  | public    | Service banner                         |
| GET    | `/docs`              | public    | **Swagger UI API reference**           |
| GET    | `/docs/openapi.json` | public    | The OpenAPI 3.1 document               |
| GET    | `/health`            | public    | Liveness — never touches the database  |
| GET    | `/health/ready`      | public    | Readiness — 503 if the database is down |
| POST   | `/auth/register`     | public    | Create an account against an organization |
| POST   | `/auth/login`        | public    | Exchange credentials for a JWT         |
| GET    | `/auth/me`           | any role  | Current user and organization          |
| PATCH  | `/auth/me`           | any role  | Update own name or password            |
| GET    | `/organizations`     | any role  | Own organization; regulators see all   |
| GET    | `/organizations/partners` | any role | Who you may legally ship to |
| GET    | `/organizations/:id` | any role  | 403 across organizations, except regulators |
| GET    | `/audit-logs`        | regulator | Audit trail, filterable by entity and action |
| GET    | `/alerts`            | regulator | Triage queue, worst first              |
| PATCH  | `/alerts/:id`        | regulator | Confirm, dismiss, or take up an alert  |
| POST   | `/detection/run`     | regulator | Score every pack, or one batch         |
| GET    | `/detection/health`  | regulator | Is the model reachable                 |
| GET    | `/medicines`         | any role  | Own catalogue; regulators see all      |
| POST   | `/medicines`         | manufacturer | Register a product                  |
| PATCH  | `/medicines/:id`     | manufacturer | Update own product                  |
| DELETE | `/medicines/:id`     | manufacturer | Deactivate (never deletes)          |
| POST   | `/batches`           | manufacturer | Create a batch **and all its packs** |
| GET    | `/batches`           | any role  | Own batches; regulators see all        |
| GET    | `/batches/:id`       | any role  | Batch detail with pack completeness    |
| GET    | `/batches/:id/packs` | any role  | Paginated serial list                  |
| GET    | `/batches/:id/labels`| any role  | **Print-ready label sheet (HTML)**     |
| POST   | `/batches/:id/recall`| regulator | Recall a batch                         |
| GET    | `/packs/:serial`     | any role  | Pack detail (own or held packs only)   |
| GET    | `/packs/:serial/qr.png` | any role | QR image, rendered on demand        |
| GET    | `/packs/:serial/history` | any role | Full chain of custody               |
| POST   | `/packs/:serial/dispense` | pharmacy | Terminal step — hand to a patient  |
| GET    | `/shipments`         | any role  | Own inbound + outbound; regulators all |
| GET    | `/shipments/:id`     | any role  | Shipment detail with its packs         |
| POST   | `/shipments`         | manufacturer, distributor | Create a draft         |
| POST   | `/shipments/:id/dispatch` | sender | Packs leave — state `in_transit`  |
| POST   | `/shipments/:id/receive` | destination | Packs arrive — custody moves  |
| POST   | `/shipments/:id/cancel` | sender  | Draft only                          |
| GET    | `/verify/:serial`    | **none** | Public verification — what a QR scan opens |
| POST   | `/verify`            | **none** | Same, with browser-granted coordinates |
| GET    | `/verify/:serial/qr.png` | **none** | QR image for a printed label       |

### RBAC matrix

| Endpoint             | manufacturer | distributor | pharmacy | regulator |
| -------------------- | ------------ | ----------- | -------- | --------- |
| `GET /auth/me`       | own          | own         | own      | own       |
| `PATCH /auth/me`     | own          | own         | own      | own       |
| `GET /organizations` | own org      | own org     | own org  | **all**   |
| `GET /audit-logs`    | —            | —           | —        | **yes**   |

Regulators are the deliberate exception to organization scoping — oversight is
their entire purpose. Everyone else is confined to their own organization by
`scopeToOrganization` / `assertCanAccessOrganization` in `middleware/auth.js`.

## Demo data has a past

The supply-chain seeder backdates everything it creates: packs are manufactured
six weeks ago, move through a distributor, and sit on a pharmacy shelf for a
week before anyone scans them.

That is not decoration. The anomaly rules compare *implied speed* between
consecutive events, so data born the moment `db:seed` runs makes every pack
look cloned — a box manufactured in Mumbai ninety seconds ago cannot legally be
in a customer's hand anywhere else, and every scan comes back `suspect`. With a
backdated history the same scan reads `genuine`, and a genuinely impossible
journey stands out against it.

The seeder writes rows directly rather than calling the services, because the
whole point is to control `created_at`, and it runs in a single transaction:
it writes to six tables in dependency order, and a seeder that fails halfway is
never recorded as having run, so its `down` never cleans up — the orphans then
block every later revert with a foreign-key error.

## Demo accounts

Seeded by `npm run db:seed`. Password for all of them: `MedTrace#2026`

| Email                        | Role         | Organization                   |
| ---------------------------- | ------------ | ------------------------------ |
| `maker@meridian.example`     | manufacturer | Meridian Pharmaceuticals (Mumbai) |
| `ops@northgate.example`      | distributor  | Northgate Medical (Delhi)      |
| `ops@coastal.example`        | distributor  | Coastal Health (Bengaluru)     |
| `desk@lotus.example`         | pharmacy     | Lotus Pharmacy (Delhi)         |
| `desk@greenleaf.example`     | pharmacy     | Greenleaf Chemists (Bengaluru) |
| `inspector@cdsco.example`    | regulator    | CDSCO (New Delhi)              |

```bash
TOKEN=$(curl -s -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"inspector@cdsco.example","password":"MedTrace#2026"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s localhost:4000/organizations -H "Authorization: Bearer $TOKEN"
```

## Shipping partners

Organization scoping says a distributor sees only itself, which is right for
records and impossible for shipping: you cannot address a shipment to an
organization you are not allowed to know exists. `GET /organizations/partners`
is that directory, deliberately narrow in two ways. It returns only the *types*
the custody rules permit as a destination — so a pharmacy, which may not
dispatch at all, gets an empty list — and only what an address label needs:
name, type, city. Never licence numbers, coordinates, or counts of anything.

## Public verification

`/verify` is the only unauthenticated surface in the system, and deliberately
so. A customer holding a box is the last line of defence against a counterfeit,
and any friction between them and an answer means they will not check. No
account, no app: the QR opens a page, the page shows a verdict.

```bash
curl -s localhost:4000/verify/MT-7K2M9P-XQ4T8HRW2VNB4
```

Three rules shape the response.

- **The catalogue never leaks.** The reply describes *this* serial and where it
  has been. It never reveals how many packs exist, what other serials look
  like, or any staff-only field.
- **An unknown serial is an answer, not an error.** It returns `200` with a
  `counterfeit` verdict. A `404` would tell a counterfeiter which guesses were
  closer and tell a worried customer nothing.
- **Every scan is evidence.** Each call appends a `verified` scan event with no
  organization and no user — an absence that is itself a feature the detector
  reads. Responses are `Cache-Control: no-store`; caching them would erase the
  duplicate-scan signal the whole project rests on.

### What earlier scans establish

A verdict is not computed from the scan in front of it alone. A pack with a
standing "seen in two places at once" finding used to read *Genuine* to the
next customer, because their own scan looked ordinary — the clone had been
detected, recorded, and then not mentioned to the one person holding the box.

Which findings are allowed to speak to the public is a deliberate split, and
the measured precision is the reason:

- **Deterministic rules warn immediately**, triaged or not. They run at 1.00
  precision and each states a physical contradiction anyone can check.
  Waiting for triage would mean telling customers a known-cloned pack is fine
  for as long as the queue is.
- **The model waits to be confirmed by a regulator.** It runs at 0.60
  precision, so two in five of its flags are honest packs. Telling those
  customers their medicine is counterfeit, on an unreviewed machine score,
  would do more harm than the frauds it catches.

Public wording is rewritten for the person holding the box: no serials, no
speeds, no internal rule names.

### Verdicts

Reported worst-first: the first that applies wins.

| Verdict | Severity | Means |
| ------- | -------- | ----- |
| `counterfeit` | critical | Malformed serial, or no pack carries it |
| `recalled`    | critical | Genuine pack, batch withdrawn by the regulator |
| `suspect`     | critical | Registered, but the scan history is not physically possible |
| `expired`     | warning  | Genuine, past its expiry date |
| `dispensed`   | warning  | Already handed to a patient — a sealed box scanning this way is a copied label |
| `genuine`     | ok       | Registered, in date, journey intact |

### Rules that run on every scan

The Isolation Forest in Phase 6 scores subtler patterns but cannot explain
itself. *"This pack moved 1,400 km in 20 minutes"* is an answer a customer, a
pharmacist and an examiner all understand, and it costs one query.

| Code | Severity | Trigger |
| ---- | -------- | ------- |
| `impossible_travel` | critical | Implied velocity above 900 km/h over more than 100 km |
| `scan_storm`        | warning  | 25+ verifications of one pack — a label photographed and reprinted |
| `already_dispensed` | warning  | The pack is already recorded as dispensed |

### Location and privacy

Coordinates come from the browser when the customer grants permission, and from
CDN headers otherwise. Both are rounded to two decimal places (~1.1 km) before
storage, and the IP address is truncated to its network (`/24` for IPv4, `/48`
for IPv6). That keeps every feature the detector needs — implied travel speed,
distinct regions, repeat-origin grouping — and discards everything that would
turn `scan_events` into a log of who scanned what. Public scans write no audit
row: the scan event *is* the record, and the audit table is for staff actions.

### Anti-abuse

Two different abuses need two different defences:

- **Enumeration.** 60 bits of serial randomness already makes guessing
  hopeless; a 30-request-per-minute per-IP limit makes it pointless. The check
  character rejects a typo or a guess *before* the database is touched.
- **Scan-count inflation.** Hammering a real serial to trip the scan-storm rule
  and bury a genuine pack in false alerts. Repeat scans of one serial from one
  network inside 10 minutes are answered but recorded once — otherwise a
  customer refreshing the page trains the detector on an artefact of the UI.

  With one exception: a repeat from **more than 25 km away** is always
  recorded. That is not a refresh, it is the precise evidence this system
  exists to capture.

## Serialization

Every **pack** gets its own serial, not every batch. If ten thousand packs
shared one code, photographing one real box would let anyone print ten thousand
valid fakes, and duplicate-scan detection would be meaningless — thousands of
honest customers scanning the same code is expected traffic. At pack level, a
duplicate scan is evidence of a clone.

```
MT-7K2M9P-XQ4T8HRW2VNB4
   ^batch  ^random     ^check
```

- **Unguessable.** 12 random characters (~60 bits). Sequential serials would
  let anyone enumerate the catalogue and print plausible labels.
- **Unambiguous.** Crockford base32 omits I, L, O and U, so there is no 1/I or
  0/O confusion when a human reads a scuffed label. Lookups normalise
  lowercase and those look-alikes automatically.
- **Self-checking.** The trailing character rejects most typos before the
  database is touched — which matters once public verification is exposed.

QR codes are **rendered on demand** from the serial, never stored. Storing a
PNG per pack would be thousands of files that add nothing.

The QR encodes a *verification URL*, not JSON: any phone camera opens it with
no app install, and keeping batch details server-side means a fabricated code
fails on lookup instead of looking plausible offline.

### Batch creation is atomic

`POST /batches` writes the batch and every pack in one transaction. A batch
holding half its packs would be silently wrong in a way nobody notices until
the counts stop matching. A batch is capped at **5000 packs**; 5000 generate in
well under a tenth of a second.

## Chain of custody

Custody is a state machine, enforced on every movement. It is the cheapest
effective anti-counterfeit control in the system: without it a pack can appear
at a pharmacy having never left the factory, and the record looks ordinary.

```
created ──► in_transit ──► received ──┬──► dispensed   (terminal)
                              ▲       ├──► destroyed   (terminal)
                              └───────┘  (forwarded onward)
```

Shipping routes are constrained by organization type as well:

| From         | May ship to              |
| ------------ | ------------------------ |
| manufacturer | distributor, pharmacy    |
| distributor  | distributor, pharmacy    |
| pharmacy     | — (may not dispatch)     |
| regulator    | — (observes only)        |

Enforced on every transfer: only the current holder may dispatch; only the
named destination may receive; a pack cannot sit on two open shipments; packs
from a recalled batch cannot move; expired packs cannot be dispensed.

## Scan events

`scan_events` is append-only — never updated, never deleted — and does three
jobs at once:

1. the chain-of-custody trail a regulator inspects
2. the history a customer sees after scanning a QR code (Phase 4)
3. the feature source the anomaly detector trains on (Phase 6)

Every event carries coordinates, taken from the acting organization, because
implied travel speed between consecutive events is the strongest single signal
that a serial has been cloned.

```
created     Meridian Pharmaceuticals   Mumbai      19.076, 72.878
dispatched  Meridian Pharmaceuticals   Mumbai      19.076, 72.878
received    Northgate Medical          Delhi       28.614, 77.209
dispatched  Northgate Medical          Delhi       28.614, 77.209
received    Lotus Pharmacy             Delhi       28.535, 77.391
dispensed   Lotus Pharmacy             Delhi       28.535, 77.391
```

Movements are bulk operations: a 2000-pack shipment writes 2000 scan events
and updates 2000 packs in roughly 50 ms, and produces **one** audit row rather
than 2000.

## Documentation is generated, not written

```bash
npm run docs        # -> ../docs/erd.md and ../docs/openapi.json
```

Both artifacts are read out of the running system, because the hand-written
versions are wrong within a week — someone adds a column or an endpoint, and
the document in the report keeps describing week three.

- **`docs/erd.md`** is built from the live schema (`queryInterface.describeTable`)
  with relationships taken from the model associations, and rendered as Mermaid
  so GitHub displays it inline.
- **`docs/openapi.json`** is built by walking the mounted Express router, so an
  endpoint cannot exist without appearing in it. Request bodies are converted
  from the same Zod validators the middleware enforces, so the documented shape
  *is* the validated shape. Any route with no prose entry is reported by the
  generator rather than silently shipped undescribed.

Swagger UI at `/docs` is served from the installed package rather than a CDN.
The first version loaded it from unpkg and rendered a blank page, because
`helmet` sets `script-src 'self'` and the browser refused the script. Serving
it locally keeps the header strict for every route *and* means the reference
works with no internet — which matters more on demo day than it sounds.

## Tests

```bash
npm test
```

59 tests across five suites, run against SQLite in a database of their own,
built from the **real migrations** rather than `sequelize.sync()` — syncing
models would test a schema the deployment never sees, and a migration that no
longer applies cleanly is exactly the failure worth catching.

| Area | What it pins down |
| ---- | ----------------- |
| `auth.test.js` | A wrong password and an unknown email are indistinguishable; a deactivated account stops working immediately rather than at token expiry; scoping means *which* distributor, not *a* distributor |
| `catalogue.test.js` | A failed batch creation leaves no orphaned packs; the check character rejects a typo without a query; another manufacturer's batch is a 404, never a 403 |
| `custody.test.js` | Only the holder dispatches and only the destination receives; a pack cannot sit on two open shipments; recalled and expired stock cannot move; 40 packs produce one audit row, not eighty |
| `verify.test.js` | An unknown serial is a 200 with a verdict, never a 404; a refresh does not inflate `scan_count` but a scan 1,100 km away always counts; coordinates are stored at ~1.1 km and addresses truncated |
| `detection.test.js` | Rules fire with **no scoring service running**; one cloned pack produces one alert however often it is re-scanned; alerts stay closed to everyone but a regulator |

Coverage: 82% of statements, 85% of lines.

| | statements | lines |
| --- | --- | --- |
| `src/models` | 93% | 95% |
| `src/routes` | 93% | 93% |
| `src/services` | 87% | 90% |
| `src/middleware` | 71% | 74% |
| `src/controllers` | 61% | 67% |

The suite runs with the Python scorer deliberately unreachable. That is not a
limitation of the test environment — it is the case worth asserting, because
the service is stateless precisely so that its absence degrades one feature
instead of taking the system down.

## Detection

Two things write into `alerts`, and keeping them in one table is what makes the
comparison in the report possible.

**Deterministic rules** catch what is definitionally wrong. They are cheap, and
every alert they raise explains itself: *"this pack moved 1,400 km in 20
minutes"* is an answer a customer, a pharmacist and an examiner all understand,
where *"anomaly score 0.83"* is not.

| Rule | Severity | Fires when |
| ---- | -------- | ---------- |
| `impossible_travel` | critical | Implied velocity above 900 km/h between consecutive scans |
| `dispensed_elsewhere` | critical | A dispensed pack is verified more than 25 km away afterwards |
| `recalled_in_circulation` | critical | A recalled pack is still held in the chain |
| `custody_skip` | warning | A pack is received with no record of anyone dispatching it |
| `expired_stock` | warning | An expired pack is still moving |
| `scan_storm` | warning | Verifications reach 5× the batch median (floor of 5) |

**The model** catches the shapes nobody wrote a rule for. It runs in a separate
stateless Python service (see [`../ai/README.md`](../ai/README.md)) and is
called through `services/scoring.service.js`, which returns `null` — never a
fabricated score — when the service cannot be reached. "No risk score
available" is honest; a made-up 0.5 would end up in an alert a regulator acts
on.

Measured over the simulator's 900 labelled packs, the rules reach 1.00
precision at 0.78 recall, the model 0.60 at 0.70, and together 0.66 at **0.94**
recall. They find different frauds — the model never catches a custody skip,
the rules barely catch grey-market diversion. Full tables in
[`../sim/README.md`](../sim/README.md).

### Features

`services/features.service.js` computes the seven-feature vector, and is the
only place that does. The training export calls the same function, so the
vector a model is trained on and the vector it is scored with cannot drift
apart — a separate training-time implementation is the classic way a model that
evaluated beautifully performs badly in production.

Features travel to the scorer as **named objects, never positional arrays**,
and the request carries a `feature_version`. A reordered array is how a model
quietly starts reading `scan_count` as `days_to_expiry`.

### Alerts are regulator-only

That is a deliberate line, not an oversight. An alert is an accusation about a
specific organization's handling of a specific pack, and the party being
accused must not be the party who can dismiss it — a manufacturer able to close
"recalled stock still in circulation" on its own batch is a detector that
reports whatever the accused prefers.

### One open alert per pack per rule

Detection re-runs constantly: after every public scan, plus the regulator's
sweep. Without deduplication a single cloned pack scanned four hundred times
becomes four hundred identical alerts, and a triage queue nobody can use is the
same as no detector at all. An existing open alert is sharpened instead —
newest score, newest evidence.

### Scoring after a public scan never blocks the customer

A public scan is the moment new evidence arrives, so it is the right trigger.
But the verdict the customer sees comes from the fast in-request checks; the
durable alert is written after the response has already been sent, and a
failure there is logged and swallowed. A detector that can break verification
is worse than no detector.

## Auditing

`db/auditHook.js` registers global `afterCreate` / `afterUpdate` / `afterDestroy`
hooks on the Sequelize instance, so **models added in later phases are audited
with no change to that file**. Each row records the acting user, their
organization, the changed fields (before and after), the client IP and a
request id.

Two properties worth knowing:

- **Passwords are never stored in an audit row.** Any field named
  `password`, `passwordHash` or `token` is written as `[redacted]`.
- **Audit rows join the caller's transaction.** An earlier version wrote them
  on a separate connection so a record would survive a rollback. That
  deadlocked against the very transaction it audited (`SQLITE_BUSY`, plus a
  connection-pool risk on MySQL) and silently dropped every write made inside
  a transaction. Auditing what actually committed is both correct and safe.
- **Audit failures are fatal.** In a traceability system an unauditable write
  is not worth keeping, so a failure rolls the whole operation back.
- **Bulk pack inserts are audited at batch level, not per pack.** 5000 audit
  rows for one action is noise; the batch row carries the quantity.

Attribution comes from `utils/requestContext.js`, an `AsyncLocalStorage` store
opened per request. That is why the hooks know who acted without every service
function taking a `user` argument.

## Conventions

- **CommonJS throughout.** `sequelize-cli` migrations must be CommonJS; mixing
  module systems in one package causes more trouble than it is worth here.
- **snake_case in the database, camelCase in JavaScript.** Models set
  `underscored: true` and map fields explicitly.
- **Async routes are wrapped** in `utils/asyncHandler` — Express 4 does not
  catch rejected promises on its own.
- **Errors are thrown, never written to `res`.** `utils/ApiError` carries the
  status; `middleware/errorHandler` produces the single response shape
  `{ error: { message, details? } }`.
- **Migrations are never edited once run.** Change the schema with a new one.

## Layout

```
src/
  config/     env.js, database.js (shared with sequelize-cli)
  models/     index.js auto-loads every sibling model file
  db/
    migrations/
    seeders/
  routes/     one *.routes.js per resource, mounted in index.js
  middleware/ notFound, errorHandler
  utils/      ApiError, asyncHandler
  app.js      express wiring, no listen()
  server.js   listen + graceful shutdown
```
