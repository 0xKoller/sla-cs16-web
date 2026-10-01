"""Un muñeco de cajas en formato .mdl, para probar el estudio y el visor a ojo."""

from __future__ import annotations

import math
import struct

from make_mdl import Blob, _name


def _box(cx, cy, cz, sx, sy, sz):
    """8 vértices de una caja en espacio del hueso (motor: X adelante, Y izq, Z arriba)."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    return [(cx + dx * hx, cy + dy * hy, cz + dz * hz)
            for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]


# caras: (4 índices en orden, normal)
_FACES = [
    ((4, 6, 7, 5), (1, 0, 0)),   # frente (+X)
    ((0, 1, 3, 2), (-1, 0, 0)),  # atrás
    ((2, 3, 7, 6), (0, 1, 0)),   # izquierda (+Y)
    ((0, 4, 5, 1), (0, -1, 0)),  # derecha
    ((1, 5, 7, 3), (0, 0, 1)),   # arriba
    ((0, 2, 6, 4), (0, 0, -1)),  # abajo
]


def make_boxman(tex_size=64) -> bytes:
    blob = Blob(244)
    # nombre, padre, posición relativa al padre
    bones = [
        ("pelvis", -1, (0, 0, 36)),
        ("spine", 0, (0, 0, 8)),
        ("head", 1, (0, 0, 22)),
        ("l_arm", 1, (0, 9, 18)),
        ("r_arm", 1, (0, -9, 18)),
        ("l_leg", 0, (0, 4, 0)),
        ("r_leg", 0, (0, -4, 0)),
    ]
    bone_data = b""
    for name, parent, pos in bones:
        bone_data += _name(name, 32) + struct.pack("<ii", parent, 0) + struct.pack("<6i", *([-1] * 6))
        bone_data += struct.pack("<6f", *pos, 0, 0, 0) + struct.pack("<6f", 1, 1, 1, 1 / 4096, 1 / 4096, 1 / 4096)
    boneindex = blob.add(bone_data)

    # Secuencia "idle1": brazos rotados para abajo (rotación en X del hueso, ±70°)
    n = len(bones)
    table = bytearray(12 * n)
    values = bytearray()
    for bi, angle in ((3, math.radians(70)), (4, math.radians(-70))):
        off = 12 * n + len(values) - 12 * bi
        struct.pack_into("<6H", table, 12 * bi, 0, 0, 0, off, 0, 0)  # canal XR
        values += struct.pack("<BBh", 1, 1, round(angle * 4096))
    anim_idle = blob.add(bytes(table) + bytes(values))
    anim_ref = blob.add(bytes(12 * n))
    seqgroupindex = blob.add(_name("default", 32) + _name("", 64) + struct.pack("<ii", 0, 0))

    def seqdesc(label, animindex):
        d = bytearray(176)
        d[0:32] = _name(label, 32)
        struct.pack_into("<f", d, 32, 30.0)
        struct.pack_into("<i", d, 56, 1)
        struct.pack_into("<ii", d, 120, 1, animindex)
        return bytes(d)

    seqindex = blob.add(seqdesc("dummy", anim_ref) + seqdesc("idle1", anim_idle))

    # Textura: uniforme oliva con chaleco, cinturón y cara
    W = H = tex_size
    palette = bytearray(768)
    colors = [(70, 82, 52), (52, 60, 40), (205, 170, 130), (30, 30, 30), (160, 40, 30), (200, 200, 190)]
    for i, c in enumerate(colors):
        palette[i * 3:i * 3 + 3] = bytes(c)
    pixels = bytearray(W * H)
    for y in range(H):
        for x in range(W):
            c = 0
            if (x // 4 + y // 4) % 2 == 0:
                c = 1                      # camuflaje simple
            if y < H // 4:
                c = 2                      # piel (cara/manos arriba)
                if H // 10 < y < H // 6 and (W // 4 < x < W // 3 or 2 * W // 3 < x < 3 * W // 4):
                    c = 3                  # ojos
            elif H // 2 - 3 <= y <= H // 2 + 1:
                c = 3                      # cinturón
            elif x > W - 10 and H // 4 < y < H // 2:
                c = 4                      # brazalete rojo
            pixels[y * W + x] = c
    textureindex = blob.add(b"\0" * 80)
    tex_off = blob.add(bytes(pixels) + bytes(palette), align=1)
    struct.pack_into("<64siiii", blob.buf, textureindex - 244, _name("Uniforme.bmp", 64), 0, W, H, tex_off)
    skinindex = blob.add(struct.pack("<h", 0))

    # Geometría: una caja por hueso; UV por región de la textura
    parts = [
        # hueso, caja (centro y tamaño en espacio del hueso), banda de V en la textura
        (0, (0, 0, -1, 10, 16, 8), (0.45, 0.6)),     # cadera
        (1, (0, 0, 10, 10, 18, 22), (0.25, 0.5)),    # torso
        (2, (0, 0, 5, 9, 9, 10), (0.0, 0.25)),       # cabeza
        (3, (0, 3, -9, 6, 6, 20), (0.25, 0.5)),      # brazo izq
        (4, (0, -3, -9, 6, 6, 20), (0.25, 0.5)),     # brazo der
        (5, (0, 0, -17, 7, 7, 34), (0.6, 1.0)),      # pierna izq
        (6, (0, 0, -17, 7, 7, 34), (0.6, 1.0)),      # pierna der
    ]
    verts, vbones, norms, nbones, tris = [], [], [], [], []
    for bone, (cx, cy, cz, sx, sy, sz), (v0, v1) in parts:
        corners = _box(cx, cy, cz, sx, sy, sz)
        base = len(verts)
        verts += corners
        vbones += [bone] * 8
        for fi, (quad, normal) in enumerate(_FACES):
            ni = len(norms)
            norms.append(normal)
            nbones.append(bone)
            u0, u1 = fi / 6, (fi + 1) / 6
            st = [(u0, v1), (u1, v1), (u1, v0), (u0, v0)]
            st = [(round(u * (W - 1)), round(v * (H - 1))) for u, v in st]
            a, b, c, d = quad
            for tri in ((0, 1, 2), (0, 2, 3)):
                tris.append([(base + (a, b, c, d)[k], ni, *st[k]) for k in tri])
    vertindex = blob.add(b"".join(struct.pack("<3f", *v) for v in verts))
    vertinfoindex = blob.add(bytes(vbones), align=1)
    normindex = blob.add(b"".join(struct.pack("<3f", *v) for v in norms))
    norminfoindex = blob.add(bytes(nbones), align=1)
    cmds = b""
    for tri in tris:
        cmds += struct.pack("<h", 3) + b"".join(struct.pack("<4h", *v) for v in tri)
    cmds += struct.pack("<h", 0)
    triindex = blob.add(cmds, align=2)
    meshindex = blob.add(struct.pack("<5i", len(tris), triindex, 0, 0, 0))
    model = bytearray(112)
    model[0:64] = _name("body", 64)
    struct.pack_into("<8i", model, 72, 1, meshindex, len(verts), vertinfoindex, vertindex,
                     len(norms), norminfoindex, normindex)
    modelindex = blob.add(bytes(model))
    bodypartindex = blob.add(_name("body", 64) + struct.pack("<iii", 1, 1, modelindex))

    header = bytearray(244)
    struct.pack_into("<4si", header, 0, b"IDST", 10)
    header[8:72] = _name("boxman.mdl", 64)
    struct.pack_into("<ii", header, 140, n, boneindex)
    struct.pack_into("<iiii", header, 164, 2, seqindex, 1, seqgroupindex)
    struct.pack_into("<iii", header, 180, 1, textureindex, textureindex)
    struct.pack_into("<iii", header, 192, 1, 1, skinindex)
    struct.pack_into("<ii", header, 204, 1, bodypartindex)
    data = header + blob.buf
    struct.pack_into("<i", data, 72, len(data))
    return bytes(data)
