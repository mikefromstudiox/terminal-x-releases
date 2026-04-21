"""
Terminal X — Announcement archetype
Generates 3 layouts x 3 formats per announcement.

Layouts:
  1-reveal.png   kicker + massive headline + subhead + date stamp
  2-details.png  "QUE INCLUYE" + 3 bullet blocks
  3-cta.png      availability + WhatsApp button

Formats:
  feed_post  1080x1080
  story      1080x1920
  reel_cover 1080x1920

Usage:
  python generate.py                      # first announcement only, all 3 formats
  python generate.py --all                # every announcement, every format
  python generate.py --slug pedidos-ya    # one announcement, all 3 formats
  python generate.py --format feed_post   # limit to one format
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
SPACE_BOLD = os.path.join(FONTS, "SpaceGrotesk-Bold.ttf")
INTER_MED = os.path.join(FONTS, "Inter-Medium.ttf")
PLAYFAIR = os.path.join(FONTS, "PlayfairDisplay-Bold.ttf")

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


def base_canvas(W, H):
    """Crimson bg + scan lines + top/bottom black bars + TERMINAL X lockup + footer."""
    img = Image.new("RGB", (W, H), CRIMSON)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, H, 4):
        od.line([(0, y), (W, y)], fill=(0, 0, 0, 12), width=1)
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    BAR_H = 130 if H <= 1200 else 150

    # top bar
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
    """Pick largest font size from candidates that fits max_lines AND max_height_px."""
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
            bb_h = draw.textbbox((0, 0), "Ag", font=f)
            line_h = bb_h[3] - bb_h[1]
            total_h = len(lines) * line_h + (len(lines) - 1) * line_gap
            if total_h > max_height_px:
                continue
        return f, lines
    f = font(font_path, candidates[-1])
    return f, textwrap.wrap(text, width=24)


# ─── LAYOUTS ──────────────────────────────────────────────────────────────

def render_reveal(ann, fmt):
    W, H = FORMATS[fmt]
    img, draw, BAR_H = base_canvas(W, H)

    content_top = BAR_H + 40
    content_bot = H - BAR_H - 40

    # kicker
    f_kicker = font(TOMORROW_BOLD, 42 if H <= 1200 else 48)
    kicker_y = content_top + 20
    center_text(draw, W, kicker_y, ann["kicker"], f_kicker, fill=WHITE, tracking=14)
    # rule under kicker
    rule_y = kicker_y + 72
    draw.rectangle([(W // 2 - 80, rule_y), (W // 2 + 80, rule_y + 6)], fill=WHITE)

    # subhead (small one-liner below headline) + date stamp reserved at bottom
    f_sub = font(TOMORROW_MED, 34 if H <= 1200 else 40)
    f_stamp = font(INTER_MED, 24 if H <= 1200 else 30)

    # reserve space: subhead block ~2 lines, stamp 1 line, plus generous gap
    sub_lines_max = 2
    bb_sub = draw.textbbox((0, 0), "Ag", font=f_sub)
    sub_line_h = bb_sub[3] - bb_sub[1]
    sub_block_h = sub_lines_max * sub_line_h + 30 + 50 + 60  # subhead + gap + stamp + breathing
    headline_top = rule_y + 60
    headline_bot = content_bot - sub_block_h

    # headline — massive protagonist
    candidates = (
        [120, 105, 92, 82, 72, 64, 56] if H <= 1200
        else [220, 190, 165, 145, 125, 110, 96, 84]
    )
    max_lines = 4 if H <= 1200 else 5
    side_pad = 80
    line_gap = 18 if H <= 1200 else 24
    zone_h_avail = headline_bot - headline_top
    f_h, lines = autosize_wrap(draw, ann["headline"].upper(), TOMORROW_BOLD,
                               candidates, W - 2 * side_pad, max_lines,
                               max_height_px=zone_h_avail, line_gap=line_gap)
    bb = draw.textbbox((0, 0), "Ag", font=f_h)
    line_h = bb[3] - bb[1]
    total_h = len(lines) * line_h + (len(lines) - 1) * line_gap
    zone_h = headline_bot - headline_top
    y = headline_top + (zone_h - total_h) // 2
    for ln in lines:
        lbb = draw.textbbox((0, 0), ln, font=f_h)
        lw = lbb[2] - lbb[0]
        draw.text(((W - lw) // 2, y), ln, fill=WHITE, font=f_h)
        y += line_h + line_gap

    # subhead
    sub_lines = textwrap.wrap(ann["subhead"], width=36 if H <= 1200 else 42)
    sy = content_bot - sub_block_h + 10
    for ln in sub_lines[:sub_lines_max]:
        lbb = draw.textbbox((0, 0), ln, font=f_sub)
        lw = lbb[2] - lbb[0]
        draw.text(((W - lw) // 2, sy), ln, fill=WHITE, font=f_sub)
        sy += sub_line_h + 10

    # stamp
    stamp = f"{ann['cta_date'].upper()}   ·   {ann['date']}"
    center_text(draw, W, content_bot - 40, stamp, f_stamp, fill=WHITE, tracking=3)

    return img


def render_details(ann, fmt):
    W, H = FORMATS[fmt]
    img, draw, BAR_H = base_canvas(W, H)

    content_top = BAR_H + 40
    content_bot = H - BAR_H - 40

    f_tag = font(TOMORROW_BOLD, 42 if H <= 1200 else 48)
    tag_y = content_top + 20
    center_text(draw, W, tag_y, "QUE INCLUYE", f_tag, fill=WHITE, tracking=14)
    rule_y = tag_y + 72
    draw.rectangle([(W // 2 - 80, rule_y), (W // 2 + 80, rule_y + 6)], fill=WHITE)

    # 3 bullet blocks — cards hug text height, vertically centered as a group
    bullets = ann["bullets"][:3]
    zone_top = rule_y + 60
    zone_bot = content_bot - 20
    zone_h = zone_bot - zone_top
    gap = 30 if H <= 1200 else 44
    side_pad = 60
    card_w = W - 2 * side_pad
    num_col_w = 140
    v_pad = 26 if H <= 1200 else 70  # top/bottom padding inside each card
    body_max_w = card_w - num_col_w - 30

    # pick largest body font that keeps each bullet <= 2 lines and fits width
    candidates = (
        [56, 50, 44, 38, 34, 30] if H <= 1200
        else [72, 64, 58, 52, 46, 40]
    )
    f_body = None
    wrapped = None
    for size in candidates:
        f = font(TOMORROW_BOLD, size)
        ok, tmp = True, []
        for b in bullets:
            words = b.split()
            lines, cur = [], ""
            for w in words:
                trial = (cur + " " + w).strip()
                if draw.textbbox((0, 0), trial, font=f)[2] <= body_max_w:
                    cur = trial
                else:
                    if cur: lines.append(cur)
                    cur = w
            if cur: lines.append(cur)
            if len(lines) > 2 or any(draw.textbbox((0,0),l,font=f)[2] > body_max_w for l in lines):
                ok = False
                break
            tmp.append(lines)
        if ok:
            f_body = f
            wrapped = tmp
            break
    if f_body is None:
        f_body = font(TOMORROW_BOLD, candidates[-1])
        wrapped = [textwrap.wrap(b, width=22) for b in bullets]

    bb = draw.textbbox((0, 0), "Ag", font=f_body)
    lh = bb[3] - bb[1]
    line_gap_body = 8

    # compute each card height from its text
    card_heights = []
    for lines in wrapped:
        text_h = len(lines) * lh + (len(lines) - 1) * line_gap_body
        card_heights.append(text_h + 2 * v_pad)

    total_block_h = sum(card_heights) + gap * (len(bullets) - 1)
    # ensure fits; if taller than zone, scale padding down (fallback)
    if total_block_h > zone_h:
        overflow = total_block_h - zone_h
        shave = min(v_pad - 10, overflow // (2 * len(bullets)) + 1)
        v_pad_new = max(10, v_pad - shave)
        card_heights = []
        for lines in wrapped:
            text_h = len(lines) * lh + (len(lines) - 1) * line_gap_body
            card_heights.append(text_h + 2 * v_pad_new)
        total_block_h = sum(card_heights) + gap * (len(bullets) - 1)

    # vertically center the whole block in the zone
    y = zone_top + max(0, (zone_h - total_block_h) // 2)

    for i, (b_lines, ch) in enumerate(zip(wrapped, card_heights), start=1):
        # card bg
        draw.rectangle([(side_pad, y), (side_pad + card_w, y + ch)], fill=WHITE)
        # crimson number column
        draw.rectangle([(side_pad, y), (side_pad + num_col_w, y + ch)], fill=CRIMSON)
        # number sized to card height — Tomorrow Bold so all digits read same weight
        f_num = font(TOMORROW_BOLD, int(ch * 0.62))
        num = str(i)
        nb = draw.textbbox((0, 0), num, font=f_num)
        nw = nb[2] - nb[0]
        nh = nb[3] - nb[1]
        nx = side_pad + (num_col_w - nw) // 2 - nb[0]
        ny = y + (ch - nh) // 2 - nb[1]
        draw.text((nx, ny), num, fill=WHITE, font=f_num)

        # body centered vertically inside card
        text_h = len(b_lines) * lh + (len(b_lines) - 1) * line_gap_body
        by = y + (ch - text_h) // 2
        bx = side_pad + num_col_w + 30
        for ln in b_lines:
            draw.text((bx, by), ln, fill=BLACK, font=f_body)
            by += lh + line_gap_body

        y += ch + gap

    return img


def render_cta(ann, fmt):
    W, H = FORMATS[fmt]
    img, draw, BAR_H = base_canvas(W, H)

    content_top = BAR_H + 40
    content_bot = H - BAR_H - 40

    f_tag = font(TOMORROW_BOLD, 42 if H <= 1200 else 48)
    tag_y = content_top + 20
    center_text(draw, W, tag_y, ann["cta_label"].upper(), f_tag, fill=WHITE, tracking=14)
    rule_y = tag_y + 72
    draw.rectangle([(W // 2 - 80, rule_y), (W // 2 + 80, rule_y + 6)], fill=WHITE)

    # sublabel under rule (NOT under plate — avoids collision with descender of huge plate)
    f_sub = font(TOMORROW_MED, 34 if H <= 1200 else 42)
    sub_text = f"DISPONIBLE {ann['date']}"
    sub_y = rule_y + 40
    center_text(draw, W, sub_y, sub_text, f_sub, fill=WHITE, tracking=4)
    bb_sub = draw.textbbox((0, 0), sub_text, font=f_sub)
    sub_h = bb_sub[3] - bb_sub[1]

    # reserve button
    btn_w = 860 if H <= 1200 else 920
    btn_h = 140 if H <= 1200 else 170
    btn_x = (W - btn_w) // 2
    btn_y = content_bot - btn_h - 40

    plate_top = sub_y + sub_h + 40
    plate_bot = btn_y - 40

    # massive VERSION / date plate (cap height-fit so it doesn't overshoot zone)
    plate = ann["cta_date"].upper()
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
    "1-reveal":  render_reveal,
    "2-details": render_details,
    "3-cta":     render_cta,
}


def render_announcement(ann, formats):
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

    anns = cal["announcements"]
    if args.slug:
        anns = [a for a in anns if a["slug"] == args.slug]
    elif not args.all:
        anns = anns[:1]

    formats = [args.format] if args.format else list(FORMATS.keys())

    print(f"Rendering {len(anns)} announcement(s) x {len(formats)} format(s)...")
    for a in anns:
        render_announcement(a, formats)
    print("Done.")


if __name__ == "__main__":
    main()
