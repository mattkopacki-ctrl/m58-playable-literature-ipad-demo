"""Metric helpers for the medium worker benchmark."""


def normalize_values(values):
    """Convert provided numeric values to floats, skipping missing entries."""
    cleaned = []
    for value in values:
        if value:
            cleaned.append(float(value))
    return cleaned


def average(values):
    cleaned = normalize_values(values)
    if not cleaned:
        raise ValueError("at least one numeric value is required")
    return round(sum(cleaned) / len(cleaned), 2)


def summary(values):
    cleaned = normalize_values(values)
    return {
        "provided": len(values),
        "used": len(cleaned),
        "average": average(values),
    }
