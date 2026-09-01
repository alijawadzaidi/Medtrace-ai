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
| `ai/`   | FastAPI anomaly-scoring service                             | Phase 6 done  |
| `sim/`  | Supply-chain event simulator                                | Phase 6 done  |
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

## Detection

The anomaly detector is optional at runtime and reproducible offline:

```bash
python3 -m venv ai/.venv && ai/.venv/bin/pip install -r ai/requirements.txt

node sim/generate.js --packs 900 --batches 9 --fraud-rate 0.09 --seed 20260901 --reset
node sim/export-features.js
ai/.venv/bin/python ai/train.py
ai/.venv/bin/uvicorn app.main:app --app-dir ai --port 8000   # terminal 3
node sim/evaluate.js
```

Over 900 labelled packs: deterministic rules reach 1.00 precision at 0.78
recall, the model 0.60 at 0.70, and together **0.94 recall** at 0.66 precision.
They catch different frauds — see [`sim/README.md`](sim/README.md).

With the scorer stopped, everything still works and alerts still appear; only
the risk score is missing. That is the point of keeping it stateless.

Runs on SQLite out of the box with no database server to install.
To use MySQL instead, see `api/README.md`.
