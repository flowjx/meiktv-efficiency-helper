"""生成插件图标 icons/icon{16,32,48,128}.png。

设计（2026-11-16 选定的 B 方案）：玫红→紫色渐变圆角方块 + 白色闪电（提效）+ 右上角小黄星。
16px 单独出一版：去掉小星星、闪电放大，保证工具栏上清晰。
用法（插件目录执行）：python scripts/make_icon.py
"""
import math
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
S = 1024  # 先画大图再缩小，边缘更平滑
TOP, BOTTOM = (255, 79, 129), (156, 39, 176)


def rounded_gradient(radius):
    grad = Image.new("RGBA", (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)) + (255,)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius, fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def bolt(draw, box, fill):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    pts = [(0.58, 0), (0.12, 0.56), (0.46, 0.56), (0.36, 1), (0.88, 0.40), (0.54, 0.40), (0.70, 0)]
    draw.polygon([(x0 + px * w, y0 + py * h) for px, py in pts], fill=fill)


def star(draw, cx, cy, r, fill):
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.42
        a = math.radians(-90 + i * 36)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    draw.polygon(pts, fill=fill)


def full_icon():
    im = rounded_gradient(S * 0.23)
    d = ImageDraw.Draw(im)
    bolt(d, (S * 0.24, S * 0.14, S * 0.76, S * 0.86), (255, 255, 255, 255))
    star(d, S * 0.80, S * 0.22, S * 0.09, (255, 224, 102, 255))
    return im


def small_icon():
    im = rounded_gradient(S * 0.22)
    bolt(ImageDraw.Draw(im), (S * 0.18, S * 0.08, S * 0.82, S * 0.92), (255, 255, 255, 255))
    return im


def main():
    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    full = full_icon()
    for size in (128, 48, 32):
        full.resize((size, size), Image.LANCZOS).save(out / f"icon{size}.png", optimize=True)
    small_icon().resize((16, 16), Image.LANCZOS).save(out / "icon16.png", optimize=True)
    print("已生成 icons/icon16/32/48/128.png")


if __name__ == "__main__":
    main()
