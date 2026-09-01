# Simulator

There is no public dataset of counterfeit medicine movements, so the model is
trained on data generated here. Every examiner will ask about that, and the
honest answer is the strong one: **the simulator is a deliverable**. It is a
documented generator producing realistic honest traffic plus five named fraud
patterns, with labels written at injection time and a hold-out set the model is
measured against. That turns "we made up the data" into "we built a controlled
testbed and reported precision and recall on it."

## The pipeline

Four commands, all seeded, all reproducible:

```bash
node sim/generate.js --packs 900 --batches 9 --fraud-rate 0.09 --seed 20260901 --reset
node sim/export-features.js                       # -> ai/data/features.csv
ai/.venv/bin/python ai/train.py                   # -> ai/model.joblib, ai/metrics.json
node sim/evaluate.js                              # -> sim/evaluation.json
```

The API must be seeded first (`cd api && npm run db:reset`) — the simulator
uses the real organizations and medicines, and writes real packs and events.
For `evaluate.js` to measure the model as well as the rules, the scoring
service has to be running.

## Why it is seeded

`Math.random()` would make every run produce a different dataset, which means
the metrics in the report describe data nobody can regenerate — the most common
way an evaluation becomes unfalsifiable. `--seed 20260901` reproduces the exact
packs, journeys and fraud injections behind the numbers below.

## Why the labels are written, not inferred

The generator records which pattern it injected into which serial, in
`sim/labels.json`. Labelling afterwards by re-reading the data with the same
rules the detector uses would be circular and would guarantee a perfect score.

## Honest traffic

A pack is made, shipped through one or two distributors, received by a
pharmacy, occasionally verified by whoever bought it, and about half the time
dispensed. Timings are drawn from normal distributions rather than uniform
ones, because real shipments cluster around a usual duration with a long tail,
and uniform timings produce traffic no detector could mistake for real. About
55% of packs are never scanned by a customer at all — that long tail is what
stops "was scanned" from being a fraud signal on its own.

## The five fraud patterns

| Pattern | Behaviour |
| ------- | --------- |
| `cloned_serial` | One serial, two places. A photographed label is reprinted and sold elsewhere, so the same code is verified in two cities hours apart. |
| `mass_cloning` | One label copied onto a whole run of fakes: dozens of verifications of a single serial across many regions in days. |
| `custody_skip` | Stock that appears at a pharmacy having never left the distributor — goods injected mid-route. |
| `expired_relabel` | Expired stock re-entering circulation, moving and being sold after its expiry date. |
| `grey_market_diversion` | A pack that sits far longer than usual, then surfaces in a region it was never shipped to. |

## Results

Dataset: seed `20260901`, 900 packs across 9 batches, 6,482 scan events, 67
fraudulent (7.4%).

`sim/evaluate.js` measures the system that actually ships — the deterministic
rules *and* the model, writing into one alert table — over all 900 packs:

| | precision | recall | F1 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- |
| Rules only | **1.000** | 0.776 | 0.874 | 52 | 0 | 15 |
| Model only | 0.595 | 0.702 | 0.644 | 47 | 32 | 20 |
| **Both** | 0.663 | **0.940** | 0.778 | 63 | 32 | 4 |

Recall by pattern is the interesting table, because a single number hides which
frauds were missed:

| Pattern | Rules | Model | Both |
| ------- | ----- | ----- | ---- |
| `cloned_serial` | 0.58 | 0.42 | 0.75 |
| `custody_skip` | **1.00** | 0.00 | 1.00 |
| `expired_relabel` | 1.00 | 1.00 | 1.00 |
| `grey_market_diversion` | 0.38 | **0.94** | 0.94 |
| `mass_cloning` | 1.00 | 1.00 | 1.00 |

**The two find different frauds.** The model never catches a custody skip,
because no feature in the vector encodes event *ordering* — "arrived without
anyone dispatching it" is invisible to seven numbers about speed, counts and
timing. The rules barely catch grey-market diversion, because nobody wrote a
rule for "sat unusually long, then surfaced somewhere unexpected" — that is
exactly the shape an unsupervised model is for.

Neither column is good enough alone, and that is the finding worth reporting.
The rules are precise and explainable; the model generalises and costs 32 false
positives out of 833 honest packs (3.8%). Together they miss 4 of 67 frauds.

## Reading the false positives

The model's 32 false positives are, on inspection, honest packs with unusual
but legitimate histories: heavily-scanned packs in busy pharmacies, and packs
that changed hands three times instead of two. That is the expected failure
mode of an unsupervised detector at 9% contamination, and it is why alerts are
a triage queue for a regulator rather than an automatic block on a pack.
