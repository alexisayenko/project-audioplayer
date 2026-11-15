#!/usr/bin/env python3
"""Build the Android adaptive-icon layers and a preview sheet from the brand masters.

Needs Pillow and NumPy only (python3 -m pip install pillow numpy); runs with the system python3.

Icon (owner decision 2026-11-15, ADR-0051, task-0127): "vinyl on glass".
  foreground = the vinyl master at 60 dp, centred inside the 66 dp safe zone
  background = the plate master's glass, stretched radially over the 108 dp canvas
  monochrome = a white record silhouette at 60 dp for Android 13+ themed icons

Inputs (never modified):
  docs/brand/logo/electrophone-app-icon.png   the plate master (1024, opaque): source of the glass
  docs/brand/logo/electrophone-vinyl.png      the vinyl master (1024, transparent): the foreground
Outputs (derived, regenerable) in docs/brand/android-icon/ (see its README.md):
  ic_launcher_background.png, ic_launcher_foreground.png, ic_launcher_monochrome.png (432 px, xxxhdpi)
  preview.png (launcher masks, themed tints, mock home screen)

Usage: python3 scripts/make-android-icon.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import NamedTuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "docs" / "brand" / "logo"
OUT = ROOT / "docs" / "brand" / "android-icon"

PX_PER_DP = 4                      # xxxhdpi: the shipped layers, 432 px
PREVIEW_PX_PER_DP = 6              # the preview's large row: 72 dp window at 432 px
LAYER_DP = 108                     # one adaptive-icon layer
WINDOW_DP = 72                     # what the launcher shows
VINYL_DP = 60                      # foreground disc diameter (safe zone is 66 dp)
MONO_RING_DP = 3                   # cut-out ring width at the label edge
MONO_HOLE_DP = 3                   # cut-out spindle hole radius
SUPERSAMPLE = 4                    # masks are drawn at this factor and downsampled

SHEET_W = 1600
SHEET_BG = (242, 242, 240)
INK = (38, 38, 40)
THEME_LIGHT = {"surface": (227, 241, 238), "tint": (27, 94, 90)}
THEME_DARK = {"surface": (16, 48, 45), "tint": (168, 230, 220)}


class Layers(NamedTuple):
    ppd: int
    background: Image.Image
    foreground: Image.Image
    monochrome: Image.Image

    @property
    def canvas(self) -> int:
        return LAYER_DP * self.ppd

    @property
    def window(self) -> int:
        return WINDOW_DP * self.ppd


def load_masters() -> tuple[Image.Image, Image.Image]:
    plate = Image.open(LOGO / "electrophone-app-icon.png").convert("RGB")
    vinyl = Image.open(LOGO / "electrophone-vinyl.png").convert("RGBA")
    if plate.size != (1024, 1024) or vinyl.size != (1024, 1024):
        sys.exit("masters must be 1024 x 1024")
    return plate, vinyl


def vinyl_disc_bbox(vinyl: Image.Image) -> tuple[int, int, int, int]:
    alpha = np.asarray(vinyl.getchannel("A"))
    ys, xs = np.nonzero(alpha > 8)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def vinyl_foreground(vinyl: Image.Image, ppd: int) -> Image.Image:
    canvas = LAYER_DP * ppd
    disc = vinyl.crop(vinyl_disc_bbox(vinyl))
    size = VINYL_DP * ppd
    disc = disc.resize((size, size), Image.LANCZOS)
    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    layer.alpha_composite(disc, ((canvas - size) // 2, (canvas - size) // 2))
    return layer


def _bilinear(src: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    h, w = src.shape[:2]
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    fx = (xs - np.floor(xs))[..., None]
    fy = (ys - np.floor(ys))[..., None]
    return (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x1] * fx * (1 - fy)
            + src[y1, x0] * (1 - fx) * fy + src[y1, x1] * fx * fy)


def plate_glass_band(plate: Image.Image, bins: int = 1440) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per angle: where the vinyl (rim included) ends and where the glass ends.

    The glass ends at the plate edge or at the near-white fill of the plate's rounded corners.
    """
    src = np.asarray(plate, dtype=np.float32)
    h, w = src.shape[:2]
    cx, cy = (w - 1) / 2, (h - 1) / 2
    angles = np.arange(bins) * 2 * np.pi / bins
    rs = np.arange(0, 740)
    r_in = np.zeros(bins)
    r_out = np.zeros(bins)
    for i, th in enumerate(angles):
        xs = cx + rs * np.cos(th)
        ys = cy + rs * np.sin(th)
        inside = (xs >= 0) & (xs <= w - 1) & (ys >= 0) & (ys <= h - 1)
        px = src[np.clip(np.round(ys).astype(int), 0, h - 1), np.clip(np.round(xs).astype(int), 0, w - 1)]
        r, g, b = px[:, 0], px[:, 1], px[:, 2]
        dark = r + g + b < 200
        copper = (r > 100) & (r - b >= 95)
        vinyl = inside & (dark | copper) & (rs <= 520)
        r_in[i] = rs[vinyl].max() + 6
        lo = np.minimum(np.minimum(r, g), b)
        hi = np.maximum(np.maximum(r, g), b)
        white = inside & (lo >= 245) & (hi - lo <= 10) & (rs > r_in[i])
        r_out[i] = (rs[white].min() - 3) if white.any() else rs[inside].max()

    def smooth(a: np.ndarray, k: int = 31) -> np.ndarray:
        pad = np.concatenate([a[-k:], a, a[:k]])
        return np.convolve(pad, np.ones(k) / k, "same")[k:-k]

    r_in = smooth(r_in)
    r_out = np.maximum(smooth(r_out), r_in + 12)
    return angles, r_in, r_out


def glass_background(plate: Image.Image, ppd: int) -> Image.Image:
    """The plate's glass only: the vinyl-free ring just outside the copper rim, stretched over the canvas.

    The vinyl fills about 93 percent of the plate master, so a centre crop at any scale shows vinyl,
    not glass. Instead each canvas pixel at angle theta and normalised radius t (0 at the centre,
    1 at the canvas edge) samples the master at the same angle, t of the way through a thin glass band
    that starts just outside the rim. The band width is the narrowest vinyl-free glass found around
    the rim, so no pixel comes from the vinyl, the plate edge highlight or the corner fill.
    """
    canvas = LAYER_DP * ppd
    angles, r_in, r_out = plate_glass_band(plate)
    band = float(max(12.0, (r_out - r_in).min()))
    src = np.asarray(plate.filter(ImageFilter.GaussianBlur(2)), dtype=np.float32)
    h, w = src.shape[:2]
    cx, cy = (w - 1) / 2, (h - 1) / 2

    c = (canvas - 1) / 2
    yy, xx = np.mgrid[0:canvas, 0:canvas].astype(np.float64)
    dx, dy = xx - c, yy - c
    rc = np.hypot(dx, dy)
    th = np.arctan2(dy, dx) % (2 * np.pi)
    to_edge = c / np.maximum(np.abs(np.cos(th)), np.abs(np.sin(th)))
    t = np.clip(rc / to_edge, 0, 1)
    ang_wrap = np.concatenate([angles, [2 * np.pi]])
    rin_wrap = np.concatenate([r_in, [r_in[0]]])
    rm = np.interp(th, ang_wrap, rin_wrap) + t * band
    out = _bilinear(src, cx + rm * np.cos(th), cy + rm * np.sin(th))
    img = Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8))
    return img.filter(ImageFilter.GaussianBlur(1)).convert("RGBA")


def vinyl_ratios(vinyl: Image.Image) -> tuple[float, float]:
    """Label radius and spindle-hole radius as fractions of the disc radius, read from the master."""
    arr = np.asarray(vinyl).astype(int)
    x0, y0, x1, y1 = vinyl_disc_bbox(vinyl)
    cx, cy = (x0 + x1 - 1) / 2, (y0 + y1 - 1) / 2
    radius = (x1 - x0) / 2
    rs = np.arange(0, int(radius))
    label, hole = [], []
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        px = arr[np.round(cy + rs * dy).astype(int), np.round(cx + rs * dx).astype(int)]
        r, g, b, a = px[:, 0], px[:, 1], px[:, 2], px[:, 3]
        cyan = (a > 128) & (b > r + 40) & (g > r + 20)
        label.append(rs[cyan].max())
        light = (a > 128) & (r + g + b > 600) & (rs < radius * 0.2)
        hole.append(rs[light].max())
    return float(np.median(label) / radius), float(np.median(hole) / radius)


def _downsample_mask(big: Image.Image, size: int) -> Image.Image:
    return big.resize((size, size), Image.LANCZOS)


def monochrome(vinyl: Image.Image, ppd: int) -> Image.Image:
    canvas = LAYER_DP * ppd
    label_ratio, hole_ratio = vinyl_ratios(vinyl)
    s = SUPERSAMPLE
    big = Image.new("L", (canvas * s, canvas * s), 0)
    draw = ImageDraw.Draw(big)
    c = canvas * s / 2
    disc_r = VINYL_DP * ppd * s / 2
    label_r = disc_r * label_ratio
    ring_w = MONO_RING_DP * ppd * s
    hole_r = max(disc_r * hole_ratio, MONO_HOLE_DP * ppd * s)

    def circle(r: float, fill: int) -> None:
        draw.ellipse([c - r, c - r, c + r, c + r], fill=fill)

    circle(disc_r, 255)
    circle(label_r + ring_w / 2, 0)
    circle(label_r - ring_w / 2, 255)
    circle(hole_r, 0)
    alpha = _downsample_mask(big, canvas)
    layer = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 0))
    layer.putalpha(alpha)
    return layer


def build_layers(plate: Image.Image, vinyl: Image.Image, ppd: int) -> Layers:
    return Layers(ppd, glass_background(plate, ppd), vinyl_foreground(vinyl, ppd), monochrome(vinyl, ppd))


def make_mask(kind: str, size: int) -> Image.Image:
    s = SUPERSAMPLE
    n = size * s
    big = Image.new("L", (n, n), 0)
    draw = ImageDraw.Draw(big)
    if kind == "circle":
        draw.ellipse([0, 0, n - 1, n - 1], fill=255)
    elif kind == "rounded":
        draw.rounded_rectangle([0, 0, n - 1, n - 1], radius=round(0.2 * n), fill=255)
    elif kind == "squircle":
        a = (n - 1) / 2
        e = 2 / 5
        pts = []
        for k in range(1440):
            th = 2 * np.pi * k / 1440
            cs, sn = np.cos(th), np.sin(th)
            x = a + a * np.sign(cs) * abs(cs) ** e
            y = a + a * np.sign(sn) * abs(sn) ** e
            pts.append((x, y))
        draw.polygon(pts, fill=255)
    else:
        raise ValueError(kind)
    return _downsample_mask(big, size)


def window_crop(layers: Layers, layer: Image.Image | None = None) -> Image.Image:
    """The centre 72 dp of background plus foreground (or of one given layer)."""
    if layer is None:
        layer = layers.background.copy()
        layer.alpha_composite(layers.foreground)
    off = (layers.canvas - layers.window) // 2
    return layer.crop((off, off, off + layers.window, off + layers.window))


def masked_icon(window: Image.Image, kind: str, size: int) -> Image.Image:
    icon = window if size == window.width else window.resize((size, size), Image.LANCZOS)
    mask = make_mask(kind, size)
    alpha = Image.fromarray(
        (np.asarray(icon.getchannel("A"), dtype=np.uint16) * np.asarray(mask, dtype=np.uint16) // 255).astype(np.uint8))
    icon = icon.copy()
    icon.putalpha(alpha)
    return icon


def themed_icon(layers: Layers, pair: dict, size: int) -> Image.Image:
    window = window_crop(layers, layers.monochrome)
    if size != window.width:
        window = window.resize((size, size), Image.LANCZOS)
    glyph = Image.new("RGBA", (size, size), pair["tint"] + (255,))
    glyph.putalpha(window.getchannel("A"))
    icon = Image.new("RGBA", (size, size), pair["surface"] + (255,))
    icon.alpha_composite(glyph)
    icon.putalpha(make_mask("circle", size))
    return icon


def font(size: int) -> ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def vertical_gradient(w: int, h: int, top: tuple, bottom: tuple) -> Image.Image:
    rows = np.linspace(0, 1, h)[:, None, None]
    arr = np.array(top)[None, None, :] * (1 - rows) + np.array(bottom)[None, None, :] * rows
    return Image.fromarray(np.repeat(np.round(arr).astype(np.uint8), w, axis=1)).convert("RGBA")


def preview(ship: Layers, big: Layers) -> Image.Image:
    masks = [("circle", "circle (Pixel)"), ("squircle", "squircle (Samsung)"), ("rounded", "rounded square")]
    margin, gap, cap_h, strip_h = 40, 16, 34, 260
    large, small, home = big.window, 48 * PX_PER_DP, 48 * 3
    row_large, row_small = cap_h + large + 40, cap_h + small + 40
    title_h = 112
    height = title_h + row_large + row_small + row_large + cap_h + 6 + strip_h + margin
    sheet = Image.new("RGBA", (SHEET_W, height), SHEET_BG + (255,))
    draw = ImageDraw.Draw(sheet)
    f_title, f_cap, f_small = font(30), font(22), font(19)
    draw.text((margin, 28), "Electrophone, Android adaptive icon: vinyl on glass (decided 2026-11-15)", fill=INK, font=f_title)
    draw.text((margin, 72), "Foreground: the vinyl master at 60 dp. Background: the plate master's glass. "
                            "108 dp layers, 72 dp window, 4 px per dp; the launcher applies the mask.",
              fill=INK, font=f_cap)
    win_big, win_ship = window_crop(big), window_crop(ship)

    y = title_h
    draw.text((margin, y), "Launcher masks at 108 dp scale (432 px)", fill=INK, font=f_cap)
    x = margin
    for kind, label in masks:
        sheet.alpha_composite(masked_icon(win_big, kind, large), (x, y + cap_h))
        draw.text((x, y + cap_h + large + 8), label, fill=INK, font=f_small)
        x += large + gap
    y += row_large

    draw.text((margin, y), "Launcher masks at 48 dp (192 px)", fill=INK, font=f_cap)
    x = margin
    for kind, label in masks:
        sheet.alpha_composite(masked_icon(win_ship, kind, small), (x, y + cap_h))
        draw.text((x, y + cap_h + small + 8), label, fill=INK, font=f_small)
        x += small + gap
    y += row_small

    draw.text((margin, y), "Themed icon (Android 13+, user opt-in): the monochrome layer tinted by the system, "
                           "circle mask, illustrative Material You pairs", fill=INK, font=f_cap)
    x = margin
    for pair, label in ((THEME_LIGHT, "light: teal #1b5e5a on #e3f1ee"), (THEME_DARK, "dark: mint #a8e6dc on #10302d")):
        sheet.alpha_composite(themed_icon(big, pair, large), (x, y + cap_h))
        draw.text((x, y + cap_h + large + 8), label, fill=INK, font=f_small)
        x += large + gap
    x += 24
    for pair in (THEME_LIGHT, THEME_DARK):
        sheet.alpha_composite(themed_icon(ship, pair, small), (x, y + cap_h + large - small))
        x += small + gap
    draw.text((x - 2 * (small + gap), y + cap_h + large + 8), "48 dp", fill=INK, font=f_small)
    y += row_large

    draw.text((margin, y), "Home screen at 48 dp (3 px per dp), circle mask", fill=INK, font=f_cap)
    y += cap_h + 6
    strip_w = (SHEET_W - 2 * margin - 24) // 2
    f_label = font(34)
    icon = masked_icon(win_ship, "circle", home)
    bands = (
        (vertical_gradient(strip_w, strip_h, (30, 34, 48), (58, 64, 86)), (255, 255, 255)),
        (vertical_gradient(strip_w, strip_h, (238, 240, 244), (214, 219, 228)), (28, 28, 32)),
    )
    for i, (band, text_fill) in enumerate(bands):
        bx = margin + i * (strip_w + 24)
        sheet.alpha_composite(band, (bx, y))
        ix, iy = bx + strip_w // 2 - home // 2, y + 40
        sheet.alpha_composite(icon, (ix, iy))
        label = "Electrophone"
        tw = draw.textlength(label, font=f_label)
        draw.text((ix + home / 2 - tw / 2, iy + home + 14), label, fill=text_fill, font=f_label)
    return sheet


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")


def main() -> None:
    plate, vinyl = load_masters()
    label_ratio, hole_ratio = vinyl_ratios(vinyl)
    _, r_in, r_out = plate_glass_band(plate)
    print(f"vinyl master: label radius {label_ratio:.3f} R, hole radius {hole_ratio:.3f} R")
    print(f"plate master: rim ends at r = {r_in.min() - 6:.0f}..{r_in.max() - 6:.0f} px of 512, "
          f"glass band {(r_out - r_in).min():.0f}..{(r_out - r_in).max():.0f} px wide")

    ship = build_layers(plate, vinyl, PX_PER_DP)
    save(ship.background, OUT / "ic_launcher_background.png")
    save(ship.foreground, OUT / "ic_launcher_foreground.png")
    save(ship.monochrome, OUT / "ic_launcher_monochrome.png")
    big = build_layers(plate, vinyl, PREVIEW_PX_PER_DP)
    save(preview(ship, big).convert("RGB"), OUT / "preview.png")


if __name__ == "__main__":
    main()
