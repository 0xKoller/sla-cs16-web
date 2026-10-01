import io
import json
import math
import socket
import sys
import threading
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

import pytest
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from make_mdl import make_model, make_texture_file  # noqa: E402

from app import textures as tx  # noqa: E402
from app.mdl import MdlError, StudioModel  # noqa: E402


# ------------------------------------------------------------------- mdl
def test_parse_textures_and_sequences():
    m = StudioModel(make_model())
    names = [t.name for t in m.textures]
    assert names == ["Body.bmp", "Mask.bmp"]
    assert (m.textures[0].width, m.textures[0].height) == (8, 4)
    assert m.textures[1].masked and not m.textures[0].masked
    assert [s.label for s in m.sequences] == ["dummy", "idle1"]
    assert m.skin_table() == [0, 1]


def test_rejects_garbage():
    with pytest.raises(MdlError):
        StudioModel(b"hola")
    bad = bytearray(make_model())
    bad[0:4] = b"XXXX"
    with pytest.raises(MdlError):
        StudioModel(bytes(bad))
    bad = bytearray(make_model())
    bad[4] = 44
    with pytest.raises(MdlError):
        StudioModel(bytes(bad))


def test_replace_texture_in_place():
    data = make_model()
    m = StudioModel(data)
    tex = m.textures[0]
    idx, pal = m.texture_pixels(tex)
    new_idx = bytes([7]) * len(idx)
    new_pal = bytes(range(256)) * 3
    m.replace_texture(tex, new_idx, new_pal)
    out = m.to_bytes()
    assert len(out) == len(data)
    m2 = StudioModel(out)
    assert m2.texture_pixels(m2.textures[0]) == (new_idx, new_pal)
    # la otra textura no cambia
    assert m2.texture_pixels(m2.textures[1]) == StudioModel(data).texture_pixels(StudioModel(data).textures[1])
    with pytest.raises(MdlError):
        m.replace_texture(tex, b"\0" * 3, new_pal)


def test_mesh_reference_pose():
    m = StudioModel(make_model())
    mesh = m.build_mesh(sequence=0)
    groups = {g["texture"]: g for g in mesh["groups"]}
    assert set(groups) == {0, 1}
    # Tira de 4 vértices = 2 triángulos; abanico de 3 = 1 triángulo
    assert len(groups[0]["indices"]) == 6
    assert len(groups[1]["indices"]) == 3
    # v0 = (1,0,0) en el hueso 1 (pos 10,0,0) -> motor (11,0,0) -> visor (0,0,11)
    p = groups[0]["positions"][0:3]
    assert p == pytest.approx([0, 0, 11])
    # v4 = (1,0,0) en el hueso 2 (10+5) -> motor (16,0,0) -> visor (0,0,16)
    p = groups[1]["positions"][0:3]
    assert p == pytest.approx([0, 0, 16])
    # UV: s/ancho, t/alto
    assert groups[1]["uvs"][0:2] == pytest.approx([1 / 4, 2 / 4])


def test_mesh_animated_pose_rotates_child_bones():
    m = StudioModel(make_model(anim_angle=math.pi / 2))
    mesh = m.build_mesh(sequence=1)
    groups = {g["texture"]: g for g in mesh["groups"]}
    # Hueso 1 rotado 90° en Z: su X local apunta a +Y del motor.
    # v0 (1,0,0) en hueso 1 -> motor (10, 1, 0) -> visor (1, 0, 10)
    assert groups[0]["positions"][0:3] == pytest.approx([1, 0, 10], abs=1e-3)
    # Hueso 2 hereda la rotación: origen en (10,5,0); v4 (1,0,0) -> (10,6,0) -> visor (6,0,10)
    assert groups[1]["positions"][0:3] == pytest.approx([6, 0, 10], abs=1e-3)
    lo, hi = mesh["bounds"]
    assert all(lo[i] <= hi[i] for i in range(3))


def test_texture_file_model_has_no_mesh():
    t = StudioModel(make_texture_file())
    assert t.numtextures == 2
    main = StudioModel(make_model(with_textures=False))
    assert main.numtextures == 0
    mesh = main.build_mesh(texture_model=t, sequence=0)
    assert len(mesh["groups"]) == 2


# -------------------------------------------------------------- textures
def test_png_roundtrip_is_lossless():
    m = StudioModel(make_model())
    for tex in m.textures:
        idx, pal = m.texture_pixels(tex)
        png = tx.texture_png(tex, idx, pal)
        img = tx.load_png(png)
        idx2, pal2 = tx.image_to_texture(img, tex)
        assert idx2 == idx
        if tex.masked:
            assert pal2[:255 * 3] == pal[:255 * 3]
            assert pal2[255 * 3:] == bytes(tx.MASK_COLOR)
        else:
            assert pal2 == pal


def test_rgb_edit_is_quantized_and_masked_alpha_kept():
    m = StudioModel(make_model())
    tex = m.textures[1]  # masked 4x4
    img = Image.new("RGBA", (4, 4), (200, 30, 30, 255))
    img.putpixel((3, 3), (0, 0, 0, 0))
    idx, pal = tx.image_to_texture(img, tex)
    assert len(idx) == 16 and len(pal) == 768
    assert idx[15] == 255
    assert all(i != 255 for i in idx[:15])
    color = idx[0]
    r, g, b = pal[color * 3:color * 3 + 3]
    assert abs(r - 200) < 8 and abs(g - 30) < 8 and abs(b - 30) < 8


def test_wrong_size_is_resized():
    m = StudioModel(make_model())
    tex = m.textures[0]  # 8x4
    img = Image.new("RGB", (32, 16), (10, 200, 10))
    idx, pal = tx.image_to_texture(img, tex)
    assert len(idx) == 32


# --------------------------------------------------------------- proyecto
@pytest.fixture()
def proyecto(tmp_path, monkeypatch):
    base = tmp_path / "build" / "juego"
    (base / "valve" / "maps").mkdir(parents=True)
    (base / "valve" / "liblist.gam").write_text("game Half-Life\n")
    (base / "valve" / "maps" / "c1a0.bsp").write_bytes(b"hl")
    (base / "valve" / "halflife.wad").write_bytes(b"wad")
    (base / "cstrike" / "models" / "player" / "leet").mkdir(parents=True)
    (base / "cstrike" / "models" / "player" / "leet" / "leet.mdl").write_bytes(make_model("leet"))
    (base / "cstrike" / "models" / "v_ak47.mdl").write_bytes(make_model("v_ak47", with_textures=False))
    (base / "cstrike" / "models" / "v_ak47T.mdl").write_bytes(make_texture_file("v_ak47"))
    (base / "cstrike" / "delta.lst").write_text("delta")
    (base / "cstrike" / "dlls").mkdir()
    (base / "cstrike" / "dlls" / "cs.so").write_bytes(b"elf")
    monkeypatch.setenv("ESTUDIO_DATA", str(tmp_path))
    import importlib

    import app.project as project
    importlib.reload(project)
    yield project, tmp_path


def _zip_names(path):
    with zipfile.ZipFile(path) as z:
        return set(z.namelist())


def test_catalog(proyecto):
    project, _ = proyecto
    cat = project.catalog()
    assert set(cat) == {"player/leet", "v_ak47"}
    assert cat["player/leet"].label == "Elite Crew" and cat["player/leet"].team == "T"
    info = project.model_info("player/leet")
    assert [t["file"] for t in info["textures"]] == ["Body.png", "Mask.png"]
    assert info["defaultSequence"] == 1  # idle1
    with pytest.raises(project.ProyectoError):
        project.get_entry("../../etc/passwd")


def test_build_excludes_native_and_hl_content(proyecto):
    project, tmp = proyecto
    project.build(log=lambda *_: None)
    names = _zip_names(project.VALVE_ZIP)
    assert "cstrike/models/player/leet/leet.mdl" in names
    assert "cstrike/delta.lst" in names
    assert "valve/halflife.wad" in names
    assert "cstrike/dlls/cs.so" not in names
    assert "valve/maps/c1a0.bsp" not in names
    assert project.status()["pendiente"] is False
    meta = json.loads(project.ASSETS_JSON.read_text())
    assert meta["files"] == len([n for n in names if not n.endswith("/")])
    assert meta["size"] == project.VALVE_ZIP.stat().st_size and len(meta["version"]) == 16


def test_edit_apply_and_reset(proyecto):
    project, tmp = proyecto
    project.build(log=lambda *_: None)
    original = (project.BASE / "cstrike/models/player/leet/leet.mdl").read_bytes()

    # Subir una textura roja a Body (8x4) y aplicar
    img = Image.new("RGB", (8, 4), (220, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    res = project.save_upload("player/leet", 0, buf.getvalue())
    assert res["file"] == "Body.png" and not res["resized"]
    assert (tmp / "texturas/personajes/leet/Mask.png").is_file()  # se exportaron todas
    assert project.model_info("player/leet")["textures"][0]["edited"] is True
    assert project.model_info("player/leet")["textures"][1]["edited"] is False
    assert project.status()["pendiente"] is True

    v1 = json.loads(project.ASSETS_JSON.read_text())["version"]
    state = project.apply(log=lambda *_: None)
    assert state["cambios"] == [{"modelo": "player/leet", "texturas": ["Body.png"]}]
    v2 = json.loads(project.ASSETS_JSON.read_text())["version"]
    assert v1 != v2  # los navegadores tienen que volver a bajar valve.zip
    with zipfile.ZipFile(project.VALVE_ZIP) as z:
        patched = z.read("cstrike/models/player/leet/leet.mdl")
        assert len([n for n in z.namelist() if n.endswith("leet.mdl")]) == 1
    assert patched != original and len(patched) == len(original)
    m = StudioModel(patched)
    idx, pal = m.texture_pixels(m.textures[0])
    r, g, b = pal[idx[0] * 3: idx[0] * 3 + 3]
    assert r > 200 and g < 20 and b < 20
    # la base queda intacta
    assert (project.BASE / "cstrike/models/player/leet/leet.mdl").read_bytes() == original
    assert project.status()["pendiente"] is False

    # Restaurar y volver a aplicar: vuelve el original y desaparece el override
    project.reset("player/leet", 0)
    assert project.model_info("player/leet")["textures"][0]["edited"] is False
    project.apply(log=lambda *_: None)
    with zipfile.ZipFile(project.VALVE_ZIP) as z:
        assert z.read("cstrike/models/player/leet/leet.mdl") == original
    assert not any(p.is_file() for p in (project.OVERRIDES).rglob("*"))


def test_marca_files_go_into_zip(proyecto):
    project, tmp = proyecto
    project.build(log=lambda *_: None)
    v1 = json.loads(project.ASSETS_JSON.read_text())["version"]
    marca = tmp / "marca" / "juego"
    (marca / "cstrike" / "resource").mkdir(parents=True)
    (marca / "cstrike" / "autoexec.cfg").write_text('hud_color "19 196 116"\n')
    (marca / "cstrike" / "resource" / "BackgroundLayout.txt").write_text("resolution 1600 1000\n")
    (marca / "cstrike" / "delta.lst").write_text("pisado")  # reemplaza uno del juego
    (marca / "LEEME.txt").write_text("no va al juego")
    (marca / "cstrike" / ".DS_Store").write_bytes(b"mac")
    assert project.status()["pendiente"] is True
    state = project.apply(log=lambda *_: None)
    assert {"marca": 3} in state["cambios"]
    with zipfile.ZipFile(project.VALVE_ZIP) as z:
        names = z.namelist()
        assert z.read("cstrike/autoexec.cfg").startswith(b"hud_color")
        assert z.read("cstrike/delta.lst") == b"pisado"
        assert names.count("cstrike/delta.lst") == 1
        assert "LEEME.txt" not in names and "cstrike/.DS_Store" not in names
    assert json.loads(project.ASSETS_JSON.read_text())["version"] != v1
    assert project.status()["pendiente"] is False
    # la base no se toca y al sacar la marca vuelve el original
    assert (project.BASE / "cstrike" / "delta.lst").read_text() == "delta"
    for f in sorted(marca.rglob("*"), reverse=True):
        f.unlink() if f.is_file() else f.rmdir()
    assert project.status()["pendiente"] is True
    project.apply(log=lambda *_: None)
    with zipfile.ZipFile(project.VALVE_ZIP) as z:
        assert z.read("cstrike/delta.lst") == b"delta"
        assert "cstrike/autoexec.cfg" not in z.namelist()


def test_texture_file_models(proyecto):
    project, tmp = proyecto
    info = project.model_info("v_ak47")
    assert len(info["textures"]) == 2
    img = Image.new("RGB", (8, 4), (0, 0, 250))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    project.save_upload("v_ak47", 0, buf.getvalue())
    project.apply(log=lambda *_: None)
    names = _zip_names(project.VALVE_ZIP)
    assert "cstrike/models/v_ak47T.mdl" in names
    assert (project.OVERRIDES / "cstrike/models/v_ak47T.mdl").is_file()
    assert not (project.OVERRIDES / "cstrike/models/v_ak47.mdl").exists()
    mesh = project.mesh("v_ak47", None)
    assert mesh["groups"]


def test_mesh_endpoint_data(proyecto):
    project, _ = proyecto
    data = project.mesh("player/leet", None)
    assert data["sequence"] == 1
    assert data["textures"][1]["masked"] is True


def test_exported_file_untouched_is_not_edited(proyecto):
    project, tmp = proyecto
    project.export_originals("player/leet")
    info = project.model_info("player/leet")
    assert info["exported"] and not any(t["edited"] for t in info["textures"])
    assert (tmp / "texturas/personajes/leet/LEEME.txt").is_file()


# ---------------------------------------------------------------- servidor
def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture()
def servidor(proyecto):
    project, tmp = proyecto
    project.build(log=lambda *_: None)
    from http.server import ThreadingHTTPServer

    from app import server
    port = _free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port), server.Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{port}", project
    srv.shutdown()


def _req(url, method="GET", data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def test_server_endpoints(servidor):
    url, project = servidor
    st, body, h = _req(url + "/")
    assert st == 200 and b"<html" in body.lower()
    st, body, _ = _req(url + "/api/models")
    cats = json.loads(body)["categorias"]
    assert cats[0]["id"] == "personajes" and cats[0]["modelos"][0]["id"] == "player/leet"
    st, body, _ = _req(url + "/api/model?id=player/leet")
    assert st == 200 and json.loads(body)["textures"][0]["width"] == 8
    st, body, h = _req(url + "/api/texture.png?id=player/leet&i=0&v=original")
    assert st == 200 and body.startswith(b"\x89PNG") and h["Content-Type"] == "image/png"
    st, body, _ = _req(url + "/api/mesh?id=player/leet&seq=0")
    assert st == 200 and json.loads(body)["groups"]
    st, body, _ = _req(url + "/api/model?id=nada")
    assert st == 400 and "No existe" in json.loads(body)["error"]
    st, _, _ = _req(url + "/static/../app/server.py")
    assert st == 404


def test_server_write_protection(servidor):
    url, project = servidor
    img = Image.new("RGB", (8, 4), (0, 250, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png = buf.getvalue()
    # Sin el encabezado propio: rechazado
    st, _, _ = _req(url + "/api/upload?id=player/leet&i=0", "POST", png, {"Content-Type": "image/png"})
    assert st == 403
    # Desde otro origen: rechazado
    st, _, _ = _req(url + "/api/upload?id=player/leet&i=0", "POST", png,
                    {"X-Estudio": "1", "Origin": "https://malo.example"})
    assert st == 403
    # Host extraño (DNS rebinding): rechazado
    st, _, _ = _req(url + "/api/status", headers={"Host": "malo.example"})
    assert st == 403
    # Bien
    st, body, _ = _req(url + "/api/upload?id=player/leet&i=0", "POST", png,
                       {"X-Estudio": "1", "Origin": url.replace("127.0.0.1", "localhost")})
    assert st == 200, body
    st, body, _ = _req(url + "/api/apply", "POST", b"", {"X-Estudio": "1"})
    assert st == 200 and json.loads(body)["estado"]["cambios"]
    st, body, _ = _req(url + "/api/texture.png?id=player/leet&i=0&v=game")
    img = Image.open(io.BytesIO(body)).convert("RGB")
    assert img.getpixel((0, 0))[1] > 200
    st, body, _ = _req(url + "/api/reset?id=player/leet", "POST", b"", {"X-Estudio": "1"})
    assert st == 200
    st, body, _ = _req(url + "/api/status")
    assert json.loads(body)["pendiente"] is True  # restaurado pero sin aplicar todavía
