"""
Terminal X — Before/After archetype (transformation proof)
Generates 3 layouts x 3 formats per transformation.

Layouts:
  1-before.png  BLACK canvas, "ANTES" kicker, massive pain headline with crimson diagonal strike, pain_sub
  2-after.png   CRIMSON canvas, "AHORA" kicker, massive fix headline, fix_sub
  3-proof.png   CRIMSON canvas, "LA PRUEBA" kicker, massive BebasNeue METRIC plate, metric_label, WhatsApp CTA

Formats:
  feed_post  1080x1080
  story      1080x1920
  reel_cover 1080x1920

Usage:
  python generate.py                       # first transformation only, all 3 formats
  python generate.py --all                 # every transformation, every format
  python generate.py --slug cuadrar-caja   # one transformation, all 3 formats
  python generate.py --format feed_post    # limit to one format
"""
from PIL import Image, ImageDraw, ImageFont
import json, os, argparse, textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "..", "fonts")
CAL_PATH = os.path.join(HERE, "calendario.json")
OUT_DIR = os.path.join(HERE, "reference_renders")
LOGO_X = os.path.join(HERE, "..", "..", "packages", "ui", "assets", "logo.webp")

CRIMSON = (179, 0, 30)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)

BEBAS = os.path.join(FONTS, "BebasNeue-Regular.ttf")
TOMORROW_BOLD = os.path.join(FONTS, "Tomorrow-Bold.ttf")
TOMORROW_MED = os.path.join(FONTS, "Tomorrow-Medium.ttf")
INTER_MED = os.path.join(FONTS, "Inter-Medium.ttf")

FORMATS = {
    "feed_post":  (1080, 1080),
    "story":      (1080, 1920),
    "reel_cover": (1080, 1920),
}


def font(path, size):
    return ImageFont.truetype(path, size)


def center_text(draw, W, y, text, f, fill=WHITE, tracking=0):
    if tracking == 0:
        bbox = draw.textbbox((0, 0), text, font=f)
        w = bbox[2] - bbox[0]
        draw.text(((W - w) // 2, y), text, fill=fill, font=f)
        return bbox[3] - bbox[1]
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


def base_canvas(W, H, bg=CRIMSON):
    """Canvas with top/bottom black bars + TERMINAL X lockup + footer.
    bg = CRIMSON for normal brand mood, BLACK for "chaos" before slide."""
    img = Image.new("RGB", (W, H), bg)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    # scan lines — crimson-tinted on black (danger energy), black on crimson (subtle texture)
    line_color = (179, 0, 30, 26) if bg == BLACK else (0, 0, 0, 12)
    for y in range(0, H, 4):
        od.line([(0, y), (W, y)], fill=line_color, width=1)
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    BAR_H = 130 if H <= 1200 else 150

    # top bar (always black — lockup frame)
    draw.rectangle([(0, 0), (W, BAR_H)], fill=BLACK)
    draw.rectangle([(0, BAR_H), (W, BAR_H + 4)], fill=CRIMSON)

    # brand lockup
    f_brand = font(TOMORROW_BOLD, 44 if H <= 1200 else 48)
    brand_text = "TERMINAL"
    logo_w, logo_h = 0, 0
    logo_img = None
    if os.path.exists(LOGO_X):
        lg = Image.open(LOGO_X).convert("RGBA")
        target_h = 66 if H <= 1200 else 72
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

    bb = draw.textbbox((0, 0), brand_text, font=f_brand)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]
    gap = 10
    total_w = tw + gap + logo_w
    start_x = (W - total_w) // 2
    ty = (BAR_H - th) // 2 - 8
    draw.text((start_x, ty), brand_text, fill=WHITE, font=f_brand, spacing=6)
    if logo_img is not None:
        ly = (BAR_H - logo_h) // 2
        img.paste(logo_img, (start_x + tw + gap, ly), logo_img)

    # bottom bar
    draw.rectangle([(0, H - BAR_H), (W, H)], fill=BLACK)
    draw.rectangle([(0, H - BAR_H - 4), (W, H - BAR_H)], fill=CRIMSON)
    f_bar = font(TOMORROW_MED, 26 if H <= 1200 else 30)
    bar_text = "CERTIFICADO DGII   ·   wa.me/18098282971   ·   terminalxpos.com"
    bb = draw.textbbox((0, 0), bar_text, font=f_bar)
    bw = bb[2] - bb[0]
    bh = bb[3] - bb[1]
    draw.text(((W - bw) // 2, H - BAR_H + (BAR_H - bh) // 2 - 6),
              bar_text, fill=WHITE, font=f_bar)

    return img, draw, BAR_H


def autosize_wrap(draw, text, font_path, candidates, max_width_px, max_lines,
                  max_height_px=None, line_gap=18):
    """Pick largest font size from candidates that fits width + line count + height."""
    for size in candidates:
        f = font(font_path, size)
        words = text.split()
        lines, cur = [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            bb = draw.textbbox((0, 0), trial, font=f)
            if bb[2] - bb[0] <= max_width_px:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        if len(lines) > max_lines:
            continue
        if not all((draw.textbbox((0, 0), ln, font=f)[2] <= max_width_px) for ln in lines):
            continue
        if max_height_px is not None:
            line_h = int(size * 1.15)  # nominal em-height (bbox underestimates Tomorrow/Inter Bold)
            total_h = len(lines) * line_h + (len(lines) - 1) * line_gap
            if total_h > max_height_px:
                continue
        return f, lines, size
    f = font(font_path, candidates[-1])
    return f, textwrap.wrap(text, width=24), candidates[-1]


# ─── LAYOUTS ──────────────────────────────────────────────────────────────

def render_before(ann, fmt):
    """BLACK chaos canvas. ANTES kicker, massive pain headline with crimson diagonal strike, pain_sub."""
    W, H = FORMATS[fmt]
    img, draw, BAR_H = base_canvas(W, H, bg=BLACK)

    content_top = BAR_H + 40
    content_bot = H - BAR_H - 40

    # kicker — "ANTES" in crimson box (so it pops off black bg)
    f_kicker = font(TOMORROW_BOLD, 42 if H <= 1200 else 48)
    kicker_text = "ANTES"
    bb = draw.textbbox((0, 0), kicker_text, font=f_kicker)
    kw = bb[2] - bb[0]
    kh = bb[3] - bb[1]
    tracking = 14
    total_kw = kw + tracking * (len(kicker_text) - 1)
    box_pad_x = 32
    box_pad_y = 14
    box_w = total_kw + 2 * box_pad_x
    box_h = kh + 2 * box_pad_y + 10
    box_x = (W - box_w) // 2
    box_y = content_top + 20
    draw.rectangle([(box_x, box_y), (box_x + box_w, box_y + box_h)], fill=CRIMSON)
    center_text(draw, W, box_y + box_pad_y, kicker_text, f_kicker, fill=WHITE, tracking=tracking)

    # sub-block: pain_sub (1–2 lines) reserved at bottom
    f_sub = font(TOMORROW_MED, 34 if H <= 1200 else 40)
    sub_lines_max = 2
    sub_line_h = int((34 if H <= 1200 else 40) * 1.2)
    sub_block_h = sub_lines_max * sub_line_h + 70

    headline_top = box_y + box_h + 40
    headline_bot = content_bot - sub_block_h

    # pain headline — massive, WHITE on BLACK, with crimson diagonal strike through
    candidates = (
        [120, 105, 92, 82, 72, 64, 56] if H <= 1200
        else [220, 190, 165, 145, 125, 110, 96, 84]
    )
    max_lines = 4 if H <= 1200 else 5
    side_pad = 80
    line_gap = 18 if H <= 1200 else 24
    zone_h_avail = headline_bot - headline_top
    f_h, lines, chosen_size = autosize_wrap(
        draw, ann["pain"].upper(), TOMORROW_BOLD,
        candidates, W - 2 * side_pad, max_lines,
        max_height_px=zone_h_avail, line_gap=line_gap
    )
    line_h = int(chosen_size * 1.15)
    total_h = len(lines) * line_h + (len(lines) - 1) * line_gap
    y = headline_top + (zone_h_avail - total_h) // 2

    # draw headline first
    line_positions = []  # store (y, text, width) for strike
    for ln in lines:
        lbb = draw.textbbox((0, 0), ln, font=f_h)
        lw = lbb[2] - lbb[0]
        x = (W - lw) // 2
        draw.text((x, y), ln, fill=WHITE, font=f_h)
        line_positions.append((x, y, lw, line_h))
        y += line_h + line_gap

    # crimson diagonal strike across the whole headline block (top-left to bottom-right)
    if line_positions:
        first_x, first_y, _, _ = line_positions[0]
        last_x, last_y, last_w, last_lh = line_positions[-1]
        block_top = first_y + int(line_h * 0.15)
        block_bot = last_y + last_lh + int(line_h * 0.1)
        block_left = min(lp[0] for lp in line_positions) - 20
        block_right = max(lp[0] + lp[2] for lp in line_positions) + 20
        strike_w = 14 if H <= 1200 else 20
        # diagonal line: top-left → bottom-right
        draw.line(
            [(block_left, block_top), (block_right, block_bot)],
            fill=CRIMSON, width=strike_w
        )

    # pain_sub
    sub_lines = textwrap.wrap(ann["pain_sub"], width=36 if H <= 1200 else 42)
    sy = content_bot - sub_block_h + 10
    for ln in sub_lines[:sub_lines_max]:
        lbb = draw.textbbox((0, 0), ln, font=f_sub)
        lw = lbb[2] - lbb[0]
        draw.text(((W - lw) // 2, sy), ln, fill=WHITE, font=f_sub)
        sy += sub_line_h

    return img


def render_after(ann, fmt):
    """CRIMSON canvas. AHORA kicker, massive fix headline (protagonist), fix_sub."""
    W, H = FORMATS[fmt]
    img, draw, BAR_H = base_canvas(W, H, bg=CRIMSON)

    content_top = BAR_H + 40
    content_bot = H - BAR_H - 40

    # kicker — "AHORA" in white box (inverts brand: AFTER = solved = brand wins)
    f_kicker = font(TOMORROW_BOLD, 42 if H <= 1200 else 48)
    kicker_text = "AHORA"
    bb = draw.textbbox((0, 0), kicker_text, font=f_kicker)
    kw = bb[2] - bb[0]
    kh = bb[3] - bb[1]
    tracking = 14
    total_kw = kw + tracking * (len(kicker_text) - 1)
    box_pad_x = 32
    box_pad_y = 14
    box_w = total_kw + 2 * box_pad_x
    box_h = kh + 2 * box_pad_y + 10
    box_x = (W - box_w) // 2
    box_y = content_top + 20
    draw.rectangle([(box_x, box_y), (box_x + box_w, box_y + box_h)], fill=WHITE)
    center_text(draw, W, box_y + box_pad_y, kicker_text, f_kicker, fill=CRIMSON, tracking=tracking)

    f_sub = font(TOMORROW_MED, 34 if H <= 1200 else 40)
    sub_lines_max = 2
    sub_line_h = int((34 if H <= 1200 else 40) * 1.2)
    sub_block_h = sub_lines_max * sub_line_h + 70

    headline_top = box_y + box_h + 40
    headline_bot = content_bot - sub_block_h

    candidates = (
        [120, 105, 92, 82, 72, 64, 56] if H <= 1200
        else [220, 190, 165, 145, 125, 110, 96, 84]
    )
    max_lines = 4 if H <= 1200 else 5
    side_pad = 80
    line_gap = 18 if H <= 1200 else 24
    zone_h_avail = headline_bot - headline_top
    f_h, lines, chosen_size = autosize_wrap(
        draw, ann["fix"].upper(), TOMORROW_BOLD,
        candidates, W - 2 * side_pad, max_lines,
        max_height_px=zone_h_avail, line_gap=line_gap
    )
    line_h = int(chosen_size * 1.15)
    total_h = len(lines) * line_h + (len(lines) - 1) * line_gap
    y = headline_top + (zone_h_avail - total_h) // 2
    for ln in lines:
        lbb = draw.textbbox((0, 0), ln, font=f_h)
        lw = lbb[2] - lbb[0]
        draw.text(((W - lw) // 2, y), ln, fill=WHITE, font=f_h)
        y += line_h + line_gap

    # fix_sub
    sub_lines = textwrap.wrap(ann["fix_sub"], width=36 if H <= 1200 else 42)
    sy = content_bot - sub_block_h + 10
    for ln in sub_lines[:sub_lines_max]:
        lbb = draw.textbbox((0, 0), ln, font=f_sub)
        lw = lbb[2] - lbb[0]
        draw.text(((W - lw) // 2, sy), ln, fill=WHITE, font=f_sub)
        sy += sub_line_h

    return img


def render_proof(ann, fmt):
    """CRIMSON canvas. LA PRUEBA kicker, massive BebasNeue METRIC plate (race-car protagonist), metric_label, WhatsApp CTA."""
    W, H = FORMATS[fmt]
    img, draw, BAR_H = base_canvas(W, H, bg=CRIMSON)

    content_top = BAR_H + 40
    content_bot = H - BAR_H - 40

    # kicker
    f_kicker = font(TOMORROW_BOLD, 42 if H <= 1200 else 48)
    kicker_y = content_top + 20
    center_text(draw, W, kicker_y, "LA PRUEBA", f_kicker, fill=WHITE, tracking=14)
    rule_y = kicker_y + 72
    draw.rectangle([(W // 2 - 80, rule_y), (W // 2 + 80, rule_y + 6)], fill=WHITE)

    # reserve button + metric_label
    btn_w = 860 if H <= 1200 else 920
    btn_h = 140 if H <= 1200 else 170
    btn_x = (W - btn_w) // 2
    btn_y = content_bot - btn_h - 40

    f_label = font(TOMORROW_MED, 34 if H <= 1200 else 42)
    bb_l = draw.textbbox((0, 0), "Ag", font=f_label)
    label_h = bb_l[3] - bb_l[1]
    label_reserve = label_h + 80  # above button

    plate_top = rule_y + 40
    plate_bot = btn_y - label_reserve

    # massive METRIC plate — BebasNeue race-car energy, fit height AND width
    plate = ann["metric"].upper()
    side_pad = 60
    max_plate_h = plate_bot - plate_top
    candidates = (
        [420, 360, 320, 280, 240, 200, 170] if H <= 1200
        else [720, 640, 560, 480, 400, 340, 280]
    )
    f_plate = None
    for size in candidates:
        f = font(BEBAS, size)
        bb = draw.textbbox((0, 0), plate, font=f)
        if (bb[2] - bb[0]) <= (W - 2 * side_pad) and (bb[3] - bb[1]) <= max_plate_h:
            f_plate = f
            break
    if f_plate is None:
        f_plate = font(BEBAS, candidates[-1])
    bb = draw.textbbox((0, 0), plate, font=f_plate)
    pw = bb[2] - bb[0]
    ph = bb[3] - bb[1]
    px = (W - pw) // 2 - bb[0]
    py = plate_top + (max_plate_h - ph) // 2 - bb[1]
    draw.text((px, py), plate, fill=WHITE, font=f_plate)

    # metric_label — above button
    label_y = btn_y - label_reserve + 20
    center_text(draw, W, label_y, ann["metric_label"].upper(), f_label, fill=WHITE, tracking=4)

    # button
    draw.rectangle([(btn_x, btn_y), (btn_x + btn_w, btn_y + btn_h)], fill=WHITE)
    f_btn = font(TOMORROW_BOLD, 48 if H <= 1200 else 56)
    btn_text = "WhatsApp  +1 809-828-2971"
    bb = draw.textbbox((0, 0), btn_text, font=f_btn)
    bw = bb[2] - bb[0]
    bh = bb[3] - bb[1]
    draw.text((btn_x + (btn_w - bw) // 2, btn_y + (btn_h - bh) // 2 - 8),
              btn_text, fill=CRIMSON, font=f_btn)

    return img


LAYOUTS = {
    "1-before": render_before,
    "2-after":  render_after,
    "3-proof":  render_proof,
}


def render_transformation(ann, formats):
    out = os.path.join(OUT_DIR, ann["slug"])
    os.makedirs(out, exist_ok=True)
    for fmt in formats:
        fmt_dir = os.path.join(out, fmt)
        os.makedirs(fmt_dir, exist_ok=True)
        for name, fn in LAYOUTS.items():
            img = fn(ann, fmt)
            path = os.path.join(fmt_dir, f"{name}.png")
            img.save(path, "PNG", optimize=True)
            print(f"  {ann['slug']}/{fmt}/{name}.png")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--slug", type=str)
    ap.add_argument("--format", type=str, choices=list(FORMATS.keys()))
    args = ap.parse_args()

    with open(CAL_PATH, "r", encoding="utf-8") as f:
        cal = json.load(f)

    anns = cal["transformations"]
    if args.slug:
        anns = [a for a in anns if a["slug"] == args.slug]
    elif not args.all:
        anns = anns[:1]

    formats = [args.format] if args.format else list(FORMATS.keys())

    print(f"Rendering {len(anns)} transformation(s) x {len(formats)} format(s)...")
    for a in anns:
        render_transformation(a, formats)
    print("Done.")


if __name__ == "__main__":
    main()
