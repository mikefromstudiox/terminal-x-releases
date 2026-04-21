"""
DGII NO ESTA JUGANDO - Terminal X Promo Story/Reel
1080x1920 vertical format for Instagram/Facebook Stories & Reels
Brand: black / white / #b3001e crimson
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1080, 1920
CRIMSON = (179, 0, 30)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)

# Font paths
BEBAS = os.path.join(os.path.dirname(__file__), "fonts", "BebasNeue-Regular.ttf")
IMPACT = "C:/Windows/Fonts/impact.ttf"
BAHN = "C:/Windows/Fonts/bahnschrift.ttf"
CALIBRI_LIGHT = "C:/Windows/Fonts/calibril.ttf"
CALIBRI = "C:/Windows/Fonts/calibri.ttf"

TITLE_FONT_PATH = BEBAS if os.path.exists(BEBAS) else IMPACT
BODY_FONT_PATH = BAHN
THIN_FONT_PATH = CALIBRI_LIGHT if os.path.exists(CALIBRI_LIGHT) else CALIBRI

XMARK_PATH = os.path.join(os.path.dirname(__file__), "..", "packages", "ui", "assets", "x-mark.png")

# === CREATE CANVAS ===
img = Image.new("RGB", (W, H), BLACK)
draw = ImageDraw.Draw(img)

# === BACKGROUND: Giant X logo, ghostly ===
if os.path.exists(XMARK_PATH):
    xlogo = Image.open(XMARK_PATH).convert("RGBA")
    logo_size = 1000
    xlogo = xlogo.resize((logo_size, logo_size), Image.LANCZOS)

    pixels = xlogo.load()
    for y in range(xlogo.height):
        for x in range(xlogo.width):
            r, g, b, a = pixels[x, y]
            if a > 30:
                pixels[x, y] = (80, 0, 12, 75)
            else:
                pixels[x, y] = (0, 0, 0, 0)

    ghost_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    x_offset = (W - logo_size) // 2
    y_offset = 420  # Center it behind the title area
    ghost_layer.paste(xlogo, (x_offset, y_offset), xlogo)
    img = Image.alpha_composite(img.convert("RGBA"), ghost_layer).convert("RGB")
    draw = ImageDraw.Draw(img)

# === SCAN LINES ===
overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
odraw = ImageDraw.Draw(overlay)
for y in range(0, H, 4):
    odraw.line([(0, y), (W, y)], fill=(0, 0, 0, 25), width=1)
img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
draw = ImageDraw.Draw(img)

# === TOP CRIMSON BAR ===
draw.rectangle([(0, 0), (W, 6)], fill=CRIMSON)

# === WARNING ICON AREA (top) ===
font_warning = ImageFont.truetype(TITLE_FONT_PATH, 80)
warning_text = "⚠"
# Use text instead of emoji for compatibility
font_label = ImageFont.truetype(THIN_FONT_PATH, 24)
label_text = "AVISO IMPORTANTE"
bbox = draw.textbbox((0, 0), label_text, font=font_label)
lw = bbox[2] - bbox[0]
draw.text(((W - lw) // 2, 100), label_text, fill=CRIMSON, font=font_label)

# Thin line
draw.line([(W//2 - 100, 138), (W//2 + 100, 138)], fill=CRIMSON, width=1)

# === DANGER STRIPES at top ===
stripe_h = 8
for i in range(0, W + 60, 60):
    draw.polygon([(i, 60), (i + 30, 60), (i + 15, 60 + stripe_h), (i - 15, 60 + stripe_h)], fill=CRIMSON)

# === MAIN TITLE — stacked vertically with breathing room ===
font_la = ImageFont.truetype(TITLE_FONT_PATH, 90)
font_dgii = ImageFont.truetype(TITLE_FONT_PATH, 180)
font_no = ImageFont.truetype(TITLE_FONT_PATH, 180)
font_esta = ImageFont.truetype(TITLE_FONT_PATH, 130)
font_jugando = ImageFont.truetype(TITLE_FONT_PATH, 155)

y_start = 200

# "LA"
text = "LA"
bbox = draw.textbbox((0, 0), text, font=font_la)
tw = bbox[2] - bbox[0]
draw.text(((W - tw) // 2, y_start), text, fill=(255, 255, 255, 120), font=font_la)

# "DGII"
text = "DGII"
bbox = draw.textbbox((0, 0), text, font=font_dgii)
tw = bbox[2] - bbox[0]
draw.text(((W - tw) // 2, y_start + 80), text, fill=WHITE, font=font_dgii)

# "NO"
text = "NO"
bbox = draw.textbbox((0, 0), text, font=font_no)
tw = bbox[2] - bbox[0]
draw.text(((W - tw) // 2, y_start + 250), text, fill=WHITE, font=font_no)

# "ESTA"
text = "ESTA"
bbox = draw.textbbox((0, 0), text, font=font_esta)
tw = bbox[2] - bbox[0]
draw.text(((W - tw) // 2, y_start + 430), text, fill=CRIMSON, font=font_esta)

# "JUGANDO"
text = "JUGANDO"
bbox = draw.textbbox((0, 0), text, font=font_jugando)
tw = bbox[2] - bbox[0]
draw.text(((W - tw) // 2, y_start + 555), text, fill=CRIMSON, font=font_jugando)

# === HORIZONTAL RULE ===
rule_y = 980
draw.rectangle([(80, rule_y), (W - 80, rule_y + 3)], fill=(255, 255, 255, 60))

# === WHITE BOX ===
box_top = 1030
box_bottom = 1480
box_left = 60
box_right = W - 60

draw.rectangle([(box_left, box_top), (box_right, box_bottom)], fill=WHITE)
draw.rectangle([(box_left, box_top), (box_left + 6, box_bottom)], fill=CRIMSON)

font_evite = ImageFont.truetype(TITLE_FONT_PATH, 64)
font_body = ImageFont.truetype(BODY_FONT_PATH, 30)

# "EVITE MULTAS"
text = "EVITE MULTAS"
bbox = draw.textbbox((0, 0), text, font=font_evite)
tw = bbox[2] - bbox[0]
draw.text(((W - tw) // 2, box_top + 30), text, fill=BLACK, font=font_evite)

# Crimson underline
draw.rectangle([(W//2 - 80, box_top + 105), (W//2 + 80, box_top + 108)], fill=CRIMSON)

# Body text
lines = [
    "A partir del 15 de mayo 2026,",
    "la facturacion electronica (e-CF)",
    "es OBLIGATORIA para todos",
    "los contribuyentes.",
    "",
    "Si tu negocio no esta listo,",
    "te expones a multas de hasta",
    "RD$50,000 por cada infraccion.",
]

y_cursor = box_top + 135
for line in lines:
    if line == "":
        y_cursor += 16
        continue
    bbox = draw.textbbox((0, 0), line, font=font_body)
    lw = bbox[2] - bbox[0]
    draw.text(((W - lw) // 2, y_cursor), line, fill=BLACK, font=font_body)
    y_cursor += 40

# === CTA BUTTON ===
cta_top = 1530
cta_h = 80
cta_left = 100
cta_right = W - 100

draw.rounded_rectangle(
    [(cta_left, cta_top), (cta_right, cta_top + cta_h)],
    radius=10,
    fill=CRIMSON
)

font_cta = ImageFont.truetype(TITLE_FONT_PATH, 40)
cta_text = "CUMPLE CON TERMINAL X"
bbox = draw.textbbox((0, 0), cta_text, font=font_cta)
ctw = bbox[2] - bbox[0]
cth = bbox[3] - bbox[1]
draw.text(
    ((W - ctw) // 2, cta_top + (cta_h - cth) // 2 - 4),
    cta_text, fill=WHITE, font=font_cta
)

# === BOTTOM INFO ===
font_small = ImageFont.truetype(THIN_FONT_PATH, 24)
font_tiny = ImageFont.truetype(THIN_FONT_PATH, 20)

info = "terminalxpos.com"
bbox = draw.textbbox((0, 0), info, font=font_small)
iw = bbox[2] - bbox[0]
draw.text(((W - iw) // 2, 1670), info, fill=(255, 255, 255, 180), font=font_small)

phone = "+1 (809) 828-2971"
bbox = draw.textbbox((0, 0), phone, font=font_small)
pw = bbox[2] - bbox[0]
draw.text(((W - pw) // 2, 1705), phone, fill=(255, 255, 255, 180), font=font_small)

tagline = "Sistema POS certificado por la DGII  •  Emisor Electronico e-CF"
bbox = draw.textbbox((0, 0), tagline, font=font_tiny)
tw = bbox[2] - bbox[0]
draw.text(((W - tw) // 2, 1750), tagline, fill=(255, 255, 255, 100), font=font_tiny)

# === SMALL X LOGO ===
if os.path.exists(XMARK_PATH):
    small_logo = Image.open(XMARK_PATH).convert("RGBA").resize((55, 55), Image.LANCZOS)
    img_rgba = img.convert("RGBA")
    img_rgba.paste(small_logo, ((W - 55) // 2, 1800), small_logo)
    img = img_rgba.convert("RGB")

# === BOTTOM CRIMSON BAR ===
draw = ImageDraw.Draw(img)
draw.rectangle([(0, H - 6), (W, H)], fill=CRIMSON)

# === LAW REFERENCE ===
font_law = ImageFont.truetype(THIN_FONT_PATH, 16)
draw.text((20, H - 30), "Ley 32-23  •  Norma General 06-2023", fill=(255, 255, 255, 60), font=font_law)

# === SAVE ===
out_path = os.path.join(os.path.dirname(__file__), "DGII-NO-ESTA-JUGANDO-1080x1920.png")
img.save(out_path, "PNG", quality=100)
print(f"Saved: {out_path}")
print(f"Size: {img.size}")
