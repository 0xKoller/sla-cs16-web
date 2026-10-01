"""Lector/escritor mínimo de modelos GoldSrc (.mdl, studio v10).

Hace tres cosas, sin dependencias externas:
  * listar y reemplazar texturas (índices de paleta + paleta de 256 colores),
  * listar secuencias de animación,
  * armar la malla en una pose (frame 0 de una secuencia) para el visor 3D.

Los offsets siguen engine/studio.h del Half-Life SDK.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass

# Banderas de textura (studio.h)
NF_CHROME = 0x0002
NF_FULLBRIGHT = 0x0004
NF_ADDITIVE = 0x0020
NF_MASKED = 0x0040

# Banderas de movimiento de secuencia
STUDIO_X, STUDIO_Y, STUDIO_Z = 0x1, 0x2, 0x4

HEADER_SIZE = 244
TEXTURE_SIZE = 80
BONE_SIZE = 112
SEQGROUP_SIZE = 104
SEQDESC_SIZE = 176
BODYPART_SIZE = 76
MODEL_SIZE = 112
MESH_SIZE = 20
PALETTE_SIZE = 768


class MdlError(ValueError):
    pass


@dataclass
class Texture:
    index: int        # posición en la tabla de texturas
    name: str
    flags: int
    width: int
    height: int
    offset: int       # offset de los píxeles dentro del archivo

    @property
    def masked(self) -> bool:
        return bool(self.flags & NF_MASKED)

    @property
    def pixel_count(self) -> int:
        return self.width * self.height


@dataclass
class Sequence:
    index: int
    label: str
    numframes: int
    seqgroup: int
    numblends: int
    animindex: int
    motiontype: int
    motionbone: int


@dataclass
class Bone:
    name: str
    parent: int
    value: tuple
    scale: tuple


def _cstr(raw: bytes) -> str:
    return raw.split(b"\0", 1)[0].decode("latin-1")


class StudioModel:
    """Un archivo .mdl en memoria. `data` es mutable para poder escribir texturas."""

    def __init__(self, data: bytes, name: str = "modelo"):
        self.name = name
        self.data = bytearray(data)
        if len(self.data) < HEADER_SIZE:
            raise MdlError(f"{name}: archivo demasiado chico para ser un .mdl")
        ident, version = struct.unpack_from("<4si", self.data, 0)
        if ident != b"IDST":
            raise MdlError(f"{name}: no es un modelo GoldSrc (falta la firma IDST)")
        if version != 10:
            raise MdlError(f"{name}: versión {version} no soportada (se espera 10)")
        h = self.data
        (self.numbones, self.boneindex) = struct.unpack_from("<ii", h, 140)
        (self.numseq, self.seqindex, self.numseqgroups, self.seqgroupindex) = struct.unpack_from("<iiii", h, 164)
        (self.numtextures, self.textureindex, self.texturedataindex) = struct.unpack_from("<iii", h, 180)
        (self.numskinref, self.numskinfamilies, self.skinindex) = struct.unpack_from("<iii", h, 192)
        (self.numbodyparts, self.bodypartindex) = struct.unpack_from("<ii", h, 204)
        self._check_table("texturas", self.numtextures, self.textureindex, TEXTURE_SIZE)
        self._check_table("huesos", self.numbones, self.boneindex, BONE_SIZE)
        self._check_table("secuencias", self.numseq, self.seqindex, SEQDESC_SIZE)
        self._check_table("partes", self.numbodyparts, self.bodypartindex, BODYPART_SIZE)

    # ------------------------------------------------------------------ util
    def _check_table(self, what: str, count: int, offset: int, size: int) -> None:
        if count < 0 or count > 100000:
            raise MdlError(f"{self.name}: cantidad de {what} inválida ({count})")
        if count and (offset < 0 or offset + count * size > len(self.data)):
            raise MdlError(f"{self.name}: la tabla de {what} se sale del archivo")

    def _check_span(self, offset: int, size: int, what: str) -> None:
        if offset < 0 or offset + size > len(self.data):
            raise MdlError(f"{self.name}: {what} se sale del archivo")

    def to_bytes(self) -> bytes:
        return bytes(self.data)

    # -------------------------------------------------------------- texturas
    @property
    def textures(self) -> list[Texture]:
        out = []
        for i in range(self.numtextures):
            base = self.textureindex + i * TEXTURE_SIZE
            name = _cstr(self.data[base:base + 64])
            flags, width, height, offset = struct.unpack_from("<iiii", self.data, base + 64)
            out.append(Texture(i, name, flags, width, height, offset))
        return out

    def texture_pixels(self, tex: Texture) -> tuple[bytes, bytes]:
        """Devuelve (índices, paleta RGB de 768 bytes)."""
        size = tex.pixel_count
        self._check_span(tex.offset, size + PALETTE_SIZE, f"la textura {tex.name}")
        start = tex.offset
        return bytes(self.data[start:start + size]), bytes(self.data[start + size:start + size + PALETTE_SIZE])

    def replace_texture(self, tex: Texture, indices: bytes, palette: bytes) -> None:
        """Escribe píxeles y paleta nuevos en el lugar. El tamaño no puede cambiar."""
        if len(indices) != tex.pixel_count:
            raise MdlError(
                f"{tex.name}: la imagen nueva tiene {len(indices)} píxeles y la original {tex.pixel_count}"
            )
        if len(palette) != PALETTE_SIZE:
            raise MdlError(f"{tex.name}: la paleta debe tener 256 colores")
        self._check_span(tex.offset, tex.pixel_count + PALETTE_SIZE, f"la textura {tex.name}")
        start = tex.offset
        self.data[start:start + tex.pixel_count] = indices
        self.data[start + tex.pixel_count:start + tex.pixel_count + PALETTE_SIZE] = palette

    def skin_table(self) -> list[int]:
        """Familia de skins 0: skinref -> índice de textura."""
        if not self.numskinref:
            return []
        self._check_span(self.skinindex, self.numskinref * 2, "la tabla de skins")
        return list(struct.unpack_from(f"<{self.numskinref}h", self.data, self.skinindex))

    # ------------------------------------------------------------ secuencias
    @property
    def sequences(self) -> list[Sequence]:
        out = []
        for i in range(self.numseq):
            base = self.seqindex + i * SEQDESC_SIZE
            label = _cstr(self.data[base:base + 32])
            numframes = struct.unpack_from("<i", self.data, base + 56)[0]
            motiontype, motionbone = struct.unpack_from("<ii", self.data, base + 68)
            numblends, animindex = struct.unpack_from("<ii", self.data, base + 120)
            seqgroup = struct.unpack_from("<i", self.data, base + 156)[0]
            out.append(Sequence(i, label, numframes, seqgroup, numblends, animindex, motiontype, motionbone))
        return out

    @property
    def bones(self) -> list[Bone]:
        out = []
        for i in range(self.numbones):
            base = self.boneindex + i * BONE_SIZE
            name = _cstr(self.data[base:base + 32])
            parent = struct.unpack_from("<i", self.data, base + 32)[0]
            value = struct.unpack_from("<6f", self.data, base + 64)
            scale = struct.unpack_from("<6f", self.data, base + 88)
            out.append(Bone(name, parent, value, scale))
        return out

    def _anim_value(self, ptr: int, frame: int) -> int:
        """Decodifica el valor comprimido (RLE) de un canal para `frame`."""
        k = frame
        guard = 0
        while True:
            self._check_span(ptr, 2, "una animación")
            valid, total = self.data[ptr], self.data[ptr + 1]
            if total == 0:
                raise MdlError(f"{self.name}: animación corrupta")
            if total > k:
                break
            k -= total
            ptr += (valid + 1) * 2
            guard += 1
            if guard > 100000:
                raise MdlError(f"{self.name}: animación corrupta")
        idx = k + 1 if valid > k else valid
        self._check_span(ptr + idx * 2, 2, "una animación")
        return struct.unpack_from("<h", self.data, ptr + idx * 2)[0]

    def pose(self, sequence: int | None = None, frame: int = 0) -> list[tuple[list[float], list[float]]]:
        """Posición y ángulos (radianes) por hueso. Sin secuencia: pose de referencia."""
        bones = self.bones
        result = [(list(b.value[:3]), list(b.value[3:])) for b in bones]
        if sequence is None or not (0 <= sequence < self.numseq):
            return result
        seq = self.sequences[sequence]
        if seq.seqgroup != 0:
            return result  # animación en un archivo externo: pose de referencia
        group_data = 0
        if self.numseqgroups:
            group_data = struct.unpack_from("<i", self.data, self.seqgroupindex + 100)[0]
        panim = group_data + seq.animindex
        frame = max(0, min(frame, max(seq.numframes - 1, 0)))
        try:
            self._check_span(panim, 12 * len(bones), "las animaciones")
            for i, bone in enumerate(bones):
                anim = panim + i * 12
                offsets = struct.unpack_from("<6H", self.data, anim)
                pos, ang = result[i]
                for j in range(6):
                    if offsets[j] == 0:
                        continue
                    v = self._anim_value(anim + offsets[j], frame)
                    if j < 3:
                        pos[j] = bone.value[j] + v * bone.scale[j]
                    else:
                        ang[j - 3] = bone.value[j] + v * bone.scale[j]
            mb = seq.motionbone
            if 0 <= mb < len(result):
                if seq.motiontype & STUDIO_X:
                    result[mb][0][0] = 0.0
                if seq.motiontype & STUDIO_Y:
                    result[mb][0][1] = 0.0
                if seq.motiontype & STUDIO_Z:
                    result[mb][0][2] = 0.0
        except MdlError:
            return [(list(b.value[:3]), list(b.value[3:])) for b in bones]
        return result

    def bone_transforms(self, sequence: int | None = None, frame: int = 0) -> list[list[list[float]]]:
        bones = self.bones
        poses = self.pose(sequence, frame)
        out: list[list[list[float]]] = []
        for i, bone in enumerate(bones):
            pos, ang = poses[i]
            local = quaternion_matrix(angle_quaternion(ang))
            for r in range(3):
                local[r].append(pos[r])
            if 0 <= bone.parent < i:
                out.append(concat_transforms(out[bone.parent], local))
            else:
                out.append(local)
        return out

    # ----------------------------------------------------------------- malla
    def build_mesh(self, texture_model: "StudioModel | None" = None,
                   sequence: int | None = None, frame: int = 0) -> dict:
        """Arma la geometría para el visor.

        Devuelve {"groups": [{"texture": i, "positions": [...], "normals": [...],
        "uvs": [...], "indices": [...]}], "bounds": [min, max]}. Ejes convertidos a
        Y arriba (x=Y, y=Z, z=X del motor), así el modelo mira a la cámara.
        """
        texmodel = texture_model or self
        textures = texmodel.textures
        skins = texmodel.skin_table()
        transforms = self.bone_transforms(sequence, frame)
        groups: dict[int, dict] = {}
        mins = [math.inf] * 3
        maxs = [-math.inf] * 3

        for bp in range(self.numbodyparts):
            bpbase = self.bodypartindex + bp * BODYPART_SIZE
            nummodels, _base, modelindex = struct.unpack_from("<iii", self.data, bpbase + 64)
            if nummodels <= 0:
                continue
            self._check_span(modelindex, MODEL_SIZE, "un submodelo")
            m = modelindex  # submodelo 0 = cuerpo por defecto
            (nummesh, meshindex, numverts, vertinfoindex, vertindex,
             numnorms, norminfoindex, normindex) = struct.unpack_from("<8i", self.data, m + 72)
            self._check_span(vertindex, numverts * 12, "los vértices")
            self._check_span(vertinfoindex, numverts, "los huesos de los vértices")
            self._check_span(normindex, numnorms * 12, "las normales")
            self._check_span(norminfoindex, numnorms, "los huesos de las normales")
            self._check_span(meshindex, nummesh * MESH_SIZE, "las mallas")

            verts = []
            for v in range(numverts):
                p = struct.unpack_from("<3f", self.data, vertindex + v * 12)
                b = self.data[vertinfoindex + v]
                verts.append(vector_transform(p, transforms[b]) if b < len(transforms) else list(p))
            norms = []
            for n in range(numnorms):
                p = struct.unpack_from("<3f", self.data, normindex + n * 12)
                b = self.data[norminfoindex + n]
                norms.append(vector_rotate(p, transforms[b]) if b < len(transforms) else list(p))

            for me in range(nummesh):
                numtris, triindex, skinref, _nn, _ni = struct.unpack_from(
                    "<5i", self.data, meshindex + me * MESH_SIZE)
                tex_i = skins[skinref] if 0 <= skinref < len(skins) else skinref
                if not (0 <= tex_i < len(textures)):
                    continue
                tex = textures[tex_i]
                g = groups.setdefault(tex_i, {"texture": tex_i, "positions": [], "normals": [],
                                              "uvs": [], "indices": [], "_keys": {}})
                ptr = triindex
                for _ in range(200000):
                    self._check_span(ptr, 2, "los triángulos")
                    count = struct.unpack_from("<h", self.data, ptr)[0]
                    ptr += 2
                    if count == 0:
                        break
                    fan = count < 0
                    count = abs(count)
                    self._check_span(ptr, count * 8, "los triángulos")
                    strip = []
                    for _c in range(count):
                        vi, ni, s, t = struct.unpack_from("<4h", self.data, ptr)
                        ptr += 8
                        key = (vi, ni, s, t)
                        idx = g["_keys"].get(key)
                        if idx is None:
                            if not (0 <= vi < len(verts)):
                                raise MdlError(f"{self.name}: índice de vértice inválido")
                            x, y, z = verts[vi]
                            nx, ny, nz = norms[ni] if 0 <= ni < len(norms) else (0.0, 0.0, 1.0)
                            # motor (X adelante, Y izquierda, Z arriba) -> visor (Y arriba)
                            px, py, pz = y, z, x
                            g["positions"] += [px, py, pz]
                            g["normals"] += [ny, nz, nx]
                            g["uvs"] += [s / max(tex.width, 1), t / max(tex.height, 1)]
                            idx = len(g["positions"]) // 3 - 1
                            g["_keys"][key] = idx
                            for a, val in enumerate((px, py, pz)):
                                mins[a] = min(mins[a], val)
                                maxs[a] = max(maxs[a], val)
                        strip.append(idx)
                    for k in range(2, len(strip)):
                        if fan:
                            tri = (strip[0], strip[k - 1], strip[k])
                        elif k % 2:
                            tri = (strip[k - 1], strip[k - 2], strip[k])
                        else:
                            tri = (strip[k - 2], strip[k - 1], strip[k])
                        if len(set(tri)) == 3:
                            g["indices"] += tri
                else:
                    raise MdlError(f"{self.name}: lista de triángulos sin fin")

        out_groups = []
        for g in groups.values():
            g.pop("_keys")
            if g["indices"]:
                g["positions"] = [round(v, 3) for v in g["positions"]]
                g["normals"] = [round(v, 4) for v in g["normals"]]
                g["uvs"] = [round(v, 5) for v in g["uvs"]]
                out_groups.append(g)
        if not out_groups:
            mins, maxs = [0.0] * 3, [0.0] * 3
        return {"groups": out_groups, "bounds": [mins, maxs]}


# --------------------------------------------------------------- matemática
def angle_quaternion(angles) -> list[float]:
    """Igual a AngleQuaternion de mathlib.c (ángulos en radianes)."""
    sy, cy = math.sin(angles[2] * 0.5), math.cos(angles[2] * 0.5)
    sp, cp = math.sin(angles[1] * 0.5), math.cos(angles[1] * 0.5)
    sr, cr = math.sin(angles[0] * 0.5), math.cos(angles[0] * 0.5)
    return [
        sr * cp * cy - cr * sp * sy,
        cr * sp * cy + sr * cp * sy,
        cr * cp * sy - sr * sp * cy,
        cr * cp * cy + sr * sp * sy,
    ]


def quaternion_matrix(q) -> list[list[float]]:
    x, y, z, w = q
    return [
        [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z, 2 * x * z + 2 * w * y],
        [2 * x * y + 2 * w * z, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x],
        [2 * x * z - 2 * w * y, 2 * y * z + 2 * w * x, 1 - 2 * x * x - 2 * y * y],
    ]


def concat_transforms(a, b) -> list[list[float]]:
    out = []
    for r in range(3):
        row = [a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c] for c in range(4)]
        row[3] += a[r][3]
        out.append(row)
    return out


def vector_transform(v, m) -> list[float]:
    return [v[0] * m[r][0] + v[1] * m[r][1] + v[2] * m[r][2] + m[r][3] for r in range(3)]


def vector_rotate(v, m) -> list[float]:
    return [v[0] * m[r][0] + v[1] * m[r][1] + v[2] * m[r][2] for r in range(3)]


def texture_file_for(path: str) -> str:
    """Ruta del archivo de texturas separado (fooT.mdl) de un modelo."""
    return path[:-4] + "T.mdl" if path.lower().endswith(".mdl") else path + "T.mdl"
