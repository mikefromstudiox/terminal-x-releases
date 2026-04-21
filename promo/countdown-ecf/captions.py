"""Generate 26 caption .txt files (IG + X) from calendario.json."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CAL = os.path.join(HERE, "calendario.json")
OUT = os.path.join(HERE, "captions")
os.makedirs(OUT, exist_ok=True)

with open(CAL, "r", encoding="utf-8") as f:
    cal = json.load(f)

HASHTAGS_IG = "#eCF #DGII #RepublicaDominicana #POS #Ley3223 #TerminalX #FacturaElectronica #Emprendedor #NegocioRD #SantoDomingo"
HASHTAGS_X = "#eCF #DGII #RD #POS"

for day in cal["days"]:
    t = day["t"]
    date = day["date"]
    hook = day["hook"]
    answer = day["answer"]

    # Day-specific framing for T=0 and T=1
    if t == 0:
        header = "HOY ES EL DIA.  e-CF obligatorio."
    elif t == 1:
        header = "MANANA es obligatorio el e-CF."
    elif t <= 3:
        header = f"{t*24} horas para el e-CF obligatorio."
    else:
        header = f"T-{t} dias para el e-CF obligatorio."

    ig = f"""{header}

{hook}

{answer}

Terminal X: certificado DGII, listo hoy.
WhatsApp: wa.me/18098282971
Web: terminalxpos.com

{HASHTAGS_IG}
"""

    x_post = f"""{header}

{hook}
{answer}

Terminal X: certificado DGII.
wa.me/18098282971

{HASHTAGS_X}"""

    content = f"""# Day T-{t:02d}  ({date})

## Instagram caption (feed + carrusel)

{ig}

---

## X / Twitter (280 char target)

{x_post}

---

## Instagram Stories hook text

{hook}
=> Link en bio (wa.me/18098282971)

---

## Publishing time: 7:00 PM AST (hora pico RD)
"""
    path = os.path.join(OUT, f"T-{t:02d}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  T-{t:02d} -> {path}")

print(f"\nGenerated {len(cal['days'])} caption files.")
