#!/usr/bin/env python3
"""
Bitmap -> SVG tracer for the Bannadamane brand marks.

Traces high-contrast artwork (brush lettering, calligraphy) into smooth cubic
Bezier outlines. Handles counters/holes via the even-odd fill rule, and can
split multi-coloured artwork into one path per ink colour.

  # single-colour artwork (black lettering on white)
  python3 tools/trace-logo.py in.png out.svg --mono

  # multi-colour artwork: auto-detect the ink colours and emit one path each
  python3 tools/trace-logo.py in.png out.svg --colors 6

  # force specific ink colours
  python3 tools/trace-logo.py in.png out.svg --palette "#111111,#e01b1b,#0d2fb4,#0a7c1e,#e0b400"

Options: --width (trace resolution), --smooth (passes), --epsilon (simplify),
         --threshold (ink cutoff 0-255), --invert.
"""

import argparse
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


# ── mask -> boundary polygons ────────────────────────────────────────────────

# Moore neighbourhood, clockwise from "west"
_NBR = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]


def _trace_component(mask, start):
    """Moore-neighbour boundary following with Jacob's stopping criterion."""
    h, w = mask.shape
    boundary = [start]
    # backtrack cell: we entered `start` moving east, so we came from the west
    b = (start[0], start[1] - 1)
    curr = start
    first_pair = None

    while True:
        bi = _NBR.index((b[0] - curr[0], b[1] - curr[1]))
        nxt = None
        for k in range(1, 9):
            d = _NBR[(bi + k) % 8]
            cand = (curr[0] + d[0], curr[1] + d[1])
            if 0 <= cand[0] < h and 0 <= cand[1] < w and mask[cand]:
                nxt = cand
                b = (curr[0] + _NBR[(bi + k - 1) % 8][0],
                     curr[1] + _NBR[(bi + k - 1) % 8][1])
                break
        if nxt is None:                     # isolated pixel
            break

        if first_pair is None:
            first_pair = (curr, nxt)
        elif (curr, nxt) == first_pair:     # returned to the start the same way
            break

        boundary.append(nxt)
        curr = nxt
        if len(boundary) > 4_000_000:       # runaway guard
            break

    return boundary


def mask_to_polygons(mask, min_area):
    """Outer boundaries of every blob, plus boundaries of every enclosed hole."""
    polys = []

    lab, n = ndimage.label(mask, structure=np.ones((3, 3), int))
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() < min_area:
            continue
        ys, xs = np.nonzero(comp)
        start = (int(ys[0]), int(xs[np.argmin(xs[ys == ys[0]])])) \
            if False else (int(ys[0]), int(xs[ys == ys[0]].min()))
        polys.append(_trace_component(comp, start))

    # holes: background blobs that do not touch the border
    bg_lab, bn = ndimage.label(~mask)
    border = set(bg_lab[0, :]) | set(bg_lab[-1, :]) | set(bg_lab[:, 0]) | set(bg_lab[:, -1])
    for i in range(1, bn + 1):
        if i in border:
            continue
        hole = bg_lab == i
        if hole.sum() < min_area:
            continue
        ys, xs = np.nonzero(hole)
        start = (int(ys[0]), int(xs[ys == ys[0]].min()))
        polys.append(_trace_component(hole, start))

    return polys


# ── polygon cleanup ──────────────────────────────────────────────────────────

def smooth_closed(pts, passes):
    """Moving average around a closed ring — takes the stair-steps off."""
    p = np.asarray(pts, float)
    for _ in range(passes):
        p = (np.roll(p, 1, 0) + 2.0 * p + np.roll(p, -1, 0)) / 4.0
    return p


def rdp(points, eps):
    """Ramer-Douglas-Peucker, iterative so deep curves can't blow the stack."""
    n = len(points)
    if n < 3:
        return points
    keep = np.zeros(n, bool)
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]

    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        seg = points[b] - points[a]
        L = np.hypot(*seg)
        chunk = points[a + 1:b]
        if L < 1e-9:
            d = np.hypot(*(chunk - points[a]).T)
        else:
            rel = chunk - points[a]
            d = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / L
        j = int(np.argmax(d))
        if d[j] > eps:
            m = a + 1 + j
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))

    return points[keep]


def to_bezier_path(pts, decimals=1):
    """Closed Catmull-Rom through the points, written as cubic Beziers."""
    n = len(pts)
    if n < 3:
        return ""
    r = lambda v: round(float(v), decimals)
    d = ["M%s,%s" % (r(pts[0][0]), r(pts[0][1]))]

    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n]
        c1 = p1 + (p2 - p0) / 6.0
        c2 = p2 - (p3 - p1) / 6.0
        d.append("C%s,%s %s,%s %s,%s" % (r(c1[0]), r(c1[1]), r(c2[0]), r(c2[1]),
                                         r(p2[0]), r(p2[1])))
    d.append("Z")
    return "".join(d)


def build_path(mask, min_area, smooth, eps):
    subpaths = []
    for poly in mask_to_polygons(mask, min_area):
        if len(poly) < 8:
            continue
        pts = smooth_closed([(x, y) for y, x in poly], smooth)   # (row,col) -> (x,y)
        pts = rdp(pts, eps)
        if len(pts) < 3:
            continue
        subpaths.append(to_bezier_path(pts))
    return "".join(subpaths)


# ── colour handling ──────────────────────────────────────────────────────────

def hex_of(rgb):
    return "#%02x%02x%02x" % tuple(int(round(c)) for c in rgb)


def detect_palette(rgb, ink, k):
    """Pick k representative ink colours by coarse histogram, then refine."""
    px = rgb[ink]
    if len(px) == 0:
        return []
    q = (px // 32).astype(np.int32)
    keys, counts = np.unique(q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2], return_counts=True)
    order = np.argsort(-counts)
    seeds = []
    for idx in order:
        key = keys[idx]
        c = np.array([key // 64, (key % 64) // 8, key % 8]) * 32 + 16
        if all(np.linalg.norm(c - s) > 70 for s in seeds):
            seeds.append(c.astype(float))
        if len(seeds) >= k:
            break
    if not seeds:
        return []

    seeds = np.array(seeds, float)
    for _ in range(12):                                   # k-means refinement
        d = np.linalg.norm(px[:, None, :].astype(float) - seeds[None, :, :], axis=2)
        a = np.argmin(d, axis=1)
        for i in range(len(seeds)):
            if np.any(a == i):
                seeds[i] = px[a == i].mean(axis=0)
    return seeds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--width", type=int, default=1600, help="trace resolution")
    ap.add_argument("--threshold", type=int, default=200, help="ink cutoff, 0-255")
    ap.add_argument("--smooth", type=int, default=3)
    ap.add_argument("--epsilon", type=float, default=0.6)
    ap.add_argument("--min-area", type=int, default=24)
    ap.add_argument("--mono", action="store_true", help="one colour for all ink")
    ap.add_argument("--mono-fill", default="currentColor")
    ap.add_argument("--colors", type=int, default=0, help="auto-detect N ink colours")
    ap.add_argument("--palette", default="", help="comma-separated hex ink colours")
    ap.add_argument("--invert", action="store_true", help="ink is light on dark")
    ap.add_argument("--pad", type=float, default=2.0,
                    help="padding %% around the trimmed viewBox")
    ap.add_argument("--no-trim", action="store_true",
                    help="keep the full canvas instead of cropping to the ink")
    args = ap.parse_args()

    im = Image.open(args.src)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        flat = Image.new("RGBA", im.size, (255, 255, 255, 255))
        flat.alpha_composite(im)
        im = flat.convert("RGB")
    else:
        im = im.convert("RGB")

    if args.width and im.width > args.width:
        h = round(im.height * args.width / im.width)
        im = im.resize((args.width, h), Image.LANCZOS)

    rgb = np.asarray(im).astype(np.uint8)
    lum = rgb.astype(float) @ np.array([0.299, 0.587, 0.114])
    ink = lum > args.threshold if args.invert else lum < args.threshold
    ink = ndimage.binary_closing(ink, np.ones((3, 3), bool))

    if not ink.any():
        sys.exit("No ink found — adjust --threshold (or pass --invert).")

    W, H = im.width, im.height
    groups = []

    if args.mono or (not args.colors and not args.palette):
        d = build_path(ink, args.min_area, args.smooth, args.epsilon)
        groups.append((args.mono_fill, d))
    else:
        if args.palette:
            pal = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)]
                            for h in [c.strip() for c in args.palette.split(",")]], float)
        else:
            pal = detect_palette(rgb, ink, args.colors)

        px = rgb[ink].astype(float)
        dist = np.linalg.norm(px[:, None, :] - pal[None, :, :], axis=2)
        assign = np.argmin(dist, axis=1)

        idx = np.argwhere(ink)
        for i in range(len(pal)):
            sel = idx[assign == i]
            if len(sel) < args.min_area:
                continue
            sub = np.zeros_like(ink)
            sub[sel[:, 0], sel[:, 1]] = True
            sub = ndimage.binary_closing(sub, np.ones((3, 3), bool))
            d = build_path(sub, args.min_area, args.smooth, args.epsilon)
            if d:
                groups.append((hex_of(pal[i]), d))

    # Crop the viewBox to the ink so the mark scales to its own extent rather
    # than to whatever margin the source artwork happened to carry.
    vx, vy, vw, vh = 0, 0, W, H
    if not args.no_trim:
        ys, xs = np.nonzero(ink)
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        p = args.pad / 100.0 * max(x1 - x0, y1 - y0)
        vx, vy = round(x0 - p, 1), round(y0 - p, 1)
        vw, vh = round((x1 - x0) + 2 * p, 1), round((y1 - y0) + 2 * p, 1)

    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" '
             'fill-rule="evenodd" role="img">' % (vx, vy, vw, vh)]
    for fill, d in groups:
        if d:
            parts.append('<path fill="%s" d="%s"/>' % (fill, d))
    parts.append("</svg>")

    with open(args.out, "w") as f:
        f.write("".join(parts))

    print("%s  ->  %s   viewBox %sx%s, %d path(s), %.1f KB"
          % (args.src, args.out, vw, vh, len(groups),
             len("".join(parts)) / 1024))


if __name__ == "__main__":
    main()
