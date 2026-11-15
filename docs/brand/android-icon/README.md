# Android adaptive icon

The Android launcher icon ([task-0127](../../tasks/task-0127.md), [spec](../../specs/android.md) AND-104, ADR-0051 in [decisions.md](../../tech/decisions.md)) is generated from the two masters in [logo/](../logo/README.md) by `python3 scripts/make-android-icon.py`, which writes the layers straight into the app and only the preview sheet here. Never edit the generated files by hand: change the masters or the script and regenerate.

## Decision

Decided 2026-11-15 (owner decision, delegated): the Android icon is "vinyl on glass". The foreground is the vinyl master at 60 dp, the background is the plate master's glass, and the monochrome themed layer ships. The alternative, a crop of the plate master, was dropped: the 72 dp launcher window shows only the inner 71 percent of that record, with no copper rim and no glass, so it read as a close-up rather than the icon known from iOS. With the vinyl at 60 dp the disc sits inside the 66 dp safe zone, the rim survives every launcher mask, and the glass shows as a 6 dp ring (circle) or in the corners (squircle, rounded square).

## Geometry

Adaptive icons (API 26+) are two 108 dp layers; the launcher shows the centre 72 dp through its own mask (circle on Pixel, squircle on Samsung, rounded square or teardrop elsewhere) and uses the outer 18 dp per side for parallax and motion. The safe zone is a 66 dp circle. At xxxhdpi (4 px per dp) a layer is 432 px, the 72 dp window is the centre 288 px and the vinyl is 240 px across. Nothing is pre-rounded or pre-masked: the system applies the mask.

The background is not a centre crop of the plate master. The vinyl covers about 93 percent of that image, so a centre crop at any scale shows vinyl, not glass. The script measures, per angle, the thin vinyl-free glass band just outside the copper rim (the narrowest found is 18 px of 1024, at the top edge) and stretches it radially over the whole canvas at the same angle, after a 2 px blur: the cream glass with its top-left light and bottom-right shade, no plate edge, no corner fill. Only pixels of the plate master are used. The centre of the background is covered by the foreground and is not meant to be seen alone.

## Generated files

In `android/app/src/main/res/`:

| File | What it is |
| --- | --- |
| `mipmap-<density>/ic_launcher_background.png` | Background layer: the plate's glass stretched over the 108 dp canvas. |
| `mipmap-<density>/ic_launcher_foreground.png` | Foreground layer: the vinyl master centred at 60 dp, transparent elsewhere. |
| `mipmap-<density>/ic_launcher_monochrome.png` | Monochrome layer for Android 13+ themed icons: a white-on-transparent record silhouette at 60 dp (solid disc, a 3 dp cut-out ring at the label edge, a 3 dp spindle hole), radii read from the vinyl master. |
| `mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml` | The `<adaptive-icon>` declarations (background, foreground, monochrome) that `android:icon` and `android:roundIcon` in the manifest point at. |

Densities: mdpi 108 px, hdpi 162, xhdpi 216, xxhdpi 324, xxxhdpi 432; each is rendered from the masters, never downscaled from another density. There is no legacy `ic_launcher.png`: `minSdk` is 28 (AND-091), above the API 26 adaptive-icon floor.

Here: `preview.png`, the sheet (1600 px wide) with the icon under circle, squircle and rounded-square masks at 108 dp scale (432 px) and at 48 dp (192 px), the themed icon on two illustrative Material You pairs, and a mock home screen (dark and light bands, 48 dp at 3 px per dp) with the "Electrophone" label. It is the only image kept in this folder.

## Recolouring

The brand rule is no recolouring. The monochrome layer is the single allowed exception: when the user opts in to themed icons on the phone (Android 13+), the OS tints that layer with the wallpaper palette. The full-colour layers are never tinted and the preview's tints are illustrative only. Without the layer, launchers show the untinted icon or tint the whole icon themselves; shipping it keeps that tint to a silhouette drawn for it.

## Regenerate

`python3 scripts/make-android-icon.py` (Pillow and NumPy only, `python3 -m pip install pillow numpy`; about five seconds). It prints the measured radii, writes the 15 layer PNGs and the two XML files into the app and `preview.png` here, and leaves the masters untouched. Status: in source, not yet seen on a device.
