"""The scoring service.

Stateless on purpose: it receives features and returns a score, and never
touches the database. That single constraint is what makes a dead model a
degraded feature rather than an outage — the API keeps verifying packs and
moving custody, and the only thing missing is the risk number.

Run:
    ai/.venv/bin/uvicorn app.main:app --app-dir ai --port 8000
"""

import sys
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from joblib import load
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from features import FEATURE_ORDER, FEATURE_VERSION, to_row  # noqa: E402

MODEL_PATH = Path(__file__).resolve().parent.parent / "model.joblib"

app = FastAPI(
    title="MedTrace scoring service",
    description="Stateless anomaly scoring for medicine packs.",
    version="1.0.0",
)

_bundle = None


def bundle():
    """Loaded once, lazily, so the process starts even with no model on disk."""
    global _bundle
    if _bundle is None:
        if not MODEL_PATH.exists():
            raise HTTPException(
                status_code=503,
                detail="No trained model. Run: ai/.venv/bin/python ai/train.py",
            )
        _bundle = load(MODEL_PATH)

        if _bundle.get("feature_version") != FEATURE_VERSION:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Model was trained on feature version {_bundle.get('feature_version')}, "
                    f"this service speaks version {FEATURE_VERSION}. Retrain before scoring."
                ),
            )
    return _bundle


class ScoreRequest(BaseModel):
    feature_version: int = Field(..., description="Must match the model's feature version.")
    items: List[Dict[str, float]] = Field(..., description="Named feature objects, never positional arrays.")


class ScoredItem(BaseModel):
    score: float
    is_anomaly: bool
    contributions: Optional[Dict[str, float]] = None


class ScoreResponse(BaseModel):
    model_version: str
    feature_version: int
    scores: List[ScoredItem]


@app.get("/health")
def health():
    """Honest about whether a model is actually loadable."""
    if not MODEL_PATH.exists():
        return {"status": "degraded", "model": None, "reason": "no model file — run ai/train.py"}

    data = bundle()
    return {
        "status": "ok",
        "model": data["model_version"],
        "feature_version": data["feature_version"],
        "features": FEATURE_ORDER,
        "trained_on": int(len(data["train_scores"])),
    }


def contributions(row, data):
    """Which features made this pack look unusual.

    Isolation Forest has no coefficients to read, so this reports how far each
    feature sits from the ordinary median in robust (IQR) units. It describes
    the pack rather than the model's internals — which is the honest framing,
    and still the difference between "score 0.83" and "scanned 31 times, in 27
    regions".
    """
    deviation = np.abs((np.asarray(row) - data["train_medians"]) / data["train_iqr"])
    top = sorted(zip(FEATURE_ORDER, deviation), key=lambda pair: pair[1], reverse=True)[:3]
    return {name: round(float(value), 3) for name, value in top if value > 1.0}


@app.post("/score", response_model=ScoreResponse)
def score(request: ScoreRequest):
    data = bundle()

    if request.feature_version != data["feature_version"]:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Caller sent feature version {request.feature_version}, "
                f"model expects {data['feature_version']}."
            ),
        )

    try:
        rows = [to_row(item) for item in request.items]
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if not rows:
        return ScoreResponse(model_version=data["model_version"], feature_version=FEATURE_VERSION, scores=[])

    matrix = np.asarray(rows, dtype=float)
    raw = data["model"].score_samples(matrix)
    flagged = data["model"].predict(matrix) == -1

    # Raw Isolation Forest scores are unbounded negatives and mean nothing to
    # anyone. Ranking each score against the training distribution turns it
    # into "more anomalous than N% of ordinary packs", which is a sentence that
    # can appear in an alert.
    train_scores = data["train_scores"]
    percentile = np.searchsorted(train_scores, raw) / max(len(train_scores), 1)
    anomaly = 1.0 - percentile

    return ScoreResponse(
        model_version=data["model_version"],
        feature_version=FEATURE_VERSION,
        scores=[
            ScoredItem(
                score=round(float(anomaly[i]), 4),
                is_anomaly=bool(flagged[i]),
                contributions=contributions(rows[i], data),
            )
            for i in range(len(rows))
        ],
    )
