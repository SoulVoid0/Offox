#!/usr/bin/env python3
# Generates the Offox logo in every size and format the Firefox branding
# folder and the installers need. Needs Pillow (python3 -m pip install pillow).
#
#   python3 tools/make-branding.py            # writes fork/branding/offox/...
#
# The logo is drawn from simple shapes (a fox head on an orange-to-violet
# disc), so it is defined once here and rendered at any size.

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "fork", "branding", "offox")
CONTENT = os.path.join(ROOT, "src", "offox", "content")

GRADIENT = [(255, 109, 0), (233, 30, 99), (106, 27, 154)]
FACE = (255, 243, 224)
EAR = (191, 54, 12)
DARK = (38, 22, 18)

# Shapes in a 64x64 box.
HEAD = [(13, 11), (25, 23), (39, 23), (51, 11), (53, 31), (32, 54), (11, 31)]
EAR_L = [(16, 16), (23, 24), (17, 27)]
EAR_R = [(48, 16), (41, 24), (47, 27)]
CHEEK_L = [(11, 31), (24, 36), (32, 54)]
CHEEK_R = [(53, 31), (40, 36), (32, 54)]
EYES = [(25, 33), (39, 33)]
NOSE = (32, 49)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_color(t):
    if t < 0.5:
        return lerp(GRADIENT[0], GRADIENT[1], t * 2)
    return lerp(GRADIENT[1], GRADIENT[2], (t - 0.5) * 2)


def logo(size, background=True):
    scale = 4
    s = size * scale
    k = s / 64
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    if background:
        grad = Image.new("RGBA", (s, s))
        px = grad.load()
        for y in range(s):
            for x in range(s):
                t = (x + (s - y)) / (2 * s)
                px[x, y] = gradient_color(1 - t) + (255,)
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).ellipse([k * 2, k * 2, s - k * 2, s - k * 2], fill=255)
        img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    pts = lambda shape: [(x * k, y * k) for x, y in shape]
    d.polygon(pts(HEAD), fill=FACE)
    d.polygon(pts(CHEEK_L), fill=(255, 204, 128))
    d.polygon(pts(CHEEK_R), fill=(255, 204, 128))
    d.polygon(pts(EAR_L), fill=EAR)
    d.polygon(pts(EAR_R), fill=EAR)
    for x, y in EYES:
        d.ellipse([(x - 2.4) * k, (y - 2.4) * k, (x + 2.4) * k, (y + 2.4) * k], fill=DARK)
    x, y = NOSE
    d.ellipse([(x - 2.8) * k, (y - 2.4) * k, (x + 2.8) * k, (y + 2.4) * k], fill=DARK)
    return img.resize((size, size), Image.LANCZOS)


def svg():
    poly = lambda shape: " ".join(f"{x},{y}" for x, y in shape)
    stops = "".join(
        f'<stop offset="{i / 2}" stop-color="#{c[0]:02x}{c[1]:02x}{c[2]:02x}"/>'
        for i, c in enumerate(GRADIENT)
    )
    hexc = lambda c: "#%02x%02x%02x" % c
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">{stops}</linearGradient></defs>'
        '<circle cx="32" cy="32" r="30" fill="url(#g)"/>'
        f'<polygon points="{poly(HEAD)}" fill="{hexc(FACE)}"/>'
        f'<polygon points="{poly(CHEEK_L)}" fill="#ffcc80"/>'
        f'<polygon points="{poly(CHEEK_R)}" fill="#ffcc80"/>'
        f'<polygon points="{poly(EAR_L)}" fill="{hexc(EAR)}"/>'
        f'<polygon points="{poly(EAR_R)}" fill="{hexc(EAR)}"/>'
        + "".join(f'<circle cx="{x}" cy="{y}" r="2.4" fill="{hexc(DARK)}"/>' for x, y in EYES)
        + f'<ellipse cx="{NOSE[0]}" cy="{NOSE[1]}" rx="2.8" ry="2.4" fill="{hexc(DARK)}"/>'
        "</svg>\n"
    )


def wordmark():
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 99">'
        '<text x="0" y="78" font-family="system-ui, Segoe UI, Cantarell, sans-serif" '
        'font-size="88" font-weight="700" fill="context-fill">Offox</text></svg>\n'
    )


def font(size):
    for name in ["DejaVuSans-Bold.ttf", "arialbd.ttf", "LiberationSans-Bold.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def banner(size, logo_size, title=True):
    w, h = size
    img = Image.new("RGB", size, (255, 255, 255))
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = gradient_color(y / max(1, h - 1) * 0.9)
    mark = logo(logo_size)
    img.paste(mark, ((w - logo_size) // 2, (h - logo_size) // 3), mark)
    if title:
        d = ImageDraw.Draw(img)
        f = font(26)
        text = "Offox"
        tw = d.textlength(text, font=f)
        d.text(((w - tw) / 2, (h - logo_size) // 3 + logo_size + 12), text, font=f, fill=(255, 255, 255))
    return img


def header():
    img = Image.new("RGB", (150, 57), (255, 255, 255))
    mark = logo(45)
    img.paste(mark, (150 - 51, 6), mark)
    return img


def main():
    os.makedirs(os.path.join(OUT, "content"), exist_ok=True)
    os.makedirs(CONTENT, exist_ok=True)
    for n in [16, 22, 24, 32, 48, 64, 128, 256]:
        logo(n).save(os.path.join(OUT, f"default{n}.png"))
    big = logo(256)
    big.save(os.path.join(OUT, "firefox.ico"), sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
    logo(64).save(os.path.join(OUT, "firefox64.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    big.save(os.path.join(OUT, "pbmode.ico"), sizes=[(256, 256)])
    logo(32).save(os.path.join(OUT, "newwindow.ico"), sizes=[(16, 16), (32, 32)])
    logo(32).save(os.path.join(OUT, "newtab.ico"), sizes=[(16, 16), (32, 32)])
    for name, n in [("VisualElements_150.png", 300), ("VisualElements_70.png", 142),
                    ("PrivateBrowsing_150.png", 300), ("PrivateBrowsing_70.png", 142)]:
        logo(n).save(os.path.join(OUT, name))
    for name, n in [("about-logo.png", 192), ("about-logo@2x.png", 384),
                    ("about-logo-private.png", 192), ("about-logo-private@2x.png", 384)]:
        logo(n).save(os.path.join(OUT, "content", name))
    banner((300, 236), 120, title=False).save(os.path.join(OUT, "content", "about.png"))
    with open(os.path.join(OUT, "content", "about-logo.svg"), "w") as f:
        f.write(svg())
    for name in ["about-wordmark.svg", "firefox-wordmark.svg"]:
        with open(os.path.join(OUT, "content", name), "w") as f:
            f.write(wordmark())
    banner((164, 314), 110).save(os.path.join(OUT, "wizWatermark.bmp"))
    header().save(os.path.join(OUT, "wizHeader.bmp"))
    header().transpose(Image.FLIP_LEFT_RIGHT).save(os.path.join(OUT, "wizHeaderRTL.bmp"))
    banner((1440, 880), 360, title=False).save(os.path.join(OUT, "background.png"))
    # Linux desktop entry / RPM icon and the toolbar button.
    with open(os.path.join(CONTENT, "offox.svg"), "w") as f:
        f.write(svg())
    print("Branding written to", OUT)


if __name__ == "__main__":
    sys.exit(main())
