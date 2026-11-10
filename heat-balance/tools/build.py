"""Build heat-balance/index.html, a single self-contained page, from the files in src/.

Usage: python3 tools/build.py
No dependencies beyond the Python standard library.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

thermo = json.loads((SRC / "thermo.json").read_text(encoding="utf-8"))
data = {k: {"segs": v["segs"]} for k, v in thermo.items()}  # drop the source notes
engine = "const THERMO = " + json.dumps(data, separators=(",", ":")) + ";\n" + (SRC / "engine.js").read_text(encoding="utf-8") + "\n"
engine = "var FumeEngine = (function () {\n'use strict';\n" + engine + "\nreturn FumeEngine;\n})();"

css = (SRC / "style.css").read_text(encoding="utf-8")
body = (SRC / "body.html").read_text(encoding="utf-8")
ui = (SRC / "ui.js").read_text(encoding="utf-8")
dbio = (SRC / "dbio.js").read_text(encoding="utf-8").replace("if (typeof module !== 'undefined') module.exports = FumeDB;", "")
formulas = (SRC / "formulas.html").read_text(encoding="utf-8")
tex = (SRC / "formulas_tex.json").read_text(encoding="utf-8")

assert "<!--FORMULAS-->" in body
body = body.replace("<!--FORMULAS-->", formulas)
for part in (engine, dbio, ui, tex):
    assert "</script" not in part

head = (
    "<title>Fuming Thermodynamic Model</title>\n"
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n'
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js"></script>\n'
)
doc = (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + head
    + "<style>\n:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}\n"
    + css
    + "</style>\n</head>\n<body>\n"
    + body
    + "<script>\n" + engine + "\n</script>\n<script>\n" + dbio + "\n</script>\n<script>\nvar FORMULA_TEX = " + tex + ";\n" + ui + "\n</script>\n</body>\n</html>\n"
)
(ROOT / "index.html").write_text(doc, encoding="utf-8")
print("index.html:", len(doc.encode("utf-8")), "bytes")
