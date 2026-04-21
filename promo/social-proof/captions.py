"""Generate caption .txt files (IG + X + FB + Stories) from calendario.json."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CAL = os.path.join(HERE, "calendario.json")
OUT = os.path.join(HERE, "captions")
os.makedirs(OUT, exist_ok=True)

with open(CAL, "r", encoding="utf-8") as f:
    cal = json.load(f)

HASHTAGS_IG = "#TerminalX #POS #RepublicaDominicana #NegocioRD #SantoDomingo #eCF #DGII #CasoReal #Emprendedor #PymeRD"
HASHTAGS_X = "#TerminalX #POS #RD #eCF"
HASHTAGS_FB = "#TerminalX #POS #RepublicaDominicana #CasoReal"

for piece in cal["pieces"]:
    pid = piece["id"]
    date = piece["date"]
    num = piece["stat_number"]
    unit = piece["stat_unit"]
    tf = piece["stat_timeframe"]
    ctx = piece["context_headline"]
    proof = piece["proof_line"]
    kicker = piece["cta_kicker"]

    hero_line = f"{num} {unit.lower()}, {tf.lower()}."

    ig = f"""{hero_line}

{ctx}

{proof}

{kicker} — Terminal X está listo: certificado DGII, offline-first, soporte en WhatsApp.
👉 Escríbenos — link en bio

{HASHTAGS_IG}
"""

    x_post = f"""{hero_line}

{ctx}
{proof}

Terminal X: certificado DGII.
wa.me/18098282971

{HASHTAGS_X}"""

    fb = f"""{hero_line}

{ctx}

{proof}

{kicker}. Terminal X está certificado por la DGII y funciona offline.
WhatsApp directo: https://wa.me/18098282971
Web: https://terminalxpos.com

{HASHTAGS_FB}
"""

    stories = f"""{num} {unit}
{tf}

{proof}

=> Link en bio
wa.me/18098282971"""

    content = f"""# {pid}  ({date})  —  {num} {unit} · {tf}

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
