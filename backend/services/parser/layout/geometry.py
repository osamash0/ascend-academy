"""Page-fraction geometry: boxes are [x0, y0, x1, y1], top-left origin, values in 0..1."""

GAP = 0.02           # shapes closer than this (page fractions) belong to one drawing


def area(b):
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])


def inter(a, b):
    return [max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])]


def union(bs):
    return [min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)]


def near(a, b, g=GAP):
    return not (a[2] + g < b[0] or b[2] + g < a[0] or a[3] + g < b[1] or b[3] + g < a[1])


def centre_in(b, r, pad=0.01):
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    return r[0] - pad <= cx <= r[2] + pad and r[1] - pad <= cy <= r[3] + pad


def white(c):
    """A stroke or fill colour that is (near) white, or no colour at all."""
    return c is None or (len(c) >= 3 and min(c[:3]) > 0.92)
