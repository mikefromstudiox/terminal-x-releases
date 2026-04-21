"""
Terminal X — Countdown e-CF Obligatorio
Generates IG carousel posts (1080x1350) for T-25 → T-0.

Template: crimson #b3001e background, white type, black bottom bar.
Three layouts per day:
  1-number.png  — portada: giant day number
  2-hook.png    — pregunta/hook
  3-answer.png  — respuesta + CTA WhatsApp

Usage:
  python generate.py              # gate: only T-25 (3 PNGs)
  python generate.py --all        # full batch: 78 PNGs
  python generate.py --t 14       # single day
"""
from PIL import Image, ImageDraw, ImageFont
import json, os, sys, argparse, textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "..", "fonts")
CAL_PATH = os.path.join(HERE, "calendario.json")
OUT_DIR = os.path.join(HERE, "images")
XMARK = os.path.join(HERE, "..", "..", "packages", "ui", "assets", "x-mark.png")
LOGO_X = os.path.join(HERE, "..", "..", "packages", "ui", "assets", "logo.webp")

W, H = 1080, 1350
CRIMSON = (179, 0, 30)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
WHITE_SOFT = (255, 255, 255, 200)

BEBAS = os.path.join(FONTS, "BebasNeue-Regular.ttf")
TOMORROW_BOLD = os.path.join(FONTS, "Tomorrow-Bold.ttf")
TOMORROW_MED = os.path.join(FONTS, "Tomorrow-Medium.ttf")
SPACE_BOLD = os.path.join(FONTS, "SpaceGrotesk-Bold.ttf")
INTER_MED = os.path.join(FONTS, "Inter-Medium.ttf")


def font(path, size):
    return ImageFont.truetype(path, size)


def center_text(draw, y, text, f, fill=WHITE, tracking=0):
    """Draw text centered at y. tracking = extra px between chars."""
    if tracking == 0:
        bbox = draw.textbbox((0, 0), text, font=f)
        w = bbox[2] - bbox[0]
        draw.text(((W - w) // 2, y), text, fill=fill, font=f)
        return bbox[3] - bbox[1]
    # manual letter-spacing
    widths = [draw.textbbox((0, 0), c, font=f)[2] for c in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = (W - total) // 2
    max_h = 0
    for i, c in enumerate(text):
        draw.text((x, y), c, fill=fill, font=f)
        bb = draw.textbbox((0, 0), c, font=f)
        max_h = max(max_h, bb[3] - bb[1])
        x += widths[i] + tracking
    return max_h


def wrap_center(draw, y, text, f, fill=WHITE, max_chars=22, line_gap=12):
    lines = textwrap.wrap(text, width=max_chars, break_long_words=False)
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=f)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        draw.text(((W - w) // 2, y), line, fill=fill, font=f)
        y += h + line_gap
    return y


def base_canvas():
    """Crimson bg + top X logo + bottom black bar with CERTIFICADO DGII · WhatsApp · domain."""
    img = Image.new("RGB", (W, H), CRIMSON)
    draw = ImageDraw.Draw(img)

    # Subtle texture: horizontal scan lines (very faint)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, H, 4):
        od.line([(0, y), (W, y)], fill=(0, 0, 0, 12), width=1)
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    BAR_H = 130

    # ─── Top black header bar (mirrors footer — race-car plate feel) ───
    draw.rectangle([(0, 0), (W, BAR_H)], fill=BLACK)
    # Thin crimson accent BELOW top bar
    draw.rectangle([(0, BAR_H), (W, BAR_H + 4)], fill=CRIMSON)

    # Brand lockup inside top bar: "TERMINAL" + X logo (same as POS sidebar)
    f_brand = font(TOMORROW_BOLD, 44)
    brand_text = "TERMINAL"
    # Load logo X as white
    logo_w, logo_h = 0, 0
    logo_img = None
    if os.path.exists(LOGO_X):
        lg = Image.open(LOGO_X).convert("RGBA")
        # Scale to brand text height ~60px tall
        target_h = 66
        ratio = target_h / lg.height
        new_w = int(lg.width * ratio)
        lg = lg.resize((new_w, target_h), Image.LANCZOS)
        px = lg.load()
        for yy in range(lg.height):
            for xx in range(lg.width):
                r, g, b, a = px[xx, yy]
                if a > 30 and r > 80 and g < 80 and b < 80:
                    px[xx, yy] = (179, 0, 30, 255)
                else:
                    px[xx, yy] = (0, 0, 0, 0)
        logo_img = lg
        logo_w, logo_h = lg.size

    # Measure brand text
    bb = draw.textbbox((0, 0), brand_text, font=f_brand)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]
    gap = 10
    total_w = tw + gap + logo_w
    start_x = (W - total_w) // 2
    # Vertically center in BAR_H
    ty = (BAR_H - th) // 2 - 8
    draw.text((start_x, ty), brand_text, fill=WHITE, font=f_brand, spacing=6)
    # Add manual letter-spacing feel via tracking replicate
    if logo_img is not None:
        ly = (BAR_H - logo_h) // 2
        img.paste(logo_img, (start_x + tw + gap, ly), logo_img)

    # ─── Bottom black footer bar ───
    draw.rectangle([(0, H - BAR_H), (W, H)], fill=BLACK)
    # Thin crimson accent ABOVE footer bar
    draw.rectangle([(0, H - BAR_H - 4), (W, H - BAR_H)], fill=CRIMSON)

    f_bar = font(TOMORROW_MED, 26)
    bar_text = "CERTIFICADO DGII   ·   wa.me/18098282971   ·   terminalxpos.com"
    bb = draw.textbbox((0, 0), bar_text, font=f_bar)
    bw = bb[2] - bb[0]
    bh = bb[3] - bb[1]
    draw.text(((W - bw) // 2, H - BAR_H + (BAR_H - bh) // 2 - 6), bar_text, fill=WHITE, font=f_bar)

    return img, draw


def render_number(t_value):
    img, draw = base_canvas()

    # FALTAN — centered between header bottom (~134) and number visual top (~310)
    f_label = font(TOMORROW_MED, 42)
    center_text(draw, 222, "FALTAN", f_label, fill=WHITE, tracking=18)

    # MASSIVE number — race-car plate style
    num_str = str(t_value)
    # BebasNeue condensed, pick size that fills. 2-digit = smaller, 1-digit = bigger.
    num_size = 820 if len(num_str) == 1 else 780
    f_num = font(BEBAS, num_size)
    bbox = draw.textbbox((0, 0), num_str, font=f_num)
    nw = bbox[2] - bbox[0]
    nh = bbox[3] - bbox[1]
    nx = (W - nw) // 2 - bbox[0]
    # Vertical center in zone 240 → 1080
    zone_top, zone_bot = 230, 1060
    ny = zone_top + (zone_bot - zone_top - nh) // 2 - bbox[1]
    draw.text((nx, ny), num_str, fill=WHITE, font=f_num)

    # Subtitle
    f_sub = font(TOMORROW_BOLD, 48)
    center_text(draw, 1090, "DÍAS PARA E-CF OBLIGATORIO", f_sub, fill=WHITE, tracking=2)

    # Deadline stamp
    f_stamp = font(INTER_MED, 26)
    center_text(draw, 1160, "15 DE MAYO 2026  ·  DGII LEY 32-23", f_stamp, fill=WHITE, tracking=2)

    return img


def render_hook(t_value, hook_text):
    img, draw = base_canvas()

    # Tag
    f_tag = font(TOMORROW_BOLD, 38)
    center_text(draw, 200, f"T-{t_value}", f_tag, fill=WHITE, tracking=8)
    draw.rectangle([(W // 2 - 80, 278), (W // 2 + 80, 284)], fill=WHITE)

    # Hook text — THE image. Massive, dominates the canvas.
    n = len(hook_text)
    if n <= 20:
        f_hook = font(TOMORROW_BOLD, 140)
        max_chars = 12
    elif n <= 35:
        f_hook = font(TOMORROW_BOLD, 112)
        max_chars = 14
    elif n <= 55:
        f_hook = font(TOMORROW_BOLD, 92)
        max_chars = 17
    elif n <= 80:
        f_hook = font(TOMORROW_BOLD, 76)
        max_chars = 20
    else:
        f_hook = font(TOMORROW_BOLD, 64)
        max_chars = 24

    lines = textwrap.wrap(hook_text, width=max_chars, break_long_words=False)
    line_gap = 20
    bb = draw.textbbox((0, 0), "Ag", font=f_hook)
    line_h = bb[3] - bb[1]
    total_h = len(lines) * line_h + (len(lines) - 1) * line_gap
    zone_top, zone_bot = 330, 1080
    y = zone_top + (zone_bot - zone_top - total_h) // 2
    for line in lines:
        lbb = draw.textbbox((0, 0), line, font=f_hook)
        lw = lbb[2] - lbb[0]
        draw.text(((W - lw) // 2, y), line, fill=WHITE, font=f_hook)
        y += line_h + line_gap

    # Swipe hint
    f_hint = font(TOMORROW_MED, 30)
    center_text(draw, H - 200, "DESLIZA  >>", f_hint, fill=WHITE, tracking=8)

    return img


def render_answer(t_value, answer_text):
    img, draw = base_canvas()

    # Tag
    f_tag = font(TOMORROW_BOLD, 38)
    center_text(draw, 200, f"T-{t_value}  ·  RESPUESTA", f_tag, fill=WHITE, tracking=6)
    draw.rectangle([(W // 2 - 80, 278), (W // 2 + 80, 284)], fill=WHITE)

    # Answer text — THE image. Massive, dominates the canvas.
    n = len(answer_text)
    if n <= 20:
        f_ans = font(TOMORROW_BOLD, 140)
        max_chars = 12
    elif n <= 35:
        f_ans = font(TOMORROW_BOLD, 112)
        max_chars = 14
    elif n <= 55:
        f_ans = font(TOMORROW_BOLD, 92)
        max_chars = 17
    elif n <= 80:
        f_ans = font(TOMORROW_BOLD, 76)
        max_chars = 20
    else:
        f_ans = font(TOMORROW_BOLD, 64)
        max_chars = 24

    # Vertically center answer in zone 320 → 980
    lines = textwrap.wrap(answer_text, width=max_chars, break_long_words=False)
    line_gap = 20
    bb = draw.textbbox((0, 0), "Ag", font=f_ans)
    line_h = bb[3] - bb[1]
    total_h = len(lines) * line_h + (len(lines) - 1) * line_gap
    zone_top, zone_bot = 330, 980
    y = zone_top + (zone_bot - zone_top - total_h) // 2
    for line in lines:
        lbb = draw.textbbox((0, 0), line, font=f_ans)
        lw = lbb[2] - lbb[0]
        draw.text(((W - lw) // 2, y), line, fill=WHITE, font=f_ans)
        y += line_h + line_gap

    # White CTA button — kept
    btn_w, btn_h = 820, 130
    btn_x = (W - btn_w) // 2
    btn_y = 1020
    draw.rectangle([(btn_x, btn_y), (btn_x + btn_w, btn_y + btn_h)], fill=WHITE)
    f_btn = font(TOMORROW_BOLD, 48)
    btn_text = "WhatsApp  +1 809-828-2971"
    bb = draw.textbbox((0, 0), btn_text, font=f_btn)
    bw = bb[2] - bb[0]
    bh = bb[3] - bb[1]
    draw.text((btn_x + (btn_w - bw) // 2, btn_y + (btn_h - bh) // 2 - 8),
              btn_text, fill=CRIMSON, font=f_btn)

    return img


def render_day(day):
    t = day["t"]
    out = os.path.join(OUT_DIR, f"T-{t:02d}")
    os.makedirs(out, exist_ok=True)

    img1 = render_number(t)
    img1.save(os.path.join(out, "1-number.png"), "PNG", optimize=True)

    img2 = render_hook(t, day["hook"])
    img2.save(os.path.join(out, "2-hook.png"), "PNG", optimize=True)

    img3 = render_answer(t, day["answer"])
    img3.save(os.path.join(out, "3-answer.png"), "PNG", optimize=True)

    print(f"  T-{t:02d}  {day['date']}  -> {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="render all 26 days")
    ap.add_argument("--t", type=int, help="render specific T value")
    args = ap.parse_args()

    with open(CAL_PATH, "r", encoding="utf-8") as f:
        cal = json.load(f)

    days = cal["days"]
    if args.t is not None:
        days = [d for d in days if d["t"] == args.t]
    elif not args.all:
        days = [d for d in days if d["t"] == 25]  # gate default

    print(f"Rendering {len(days)} day(s)...")
    for d in days:
        render_day(d)
    print("Done.")


if __name__ == "__main__":
    main()
