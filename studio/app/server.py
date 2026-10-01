"""Servidor web del estudio de personajes (solo para usar en esta compu)."""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import threading
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import project

STATIC = Path(__file__).resolve().parent.parent / "static"
MAX_UPLOAD = 25 * 1024 * 1024
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
GAME_URL = os.environ.get("ESTUDIO_URL_JUEGO", "http://localhost:27016")

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")


def _host_ok(value: str | None) -> bool:
    if not value:
        return False
    host = value.strip().lower()
    if host.startswith("["):
        host = host.split("]", 1)[0] + "]"
    else:
        host = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
    return host in ALLOWED_HOSTS


class Handler(BaseHTTPRequestHandler):
    server_version = "EstudioCS/1.0"
    protocol_version = "HTTP/1.1"

    # --------------------------------------------------------------- helpers
    def log_message(self, fmt, *args):  # menos ruido en los logs
        if os.environ.get("ESTUDIO_LOG"):
            super().log_message(fmt, *args)

    def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, status: int = 200):
        self._send(status, json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def _error(self, status: int, message: str):
        self._json({"error": message}, status)

    def _params(self):
        url = urlparse(self.path)
        return url.path, {k: v[-1] for k, v in parse_qs(url.query).items()}

    def _int(self, params, key, default=None):
        raw = params.get(key)
        if raw in (None, ""):
            return default
        try:
            return int(raw)
        except ValueError as e:
            raise project.ProyectoError(f"Parámetro {key} inválido.") from e

    def _guard(self, write: bool) -> bool:
        # Defensa contra páginas de otros sitios que intenten usar el estudio
        # (DNS rebinding / CSRF): solo se acepta el host local.
        if not _host_ok(self.headers.get("Host")):
            self._error(HTTPStatus.FORBIDDEN, "Host no permitido.")
            return False
        if write:
            origin = self.headers.get("Origin")
            if origin and not _host_ok(urlparse(origin).netloc):
                self._error(HTTPStatus.FORBIDDEN, "Origen no permitido.")
                return False
            if self.headers.get("X-Estudio") != "1":
                self._error(HTTPStatus.FORBIDDEN, "Falta el encabezado X-Estudio.")
                return False
        return True

    # ---------------------------------------------------------------- routes
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._guard(write=False):
            return
        path, params = self._params()
        try:
            if path in ("/", "/index.html"):
                return self._static("index.html")
            if path.startswith("/static/"):
                return self._static(path[len("/static/"):])
            if path == "/api/status":
                return self._json({**project.status(), "urlJuego": GAME_URL})
            if path == "/api/models":
                cats = {c: [] for c, _ in project.CATEGORIES}
                edited = project.edited_ids()
                for e in project.catalog().values():
                    cats.setdefault(e.category, []).append({**e.as_dict(), "editado": e.id in edited})
                return self._json({"categorias": [
                    {"id": c, "nombre": n, "modelos": cats.get(c, [])} for c, n in project.CATEGORIES]})
            if path == "/api/model":
                return self._json(project.model_info(params.get("id", "")))
            if path == "/api/mesh":
                return self._json(project.mesh(params.get("id", ""), self._int(params, "seq")))
            if path == "/api/texture.png":
                variant = params.get("v", "game")
                if variant not in ("original", "current", "game"):
                    variant = "game"
                body = project.texture_png(params.get("id", ""), self._int(params, "i", -1), variant)
                return self._send(200, body, "image/png")
            return self._error(404, "No encontrado.")
        except project.ProyectoError as e:
            return self._error(400, str(e))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return self._error(500, "Error interno del estudio (mirá los logs).")

    def do_POST(self):
        if not self._guard(write=True):
            return
        path, params = self._params()
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length < 0 or length > MAX_UPLOAD:
                return self._error(413, "El archivo es demasiado grande (máximo 25 MB).")
            body = self.rfile.read(length) if length else b""
            model_id = params.get("id", "")
            if path == "/api/upload":
                if not body:
                    return self._error(400, "No llegó ninguna imagen.")
                return self._json(project.save_upload(model_id, self._int(params, "i", -1), body))
            if path == "/api/reset":
                project.reset(model_id, self._int(params, "i"))
                return self._json({"ok": True})
            if path == "/api/export":
                folder = project.export_originals(model_id)
                return self._json({"ok": True, "carpeta": "texturas/" + str(folder.relative_to(project.EDITS))})
            if path == "/api/apply":
                logs: list[str] = []
                state = project.apply(log=logs.append)
                return self._json({"ok": True, "estado": state, "log": logs})
            return self._error(404, "No encontrado.")
        except project.ProyectoError as e:
            return self._error(400, str(e))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return self._error(500, "Error interno del estudio (mirá los logs).")

    def _static(self, rel: str):
        target = (STATIC / rel).resolve()
        if STATIC not in target.parents and target != STATIC:
            return self._error(404, "No encontrado.")
        if not target.is_file():
            return self._error(404, "No encontrado.")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json",):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)


def main():
    host = os.environ.get("ESTUDIO_HOST", "0.0.0.0")
    port = int(os.environ.get("ESTUDIO_PORT", "8080"))
    if not project.base_ready():
        print("Aviso: todavía no están los archivos del juego en build/base.", file=sys.stderr)
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    print(f"Estudio escuchando en {host}:{port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    threading.current_thread().name = "estudio"
    main()
