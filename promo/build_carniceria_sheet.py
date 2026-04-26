# MERIDIAN BLOCK — Terminal X · Carnicería sales sheet (one page A4)
# Output: terminal-x-carniceria-explicacion.pdf
import os, textwrap
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black

OUT = r"A:\Studio X HUB\Terminal X\promo\terminal-x-carniceria-explicacion.pdf"
os.makedirs(os.path.dirname(OUT), exist_ok=True)

W, H = A4  # 595.276 × 841.890 pt

CRIMSON     = HexColor('#b3001e')
CRIMSON_DIM = HexColor('#7a0014')
DARK        = HexColor('#0a0a0a')
INK         = HexColor('#141414')
BONE        = HexColor('#f5f1ea')   # warm bone white for working surface
RULE        = HexColor('#e7e1d6')

c = canvas.Canvas(OUT, pagesize=A4)
c.setTitle('Terminal X · Carnicería — Hoja Explicativa')
c.setAuthor('Terminal X · Studio X')
c.setSubject('Sistema de Punto de Venta para Carnicerías — DR · v2.16.3')

# ── 1.  Black field (full page) ──────────────────────────────────────────────
c.setFillColor(DARK); c.rect(0, 0, W, H, fill=1, stroke=0)

# Margins
M = 36  # 12.7mm

# ── 2.  Top registration row ─────────────────────────────────────────────────
top = H - 28
c.setFillColor(CRIMSON); c.setFont('Helvetica-Bold', 7)
c.drawString(M, top, 'TX · 2.16.3 · MMXXVI')
c.setFillColor(white); c.setFont('Helvetica', 7)
c.drawRightString(W - M, top, 'EMISOR DIRECTO DGII · CERT N.º 42483')

# Tiny crimson registration marks (corners) — like fiscal seals
def reg_mark(cx, cy, size=4):
    c.setStrokeColor(CRIMSON); c.setLineWidth(0.6)
    c.line(cx - size, cy, cx + size, cy)
    c.line(cx, cy - size, cx, cy + size)
reg_mark(M, H - 14)
reg_mark(W - M, H - 14)
reg_mark(M, 14)
reg_mark(W - M, 14)

# ── 3.  Hero — TERMINAL [X] + CARNICERÍA ────────────────────────────────────
hero_y = H - 116

def draw_tracked(x, y, text, font, size, tracking, fill):
    c.setFont(font, size); c.setFillColor(fill)
    cur = x
    for ch in text:
        c.drawString(cur, y, ch)
        cur += c.stringWidth(ch, font, size) + tracking
    return cur

# Word-mark: TERMINAL ⨯ X — both share the same baseline; the X overshoots
# slightly above the cap line as a subtle butcher-mark, but never floats off.
TER_FONT, TER_SIZE, TRACK = 'Helvetica-Bold', 40, 4.6
end_x = draw_tracked(M, hero_y, 'TERMINAL', TER_FONT, TER_SIZE, TRACK, white)
# X — same baseline, larger, crimson, with a hair-tight kern
X_SIZE = 56
c.setFont('Helvetica-Bold', X_SIZE); c.setFillColor(CRIMSON)
c.drawString(end_x + 6, hero_y - 2, 'X')

# Hairline under wordmark — full bleed inside margins
c.setStrokeColor(white); c.setLineWidth(0.4)
c.line(M, hero_y - 22, W - M, hero_y - 22)

# CARNICERÍA — bold display in crimson, pulled down for breathing
y2 = hero_y - 64
draw_tracked(M, y2, 'CARNICERÍA', 'Helvetica-Bold', 32, 10, CRIMSON)

# Tagline — single whisper, italic, white
c.setFillColor(white); c.setFont('Helvetica-Oblique', 12.5)
c.drawString(M, y2 - 26, 'Tu carnicería al día — sin libreta de fiao.')

# Subline (small grotesque caps)
draw_tracked(M, y2 - 42, 'SISTEMA  DE  PUNTO  DE  VENTA   ·   v2.16.3   ·   REPÚBLICA  DOMINICANA',
             'Helvetica', 7.5, 1.2, HexColor('#7e7e7e'))

# Right-side fiscal codex serial — single line, more restrained
c.setFillColor(HexColor('#9a9a9a')); c.setFont('Helvetica', 6.5)
c.drawRightString(W - M, hero_y - 36, 'HOJA  EXPLICATIVA  ·  CLIENTE')
c.setFillColor(CRIMSON); c.setFont('Helvetica-Bold', 6.5)
c.drawRightString(W - M, hero_y - 46, 'FOLIO  001 / 001')

# ── 4.  Crimson certification meridian (the stamp) ──────────────────────────
band_h = 26
band_y = y2 - 78
c.setFillColor(CRIMSON); c.rect(0, band_y, W, band_h, fill=1, stroke=0)
# Inner thin black hairlines for fiscal-stamp feel
c.setStrokeColor(DARK); c.setLineWidth(0.3)
c.line(0, band_y + band_h - 2, W, band_y + band_h - 2)
c.line(0, band_y + 2,            W, band_y + 2)
c.setFillColor(white); c.setFont('Helvetica-Bold', 9.5)
c.drawCentredString(W / 2, band_y + 9,
    'ÚNICO POS CERTIFICADO DIRECTO DGII EN LA REPÚBLICA DOMINICANA   ·   CERT  N.º  42483')

# ── 5.  Six feature panels (2×3 grid) ───────────────────────────────────────
features = [
    ('01', 'CORTES',       'Pre-empacados o al momento. Un toggle grande, la báscula entra sola.'),
    ('02', 'FRESCURA',     'Lote por lote: verde, amarillo, rojo. El día antes de vencer, −50 % automático.'),
    ('03', 'COCINA',       '"1 lb marinada limón cubos" — sale impreso atrás o en el mismo recibo.'),
    ('04', 'MAYOREO',      '"50 lb pollo, martes" pre-armado. WhatsApp de confirmación con un toque.'),
    ('05', 'FIAO',         'Saldo y límite por cliente. Viernes 9 AM, recordatorio listo para enviar.'),
    ('06', 'BÁSCULAS',     'Plataforma y banco a la vez. Cambia entre las dos sin reiniciar la caja.'),
]

grid_top = band_y - 22
grid_bottom_target = 215      # leave room for E-CF strip + footer
col_gap = 16
row_gap = 12
cols = 2
rows = 3
card_w = (W - 2*M - col_gap) / cols
card_h = (grid_top - grid_bottom_target - (rows-1)*row_gap) / rows  # auto

# Subtle outer frame around the grid (paper-edge)
c.setStrokeColor(HexColor('#2a2a2a')); c.setLineWidth(0.4)
# (we'll skip drawing the frame — let the cards themselves define the field)

for i, (num, title, body) in enumerate(features):
    col = i % cols
    row = i // cols
    x = M + col * (card_w + col_gap)
    y = grid_top - card_h - row * (card_h + row_gap)

    # Card surface — bone white
    c.setFillColor(BONE); c.rect(x, y, card_w, card_h, fill=1, stroke=0)
    # Inner hairline border
    c.setStrokeColor(RULE); c.setLineWidth(0.5)
    c.rect(x + 0.5, y + 0.5, card_w - 1, card_h - 1, fill=0, stroke=1)

    # Crimson tab top-left — the ledger index (taller, more deliberate)
    tab_w = 34; tab_h = 16
    c.setFillColor(CRIMSON); c.rect(x, y + card_h - tab_h, tab_w, tab_h, fill=1, stroke=0)
    c.setFillColor(white); c.setFont('Helvetica-Bold', 9)
    c.drawCentredString(x + tab_w/2, y + card_h - tab_h + 5, num)

    # Title — tracked all-caps display
    title_y = y + card_h - tab_h - 26
    draw_tracked(x + 16, title_y, title, 'Helvetica-Bold', 15, 3.6, INK)

    # Crimson ranged rule (short, like a registration mark)
    c.setStrokeColor(CRIMSON); c.setLineWidth(1.4)
    c.line(x + 16, title_y - 9, x + 16 + 40, title_y - 9)

    # Body — wrapped, humanist sans, leaded for readability
    c.setFillColor(INK); c.setFont('Helvetica', 9.2)
    txt = c.beginText(x + 16, title_y - 24); txt.setLeading(12.0)
    for line in textwrap.wrap(body, width=40):
        txt.textLine(line)
    c.drawText(txt)

    # Tiny ledger footer — restrained, single registry mark
    c.setFillColor(HexColor('#8a8378')); c.setFont('Helvetica', 6)
    c.drawString(x + 16, y + 11, '·  REGISTRO  ' + num)
    c.drawRightString(x + card_w - 16, y + 11, 'TX · CARN · ' + num)

# ── 6.  E-CF auto callout ───────────────────────────────────────────────────
cta_y = 128
cta_h = 60
c.setFillColor(DARK); c.setStrokeColor(CRIMSON); c.setLineWidth(0.8)
c.rect(M, cta_y, W - 2*M, cta_h, fill=1, stroke=1)
# Crimson bookmark slab on the left
c.setFillColor(CRIMSON); c.rect(M, cta_y, 6, cta_h, fill=1, stroke=0)

# Left column — label
c.setFillColor(CRIMSON); c.setFont('Helvetica-Bold', 8)
draw_tracked(M + 18, cta_y + cta_h - 16, 'e-CF AUTOMÁTICO', 'Helvetica-Bold', 8, 1.6, CRIMSON)

# Body
c.setFillColor(white); c.setFont('Helvetica', 11)
c.drawString(M + 18, cta_y + cta_h - 34, 'Cliente con RNC  →  factura E31 sale sola.')
c.setFillColor(HexColor('#cfcfcf')); c.setFont('Helvetica-Oblique', 9)
c.drawString(M + 18, cta_y + cta_h - 48, 'Sin pasos extras. 100 % offline 72 h. Sincroniza después.')

# Right column — small numeric stamp
stamp_x = W - M - 110
c.setStrokeColor(CRIMSON); c.setLineWidth(0.6)
c.rect(stamp_x, cta_y + 10, 96, cta_h - 20, fill=0, stroke=1)
c.setFillColor(CRIMSON); c.setFont('Helvetica-Bold', 7)
c.drawCentredString(stamp_x + 48, cta_y + cta_h - 16, 'DGII')
c.setFillColor(white); c.setFont('Helvetica-Bold', 14)
c.drawCentredString(stamp_x + 48, cta_y + cta_h - 32, 'E31')
c.setFillColor(HexColor('#cfcfcf')); c.setFont('Helvetica', 6)
c.drawCentredString(stamp_x + 48, cta_y + 16, 'AUTO · MAYOREO')

# ── 7.  Pricing footer ──────────────────────────────────────────────────────
foot_y = 28

# Hairline above footer
c.setStrokeColor(HexColor('#2a2a2a')); c.setLineWidth(0.5)
c.line(M, foot_y + 70, W - M, foot_y + 70)

# Small label
c.setFillColor(HexColor('#9a9a9a')); c.setFont('Helvetica', 6.5)
draw_tracked(M, foot_y + 60, 'PLANES · PRECIOS DE LANZAMIENTO',
             'Helvetica', 6.5, 1.2, HexColor('#9a9a9a'))

# Three columns of footer info
col_xs = [M, M + 200, W - M - 170]

# Plan 1 — Facturación
c.setFillColor(white); c.setFont('Helvetica-Bold', 13)
c.drawString(col_xs[0], foot_y + 38, 'FACTURACIÓN')
c.setFillColor(CRIMSON); c.setFont('Helvetica-Bold', 16)
c.drawString(col_xs[0], foot_y + 20, 'RD$ 995')
c.setFillColor(HexColor('#9a9a9a')); c.setFont('Helvetica', 7.5)
c.drawString(col_xs[0] + 78, foot_y + 22, '/ mes')
c.setFillColor(HexColor('#9a9a9a')); c.setFont('Helvetica', 7)
c.drawString(col_xs[0], foot_y + 8,  'Una caja · 1 báscula · e-CF directo')

# Plan 2 — Pro PLUS
c.setFillColor(white); c.setFont('Helvetica-Bold', 13)
c.drawString(col_xs[1], foot_y + 38, 'PRO  PLUS')
c.setFillColor(CRIMSON); c.setFont('Helvetica-Bold', 16)
c.drawString(col_xs[1], foot_y + 20, 'RD$ 4,490')
c.setFillColor(HexColor('#9a9a9a')); c.setFont('Helvetica', 7.5)
c.drawString(col_xs[1] + 96, foot_y + 22, '/ mes')
c.setFillColor(HexColor('#9a9a9a')); c.setFont('Helvetica', 7)
c.drawString(col_xs[1], foot_y + 8,  'Multi-báscula · Mayoreo · Resumen · Promos')

# Support
c.setFillColor(white); c.setFont('Helvetica-Bold', 9)
draw_tracked(col_xs[2], foot_y + 44, 'SOPORTE  ·  WHATSAPP', 'Helvetica-Bold', 7.5, 1.6, white)
c.setFillColor(CRIMSON); c.setFont('Helvetica-Bold', 14)
c.drawString(col_xs[2], foot_y + 26, '+1 809 828 2971')
c.setFillColor(HexColor('#9a9a9a')); c.setFont('Helvetica-Oblique', 7)
c.drawString(col_xs[2], foot_y + 12, 'Soporte en español · siete días · Studio X')

# Final crimson seal at the very bottom-center
c.setFillColor(CRIMSON); c.setFont('Helvetica-Bold', 6)
c.drawCentredString(W/2, 6,
    'TERMINAL  X   ·   STUDIO  X   ·   SANTO  DOMINGO   ·   2026   ·   PIEZA  ÚNICA  DE  HOJA  EXPLICATIVA')

c.showPage(); c.save()
print('Saved:', OUT)
