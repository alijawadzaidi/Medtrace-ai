"""The feature contract, mirrored from the API.

`api/src/services/features.service.js` computes these vectors and is the only
place that does. This file exists so the service and the trainer agree on the
*names* and their order, and so a mismatch is a loud error rather than a
silently wrong score.

The rule everywhere is the same: features travel as named objects, never as
positional arrays. A reordered array is the classic way a model quietly starts
reading `scan_count` as `days_to_expiry` while still returning plausible
numbers.
"""

FEATURE_VERSION = 1

FEATURE_ORDER = [
    "max_speed_kmh",
    "scan_count",
    "distinct_regions",
    "custody_hops",
    "dwell_variance",
    "batch_scan_entropy",
    "days_to_expiry",
]


def to_row(named):
    """Named feature dict -> list in the model's expected order."""
    missing = [name for name in FEATURE_ORDER if name not in named]
    if missing:
        raise ValueError(f"missing features: {', '.join(missing)}")
    return [float(named[name]) for name in FEATURE_ORDER]
