"""
Terminal X — Milestone / Anniversary / Certification archetype.

Each piece = 3 carousel slides (1080x1080 feed_post), plus story + reel_cover
(1080x1920) rendered from slide 1 (MEDALLION) for cross-surface deployment.

Slide 1  1-medallion.png   — giant crimson+black ring medallion stamped with
                             BebasNeue glyph (year / count / "DGII")
Slide 2  2-story.png       — Playfair Bold emotional zinger (why it matters)
Slide 3  3-gracias-cta.png — "GRACIAS" / "LO LOGRAMOS JUNTOS" + named community
                             + WhatsApp plate CTA

Extras   hero-story.png      (1080x1920)  — medallion reflowed
         hero-reelcover.png  (1080x1920)  — medallion + teaser band

Usage:
  python generate.py            # gate: only ms-01
  python generate.py --all      # full set
  python generate.py --id ms-03 # specific
"""
from PIL import Image, ImageDraw, ImageFont
import json, os, argparse, textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "..", "fonts")
CAL_PATH = os.path.join(HERE, "calendario.json")
OUT_DIR = os.path.join(HERE, "reference_renders")
LOGO_X = os.path.join(HERE, "..", "..", "packages", "ui", "assets", "logo.webp")

CRIMSON = (179, 0, 30)
CRIMSON_DEEP = (130, 0, 22)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)

BEBAS = os.path.join(FONTS, "BebasNeue-Regular.ttf")
TOMORROW_BOLD = os.path.join(FONTS, "Tomorrow-Bold.ttf")
TOMORROW_MED = os.path.join(FONTS, "Tomorrow-Medium.ttf")
PLAYFAIR_BOLD = os.path.join(FONTS, "PlayfairDisplay-Bold.ttf")
INTER_MED = os.path.join(FONTS, "Inter-Medium.ttf")


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


def wrap_fit_center(draw, W, zone_top, zone_bot, text, font_path,
                    size_candidates, max_chars_list, fill=WHITE, line_gap_ratio=0.15):
    zone_h = zone_bot - zone_top
    for size, max_chars in zip(size_candidates, max_chars_list):
        f = font(font_path, size)
        lines = textwrap.wrap(text, width=max_chars, break_long_words=False)
        bb = draw.textbbox((0, 0), "Ag", font=f)
        line_h = bb[3] - bb[1]
        line_gap = int(line_h * line_gap_ratio)
        total_h = len(lines) * line_h + (len(lines) - 1) * line_gap
        if total_h <= zone_h:
            y = zone_top + (zone_h - total_h) // 2
            for ln in lines:
                lbb = draw.textbbox((0, 0), ln, font=f)
                lw = lbb[2] - lbb[0]
                draw.text(((W - lw) // 2, y), ln, fill=fill, font=f)
                y += line_h + line_gap
            return f
    return f


def load_logo(target_h, color):
    if not os.path.exists(LOGO_X):
        return None
    lg = Image.open(LOGO_X).convert("RGBA")
    ratio = target_h / lg.height
    lg = lg.resize((int(lg.width * ratio), target_h), Image.LANCZOS)
    px = lg.load()
    for yy in range(lg.height):
        for xx in range(lg.width):
            r, g, b, a = px[xx, yy]
            if a > 30 and r > 80 and g < 80 and b < 80:
                px[xx, yy] = (*color, 255)
            else:
                px[xx, yy] = (0, 0, 0, 0)
    return lg


def scan_texture(img):
    W, H = img.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, H, 4):
        od.line([(0, y), (W, y)], fill=(0, 0, 0, 12), width=1)
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def base_canvas(W, H, bg=CRIMSON, bar_h=None):
    if bar_h is None:
        bar_h = max(100, int(W * 0.12))

    img = Image.new("RGB", (W, H), bg)
    img = scan_texture(img)
    draw = ImageDraw.Draw(img)

    # TOP bar
    draw.rectangle([(0, 0), (W, bar_h)], fill=BLACK)
    draw.rectangle([(0, bar_h), (W, bar_h + 4)], fill=CRIMSON)

    f_brand = font(TOMORROW_BOLD, 44)
    brand_text = "TERMINAL"
    logo_img = load_logo(66, CRIMSON)
    logo_w, logo_h = (logo_img.size if logo_img else (0, 0))
    bb = draw.textbbox((0, 0), brand_text, font=f_brand)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]
    gap = 10
    total_w = tw + gap + logo_w
    start_x = (W - total_w) // 2
    ty = (bar_h - th) // 2 - 8
    draw.text((start_x, ty), brand_text, fill=WHITE, font=f_brand)
    if logo_img is not None:
        ly = (bar_h - logo_h) // 2
        img.paste(logo_img, (start_x + tw + gap, ly), logo_img)

    # BOTTOM bar
    draw.rectangle([(0, H - bar_h), (W, H)], fill=BLACK)
    draw.rectangle([(0, H - bar_h - 4), (W, H - bar_h)], fill=CRIMSON)

    f_bar = font(TOMORROW_MED, 26)
    bar_text = "CERTIFICADO DGII   ·   wa.me/18098282971   ·   terminalxpos.com"
    bb = draw.textbbox((0, 0), bar_text, font=f_bar)
    bw = bb[2] - bb[0]
    bh = bb[3] - bb[1]
    draw.text(((W - bw) // 2, H - bar_h + (bar_h - bh) // 2 - 6),
              bar_text, fill=WHITE, font=f_bar)

    return img, draw, bar_h


# ─── Medallion primitive ──────────────────────────────────────────────────────
def _fit_glyph(draw, text, max_w, max_h, font_path=BEBAS, start_size=900):
    size = start_size
    while size > 40:
        f = font(font_path, size)
        bb = draw.textbbox((0, 0), text, font=f)
        w = bb[2] - bb[0]
        h = bb[3] - bb[1]
        if w <= max_w and h <= max_h:
            return f, bb
        size -= 20
    return font(font_path, 40), draw.textbbox((0, 0), text, font=font(font_path, 40))


def draw_medallion(img, draw, cx, cy, outer_r,
                   glyph, label,
                   ring_thickness_ratio=0.11):
    """Crimson ring + black annular band + center disc stamped with glyph.
    Outer ring = crimson (deeper), band = black, inner = deep crimson fill.
    """
    W = img.width
    ring = int(outer_r * ring_thickness_ratio)

    # Shadow (soft ground under medallion)
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.ellipse([(cx - outer_r - 14, cy - outer_r + 24),
                (cx + outer_r + 14, cy + outer_r + 40)],
               fill=(0, 0, 0, 80))
    img.paste(sh, (0, 0), sh)

    # Outermost crimson deep rim
    draw.ellipse([(cx - outer_r, cy - outer_r),
                  (cx + outer_r, cy + outer_r)], fill=CRIMSON_DEEP)

    # Black ring band
    r2 = outer_r - int(ring * 0.35)
    draw.ellipse([(cx - r2, cy - r2), (cx + r2, cy + r2)], fill=BLACK)

    # Inner crimson disc
    r3 = r2 - ring
    draw.ellipse([(cx - r3, cy - r3), (cx + r3, cy + r3)], fill=CRIMSON)

    # Thin white inner hairline for that badge polish
    r4 = r3 + 6
    draw.ellipse([(cx - r4, cy - r4), (cx + r4, cy + r4)], outline=WHITE, width=3)

    # Dotted kicker rings along the black band (4 small dots at cardinals)
    band_mid_r = r2 - int(ring / 2)
    for angle_deg in (0, 90, 180, 270):
        import math
        a = math.radians(angle_deg)
        dx = cx + int(band_mid_r * math.cos(a))
        dy = cy + int(band_mid_r * math.sin(a))
        rd = 10
        draw.ellipse([(dx - rd, dy - rd), (dx + rd, dy + rd)], fill=WHITE)

    # Label sits in bottom third of inner disc; glyph fills the top two-thirds.
    # Compute label first so we can reserve vertical room.
    f_label = font(TOMORROW_BOLD, max(24, int(r3 * 0.13)))
    max_label_w = int(r3 * 0.95)
    lbb = draw.textbbox((0, 0), label, font=f_label)
    lw = lbb[2] - lbb[0]
    while (lw > max_label_w) and f_label.size > 16:
        f_label = font(TOMORROW_BOLD, f_label.size - 2)
        lbb = draw.textbbox((0, 0), label, font=f_label)
        lw = lbb[2] - lbb[0]
    lh = lbb[3] - lbb[1]

    # Label sits in lower third, pulled UP closer to the glyph (tight badge feel).
    # Anchor label baseline near y = cy + r3*0.60, leaving breathing room at disc bottom.
    rule_y = cy + int(r3 * 0.44)
    label_top_y = rule_y + 22
    rule_w = int(r3 * 0.40)
    rule_x = cx - rule_w // 2

    # Glyph zone: from disc top area down to just above the rule.
    glyph_zone_top = cy - int(r3 * 0.82)
    glyph_zone_bot = rule_y - int(r3 * 0.08)
    glyph_zone_h = glyph_zone_bot - glyph_zone_top
    glyph_max_w = int(r3 * 1.55)

    f_g, bb = _fit_glyph(draw, glyph, glyph_max_w, glyph_zone_h,
                         start_size=int(r3 * 1.7))
    gw = bb[2] - bb[0]
    gh = bb[3] - bb[1]
    gx = cx - gw // 2 - bb[0]
    gy = glyph_zone_top + (glyph_zone_h - gh) // 2 - bb[1]
    draw.text((gx, gy), glyph, fill=WHITE, font=f_g)

    # Rule + label
    draw.rectangle([(rule_x, rule_y), (rule_x + rule_w, rule_y + 4)], fill=WHITE)
    draw.text(((W - lw) // 2, label_top_y), label, fill=WHITE, font=f_label)


# ─── Slide 1: MEDALLION ───────────────────────────────────────────────────────
def render_medallion(piece, W=1080, H=1080):
    img, draw, bar_h = base_canvas(W, H)

    # Kicker above medallion
    kicker_y = bar_h + int((H - 2 * bar_h) * 0.065)
    f_kicker = font(TOMORROW_MED, 30)
    center_text(draw, W, kicker_y, piece["medallion_kicker"], f_kicker,
                fill=WHITE, tracking=14)

    # Medallion centered in the middle zone
    usable_top = bar_h + 110
    usable_bot = H - bar_h - 40
    cx = W // 2
    cy = (usable_top + usable_bot) // 2
    outer_r = min((usable_bot - usable_top) // 2 - 10, int(W * 0.40))

    draw_medallion(img, ImageDraw.Draw(img), cx, cy, outer_r,
                   piece["medallion_number"], piece["medallion_label"])

    return img


# ─── Slide 2: STORY ZINGER ────────────────────────────────────────────────────
def render_story(piece, W=1080, H=1080):
    img = Image.new("RGB", (W, H), BLACK)
    img = scan_texture(img)
    draw = ImageDraw.Draw(img)

    bar_h = max(100, int(W * 0.12))

    # Top crimson band (inverted — story slide is black canvas)
    draw.rectangle([(0, 0), (W, bar_h)], fill=CRIMSON)
    draw.rectangle([(0, bar_h), (W, bar_h + 4)], fill=BLACK)

    f_brand = font(TOMORROW_BOLD, 44)
    brand_text = "TERMINAL"
    logo_img = load_logo(66, WHITE)
    logo_w, logo_h = (logo_img.size if logo_img else (0, 0))
    bb = draw.textbbox((0, 0), brand_text, font=f_brand)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]
    gap = 10
    total_w = tw + gap + logo_w
    start_x = (W - total_w) // 2
    ty = (bar_h - th) // 2 - 8
    draw.text((start_x, ty), brand_text, fill=WHITE, font=f_brand)
    if logo_img is not None:
        ly = (bar_h - logo_h) // 2
        img.paste(logo_img, (start_x + tw + gap, ly), logo_img)

    # Bottom crimson footer
    draw.rectangle([(0, H - bar_h), (W, H)], fill=CRIMSON)
    draw.rectangle([(0, H - bar_h - 4), (W, H - bar_h)], fill=BLACK)
    f_bar = font(TOMORROW_MED, 26)
    bar_text = "CERTIFICADO DGII   ·   wa.me/18098282971   ·   terminalxpos.com"
    bbb = draw.textbbox((0, 0), bar_text, font=f_bar)
    bw = bbb[2] - bbb[0]
    bh = bbb[3] - bbb[1]
    draw.text(((W - bw) // 2, H - bar_h + (bar_h - bh) // 2 - 6),
              bar_text, fill=WHITE, font=f_bar)

    # Crimson kicker
    f_kicker = font(TOMORROW_BOLD, 34)
    center_text(draw, W, bar_h + int(H * 0.075), piece["story_kicker"], f_kicker,
                fill=CRIMSON, tracking=10)

    # Underline in crimson
    ux = W // 2 - 60
    uy = bar_h + int(H * 0.12)
    draw.rectangle([(ux, uy), (ux + 120, uy + 5)], fill=CRIMSON)

    # Playfair Bold zinger fills the body (top-biased so it hugs the kicker)
    zone_top = bar_h + int(H * 0.155)
    zone_bot = H - bar_h - int(H * 0.18)
    wrap_fit_center(
        draw, W, zone_top, zone_bot, piece["story_zinger"],
        PLAYFAIR_BOLD,
        size_candidates=[100, 88, 76, 66, 56, 48],
        max_chars_list=[14, 17, 20, 24, 28, 34],
        fill=WHITE,
    )

    return img


# ─── Slide 3: GRACIAS + CTA ───────────────────────────────────────────────────
def render_gracias_cta(piece, W=1080, H=1080):
    img, draw, bar_h = base_canvas(W, H)

    # Tag
    f_tag = font(TOMORROW_BOLD, int(H * 0.030))
    center_text(draw, W, bar_h + int(H * 0.055), "A LA COMUNIDAD", f_tag,
                fill=WHITE, tracking=8)
    ux = W // 2 - 80
    uy = bar_h + int(H * 0.108)
    draw.rectangle([(ux, uy), (ux + 160, uy + 5)], fill=WHITE)

    # Big BebasNeue gratitude headline
    f_gr_candidates = [260, 220, 180, 150, 128]
    head_y = bar_h + int(H * 0.16)
    picked_f = None
    for s in f_gr_candidates:
        f_try = font(BEBAS, s)
        bb = draw.textbbox((0, 0), piece["gratitude_headline"], font=f_try)
        if bb[2] - bb[0] <= int(W * 0.90):
            picked_f = f_try
            break
    if picked_f is None:
        picked_f = font(BEBAS, 128)
    center_text(draw, W, head_y, piece["gratitude_headline"], picked_f,
                fill=WHITE, tracking=4)

    # CTA button anchored to bottom
    btn_w = int(W * 0.78)
    btn_h = 125
    btn_x = (W - btn_w) // 2
    btn_y = H - bar_h - btn_h - 70

    # CTA kicker
    f_kick = font(TOMORROW_BOLD, 44)
    kick_y = btn_y - 68
    center_text(draw, W, kick_y, piece["cta_kicker"], f_kick, fill=WHITE, tracking=6)

    # Subline: Inter Medium, fills space between headline and kicker
    # compute headline height
    hbb = draw.textbbox((0, 0), piece["gratitude_headline"], font=picked_f)
    head_h = hbb[3] - hbb[1]
    sub_zone_top = head_y + head_h + 50
    sub_zone_bot = kick_y - 40
    wrap_fit_center(
        draw, W, sub_zone_top, sub_zone_bot, piece["gratitude_subline"],
        INTER_MED,
        size_candidates=[44, 38, 34, 30, 26],
        max_chars_list=[28, 33, 38, 44, 52],
        fill=WHITE,
        line_gap_ratio=0.22,
    )

    # Button
    draw.rectangle([(btn_x, btn_y), (btn_x + btn_w, btn_y + btn_h)], fill=WHITE)
    f_btn = font(TOMORROW_BOLD, int(H * 0.045))
    btn_text = "WhatsApp  +1 809-828-2971"
    bb = draw.textbbox((0, 0), btn_text, font=f_btn)
    bw = bb[2] - bb[0]
    bh = bb[3] - bb[1]
    draw.text((btn_x + (btn_w - bw) // 2, btn_y + (btn_h - bh) // 2 - int(H * 0.008)),
              btn_text, fill=CRIMSON, font=f_btn)

    return img


# ─── Format variants for slide 1 ──────────────────────────────────────────────
def render_medallion_story(piece):
    W, H = 1080, 1920
    img, draw, bar_h = base_canvas(W, H)

    kicker_y = bar_h + 90
    f_kicker = font(TOMORROW_MED, 34)
    center_text(draw, W, kicker_y, piece["medallion_kicker"], f_kicker,
                fill=WHITE, tracking=16)

    # Medallion vertically centered
    usable_top = bar_h + 170
    usable_bot = H - bar_h - 120
    cx = W // 2
    cy = (usable_top + usable_bot) // 2
    outer_r = min((usable_bot - usable_top) // 2 - 20, int(W * 0.44))
    draw_medallion(img, ImageDraw.Draw(img), cx, cy, outer_r,
                   piece["medallion_number"], piece["medallion_label"])

    # Small swipe hint above footer
    f_hint = font(TOMORROW_MED, 30)
    center_text(draw, W, H - bar_h - 70, "DESLIZA PARA VER LA HISTORIA",
                f_hint, fill=WHITE, tracking=6)

    return img


def render_medallion_reelcover(piece):
    W, H = 1080, 1920
    img, draw, bar_h = base_canvas(W, H)

    # Kicker
    f_kicker = font(TOMORROW_MED, 32)
    center_text(draw, W, bar_h + 80, piece["medallion_kicker"], f_kicker,
                fill=WHITE, tracking=16)

    # Medallion upper half
    usable_top = bar_h + 150
    med_band_bot = H - bar_h - 430
    cx = W // 2
    cy = (usable_top + med_band_bot) // 2
    outer_r = min((med_band_bot - usable_top) // 2 - 20, int(W * 0.42))
    draw_medallion(img, ImageDraw.Draw(img), cx, cy, outer_r,
                   piece["medallion_number"], piece["medallion_label"])

    # Teaser band (below medallion): crimson-on-black plate
    band_h = 280
    band_y = H - bar_h - band_h - 30
    # plate
    draw.rectangle([(0, band_y), (W, band_y + band_h)], fill=BLACK)
    draw.rectangle([(0, band_y), (W, band_y + 5)], fill=CRIMSON)
    draw.rectangle([(0, band_y + band_h - 5), (W, band_y + band_h)], fill=CRIMSON)

    # Teaser headline
    f_teaser = font(TOMORROW_BOLD, 72)
    # try smaller if too wide
    text = piece["teaser_band"]
    for size in (92, 80, 72, 64, 56):
        f_try = font(TOMORROW_BOLD, size)
        bb = draw.textbbox((0, 0), text, font=f_try)
        if bb[2] - bb[0] <= int(W * 0.92):
            f_teaser = f_try
            break
    bb = draw.textbbox((0, 0), text, font=f_teaser)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]
    ty = band_y + 70
    draw.text(((W - tw) // 2, ty), text, fill=WHITE, font=f_teaser)

    # "TOCA PARA VER EL REEL"
    f_swipe = font(TOMORROW_MED, 34)
    center_text(draw, W, band_y + band_h - 80, "TOCA PARA VER EL REEL",
                f_swipe, fill=CRIMSON, tracking=6)

    return img


def render_piece(piece):
    out = os.path.join(OUT_DIR, piece["id"])
    os.makedirs(out, exist_ok=True)

    render_medallion(piece).save(os.path.join(out, "1-medallion.png"), "PNG", optimize=True)
    render_story(piece).save(os.path.join(out, "2-story.png"), "PNG", optimize=True)
    render_gracias_cta(piece).save(os.path.join(out, "3-gracias-cta.png"), "PNG", optimize=True)
    render_medallion_story(piece).save(os.path.join(out, "hero-story.png"), "PNG", optimize=True)
    render_medallion_reelcover(piece).save(os.path.join(out, "hero-reelcover.png"), "PNG", optimize=True)

    print(f"  {piece['id']}  {piece['date']}  -> {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--id", type=str, help="render a specific piece id")
    args = ap.parse_args()

    with open(CAL_PATH, "r", encoding="utf-8") as f:
        cal = json.load(f)

    pieces = cal["pieces"]
    if args.id:
        pieces = [p for p in pieces if p["id"] == args.id]
    elif not args.all:
        pieces = [p for p in pieces if p["id"] == "ms-01"]

    print(f"Rendering {len(pieces)} piece(s)...")
    for p in pieces:
        render_piece(p)
    print("Done.")


if __name__ == "__main__":
    main()
