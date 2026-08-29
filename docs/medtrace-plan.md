# MedTrace AI — Build Plan

**Final-year project · 12 weeks · 8 phases · Rev. 1 (29 Aug 2026)**

| | |
|---|---|
| Serialization | Per pack, not per batch |
| Backend | Node · Express · Sequelize · MySQL |
| Frontend | Next.js + browser camera scanner |
| AI | Python FastAPI service (stateless) |
| Timeline | 12 weeks, 8 phases |

---

## 1. The pivot — one QR per pack changes the entire project

The original abstract gives each **batch** a QR code. That single choice quietly disables both of the project's headline claims.

If ten thousand packs in a batch share one code, a counterfeiter photographs one real box and prints ten thousand fakes that all verify successfully. Worse, the AI module loses its best signal: "duplicate QR usage" and "scans from distant locations" are *normal* at batch level. Thousands of legitimate customers scanning the same batch code from across the country is expected behaviour, so the detector has nothing to detect.

Move serialization down one level and both problems dissolve. Every individual pack carries its own serial. Now a duplicate scan is not noise — it is proof that a clone exists. This is also what real regulation requires: the US **Drug Supply Chain Security Act** and the **EU Falsified Medicines Directive** both mandate unit-level serialization, so the choice is defensible on regulatory grounds, not just technical ones.

```
Medicine                  product definition — name, strength, form, manufacturer
  └─ Batch                1 medicine → many batches — mfg date, expiry, quantity
       └─ Pack            1 batch → N packs — ONE UNIQUE SERIAL + ONE QR EACH
```

> **Cost of the change.** One extra table and a bulk-insert on batch creation. For the demo, cap batch size at a few hundred packs so QR generation stays fast and the printable sheet stays sane. Generating fifty thousand QR images live will stall your demo — generate images on demand from the serial instead of storing PNGs.

---

## 2. Architecture — three services, one database

Keep the AI in Python as your abstract states — it gives you a real scikit-learn artifact to write about — but make the boundary narrow. The Python service should be **stateless**: it receives features, returns a score. It never touches MySQL. That single constraint means a dead AI service degrades verification to "no risk score available" instead of taking your whole demo down.

```
┌──────────────────┐  REST   ┌────────────────────┐ features ┌──────────────────┐
│   Next.js app    │ ──────► │    Express API     │ ───────► │  Scoring service │
│                  │ ◄────── │                    │ ◄─────── │                  │
│ dashboards       │  JSON   │ auth · RBAC        │  score   │ FastAPI          │
│ camera scanner   │         │ custody · QR gen   │          │ Isolation Forest │
│ public verify    │         │ alerts · audit log │          │ stateless        │
└──────────────────┘         └─────────┬──────────┘          └──────────────────┘
                                       │
                             ┌─────────▼──────────┐
                             │ MySQL + Sequelize  │
                             │ 10 tables, FKs,    │
                             │ migrations         │
                             └────────────────────┘
```

The scoring service holds no state. If it is unreachable, verification still returns a valid/invalid verdict — only the risk score is missing.

### Repository layout

| Directory | Contents | Runtime |
|---|---|---|
| `api/` | Express, Sequelize models and migrations, routes, RBAC middleware, QR generation | Node 24 |
| `web/` | Next.js App Router — role dashboards, scanner, public verification page | Node 24 |
| `ai/` | FastAPI app, feature extraction, trained model file, training notebook | Python 3.13 |
| `sim/` | Supply-chain data simulator — generates honest and fraudulent event streams | Node or Python |
| `docs/` | ER diagram, API reference, this plan, report source | — |

> **A note on MySQL.** MySQL is a perfectly defensible choice and your abstract commits to it. PostgreSQL would be technically better here — JSONB for variable event payloads and stronger geo support for the distance calculations — but only switch if you are already comfortable with it. Sequelize speaks both, so the decision is reversible until roughly week 5.

---

## 3. Data model — ten tables

Your abstract lists eight. The extra one that matters is **`organizations`**: a distributor should see their own shipments, not every distributor's. Without it, "role-based access control" only checks *what kind* of user you are, never *which* one — and an examiner will find that in about thirty seconds.

| Table | Key columns | Why it exists |
|---|---|---|
| `organizations` | name, type, license_no, lat, lng | Scopes every query. Coordinates feed the travel-speed features. |
| `users` | email, password_hash, role, organization_id | Identity. Role ∈ manufacturer, distributor, pharmacy, regulator. |
| `medicines` | name, strength, form, manufacturer_id | Product catalogue. |
| `batches` | medicine_id, batch_no, mfg_date, expiry, quantity, status | Production run. Status carries recall state. |
| `packs` | batch_id, serial, current_org_id, state | **The heart of the system.** One row per physical pack. |
| `shipments` | from_org, to_org, status, dispatched_at, received_at | A transfer envelope between two organizations. |
| `shipment_items` | shipment_id, pack_id | Which packs travelled in which shipment. |
| `scan_events` | pack_id, type, actor, lat, lng, ip, created_at | Append-only. Every custody change and every public scan. The AI's input. |
| `alerts` | pack_id, batch_id, rule, severity, score, status | Detector output, triaged by regulators. |
| `audit_logs` | user_id, action, entity, entity_id, before, after | Written by a Sequelize hook, not by hand in each route. |

> **Build this on day one.** `scan_events` must be append-only and must never be updated or deleted. It is simultaneously your audit trail, your customer-facing history, and your model's training data. Retrofitting a complete event history in week 10 is the single most likely way this project runs out of time.

---

## 4. Detection — what the model actually sees

You have no real dataset, so you will train on data you generated yourself. Every examiner will ask about this. The honest answer — and the strong one — is that **the simulator is a deliverable**: a documented generator producing realistic honest traffic plus five named fraud patterns, with a labelled hold-out set you evaluate against. That turns "we made up the data" into "we built a controlled testbed and reported precision and recall on it."

### Features per pack

| Feature | Definition | Catches |
|---|---|---|
| `max_speed_kmh` | Greatest implied velocity between consecutive scans | Cloned serials in two places |
| `scan_count` | Total public verification scans | Codes copied and mass-distributed |
| `distinct_regions` | Unique geographic clusters in the scan history | Grey-market diversion |
| `custody_hops` | Number of organization changes | Unusually long or circular routes |
| `dwell_variance` | Variance of time spent at each holder | Warehouse stalling, expiry gaming |
| `batch_scan_entropy` | Spread of scan timing across the batch | Bulk cloning of a whole batch |
| `days_to_expiry` | Shelf life remaining at scan time | Expired stock re-entering the chain |

### Rules worth adding alongside the model *(optional, week 11)*

You chose Isolation Forest alone, which is a valid scope. But three or four deterministic rules cost almost nothing and give you something an unsupervised model cannot: an alert you can **explain** on stage. When a regulator asks "why is this flagged," *"anomaly score 0.83"* is a much weaker answer than *"this pack moved 1,400 km in 20 minutes."*

| Severity | Rule | Trigger |
|---|---|---|
| **Critical** | Impossible travel | Two scans imply a velocity above 900 km/h |
| **Critical** | Duplicate dispense | A pack already marked dispensed is dispensed again elsewhere |
| **Warning** | Custody skip | Pack appears at a pharmacy with no record of leaving the distributor |
| **Info** | Scan storm | Verification count far above the batch median — possible copied label |

> **Report the honest numbers.** Isolation Forest on seven features with a contamination parameter you picked yourself will not produce spectacular metrics, and that is fine. A confusion matrix with a candid discussion of false positives reads as competent engineering. An unexplained 99% accuracy reads as a mistake nobody caught.

---

## 5. Schedule — eight phases

Ordered so that something demonstrable exists from week 4 onward. If the schedule slips, the phases most safely dropped are at the bottom — that is deliberate.

### Phase 0 · Foundation — Week 1
Repo, Express skeleton, Sequelize connection, first migration, seed script, health endpoint, ESLint. Decide MySQL vs Postgres and do not revisit it.
`express` `sequelize` `dotenv`

### Phase 1 · Identity and access — Week 2
Organizations, users, bcrypt hashing, JWT issue and verify, role middleware, organization-scoped queries. Wire the audit-log hook now so every later feature logs itself for free.
`bcrypt` `jsonwebtoken` `rbac`

### Phase 2 · Catalogue and serialization — Weeks 3–4
Medicines, batches, and the bulk pack generator. Serial format, QR payload design, on-demand QR rendering, printable label sheet as PDF or HTML. **First demonstrable milestone.**
`qrcode` `nanoid` `bulkCreate`

### Phase 3 · Custody and movement — Weeks 5–6
Shipments, shipment items, dispatch and receive endpoints, pack state transitions, `scan_events` written on every change. Full chain-of-custody history per pack.
`transactions` `state machine`

### Phase 4 · Public verification — Week 7
Unauthenticated verify endpoint, rate limiting, scan logging with coarse geolocation, and the response shape the customer page renders. No login, ever, for this route.
`express-rate-limit` `helmet`

### Phase 5 · Frontend — Weeks 7–9
Next.js App Router, auth flow, four role dashboards, batch creation form, shipment screens, and the browser camera scanner. Budget generously — this is the phase that most often overruns.
`next.js` `html5-qrcode` `tailwind`

### Phase 6 · Simulator and model — Weeks 9–11
Event generator with labelled fraud patterns, feature extraction, Isolation Forest training notebook, FastAPI scoring endpoint, and the Express hook that writes alerts. Evaluate and record the metrics.
`fastapi` `scikit-learn` `pandas`

### Phase 7 · Regulator view and hardening — Week 12
Alert triage dashboard, supply-chain map, integration tests on the critical paths, deployment, README, ER diagram, API reference. Freeze features here.
`jest` `supertest` `swagger`

### Phase 8 · Optional — buffer, only if ahead of schedule
HMAC-signed QR payloads so forged codes fail before a database lookup. Strict custody state machine rejecting invalid transitions. Batch recall workflow. Deterministic rule engine alongside the model. Any one of these strengthens the demo; **the state machine gives the most per hour spent.**
`hmac` `recall` `rules`

---

## 6. The demo — rehearse this sequence

Design the build around the story you will tell in eight minutes. Every step below should work from seed data with no manual database editing.

1. Log in as a manufacturer. Create a batch of 200 packs of a real-sounding medicine. Show the generated serials.
2. Open the printable label sheet. The QR codes are visibly different from one another — make this point out loud.
3. Dispatch a shipment to a distributor. Switch accounts, receive it, forward it to a pharmacy.
4. On a phone, scan one pack with the public page. Genuine. Full custody history appears, no login required.
5. Scan a serial that does not exist, or one from a recalled batch. Clear warning, clearly different from step 4.
6. Show the regulator dashboard: the same pack's journey plotted end to end.
7. Trigger the cloned-pack scenario from the simulator. An alert appears with its risk score and contributing features.
8. Close on the metrics table from the training notebook — precision, recall, and what the false positives were.

> **Two practical traps.** Browser camera access requires HTTPS or `localhost`. Test the scanner on a real phone over your deployed URL well before demo day, not the morning of. And record a screen capture of the full flow as insurance — venue wifi fails more often than code does.

---

## 7. Report — what each phase gives the write-up

The report is graded, not just the code. Produce these artifacts as you go rather than reconstructing them in the final week.

| Report section | Artifact | Produced in |
|---|---|---|
| System architecture | Service diagram, request flow for verification | Phase 0–2 |
| Database design | ER diagram exported from the live schema | Phase 1–3 |
| Security | RBAC matrix: role × endpoint × permission | Phase 1 |
| API design | Swagger / OpenAPI spec, generated not hand-written | Phase 2–4 |
| Methodology | Simulator design and fraud pattern definitions | Phase 6 |
| Results | Confusion matrix, precision, recall, feature importance | Phase 6 |
| Testing | Test suite output and coverage summary | Phase 7 |

---

## 8. Risks — where this goes wrong

| Risk | Signal | Response |
|---|---|---|
| Frontend overruns | Week 9 arrives and dashboards are unfinished | Cut to two dashboards — manufacturer and regulator — plus the public scanner. Demo the rest through the API. |
| Model produces nothing interesting | Everything scores as normal, or everything is an anomaly | Your simulator's fraud is too subtle or too extreme. Tune the generator, not the contamination parameter. |
| Two services are a deployment burden | Week 12 and the Python service will not deploy | Run the scorer as a scheduled job that writes alerts to the database. The API then only reads alerts, and the demo is unaffected. |
| Scanner fails on a phone | Camera permission denied or no video feed | HTTPS is mandatory. Keep a manual serial-entry field on the verification page as a permanent fallback. |
| Scope creep into blockchain | "It would be better with a ledger" | It is already in your future-work section. Leave it there. Append-only events plus audit logs give you the same argument at a fraction of the cost. |

---

**Next step:** Phase 0 — initialise the repository, stand up Express and Sequelize, and get the first migration running. Everything after that has a demonstrable milestone attached to it.
