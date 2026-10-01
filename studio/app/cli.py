"""Comandos del estudio para usar desde la terminal.

  python -m app.cli build            arma base.zip y valve.zip (lo usa start.sh)
  python -m app.cli aplicar          aplica las texturas editadas al juego
  python -m app.cli lista            lista los modelos editables
  python -m app.cli exportar <id>    copia las texturas originales a texturas/<modelo>/
  python -m app.cli estado           muestra si hay cambios sin aplicar
"""

from __future__ import annotations

import sys

from . import project


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    cmd, args = argv[0], argv[1:]
    try:
        if cmd == "build":
            project.build()
        elif cmd in ("aplicar", "apply"):
            state = project.apply()
            for c in state["cambios"]:
                if "modelo" in c:
                    print(f"  {c['modelo']}: {', '.join(c['texturas'])}")
                elif "marca" in c:
                    print(f"  marca: {c['marca']} archivo(s)")
            print("Recargá la página del juego para ver los cambios.")
        elif cmd in ("lista", "list"):
            names = dict(project.CATEGORIES)
            current = None
            for e in project.catalog().values():
                if e.category != current:
                    current = e.category
                    print(f"\n{names.get(current, current)}:")
                extra = f"  ({e.team})" if e.team else ""
                print(f"  {e.id:<22} {e.label}{extra}")
        elif cmd in ("exportar", "export"):
            if not args:
                print("Uso: exportar <id del modelo>   (ver «lista»)")
                return 1
            folder = project.export_originals(args[0])
            print(f"Texturas en texturas/{folder.relative_to(project.EDITS)}/")
        elif cmd in ("estado", "status"):
            st = project.status()
            print("Archivos del juego:", "listos" if st["baseLista"] else "faltan (corré ./start.sh)")
            print("Cambios sin aplicar:", "sí" if st["pendiente"] else "no")
        else:
            print(__doc__)
            return 1
    except project.ProyectoError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
