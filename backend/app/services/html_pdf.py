"""HTML de impressão → HTML seguro para o Chromium do Gotenberg (rota /integracao/pdf).

O HTML vem do navegador do usuário (Writer, Sheets), então é tratado como hostil:
* lista fechada de tags e atributos (nh3); script, iframe, object, embed, link, meta, base, form, svg… saem;
* imagens só como data:image/... (é como o Writer as embute); qualquer outra origem é removida;
* CSS sem @import e sem url() que não seja data: (no <style> e no atributo style);
* o resultado vai num modelo fixo (<!DOCTYPE html><html lang><head><meta charset><title><style>…<body>).
É defesa em profundidade: o Gotenberg também roda sem JavaScript, com deny-list e em rede sem saída.
"""
from __future__ import annotations

import html as _html
import re

import nh3

_TAGS = {
    "a", "abbr", "b", "bdi", "bdo", "blockquote", "br", "caption", "cite", "code", "col", "colgroup", "dd", "del",
    "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
    "header", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "small", "span",
    "strike", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time",
    "tr", "tt", "u", "ul", "var", "wbr", "section", "article", "aside", "main", "nav", "center",
}
_GLOBAL_ATTRS = {"class", "style", "lang", "dir", "title", "id", "align", "valign", "width", "height"}
_ATTRS: dict[str, set[str]] = {
    "*": _GLOBAL_ATTRS,
    "a": {"href", "name"},
    "img": {"src", "alt"},
    "td": {"colspan", "rowspan", "headers", "scope"},
    "th": {"colspan", "rowspan", "headers", "scope"},
    "col": {"span"},
    "colgroup": {"span"},
    "ol": {"start", "type", "reversed"},
    "li": {"value"},
    "time": {"datetime"},
    "del": {"datetime"},
    "ins": {"datetime"},
}
_IMG_OK = re.compile(r"^\s*data:image/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=\s]*$", re.IGNORECASE)
_HREF_OK = re.compile(r"^\s*(https?:|mailto:|#)", re.IGNORECASE)
_LANG_OK = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$")

# CSS: @import (com url() ou string), url() que não seja data:, image-set()/-webkit-image-set() (aceitam string-URL)
_CSS_IMPORT = re.compile(r"@import\b[^;{}]*;?", re.IGNORECASE)
_CSS_URL = re.compile(r"url\s*\(([^)]*)\)", re.IGNORECASE)
_CSS_IMAGESET = re.compile(r"(-webkit-)?image-set\s*\([^)]*\)", re.IGNORECASE)
_CSS_ESCAPE = re.compile(r"\\[0-9a-fA-F]{1,6}\s?|\\.")
_STYLE_BLOCK = re.compile(r"<style>(.*?)</style>", re.DOTALL | re.IGNORECASE)


def _filtra_css(css: str) -> str:
    css = _CSS_IMPORT.sub("", css)
    css = _CSS_IMAGESET.sub("none", css)
    return _CSS_URL.sub(_url_css, css)


def sanear_css(css: str) -> str:
    limpo = _filtra_css(css)
    if "\\" in limpo:
        # escapes CSS (\75rl( = url() podem disfarçar url/@import: se, desfeitos, ainda sobrar algo perigoso,
        # usa a versão desfeita e filtrada (caso hostil; o texto de content:"..." pode perder aspas escapadas)
        desfeito = _CSS_ESCAPE.sub(lambda m: _css_unescape(m.group(0)), limpo)
        if _filtra_css(desfeito) != desfeito:
            return _filtra_css(desfeito)
    return limpo


def _url_css(m: re.Match[str]) -> str:
    alvo = m.group(1).strip().strip("'\"").strip()
    return m.group(0) if alvo.lower().startswith("data:") else "none"


def _css_unescape(esc: str) -> str:
    body = esc[1:].strip()
    if re.fullmatch(r"[0-9a-fA-F]{1,6}", body):
        cp = int(body, 16)
        return chr(cp) if 0 < cp <= 0x10FFFF else ""
    return body


def _filtro(tag: str, attr: str, valor: str) -> str | None:
    if attr == "style":
        return sanear_css(valor)
    if tag == "img" and attr == "src":
        return valor if _IMG_OK.match(valor) else None
    if tag == "a" and attr == "href":
        return valor if _HREF_OK.match(valor) else None
    return valor


def _meta(raw: str) -> tuple[str, str]:
    lang = "pt-BR"
    m = re.search(r"<html\b[^>]*\blang\s*=\s*['\"]?([^'\"\s>]+)", raw[:4096], re.IGNORECASE)
    if m and _LANG_OK.match(m.group(1)):
        lang = m.group(1)
    t = re.search(r"<title[^>]*>(.*?)</title>", raw[:65536], re.IGNORECASE | re.DOTALL)
    titulo = _html.unescape(re.sub(r"<[^>]*>", "", t.group(1))).strip()[:300] if t else ""
    return lang, titulo


def sanear_html(conteudo: bytes) -> bytes:
    raw = conteudo.decode("utf-8", errors="replace")
    lang, titulo = _meta(raw)
    limpo = nh3.clean(
        raw,
        tags=_TAGS,
        clean_content_tags={"script", "noscript", "iframe", "object", "embed", "template", "textarea", "select",
                            "svg", "math", "title", "xmp", "noembed", "noframes"},
        attributes=_ATTRS,
        attribute_filter=_filtro,
        url_schemes={"http", "https", "mailto", "data"},
        link_rel="noopener noreferrer",
        strip_comments=True,
    )
    estilos: list[str] = []

    def _tira_style(m: re.Match[str]) -> str:
        estilos.append(sanear_css(m.group(1)))
        return ""

    corpo = _STYLE_BLOCK.sub(_tira_style, limpo)
    css = "\n".join(estilos).replace("</", "<\\/")   # não fecha o <style> do modelo
    doc = (f'<!DOCTYPE html><html lang="{_html.escape(lang)}"><head><meta charset="utf-8">'
           f"<title>{_html.escape(titulo)}</title><style>{css}</style></head><body>{corpo}</body></html>")
    return doc.encode("utf-8")
