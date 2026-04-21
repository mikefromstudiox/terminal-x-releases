"""Generate caption .txt files (IG + X + FB + Stories) for each announcement.
DR Spanish, publish time 7:00 PM AST."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CAL = os.path.join(HERE, "calendario.json")
OUT = os.path.join(HERE, "captions")
os.makedirs(OUT, exist_ok=True)

with open(CAL, "r", encoding="utf-8") as f:
    cal = json.load(f)

HASHTAGS_IG = "#TerminalX #POS #RepublicaDominicana #NegocioRD #SantoDomingo #eCF #DGII #Emprendedor #PuntoDeVenta #Novedad"
HASHTAGS_X = "#TerminalX #POS #RD #DGII"
HASHTAGS_FB = "#TerminalX #POS #RepublicaDominicana #eCF #DGII"

for ann in cal["announcements"]:
    slug = ann["slug"]
    date = ann["date"]
    kicker = ann["kicker"]
    headline = ann["headline"]
    subhead = ann["subhead"]
    bullets = ann["bullets"]
    cta_label = ann["cta_label"]
    cta_date = ann["cta_date"]

    bullet_block = "\n".join([f"- {b}" for b in bullets])
    bullet_inline = " · ".join(bullets)

    ig = f"""{kicker} en Terminal X: {headline}.

{subhead}

Qué incluye:
{bullet_block}

{cta_label} ({cta_date}).
Pruébalo hoy: wa.me/18098282971
terminalxpos.com

{HASHTAGS_IG}
"""

    x_post = f"""{kicker}: {headline}.

{subhead}

{bullet_inline}

{cta_label} · {cta_date}
wa.me/18098282971

{HASHTAGS_X}"""

    fb = f"""{kicker} en Terminal X: {headline}.

{subhead}

{bullet_block}

{cta_label} — versión {cta_date}.
Escríbenos por WhatsApp: wa.me/18098282971
Más info: terminalxpos.com

{HASHTAGS_FB}
"""

    stories = f"""{kicker}
{headline}

{subhead}

{bullets[0]}
{bullets[1]}
{bullets[2]}

=> Link en bio (wa.me/18098282971)
"""

    content = f"""# {slug}  ({date})

## Instagram caption (feed + carrusel)

{ig}

---

## X / Twitter

{x_post}

---

## Facebook

{fb}

---

## Instagram Stories (3-frame hook)

{stories}

---

## Publishing time: 7:00 PM AST (hora pico RD)
"""
    path = os.path.join(OUT, f"{slug}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  {slug} -> {path}")

print(f"\nGenerated {len(cal['announcements'])} caption file(s).")
