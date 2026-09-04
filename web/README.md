# MedTrace web

Next.js 16 (App Router) front end: the public verification page, the camera
scanner, and one role-aware dashboard for all four staff roles.

## Setup

```bash
npm install
cp .env.example .env.local   # points at the API, default http://localhost:4000
npm run dev                  # http://localhost:3000
```

The API must be running (`cd ../api && npm run dev`). Sign in with any of the
demo accounts in [`../api/README.md`](../api/README.md); the password for all
of them is `MedTrace#2026`.

## Routes

| Path | Auth | What it is |
| ---- | ---- | ---------- |
| `/` | public | Landing page |
| `/verify` | public | Camera scanner and manual serial entry |
| `/v/<serial>` | public | **What every printed QR code opens** |
| `/login` | public | Staff sign in |
| `/dashboard` | staff | Role-aware overview |
| `/dashboard/batches` | manufacturer, regulator | Batch list and creation |
| `/dashboard/batches/<id>` | manufacturer, regulator | Serials, label sheet, recall |
| `/dashboard/shipments` | all staff | Create, dispatch, receive, cancel |
| `/dashboard/packs` | all staff | Serial lookup, custody history, dispense |
| `/dashboard/alerts` | regulator | Alert triage — rules and model findings, worst first |
| `/dashboard/audit` | regulator | Audit trail |

## Decisions worth knowing

**Verification runs in the browser, not on the Next.js server.** The API stamps
every scan with the caller's IP address and coordinates, and those two fields
are what let it notice that one serial was scanned in Mumbai and Delhi twenty
minutes apart. Server-side rendering the result would record *this application's
host* as the location of every scan in the country, and the geographic signal
Phase 6 trains on would be gone. So `/v/<serial>` paints a shell and the phone
makes the call itself.

**`/v/<serial>` is a permanent URL.** It is encoded into every QR code ever
printed. Labels in circulation cannot be reprinted, so the path may not change.

**One dashboard, four roles.** A dashboard per role would duplicate the same
tables four times and guarantee they drift. Which tabs and buttons appear is
decided by role — and none of that is a security boundary. The API enforces
every rule again on its own: hiding the recall button from a manufacturer is a
courtesy, `requireRole('regulator')` is the control.

**The scanner is loaded on demand and is never the only way in.** Camera access
needs HTTPS, a granted permission and working hardware; all three fail
regularly. Manual entry is a first-class path, which is what the serial format
was designed for — Crockford base32 has no I/1 or O/0 confusion, and the check
character rejects a typo before the network is touched. `html5-qrcode` also
touches `navigator` at import time and weighs ~300 KB, so it is imported only
when someone actually presses "Scan with camera".

**"We could not reach the service" is its own state, never a verdict.** "We
cannot tell you" and "this is fake" are different answers, and showing the
second when the first is true would be dangerous.

**Colour never carries meaning alone.** A red panel and an amber panel look
identical to a colour-blind reader, so every verdict states its status in
words. Text on saturated fills uses `text-background` rather than white, so it
stays legible when the dark theme flips the brand colour to a pale teal.

**The journey map is drawn from coordinates, not tiles.** Leaflet with
OpenStreetMap tiles would look more impressive and would go blank the moment
the venue wifi does — which the build plan flags as the likeliest demo failure.
`components/JourneyMap.js` draws only what the database holds: positions in
order, with a graticule and a scale bar for context, and longitude compressed
by cos(latitude) so east-west distances are not stretched. It says on screen
that it is a schematic rather than a survey.

**Tokens live in `localStorage`.** The API issues bearer JWTs, so that is what
the client stores. An httpOnly cookie would be safer — anything that can run
script on this origin can read `localStorage` — but it needs the API to set,
refresh and clear cookies and every request to carry CSRF protection. That is
recorded as a known limitation rather than pretended away.

## Layout

```
app/
  layout.js          session provider, header, footer
  page.js            landing
  verify/            scanner + manual entry
  v/[serial]/        the page a QR code opens
  login/
  dashboard/         layout.js gates on session and filters tabs by role
components/          Verdict, Scanner, SiteHeader, ui.js primitives
lib/                 api.js, session.js, useApi.js, geolocation.js, format.js
```
