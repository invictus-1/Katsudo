"""Installer art for the NSIS wizard: a 164x314 sidebar (welcome and finish pages) and a
150x57 header, both as 24-bit BMP. Drawn at 4x and downsampled for clean edges.
Run from the repo root: python design/installer/make_installer_art.py"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join("src-tauri", "windows")
S = 4  # supersample
FONT_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_MONO = r"C:\Windows\Fonts\consolab.ttf"


def font(path, size):
    return ImageFont.truetype(path, size * S)


def era_bands(d, x0, y0, w, band_h, gap):
    """Five stacked era vignettes, oldest at the top."""
    ys = [y0 + i * (band_h + gap) for i in range(5)]
    W, H = w * S, band_h * S
    X = x0 * S

    # 1977 Phosphor: amber terminal bars on near-black with scanlines.
    y = ys[0] * S
    d.rectangle([X, y, X + W, y + H], fill=(13, 10, 4))
    heights = [3, 5, 2, 8, 6, 9, 4, 7, 10, 5, 3, 6]
    bw = W // 16
    for i, hgt in enumerate(heights):
        bx = X + (2 + i) * bw
        d.rectangle([bx, y + H - 4 * S - hgt * H // 14, bx + bw - S, y + H - 4 * S], fill=(255, 176, 0))
    for sy in range(y, y + H, 3 * S):
        d.rectangle([X, sy, X + W, sy + S - 1], fill=(0, 0, 0))

    # 1984 Arcade: neon equaliser on black.
    y = ys[1] * S
    d.rectangle([X, y, X + W, y + H], fill=(4, 4, 10))
    cols = [3, 5, 7, 4, 6, 8, 5, 3, 6, 7, 4, 2]
    cell = H // 9
    for i, n in enumerate(cols):
        cx = X + 8 * S + i * (cell + S)
        for j in range(n):
            col = (93, 255, 93) if j < 4 else (255, 225, 77) if j < 6 else (255, 61, 240)
            cy = y + H - 3 * S - (j + 1) * cell
            d.rectangle([cx, cy, cx + cell - S, cy + cell - S], fill=col)

    # 1986 Synthwave: dusk, sun with slits, perspective grid.
    y = ys[2] * S
    for k in range(H):
        t = k / H
        c = (int(11 + t * 63), int(9 + t * 20), int(32 + t * 62))
        d.line([X, y + k, X + W, y + k], fill=c)
    horizon = y + int(H * 0.62)
    r = int(H * 0.42)
    cx = X + int(W * 0.62)
    d.pieslice([cx - r, horizon - r, cx + r, horizon + r], 180, 360, fill=(255, 158, 94))
    for k, sy in enumerate(range(horizon - r // 2, horizon, r // 6)):
        d.rectangle([cx - r, sy, cx + r, sy + S * (1 + k // 2)], fill=(58, 30, 84))
    d.rectangle([X, horizon, X + W, y + H], fill=(18, 8, 42))
    d.line([X, horizon, X + W, horizon], fill=(255, 110, 199), width=S)
    vx = X + W // 2
    for k in range(-8, 9):
        d.line([vx + k * S * 3, horizon, vx + k * S * 22, y + H], fill=(79, 227, 240), width=S)
    for k, gy in enumerate([4, 9, 16, 26]):
        d.line([X, horizon + gy * S, X + W, horizon + gy * S], fill=(255, 110, 199), width=S)

    # 1996 Beige Box: teal desktop, bevelled window with a navy title bar and progress.
    y = ys[3] * S
    d.rectangle([X, y, X + W, y + H], fill=(0, 114, 122))
    wx0, wy0, wx1, wy1 = X + 12 * S, y + 7 * S, X + W - 44 * S, y + H - 7 * S
    d.rectangle([wx0, wy0, wx1, wy1], fill=(212, 207, 192))
    d.line([wx0, wy0, wx1, wy0], fill=(255, 255, 255), width=S); d.line([wx0, wy0, wx0, wy1], fill=(255, 255, 255), width=S)
    d.line([wx0, wy1, wx1, wy1], fill=(94, 90, 80), width=S); d.line([wx1, wy0, wx1, wy1], fill=(94, 90, 80), width=S)
    d.rectangle([wx0 + 2 * S, wy0 + 2 * S, wx1 - 2 * S, wy0 + 8 * S], fill=(28, 61, 158))
    px0, py0 = wx0 + 5 * S, wy1 - 11 * S
    d.rectangle([px0, py0, wx1 - 5 * S, py0 + 6 * S], fill=(255, 255, 255))
    for k in range(7):
        bx = px0 + S + k * 7 * S
        d.rectangle([bx, py0 + S, bx + 5 * S, py0 + 5 * S], fill=(28, 61, 158))

    # Now: Night shift timeline lanes.
    y = ys[4] * S
    d.rectangle([X, y, X + W, y + H], fill=(21, 19, 15))
    lanes = [[(0, 22, (255, 179, 71)), (30, 62, (255, 179, 71))],
             [(4, 14, (79, 209, 197)), (18, 40, (255, 143, 163)), (46, 64, (79, 209, 197))],
             [(0, 10, (181, 217, 106)), (22, 34, (127, 182, 255)), (48, 66, (255, 179, 71))]]
    for li, segs in enumerate(lanes):
        ly = y + (6 + li * 11) * S
        for a, b, col in segs:
            d.rounded_rectangle([X + a * S * w // 100 + 6 * S, ly, X + b * S * w // 100 + 6 * S, ly + 6 * S], radius=S * 2, fill=col)
    return ys


def label(d, x, y, text, fill, size=8):
    d.text((x * S, y * S), text, font=font(FONT_MONO, size), fill=fill)


def sidebar():
    w, h = 164, 314
    img = Image.new("RGB", (w * S, h * S), (14, 13, 11))
    d = ImageDraw.Draw(img)
    d.text((14 * S, 16 * S), "Katsudō", font=font(FONT_BOLD, 26), fill=(242, 234, 219))
    d.text((15 * S, 52 * S), "Every hour and every key,", font=font(FONT_BOLD, 8), fill=(180, 169, 147))
    d.text((15 * S, 63 * S), "kept on your own machine.", font=font(FONT_BOLD, 8), fill=(180, 169, 147))
    ys = era_bands(d, 0, 84, w, 42, 4)
    for y, (era, col) in zip(ys, [("1977", (255, 194, 61)), ("1984", (93, 245, 255)), ("1986", (242, 237, 255)),
                                 ("1996", (255, 255, 255)), ("NOW", (242, 234, 219))]):
        label(d, 128 if era != "NOW" else 132, y + 2, era, col)
    return img.resize((w, h), Image.LANCZOS)


def header():
    w, h = 150, 57
    img = Image.new("RGB", (w * S, h * S), (21, 19, 15))
    d = ImageDraw.Draw(img)
    colors = [(255, 176, 0), (255, 61, 240), (255, 158, 94), (28, 61, 158), (79, 209, 197)]
    for i, col in enumerate(colors):
        y = (10 + i * 8) * S
        a = 10 + (i * 23) % 40
        d.rounded_rectangle([a * S, y, (a + 50 + i * 9) * S, y + 5 * S], radius=2 * S, fill=col)
    return img.resize((w, h), Image.LANCZOS)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    sidebar().save(os.path.join(OUT, "installer-sidebar.bmp"))
    header().save(os.path.join(OUT, "installer-header.bmp"))
    sidebar().resize((164 * 3, 314 * 3), Image.NEAREST).save(os.path.join("design", "installer", "preview-sidebar.png"))
    print("written")
