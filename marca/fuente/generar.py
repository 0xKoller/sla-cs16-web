#!/usr/bin/env python3
"""Genera los archivos de marca SLA a partir del logo (marca/web/sla-logo.svg).

Salida:
  marca/web/favicon.svg, marca/web/sla-globo.svg      (página del juego)
  marca/juego/cstrike/autoexec.cfg                    (color del HUD)
  marca/juego/cstrike/gfx/shell/colors.lst            (colores del menú del juego)
  marca/fuente/vista-menu.png                         (arte 16:10 con el logo, por si hace falta)

Nota: el menú de la versión web del motor no dibuja imagen de fondo (se compila sin esa
parte para ahorrar memoria), por eso la marca adentro del juego va por colores.

Necesita: pip install cairosvg pillow
Uso:      python3 marca/fuente/generar.py
Después:  ./texturas.sh aplicar   (o «Aplicar al juego» en el estudio) y recargar el juego.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import cairosvg
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

AQUI = Path(__file__).resolve().parent
MARCA = AQUI.parent
WEB = MARCA / "web"
JUEGO = MARCA / "juego"
FUENTES = AQUI / "fuentes"

# Colores de slatv.live
FONDO = (24, 24, 24)          # --background #181818
TARJETA = (35, 35, 35)
TEXTO = (245, 245, 245)       # --foreground #f5f5f5
APAGADO = (164, 164, 164)     # --muted-foreground #a4a4a4
VERDE = (13, 135, 80)         # --primary #0d8750
VERDE_HUD = (19, 196, 116)    # el mismo verde, más luminoso para el HUD (se dibuja sumando luz)
LOGO_GRIS = "#EAEAEA"

# Arte 16:10 con el logo corrido a la derecha (deja lugar a los botones del menú).
ANCHO, ALTO = 1600, 1000

LOGO_SVG = (WEB / "sla-logo.svg").read_text()
_paths = re.findall(r"<path\b[^>]*/>", LOGO_SVG)
LOGO_W, LOGO_H = 2469, 742
# Globo del logo: círculo de centro (2097.5, 371) y radio ~371.5 en el viewBox original.
GLOBO_CX, GLOBO_CY, GLOBO_R = 2097.5, 371.0, 371.5


def _svg(contenido: str, vb: str, w: int | None = None, h: int | None = None) -> str:
    size = f' width="{w}" height="{h}"' if w and h else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{size} fill="none">{contenido}</svg>'


def _logo_paths(color: str = LOGO_GRIS) -> str:
    return "".join(re.sub(r'fill="#[0-9A-Fa-f]{6}"', f'fill="{color}"', p) for p in _paths)


def globo_svg(color: str = LOGO_GRIS) -> str:
    x0 = GLOBO_CX - GLOBO_R
    clip = (f'<defs><clipPath id="g"><circle cx="{GLOBO_CX}" cy="{GLOBO_CY}" r="{GLOBO_R}"/></clipPath></defs>'
            f'<g clip-path="url(#g)">{_logo_paths(color)}</g>')
    return _svg(clip, f"{x0} {GLOBO_CY - GLOBO_R} {2 * GLOBO_R} {2 * GLOBO_R}")


def favicon_svg() -> str:
    lado = 718
    ancho = 560
    esc = ancho / LOGO_W
    alto = LOGO_H * esc
    tx, ty = (lado - ancho) / 2, (lado - alto) / 2
    cuerpo = (f'<rect width="{lado}" height="{lado}" rx="96" fill="#232323"/>'
              f'<g transform="translate({tx:.1f} {ty:.1f}) scale({esc:.5f})">{_logo_paths()}</g>')
    return _svg(cuerpo, f"0 0 {lado} {lado}")


def render(svg: str, ancho: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=ancho)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def resplandor(img: Image.Image, cx: float, cy: float, radio: float, color, fuerza: float) -> None:
    """Suma un resplandor radial suave (como la luz verde de los episodios)."""
    w, h = img.size
    esc = 8  # se calcula chico y se agranda: es suave igual
    m = Image.new("L", (w // esc, h // esc))
    px = m.load()
    for y in range(m.height):
        for x in range(m.width):
            d = ((x * esc - cx) ** 2 + (y * esc - cy) ** 2) ** 0.5 / radio
            v = max(0.0, 1.0 - d)
            px[x, y] = int(255 * fuerza * v * v)
    m = m.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(6))
    capa = Image.new("RGB", (w, h), color)
    img.paste(ImageChops.add(img.convert("RGB"), ImageChops.multiply(capa, Image.merge("RGB", (m, m, m)))))


def fondo_menu() -> Image.Image:
    img = Image.new("RGB", (ANCHO, ALTO), FONDO)
    # degradé vertical apenas perceptible
    grad = Image.linear_gradient("L").resize((ANCHO, ALTO))
    oscuro = Image.new("RGB", (ANCHO, ALTO), (16, 16, 16))
    claro = Image.new("RGB", (ANCHO, ALTO), (28, 28, 28))
    img = Image.composite(claro, oscuro, grad)

    resplandor(img, 1300, 1080, 950, VERDE, 0.55)
    resplandor(img, 980, 470, 620, VERDE, 0.12)

    # globo gigante de fondo, muy tenue
    globo = render(globo_svg("#FFFFFF"), 1250)
    alfa = globo.getchannel("A").point(lambda a: int(a * 0.05))
    globo.putalpha(alfa)
    base = img.convert("RGBA")
    base.alpha_composite(globo, (1330 - 625, 560 - 625))  # centrado en (1330, 560)
    img = base.convert("RGB")

    # grano fino
    ruido = Image.effect_noise((ANCHO, ALTO), 18).point(lambda v: 128 + (v - 128) // 6)
    img = ImageChops.add(img, Image.merge("RGB", (ruido,) * 3), offset=-128)

    # logo + textos
    lx, ly, lw = 600, 300, 660
    logo = render(_svg(_logo_paths(), f"0 0 {LOGO_W} {LOGO_H}"), lw)
    sombra = Image.new("RGBA", logo.size, (0, 0, 0, 0))
    sombra.putalpha(logo.getchannel("A").point(lambda a: int(a * 0.55)))
    sombra = sombra.filter(ImageFilter.GaussianBlur(18))
    base = img.convert("RGBA")
    base.alpha_composite(sombra, (lx + 6, ly + 14))
    base.alpha_composite(logo, (lx, ly))
    d = ImageDraw.Draw(base)
    titulo = ImageFont.truetype(str(FUENTES / "Geist-SemiBold.ttf"), 40)
    sub = ImageFont.truetype(str(FUENTES / "Geist-Medium.ttf"), 25)
    y = ly + logo.height + 48
    _texto_espaciado(d, (lx + 4, y), "COUNTER-STRIKE 1.6", titulo, TEXTO, 9)
    d.text((lx + 4, y + 62), "Siguiendo los acontecimientos", font=sub, fill=APAGADO)
    d.rounded_rectangle((lx + 4, y + 118, lx + 4 + 64, y + 123), radius=3, fill=(16, 170, 100))
    return base.convert("RGB")


def _texto_espaciado(d: ImageDraw.ImageDraw, xy, texto: str, fuente, color, espacio: int) -> None:
    x, y = xy
    for ch in texto:
        d.text((x, y), ch, font=fuente, fill=color)
        x += d.textlength(ch, font=fuente) + espacio



def main() -> None:
    (WEB / "favicon.svg").write_text(favicon_svg())
    (WEB / "sla-globo.svg").write_text(globo_svg())

    img = fondo_menu()
    img.resize((ANCHO // 2, ALTO // 2), Image.LANCZOS).save(AQUI / "vista-menu.png")

    r, g, b = VERDE_HUD
    (JUEGO / "cstrike").mkdir(parents=True, exist_ok=True)
    (JUEGO / "cstrike" / "autoexec.cfg").write_text(
        "// Marca SLA (lo genera marca/fuente/generar.py). El juego lo corre al arrancar.\n"
        f'hud_color "{r} {g} {b}"\n'
    )
    shell = JUEGO / "cstrike" / "gfx" / "shell"
    shell.mkdir(parents=True, exist_ok=True)
    colores = {
        "HELP_COLOR": APAGADO,                # textos de ayuda
        "PROMPT_BG_COLOR": TARJETA,           # fondo de los diálogos
        "PROMPT_TEXT_COLOR": (234, 234, 234), # botones y textos del menú (gris del logo)
        "PROMPT_FOCUS_COLOR": VERDE_HUD,      # botón con el mouse encima
        "INPUT_TEXT_COLOR": TEXTO,
        "INPUT_BG_COLOR": FONDO,
        "INPUT_FG_COLOR": (70, 70, 70),
        "CON_TEXT_COLOR": VERDE_HUD,          # texto de la consola
    }
    (shell / "colors.lst").write_text(
        "// Colores del menú con la marca SLA (lo genera marca/fuente/generar.py)\n"
        + "".join(f"{k}\t{c[0]} {c[1]} {c[2]}\n" for k, c in colores.items())
    )
    print("Listo: marca/web y marca/juego actualizados. Aplicá los cambios y recargá el juego.")


if __name__ == "__main__":
    main()
