# MedTrace API

Express + Sequelize backend for MedTrace AI.

## Setup

```bash
npm install
cp .env.example .env
npm run db:reset   # undo all -> migrate -> seed
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
| `npm run db:seed`     | insert demo organizations                  |
| `npm run db:reset`    | rebuild the database from scratch          |

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
| GET    | `/health`            | public    | Liveness — never touches the database  |
| GET    | `/health/ready`      | public    | Readiness — 503 if the database is down |
| POST   | `/auth/register`     | public    | Create an account against an organization |
| POST   | `/auth/login`        | public    | Exchange credentials for a JWT         |
| GET    | `/auth/me`           | any role  | Current user and organization          |
| PATCH  | `/auth/me`           | any role  | Update own name or password            |
| GET    | `/organizations`     | any role  | Own organization; regulators see all   |
| GET    | `/organizations/:id` | any role  | 403 across organizations, except regulators |
| GET    | `/audit-logs`        | regulator | Audit trail, filterable by entity and action |
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
