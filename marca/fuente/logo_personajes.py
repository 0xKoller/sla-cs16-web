"""Pone el logo de SLA en la espalda y el pecho de los personajes.

Uso (desde la carpeta del proyecto, con numpy, cairosvg y pillow instalados):
    python3 marca/fuente/logo_personajes.py
Después: «Aplicar al juego» en el estudio (o ./texturas.sh aplicar) y recargar el juego.

Deja las texturas en texturas/personajes/<modelo>/ como si las hubieras subido en el
estudio, así se pueden seguir retocando ahí o volver al original con «Restaurar».

Trabaja en la pose de referencia (brazos abiertos): para cada texel de la textura busca
su punto 3D (rasterizando los triángulos en el espacio UV) y, si cae dentro del recuadro
del logo y mira hacia el lado correcto, lo pinta. Así el logo sale derecho aunque la
textura esté girada, espejada o partida en piezas.
"""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import cairosvg

RAIZ = Path(__file__).resolve().parents[2]          # carpeta del proyecto
sys.path.insert(0, str(RAIZ / 'studio'))
os.environ.setdefault('ESTUDIO_DATA', str(RAIZ))
from app import project  # noqa: E402
from app import textures as tx  # noqa: E402
from app.mdl import StudioModel  # noqa: E402

LOGO_SVG = (RAIZ / 'marca' / 'web' / 'sla-logo.svg').read_text()


def logo_rgba(ancho: int) -> np.ndarray:
    svg = LOGO_SVG.replace('#EAEAEA', '#FFFFFF')
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=ancho)
    return np.asarray(Image.open(io.BytesIO(png)).convert('RGBA')).astype(np.float32) / 255.0


def triangles(model: StudioModel, seq=None):
    mesh = model.build_mesh(None, seq)
    g = max(mesh['groups'], key=lambda g: len(g['indices']))
    P = np.array(g['positions'], dtype=np.float64).reshape(-1, 3)
    U = np.array(g['uvs'], dtype=np.float64).reshape(-1, 2)
    I = np.array(g['indices'], dtype=np.int64).reshape(-1, 3)
    return g['texture'], P, U, I, mesh['bounds']


def texel_map(P, U, I, W, H):
    """Para cada texel: punto 3D, normal de la cara y cuántos triángulos lo usan."""
    pos = np.zeros((H, W, 3))
    nor = np.zeros((H, W, 3))
    cnt = np.zeros((H, W), dtype=np.int32)
    latmin = np.full((H, W), np.inf)   # para detectar texels compartidos entre lados (espejos)
    latmax = np.full((H, W), -np.inf)
    for a, b, c in I:
        pa, pb, pc = P[a], P[b], P[c]
        n = np.cross(pb - pa, pc - pa)
        ln = np.linalg.norm(n)
        if ln == 0:
            continue
        n = -n / ln   # los triángulos del .mdl vienen en sentido horario: normal hacia afuera
        ua, ub, uc = U[a] * [W, H], U[b] * [W, H], U[c] * [W, H]
        x0 = int(max(0, np.floor(min(ua[0], ub[0], uc[0]))))
        x1 = int(min(W - 1, np.ceil(max(ua[0], ub[0], uc[0]))))
        y0 = int(max(0, np.floor(min(ua[1], ub[1], uc[1]))))
        y1 = int(min(H - 1, np.ceil(max(ua[1], ub[1], uc[1]))))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (ub[1] - uc[1]) * (ua[0] - uc[0]) + (uc[0] - ub[0]) * (ua[1] - uc[1])
        if abs(d) < 1e-9:
            continue
        w0 = ((ub[1] - uc[1]) * (xs - uc[0]) + (uc[0] - ub[0]) * (ys - uc[1])) / d
        w1 = ((uc[1] - ua[1]) * (xs - uc[0]) + (ua[0] - uc[0]) * (ys - uc[1])) / d
        w2 = 1 - w0 - w1
        e = -0.02
        dentro = (w0 >= e) & (w1 >= e) & (w2 >= e)
        if not dentro.any():
            continue
        p = w0[..., None] * pa + w1[..., None] * pb + w2[..., None] * pc
        yy, xx = np.nonzero(dentro)
        ty, tx_ = yy + y0, xx + x0
        nueva = cnt[ty, tx_] == 0
        pos[ty[nueva], tx_[nueva]] = p[yy[nueva], xx[nueva]]
        nor[ty[nueva], tx_[nueva]] = n
        cnt[ty, tx_] += 1
        lt = p[yy, xx] @ np.cross(np.array([-1.0, 0, 0]), np.array([0, 1.0, 0]))
        np.minimum.at(latmin, (ty, tx_), lt)
        np.maximum.at(latmax, (ty, tx_), lt)
    texel_map.latmin, texel_map.latmax = latmin, latmax
    return pos, nor, cnt


FRENTE = np.array([-1.0, 0.0, 0.0])   # en la pose de referencia los modelos miran a -x
ARRIBA = np.array([0.0, 1.0, 0.0])
DERECHA = np.cross(FRENTE, ARRIBA)     # derecha del personaje


def pintar(img: np.ndarray, pos, nor, cnt, logo: np.ndarray, centro, ancho, mirando_atras: bool,
           color, profundidad=(-1e9, 1e9), umbral_normal=0.35):
    """Pinta el logo proyectado. centro = (lateral, alto) del centro del logo, en unidades."""
    lh, lw = logo.shape[:2]
    alto = ancho * lh / lw
    lateral = pos @ DERECHA
    if mirando_atras:
        u = (lateral - centro[0]) / ancho + 0.5           # visto de atrás: derecha = derecha del personaje
        mira = (nor @ (-FRENTE)) > umbral_normal
        prof = pos @ (-FRENTE)
    else:
        u = (centro[0] - lateral) / ancho + 0.5           # visto de frente: derecha = izquierda del personaje
        mira = (nor @ FRENTE) > umbral_normal
        prof = pos @ FRENTE
    v = (centro[1] + alto / 2 - pos[:, :, 1]) / alto
    sel = (cnt > 0) & mira & (u >= 0) & (u < 1) & (v >= 0) & (v < 1) & (prof > profundidad[0]) & (prof < profundidad[1])
    yy, xx = np.nonzero(sel)
    if not len(yy):
        return 0, sel
    lx = np.clip((u[yy, xx] * lw).astype(int), 0, lw - 1)
    ly = np.clip((v[yy, xx] * lh).astype(int), 0, lh - 1)
    # muestreo un poco suavizado: promedio de 3x3 del logo (el logo es mucho más grande)
    a = np.zeros(len(yy))
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            a += logo[np.clip(ly + dy * 2, 0, lh - 1), np.clip(lx + dx * 2, 0, lw - 1), 3]
    a /= 9
    base = img[yy, xx, :3]
    lum = (base @ np.array([0.299, 0.587, 0.114]))
    ref = np.median(lum[a > 0.5]) if (a > 0.5).any() else lum.mean()
    sombra = np.clip(lum / max(ref, 1e-3), 0.65, 1.2)[:, None]   # conserva pliegues y sombras de la tela
    tinta = np.array(color, dtype=np.float32)[None, :] / 255.0 * sombra
    img[yy, xx, :3] = base * (1 - a[:, None]) + np.clip(tinta, 0, 1) * a[:, None]
    return int((a > 0.5).sum()), sel


# Dónde va el logo, en unidades del juego (el personaje mide ~72): [lateral, altura, ancho].
ESPALDA = [0.0, 46.5, 11.0]
PECHO = [0.0, 53.0, 6.0]
CLARO = (234, 234, 234)   # gris del logo, sobre telas oscuras
VERDE = (13, 135, 80)     # verde SLA, sobre telas claras
MODELOS = {
    'terror': {}, 'leet': {}, 'guerilla': {}, 'arctic': {'color': VERDE},
    'urban': {}, 'gsg9': {}, 'sas': {}, 'gign': {},
}


def main() -> None:
    logo = logo_rgba(1600)
    for nombre, opciones in MODELOS.items():
        mid = f'player/{nombre}'
        try:
            entry = project.get_entry(mid)
        except project.ProyectoError:
            print(f'{nombre}: no está en build/juego, lo salteo')
            continue
        m = StudioModel((project.BASE / entry.path).read_bytes(), nombre)
        ti, P, U, I, _ = triangles(m, None)
        tex = m.textures[ti]
        img = np.asarray(tx.texture_image(tex, *m.texture_pixels(tex)).convert('RGB')).astype(np.float32) / 255
        H, W = img.shape[:2]
        pos, nor, cnt = texel_map(P, U, I, W, H)
        for (lat, alto, ancho), atras in ((ESPALDA, True), (PECHO, False)):
            pintar(img, pos, nor, cnt, logo, (lat, alto), ancho, atras, opciones.get('color', CLARO))
        buf = io.BytesIO()
        Image.fromarray((img * 255).astype(np.uint8)).save(buf, format='PNG')
        info = project.model_info(mid)
        idx = next(i for i, t in enumerate(info['textures']) if t['width'] == W and t['height'] == H)
        project.save_upload(mid, idx, buf.getvalue())
        print(f'{nombre}: logo puesto en {info["textures"][idx]["file"]}')
    print('Listo. Tocá «Aplicar al juego» en el estudio y recargá el juego.')


if __name__ == '__main__':
    main()
