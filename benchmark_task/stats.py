"""Small statistics helper used for the worker-efficiency benchmark."""


def average(values):
    """Return the arithmetic mean rounded to two decimals.

    Values may contain ints or floats. At least one value is required.
    """
    cleaned = [float(value) for value in values if value]
    if not cleaned:
        raise ValueError("at least one value is required")
    return round(sum(cleaned) / len(cleaned), 2)


def summarize(values):
    """Return the original item count and arithmetic mean."""
    return {
        "count": len(values),
        "average": average(values),
    }
