"""Generate caption .txt files (IG + X + FB + Stories) from calendario.json.

Hashtags embedded inline per platform so the publisher pipeline doesn't
double-append piece.hashtags (same convention as countdown-ecf).

Publishing time: 7:00 PM AST.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CAL = os.path.join(HERE, "calendario.json")
OUT = os.path.join(HERE, "captions")
os.makedirs(OUT, exist_ok=True)

with open(CAL, "r", encoding="utf-8") as f:
    cal = json.load(f)

HASHTAGS_IG = "#TerminalX #POS #RepublicaDominicana #NegocioRD #SantoDomingo #eCF #DGII #OfertaRD #PymeRD #PrecioPOS"
HASHTAGS_X = "#TerminalX #POS #RD #Oferta"
HASHTAGS_FB = "#TerminalX #POS #RepublicaDominicana #Oferta"


def first_bullet_short(bullets):
    b = bullets[0]
    return b if len(b) <= 60 else b[:57].rsplit(" ", 1)[0] + "…"


for piece in cal["pieces"]:
    pid = piece["id"]
    date = piece["date"]
    antes = piece["antes_price"]
    ahora = piece["ahora_price"]
    sub = piece["ahora_sub"]
    vence = piece["vence_label"]
    incluye = piece["inclusions"]
    zinger = piece["zinger"]
    kicker = piece["cta_kicker"]
    badge = piece.get("badge", "")

    # Hero line: ANTES → AHORA. Badge in parens if punchy.
    if badge and "%" in badge or "GRATIS" in badge.upper() or "MESES" in badge.upper():
        hero = f"{antes} → {ahora}. {badge}."
    else:
        hero = f"{antes} → {ahora}. {sub.strip()}"

    bullets_block = "\n".join([f"+ {b}" for b in incluye])

    ig = f"""{hero}

{zinger}

Incluye:
{bullets_block}

Vence {vence}. {kicker}.
Terminal X es certificado DGII, offline-first y con soporte en WhatsApp.
👉 Escríbenos — link en bio

{HASHTAGS_IG}
"""

    x_post = f"""{hero}

{zinger}
Vence {vence}.

Terminal X · certificado DGII.
wa.me/18098282971

{HASHTAGS_X}"""

    fb = f"""{hero}

{zinger}

Incluye:
{bullets_block}

La promo vence el {vence}. {kicker}.
Terminal X está certificado por la DGII, funciona offline y el soporte lo manejamos en WhatsApp.
Escríbenos: https://wa.me/18098282971
Web: https://terminalxpos.com

{HASHTAGS_FB}
"""

    stories = f"""ANTES {antes}
AHORA {ahora}
{sub}

Vence {vence}

=> Link en bio
wa.me/18098282971"""

    content = f"""# {pid}  ({date})  —  {antes} → {ahora}  ·  vence {vence}

## Instagram caption (feed + carrusel)

{ig}

---

## X / Twitter (280 char target)

{x_post}

---

## Facebook post

{fb}

---

## Instagram Stories hook text

{stories}

---

## Publishing time: 7:00 PM AST (hora pico RD)
"""
    path = os.path.join(OUT, f"{pid}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  {pid} -> {path}")

print(f"\nGenerated {len(cal['pieces'])} caption files.")
