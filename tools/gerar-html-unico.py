#!/usr/bin/env python3
"""Gera dist/cuidare-vila-mariana.html: o site inteiro (3 páginas) em um único arquivo.

CSS, fontes, logo e scripts entram embutidos. As páginas viram ?pagina=inicio|experiencia|avaliacao
dentro do mesmo arquivo. Abre com duplo clique e também pode ser publicado sozinho (como index.html).

Uso: python3 tools/gerar-html-unico.py
"""
import base64
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist' / 'cuidare-vila-mariana.html'

PAGES = [  # (id, arquivo, scripts na ordem original)
    ('inicio', 'index.html', ['config', 'core', 'orb', 'home']),
    ('experiencia', 'experiencia/index.html', ['config', 'jornada', 'core', 'orb', 'experiencia']),
    ('avaliacao', 'avaliacao/index.html', ['config', 'jornada', 'core', 'avaliacao']),
]
LINKS = {  # destinos internos -> página
    './': 'inicio', '../': 'inicio', '/': 'inicio',
    'experiencia/': 'experiencia', '../experiencia/': 'experiencia', '/experiencia/': 'experiencia',
    'avaliacao/': 'avaliacao', '../avaliacao/': 'avaliacao', '/avaliacao/': 'avaliacao',
}


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def data_uri(rel, mime):
    return 'data:%s;base64,%s' % (mime, base64.b64encode((ROOT / rel).read_bytes()).decode())


def first(pattern, text, flags=re.S):
    m = re.search(pattern, text, flags)
    if not m:
        raise SystemExit('não encontrado: ' + pattern)
    return m.group(1)


def page_parts(rel):
    src = read(rel)
    head = first(r'<head>(.*?)</head>', src)
    body_attrs = first(r'<body([^>]*)>', src)
    body = first(r'<body[^>]*>(.*)</body>', src)
    pre = [s for s in re.findall(r'<script>(.*?)</script>', head, re.S)]
    title = html.unescape(first(r'<title>(.*?)</title>', head))
    desc = html.unescape(first(r'<meta name="description" content="([^"]*)"', head))
    body = re.sub(r'<source srcset="[^"]*logo-white-320\.webp" type="image/webp">', '', body)
    body = re.sub(r'src="[^"]*assets/img/logo-white-320\.png"', 'src="__LOGO__"', body)

    def link(m):
        target = LINKS.get(m.group(1))
        if not target:
            return m.group(0)
        return 'href="?pagina=%s"' % target
    body = re.sub(r'href="([^"#][^"]*)"', link, body)
    left = re.findall(r'(?:src|srcset|href)="([^"]*assets/[^"]*)"', body)
    if left:
        raise SystemExit('%s: referência a arquivo não embutida: %s' % (rel, left))
    if '<script' in body or '</template' in body:
        raise SystemExit(rel + ': corpo com <script> ou </template> inesperado')
    cls = re.search(r'class="([^"]*)"', body_attrs)
    return src, {'title': title, 'description': desc, 'bodyClass': cls.group(1) if cls else '', 'pre': pre}, body


def netlify_form(avaliacao_src):
    """Cópia oculta do formulário para o Netlify detectar no deploy (o original fica dentro de <template>)."""
    form = first(r'(<form[^>]*data-lead-form.*?</form>)', avaliacao_src)
    names = []
    for n in re.findall(r'name="([^"]+)"', form):
        if n not in names and n != 'form-name':
            names.append(n)
    fields = ''.join('<input type="hidden" name="%s">' % n for n in names)
    return ('<form name="avaliacao" data-netlify="true" netlify-honeypot="empresa" hidden aria-hidden="true">'
            '<input type="hidden" name="form-name" value="avaliacao">' + fields + '</form>')


def main():
    css = read('assets/css/site.css')
    for font in ('newsreader-wght.woff2', 'newsreader-wght-italic.woff2', 'manrope-wght.woff2'):
        css = css.replace('url("../fonts/%s")' % font, 'url("%s")' % data_uri('assets/fonts/' + font, 'font/woff2'))
    if '../fonts/' in css:
        raise SystemExit('fonte não embutida no CSS')

    js = {n: read('assets/js/%s.js' % n) for n in ('config', 'jornada', 'core', 'orb', 'home', 'experiencia', 'avaliacao')}
    for n, code in js.items():
        if '</script' in code.lower():
            raise SystemExit(n + '.js contém </script>')

    home_src = read('index.html')
    home_head = first(r'<head>(.*?)</head>', home_src)
    keep = []
    for line in home_head.splitlines():
        s = line.strip()
        if s.startswith(('<meta', '<link rel="canonical"')) and 'name="description"' not in s and 'charset' not in s:
            keep.append(s)
    ld = first(r'(<script type="application/ld\+json">.*?</script>)', home_head)

    meta, templates, avaliacao_src = {}, [], ''
    for pid, rel, scripts in PAGES:
        src, info, body = page_parts(rel)
        info['scripts'] = scripts
        meta[pid] = info
        templates.append('<template id="pg-%s">%s</template>' % (pid, body))
        if pid == 'avaliacao':
            avaliacao_src = src

    boot = """
(function () {
  var PAGES = %s;
  var LOGO = %s;
  var q = new URLSearchParams(location.search);
  var id = q.get('pagina') || (q.get('etapa') ? 'experiencia' : 'inicio');
  if (!PAGES[id]) id = 'inicio';
  var P = PAGES[id];
  function run(code) { var s = document.createElement('script'); s.textContent = code; document.body.appendChild(s); }
  document.title = P.title;
  document.querySelector('meta[name="description"]').setAttribute('content', P.description);
  var markup = document.getElementById('pg-' + id).innerHTML.split('__LOGO__').join(LOGO);
  P.pre.forEach(function (code) { (0, eval)(code); });
  document.body.className = P.bodyClass;
  document.body.innerHTML = markup;
  window.CUIDARE_SINGLE = true;
  P.scripts.forEach(function (n) { run(document.getElementById('js-' + n).textContent); });
})();
""" % (json.dumps(meta, ensure_ascii=False), json.dumps(data_uri('assets/img/logo-white-320.png', 'image/png')))

    out = ['<!doctype html>', '<html lang="pt-BR" data-root="./">', '<head>',
           '  <meta charset="utf-8">',
           '  <title>%s</title>' % html.escape(meta['inicio']['title']),
           '  <meta name="description" content="%s">' % html.escape(meta['inicio']['description'])]
    out += ['  ' + k for k in keep]
    out.append('  <link rel="icon" href="%s" type="image/png" sizes="64x64">' % data_uri('assets/img/favicon.png', 'image/png'))
    out.append('  <style>\n%s\n  </style>' % css)
    out.append('  ' + ld)
    for n, code in js.items():
        out.append('  <script type="text/plain" id="js-%s">\n%s\n  </script>' % (n, code))
    out += ['</head>', '<body>', netlify_form(avaliacao_src)] + templates
    out += ['<script>%s</script>' % boot, '</body>', '</html>', '']
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text('\n'.join(out), encoding='utf-8')
    print('%s (%d KB)' % (OUT.relative_to(ROOT), OUT.stat().st_size // 1024))


if __name__ == '__main__':
    main()
