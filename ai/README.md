# Scoring service

A stateless FastAPI service that receives features and returns an anomaly
score. It never touches the database.

That constraint is the whole design. If this service is down, unreachable or
slow, the API still verifies packs, still moves custody, and still raises every
deterministic rule alert — the only thing missing is the risk number. A dead
model degrades a feature; it does not take a pharmacy offline.

## Setup

Python 3.9 is what this machine ships with, so the pins in `requirements.txt`
are the newest versions that still run on it (scikit-learn 1.7 and pandas 2.3
both require 3.10+). Nothing in the code depends on a newer API.

```bash
python3 -m venv ai/.venv
ai/.venv/bin/pip install -r ai/requirements.txt
```

## Running

```bash
# train first — the service starts without a model but /score returns 503
ai/.venv/bin/python ai/train.py

ai/.venv/bin/uvicorn app.main:app --app-dir ai --port 8000
```

The API finds it at `AI_SERVICE_URL` (default `http://localhost:8000`).

## Endpoints

| Method | Path | Does |
| ------ | ---- | ---- |
| GET | `/health` | Whether a model is actually loadable, and which one |
| POST | `/score` | Scores a list of named feature objects |

```bash
curl -s localhost:8000/score -H 'Content-Type: application/json' -d '{
  "feature_version": 1,
  "items": [{"max_speed_kmh": 13033, "scan_count": 30, "distinct_regions": 32,
             "custody_hops": 2, "dwell_variance": 7281,
             "batch_scan_entropy": 4.9, "days_to_expiry": 666}]
}'
```

```json
{"model_version":"isolation-forest-v1","feature_version":1,
 "scores":[{"score":0.9905,"is_anomaly":true,
            "contributions":{"max_speed_kmh":349.5,"scan_count":30.0,"distinct_regions":28.0}}]}
```

## Decisions

**Features travel as named objects, never positional arrays.** A reordered
array is the classic way a model quietly starts reading `scan_count` as
`days_to_expiry` while still returning plausible numbers. The service reindexes
by name against `ai/features.py`, which mirrors the API's
`features.service.js`, so a mismatch is a 400 rather than a wrong answer. The
request also carries `feature_version`, and a model trained on a different
version is refused.

**The score is a percentile, not a raw Isolation Forest output.** Raw scores
are unbounded negatives that mean nothing to anyone. Ranking each score against
the training distribution turns it into "more anomalous than 96% of ordinary
packs", which is a sentence that can appear in an alert.

**`is_anomaly` is the flag, the score only sorts the queue.** An earlier
version had the API raise an alert whenever the score passed 0.65, which
measured terribly for an instructive reason: the score is a percentile, so
"above 0.65" means "the top 35% of everything" and flagged a third of the
catalogue — 263 false positives against 58 real ones. The model's own
`is_anomaly` already respects the contamination it was trained with.

**`contributions` describes the pack, not the model's internals.** Isolation
Forest has no coefficients to read, so the service reports how far each feature
sits from the ordinary median in robust (IQR) units, and says so. It is still
the difference between "score 0.83" and "scanned 31 times, in 27 regions".

## Training and what it achieves

```bash
ai/.venv/bin/python ai/train.py --data ai/data/features.csv
```

The model never sees a label: Isolation Forest is unsupervised and is fitted on
the training split with the label column dropped. Labels are used only to
evaluate the held-out 30%, which is stratified because fraud is ~7% of the data
and an unstratified split can hand the test set two cloned packs and make
recall a coin toss.

On the held-out set (270 packs, 20 fraudulent):

```
precision 0.591   recall 0.650   f1 0.619
TP 13   FP 9   FN 7   TN 241
```

Recall by pattern: `mass_cloning` 5/5, `expired_relabel` 3/3,
`grey_market_diversion` 5/6, `cloned_serial` 0/2, `custody_skip` 0/4.

These are not spectacular numbers and they are not meant to be. Isolation
Forest on seven features with a contamination parameter chosen by hand does
roughly this well, and a confusion matrix with a candid discussion of false
positives reads as competent engineering — an unexplained 99% reads as a
mistake nobody caught. The number that describes the shipped system is in
[`../sim/README.md`](../sim/README.md): rules and model together reach 0.94
recall at 0.66 precision.

If the results ever look wrong, tune the simulator, not the contamination
parameter. Fraud that is too subtle or too extreme is a generator problem.
