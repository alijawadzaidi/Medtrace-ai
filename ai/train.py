"""Train the anomaly detector and report what it actually achieves.

Run:
    ai/.venv/bin/python ai/train.py --data ai/data/features.csv

Three decisions here are worth defending out loud:

1. **The model never sees a label.** Isolation Forest is unsupervised, and it
   is fitted on the training split with the label column dropped. Labels are
   used only to evaluate the held-out test split. Fitting on labels and then
   reporting accuracy against them would be measuring nothing.

2. **The split is stratified and the test set is untouched until the end.**
   Fraud is ~9% of the data, so an unstratified split can easily hand the test
   set two cloned packs and make recall a coin toss.

3. **The numbers reported are the honest ones.** Isolation Forest on seven
   features with a contamination parameter chosen by hand does not produce
   spectacular metrics, and a confusion matrix with a candid discussion of
   false positives reads as competent engineering. An unexplained 99% reads as
   a mistake nobody caught.
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import dump
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import FEATURE_ORDER, FEATURE_VERSION  # noqa: E402

MODEL_VERSION = f"isolation-forest-v{FEATURE_VERSION}"


def load(path):
    frame = pd.read_csv(path)
    missing = [c for c in FEATURE_ORDER if c not in frame.columns]
    if missing:
        raise SystemExit(f"{path} is missing feature columns: {missing}")
    if "is_fraud" not in frame.columns:
        raise SystemExit(f"{path} has no is_fraud column — regenerate it with sim/export-features.js")
    return frame


def evaluate(y_true, y_pred):
    tp = int(((y_pred == 1) & (y_true == 1)).sum())
    fp = int(((y_pred == 1) & (y_true == 0)).sum())
    fn = int(((y_pred == 0) & (y_true == 1)).sum())
    tn = int(((y_pred == 0) & (y_true == 0)).sum())

    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    return {
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="ai/data/features.csv")
    parser.add_argument("--out", default="ai/model.joblib")
    parser.add_argument("--metrics", default="ai/metrics.json")
    parser.add_argument("--contamination", type=float, default=0.09,
                        help="Expected share of anomalies. Tune the simulator, not this, if results look wrong.")
    parser.add_argument("--seed", type=int, default=20260901)
    args = parser.parse_args()

    frame = load(args.data)
    X = frame[FEATURE_ORDER].to_numpy(dtype=float)
    y = frame["is_fraud"].to_numpy(dtype=int)
    labels = frame["label"].to_numpy() if "label" in frame.columns else np.array(["?"] * len(y))

    X_train, X_test, y_train, y_test, _, labels_test = train_test_split(
        X, y, labels, test_size=0.3, random_state=args.seed, stratify=y
    )

    model = IsolationForest(
        n_estimators=300,
        contamination=args.contamination,
        max_samples="auto",
        random_state=args.seed,
        n_jobs=-1,
    )
    # No labels passed. This is the honest part.
    model.fit(X_train)

    # `score_samples` is higher for more ordinary points. Keeping the training
    # distribution lets the service turn a raw score into a percentile — "more
    # anomalous than 92% of ordinary packs" is a sentence a regulator can act
    # on, where "-0.43" is not.
    train_scores = np.sort(model.score_samples(X_train))

    test_scores = model.score_samples(X_test)
    y_pred = (model.predict(X_test) == -1).astype(int)

    metrics = evaluate(y_test, y_pred)
    metrics["support"] = {"test_rows": int(len(y_test)), "test_fraud": int(y_test.sum())}

    # Per-pattern recall: one number hides which frauds were missed, and
    # "we caught every mass-cloning and no custody skips" is the finding.
    per_pattern = {}
    for pattern in sorted(set(labels_test)):
        if pattern in ("honest", "unlabelled"):
            continue
        mask = labels_test == pattern
        caught = int(y_pred[mask].sum())
        per_pattern[pattern] = {
            "in_test": int(mask.sum()),
            "detected": caught,
            "recall": round(caught / mask.sum(), 4) if mask.sum() else 0.0,
        }
    metrics["per_pattern"] = per_pattern

    # Rough feature importance: how far each feature's flagged values sit from
    # the ordinary median, in robust (IQR) units. Isolation Forest has no
    # coefficients, so this is a description of the flagged population rather
    # than a property of the model — labelled as such in the report.
    medians = np.median(X_train, axis=0)
    iqr = np.subtract(*np.percentile(X_train, [75, 25], axis=0))
    iqr[iqr == 0] = 1.0
    flagged = X_test[y_pred == 1]
    importance = {}
    if len(flagged):
        deviation = np.abs((np.median(flagged, axis=0) - medians) / iqr)
        importance = {
            name: round(float(value), 3)
            for name, value in sorted(
                zip(FEATURE_ORDER, deviation), key=lambda pair: pair[1], reverse=True
            )
        }
    metrics["flagged_feature_deviation"] = importance

    bundle = {
        "model": model,
        "feature_order": FEATURE_ORDER,
        "feature_version": FEATURE_VERSION,
        "model_version": MODEL_VERSION,
        "train_scores": train_scores,
        "train_medians": medians,
        "train_iqr": iqr,
        "contamination": args.contamination,
        "seed": args.seed,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    dump(bundle, args.out)
    Path(args.metrics).write_text(json.dumps(metrics, indent=2) + "\n")

    print(f"Trained on {len(X_train)} packs, evaluated on {len(X_test)} "
          f"({int(y_test.sum())} fraudulent).")
    print(f"  label counts in training data: {dict(Counter(labels))}")
    print()
    print(f"  precision {metrics['precision']:.3f}   recall {metrics['recall']:.3f}   f1 {metrics['f1']:.3f}")
    print(f"  confusion: TP {metrics['true_positives']}  FP {metrics['false_positives']}  "
          f"FN {metrics['false_negatives']}  TN {metrics['true_negatives']}")
    print()
    print("  recall by fraud pattern:")
    for pattern, stats in per_pattern.items():
        print(f"    {pattern:24} {stats['detected']}/{stats['in_test']}  ({stats['recall']:.2f})")
    print()
    print(f"  model  -> {args.out}")
    print(f"  metrics-> {args.metrics}")


if __name__ == "__main__":
    main()
