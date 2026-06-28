from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import re
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx

from ..config import get_settings
from .article_image_discovery import _headers
from .portal_templates import POLITICS_SOURCES, PORTAL_TEMPLATES, PortalTemplate, PoliticsSource, template_for_source


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


ARTICLE_PATH_HINTS = re.compile(
    r"/(politica|poder|brasil|noticias|202[0-9]|governo|congresso|senado|camara|"
    r"supremo|stf|eleicoes|planalto|lula|bolsonaro|haddad|tebet|marina)",
    re.IGNORECASE,
)
TRACKING_QUERY_KEYS = {"fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "srsltid"}


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
    query = urlencode(
        [
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in TRACKING_QUERY_KEYS and not key.lower().startswith("utm_")
        ]
    )
    return urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path.rstrip("/") or "/", "", query, ""))


def _score_link(template: PortalTemplate, href: str, text: str) -> ArticleCandidate | None:
    absolute = _normalize_url(urljoin(template.url, href))
    parsed = urlparse(absolute)
    if parsed.scheme not in {"http", "https"}:
        return None
    if not template.accepts_domain(parsed.netloc):
        return None
    if template.is_blocked_url(absolute, text):
        return None
    if parsed.path.rstrip("/") == urlparse(template.url).path.rstrip("/"):
        return None

    article_match = template.is_article_url(absolute)
    gallery_match = template.is_gallery_url(absolute)
    if template.require_article_pattern and not article_match and not gallery_match:
        return None

    score = 1.0
    if article_match:
        score += 4.0
    elif ARTICLE_PATH_HINTS.search(parsed.path):
        score += 2.0
    if gallery_match:
        score += 1.5
    if len(text.strip()) >= template.min_title_length:
        score += 1.0
    if re.search(r"/202[0-9]/|/20[0-9]{2}/[0-9]{2}/", parsed.path):
        score += 1.0
    if re.search(r"\.(ghtml|shtml|htm)$", parsed.path, re.IGNORECASE):
        score += 0.5
    if score < 2.0:
        return None

    return ArticleCandidate(
        source=template.source,
        domain=template.domain,
        section_url=template.url,
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


def _discover_html(source: PoliticsSource | PortalTemplate, limit: int) -> SourceDiscoveryResult:
    template = template_for_source(source)
    source_record = template.as_source()
    settings = get_settings()
    warnings: list[str] = []
    try:
        with httpx.Client(
            timeout=settings.article_discovery_timeout_seconds,
            follow_redirects=True,
            headers=_headers(template.url),
        ) as client:
            response = client.get(template.url)
        response.raise_for_status()
    except Exception as exc:
        return SourceDiscoveryResult(source=source_record, articles=[], warnings=[f"HTML não carregado: {exc}"])

    parser = _ArticleLinkParser(str(response.url), source_record)
    parser.feed(response.text)
    articles = [
        candidate
        for href, text in parser.links
        if (candidate := _score_link(template, href, text)) is not None
    ]
    limited = _dedupe(articles, limit)
    if not limited:
        warnings.append("Nenhum link provável de matéria encontrado no HTML estático.")
    return SourceDiscoveryResult(source=source_record, articles=limited, warnings=warnings)


def _discover_browser(source: PoliticsSource | PortalTemplate, limit: int) -> SourceDiscoveryResult:
    template = template_for_source(source)
    source_record = template.as_source()
    settings = get_settings()
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        return SourceDiscoveryResult(source=source_record, articles=[], warnings=[f"Playwright indisponível: {exc}"])

    try:
        with sync_playwright() as playwright:
            launch_args: dict[str, object] = {"headless": True}
            if settings.article_discovery_browser_executable:
                launch_args["executable_path"] = settings.article_discovery_browser_executable
            browser = playwright.chromium.launch(**launch_args)
            page = browser.new_page(
                locale="pt-BR",
                user_agent=_headers(template.url)["user-agent"],
                viewport={"width": 1366, "height": 900},
            )
            page.goto(template.url, wait_until="domcontentloaded", timeout=int(settings.article_discovery_timeout_seconds * 1000))
            page.wait_for_timeout(1200)
            payload = page.evaluate(
                """(selectors) => {
                    const links = [];
                    const seen = new Set();
                    for (const selector of selectors) {
                        for (const link of document.querySelectorAll(selector)) {
                            const href = link.href || link.getAttribute('href') || '';
                            const key = `${href}::${link.innerText || ''}`;
                            if (!href || seen.has(key)) continue;
                            seen.add(key);
                            links.push({
                                href,
                                text: link.innerText || link.getAttribute('aria-label') || link.getAttribute('title') || ''
                            });
                        }
                    }
                    return links;
                }""",
                list(template.link_selectors),
            )
            browser.close()
    except Exception as exc:
        return SourceDiscoveryResult(source=source_record, articles=[], warnings=[f"Navegador não renderizou editoria: {exc}"])

    articles = [
        candidate
        for item in payload
        if (candidate := _score_link(template, item.get("href") or "", item.get("text") or "")) is not None
    ]
    limited = _dedupe(articles, limit)
    return SourceDiscoveryResult(
        source=source_record,
        articles=limited,
        warnings=[] if limited else ["Nenhum link provável encontrado via navegador."],
    )


def discover_politics_articles(limit_per_source: int, render_browser: bool) -> list[SourceDiscoveryResult]:
    results: list[SourceDiscoveryResult] = []
    for template in PORTAL_TEMPLATES:
        html_result = _discover_html(template, limit_per_source)
        if len(html_result.articles) >= limit_per_source or not render_browser:
            results.append(html_result)
            continue

        browser_result = _discover_browser(template, limit_per_source)
        merged = _dedupe(html_result.articles + browser_result.articles, limit_per_source)
        results.append(
            SourceDiscoveryResult(
                source=html_result.source,
                articles=merged,
                warnings=html_result.warnings + browser_result.warnings,
            )
        )
    return results
