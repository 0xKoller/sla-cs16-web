"""Archivos del proyecto: catálogo de modelos, texturas editadas y armado de valve.zip."""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from . import textures as tx
from .mdl import MdlError, StudioModel, texture_file_for

DATA = Path(os.environ.get("ESTUDIO_DATA", "/data"))
BUILD = Path(os.environ.get("ESTUDIO_BUILD", DATA / "build"))
BASE = Path(os.environ.get("ESTUDIO_BASE", BUILD / "juego"))
EDITS = Path(os.environ.get("ESTUDIO_TEXTURAS", DATA / "texturas"))
OVERRIDES = BUILD / "overrides"
BASE_ZIP = BUILD / "base.zip"
VALVE_ZIP = BUILD / "valve.zip"
STATE = BUILD / "estado.json"
MANIFEST = ".originales.json"

# Lo que no viaja al navegador: código nativo y carpetas que CS 1.6 no usa ahí.
# Misma lista que el paquete de CSweb (probada con este cliente web). Se dejan
# valve/halflife.wad y todos los *.lst (el motor los necesita).
_DIRS_FUERA = {
    "valve": ["maps", "media", "overviews", "cl_dlls", "dlls", "save", "logs",
              "controller_configs", "downloads"],
    "cstrike": ["cl_dlls", "dlls", "overviews", "manual", "save", "logs", "downloads"],
}
_EXT_FUERA = [".dll", ".so", ".dylib", ".exe", ".icns", ".ico", ".dem", ".pdb", ".lib", ".vdf", ".fgd"]
ZIP_EXCLUDES = [f"{g}/{d}/*" for g, ds in _DIRS_FUERA.items() for d in ds] + [f"*{e}" for e in _EXT_FUERA]
ASSETS_JSON = BUILD / "assets.json"

PLAYER_NAMES = {
    "terror": ("Phoenix Connexion", "T"),
    "leet": ("Elite Crew", "T"),
    "arctic": ("Arctic Avengers", "T"),
    "guerilla": ("Guerilla Warfare", "T"),
    "militia": ("Midwest Militia", "T"),
    "urban": ("SEAL Team 6", "CT"),
    "gsg9": ("GSG-9", "CT"),
    "sas": ("SAS", "CT"),
    "gign": ("GIGN", "CT"),
    "spetsnaz": ("Spetsnaz", "CT"),
    "vip": ("VIP", "CT"),
}

CATEGORIES = [
    ("personajes", "Personajes"),
    ("v", "Armas en primera persona"),
    ("p", "Armas en la mano de otros"),
    ("w", "Armas tiradas en el piso"),
]

_build_lock = threading.Lock()


class ProyectoError(Exception):
    """Error que se le puede mostrar tal cual a la persona."""


@dataclass
class Entry:
    id: str
    label: str
    category: str
    path: str            # relativo a BASE, ej. cstrike/models/player/leet/leet.mdl
    folder: str          # relativo a EDITS, ej. personajes/leet
    team: str = ""

    def as_dict(self) -> dict:
        return {"id": self.id, "label": self.label, "category": self.category,
                "path": self.path, "folder": "texturas/" + self.folder, "team": self.team}


# ------------------------------------------------------------------ catálogo
_catalog_cache: dict | None = None


def catalog() -> dict[str, Entry]:
    global _catalog_cache
    if _catalog_cache is not None:
        return _catalog_cache
    entries: dict[str, Entry] = {}
    models = BASE / "cstrike" / "models"
    players = models / "player"
    if players.is_dir():
        for d in sorted(players.iterdir()):
            mdl = d / f"{d.name}.mdl"
            if d.is_dir() and mdl.is_file():
                label, team = PLAYER_NAMES.get(d.name, (d.name, ""))
                entries[f"player/{d.name}"] = Entry(
                    f"player/{d.name}", label, "personajes",
                    str(mdl.relative_to(BASE)), f"personajes/{d.name}", team)
    if models.is_dir():
        for f in sorted(models.glob("*.mdl")):
            m = re.match(r"^([vpw])_(.+)\.mdl$", f.name)
            if not m or f.stem.endswith("T"):
                continue
            entries[f.stem] = Entry(f.stem, m.group(2), m.group(1),
                                    str(f.relative_to(BASE)), f"armas/{f.stem}")
    if entries:
        _catalog_cache = entries
    return entries


def get_entry(model_id: str) -> Entry:
    entry = catalog().get(model_id or "")
    if not entry:
        raise ProyectoError(f"No existe el modelo «{model_id}».")
    return entry


def base_ready() -> bool:
    return (BASE / "cstrike").is_dir() and (BASE / "valve").is_dir()


# ------------------------------------------------------------------ modelos
def _load(entry: Entry) -> tuple[StudioModel, StudioModel, str]:
    """Modelo principal, modelo que tiene las texturas y su ruta relativa."""
    main_path = BASE / entry.path
    try:
        main = StudioModel(main_path.read_bytes(), entry.path)
    except OSError as e:
        raise ProyectoError(f"No pude leer {entry.path}: {e}") from e
    except MdlError as e:
        raise ProyectoError(str(e)) from e
    if main.numtextures:
        return main, main, entry.path
    tpath = texture_file_for(entry.path)
    try:
        texmodel = StudioModel((BASE / tpath).read_bytes(), tpath)
    except (OSError, MdlError) as e:
        raise ProyectoError(f"El modelo guarda las texturas en {tpath}, pero no pude leerlo: {e}") from e
    return main, texmodel, tpath


def _file_names(texmodel: StudioModel) -> list[str]:
    names, seen = [], set()
    for t in texmodel.textures:
        stem = re.sub(r"\.(bmp|tga|png)$", "", t.name, flags=re.I)
        stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_") or "textura"
        name = f"{stem}.png"
        if name.lower() in seen:
            name = f"{stem}_{t.index}.png"
        seen.add(name.lower())
        names.append(name)
    return names


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _folder(entry: Entry) -> Path:
    return EDITS / entry.folder


def _manifest(entry: Entry) -> dict | None:
    p = _folder(entry) / MANIFEST
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return None


def export_originals(model_id: str, overwrite: bool = False) -> Path:
    """Copia las texturas originales a texturas/<modelo>/ para editarlas."""
    entry = get_entry(model_id)
    _, texmodel, _ = _load(entry)
    folder = _folder(entry)
    folder.mkdir(parents=True, exist_ok=True)
    names = _file_names(texmodel)
    manifest = {"modelo": entry.id, "archivo": entry.path, "texturas": {}}
    for tex, name in zip(texmodel.textures, names):
        png = tx.texture_png(tex, *texmodel.texture_pixels(tex))
        target = folder / name
        if overwrite or not target.exists():
            target.write_bytes(png)
        manifest["texturas"][name] = {"indice": tex.index, "sha256": _sha(png),
                                      "ancho": tex.width, "alto": tex.height}
    (folder / MANIFEST).write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    readme = folder / "LEEME.txt"
    if not readme.exists():
        readme.write_text(
            "Editá estos PNG con el programa que quieras y guardalos con el mismo nombre.\n"
            "Tienen que mantener el mismo tamaño (si no, el estudio los ajusta solo).\n"
            "Después tocá «Aplicar al juego» en el estudio (http://localhost:27080)\n"
            "o corré ./texturas.sh aplicar, y recargá la página del juego.\n")
    return folder


def _edited_paths(entry: Entry, texmodel: StudioModel) -> dict[int, Path]:
    manifest = _manifest(entry)
    if not manifest:
        return {}
    folder = _folder(entry)
    out = {}
    for name, info in manifest.get("texturas", {}).items():
        p = folder / name
        idx = info.get("indice")
        if not isinstance(idx, int) or not (0 <= idx < texmodel.numtextures):
            continue
        try:
            if p.is_file() and _sha(p.read_bytes()) != info.get("sha256"):
                out[idx] = p
        except OSError:
            continue
    return out


def model_info(model_id: str) -> dict:
    entry = get_entry(model_id)
    main, texmodel, _ = _load(entry)
    edited = _edited_paths(entry, texmodel)
    names = _file_names(texmodel)
    seqs = [{"index": s.index, "label": s.label, "frames": s.numframes}
            for s in main.sequences if s.seqgroup == 0]
    return {
        **entry.as_dict(),
        "exported": _manifest(entry) is not None,
        "textures": [{"index": t.index, "name": t.name, "file": names[t.index],
                      "width": t.width, "height": t.height, "masked": t.masked,
                      "edited": t.index in edited} for t in texmodel.textures],
        "sequences": seqs,
        "defaultSequence": default_sequence(main),
    }


def default_sequence(model: StudioModel) -> int | None:
    seqs = [s for s in model.sequences if s.seqgroup == 0]
    if not seqs:
        return None
    for wanted in ("ref_aim_carbine", "ref_aim_rifle", "idle1", "idle"):
        for s in seqs:
            if s.label.lower() == wanted:
                return s.index
    return seqs[0].index


def mesh(model_id: str, sequence: int | None) -> dict:
    entry = get_entry(model_id)
    main, texmodel, _ = _load(entry)
    if sequence is None:
        sequence = default_sequence(main)
    try:
        data = main.build_mesh(texmodel, sequence, 0)
    except MdlError as e:
        raise ProyectoError(str(e)) from e
    data["textures"] = [{"index": t.index, "masked": t.masked,
                         "additive": bool(t.flags & 0x20)} for t in texmodel.textures]
    data["sequence"] = sequence
    return data


def texture_png(model_id: str, index: int, variant: str) -> bytes:
    entry = get_entry(model_id)
    _, texmodel, _ = _load(entry)
    texs = texmodel.textures
    if not (0 <= index < len(texs)):
        raise ProyectoError("Esa textura no existe.")
    tex = texs[index]
    original = tx.texture_png(tex, *texmodel.texture_pixels(tex))
    if variant == "original":
        return original
    path = _edited_paths(entry, texmodel).get(index)
    if not path:
        return original
    data = path.read_bytes()
    if variant == "current":
        return data
    try:
        return tx.preview_png(tx.load_png(data), tex)
    except Exception as e:  # noqa: BLE001 - imagen rota o formato raro
        raise ProyectoError(f"No pude leer {path.name}: {e}") from e


def save_upload(model_id: str, index: int, data: bytes) -> dict:
    entry = get_entry(model_id)
    _, texmodel, _ = _load(entry)
    texs = texmodel.textures
    if not (0 <= index < len(texs)):
        raise ProyectoError("Esa textura no existe.")
    tex = texs[index]
    try:
        img = tx.load_png(data)
    except Exception as e:  # noqa: BLE001
        raise ProyectoError("No pude abrir la imagen. Subí un PNG, JPG o BMP.") from e
    if img.width > 4096 or img.height > 4096:
        raise ProyectoError("La imagen es demasiado grande (máximo 4096 px por lado).")
    fitted, resized = tx.fit_size(img, tex)
    if _manifest(entry) is None:
        export_originals(model_id)
    name = _file_names(texmodel)[index]
    buf = io.BytesIO()
    save_img = fitted if fitted.mode in ("P", "RGB", "RGBA", "L") else fitted.convert("RGBA")
    save_img.save(buf, format="PNG")
    (_folder(entry) / name).write_bytes(buf.getvalue())
    return {"file": name, "resized": resized, "size": [tex.width, tex.height]}


def reset(model_id: str, index: int | None) -> None:
    entry = get_entry(model_id)
    folder = _folder(entry)
    if index is None:
        if folder.is_dir():
            shutil.rmtree(folder)
        return
    _, texmodel, _ = _load(entry)
    texs = texmodel.textures
    if not (0 <= index < len(texs)):
        raise ProyectoError("Esa textura no existe.")
    if _manifest(entry) is None:
        return
    tex = texs[index]
    name = _file_names(texmodel)[index]
    (folder / name).write_bytes(tx.texture_png(tex, *texmodel.texture_pixels(tex)))


# --------------------------------------------------------------- armado zip
@contextlib.contextmanager
def _file_lock():
    """Evita dos armados a la vez (el estudio y ./texturas.sh aplicar)."""
    BUILD.mkdir(parents=True, exist_ok=True)
    with _build_lock, open(BUILD / ".lock", "w") as fh:
        locked = False
        try:
            fcntl.flock(fh, fcntl.LOCK_EX)
            locked = True
        except OSError:
            pass  # algunas carpetas compartidas no soportan locks: alcanza con el del proceso
        try:
            yield
        finally:
            if locked:
                fcntl.flock(fh, fcntl.LOCK_UN)


def _run_zip(args: list[str], cwd: Path) -> None:
    res = subprocess.run(["zip", *args], cwd=cwd, capture_output=True, text=True)
    if res.returncode not in (0, 12):  # 12 = "nada para hacer"
        raise ProyectoError(f"zip falló ({res.returncode}): {res.stderr.strip() or res.stdout.strip()}")


def ensure_base_zip(log=print) -> None:
    if BASE_ZIP.is_file() and BASE_ZIP.stat().st_size > 0:
        return
    if not base_ready():
        raise ProyectoError("Todavía no están los archivos del juego en build/juego. Corré ./start.sh.")
    log("Armando base.zip con los archivos del juego (una sola vez, tarda un poco)...")
    tmp = BUILD / "base.zip.tmp"
    tmp.unlink(missing_ok=True)
    args = ["-1", "-r", "-q", str(tmp), "valve", "cstrike", "-x", *ZIP_EXCLUDES]
    _run_zip(args, BASE)
    os.replace(tmp, BASE_ZIP)


def _edit_signature() -> list:
    sig = []
    for entry in catalog().values():
        manifest = _manifest(entry)
        if not manifest:
            continue
        folder = _folder(entry)
        for name, info in sorted(manifest.get("texturas", {}).items()):
            p = folder / name
            try:
                h = _sha(p.read_bytes()) if p.is_file() else None
            except OSError:
                h = None
            if h and h != info.get("sha256"):
                sig.append([entry.id, name, h])
    return sorted(sig)


def edited_ids() -> set[str]:
    return {row[0] for row in _edit_signature()}


def _read_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def apply(log=print) -> dict:
    """Inyecta las texturas editadas en copias de los modelos y rearma valve.zip."""
    if not base_ready():
        raise ProyectoError("Todavía no están los archivos del juego. Corré ./start.sh.")
    with _file_lock():
        started = time.time()
        ensure_base_zip(log)
        wanted: dict[str, bytes] = {}
        report = []
        for entry in catalog().values():
            if _manifest(entry) is None:
                continue
            main, texmodel, texpath = _load(entry)
            edited = _edited_paths(entry, texmodel)
            if not edited:
                continue
            texs = texmodel.textures
            changed = []
            for idx, path in sorted(edited.items()):
                tex = texs[idx]
                try:
                    img = tx.load_png(path.read_bytes())
                except Exception as e:  # noqa: BLE001
                    raise ProyectoError(f"No pude abrir {entry.folder}/{path.name}: {e}") from e
                indices, palette = tx.image_to_texture(img, tex)
                texmodel.replace_texture(tex, indices, palette)
                changed.append(path.name)
            wanted[texpath] = texmodel.to_bytes()
            report.append({"modelo": entry.id, "texturas": changed})

        # Escribir overrides nuevos y borrar los que ya no corresponden.
        OVERRIDES.mkdir(parents=True, exist_ok=True)
        for rel, data in wanted.items():
            target = OVERRIDES / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, target)
        for f in sorted(OVERRIDES.rglob("*"), reverse=True):
            rel = str(f.relative_to(OVERRIDES))
            if f.is_file() and rel not in wanted:
                f.unlink()
            elif f.is_dir() and not any(f.iterdir()):
                f.rmdir()

        tmpzip = BUILD / "valve.zip.tmp"
        tmpzip.unlink(missing_ok=True)
        shutil.copyfile(BASE_ZIP, tmpzip)
        if wanted:
            _run_zip(["-1", "-q", str(tmpzip), *sorted(wanted)], OVERRIDES)
        os.replace(tmpzip, VALVE_ZIP)
        _write_assets_meta(wanted)

        state = {"aplicado": time.time(), "firma": _edit_signature(), "cambios": report,
                 "segundos": round(time.time() - started, 1)}
        STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False))
        log(f"valve.zip listo en {state['segundos']} s ({len(report)} modelo(s) modificado(s)).")
        return state


def _write_assets_meta(wanted: dict[str, bytes]) -> dict:
    """assets.json: el navegador guarda valve.zip según esta versión y lo vuelve a
    bajar sólo cuando cambia (o sea, cuando aplicás cambios)."""
    import zipfile

    st = BASE_ZIP.stat()
    h = hashlib.sha1(f"base:{st.st_size}:{st.st_mtime_ns}\n".encode())
    for rel in sorted(wanted):
        h.update(f"{rel}:{_sha(wanted[rel])}\n".encode())
    with zipfile.ZipFile(VALVE_ZIP) as z:
        infos = [i for i in z.infolist() if not i.is_dir()]
    meta = {"version": h.hexdigest()[:16], "files": len(infos),
            "size": VALVE_ZIP.stat().st_size, "unpacked": sum(i.file_size for i in infos)}
    tmp = ASSETS_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, indent=2))
    os.replace(tmp, ASSETS_JSON)
    return meta


def build(log=print) -> None:
    """Primer armado: base.zip + valve.zip (con los cambios que ya existan)."""
    apply(log)


def status() -> dict:
    st = _read_state()
    zip_info = None
    if VALVE_ZIP.is_file():
        s = VALVE_ZIP.stat()
        zip_info = {"bytes": s.st_size, "modificado": s.st_mtime}
    pending = None
    if base_ready():
        pending = _edit_signature() != st.get("firma", [])
    return {
        "baseLista": base_ready(),
        "valveZip": zip_info,
        "ultimoAplicado": st.get("aplicado"),
        "cambiosAplicados": st.get("cambios", []),
        "pendiente": pending,
        "armando": _build_lock.locked(),
    }
