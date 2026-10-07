#!/usr/bin/env python3
"""Gera dist/cuidare-vila-mariana.html: o site inteiro em um único arquivo
(CSS, JS, fonte e imagens embutidos). Uso: python3 tools/build-single.py"""
import base64, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
read = lambda p: (root / p).read_text(encoding="utf-8")
def data_uri(p, mime):
    return f"data:{mime};base64," + base64.b64encode((root / p).read_bytes()).decode()

html = read("index.html")
css = read("assets/css/styles.css")
css = css.replace('url("../fonts/lexend-latin-wght.woff2")', 'url("' + data_uri("assets/fonts/lexend-latin-wght.woff2", "font/woff2") + '")')

logo_w = data_uri("assets/img/logo-white.webp", "image/webp")
logo_n = data_uri("assets/img/logo-navy.webp", "image/webp")

# remove <source> (webp vira o src direto) e troca caminhos de imagem
html = re.sub(r'\s*<source srcset="assets/img/logo-(white|navy)\.webp" type="image/webp">', "", html)
html = html.replace('src="assets/img/logo-white.png"', f'src="{logo_w}"').replace('src="assets/img/logo-navy.png"', f'src="{logo_n}"')
html = re.sub(r'\s*<link rel="preload"[^>]*>', "", html)
html = html.replace('href="assets/img/favicon.png"', 'href="' + data_uri("assets/img/favicon.png", "image/png") + '"')
html = html.replace('href="assets/img/apple-touch-icon.png"', 'href="' + data_uri("assets/img/apple-touch-icon.png", "image/png") + '"')
html = html.replace('<link rel="stylesheet" href="assets/css/styles.css">', "<style>\n" + css + "\n</style>")
scripts = "<script>\n" + read("assets/js/orb.js") + "\n</script>\n  <script>\n" + read("assets/js/main.js") + "\n</script>"
html = html.replace('<script src="assets/js/main.js" defer></script>', "")
html = html.replace("</body>", "  " + scripts + "\n</body>")
assert not re.search(r'(src|href|srcset)="assets/', html), "caminho local restante"

out = root / "dist" / "cuidare-vila-mariana.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(out, round(out.stat().st_size / 1024), "KB")
