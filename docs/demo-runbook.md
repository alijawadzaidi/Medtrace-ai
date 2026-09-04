# Demo runbook

Eight minutes, eight steps, rehearsed end to end against the live deployment.

| | |
| --- | --- |
| Public app | <https://medtrace-web-production.up.railway.app> |
| API reference | <https://medtrace-api-production.up.railway.app/docs> |
| Sign in | `maker@meridian.example` · password in your notes, **not** the one in this repo |

## Before you start

- [ ] Open every tab you will use **five minutes early**. First requests after
      idle are slow, and that pause is the one the room notices.
- [ ] Sign into three browser profiles or windows — manufacturer, distributor,
      pharmacy — so step 3 is a click rather than a login.
- [ ] Have the phone on the venue wifi, not mobile data, and confirm the
      scanner opens the camera *before* the audience is watching.
- [ ] Screen capture of the whole flow, recorded in advance, as insurance.

## The two traps this rehearsal found

**1. Do not scan the pack you just shipped.**

Step 3 moves a pack Mumbai → Delhi → pharmacy in about four seconds. That is
physically impossible, and the detector is right to say so: scanning that pack
in step 4 with location sharing on returns **suspect — this pack looks cloned**,
which destroys the "Genuine" moment the whole demo is built on.

Verified in rehearsal:

| What you scan | Location shared | Verdict |
| --- | --- | --- |
| The pack you just shipped | yes | ❌ `suspect` |
| The pack you just shipped | no | ✅ `genuine` |
| A pack seeded weeks ago | yes | ✅ `genuine` |

Use a **seeded** pack for step 4. Its journey is six weeks old, so implied
speed is a few km/h whatever the venue's coordinates are. Step 3 still shows
the mechanics live; step 4 verifies a pack that reached its pharmacy last
month. Say exactly that — it is true, and it is the realistic case anyway.

**2. The camera needs HTTPS and a granted permission.** Both hold on the
deployed URL, but the permission prompt appears the first time. Grant it before
you present, or narrate it.

## The sequence

**1 · Create a batch (manufacturer).** Dashboard → Batches → New batch, 200
packs. It takes about four seconds. Show the serial list: every pack has its
own code, which is the pivot the whole project rests on.

**2 · Open the label sheet.** `Print label sheet →`. Say out loud that the QR
codes are visibly different from one another — that is the difference between
this and a batch-level code, and it is visible from the back of the room.

**3 · Ship it.** Shipments → New shipment → paste two serials → Dispatch.
Switch to the distributor: Receive. Create a second shipment to the pharmacy,
dispatch, switch to the pharmacy, receive. Four seconds of clicking; narrate
that only the current holder can dispatch and only the named destination can
receive.

**4 · Scan on a phone (no login).** Use a **seeded** serial — see trap 1. Full
custody history appears, six weeks of it, with no account.

**5 · Scan something wrong.** An invented serial → `counterfeit`, and it never
touches the database because the check character rejects it. A recalled pack →
`recalled`, on a pack that is genuine but withdrawn. Both look nothing like
step 4.

**6 · Regulator view.** Sign in as the inspector → Look up a pack → paste the
serial. The journey is plotted end to end with a scale bar. Then Alerts: the
triage queue, worst first, each alert expandable to the features that produced
it.

**7 · Clone a pack, live.** On the phone, verify a serial. Then verify the same
serial from a second device or a browser with different coordinates. Run
detection from the Alerts screen: a critical `impossible_travel` alert appears
with the model's score beside it.

Then **scan that pack again on the phone** — it now reads *suspect* to any
customer, because a detected clone is told to everyone holding that serial, not
only to the scan that tripped the rule. That is the strongest thirty seconds in
the demo.

**8 · Close on the numbers.** From `ai/metrics.json` and `sim/evaluation.json`:

| Over 900 labelled packs | precision | recall | F1 |
| --- | --- | --- | --- |
| Rules only | **1.000** | 0.776 | 0.874 |
| Model only | 0.595 | 0.702 | 0.644 |
| **Both** | 0.663 | **0.940** | 0.778 |

The point to land is not the headline number, it is the split by pattern: the
model never catches a custody skip, because no feature encodes event ordering;
the rules barely catch grey-market diversion, because nobody wrote a rule for
"sat unusually long, then surfaced somewhere unexpected". Neither is good
enough alone, and saying so is more convincing than any single figure.

## If something fails

- **A service is slow to answer.** First request after idle. Wait it out; it
  does not recur.
- **The scorer is down.** Verification, custody and rule alerts all continue —
  only the risk score is missing, and `/detection/health` says so honestly.
  This is worth demonstrating deliberately if you have time.
- **The camera will not open.** Type the serial instead. The field is a
  first-class path, not a fallback, and the serial format was designed to be
  read aloud off a damaged label.
