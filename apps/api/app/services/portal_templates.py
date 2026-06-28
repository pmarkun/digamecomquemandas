from __future__ import annotations

from dataclasses import dataclass
import re
from urllib.parse import quote_plus, urlparse


@dataclass(frozen=True)
class PoliticsSource:
    source: str
    domain: str
    url: str


@dataclass(frozen=True)
class PortalTemplate:
    source: str
    domain: str
    url: str
    article_url_patterns: tuple[str, ...] = ()
    blocked_url_patterns: tuple[str, ...] = ()
    gallery_url_patterns: tuple[str, ...] = ()
    link_selectors: tuple[str, ...] = ("a",)
    search_url_template: str | None = None
    min_title_length: int = 30
    require_article_pattern: bool = False

    def as_source(self) -> PoliticsSource:
        return PoliticsSource(self.source, self.domain, self.url)

    def accepts_domain(self, netloc: str) -> bool:
        return _same_domain(netloc, self.domain)

    def is_blocked_url(self, url: str, text: str) -> bool:
        value = f"{url} {text}"
        return any(re.search(pattern, value, re.IGNORECASE) for pattern in self.blocked_url_patterns)

    def is_article_url(self, url: str) -> bool:
        return any(re.search(pattern, url, re.IGNORECASE) for pattern in self.article_url_patterns)

    def is_gallery_url(self, url: str) -> bool:
        return any(re.search(pattern, url, re.IGNORECASE) for pattern in self.gallery_url_patterns)

    def search_url(self, query: str) -> str | None:
        if not self.search_url_template:
            return None
        return self.search_url_template.format(query=quote_plus(query))


def _same_domain(first: str, second: str) -> bool:
    first_host = first.lower().replace("www.", "")
    second_host = second.lower().replace("www.", "")
    return first_host == second_host


GENERIC_BLOCKED_URL_PATTERNS = (
    r"login|assine|newsletter|podcast|video|videos|ao-vivo|tempo-real",
    r"publicidade|privacy|politica-de-privacidade|termos|rss|whatsapp",
    r"facebook|instagram|youtube|twitter|x\.com|mailto:|javascript:",
    r"\.(jpg|jpeg|png|webp|gif|svg|pdf)(?:$|\?)",
)

GENERIC_ARTICLE_URL_PATTERNS = (
    r"/(politica|poder|brasil|noticias|202[0-9]|governo|congresso|senado|camara|supremo|stf|eleicoes|planalto)",
)


PORTAL_TEMPLATES: tuple[PortalTemplate, ...] = (
    PortalTemplate(
        source="g1",
        domain="g1.globo.com",
        url="https://g1.globo.com/politica/",
        article_url_patterns=(
            r"https://g1\.globo\.com/politica/(?:eleicoes/\d{4}/)?noticia/\d{4}/\d{2}/\d{2}/.+\.ghtml(?:\?.*)?$",
            r"https://g1\.globo\.com/.+/eleicoes/\d{4}/noticia/\d{4}/\d{2}/\d{2}/.+\.ghtml(?:\?.*)?$",
        ),
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS
        + (
            r"/index/feed/",
            r"/ultimas-noticias/",
            r"/podcast/",
        ),
        gallery_url_patterns=(r"https://g1\.globo\.com/.+/fotos/.+\.ghtml(?:\?.*)?$",),
        link_selectors=(
            'a[href*="/politica/"][href*="/noticia/"][href*=".ghtml"]',
            'a[href*="/politica/eleicoes/"][href*="/noticia/"][href*=".ghtml"]',
            'a[href*="/eleicoes/"][href*="/noticia/"][href*=".ghtml"]',
            "a.feed-post-link",
            "a.bastian-feed-item__title-link",
        ),
        search_url_template="https://g1.globo.com/busca/?q={query}",
        require_article_pattern=True,
    ),
    PortalTemplate(
        source="oglobo",
        domain="oglobo.globo.com",
        url="https://oglobo.globo.com/politica/",
        article_url_patterns=(
            r"https://oglobo\.globo\.com/politica/noticia/\d{4}/\d{2}/\d{2}/.+\.ghtml(?:\?.*)?$",
        ),
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS
        + (
            r"/politica/rali/",
            r"/politica/eleicoes-\d{4}/?$",
            r"/blogs/",
            r"infograficos\.oglobo\.globo\.com",
        ),
        gallery_url_patterns=(r"https://oglobo\.globo\.com/.+/fotos/.+\.ghtml(?:\?.*)?$",),
        link_selectors=(
            'a[href*="/politica/noticia/"][href*=".ghtml"]',
            "a.feed-post-link",
        ),
        search_url_template="https://oglobo.globo.com/busca/?q={query}",
        require_article_pattern=True,
    ),
    PortalTemplate(
        source="folha",
        domain="www1.folha.uol.com.br",
        url="https://www1.folha.uol.com.br/poder/",
        article_url_patterns=(
            r"https://www1\.folha\.uol\.com\.br/poder/\d{4}/\d{2}/.+\.shtml(?:\?.*)?$",
            r"https://www1\.folha\.uol\.com\.br/poder/eleicoes/\d{4}/\d{4}/\d{2}/.+\.shtml(?:\?.*)?$",
        ),
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS
        + (
            r"/poder/(?:stf|folhajus|governo-lula)/?$",
            r"/poder/eleicoes/\d{4}/?$",
            r"/blogs/",
            r"/colunas/",
            r"/paineldoleitor/",
            r"/folha-topicos/",
        ),
        gallery_url_patterns=(r"https://www1\.folha\.uol\.com\.br/.+/album/.+\.shtml(?:\?.*)?$",),
        link_selectors=(
            'a[href*="/poder/"][href*=".shtml"]',
            'a[href*="/poder/eleicoes/"][href*=".shtml"]',
        ),
        search_url_template="https://search.folha.uol.com.br/search?q={query}&site=todos",
        require_article_pattern=True,
    ),
    PortalTemplate(
        source="estadao",
        domain="www.estadao.com.br",
        url="https://www.estadao.com.br/politica/",
        article_url_patterns=(
            r"https://www\.estadao\.com\.br/politica/(?!$)(?!#)(?!coluna-do-estadao/?$)(?!blog-do-fausto-macedo/?$).+/?(?:\?.*)?$",
        ),
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS
        + (
            r"/politica/?(?:#.*)?$",
            r"/politica/coluna-do-estadao/?$",
            r"/politica/blog-do-fausto-macedo/?$",
            r"/opiniao/",
        ),
        gallery_url_patterns=(r"https://www\.estadao\.com\.br/.+/galeria/.+/?(?:\?.*)?$",),
        link_selectors=(
            'main a[href*="/politica/"]',
            'a[href*="/politica/"][href^="https://www.estadao.com.br"]',
        ),
        search_url_template="https://www.estadao.com.br/busca/?q={query}",
        require_article_pattern=True,
    ),
    PortalTemplate(
        source="uol",
        domain="noticias.uol.com.br",
        url="https://noticias.uol.com.br/politica/",
        article_url_patterns=(
            r"https://noticias\.uol\.com\.br/politica/ultimas-noticias/\d{4}/\d{2}/\d{2}/.+\.htm(?:\?.*)?$",
        ),
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS
        + (
            r"/album/",
            r"/colunas/",
            r"/blogs/",
            r"/politica/?(?:#.*)?$",
        ),
        gallery_url_patterns=(r"https://noticias\.uol\.com\.br/.+/album/.+\.htm(?:\?.*)?$",),
        link_selectors=(
            'a[href*="/politica/ultimas-noticias/"][href*=".htm"]',
            'a[href*="/politica/"][href*=".htm"]',
        ),
        search_url_template="https://busca.uol.com.br/result.html?term={query}&utm_source=noticias",
        require_article_pattern=True,
    ),
    PortalTemplate(
        source="cnn",
        domain="www.cnnbrasil.com.br",
        url="https://www.cnnbrasil.com.br/politica/",
        article_url_patterns=GENERIC_ARTICLE_URL_PATTERNS,
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS,
        search_url_template="https://www.cnnbrasil.com.br/?s={query}",
    ),
    PortalTemplate(
        source="metropoles",
        domain="www.metropoles.com",
        url="https://www.metropoles.com/brasil/politica-brasil",
        article_url_patterns=GENERIC_ARTICLE_URL_PATTERNS,
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS,
        search_url_template="https://www.metropoles.com/search?q={query}",
    ),
    PortalTemplate(
        source="poder360",
        domain="www.poder360.com.br",
        url="https://www.poder360.com.br/",
        article_url_patterns=GENERIC_ARTICLE_URL_PATTERNS,
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS,
        search_url_template="https://www.poder360.com.br/?s={query}",
    ),
    PortalTemplate(
        source="cartacapital",
        domain="www.cartacapital.com.br",
        url="https://www.cartacapital.com.br/politica/",
        article_url_patterns=GENERIC_ARTICLE_URL_PATTERNS,
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS,
        search_url_template="https://www.cartacapital.com.br/?s={query}",
    ),
    PortalTemplate(
        source="brasildefato",
        domain="www.brasildefato.com.br",
        url="https://www.brasildefato.com.br/editoria/politica",
        article_url_patterns=GENERIC_ARTICLE_URL_PATTERNS,
        blocked_url_patterns=GENERIC_BLOCKED_URL_PATTERNS,
        search_url_template="https://www.brasildefato.com.br/busca?search={query}",
    ),
)

TEMPLATES_BY_SOURCE = {template.source: template for template in PORTAL_TEMPLATES}
POLITICS_SOURCES = [template.as_source() for template in PORTAL_TEMPLATES]


def template_for_source(source: PoliticsSource | PortalTemplate | str) -> PortalTemplate:
    if isinstance(source, PortalTemplate):
        return source
    key = source if isinstance(source, str) else source.source
    return TEMPLATES_BY_SOURCE[key]


def template_for_url(url: str) -> PortalTemplate | None:
    parsed = urlparse(url)
    for template in PORTAL_TEMPLATES:
        if template.accepts_domain(parsed.netloc):
            return template
    return None
