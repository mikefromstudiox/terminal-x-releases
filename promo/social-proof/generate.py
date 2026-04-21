"""
Terminal X — Social Proof / Numbers Brag archetype.

Each piece = 3 carousel slides (1080x1080 feed_post), plus story + reel_cover
(1080x1920) rendered from slide 1 (STAT) for cross-surface deployment.

Slide 1  1-stat.png      — massive protagonist number, race-car plate style
Slide 2  2-context.png   — context headline (what/who), typographic
Slide 3  3-proof-cta.png — zinger + WhatsApp CTA plate

Extras   hero-story.png      (1080x1920)
         hero-reelcover.png  (1080x1920)

Usage:
  python generate.py            # gate: only sp-01
  python generate.py --all      # full set
  python generate.py --id sp-03 # specific
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
    """Pick largest size that fits vertically in zone, centered horizontally."""
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
    # last resort: smallest
    return f


def load_logo(target_h, color):
    """Load x-logo recolored to given RGB tuple, sized to target_h."""
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
    """Subtle horizontal scan-line texture like countdown-ecf."""
    W, H = img.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, H, 4):
        od.line([(0, y), (W, y)], fill=(0, 0, 0, 12), width=1)
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def base_canvas(W, H, bg=CRIMSON, bar_h=None):
    """Crimson bg with top brand bar + bottom footer bar (both black).
    Bar size is derived from WIDTH so 1080x1920 portrait doesn't overflow."""
    if bar_h is None:
        bar_h = max(100, int(W * 0.12))  # 130 on 1080 square -> 130 everywhere w=1080

    img = Image.new("RGB", (W, H), bg)
    img = scan_texture(img)
    draw = ImageDraw.Draw(img)

    # TOP bar
    draw.rectangle([(0, 0), (W, bar_h)], fill=BLACK)
    draw.rectangle([(0, bar_h), (W, bar_h + 4)], fill=CRIMSON)

    # Brand lockup: TERMINAL + X logo
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


# ─── Slide 1: STAT (the protagonist) ──────────────────────────────────────────
def _fit_number(draw, text, max_w, max_h, start_size=900):
    """Pick largest BebasNeue size where `text` fits inside (max_w, max_h)."""
    size = start_size
    while size > 40:
        f = font(BEBAS, size)
        bb = draw.textbbox((0, 0), text, font=f)
        w = bb[2] - bb[0]
        h = bb[3] - bb[1]
        if w <= max_w and h <= max_h:
            return f, bb
        size -= 20
    return font(BEBAS, 40), draw.textbbox((0, 0), text, font=font(BEBAS, 40))


def render_stat(piece, W=1080, H=1080):
    img, draw, bar_h = base_canvas(W, H)

    # Small kicker above number
    kicker_y = bar_h + int((H - 2 * bar_h) * 0.06)
    f_kicker = font(TOMORROW_MED, 30)
    center_text(draw, W, kicker_y, "RESULTADO REAL", f_kicker,
                fill=WHITE, tracking=14)

    # Number zone
    num_zone_top = kicker_y + 70
    num_zone_bot = H - bar_h - int((H - 2 * bar_h) * 0.20)
    num_max_w = int(W * 0.90)
    num_max_h = num_zone_bot - num_zone_top

    f_num, bbox = _fit_number(draw, piece["stat_number"], num_max_w, num_max_h)
    nw = bbox[2] - bbox[0]
    nh = bbox[3] - bbox[1]
    ny = num_zone_top + (num_max_h - nh) // 2 - bbox[1]
    nx = (W - nw) // 2 - bbox[0]
    draw.text((nx, ny), piece["stat_number"], fill=WHITE, font=f_num)

    # Unit line (bold)
    f_unit = font(TOMORROW_BOLD, 56)
    center_text(draw, W, H - bar_h - 150, piece["stat_unit"], f_unit,
                fill=WHITE, tracking=3)

    # Timeframe (medium)
    f_tf = font(TOMORROW_MED, 36)
    center_text(draw, W, H - bar_h - 85, piece["stat_timeframe"], f_tf,
                fill=WHITE, tracking=4)

    return img


# ─── Slide 2: CONTEXT (headline + attribution) ────────────────────────────────
def render_context(piece, W=1080, H=1080):
    img, draw, bar_h = base_canvas(W, H)

    # Tag row: ID chip
    f_tag = font(TOMORROW_BOLD, int(H * 0.032))
    tag_text = f"CASO REAL  ·  {piece['id'].upper()}"
    center_text(draw, W, bar_h + int(H * 0.06), tag_text, f_tag,
                fill=WHITE, tracking=6)
    # underline
    ux = W // 2 - 80
    uy = bar_h + int(H * 0.115)
    draw.rectangle([(ux, uy), (ux + 160, uy + 5)], fill=WHITE)

    # Big headline
    zone_top = bar_h + int(H * 0.19)
    zone_bot = H - bar_h - int(H * 0.06)
    wrap_fit_center(
        draw, W, zone_top, zone_bot, piece["context_headline"],
        TOMORROW_BOLD,
        size_candidates=[int(H * 0.105), int(H * 0.088), int(H * 0.072), int(H * 0.060), int(H * 0.050)],
        max_chars_list=[14, 17, 21, 25, 30],
        fill=WHITE,
    )

    return img


# ─── Slide 3: PROOF + CTA ─────────────────────────────────────────────────────
def render_proof_cta(piece, W=1080, H=1080):
    img, draw, bar_h = base_canvas(W, H)

    # Tag
    f_tag = font(TOMORROW_BOLD, int(H * 0.032))
    center_text(draw, W, bar_h + int(H * 0.06), "TE TOCA A TI", f_tag,
                fill=WHITE, tracking=8)
    ux = W // 2 - 80
    uy = bar_h + int(H * 0.115)
    draw.rectangle([(ux, uy), (ux + 160, uy + 5)], fill=WHITE)

    # White CTA button (anchored to bottom first — so we can place kicker above it)
    btn_w = int(W * 0.78)
    btn_h = 125
    btn_x = (W - btn_w) // 2
    btn_y = H - bar_h - btn_h - 70

    # CTA kicker sits 30px above button
    f_kick = font(TOMORROW_BOLD, 46)
    kick_y = btn_y - 70
    center_text(draw, W, kick_y, piece["cta_kicker"], f_kick, fill=WHITE, tracking=6)

    # Proof / zinger line — Playfair, fills the space between tag underline and kicker
    proof_zone_top = bar_h + 175
    proof_zone_bot = kick_y - 40
    wrap_fit_center(
        draw, W, proof_zone_top, proof_zone_bot, piece["proof_line"],
        PLAYFAIR_BOLD,
        size_candidates=[92, 78, 64, 54, 46],
        max_chars_list=[16, 20, 24, 28, 32],
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


# ─── Format variants for slide 1 ──────────────────────────────────────────────
def render_stat_story(piece):
    return render_stat(piece, W=1080, H=1920)


def render_stat_reelcover(piece):
    """Reel cover: number sits upper-center, bottom teaser 'MIRA COMO LO HIZO'."""
    W, H = 1080, 1920
    img, draw, bar_h = base_canvas(W, H)

    # Kicker
    f_kicker = font(TOMORROW_MED, 32)
    center_text(draw, W, bar_h + 80, "RESULTADO REAL", f_kicker,
                fill=WHITE, tracking=16)

    # Number zone: upper half
    num_zone_top = bar_h + 170
    num_zone_bot = bar_h + 170 + 720
    num_max_w = int(W * 0.88)
    num_max_h = num_zone_bot - num_zone_top
    f_num, bbox = _fit_number(draw, piece["stat_number"], num_max_w, num_max_h)
    nw = bbox[2] - bbox[0]
    nh = bbox[3] - bbox[1]
    ny = num_zone_top + (num_max_h - nh) // 2 - bbox[1]
    nx = (W - nw) // 2 - bbox[0]
    draw.text((nx, ny), piece["stat_number"], fill=WHITE, font=f_num)

    # Unit + timeframe just below number
    f_unit = font(TOMORROW_BOLD, 58)
    center_text(draw, W, num_zone_bot + 30, piece["stat_unit"], f_unit,
                fill=WHITE, tracking=3)
    f_tf = font(TOMORROW_MED, 36)
    center_text(draw, W, num_zone_bot + 105, piece["stat_timeframe"], f_tf,
                fill=WHITE, tracking=4)

    # Bottom teaser block
    f_teaser = font(TOMORROW_BOLD, 88)
    center_text(draw, W, H - bar_h - 280, "MIRA COMO", f_teaser,
                fill=WHITE, tracking=4)
    center_text(draw, W, H - bar_h - 185, "LO HIZO", f_teaser,
                fill=WHITE, tracking=4)
    f_swipe = font(TOMORROW_MED, 34)
    center_text(draw, W, H - bar_h - 90, "TOCA PARA VER EL REEL", f_swipe,
                fill=WHITE, tracking=6)

    return img


def render_piece(piece):
    out = os.path.join(OUT_DIR, piece["id"])
    os.makedirs(out, exist_ok=True)

    render_stat(piece).save(os.path.join(out, "1-stat.png"), "PNG", optimize=True)
    render_context(piece).save(os.path.join(out, "2-context.png"), "PNG", optimize=True)
    render_proof_cta(piece).save(os.path.join(out, "3-proof-cta.png"), "PNG", optimize=True)
    render_stat_story(piece).save(os.path.join(out, "hero-story.png"), "PNG", optimize=True)
    render_stat_reelcover(piece).save(os.path.join(out, "hero-reelcover.png"), "PNG", optimize=True)

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
        pieces = [p for p in pieces if p["id"] == "sp-01"]

    print(f"Rendering {len(pieces)} piece(s)...")
    for p in pieces:
        render_piece(p)
    print("Done.")


if __name__ == "__main__":
    main()
