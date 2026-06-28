from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import re
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

from ..config import get_settings
from .article_image_discovery import _headers


@dataclass(frozen=True)
class PoliticsSource:
    source: str
    domain: str
    url: str


@dataclass
class ArticleCandidate:
    source: str
    domain: str
    section_url: str
    article_url: str
    title: str | None = None
    score: float = 0.0


@dataclass
class SourceDiscoveryResult:
    source: PoliticsSource
    articles: list[ArticleCandidate]
    warnings: list[str]


POLITICS_SOURCES = [
    PoliticsSource("g1", "g1.globo.com", "https://g1.globo.com/politica/"),
    PoliticsSource("oglobo", "oglobo.globo.com", "https://oglobo.globo.com/politica/"),
    PoliticsSource("folha", "www1.folha.uol.com.br", "https://www1.folha.uol.com.br/poder/"),
    PoliticsSource("estadao", "www.estadao.com.br", "https://www.estadao.com.br/politica/"),
    PoliticsSource("uol", "noticias.uol.com.br", "https://noticias.uol.com.br/politica/"),
    PoliticsSource("cnn", "www.cnnbrasil.com.br", "https://www.cnnbrasil.com.br/politica/"),
    PoliticsSource("metropoles", "www.metropoles.com", "https://www.metropoles.com/brasil/politica-brasil"),
    PoliticsSource("poder360", "www.poder360.com.br", "https://www.poder360.com.br/"),
    PoliticsSource("cartacapital", "www.cartacapital.com.br", "https://www.cartacapital.com.br/politica/"),
    PoliticsSource("brasildefato", "www.brasildefato.com.br", "https://www.brasildefato.com.br/editoria/politica"),
]

BLOCKED_LINK_HINTS = re.compile(
    r"login|assine|newsletter|podcast|video|videos|ao-vivo|tempo-real|colun|opiniao|"
    r"publicidade|privacy|politica-de-privacidade|termos|rss|whatsapp|facebook|instagram|"
    r"youtube|twitter|x.com|mailto:|javascript:",
    re.IGNORECASE,
)
ARTICLE_PATH_HINTS = re.compile(
    r"/(politica|poder|brasil|noticias|202[0-9]|governo|congresso|senado|camara|"
    r"supremo|stf|eleicoes|planalto|lula|bolsonaro|haddad|tebet|marina)",
    re.IGNORECASE,
)


class _ArticleLinkParser(HTMLParser):
    def __init__(self, section_url: str, source: PoliticsSource) -> None:
        super().__init__(convert_charrefs=True)
        self.section_url = section_url
        self.source = source
        self._active_href: str | None = None
        self._active_text: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        attr = {key.lower(): value or "" for key, value in attrs}
        href = attr.get("href") or ""
        if not href:
            return
        self._active_href = href
        aria = attr.get("aria-label") or attr.get("title")
        self._active_text = [aria] if aria else []

    def handle_data(self, data: str) -> None:
        if self._active_href:
            self._active_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self._active_href:
            return
        text = " ".join(part.strip() for part in self._active_text if part.strip())
        self.links.append((self._active_href, text))
        self._active_href = None
        self._active_text = []


def _normalize_url(url: str) -> str:
    parsed = urlparse(url)
    return urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path.rstrip("/") or "/", "", parsed.query, ""))


def _score_link(source: PoliticsSource, href: str, text: str) -> ArticleCandidate | None:
    absolute = _normalize_url(urljoin(source.url, href))
    parsed = urlparse(absolute)
    if parsed.scheme not in {"http", "https"}:
        return None
    if parsed.netloc.lower().replace("www.", "") != source.domain.replace("www.", ""):
        return None
    lowered = f"{absolute} {text}".lower()
    if BLOCKED_LINK_HINTS.search(lowered):
        return None
    if re.search(r"\.(jpg|jpeg|png|webp|gif|svg|pdf)(?:$|\?)", parsed.path, re.IGNORECASE):
        return None

    score = 1.0
    if ARTICLE_PATH_HINTS.search(parsed.path):
        score += 2.0
    if len(text.strip()) >= 30:
        score += 1.0
    if re.search(r"/202[0-9]/|/20[0-9]{2}/[0-9]{2}/", parsed.path):
        score += 1.0
    if parsed.path.rstrip("/") == urlparse(source.url).path.rstrip("/"):
        return None
    if score < 2.0:
        return None

    return ArticleCandidate(
        source=source.source,
        domain=source.domain,
        section_url=source.url,
        article_url=absolute,
        title=text.strip() or None,
        score=score,
    )


def _dedupe(candidates: list[ArticleCandidate], limit: int) -> list[ArticleCandidate]:
    by_url: dict[str, ArticleCandidate] = {}
    for candidate in candidates:
        existing = by_url.get(candidate.article_url)
        if existing is None or candidate.score > existing.score:
            by_url[candidate.article_url] = candidate
    return list(by_url.values())[:limit]


def _discover_html(source: PoliticsSource, limit: int) -> SourceDiscoveryResult:
    settings = get_settings()
    warnings: list[str] = []
    try:
        with httpx.Client(
            timeout=settings.article_discovery_timeout_seconds,
            follow_redirects=True,
            headers=_headers(source.url),
        ) as client:
            response = client.get(source.url)
        response.raise_for_status()
    except Exception as exc:
        return SourceDiscoveryResult(source=source, articles=[], warnings=[f"HTML não carregado: {exc}"])

    parser = _ArticleLinkParser(str(response.url), source)
    parser.feed(response.text)
    articles = [
        candidate
        for href, text in parser.links
        if (candidate := _score_link(source, href, text)) is not None
    ]
    limited = _dedupe(articles, limit)
    if not limited:
        warnings.append("Nenhum link provável de matéria encontrado no HTML estático.")
    return SourceDiscoveryResult(source=source, articles=limited, warnings=warnings)


def _discover_browser(source: PoliticsSource, limit: int) -> SourceDiscoveryResult:
    settings = get_settings()
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        return SourceDiscoveryResult(source=source, articles=[], warnings=[f"Playwright indisponível: {exc}"])

    try:
        with sync_playwright() as playwright:
            launch_args: dict[str, object] = {"headless": True}
            if settings.article_discovery_browser_executable:
                launch_args["executable_path"] = settings.article_discovery_browser_executable
            browser = playwright.chromium.launch(**launch_args)
            page = browser.new_page(
                locale="pt-BR",
                user_agent=_headers(source.url)["user-agent"],
                viewport={"width": 1366, "height": 900},
            )
            page.goto(source.url, wait_until="domcontentloaded", timeout=int(settings.article_discovery_timeout_seconds * 1000))
            page.wait_for_timeout(1200)
            payload = page.evaluate(
                """() => Array.from(document.links).map((link) => ({
                    href: link.href || link.getAttribute('href') || '',
                    text: link.innerText || link.getAttribute('aria-label') || link.getAttribute('title') || ''
                }))"""
            )
            browser.close()
    except Exception as exc:
        return SourceDiscoveryResult(source=source, articles=[], warnings=[f"Navegador não renderizou editoria: {exc}"])

    articles = [
        candidate
        for item in payload
        if (candidate := _score_link(source, item.get("href") or "", item.get("text") or "")) is not None
    ]
    limited = _dedupe(articles, limit)
    return SourceDiscoveryResult(source=source, articles=limited, warnings=[] if limited else ["Nenhum link provável encontrado via navegador."])


def discover_politics_articles(limit_per_source: int, render_browser: bool) -> list[SourceDiscoveryResult]:
    results: list[SourceDiscoveryResult] = []
    for source in POLITICS_SOURCES:
        html_result = _discover_html(source, limit_per_source)
        if len(html_result.articles) >= limit_per_source or not render_browser:
            results.append(html_result)
            continue

        browser_result = _discover_browser(source, limit_per_source)
        merged = _dedupe(html_result.articles + browser_result.articles, limit_per_source)
        results.append(
            SourceDiscoveryResult(
                source=source,
                articles=merged,
                warnings=html_result.warnings + browser_result.warnings,
            )
        )
    return results
