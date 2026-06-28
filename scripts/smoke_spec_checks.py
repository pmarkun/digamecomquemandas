#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

import json
import os
import urllib.request
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[1]

CHECKS = []

def ok(name: str, passed: bool, detail: str = '') -> None:
    CHECKS.append((name, passed, detail))


def check_file(path: str) -> bool:
    return (ROOT / path).exists()


def check_routes(path: str, routes: list[str], prefix: str = '') -> None:
    text = (ROOT / path).read_text(encoding='utf-8')
    for route in routes:
        # accept declarations inside APIRouter prefix
        token = f"\"{route}\""
        if route.startswith('/api/v1/'):
            route = route.replace('/api/v1', '')
            token = f'\"{route}\"'
        ok(f'{path}:{route}', token in text, f'contains {route} route definition' if token in text else 'missing')


def check_admin_routes() -> None:
    text = (ROOT / 'apps/api/app/routes/admin.py').read_text(encoding='utf-8')
    for route in [
        '/login', '/people', '/people/{person_id}/reference-images', '/matches/{match_id}/review',
        '/suggestions/{suggestion_id}/review', '/people/{person_id}/optout',
        '/suggestions', '/matches', '/optout-requests', '/audit-logs', '/allowed-domains',
        '/people/{person_id}/article-images/{image_id}/discard', '/article-images/{image_id}/faces',
    ]:
        ok(f'admin{route}', f'"{route}"' in text, f'route {route} present')


def check_people_routes() -> None:
    text = (ROOT / 'apps/api/app/routes/people.py').read_text(encoding='utf-8')
    for route in ['/people', '/people/{slug}', '/people/{slug}/appearances', '/people/{slug}/connections', '/people/{slug}/contest', '/articles/{article_id}', '/allowed-domains']:
        ok(f'people{route}', f'"{route}"' in text, f'route {route} present')


def check_seed() -> None:
    data = json.loads((ROOT / 'infra/seed/people.json').read_text(encoding='utf-8'))
    ok('seed.count', len(data) >= 10, f'{len(data)} pessoas no seed')
    ok('seed.min_ref_images', all(len(item.get('reference_images', [])) >= 2 for item in data), 'cada pessoa com mínimo de 2 referências')


def check_pgvector_contracts() -> None:
    models = (ROOT / 'apps/api/app/models.py').read_text(encoding='utf-8')
    db = (ROOT / 'apps/api/app/db.py').read_text(encoding='utf-8')
    matcher = (ROOT / 'apps/api/app/services/match.py').read_text(encoding='utf-8')
    seed = (ROOT / 'apps/api/app/seed.py').read_text(encoding='utf-8')
    pyproject = (ROOT / 'apps/api/pyproject.toml').read_text(encoding='utf-8')

    ok('pgvector.dependency', '"pgvector>=' in pyproject, 'API declara dependência pgvector')
    ok('pgvector.model_column', 'embedding_vector' in models and 'Vector(128)' in models, 'modelos têm coluna vector(128)')
    ok('pgvector.extension', 'CREATE EXTENSION IF NOT EXISTS vector' in db, 'init_db habilita extensão vector')
    ok('pgvector.index', 'vector_cosine_ops' in db, 'init_db cria índice coseno pgvector')
    ok('matching.cosine', 'cosine(face_embedding, pe.embedding)' in matcher and 'normalize_embedding' in matcher, 'matching usa cosine similarity em embeddings faciais')
    ok('pgvector.seed_vectors', 'embedding_vector=embedding' in seed, 'seed preenche embedding_vector')


def check_make_targets() -> None:
    text = (ROOT / 'Makefile').read_text(encoding='utf-8')
    for target in ["setup", "dev", "migrate", "seed", "test", "lint"]:
        ok(f'make.{target}', f'{target}:' in text, f'target "{target}" presente no Makefile')


def check_compose_services() -> None:
    text = (ROOT / 'infra/docker/docker-compose.yml').read_text(encoding='utf-8')
    for service in ["postgres", "redis", "api", "web", "worker"]:
        ok(f'compose.{service}', f'  {service}:' in text or f'    container_name: diga-me-{service}' in text, f'serviço {service} definido')


def live_checks() -> None:
    base = os.getenv('API_URL', 'http://localhost:8000').rstrip('/')
    endpoints = [f'{base}/api/v1/health', f'{base}/api/v1/allowed-domains', f'{base}/api/v1/people']
    for endpoint in endpoints:
        try:
            with urllib.request.urlopen(endpoint, timeout=3) as response:
                ok(f'live:{endpoint}', response.status == 200, f'status {response.status}')
        except URLError as exc:
            ok(f'live:{endpoint}', False, f'erro: {type(exc).__name__}: {exc}')


def check_frontend_contracts() -> None:
    web_pages = [
        "apps/web/app/page.tsx",
        "apps/web/app/admin/page.tsx",
        "apps/web/app/pessoa/[slug]/page.tsx",
        "apps/web/app/pessoa/[slug]/conexoes/page.tsx",
        "apps/web/app/pessoa/[slug]/contestar/page.tsx",
        "apps/web/app/materia/[id]/page.tsx",
    ]
    for page in web_pages:
        ok(f'web.page:{Path(page).name}', (ROOT / page).exists(), f'arquivo {page} existe')

    api_contract = (ROOT / 'apps/web/lib/api.ts').read_text(encoding='utf-8')
    ok('web.api.base', 'NEXT_PUBLIC_API_BASE_URL' in api_contract, 'API base configurável por env do Next')

    admin_page = (ROOT / 'apps/web/app/admin/page.tsx').read_text(encoding='utf-8')
    ok('web.admin.login_uses_fresh_token', 'await loadProtected(out.token)' in admin_page, 'admin carrega dados protegidos com token recém-logado')
    ok('web.admin.restores_session', 'digaMeAdminToken' in admin_page and 'localStorage.getItem' in admin_page, 'admin restaura sessão do localStorage')
    ok('web.admin.no_prompt_create_person', 'prompt(' not in admin_page, 'admin usa formulário próprio para criar pessoa')
    ok('web.admin.review_cards', 'review-card' in admin_page and 'article_title' in admin_page and 'image_url' in admin_page, 'admin mostra contexto visual em sugestões e matches')
    admin_detail = (ROOT / 'apps/web/app/admin/pessoas/[id]/page.tsx').read_text(encoding='utf-8')
    ok('web.admin.per_match_reassign', 'reassignTargets' in admin_detail and 'Mover face' in admin_detail, 'reatribuição de face é contextual por match')
    ok('web.admin.person_back_button', 'Voltar ao admin' in admin_detail, 'edição de pessoa tem botão de voltar')
    ok('web.admin.discard_person_image', 'Descartar imagem deste perfil' in admin_detail and '/discard' in admin_detail, 'admin pode descartar só a imagem do perfil')
    ok('web.admin.image_face_detector', 'Detectar faces' in admin_detail and '/article-images/${activeImageMatch.image_id}/faces' in admin_detail, 'imagem ampliada permite detectar e salvar faces')
    profile_page = (ROOT / 'apps/web/app/pessoa/[slug]/page.tsx').read_text(encoding='utf-8')
    connections_page = (ROOT / 'apps/web/app/pessoa/[slug]/conexoes/page.tsx').read_text(encoding='utf-8')
    contest_page = (ROOT / 'apps/web/app/pessoa/[slug]/contestar/page.tsx').read_text(encoding='utf-8')
    ok('web.public.profile_cards', 'appearance-card' in profile_page and 'score' not in profile_page, 'perfil público usa cards e esconde score técnico')
    ok('web.public.connections_no_score', 'last_score' not in connections_page and 'score' not in connections_page, 'conexões públicas escondem score técnico')
    ok('web.public.contest_feedback', 'success' in contest_page and 'Preencha nome' in contest_page, 'contestação tem validação e feedback')

    people_routes = (ROOT / 'apps/api/app/routes/people.py').read_text(encoding='utf-8')
    ok('api.public.safe_match_statuses', 'PUBLIC_MATCH_STATUSES' in people_routes and 'FaceMatch.status.in_(PUBLIC_MATCH_STATUSES)' in people_routes, 'páginas públicas filtram só matches aprovados')
    admin_routes = (ROOT / 'apps/api/app/routes/admin.py').read_text(encoding='utf-8')
    ok('api.admin.enriched_queues', '_match_payload' in admin_routes and '_suggestion_payload' in admin_routes and 'image_width' in admin_routes, 'filas admin retornam contexto de imagem/matéria')
    ok('api.admin.slug_normalizes_accents', 'unicodedata.normalize' in admin_routes and '_slugify(suggestion.suggested_name)' in admin_routes, 'slug de sugestão remove acentos')


def check_extension_contracts() -> None:
    content = (ROOT / 'apps/extension/src/content.ts').read_text(encoding='utf-8')
    background = (ROOT / 'apps/extension/src/background.ts').read_text(encoding='utf-8')
    popup = (ROOT / 'apps/extension/src/popup/popup.ts').read_text(encoding='utf-8')
    manifest = (ROOT / 'apps/extension/manifest.json').read_text(encoding='utf-8')
    schemas = (ROOT / 'apps/api/app/schemas.py').read_text(encoding='utf-8')
    extension_routes = (ROOT / 'apps/api/app/routes/extension.py').read_text(encoding='utf-8')
    discovery_service = (ROOT / 'apps/api/app/services/article_image_discovery.py').read_text(encoding='utf-8')
    web_home = (ROOT / 'apps/web/app/page.tsx').read_text(encoding='utf-8')
    extension_pkg = (ROOT / 'apps/extension/package.json').read_text(encoding='utf-8')

    ok('extension.allowlist_fallback', 'ALLOWLIST_FALLBACK' in content, 'has fallback local')
    ok('extension.get_allowed_domains_message', 'GET_ALLOWED_DOMAINS' in background, 'background atende consulta de allowlist')
    ok('extension.analyze_page_message', 'ANALYZE_PAGE' in background and '/extension/analyze-page' in background, 'envia página para backend')
    ok('extension.faceapi_dependency', 'face-api.js' in extension_pkg, 'extensão declara face-api.js')
    ok('extension.faceapi_tiny_detector', 'TinyFaceDetectorOptions' in content, 'content script usa TinyFaceDetector')
    ok('extension.faceapi_models_packaged', (ROOT / 'apps/extension/public/models/tiny_face_detector_model-weights_manifest.json').exists() and (ROOT / 'apps/extension/public/models/tiny_face_detector_model-shard1').exists(), 'modelos locais do tiny face detector existem')
    ok('extension.models_web_accessible', 'models/*' in manifest, 'modelos expostos como web_accessible_resources')
    ok('api.client_faces_contract', 'class DetectedFaceIn' in schemas and 'faces: list[DetectedFaceIn]' in schemas, 'API aceita faces detectadas no cliente')
    ok('extension.sidebar_for_detected_images', 'SIDEBAR_ID' in content and 'ensureSidebar' in content, 'sidebar é criada para imagens detectadas')
    ok('extension.incremental_image_scan', 'MutationObserver' in content and 'scheduleScan' in content, 'novas imagens carregadas entram na análise')
    ok('extension.unmatched_face_copy', 'Sem match automático' in content, 'faces sem match aparecem para sugestão manual')
    ok('extension.submit_suggestion', 'SUBMIT_SUGGESTION' in content and 'suggested_name' in content, 'usuário consegue sugerir identificação')
    ok('extension.popup_disable_site', 'disabledSites' in popup and 'Desativar neste site' in popup, 'popup permite desativar domínio atual')
    ok('article_discovery.route', '"/extension/discover-article-images"' in extension_routes, 'API expõe descoberta de imagens de matéria')
    ok('article_discovery.allowlist', 'descoberta bloqueada' in extension_routes and '_is_allowed' in extension_routes, 'descoberta respeita allowlist')
    ok('article_discovery.heuristics', 'BLOCKED_IMAGE_HINTS' in discovery_service and 'ARTICLE_IMAGE_HINTS' in discovery_service, 'serviço filtra logos e prioriza imagens jornalísticas')
    ok('article_discovery.browser_optional', 'discover_article_images_browser' in discovery_service and 'playwright.sync_api' in discovery_service, 'serviço suporta renderização opcional com navegador')
    ok('web.article_url_input', '/extension/discover-article-images' in web_home and 'isLikelyImageUrl' in web_home, 'bancada web aceita URL de matéria automaticamente')
    ok('article_discovery.small_images', 'width < 360' in discovery_service and 'small_image' in discovery_service, 'crawler ignora thumbnails pequenas')
    ok('article_discovery.ignored_debug', 'ignored_images' in schemas and 'payload.debug' in extension_routes, 'API retorna imagens ignoradas só em debug')
    ok('debug.face_scores', '/extension/debug/faces/{face_id}/people-scores' in extension_routes and 'cosine' in extension_routes, 'API calcula score por face para autocomplete debug')
    ok('web.debug_toggle', 'Debug' in web_home and 'debugEnabled' in web_home and 'debug-panel' in web_home, 'home tem modo debug')
    ok('web.inline_curation', 'inline-suggestion-form' in web_home and 'curation-face-list' in web_home, 'curadoria usa inputs inline por face')


def main() -> int:
    if not check_file('apps/api/app/routes/admin.py'):
        ok('repo.integrity', False, 'arquivo admin.py ausente')
    check_admin_routes()
    check_people_routes()
    check_seed()
    check_pgvector_contracts()
    check_make_targets()
    check_compose_services()
    check_frontend_contracts()
    check_extension_contracts()

    if os.getenv('RUN_LIVE_CHECKS', '').strip().lower() in {'1', 'true', 'yes'}:
        live_checks()

    failures = [c for c in CHECKS if not c[1]]
    for name, passed, detail in CHECKS:
        print(f"{name}: {'PASS' if passed else 'FAIL'} :: {detail}")

    if failures:
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
