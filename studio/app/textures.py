"""Conversión entre texturas GoldSrc (8 bits + paleta) e imágenes PNG."""

from __future__ import annotations

import io

from PIL import Image

from .mdl import PALETTE_SIZE, Texture

MASK_INDEX = 255          # en texturas "masked" el índice 255 es transparente
MASK_COLOR = (0, 0, 255)  # color convencional para ese índice


def texture_image(tex: Texture, indices: bytes, palette: bytes) -> Image.Image:
    """Imagen en modo P (paleta), con transparencia si la textura es masked."""
    img = Image.frombytes("P", (tex.width, tex.height), indices)
    img.putpalette(palette[:PALETTE_SIZE])
    if tex.masked:
        img.info["transparency"] = MASK_INDEX
    return img


def texture_png(tex: Texture, indices: bytes, palette: bytes) -> bytes:
    buf = io.BytesIO()
    img = texture_image(tex, indices, palette)
    kwargs = {"transparency": MASK_INDEX} if tex.masked else {}
    img.save(buf, format="PNG", optimize=False, **kwargs)
    return buf.getvalue()


def load_png(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def fit_size(img: Image.Image, tex: Texture) -> tuple[Image.Image, bool]:
    """Ajusta la imagen al tamaño original (las UV del modelo dependen de él)."""
    if img.size == (tex.width, tex.height):
        return img, False
    rgba = img.convert("RGBA")
    return rgba.resize((tex.width, tex.height), Image.Resampling.LANCZOS), True


def image_to_texture(img: Image.Image, tex: Texture) -> tuple[bytes, bytes]:
    """Convierte cualquier imagen a (índices, paleta) para esta textura.

    Si la imagen ya viene con paleta propia (por ejemplo, el PNG exportado sin
    tocar), se usa tal cual para no perder calidad. Si no, se reduce a 256 colores
    (255 en texturas masked, el último queda reservado para la transparencia).
    """
    img, _ = fit_size(img, tex)

    if img.mode == "P" and _palette_usable(img, tex):
        indices = img.tobytes()
        palette = _palette_bytes(img)
        if tex.masked:
            palette = palette[: MASK_INDEX * 3] + bytes(MASK_COLOR)
        return indices, palette

    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    if tex.masked:
        # Lo transparente se pinta de negro para que no gaste colores de la paleta.
        rgb = Image.new("RGB", rgba.size, (0, 0, 0))
        rgb.paste(rgba, mask=alpha)
    else:
        # El motor no tiene transparencia en esta textura: se ignora el alfa.
        rgb = rgba.convert("RGB")
    colors = 255 if tex.masked else 256
    quant = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT,
                         dither=Image.Dither.FLOYDSTEINBERG)
    indices = bytearray(quant.tobytes())
    palette = bytearray(_palette_bytes(quant))
    if tex.masked:
        mask = alpha.tobytes()
        for i, a in enumerate(mask):
            if a < 128:
                indices[i] = MASK_INDEX
        palette[MASK_INDEX * 3: MASK_INDEX * 3 + 3] = bytes(MASK_COLOR)
    return bytes(indices), bytes(palette)


def preview_png(img: Image.Image, tex: Texture) -> bytes:
    """PNG de cómo va a quedar la textura en el juego (ya reducida a paleta)."""
    indices, palette = image_to_texture(img, tex)
    return texture_png(tex, indices, palette)


def _palette_bytes(img: Image.Image) -> bytes:
    pal = img.getpalette() or []
    pal = list(pal[:PALETTE_SIZE])
    pal += [0] * (PALETTE_SIZE - len(pal))
    return bytes(pal)


def _palette_usable(img: Image.Image, tex: Texture) -> bool:
    """La paleta propia sirve tal cual solo si la transparencia coincide con la del motor."""
    if img.size != (tex.width, tex.height):
        return False
    trans = img.info.get("transparency")
    if tex.masked:
        return trans == MASK_INDEX
    return trans is None
