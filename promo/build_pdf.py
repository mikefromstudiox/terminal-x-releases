"""
Terminal X — Taller Mecánico — Manual de Ventas.
Industrial Vernacular philosophy. Letter, 6 pages, B/W + crimson only.
"""

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.colors import Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── palette ────────────────────────────────────────────────────────────────
BLACK   = Color(0, 0, 0)
WHITE   = Color(1, 1, 1)
CRIMSON = Color(0xB3 / 255, 0x00 / 255, 0x1E / 255)

W, H = LETTER  # 612 x 792 pt (8.5" x 11")
M = 48          # outer margin
GUT = 16        # column gutter
COL = (W - 2 * M - GUT) / 2  # 250pt — two-column rhythm

OUT = r"A:\Studio X HUB\Terminal X\promo\Terminal-X-Mecanica-Manual-Ventas.pdf"

# Built-in PDF fonts — the discipline is in composition, not font count.
SANS         = "Helvetica"
SANS_B       = "Helvetica-Bold"
SANS_O       = "Helvetica-Oblique"
MONO         = "Courier"
MONO_B       = "Courier-Bold"


# ── primitives ─────────────────────────────────────────────────────────────
def rule(c, x1, y, x2, weight=0.6, color=BLACK):
    c.setStrokeColor(color)
    c.setLineWidth(weight)
    c.line(x1, y, x2, y)


def vrule(c, x, y1, y2, weight=0.6, color=BLACK):
    c.setStrokeColor(color)
    c.setLineWidth(weight)
    c.line(x, y1, x, y2)


def block(c, x, y, w, h, color):
    c.setFillColor(color)
    c.rect(x, y, w, h, stroke=0, fill=1)


def text(c, x, y, s, font=SANS, size=9, color=BLACK, leading=None):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawString(x, y, s)


def text_right(c, x, y, s, font=SANS, size=9, color=BLACK):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawRightString(x, y, s)


def text_wrap(c, x, y, w, lines, font=SANS, size=9, leading=12, color=BLACK):
    """Manual line-break helper — caller passes a list of lines (already wrapped)."""
    c.setFillColor(color)
    c.setFont(font, size)
    cy = y
    for ln in lines:
        c.drawString(x, cy, ln)
        cy -= leading
    return cy


def wrap(s, max_chars):
    """Cheap word-wrap — splits on whitespace by character budget. Good enough at this scale."""
    out = []
    line = ""
    for w_ in s.split():
        if len(line) + len(w_) + 1 > max_chars:
            out.append(line)
            line = w_
        else:
            line = (line + " " + w_).strip()
    if line:
        out.append(line)
    return out


# ── header / footer scaffolding (every page) ──────────────────────────────
def page_chrome(c, page_no, total, eyebrow):
    # Top-left brand mark — rationed crimson rule
    block(c, M, H - M - 2, 56, 2, CRIMSON)
    text(c, M, H - M - 14, "STUDIO X", font=SANS_B, size=8.5, color=BLACK)
    text(c, M + 56, H - M - 14, "TERMINAL X", font=SANS, size=8.5, color=BLACK)

    # Top-right eyebrow + page coordinate
    text_right(c, W - M, H - M - 14, eyebrow, font=MONO, size=8, color=BLACK)
    text_right(c, W - M, H - M - 26, f"P.{page_no:02d} / {total:02d}",
               font=MONO_B, size=8, color=CRIMSON)

    # Footer hairline + serial-number style metadata
    rule(c, M, M + 22, W - M, weight=0.4)
    text(c, M, M + 10, "TERMINAL X · TALLER MECÁNICO · MANUAL DE VENTAS",
         font=MONO, size=7, color=BLACK)
    text_right(c, W - M, M + 10, "REF · TX-MEC-216-04-26",
               font=MONO, size=7, color=BLACK)


# ── reference markers — ticks like a tachometer scale ─────────────────────
def gauge_ticks(c, x, y, w, ticks=24, accent_every=6):
    for i in range(ticks + 1):
        tx = x + (w * i / ticks)
        h_ = 6 if i % accent_every == 0 else 3
        col = CRIMSON if i % accent_every == 0 else BLACK
        c.setStrokeColor(col)
        c.setLineWidth(0.7 if i % accent_every == 0 else 0.4)
        c.line(tx, y, tx, y + h_)


# ═══════════════════════════════════════════════════════════════════════════
#  PAGE 1 — PORTADA
# ═══════════════════════════════════════════════════════════════════════════
def page_1(c):
    page_chrome(c, 1, 6, "VOL · I · DR")

    # Heavy crimson left margin band — load-bearing color
    block(c, M, M + 40, 4, H - 2 * M - 80, CRIMSON)

    # Massive title — typography as architecture
    text(c, M + 22, H - M - 200, "Terminal", font=SANS_B, size=84, color=BLACK)
    text(c, M + 22, H - M - 280, "X.", font=SANS_B, size=84, color=CRIMSON)

    # Slab subtitle
    rule(c, M + 22, H - M - 310, M + 22 + 240, weight=2, color=BLACK)
    text(c, M + 22, H - M - 332, "TALLER", font=SANS_B, size=22, color=BLACK)
    text(c, M + 22 + 110, H - M - 332, "MECÁNICO", font=SANS_B, size=22, color=BLACK)

    # Tagline — three short lines, each its own gesture
    cy = H - M - 400
    text(c, M + 22, cy, "Reemplaza la libreta.", font=SANS, size=18, color=BLACK)
    cy -= 24
    text(c, M + 22, cy, "Cobra mejor.", font=SANS, size=18, color=BLACK)
    cy -= 24
    text(c, M + 22, cy, "Cumple con DGII.", font=SANS_B, size=18, color=CRIMSON)

    # Subtítulo — small caps register
    text(c, M + 22, M + 130, "MANUAL DE VENTAS · CÓMO FUNCIONA",
         font=MONO_B, size=10, color=BLACK)

    # Tachometer ticks across the bottom — the workshop dyno reference
    gauge_ticks(c, M + 22, M + 60, W - 2 * M - 22, ticks=36, accent_every=9)

    # Footer block
    text(c, M + 22, M + 42, "STUDIO X · REPÚBLICA DOMINICANA · v2.16.0 · ABRIL 2026",
         font=MONO, size=8, color=BLACK)


# ═══════════════════════════════════════════════════════════════════════════
#  PAGE 2 — EL PROBLEMA
# ═══════════════════════════════════════════════════════════════════════════
def page_2(c):
    page_chrome(c, 2, 6, "DIAGNÓSTICO")

    # Eyebrow
    text(c, M, H - M - 50, "01 · DIAGNÓSTICO", font=MONO_B, size=9, color=CRIMSON)
    rule(c, M, H - M - 56, M + 110, weight=0.6, color=CRIMSON)

    # Massive question
    text(c, M, H - M - 100, "El taller que", font=SANS_B, size=36, color=BLACK)
    text(c, M, H - M - 138, "necesita Terminal X.", font=SANS_B, size=36, color=CRIMSON)

    # Lede
    cy = H - M - 178
    for ln in wrap(
        "Si reconoces dos o más de estas señales, el taller ya está pagando el "
        "precio del control informal. Cada una es un punto de fuga de dinero, "
        "tiempo, o cumplimiento fiscal.",
        78,
    ):
        text(c, M, cy, ln, font=SANS, size=10.5, color=BLACK)
        cy -= 14

    # Symptom register — numbered ledger style
    items = [
        ("01", "Cobra con libreta, Word o Excel.",
         "Pierde piezas en la caja. Lo que entra y sale no cuadra a fin de mes."),
        ("02", "Manda cotización por WhatsApp y nunca sabe si aprobaron.",
         "El cliente queda en visto. La pieza se pide, se daña, o se pierde la venta."),
        ("03", "No emite e-CF.",
         "Desde el 15 de mayo 2026 es obligatorio. Multas DGII hasta RD$300,000."),
        ("04", "No sabe cuánto tiempo cada mecánico pasa en cada vehículo.",
         "Imposible calcular comisión justa. El mecánico bueno se va al taller del frente."),
        ("05", "Pierde clientes porque no recuerda el próximo cambio de aceite.",
         "El cliente regresa una vez. La segunda se va al taller que sí le escribió."),
        ("06", "No tiene control de qué piezas están pedidas, llegaron, o faltan.",
         "Vehículos parados en la bahía esperando una pieza que nadie sabe dónde está."),
        ("07", "Las aseguradoras le piden facturas batch.",
         "Arma el lote a mano cada mes. Errores de RNC. Pago atrasado 60 días."),
    ]

    cy = H - M - 240
    line_h = 44
    for idx, head, body in items:
        # Number column (mono, crimson)
        text(c, M, cy, idx, font=MONO_B, size=10, color=CRIMSON)
        # Head
        text(c, M + 36, cy, head, font=SANS_B, size=10.5, color=BLACK)
        # Body wrapped
        body_lines = wrap(body, 92)
        bcy = cy - 14
        for ln in body_lines:
            text(c, M + 36, bcy, ln, font=SANS, size=9.5, color=BLACK)
            bcy -= 11.5
        # Hairline separator
        rule(c, M + 36, cy - line_h + 12, W - M, weight=0.25, color=BLACK)
        cy -= line_h


# ═══════════════════════════════════════════════════════════════════════════
#  PAGE 3 — LA SOLUCIÓN
# ═══════════════════════════════════════════════════════════════════════════
def page_3(c):
    page_chrome(c, 3, 6, "SISTEMA")

    text(c, M, H - M - 50, "02 · SISTEMA", font=MONO_B, size=9, color=CRIMSON)
    rule(c, M, H - M - 56, M + 80, weight=0.6, color=CRIMSON)

    text(c, M, H - M - 100, "Todo el taller", font=SANS_B, size=36, color=BLACK)
    text(c, M, H - M - 138, "en una pantalla.", font=SANS_B, size=36, color=CRIMSON)

    cy = H - M - 178
    for ln in wrap(
        "Nueve funciones cosidas a la operación real de un taller dominicano. "
        "Cada una resuelve uno de los puntos de fuga que el diagnóstico expuso.",
        82,
    ):
        text(c, M, cy, ln, font=SANS, size=10.5, color=BLACK)
        cy -= 14

    # 9-cell module grid — 3×3 with thin rules
    grid_top = H - M - 230
    grid_left = M
    cell_w = (W - 2 * M) / 3
    cell_h = 116

    cells = [
        ("01", "COTIZACIONES",
         "Link de aprobación al celular del cliente. Firma digital."),
        ("02", "ÓRDENES DE TRABAJO",
         "Bahías, mecánicos, cronómetro start/finish por vehículo."),
        ("03", "REPUESTOS",
         "Pedidos a proveedores. Código de barras al recibir libera la WO."),
        ("04", "FOTOS ANTES/DESPUÉS",
         "Evidencia obligatoria. Adjunta a factura y a historial del vehículo."),
        ("05", "HISTORIAL POR VIN",
         "Todo lo que se le ha hecho al carro. Por placa, marca, dueño."),
        ("06", "WHATSAPP AUTO",
         "Próximo mantenimiento. Vehículo listo. Recordatorios sin tocar nada."),
        ("07", "e-CF DGII",
         "Cert #42483. Único POS certificado en RD. Directo, no proxy."),
        ("08", "ASEGURADORAS",
         "E31 por WO o lote mensual consolidado. PDF + e-CF en un click."),
        ("09", "PRODUCTIVIDAD",
         "Horas-WO por mecánico. Comisión calculada. Exporta a nómina."),
    ]

    # Outer frame
    c.setStrokeColor(BLACK)
    c.setLineWidth(0.8)
    c.rect(grid_left, grid_top - 3 * cell_h, 3 * cell_w, 3 * cell_h, stroke=1, fill=0)

    for i, (idx, head, body) in enumerate(cells):
        col = i % 3
        row = i // 3
        cx = grid_left + col * cell_w
        cy = grid_top - row * cell_h
        # Internal rules
        if col > 0:
            vrule(c, cx, cy - cell_h, cy, weight=0.3)
        if row > 0:
            rule(c, cx, cy, cx + cell_w, weight=0.3)
        # Cell ID + crimson tick
        block(c, cx + 14, cy - 18, 3, 12, CRIMSON)
        text(c, cx + 22, cy - 16, idx, font=MONO_B, size=9, color=CRIMSON)
        # Head
        text(c, cx + 14, cy - 38, head, font=SANS_B, size=10, color=BLACK)
        # Body
        body_lines = wrap(body, 28)
        bcy = cy - 56
        for ln in body_lines[:4]:
            text(c, cx + 14, bcy, ln, font=SANS, size=8.5, color=BLACK)
            bcy -= 11

    # Footer micro-caption
    text(c, M, grid_top - 3 * cell_h - 30,
         "TODAS LAS FUNCIONES INCLUIDAS DESDE EL PLAN PRO PLUS · RD$ 4,490 / MES",
         font=MONO_B, size=8, color=BLACK)


# ═══════════════════════════════════════════════════════════════════════════
#  PAGE 4 — CÓMO FUNCIONA
# ═══════════════════════════════════════════════════════════════════════════
def page_4(c):
    page_chrome(c, 4, 6, "FLUJO")

    text(c, M, H - M - 50, "03 · FLUJO", font=MONO_B, size=9, color=CRIMSON)
    rule(c, M, H - M - 56, M + 70, weight=0.6, color=CRIMSON)

    text(c, M, H - M - 100, "Un servicio,", font=SANS_B, size=36, color=BLACK)
    text(c, M, H - M - 138, "paso por paso.", font=SANS_B, size=36, color=CRIMSON)

    cy = H - M - 174
    text(c, M, cy,
         "Desde que el cliente entra hasta que recoge el vehículo. Sin papel.",
         font=SANS, size=10.5, color=BLACK)

    steps = [
        ("CLIENTE LLEGA",
         "Busca placa. Si existe, carga historial. Si no, registra vehículo nuevo (placa, VIN, marca, modelo, kilometraje)."),
        ("COTIZACIÓN",
         "Mecánico agrega mano de obra y repuestos. Manda link al celular del cliente por WhatsApp."),
        ("CLIENTE APRUEBA",
         "El cliente firma desde su celular. La cotización se vuelve Orden de Trabajo. Aún no se emite e-CF."),
        ("INICIA TRABAJO",
         "Fotos ANTES (obligatorio). Cronómetro arranca. Si falta una pieza, marca No-en-stock y pide al proveedor."),
        ("LLEGA LA PIEZA",
         "Escanea código de barras en pantalla Suministros. WhatsApp automático: «Su vehículo ABC-1234 ya tiene las piezas»."),
        ("TERMINA",
         "Fotos DESPUÉS. Cronómetro cierra. Marca Listo. WhatsApp al cliente: «Su vehículo está listo para recoger»."),
        ("COBRA",
         "Selecciona método de pago. e-CF firmado y enviado a DGII en segundos. Si está offline, queda en cola y sale al volver la señal (regla 72h)."),
        ("ASEGURADORA",
         "Si el WO es de aseguradora, el e-CF sale con su RNC. Una vez al mes, el lote consolidado se genera en PDF."),
    ]

    # Vertical timeline — left rail, numbered stations
    rail_x = M + 32
    ystart = H - M - 220
    row_h = 50

    # Background hairline rail
    rule(c, rail_x, ystart - row_h * (len(steps) - 1), rail_x,  weight=0)  # noop
    vrule(c, rail_x, ystart - row_h * (len(steps) - 1) - 4, ystart + 4, weight=0.5)

    for i, (head, body) in enumerate(steps):
        cy = ystart - i * row_h
        # Crimson station marker
        block(c, rail_x - 6, cy - 6, 12, 12, CRIMSON)
        text(c, rail_x - 4, cy - 3, f"{i+1:02d}", font=MONO_B, size=7, color=WHITE)
        # Head
        text(c, rail_x + 22, cy + 1, head, font=SANS_B, size=10, color=BLACK)
        # Body
        body_lines = wrap(body, 76)
        bcy = cy - 12
        for ln in body_lines[:2]:
            text(c, rail_x + 22, bcy, ln, font=SANS, size=9, color=BLACK)
            bcy -= 11.5


# ═══════════════════════════════════════════════════════════════════════════
#  PAGE 5 — PRECIO + ROI
# ═══════════════════════════════════════════════════════════════════════════
def page_5(c):
    page_chrome(c, 5, 6, "INVERSIÓN")

    text(c, M, H - M - 50, "04 · INVERSIÓN", font=MONO_B, size=9, color=CRIMSON)
    rule(c, M, H - M - 56, M + 100, weight=0.6, color=CRIMSON)

    text(c, M, H - M - 100, "Plan recomendado:", font=SANS_B, size=28, color=BLACK)
    text(c, M, H - M - 132, "Pro PLUS.", font=SANS_B, size=42, color=CRIMSON)

    # Big crimson price block — load-bearing color
    block(c, M, H - M - 250, W - 2 * M, 90, CRIMSON)
    text(c, M + 24, H - M - 200, "RD$ 4,490",
         font=SANS_B, size=56, color=WHITE)
    text(c, M + 24, H - M - 230, "POR MES · ANUAL 15% OFF",
         font=MONO_B, size=10, color=WHITE)
    text_right(c, W - M - 24, H - M - 200, "PRO PLUS",
               font=SANS_B, size=22, color=WHITE)
    text_right(c, W - M - 24, H - M - 222, "v2.16.0",
               font=MONO, size=9, color=WHITE)

    # Two columns: included / Pro MAX adds
    col_y = H - M - 280
    col_w = (W - 2 * M - GUT) / 2

    # LEFT — included
    text(c, M, col_y, "INCLUIDO", font=MONO_B, size=9, color=CRIMSON)
    rule(c, M, col_y - 4, M + col_w, weight=0.6)
    items_l = [
        "e-CF directo DGII (Cert #42483, único en RD)",
        "Cotizaciones · WO · Bahías · Vehículos · Citas",
        "Suministros + recordatorios WhatsApp",
        "Productividad por mecánico",
        "Reporte ITBIS + 606/607 mensual",
        "Soporte WhatsApp +1 (809) 828-2971",
    ]
    icy = col_y - 22
    for it in items_l:
        text(c, M, icy, "·", font=SANS_B, size=11, color=CRIMSON)
        for ln in wrap(it, 38):
            text(c, M + 12, icy, ln, font=SANS, size=10, color=BLACK)
            icy -= 13
        icy -= 4

    # RIGHT — Pro MAX
    rx = M + col_w + GUT
    text(c, rx, col_y, "PRO MAX · RD$ 6,990 · AGREGA", font=MONO_B, size=9, color=BLACK)
    rule(c, rx, col_y - 4, rx + col_w, weight=0.6)
    items_r = [
        "Lote mensual consolidado para aseguradoras",
        "Multi-sucursal + multi-caja",
        "Dashboard remoto desde el celular del dueño",
        "Modo offline 100% (PWA)",
    ]
    icy = col_y - 22
    for it in items_r:
        text(c, rx, icy, "·", font=SANS_B, size=11, color=BLACK)
        for ln in wrap(it, 40):
            text(c, rx + 12, icy, ln, font=SANS, size=10, color=BLACK)
            icy -= 13
        icy -= 4

    # ROI block — dense ledger
    roi_y = M + 230
    rule(c, M, roi_y + 14, W - M, weight=1, color=BLACK)
    text(c, M, roi_y, "RETORNO · MES 1", font=MONO_B, size=9, color=CRIMSON)
    rule(c, M, roi_y - 6, W - M, weight=0.3)

    rows = [
        ("Taller que factura", "RD$ 200,000 / mes", ""),
        ("Margen operativo estimado", "35%", ""),
        ("Recupera por cobrar lo olvidado en libreta", "≈ RD$ 8,000 / mes", "+"),
        ("Multa evitada por no emitir e-CF", "hasta RD$ 300,000", "+"),
        ("Pago Terminal X Pro PLUS", "RD$ 4,490 / mes", "−"),
        ("Resultado neto mes 1", "POSITIVO", "="),
    ]
    rcy = roi_y - 22
    for label, value, sign in rows:
        if sign == "=":
            block(c, M, rcy - 4, W - 2 * M, 18, BLACK)
            text(c, M + 8, rcy + 2, label, font=SANS_B, size=10, color=WHITE)
            text_right(c, W - M - 8, rcy + 2, value, font=SANS_B, size=10, color=CRIMSON)
        else:
            text(c, M, rcy + 2, label, font=SANS, size=10, color=BLACK)
            text(c, M + 8, rcy + 2, "", font=SANS, size=10)  # noop spacer
            text_right(c, W - M - 22, rcy + 2, value, font=MONO, size=10, color=BLACK)
            text_right(c, W - M, rcy + 2, sign, font=MONO_B, size=10, color=CRIMSON)
        rcy -= 18

    # Tachometer ticks at bottom
    gauge_ticks(c, M, M + 40, W - 2 * M, ticks=24, accent_every=6)


# ═══════════════════════════════════════════════════════════════════════════
#  PAGE 6 — CTA
# ═══════════════════════════════════════════════════════════════════════════
def page_6(c):
    page_chrome(c, 6, 6, "ARRANQUE")

    text(c, M, H - M - 50, "05 · ARRANQUE", font=MONO_B, size=9, color=CRIMSON)
    rule(c, M, H - M - 56, M + 90, weight=0.6, color=CRIMSON)

    # Monumental headline
    text(c, M, H - M - 130, "Empieza tu", font=SANS_B, size=46, color=BLACK)
    text(c, M, H - M - 178, "prueba GRATIS.", font=SANS_B, size=46, color=CRIMSON)

    # Three-step ledger — large numerals
    steps = [
        ("01", "Entra a", "terminalxpos.com / signup"),
        ("02", "Escoge", "«Taller Mecánico» en el setup"),
        ("03", "Listo", "Si te gusta, sigues. Si no, no pasa nada."),
    ]

    sy = H - M - 250
    for i, (num, head, body) in enumerate(steps):
        y = sy - i * 80
        # Big numeral on the left
        text(c, M, y, num, font=SANS_B, size=72, color=BLACK)
        # Vertical crimson rule
        vrule(c, M + 110, y - 50, y + 8, weight=2, color=CRIMSON)
        # Head + body
        text(c, M + 124, y, head, font=SANS, size=14, color=BLACK)
        text(c, M + 124, y - 22, body, font=SANS_B, size=18, color=BLACK)

    # Trial promise — single sentence, hard right edge
    promise_y = M + 170
    rule(c, M, promise_y + 22, W - M, weight=1, color=BLACK)
    text(c, M, promise_y + 4, "7 DÍAS PRO MAX GRATIS · SIN TARJETA",
         font=MONO_B, size=11, color=CRIMSON)

    # Contact register — fixed-width like a fiscal stamp
    contact_y = M + 110
    rule(c, M, contact_y + 18, W - M, weight=0.5)
    fields = [
        ("WHATSAPP", "+1 (809) 828-2971"),
        ("WEB",      "terminalxpos.com"),
        ("EMAIL",    "hola@terminalxpos.com"),
        ("OFICINA",  "Santo Domingo, RD"),
    ]
    cw = (W - 2 * M) / len(fields)
    for i, (k, v) in enumerate(fields):
        cx = M + i * cw
        text(c, cx, contact_y, k, font=MONO_B, size=8, color=CRIMSON)
        text(c, cx, contact_y - 14, v, font=SANS_B, size=10.5, color=BLACK)
    rule(c, M, contact_y - 22, W - M, weight=0.5)

    # Final fiscal seal
    text(c, M, M + 60, "STUDIO X SRL · SANTO DOMINGO, RD · RNC 133410321",
         font=MONO, size=8, color=BLACK)
    text(c, M, M + 48, "TERMINAL X v2.16.0 · TALLER MECÁNICO · ABRIL 2026",
         font=MONO, size=8, color=BLACK)


# ── compose ────────────────────────────────────────────────────────────────
def main():
    c = canvas.Canvas(OUT, pagesize=LETTER)
    c.setTitle("Terminal X — Taller Mecánico — Manual de Ventas")
    c.setAuthor("Studio X SRL")
    c.setSubject("Sales manual / how-it-works for the auto-shop vertical")
    c.setKeywords(["Terminal X", "Taller Mecánico", "DGII", "e-CF", "DR", "POS"])

    for fn in (page_1, page_2, page_3, page_4, page_5, page_6):
        fn(c)
        c.showPage()

    c.save()
    print(f"OK · {OUT}")


if __name__ == "__main__":
    main()
