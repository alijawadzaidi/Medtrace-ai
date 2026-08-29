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

| Method | Path            | Auth   | Description                              |
| ------ | --------------- | ------ | ---------------------------------------- |
| GET    | `/`             | public | Service banner                           |
| GET    | `/health`       | public | Liveness — never touches the database     |
| GET    | `/health/ready` | public | Readiness — 503 if the database is down   |

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
