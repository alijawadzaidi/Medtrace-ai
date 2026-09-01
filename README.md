# MedTrace AI

Medicine traceability and supply-chain platform with AI-based anomaly detection.
Every pack of medicine carries its own serial and QR code, so a duplicate scan is
evidence of a clone rather than ordinary traffic.

See [`docs/medtrace-plan.md`](docs/medtrace-plan.md) for the full build plan.

## Structure

| Path    | Contents                                                    | Status        |
| ------- | ----------------------------------------------------------- | ------------- |
| `api/`  | Express + Sequelize REST API                                | Phases 0–4 done  |
| `web/`  | Next.js dashboards, camera scanner, public verification page | Phase 5 done  |
| `ai/`   | FastAPI anomaly-scoring service                             | Phase 6       |
| `sim/`  | Supply-chain event simulator                                | Phase 6       |
| `docs/` | Build plan, ER diagram, API reference                       | ongoing       |

## Quick start

```bash
# terminal 1 — API
cd api
cp .env.example .env
npm install
npm run db:reset   # migrate + seed a supply chain with six weeks of history
npm run dev        # http://localhost:4000/health

# terminal 2 — web
cd web
cp .env.example .env.local
npm install
npm run dev        # http://localhost:3000
```

Sign in with `maker@meridian.example` / `MedTrace#2026`, or scan a pack without
signing in at all — see `api/README.md` for every demo account.

Runs on SQLite out of the box with no database server to install.
To use MySQL instead, see `api/README.md`.
