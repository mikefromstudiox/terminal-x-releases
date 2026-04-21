"""
DGII NO ESTA JUGANDO - Terminal X Promo Poster
1080x1080 Instagram/Facebook square
Brand: black / white / #b3001e crimson
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

W, H = 1080, 1080
CRIMSON = (179, 0, 30)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
CRIMSON_DARK = (120, 0, 20)

# Font paths
BEBAS = os.path.join(os.path.dirname(__file__), "fonts", "BebasNeue-Regular.ttf")
IMPACT = "C:/Windows/Fonts/impact.ttf"
BAHN = "C:/Windows/Fonts/bahnschrift.ttf"
CALIBRI_LIGHT = "C:/Windows/Fonts/calibril.ttf"
CALIBRI = "C:/Windows/Fonts/calibri.ttf"

# Use Bebas if available, else Impact
TITLE_FONT_PATH = BEBAS if os.path.exists(BEBAS) else IMPACT
BODY_FONT_PATH = BAHN
THIN_FONT_PATH = CALIBRI_LIGHT if os.path.exists(CALIBRI_LIGHT) else CALIBRI

# Load X mark logo
XMARK_PATH = os.path.join(os.path.dirname(__file__), "..", "packages", "ui", "assets", "x-mark.png")

# === CREATE CANVAS ===
img = Image.new("RGB", (W, H), BLACK)
draw = ImageDraw.Draw(img)

# === BACKGROUND: Giant X logo, ghostly crimson ===
if os.path.exists(XMARK_PATH):
    xlogo = Image.open(XMARK_PATH).convert("RGBA")
    # Scale to fill most of canvas
    logo_size = 900
    xlogo = xlogo.resize((logo_size, logo_size), Image.LANCZOS)

    # Make it semi-transparent dark crimson ghost
    pixels = xlogo.load()
    for y in range(xlogo.height):
        for x in range(xlogo.width):
            r, g, b, a = pixels[x, y]
            if a > 30:  # Non-transparent pixels (the red X)
                # Dark crimson at ~30% opacity - visible but not overpowering
                pixels[x, y] = (80, 0, 12, 75)
            else:
                pixels[x, y] = (0, 0, 0, 0)

    # Center it
    x_offset = (W - logo_size) // 2
    y_offset = (H - logo_size) // 2
    img.paste(Image.new("RGB", (W, H), BLACK))  # Reset

    # Composite ghost X
    ghost_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ghost_layer.paste(xlogo, (x_offset, y_offset), xlogo)
    img = Image.alpha_composite(img.convert("RGBA"), ghost_layer).convert("RGB")
    draw = ImageDraw.Draw(img)

# === SUBTLE TEXTURE: scan lines ===
overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
odraw = ImageDraw.Draw(overlay)
for y in range(0, H, 4):
    odraw.line([(0, y), (W, y)], fill=(0, 0, 0, 25), width=1)
img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
draw = ImageDraw.Draw(img)

# === TOP CRIMSON ACCENT BAR ===
draw.rectangle([(0, 0), (W, 6)], fill=CRIMSON)

# === TOP SECTION: "DGII" in massive type ===
# Small label above
font_label = ImageFont.truetype(THIN_FONT_PATH, 22)
label_text = "AVISO IMPORTANTE"
bbox = draw.textbbox((0, 0), label_text, font=font_label)
lw = bbox[2] - bbox[0]
draw.text(((W - lw) // 2, 50), label_text, fill=CRIMSON, font=font_label)

# Thin line under label
line_y = 82
draw.line([(W//2 - 80, line_y), (W//2 + 80, line_y)], fill=(179, 0, 30, 80), width=1)

# === MAIN TITLE BLOCK ===
# "DGII NO ESTA" - huge
font_huge = ImageFont.truetype(TITLE_FONT_PATH, 132)
font_huge2 = ImageFont.truetype(TITLE_FONT_PATH, 140)

title1 = "LA DGII NO"
bbox1 = draw.textbbox((0, 0), title1, font=font_huge)
tw1 = bbox1[2] - bbox1[0]
draw.text(((W - tw1) // 2, 110), title1, fill=WHITE, font=font_huge)

title2 = "ESTA JUGANDO"
bbox2 = draw.textbbox((0, 0), title2, font=font_huge2)
tw2 = bbox2[2] - bbox2[0]
draw.text(((W - tw2) // 2, 225), title2, fill=CRIMSON, font=font_huge2)

# === HORIZONTAL RULE ===
rule_y = 385
draw.rectangle([(80, rule_y), (W - 80, rule_y + 2)], fill=(255, 255, 255, 40))

# === WHITE BOX with body message ===
box_top = 420
box_bottom = 740
box_left = 60
box_right = W - 60
box_padding = 40

# White box with subtle border
draw.rectangle([(box_left, box_top), (box_right, box_bottom)], fill=WHITE)
# Crimson accent on left edge
draw.rectangle([(box_left, box_top), (box_left + 6, box_bottom)], fill=CRIMSON)

# Body text inside white box
font_body_title = ImageFont.truetype(IMPACT, 64)
font_body = ImageFont.truetype(BODY_FONT_PATH, 40)
font_body_sm = ImageFont.truetype(THIN_FONT_PATH, 22)

body_title = "EVITE MULTAS"
bbox_bt = draw.textbbox((0, 0), body_title, font=font_body_title)
btw = bbox_bt[2] - bbox_bt[0]
bth = bbox_bt[3] - bbox_bt[1]
title_x = (W - btw) // 2
title_y = box_top + 12
# Impact is already ultra-heavy; clean bold
draw.text((title_x, title_y), body_title, fill=BLACK, font=font_body_title)

# Crimson underline under EVITE MULTAS
underline_y = box_top + 82
draw.rectangle([(W//2 - 80, underline_y), (W//2 + 80, underline_y + 4)], fill=CRIMSON)

# Body lines
lines = [
    "A partir del 15 de mayo 2026, la facturacion",
    "electronica (e-CF) es OBLIGATORIA.",
    "",
    "Si tu negocio no esta listo, te expones a multas",
    "de hasta RD$50,000 por cada infraccion.",
]

text_left = box_left + 18
text_right = box_right - 18
text_area_w = text_right - text_left

y_cursor = box_top + 105
for line in lines:
    if line == "":
        y_cursor += 14
        continue
    bbox_l = draw.textbbox((0, 0), line, font=font_body)
    lw = bbox_l[2] - bbox_l[0]
    color = BLACK
    draw.text((text_left + (text_area_w - lw) // 2, y_cursor), line, fill=color, font=font_body)
    y_cursor += 50

# === BOTTOM SECTION: CTA ===
# Crimson CTA button
cta_top = 760
cta_h = 70
cta_left = 160
cta_right = W - 160

draw.rounded_rectangle(
    [(cta_left, cta_top), (cta_right, cta_top + cta_h)],
    radius=8,
    fill=CRIMSON
)

font_cta = ImageFont.truetype(TITLE_FONT_PATH, 34)
cta_text = "CUMPLE CON TERMINAL X"
bbox_cta = draw.textbbox((0, 0), cta_text, font=font_cta)
ctw = bbox_cta[2] - bbox_cta[0]
cth = bbox_cta[3] - bbox_cta[1]
draw.text(
    ((W - ctw) // 2, cta_top + (cta_h - cth) // 2 - 4),
    cta_text, fill=WHITE, font=font_cta
)

# === BOTTOM INFO ===
font_small = ImageFont.truetype(THIN_FONT_PATH, 20)
font_tiny = ImageFont.truetype(THIN_FONT_PATH, 16)

info_line = "terminalxpos.com  |  +1 (809) 828-2971"
bbox_info = draw.textbbox((0, 0), info_line, font=font_small)
iw = bbox_info[2] - bbox_info[0]
draw.text(((W - iw) // 2, 870), info_line, fill=(255, 255, 255, 180), font=font_small)

tagline = "Sistema POS certificado por la DGII  •  Emisor Electronico e-CF"
bbox_tag = draw.textbbox((0, 0), tagline, font=font_tiny)
tw = bbox_tag[2] - bbox_tag[0]
draw.text(((W - tw) // 2, 900), tagline, fill=(255, 255, 255, 100), font=font_tiny)

# === SMALL X LOGO at bottom center ===
if os.path.exists(XMARK_PATH):
    small_logo = Image.open(XMARK_PATH).convert("RGBA").resize((50, 50), Image.LANCZOS)
    img_rgba = img.convert("RGBA")
    img_rgba.paste(small_logo, ((W - 50) // 2, 940), small_logo)
    img = img_rgba.convert("RGB")

# === BOTTOM CRIMSON ACCENT BAR ===
draw = ImageDraw.Draw(img)
draw.rectangle([(0, H - 6), (W, H)], fill=CRIMSON)

# === BOTTOM LEFT: Ley reference ===
font_law = ImageFont.truetype(THIN_FONT_PATH, 14)
draw.text((20, H - 28), "Ley 32-23  •  Norma General 06-2023", fill=(255, 255, 255, 60), font=font_law)

# === SAVE ===
out_path = os.path.join(os.path.dirname(__file__), "DGII-NO-ESTA-JUGANDO-1080x1080.png")
img.save(out_path, "PNG", quality=100)
print(f"Saved: {out_path}")
print(f"Size: {img.size}")
