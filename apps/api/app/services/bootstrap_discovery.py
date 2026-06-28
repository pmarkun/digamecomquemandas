from __future__ import annotations

from dataclasses import dataclass
import html
from html.parser import HTMLParser
import re
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from xml.etree import ElementTree

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


def _xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _xml_child_text(element: ElementTree.Element, *names: str) -> str:
    wanted = {name.lower() for name in names}
    for child in list(element):
        if _xml_local_name(child.tag) in wanted and child.text:
            return child.text.strip()
    return ""


def _xml_link(element: ElementTree.Element) -> str:
    for child in list(element):
        if _xml_local_name(child.tag) != "link":
            continue
        href = child.attrib.get("href")
        if href:
            return href.strip()
        if child.text:
            return child.text.strip()
    return _xml_child_text(element, "guid", "id")


def _clean_feed_text(value: str) -> str:
    value = value.strip()
    cdata = re.fullmatch(r"<!\[CDATA\[(.*)]]>", value, re.DOTALL)
    if cdata:
        value = cdata.group(1).strip()
    return html.unescape(value).strip()


def _unwrap_feed_link(href: str) -> str:
    href = _clean_feed_text(href)
    if "*http" in href:
        href = href.split("*", 1)[1]
    return href


def _rss_entries_from_regex(content: str) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    for item in re.findall(r"<item[\s\S]*?</item>", content, re.IGNORECASE):
        title_match = re.search(r"<title[^>]*>([\s\S]*?)</title>", item, re.IGNORECASE)
        link_match = re.search(r"<link[^>]*>([\s\S]*?)</link>", item, re.IGNORECASE)
        guid_match = re.search(r"<guid[^>]*>([\s\S]*?)</guid>", item, re.IGNORECASE)
        href = _clean_feed_text(link_match.group(1)) if link_match else ""
        if not href and guid_match:
            href = _clean_feed_text(guid_match.group(1))
        title = _clean_feed_text(title_match.group(1)) if title_match else ""
        if href:
            entries.append((href, title))
    return entries


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


def _discover_rss(source: PoliticsSource | PortalTemplate, limit: int) -> SourceDiscoveryResult:
    template = template_for_source(source)
    source_record = template.as_source()
    if not template.rss_url:
        return SourceDiscoveryResult(source=source_record, articles=[], warnings=["Portal sem RSS configurado."])

    settings = get_settings()
    try:
        with httpx.Client(
            timeout=settings.article_discovery_timeout_seconds,
            follow_redirects=True,
            headers=_headers(template.rss_url),
        ) as client:
            response = client.get(template.rss_url)
        response.raise_for_status()
    except Exception as exc:
        return SourceDiscoveryResult(source=source_record, articles=[], warnings=[f"RSS não carregado: {exc}"])

    parse_warning: str | None = None
    try:
        root = ElementTree.fromstring(response.content)
        entries = [
            (_xml_link(element), _xml_child_text(element, "title"))
            for element in root.iter()
            if _xml_local_name(element.tag) in {"item", "entry"}
        ]
    except ElementTree.ParseError as exc:
        parse_warning = f"RSS XML inválido, usando parser tolerante: {exc}"
        entries = _rss_entries_from_regex(response.text)

    articles: list[ArticleCandidate] = []
    for href, title in entries:
        href = _unwrap_feed_link(href)
        candidate = _score_link(template, href, title)
        if candidate is not None:
            candidate.score += 3.0
            articles.append(candidate)

    limited = _dedupe(articles, limit)
    warnings = [] if limited else ["Nenhuma matéria política encontrada no RSS."]
    if parse_warning:
        warnings.append(parse_warning)
    return SourceDiscoveryResult(source=source_record, articles=limited, warnings=warnings)


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
        rss_result = _discover_rss(template, limit_per_source)
        if len(rss_result.articles) >= limit_per_source:
            results.append(rss_result)
            continue

        html_result = _discover_html(template, limit_per_source)
        merged_without_browser = _dedupe(rss_result.articles + html_result.articles, limit_per_source)
        if len(merged_without_browser) >= limit_per_source or not render_browser:
            results.append(
                SourceDiscoveryResult(
                    source=rss_result.source,
                    articles=merged_without_browser,
                    warnings=rss_result.warnings + html_result.warnings,
                )
            )
            continue

        browser_result = _discover_browser(template, limit_per_source)
        merged = _dedupe(merged_without_browser + browser_result.articles, limit_per_source)
        results.append(
            SourceDiscoveryResult(
                source=rss_result.source,
                articles=merged,
                warnings=rss_result.warnings + html_result.warnings + browser_result.warnings,
            )
        )
    return results
