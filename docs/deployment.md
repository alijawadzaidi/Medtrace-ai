# Deployment

Four services and a database, on one provider.

```
                    ┌──────────────────┐
   phone / laptop ──│  medtrace-web    │  Next.js · the public URL in every QR
                    └────────┬─────────┘
                             │ NEXT_PUBLIC_API_URL (baked in at build time)
                    ┌────────▼─────────┐
                    │  medtrace-api    │  Express · the only thing with DB access
                    └───┬──────────┬───┘
        AI_SERVICE_URL  │          │  DB_*
                ┌───────▼──┐   ┌───▼──────┐
                │ medtrace-│   │  MySQL   │
                │    ai    │   │          │
                └──────────┘   └──────────┘
```

## Which provider

**Railway.** The decision that settles it is MySQL: Render has no managed MySQL
— its MySQL is a Docker template you run yourself on a paid disk — while
Railway offers MySQL as a first-class managed database alongside the three
application services, in one dashboard.

Cost, honestly: Railway has a **$5 one-time trial credit (30 days, no card)**,
after which the Hobby plan is **$5/month including $5 of usage**, billed for
what the containers actually consume. Four small services will sit near that
floor but can exceed it. If the demo is inside 30 days, the trial covers it.

The alternative, if free matters more than matching the abstract, is Render's
free tier with **PostgreSQL** instead of MySQL — Sequelize speaks both, and the
change is a `pg` dependency plus a `DB_DIALECT`. Render's free services sleep
after 15 minutes idle and take 30–60 seconds to wake, which is survivable if
you open the app before you present.

Everything here is packaged with Dockerfiles rather than provider config, so
switching hosts later costs a rebuild rather than a rewrite.

## The order that matters

Four things bite in a specific order. Do them in this one.

### 1. Database first, and run the migrations

Provision MySQL, then point the API at it and migrate. Nothing else works
before this.

```bash
DB_DIALECT=mysql DB_HOST=… DB_PORT=… DB_NAME=… DB_USER=… DB_PASSWORD=… \
  npm run db:migrate
```

> **Untested territory.** Every migration so far has only ever run against
> SQLite. They were written for the portable subset both dialects share and
> nothing obvious should break — the index names are short, no `TEXT` column
> carries a default, and the widest unique index is 256 bytes against MySQL's
> 3072-byte limit — but "should" is not "did". Run the migrations against the
> real instance and read the output before going further.

### 2. Seed, with a password of your own

```bash
DEMO_PASSWORD='something-only-you-know' npm run db:seed
```

The committed demo password is `MedTrace#2026`, which is correct for a local
clone and wrong for a public URL: it is in a public repository, so anyone who
reads it could sign in as the regulator and recall a batch. `DEMO_PASSWORD`
overrides it at seed time.

### 3. Deploy the API, then the scorer

The API refuses to start in production without `JWT_SECRET` and
`VERIFY_BASE_URL`, on purpose — a warning gets ignored, a service that will not
boot does not.

```bash
openssl rand -base64 48   # JWT_SECRET
```

### 4. Build the web app *with* the API URL

`NEXT_PUBLIC_API_URL` is inlined into the client bundle at **build** time, not
read at runtime. Setting it as a service variable after the image is built does
nothing, and the symptom is a deployed site that tries to call
`http://localhost:4000` from someone's phone. The Dockerfile takes it as a
build argument and fails the build if it is missing.

## Environment variables

### medtrace-api

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `NODE_ENV` | yes | `production` — this is what turns on the boot-time checks |
| `JWT_SECRET` | yes | ≥32 characters. Boot fails on the example placeholder |
| `VERIFY_BASE_URL` | yes | `https://<web-host>/v` — **encoded into every printed QR code** |
| `CORS_ORIGIN` | yes | `https://<web-host>`. A wildcard in production lets any site call the API with a user's token |
| `DB_DIALECT` | yes | `mysql` |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | yes | From the managed database |
| `AI_SERVICE_URL` | no | The scorer's internal URL. Omit it and risk scores are simply absent |
| `PORT` | no | Set by the platform |
| `DEMO_PASSWORD` | seeding only | Overrides the committed demo password |

### medtrace-web

| Variable | When | Notes |
| -------- | ---- | ----- |
| `NEXT_PUBLIC_API_URL` | **build time** | `https://<api-host>`. Inlined into the bundle |

### medtrace-ai

No configuration. It receives features and returns a score, and holds no state
— which is why it needs no database credentials and cannot leak any.

## The QR code URL is the irreversible decision

`VERIFY_BASE_URL` is encoded into every QR code on every label that gets
printed. Change it afterwards and every box already in circulation points at a
dead address. Nothing else here is permanent: the API can move hosts, the
database can be migrated, the scorer can be switched off entirely. The URL a
customer's camera opens cannot.

Settle it before any real print run. A provider subdomain
(`medtrace-web.up.railway.app`) is stable as long as the project exists; a
custom domain additionally survives changing provider.

## Verifying a deployment

```bash
curl -s https://<api-host>/health                    # process is up
curl -s https://<api-host>/health/ready              # database answers
curl -s https://<api-host>/verify/MT-…               # public verification, no auth
open  https://<api-host>/docs                        # API reference
open  https://<web-host>/verify                      # scanner — needs HTTPS
```

Then, on an actual phone, over the deployed URL: open `/verify`, grant the
camera, and scan a printed label. Browser camera access requires HTTPS or
localhost, so this is the first moment the scanner can be honestly tested —
and the build plan is right that it should happen well before demo day rather
than the morning of.

## Cold starts

Free tiers sleep after ~15 minutes idle and take 30–60 seconds to wake, which
is fatal in the middle of a presentation. Three ways out, in order of how much
they cost: open the app five minutes before you present; point a cron at
`/health` every ten minutes; pay for the tier that does not sleep.

Record a screen capture of the full demo regardless. Venue wifi fails more
often than code does.
