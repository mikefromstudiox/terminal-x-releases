"""
Terminal X — Price-Drop / Limited-Offer archetype.

Each piece = 3 carousel slides (1080x1080), plus story + reel_cover (1080x1920).

Slide 1  1-slash.png      — ANTES price w/ black diagonal strike, AHORA massive
Slide 2  2-incluye.png    — INCLUYE + 3 crimson lead glyphs + bullets (black canvas)
Slide 3  3-vence-cta.png  — VENCE + end-date plate + zinger + WhatsApp CTA

Extras   hero-story.png      (1080x1920)
         hero-reelcover.png  (1080x1920)

Usage:
  python generate.py            # gate: only pd-01
  python generate.py --all      # full set
  python generate.py --id pd-03 # specific
"""
from PIL import Image, ImageDraw, ImageFont
import json, os, argparse, textwrap, math

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "..", "fonts")
CAL_PATH = os.path.join(HERE, "calendario.json")
OUT_DIR = os.path.join(HERE, "reference_renders")
LOGO_X = os.path.join(HERE, "..", "..", "packages", "ui", "assets", "logo.webp")

CRIMSON = (179, 0, 30)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
SMOKE = (205, 205, 205)  # gray/white for struck-out ANTES price

BEBAS = os.path.join(FONTS, "BebasNeue-Regular.ttf")
TOMORROW_BOLD = os.path.join(FONTS, "Tomorrow-Bold.ttf")
TOMORROW_MED = os.path.join(FONTS, "Tomorrow-Medium.ttf")
SPACE_BOLD = os.path.join(FONTS, "SpaceGrotesk-Bold.ttf")
INTER_MED = os.path.join(FONTS, "Inter-Medium.ttf")
PLAYFAIR_BOLD = os.path.join(FONTS, "PlayfairDisplay-Bold.ttf")
PLAYFAIR_IT = os.path.join(FONTS, "PlayfairDisplay-Italic.ttf")


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


def scan_texture(img, opacity=12):
    W, H = img.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, H, 4):
        od.line([(0, y), (W, y)], fill=(0, 0, 0, opacity), width=1)
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def base_canvas(W, H, bg=CRIMSON):
    """bg=CRIMSON -> black bars + crimson accent rule.
       bg=BLACK   -> crimson bars + white hairline accent rule (inverse stripe)."""
    bar_h = max(100, int(W * 0.12))

    img = Image.new("RGB", (W, H), bg)
    img = scan_texture(img)
    draw = ImageDraw.Draw(img)

    if bg == CRIMSON:
        bar_color = BLACK
        accent = CRIMSON
        logo_color = CRIMSON
    else:
        bar_color = CRIMSON
        accent = WHITE
        logo_color = WHITE

    draw.rectangle([(0, 0), (W, bar_h)], fill=bar_color)
    draw.rectangle([(0, bar_h), (W, bar_h + 4)], fill=accent)

    f_brand = font(TOMORROW_BOLD, 44)
    brand_text = "TERMINAL"
    logo_img = load_logo(66, logo_color)
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

    draw.rectangle([(0, H - bar_h), (W, H)], fill=bar_color)
    draw.rectangle([(0, H - bar_h - 4), (W, H - bar_h)], fill=accent)

    f_bar = font(TOMORROW_MED, 26)
    bar_text = "CERTIFICADO DGII   ·   wa.me/18098282971   ·   terminalxpos.com"
    bb = draw.textbbox((0, 0), bar_text, font=f_bar)
    bw = bb[2] - bb[0]
    bh = bb[3] - bb[1]
    draw.text(((W - bw) // 2, H - bar_h + (bar_h - bh) // 2 - 6),
              bar_text, fill=WHITE, font=f_bar)

    return img, draw, bar_h


def _fit_text(draw, text, font_path, max_w, max_h, start_size=900, min_size=40, step=20):
    size = start_size
    while size > min_size:
        f = font(font_path, size)
        bb = draw.textbbox((0, 0), text, font=f)
        w = bb[2] - bb[0]
        h = bb[3] - bb[1]
        if w <= max_w and h <= max_h:
            return f, bb
        size -= step
    f = font(font_path, min_size)
    return f, draw.textbbox((0, 0), text, font=f)


# ─── Slide 1: SLASH (the protagonist) ─────────────────────────────────────────
def render_slash(piece, W=1080, H=1080):
    img, draw, bar_h = base_canvas(W, H, bg=CRIMSON)

    # Top kicker
    kicker_y = bar_h + 28
    f_kicker = font(TOMORROW_MED, 30)
    center_text(draw, W, kicker_y, piece.get("kicker_top", "OFERTA LIMITADA"),
                f_kicker, fill=WHITE, tracking=14)

    # ANTES label
    antes_label_y = kicker_y + 70
    f_lbl = font(TOMORROW_BOLD, 34)
    center_text(draw, W, antes_label_y, "ANTES", f_lbl, fill=WHITE, tracking=10)

    # Old price (BebasNeue, smoke/gray), black diagonal strike across it
    antes_zone_top = antes_label_y + 55
    antes_zone_bot = antes_zone_top + 160
    antes_max_w = int(W * 0.66)
    antes_max_h = antes_zone_bot - antes_zone_top
    f_antes, bb_a = _fit_text(draw, piece["antes_price"], BEBAS,
                              antes_max_w, antes_max_h, start_size=220, step=6)
    aw = bb_a[2] - bb_a[0]
    ah = bb_a[3] - bb_a[1]
    ax = (W - aw) // 2 - bb_a[0]
    ay = antes_zone_top + (antes_max_h - ah) // 2 - bb_a[1]
    draw.text((ax, ay), piece["antes_price"], fill=SMOKE, font=f_antes)

    # Black diagonal strike across the ANTES price, ~8-12deg slope, thick.
    sx1 = (W - aw) // 2 - 30
    sx2 = (W - aw) // 2 + aw + 30
    sy1 = antes_zone_top + antes_max_h // 2 + 36
    sy2 = antes_zone_top + antes_max_h // 2 - 36
    # draw a thick black bar (rectangle rotated via polygon) for crisp edges
    thick = 14
    angle_dx = 0
    dx = thick * (sy2 - sy1) / max(1, math.hypot(sx2 - sx1, sy2 - sy1))
    dy = thick * (sx2 - sx1) / max(1, math.hypot(sx2 - sx1, sy2 - sy1))
    poly = [
        (sx1 - dx, sy1 + dy),
        (sx2 - dx, sy2 + dy),
        (sx2 + dx, sy2 - dy),
        (sx1 + dx, sy1 - dy),
    ]
    draw.polygon(poly, fill=BLACK)

    # AHORA label
    ahora_label_y = antes_zone_bot + 30
    center_text(draw, W, ahora_label_y, "AHORA", f_lbl, fill=WHITE, tracking=10)

    # AHORA price (race-car plate: BebasNeue MASSIVE, white)
    ahora_zone_top = ahora_label_y + 70
    sub_reserve = 80
    ahora_zone_bot = H - bar_h - sub_reserve - 20
    ahora_max_w = int(W * 0.92)
    ahora_max_h = ahora_zone_bot - ahora_zone_top
    f_ah, bb_h = _fit_text(draw, piece["ahora_price"], BEBAS,
                           ahora_max_w, ahora_max_h, start_size=780, step=10)
    hw = bb_h[2] - bb_h[0]
    hh = bb_h[3] - bb_h[1]
    hx = (W - hw) // 2 - bb_h[0]
    hy = ahora_zone_top + (ahora_max_h - hh) // 2 - bb_h[1]
    draw.text((hx, hy), piece["ahora_price"], fill=WHITE, font=f_ah)

    # Sub line under new price
    f_sub = font(TOMORROW_BOLD, 32)
    center_text(draw, W, H - bar_h - 66, piece["ahora_sub"], f_sub,
                fill=WHITE, tracking=4)

    return img


# ─── Slide 2: INCLUYE (value / what you get) ──────────────────────────────────
def render_incluye(piece, W=1080, H=1080):
    img, draw, bar_h = base_canvas(W, H, bg=BLACK)

    # Kicker
    kicker_y = bar_h + int(H * 0.065)
    f_kicker = font(TOMORROW_BOLD, 42)
    center_text(draw, W, kicker_y, piece["inclusions_kicker"], f_kicker,
                fill=WHITE, tracking=10)

    # short crimson underline
    ux = W // 2 - 90
    uy = kicker_y + 78
    draw.rectangle([(ux, uy), (ux + 180, uy + 6)], fill=CRIMSON)

    # 3 bullets with crimson lead glyph "+", Tomorrow Medium body
    bullets = piece["inclusions"][:3]
    f_body = font(TOMORROW_MED, 46)
    f_glyph = font(TOMORROW_BOLD, 86)

    list_zone_top = uy + 75
    list_zone_bot = H - bar_h - int(H * 0.06)
    list_zone_h = list_zone_bot - list_zone_top

    # compute item spacing
    items = []
    line_gap = 22
    line_h_body = draw.textbbox((0, 0), "Ag", font=f_body)[3] - draw.textbbox((0, 0), "Ag", font=f_body)[1]
    row_h = max(line_h_body, 76)
    row_gap = 56

    total_h = len(bullets) * row_h + (len(bullets) - 1) * row_gap
    y = list_zone_top + (list_zone_h - total_h) // 2

    glyph_x = int(W * 0.09)
    text_x = glyph_x + 110

    for ln in bullets:
        # wrap long bullet lines onto 2 lines if needed
        wrapped = textwrap.wrap(ln, width=30, break_long_words=False)
        # glyph vertically centered on first line
        gbb = draw.textbbox((0, 0), "+", font=f_glyph)
        gh = gbb[3] - gbb[1]
        draw.text((glyph_x, y - 18), "+", fill=CRIMSON, font=f_glyph)
        ty = y
        for wl in wrapped[:2]:
            draw.text((text_x, ty), wl, fill=WHITE, font=f_body)
            ty += line_h_body + 8
        y += max(row_h, (ty - y)) + row_gap

    return img


# ─── Slide 3: VENCE + CTA ─────────────────────────────────────────────────────
def render_vence_cta(piece, W=1080, H=1080):
    img, draw, bar_h = base_canvas(W, H, bg=CRIMSON)

    # Tag
    f_tag = font(TOMORROW_BOLD, int(H * 0.032))
    center_text(draw, W, bar_h + int(H * 0.055), "VENCE", f_tag,
                fill=WHITE, tracking=12)
    ux = W // 2 - 80
    uy = bar_h + int(H * 0.105)
    draw.rectangle([(ux, uy), (ux + 160, uy + 5)], fill=WHITE)

    # End-date (BebasNeue big)
    date_zone_top = uy + 40
    date_zone_bot = date_zone_top + 200
    f_date, bb_d = _fit_text(draw, piece["vence_label"], BEBAS,
                             int(W * 0.86), 180, start_size=220, step=6)
    dw = bb_d[2] - bb_d[0]
    dh = bb_d[3] - bb_d[1]
    dx = (W - dw) // 2 - bb_d[0]
    dy = date_zone_top + (180 - dh) // 2 - bb_d[1]
    draw.text((dx, dy), piece["vence_label"], fill=WHITE, font=f_date)

    # White CTA button anchored at bottom
    btn_w = int(W * 0.78)
    btn_h = 125
    btn_x = (W - btn_w) // 2
    btn_y = H - bar_h - btn_h - 70

    # CTA kicker above button
    f_kick = font(TOMORROW_BOLD, 46)
    kick_y = btn_y - 70
    center_text(draw, W, kick_y, piece["cta_kicker"], f_kick, fill=WHITE, tracking=6)

    # Playfair zinger fills between date plate and kicker
    zinger_top = date_zone_bot + 30
    zinger_bot = kick_y - 40
    wrap_fit_center(
        draw, W, zinger_top, zinger_bot, piece["zinger"],
        PLAYFAIR_BOLD,
        size_candidates=[86, 74, 62, 52, 44],
        max_chars_list=[18, 22, 26, 30, 34],
        fill=WHITE,
    )

    draw.rectangle([(btn_x, btn_y), (btn_x + btn_w, btn_y + btn_h)], fill=WHITE)
    f_btn = font(TOMORROW_BOLD, int(H * 0.045))
    btn_text = "WhatsApp  +1 809-828-2971"
    bb = draw.textbbox((0, 0), btn_text, font=f_btn)
    bw = bb[2] - bb[0]
    bh = bb[3] - bb[1]
    draw.text((btn_x + (btn_w - bw) // 2, btn_y + (btn_h - bh) // 2 - int(H * 0.008)),
              btn_text, fill=CRIMSON, font=f_btn)

    return img


# ─── Hero variants: slide 1 reflowed into 1080x1920 ───────────────────────────
def render_slash_story(piece):
    W, H = 1080, 1920
    img, draw, bar_h = base_canvas(W, H, bg=CRIMSON)

    kicker_y = bar_h + 90
    f_kicker = font(TOMORROW_MED, 34)
    center_text(draw, W, kicker_y, piece.get("kicker_top", "OFERTA LIMITADA"),
                f_kicker, fill=WHITE, tracking=16)

    # ANTES
    antes_label_y = kicker_y + 100
    f_lbl = font(TOMORROW_BOLD, 40)
    center_text(draw, W, antes_label_y, "ANTES", f_lbl, fill=WHITE, tracking=12)

    antes_zone_top = antes_label_y + 75
    antes_zone_bot = antes_zone_top + 240
    f_antes, bb_a = _fit_text(draw, piece["antes_price"], BEBAS,
                              int(W * 0.72), 240, start_size=280, step=8)
    aw = bb_a[2] - bb_a[0]
    ah = bb_a[3] - bb_a[1]
    ax = (W - aw) // 2 - bb_a[0]
    ay = antes_zone_top + (240 - ah) // 2 - bb_a[1]
    draw.text((ax, ay), piece["antes_price"], fill=SMOKE, font=f_antes)

    # diagonal strike
    sx1 = (W - aw) // 2 - 40
    sx2 = (W - aw) // 2 + aw + 40
    sy1 = antes_zone_top + 120 + 50
    sy2 = antes_zone_top + 120 - 50
    thick = 18
    dx = thick * (sy2 - sy1) / max(1, math.hypot(sx2 - sx1, sy2 - sy1))
    dy = thick * (sx2 - sx1) / max(1, math.hypot(sx2 - sx1, sy2 - sy1))
    poly = [
        (sx1 - dx, sy1 + dy),
        (sx2 - dx, sy2 + dy),
        (sx2 + dx, sy2 - dy),
        (sx1 + dx, sy1 - dy),
    ]
    draw.polygon(poly, fill=BLACK)

    # AHORA
    ahora_label_y = antes_zone_bot + 60
    center_text(draw, W, ahora_label_y, "AHORA", f_lbl, fill=WHITE, tracking=12)

    ahora_zone_top = ahora_label_y + 110
    ahora_zone_bot = H - bar_h - 220
    ahora_max_h = ahora_zone_bot - ahora_zone_top
    f_ah, bb_h = _fit_text(piece_draw := draw, piece["ahora_price"], BEBAS,
                           int(W * 0.93), ahora_max_h, start_size=980, step=14)
    hw = bb_h[2] - bb_h[0]
    hh = bb_h[3] - bb_h[1]
    hx = (W - hw) // 2 - bb_h[0]
    hy = ahora_zone_top + (ahora_max_h - hh) // 2 - bb_h[1]
    draw.text((hx, hy), piece["ahora_price"], fill=WHITE, font=f_ah)

    # sub
    f_sub = font(TOMORROW_BOLD, 38)
    center_text(draw, W, H - bar_h - 130, piece["ahora_sub"], f_sub,
                fill=WHITE, tracking=4)
    f_sub2 = font(TOMORROW_MED, 30)
    center_text(draw, W, H - bar_h - 75, f"VENCE {piece['vence_label']}", f_sub2,
                fill=WHITE, tracking=6)

    return img


def render_slash_reelcover(piece):
    """Reel cover: price drop centered, bottom teaser 'PRECIO NUEVO ADENTRO'."""
    W, H = 1080, 1920
    img, draw, bar_h = base_canvas(W, H, bg=CRIMSON)

    # Top kicker
    kicker_y = bar_h + 80
    f_kicker = font(TOMORROW_MED, 34)
    center_text(draw, W, kicker_y, piece.get("kicker_top", "OFERTA LIMITADA"),
                f_kicker, fill=WHITE, tracking=16)

    # ANTES mini block
    antes_label_y = kicker_y + 85
    f_lbl = font(TOMORROW_BOLD, 36)
    center_text(draw, W, antes_label_y, "ANTES", f_lbl, fill=WHITE, tracking=12)

    antes_zone_top = antes_label_y + 70
    f_antes, bb_a = _fit_text(draw, piece["antes_price"], BEBAS,
                              int(W * 0.58), 170, start_size=200, step=6)
    aw = bb_a[2] - bb_a[0]
    ah = bb_a[3] - bb_a[1]
    ax = (W - aw) // 2 - bb_a[0]
    ay = antes_zone_top + (170 - ah) // 2 - bb_a[1]
    draw.text((ax, ay), piece["antes_price"], fill=SMOKE, font=f_antes)

    sx1 = (W - aw) // 2 - 30
    sx2 = (W - aw) // 2 + aw + 30
    sy1 = antes_zone_top + 85 + 38
    sy2 = antes_zone_top + 85 - 38
    thick = 14
    dx = thick * (sy2 - sy1) / max(1, math.hypot(sx2 - sx1, sy2 - sy1))
    dy = thick * (sx2 - sx1) / max(1, math.hypot(sx2 - sx1, sy2 - sy1))
    poly = [
        (sx1 - dx, sy1 + dy), (sx2 - dx, sy2 + dy),
        (sx2 + dx, sy2 - dy), (sx1 + dx, sy1 - dy),
    ]
    draw.polygon(poly, fill=BLACK)

    # AHORA label
    ahora_label_y = antes_zone_top + 220
    center_text(draw, W, ahora_label_y, "AHORA", f_lbl, fill=WHITE, tracking=12)

    # AHORA price massive
    ahora_zone_top = ahora_label_y + 90
    ahora_zone_bot = ahora_zone_top + 620
    f_ah, bb_h = _fit_text(draw, piece["ahora_price"], BEBAS,
                           int(W * 0.92), 620, start_size=820, step=12)
    hw = bb_h[2] - bb_h[0]
    hh = bb_h[3] - bb_h[1]
    hx = (W - hw) // 2 - bb_h[0]
    hy = ahora_zone_top + (620 - hh) // 2 - bb_h[1]
    draw.text((hx, hy), piece["ahora_price"], fill=WHITE, font=f_ah)

    # sub line
    f_sub = font(TOMORROW_BOLD, 36)
    center_text(draw, W, ahora_zone_bot + 30, piece["ahora_sub"], f_sub,
                fill=WHITE, tracking=4)

    # Bottom teaser band
    f_teaser = font(TOMORROW_BOLD, 86)
    center_text(draw, W, H - bar_h - 260, "PRECIO NUEVO", f_teaser,
                fill=WHITE, tracking=4)
    center_text(draw, W, H - bar_h - 170, "ADENTRO", f_teaser,
                fill=WHITE, tracking=4)
    f_swipe = font(TOMORROW_MED, 34)
    center_text(draw, W, H - bar_h - 82, "TOCA PARA VER EL REEL", f_swipe,
                fill=WHITE, tracking=6)

    return img


def render_piece(piece):
    out = os.path.join(OUT_DIR, piece["id"])
    os.makedirs(out, exist_ok=True)

    render_slash(piece).save(os.path.join(out, "1-slash.png"), "PNG", optimize=True)
    render_incluye(piece).save(os.path.join(out, "2-incluye.png"), "PNG", optimize=True)
    render_vence_cta(piece).save(os.path.join(out, "3-vence-cta.png"), "PNG", optimize=True)
    render_slash_story(piece).save(os.path.join(out, "hero-story.png"), "PNG", optimize=True)
    render_slash_reelcover(piece).save(os.path.join(out, "hero-reelcover.png"), "PNG", optimize=True)

    print(f"  {piece['id']}  {piece['date']}  vence {piece['vence_date']}  -> {out}")


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
        pieces = [p for p in pieces if p["id"] == "pd-01"]

    print(f"Rendering {len(pieces)} piece(s)...")
    for p in pieces:
        render_piece(p)
    print("Done.")


if __name__ == "__main__":
    main()
