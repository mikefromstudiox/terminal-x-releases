"""Generate caption .txt files (IG + X + FB + Stories) for each before-after transformation.
DR Spanish, publish time 7:00 PM AST."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CAL = os.path.join(HERE, "calendario.json")
OUT = os.path.join(HERE, "captions")
os.makedirs(OUT, exist_ok=True)

with open(CAL, "r", encoding="utf-8") as f:
    cal = json.load(f)

HASHTAGS_IG = "#TerminalX #POS #RepublicaDominicana #NegocioRD #SantoDomingo #AntesYDespues #DGII #eCF #Emprendedor #PuntoDeVenta"
HASHTAGS_X = "#TerminalX #POS #RD #NegocioRD"
HASHTAGS_FB = "#TerminalX #POS #RepublicaDominicana #AntesYDespues #DGII"

for ann in cal["transformations"]:
    slug = ann["slug"]
    date = ann["date"]
    pain = ann["pain"]
    pain_sub = ann["pain_sub"]
    fix = ann["fix"]
    fix_sub = ann["fix_sub"]
    metric = ann["metric"]
    metric_label = ann["metric_label"]
    cta_label = ann["cta_label"]

    ig = f"""ANTES: {pain}.
{pain_sub}

AHORA con Terminal X: {fix}.
{fix_sub}

La prueba → {metric} · {metric_label}.

{cta_label}.
Pruébalo hoy: wa.me/18098282971
terminalxpos.com

{HASHTAGS_IG}
"""

    x_post = f"""ANTES: {pain}.
AHORA: {fix}.

La prueba → {metric} · {metric_label}.

wa.me/18098282971

{HASHTAGS_X}"""

    fb = f"""ANTES: {pain}. {pain_sub}

AHORA con Terminal X: {fix}. {fix_sub}

La prueba: {metric} · {metric_label}.

{cta_label}.
Escríbenos por WhatsApp: wa.me/18098282971
Más info: terminalxpos.com

{HASHTAGS_FB}
"""

    stories = f"""ANTES
{pain}

AHORA
{fix}

{metric}
{metric_label}

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

## Instagram Stories (3-frame antes → ahora → prueba)

{stories}

---

## Publishing time: 7:00 PM AST (hora pico RD)
"""
    path = os.path.join(OUT, f"{slug}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  {slug} -> {path}")

print(f"\nGenerated {len(cal['transformations'])} caption file(s).")
