from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import re
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx

from ..config import get_settings


BLOCKED_IMAGE_HINTS = re.compile(
    r"logo|sprite|icon|icone|badge|avatar|emoji|gif|placeholder|loading|spinner|"
    r"author|profile|share|social|whatsapp|facebook|twitter|instagram|youtube|"
    r"favicon|transparent|blank|pixel",
    re.IGNORECASE,
)

ARTICLE_IMAGE_HINTS = re.compile(
    r"photo|foto|image|imagem|media|article|materia|headline|main|hero|lead|"
    r"featured|caption|credito|credit|corpo|content",
    re.IGNORECASE,
)


@dataclass
class DiscoveredImage:
    image_url: str
    width: int | None = None
    height: int | None = None
    alt: str | None = None
    source: str = "html"
    score: float = 0.0


@dataclass
class IgnoredImage(DiscoveredImage):
    reason: str = "ignored"


@dataclass
class DiscoveryResult:
    page_url: str
    title: str | None
    images: list[DiscoveredImage]
    ignored_images: list[IgnoredImage]
    warnings: list[str]


class _ArticleImageParser(HTMLParser):
    def __init__(self, page_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.title: str | None = None
        self._in_title = False
        self._title_parts: list[str] = []
        self.images: list[DiscoveredImage] = []
        self.ignored_images: list[IgnoredImage] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key.lower(): value or "" for key, value in attrs}
        if tag == "title":
            self._in_title = True
            return

        if tag == "meta":
            prop = (attr.get("property") or attr.get("name") or "").lower()
            content = attr.get("content") or ""
            if prop in {"og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"}:
                self._append_image(content, attr, "metadata")
            return

        if tag != "img":
            return

        src = _best_src(
            attr.get("srcset")
            or attr.get("data-srcset")
            or attr.get("data-lazy-srcset")
            or attr.get("data-original-set")
        )
        if not src:
            src = (
                attr.get("src")
                or attr.get("data-src")
                or attr.get("data-lazy-src")
                or attr.get("data-original")
                or attr.get("data-full-src")
                or attr.get("data-url")
            )
        self._append_image(src or "", attr, "html")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
            title = " ".join(part.strip() for part in self._title_parts if part.strip())
            self.title = title or None

    def _append_image(self, src: str, attr: dict[str, str], source: str) -> None:
        if not src:
            return
        image_url = urljoin(self.page_url, src)
        width = _as_int(attr.get("width") or attr.get("data-width"))
        height = _as_int(attr.get("height") or attr.get("data-height"))
        text = " ".join(
            value
            for value in [
                image_url,
                attr.get("alt"),
                attr.get("title"),
                attr.get("class"),
                attr.get("id"),
                attr.get("itemprop"),
            ]
            if value
        )
        evaluation = evaluate_image_candidate(image_url, width, height, text, source)
        if evaluation.reason:
            self.ignored_images.append(
                IgnoredImage(
                    image_url=image_url,
                    width=width,
                    height=height,
                    alt=attr.get("alt") or None,
                    source=source,
                    score=evaluation.score,
                    reason=evaluation.reason,
                )
            )
            return
        self.images.append(
            DiscoveredImage(
                image_url=image_url,
                width=width,
                height=height,
                alt=attr.get("alt") or None,
                source=source,
                score=evaluation.score,
            )
        )


def _as_int(value: str | int | float | None) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(float(str(value).strip().replace("px", "")))
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def _best_src(srcset: str | None) -> str | None:
    if not srcset:
        return None
    best_url: str | None = None
    best_weight = -1.0
    for candidate in srcset.split(","):
        parts = candidate.strip().split()
        if not parts:
            continue
        weight = 1.0
        if len(parts) > 1:
            descriptor = parts[-1].lower()
            try:
                weight = float(descriptor[:-1]) if descriptor.endswith(("w", "x")) else 1.0
            except ValueError:
                weight = 1.0
        if weight > best_weight:
            best_url = parts[0]
            best_weight = weight
    return best_url


@dataclass
class CandidateEvaluation:
    score: float
    reason: str | None = None


def evaluate_image_candidate(
    image_url: str,
    width: int | None,
    height: int | None,
    text: str,
    source: str,
) -> CandidateEvaluation:
    parsed = urlparse(image_url)
    if parsed.scheme not in {"http", "https"}:
        return CandidateEvaluation(0, "unsupported_scheme")
    lowered = text.lower()
    path = parsed.path.lower()
    if image_url.startswith("data:") or path.endswith(".svg"):
        return CandidateEvaluation(0, "non_raster_image")
    if BLOCKED_IMAGE_HINTS.search(lowered):
        return CandidateEvaluation(0, "blocked_hint")

    score = 1.0
    if source == "metadata":
        score += 2.0
    if ARTICLE_IMAGE_HINTS.search(lowered):
        score += 1.5

    if width and height:
        area = width * height
        settings = get_settings()
        min_dimension = max(1, settings.article_discovery_min_image_dimension)
        min_width = max(360, min_dimension)
        min_height = max(220, min_dimension)
        if width < min_width or height < min_height or area < 120_000:
            return CandidateEvaluation(score, "small_image")
        if area >= 350_000:
            score += 2.0
        elif area >= 120_000:
            score += 1.0
        ratio = width / height
        if 0.45 <= ratio <= 2.8:
            score += 0.5
        else:
            score -= 1.0
    else:
        score -= 0.25

    return CandidateEvaluation(max(score, 0), None)


def score_image_candidate(
    image_url: str,
    width: int | None,
    height: int | None,
    text: str,
    source: str,
) -> float:
    evaluation = evaluate_image_candidate(image_url, width, height, text, source)
    return 0 if evaluation.reason else evaluation.score


def _image_area(image: DiscoveredImage) -> int:
    return int(image.width or 0) * int(image.height or 0)


def _variant_key(image_url: str) -> str:
    parsed = urlparse(image_url)
    path = parsed.path
    path = re.sub(r"([_-])\d{2,5}x\d{2,5}(?=\.[a-zA-Z0-9]+$)", r"\1SIZE", path)
    path = re.sub(r"([_-])\d{2,5}(?=\.[a-zA-Z0-9]+$)", r"\1SIZE", path)
    path = re.sub(r"/(?:w|width|h|height|fit-in|resize)/\d{2,5}(?=/)", "/SIZE", path, flags=re.IGNORECASE)
    ignored_params = {
        "w",
        "width",
        "h",
        "height",
        "resize",
        "size",
        "crop",
        "fit",
        "quality",
        "q",
        "format",
        "auto",
        "dpr",
    }
    query = urlencode(
        [
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in ignored_params
        ]
    )
    return urlunparse((parsed.scheme, parsed.netloc, path, "", query, ""))


def _prefer_image_variant(current: DiscoveredImage, candidate: DiscoveredImage) -> DiscoveredImage:
    current_area = _image_area(current)
    candidate_area = _image_area(candidate)
    if candidate_area and candidate_area != current_area:
        return candidate if candidate_area > current_area else current
    if candidate.score != current.score:
        return candidate if candidate.score > current.score else current
    return candidate if len(candidate.image_url) > len(current.image_url) else current


def _dedupe_and_limit(images: Iterable[DiscoveredImage], max_images: int) -> list[DiscoveredImage]:
    by_url: dict[str, DiscoveredImage] = {}
    for image in images:
        existing = by_url.get(image.image_url)
        if existing is None or image.score > existing.score:
            by_url[image.image_url] = image

    by_variant: dict[str, DiscoveredImage] = {}
    for image in by_url.values():
        key = _variant_key(image.image_url)
        existing = by_variant.get(key)
        by_variant[key] = image if existing is None else _prefer_image_variant(existing, image)

    return sorted(by_variant.values(), key=lambda item: (item.score, _image_area(item)), reverse=True)[:max_images]


def _dedupe_ignored(images: Iterable[IgnoredImage]) -> list[IgnoredImage]:
    by_key: dict[tuple[str, str], IgnoredImage] = {}
    for image in images:
        key = (image.image_url, image.reason)
        existing = by_key.get(key)
        if existing is None or image.score > existing.score:
            by_key[key] = image
    return sorted(by_key.values(), key=lambda item: (item.reason, item.image_url))


def _headers(page_url: str) -> dict[str, str]:
    parsed = urlparse(page_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.5",
        "cache-control": "no-cache",
        "referer": origin,
        "user-agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        ),
    }


def discover_article_images_html(page_url: str, max_images: int) -> DiscoveryResult:
    settings = get_settings()
    warnings: list[str] = []
    try:
        with httpx.Client(
            timeout=settings.article_discovery_timeout_seconds,
            follow_redirects=True,
            headers=_headers(page_url),
        ) as client:
            response = client.get(page_url)
        response.raise_for_status()
    except Exception as exc:
        return DiscoveryResult(page_url=page_url, title=None, images=[], ignored_images=[], warnings=[f"HTML não carregado: {exc}"])

    content_type = response.headers.get("content-type", "")
    if "html" not in content_type.lower():
        warnings.append(f"Resposta não parece HTML: {content_type or 'sem content-type'}")

    parser = _ArticleImageParser(str(response.url))
    parser.feed(response.text)
    images = _dedupe_and_limit(parser.images, max_images)
    if not images:
        warnings.append("Nenhuma imagem jornalística provável encontrada no HTML estático.")
    return DiscoveryResult(
        page_url=page_url,
        title=parser.title,
        images=images,
        ignored_images=_dedupe_ignored(parser.ignored_images),
        warnings=warnings,
    )


def discover_article_images_browser(page_url: str, max_images: int) -> DiscoveryResult:
    settings = get_settings()
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        return DiscoveryResult(
            page_url=page_url,
            title=None,
            images=[],
            ignored_images=[],
            warnings=[f"Playwright indisponível para renderização com navegador: {exc}"],
        )

    warnings: list[str] = []
    try:
        with sync_playwright() as playwright:
            launch_args: dict[str, object] = {"headless": True}
            if settings.article_discovery_browser_executable:
                launch_args["executable_path"] = settings.article_discovery_browser_executable
            browser = playwright.chromium.launch(**launch_args)
            page = browser.new_page(
                locale="pt-BR",
                user_agent=_headers(page_url)["user-agent"],
                viewport={"width": 1366, "height": 900},
            )
            page.goto(page_url, wait_until="domcontentloaded", timeout=int(settings.article_discovery_timeout_seconds * 1000))
            page.wait_for_timeout(1200)
            payload = page.evaluate(
                """() => ({
                    pageUrl: location.href,
                    title: document.title,
                    images: Array.from(document.images).map((img) => ({
                        image_url: img.currentSrc || img.src || img.getAttribute('src') || '',
                        width: img.naturalWidth || img.width || null,
                        height: img.naturalHeight || img.height || null,
                        alt: img.alt || null,
                        text: [
                            img.currentSrc || img.src || '',
                            img.alt || '',
                            img.className || '',
                            img.id || '',
                            img.closest('figure, article, main, picture')?.className || ''
                        ].join(' ')
                    }))
                })"""
            )
            browser.close()
    except Exception as exc:
        return DiscoveryResult(page_url=page_url, title=None, images=[], ignored_images=[], warnings=[f"Navegador não renderizou a matéria: {exc}"])

    images = []
    ignored_images = []
    for item in payload.get("images", []):
        image_url = urljoin(payload.get("pageUrl") or page_url, item.get("image_url") or "")
        evaluation = evaluate_image_candidate(
            image_url,
            _as_int(item.get("width")),
            _as_int(item.get("height")),
            item.get("text") or image_url,
            "browser",
        )
        if evaluation.reason:
            ignored_images.append(
                IgnoredImage(
                    image_url=image_url,
                    width=_as_int(item.get("width")),
                    height=_as_int(item.get("height")),
                    alt=item.get("alt") or None,
                    source="browser",
                    score=evaluation.score,
                    reason=evaluation.reason,
                )
            )
            continue
        images.append(
            DiscoveredImage(
                image_url=image_url,
                width=_as_int(item.get("width")),
                height=_as_int(item.get("height")),
                alt=item.get("alt") or None,
                source="browser",
                score=evaluation.score,
            )
        )

    limited = _dedupe_and_limit(images, max_images)
    if not limited:
        warnings.append("Nenhuma imagem jornalística provável encontrada após renderização.")
    return DiscoveryResult(
        page_url=payload.get("pageUrl") or page_url,
        title=payload.get("title") or None,
        images=limited,
        ignored_images=_dedupe_ignored(ignored_images),
        warnings=warnings,
    )


def discover_article_images(page_url: str, *, render_browser: bool | None, max_images: int | None = None) -> DiscoveryResult:
    settings = get_settings()
    limit = max_images or settings.article_discovery_max_images
    should_render = settings.article_discovery_browser_enabled if render_browser is None else render_browser

    if should_render:
        browser_result = discover_article_images_browser(page_url, limit)
        if browser_result.images:
            return browser_result
        html_result = discover_article_images_html(page_url, limit)
        return DiscoveryResult(
            page_url=html_result.page_url,
            title=browser_result.title or html_result.title,
            images=html_result.images,
            ignored_images=_dedupe_ignored(browser_result.ignored_images + html_result.ignored_images),
            warnings=browser_result.warnings + html_result.warnings,
        )

    return discover_article_images_html(page_url, limit)
