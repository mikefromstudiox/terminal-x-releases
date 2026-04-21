"""Generate caption .txt files (IG + X + FB + Stories) from calendario.json."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CAL = os.path.join(HERE, "calendario.json")
OUT = os.path.join(HERE, "captions")
os.makedirs(OUT, exist_ok=True)

with open(CAL, "r", encoding="utf-8") as f:
    cal = json.load(f)

HASHTAGS_IG = "#TerminalX #POS #RepublicaDominicana #NegocioRD #SantoDomingo #eCF #DGII #Aniversario #Gracias #PymeRD"
HASHTAGS_X = "#TerminalX #POS #RD #eCF"
HASHTAGS_FB = "#TerminalX #POS #RepublicaDominicana #Aniversario"


def hero_line(piece):
    num = piece["medallion_number"]
    label = piece["medallion_label"].lower()
    kind = piece["kind"]
    if kind == "regulatory":
        return "Certificados DGII como Emisor Electrónico."
    if kind == "anniversary":
        return f"{num} {label}."
    if kind == "geographic":
        return f"En {num} {label} del país."
    if kind == "reliability":
        return f"{num} {label}."
    return f"{num} {label}."


for piece in cal["pieces"]:
    pid = piece["id"]
    date = piece["date"]
    num = piece["medallion_number"]
    label = piece["medallion_label"]
    kicker = piece["medallion_kicker"]
    zinger = piece["story_zinger"]
    gratitude = piece["gratitude_headline"]
    subline = piece["gratitude_subline"]
    cta = piece["cta_kicker"]

    hline = hero_line(piece)

    ig = f"""{hline}

{zinger}

{subline}

{cta} — Terminal X sigue aquí: certificado DGII, offline-first, soporte en WhatsApp.
👉 Escríbenos — link en bio

{HASHTAGS_IG}
"""

    x_post = f"""{hline}

{zinger}

Gracias a cada negocio que eligió Terminal X.
wa.me/18098282971

{HASHTAGS_X}"""

    fb = f"""{hline}

{zinger}

{subline}

{cta}. Terminal X está certificado por la DGII y funciona offline.
WhatsApp directo: https://wa.me/18098282971
Web: https://terminalxpos.com

{HASHTAGS_FB}
"""

    stories = f"""{num} {label}
{kicker}

{zinger}

=> Link en bio
wa.me/18098282971"""

    content = f"""# {pid}  ({date})  —  {num} · {label}

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
