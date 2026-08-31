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

## Auditing

`db/auditHook.js` registers global `afterCreate` / `afterUpdate` / `afterDestroy`
hooks on the Sequelize instance, so **models added in later phases are audited
with no change to that file**. Each row records the acting user, their
organization, the changed fields (before and after), the client IP and a
request id.

Two properties worth knowing:

- **Passwords are never stored in an audit row.** Any field named
  `password`, `passwordHash` or `token` is written as `[redacted]`.
- **Audit writes are deliberately outside the caller's transaction**, so the
  record of an attempted change survives a rollback.

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
