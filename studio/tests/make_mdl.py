"""Genera modelos .mdl sintéticos (formato studio v10) para las pruebas."""

from __future__ import annotations

import math
import struct


def _name(s: str, n: int) -> bytes:
    b = s.encode("latin-1")[: n - 1]
    return b + b"\0" * (n - len(b))


class Blob:
    def __init__(self, start: int):
        self.buf = bytearray()
        self.start = start

    def add(self, data: bytes, align: int = 4) -> int:
        while (self.start + len(self.buf)) % align:
            self.buf += b"\0"
        off = self.start + len(self.buf)
        self.buf += data
        return off


def make_model(name="test", *, with_textures=True, with_mesh=True, masked_second=True,
               anim_angle=math.pi / 2) -> bytes:
    """Modelo con 3 huesos, 2 secuencias, 2 texturas y 2 mallas (tira y abanico)."""
    blob = Blob(244)

    # Huesos: raíz en el origen; hueso 1 a +10 en X; hueso 2 a +5 en X del hueso 1.
    bones = [("root", -1, (0, 0, 0, 0, 0, 0)), ("b1", 0, (10, 0, 0, 0, 0, 0)), ("b2", 1, (5, 0, 0, 0, 0, 0))]
    bone_data = b""
    for bname, parent, value in bones:
        bone_data += _name(bname, 32) + struct.pack("<ii", parent, 0) + struct.pack("<6i", *([-1] * 6))
        bone_data += struct.pack("<6f", *value) + struct.pack("<6f", 1, 1, 1, 1 / 4096, 1 / 4096, 1 / 4096)
    boneindex = blob.add(bone_data)

    # Animación de la secuencia 1: el hueso 1 rota anim_angle alrededor de Z.
    # Valores RLE: [valid=1,total=1][valor]; offset relativo al mstudioanim_t del hueso.
    raw = round(anim_angle * 4096)
    anim_table = bytearray()
    anims = [struct.pack("<6H", 0, 0, 0, 0, 0, 0)] * 3
    anims[1] = struct.pack("<6H", 0, 0, 0, 0, 0, 36 - 12)  # canal ZR del hueso 1
    for a in anims:
        anim_table += a
    anim_table += struct.pack("<BBh", 1, 1, raw)  # header + valor (frame 0)
    animindex = blob.add(bytes(anim_table))

    seqgroup = _name("default", 32) + _name("", 64) + struct.pack("<ii", 0, 0)
    seqgroupindex = blob.add(seqgroup)

    def seqdesc(label, animindex):
        d = bytearray(176)
        d[0:32] = _name(label, 32)
        struct.pack_into("<f", d, 32, 30.0)
        struct.pack_into("<i", d, 56, 1)            # numframes
        struct.pack_into("<ii", d, 120, 1, animindex)  # numblends, animindex
        struct.pack_into("<i", d, 156, 0)           # seqgroup
        return bytes(d)

    # La secuencia 0 apunta a una tabla sin offsets (pose de referencia).
    zero_anim = blob.add(struct.pack("<6H", 0, 0, 0, 0, 0, 0) * 3)
    seqindex = blob.add(seqdesc("dummy", zero_anim) + seqdesc("idle1", animindex))

    # Texturas
    tex_specs = [("Body.bmp", 0, 8, 4), ("Mask.bmp", 0x40 if masked_second else 0, 4, 4)]
    numtextures = textureindex = skinindex = 0
    texture_payloads = []
    if with_textures:
        tex_headers = bytearray()
        textureindex = blob.add(b"\0" * (80 * len(tex_specs)))
        for i, (tname, flags, w, h) in enumerate(tex_specs):
            pixels = bytes((x * 7 + y * 13 + i) % 255 for y in range(h) for x in range(w))
            if flags & 0x40:
                pixels = bytes([255]) + pixels[1:]
            palette = bytes(c for k in range(256) for c in ((k * 3) % 256, (k * 5) % 256, (k * 11) % 256))
            off = blob.add(pixels + palette, align=1)
            texture_payloads.append((tname, flags, w, h, off))
        for tname, flags, w, h, off in texture_payloads:
            tex_headers += _name(tname, 64) + struct.pack("<iiii", flags, w, h, off)
        blob.buf[textureindex - 244:textureindex - 244 + len(tex_headers)] = tex_headers
        numtextures = len(tex_specs)
        skinindex = blob.add(struct.pack("<2h", 0, 1))

    numbodyparts = bodypartindex = 0
    if with_mesh:
        # Vértices en espacio del hueso. v0..v3 en hueso 1, v4..v6 en hueso 2.
        verts = [(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)]
        vertbones = [1, 1, 1, 1, 2, 2, 2]
        norms = [(0, 0, 1)] * 7
        vertindex = blob.add(b"".join(struct.pack("<3f", *v) for v in verts))
        vertinfoindex = blob.add(bytes(vertbones), align=1)
        normindex = blob.add(b"".join(struct.pack("<3f", *n) for n in norms))
        norminfoindex = blob.add(bytes(vertbones), align=1)
        # Malla 0: tira de 4 vértices (2 triángulos) con skinref 0
        strip = struct.pack("<h", 4) + b"".join(struct.pack("<4h", v, v, v, 0) for v in (0, 1, 2, 3))
        strip += struct.pack("<h", 0)
        tri0 = blob.add(strip, align=2)
        # Malla 1: abanico de 3 vértices (1 triángulo) con skinref 1
        fan = struct.pack("<h", -3) + b"".join(struct.pack("<4h", v, v, 1, 2) for v in (4, 5, 6))
        fan += struct.pack("<h", 0)
        tri1 = blob.add(fan, align=2)
        meshindex = blob.add(struct.pack("<5i", 2, tri0, 0, 0, 0) + struct.pack("<5i", 1, tri1, 1, 0, 0))
        model = bytearray(112)
        model[0:64] = _name("body", 64)
        struct.pack_into("<8i", model, 72, 2, meshindex, len(verts), vertinfoindex, vertindex,
                         len(norms), norminfoindex, normindex)
        modelindex = blob.add(bytes(model))
        bodypartindex = blob.add(_name("body", 64) + struct.pack("<iii", 1, 1, modelindex))
        numbodyparts = 1

    header = bytearray(244)
    struct.pack_into("<4si", header, 0, b"IDST", 10)
    header[8:72] = _name(name + ".mdl", 64)
    struct.pack_into("<ii", header, 140, len(bones), boneindex)
    struct.pack_into("<iiii", header, 164, 2, seqindex, 1, seqgroupindex)
    struct.pack_into("<iii", header, 180, numtextures, textureindex, textureindex)
    struct.pack_into("<iii", header, 192, 2 if with_textures else 0, 1 if with_textures else 0, skinindex)
    struct.pack_into("<ii", header, 204, numbodyparts, bodypartindex)
    data = header + blob.buf
    struct.pack_into("<i", data, 72, len(data))
    return bytes(data)


def make_texture_file(name="test") -> bytes:
    """Archivo fooT.mdl: solo texturas (sin huesos ni mallas)."""
    full = make_model(name + "T", with_textures=True, with_mesh=False)
    return full
