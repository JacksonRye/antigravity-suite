#!/usr/bin/env python3
"""Generates clean, modern glowing orb icons for the Chrome extension."""
import os
from PIL import Image, ImageDraw

def create_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = size * 0.08
    center = size / 2.0
    radius = (size - 2 * margin) / 2.0

    steps = 15
    for i in range(steps):
        r = radius * (1.0 - (i / steps) * 0.4)
        alpha = int(80 + (i / steps) * 175)
        r_col = int(99 + (i / steps) * 40)
        g_col = int(102 + (i / steps) * 120)
        b_col = int(241 + (i / steps) * 14)
        draw.ellipse(
            [center - r, center - r, center + r, center + r],
            fill=(r_col, g_col, b_col, alpha)
        )

    core_r = radius * 0.35
    draw.ellipse(
        [center - core_r * 0.8, center - core_r * 1.1, center + core_r * 0.8, center + core_r * 0.5],
        fill=(255, 255, 255, 180)
    )

    return img

icons_dir = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(icons_dir, exist_ok=True)

for s in [16, 48, 128]:
    icon = create_icon(s)
    path = os.path.join(icons_dir, f"icon-{s}.png")
    icon.save(path, "PNG")
    print(f"Generated {path} ({s}x{s})")
