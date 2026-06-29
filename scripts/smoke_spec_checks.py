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
        '/login', '/people', '/people/{person_id}/reference-images',
        '/people/{person_id}/reference-images/{reference_image_id}/delete', '/matches/{match_id}/review',
        '/suggestions/{suggestion_id}/review', '/people/{person_id}/optout',
        '/suggestions', '/matches', '/optout-requests', '/audit-logs', '/allowed-domains',
        '/people/{person_id}/article-images/{image_id}/discard', '/article-images/{image_id}/faces',
        '/bootstrap-runs', '/bootstrap-runs/{run_id}', '/bootstrap-runs/{run_id}/articles/{run_article_id}/attach',
        '/bootstrap-runs/{run_id}/label-group',
    ]:
        ok(f'admin{route}', f'"{route}"' in text, f'route {route} present')


def check_people_routes() -> None:
    text = (ROOT / 'apps/api/app/routes/people.py').read_text(encoding='utf-8')
    for route in ['/people', '/people/{slug}', '/people/{slug}/appearances', '/people/{slug}/connections', '/people/{slug}/influence-graph', '/people/{slug}/contest', '/articles/{article_id}', '/allowed-domains']:
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
    ok('graph.indexes', 'idx_facematch_person_status' in db and 'idx_facematch_detected_face_status' in db and 'idx_detectedface_article_image_id' in db, 'init_db cria índices para travessia do grafo')
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
        "apps/web/app/admin/bootstrap/page.tsx",
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
    bootstrap_page = (ROOT / 'apps/web/app/admin/bootstrap/page.tsx').read_text(encoding='utf-8')
    bootstrap_processor = (ROOT / 'apps/web/lib/bootstrapProcessor.ts').read_text(encoding='utf-8')
    ok('web.admin.login_uses_fresh_token', 'await loadProtected(out.token)' in admin_page, 'admin carrega dados protegidos com token recém-logado')
    ok('web.admin.restores_session', 'digaMeAdminToken' in admin_page and 'localStorage.getItem' in admin_page, 'admin restaura sessão do localStorage')
    ok('web.admin.no_prompt_create_person', 'prompt(' not in admin_page, 'admin usa formulário próprio para criar pessoa')
    ok('web.admin.review_cards', 'review-card' in admin_page and 'article_title' in admin_page and 'image_url' in admin_page, 'admin mostra contexto visual em sugestões e matches')
    admin_detail = (ROOT / 'apps/web/app/admin/pessoas/[id]/page.tsx').read_text(encoding='utf-8')
    ok('web.admin.per_match_reassign', 'reassignTargets' in admin_detail and 'Mover face' in admin_detail, 'reatribuição de face é contextual por match')
    ok('web.admin.person_back_button', 'Voltar ao admin' in admin_detail, 'edição de pessoa tem botão de voltar')
    ok('web.admin.discard_person_image', 'Descartar imagem deste perfil' in admin_detail and '/discard' in admin_detail, 'admin pode descartar só a imagem do perfil')
    ok('web.admin.delete_reference_image', 'deleteReference' in admin_detail and '/reference-images/${reference.id}/delete' in admin_detail, 'admin pode excluir foto de referência')
    ok('web.admin.person_match_tabs', 'Aprovadas' in admin_detail and 'Pendentes' in admin_detail and 'approvedMatches' in admin_detail and 'pendingMatches' in admin_detail, 'edição de pessoa mostra abas de faces aprovadas e pendentes')
    ok('web.admin.image_face_detector', 'Detectar faces' in admin_detail and '/article-images/${activeImageMatch.image_id}/faces' in admin_detail, 'imagem ampliada permite detectar e salvar faces')
    ok('web.admin.bootstrap_link', '/admin/bootstrap' in admin_page, 'admin aponta para bancada de bootstrap')
    ok('web.admin.bootstrap_page', 'Nomeação em lote' in bootstrap_page and 'processRun' in bootstrap_page, 'bancada de bootstrap existe')
    ok('web.admin.bootstrap_detects_client_side', 'processBootstrapArticle' in bootstrap_page and 'detectFaces(' in bootstrap_processor and 'face-api.js' in bootstrap_processor and '/extension/analyze-page' in bootstrap_processor, 'bootstrap detecta faces no browser e envia embeddings')
    ok('web.admin.bootstrap_group_label', '/label-group' in bootstrap_page and 'Nomear grupo' in bootstrap_page, 'bootstrap permite nomear grupo de faces')
    ok('web.admin.bootstrap_article_deck', 'bootstrap-review-deck' in bootstrap_page and 'ArrowLeft' in bootstrap_page and 'ArrowRight' in bootstrap_page, 'bootstrap revisa uma matéria por vez com navegação')
    ok('web.admin.bootstrap_face_actions', '/faces/${face.face_id}/assign' in bootstrap_page and 'reviewMatch(primaryMatch.id' in bootstrap_page, 'bootstrap permite aprovar, rejeitar e atribuir faces')
    ok('web.admin.bootstrap_ignore_image', 'Ignorar imagem' in bootstrap_page and '/article-images/${image.image_id}/ignore' in bootstrap_page, 'bootstrap permite ignorar imagem inteira')
    ok('web.admin.bootstrap_dedupes_image_variants', 'dedupeImageVariants' in bootstrap_processor and 'imageVariantKey' in bootstrap_processor, 'bootstrap ignora variantes menores da mesma imagem')
    ok('web.admin.bootstrap_min_dimension_env', 'NEXT_PUBLIC_BOOTSTRAP_MIN_IMAGE_DIMENSION' in bootstrap_processor and 'isTooSmallForBootstrap' in bootstrap_processor, 'bootstrap filtra imagens pequenas por env')
    profile_page = (ROOT / 'apps/web/app/pessoa/[slug]/page.tsx').read_text(encoding='utf-8')
    connections_page = (ROOT / 'apps/web/app/pessoa/[slug]/conexoes/page.tsx').read_text(encoding='utf-8')
    contest_page = (ROOT / 'apps/web/app/pessoa/[slug]/contestar/page.tsx').read_text(encoding='utf-8')
    ok('web.public.profile_cards', 'appearance-card' in profile_page and 'score' not in profile_page, 'perfil público usa cards e esconde score técnico')
    ok('web.public.connections_no_score', 'last_score' not in connections_page and 'score' not in connections_page, 'conexões públicas escondem score técnico')
    ok('web.public.influence_graph', '/influence-graph?limit=32' in connections_page and 'influence-graph' in connections_page and '<svg' in connections_page, 'conexões públicas renderizam grafo visual')
    ok('web.public.influence_counts', 'image_count' in connections_page and 'article_count' in connections_page and 'edgeWidth' in connections_page, 'grafo mostra conexões por foto e matéria')
    ok('web.public.contest_feedback', 'success' in contest_page and 'Preencha nome' in contest_page, 'contestação tem validação e feedback')

    people_routes = (ROOT / 'apps/api/app/routes/people.py').read_text(encoding='utf-8')
    ok('api.public.safe_match_statuses', 'PUBLIC_MATCH_STATUSES' in people_routes and 'FaceMatch.status.in_(PUBLIC_MATCH_STATUSES)' in people_routes, 'páginas públicas filtram só matches aprovados')
    ok('api.public.influence_graph_route', 'person_influence_graph' in people_routes and 'InfluenceGraphOut' in people_routes, 'API pública expõe grafo de influência')
    ok('api.public.influence_image_dedupe', 'seen_image_pairs' in people_routes and 'entry["image_ids"].add(image_id)' in people_routes, 'grafo não conta a mesma imagem mais de uma vez por pessoa')
    ok('api.public.influence_article_dedupe', 'seen_article_pairs' in people_routes and 'entry["article_ids"].add(article_id)' in people_routes, 'grafo não conta a mesma matéria mais de uma vez por pessoa')
    ok('api.public.influence_two_scopes', 'own_image_ids' in people_routes and 'own_article_ids' in people_routes and 'ArticleImage.article_id.in_(own_article_ids)' in people_routes, 'grafo separa conexão por foto e por matéria')
    ok('api.public.influence_public_people_only', 'Person.is_public_figure == True' in people_routes and 'Person.status == "ACTIVE"' in people_routes, 'grafo mostra apenas figuras públicas ativas')
    admin_routes = (ROOT / 'apps/api/app/routes/admin.py').read_text(encoding='utf-8')
    models = (ROOT / 'apps/api/app/models.py').read_text(encoding='utf-8')
    bootstrap_service = (ROOT / 'apps/api/app/services/bootstrap_discovery.py').read_text(encoding='utf-8')
    portal_templates = (ROOT / 'apps/api/app/services/portal_templates.py').read_text(encoding='utf-8')
    ok('api.admin.enriched_queues', '_match_payload' in admin_routes and '_suggestion_payload' in admin_routes and 'image_width' in admin_routes, 'filas admin retornam contexto de imagem/matéria')
    ok('api.admin.delete_reference_image', 'delete_reference_image' in admin_routes and 'session.delete(ref)' in admin_routes, 'API permite excluir foto de referência')
    ok('api.admin.person_matches_hide_rejected', 'FaceMatch.status.in_(ACTIVE_MATCH_STATUS)' in admin_routes and 'delete_rejected_match' in admin_routes, 'admin remove matches rejeitados da base operacional')
    ok('api.admin.slug_normalizes_accents', 'unicodedata.normalize' in admin_routes and '_slugify(suggestion.suggested_name)' in admin_routes, 'slug de sugestão remove acentos')
    ok('api.admin.bootstrap_models', 'class BootstrapRun' in models and 'class BootstrapRunArticle' in models, 'bootstrap persiste run e matérias')
    ok('api.admin.bootstrap_sources', 'POLITICS_SOURCES' in portal_templates and 'g1.globo.com' in portal_templates and 'www1.folha.uol.com.br' in portal_templates, 'bootstrap declara fontes políticas')
    ok('api.admin.bootstrap_portal_templates', 'class PortalTemplate' in portal_templates and 'TEMPLATES_BY_SOURCE' in portal_templates and 'template_for_source' in bootstrap_service, 'bootstrap usa templates plugáveis por portal')
    ok('api.admin.bootstrap_top5_templates', all(item in portal_templates for item in ['source="g1"', 'source="oglobo"', 'source="folha"', 'source="estadao"', 'source="uol"']), 'cinco maiores portais têm templates específicos')
    ok('api.admin.bootstrap_template_rules', all(item in portal_templates for item in ['/politica/noticia/', '/poder/', '.shtml', '/politica/ultimas-noticias/']), 'templates têm padrões específicos de matéria por domínio')
    ok('api.admin.bootstrap_template_selectors', 'link_selectors' in portal_templates and 'search_url_template' in portal_templates and 'gallery_url_patterns' in portal_templates, 'templates preveem seletores, busca e galerias')
    ok('api.admin.bootstrap_rss_primary', 'rss_url' in portal_templates and '_discover_rss' in bootstrap_service and 'rss_result = _discover_rss' in bootstrap_service, 'bootstrap usa RSS como fonte primária')
    ok('api.admin.bootstrap_rss_feeds', all(item in portal_templates for item in ['dynamo/politica/rss2.xml', 'feeds.folha.uol.com.br/poder/rss091.xml', 'rss.uol.com.br/feed/noticias.xml']), 'templates declaram feeds RSS reais')
    ok('api.admin.bootstrap_browser_fallback', 'discover_politics_articles' in bootstrap_service and '_discover_browser' in bootstrap_service, 'bootstrap coleta HTML com fallback de browser')
    match_service = (ROOT / 'apps/api/app/services/match.py').read_text(encoding='utf-8')
    ok('api.admin.bootstrap_groups', 'BOOTSTRAP_GROUP_THRESHOLD' in admin_routes and '_bootstrap_groups' in admin_routes and 'cosine(' in admin_routes, 'bootstrap agrupa desconhecidos por embedding')
    ok('api.admin.bootstrap_group_threshold', 'group_threshold = max(BOOTSTRAP_GROUP_THRESHOLD, get_settings().face_display_threshold)' in admin_routes, 'agrupamento usa threshold efetivo visível')
    ok('api.admin.bootstrap_match_threshold', 'max(settings.face_match_threshold, settings.face_display_threshold)' in match_service and 'best_by_person' in match_service, 'matching automático usa threshold visível e deduplica por pessoa')
    ok('api.admin.bootstrap_groups_ignore_low_auto', 'FaceMatch.score >= settings.face_display_threshold' in admin_routes and 'APPROVED_MANUAL' in admin_routes, 'agrupamento ignora AUTO abaixo do threshold visível')
    ok('api.admin.bootstrap_label_promotes', 'label_bootstrap_group' in admin_routes and 'promote_face_reference' in admin_routes and 'APPROVED_MANUAL' in admin_routes, 'nomear grupo aprova e promove referência')
    ok('api.admin.bootstrap_assign_face', 'assign_bootstrap_face' in admin_routes and '/bootstrap-runs/{run_id}/faces/{face_id}/assign' in admin_routes, 'bootstrap tem endpoint para atribuir face individual')
    ok('api.admin.bootstrap_ignore_image', 'ignore_bootstrap_image' in admin_routes and '/bootstrap-runs/{run_id}/article-images/{image_id}/ignore' in admin_routes and 'image.status = "IGNORED"' in admin_routes, 'bootstrap tem endpoint para ignorar imagem inteira')


def check_extension_contracts() -> None:
    content = (ROOT / 'apps/extension/src/content.ts').read_text(encoding='utf-8')
    background = (ROOT / 'apps/extension/src/background.ts').read_text(encoding='utf-8')
    offscreen = (ROOT / 'apps/extension/src/offscreen.ts').read_text(encoding='utf-8')
    popup = (ROOT / 'apps/extension/src/popup/popup.ts').read_text(encoding='utf-8')
    manifest = (ROOT / 'apps/extension/manifest.json').read_text(encoding='utf-8')
    schemas = (ROOT / 'apps/api/app/schemas.py').read_text(encoding='utf-8')
    extension_routes = (ROOT / 'apps/api/app/routes/extension.py').read_text(encoding='utf-8')
    discovery_service = (ROOT / 'apps/api/app/services/article_image_discovery.py').read_text(encoding='utf-8')
    api_config = (ROOT / 'apps/api/app/config.py').read_text(encoding='utf-8')
    api_pyproject = (ROOT / 'apps/api/pyproject.toml').read_text(encoding='utf-8')
    face_detector = (ROOT / 'apps/api/app/services/face_detector.py').read_text(encoding='utf-8')
    web_home = (ROOT / 'apps/web/app/page.tsx').read_text(encoding='utf-8')
    extension_pkg = (ROOT / 'apps/extension/package.json').read_text(encoding='utf-8')
    web_pkg = (ROOT / 'apps/web/package.json').read_text(encoding='utf-8')
    web_admin_person = (ROOT / 'apps/web/app/admin/pessoas/[id]/page.tsx').read_text(encoding='utf-8')

    ok('extension.allowlist_fallback', 'ALLOWLIST_FALLBACK' in content, 'has fallback local')
    ok('extension.get_allowed_domains_message', 'GET_ALLOWED_DOMAINS' in background, 'background atende consulta de allowlist')
    ok('extension.analyze_page_message', 'ANALYZE_PAGE' in background and '/extension/analyze-page' in background, 'envia página para backend')
    ok('extension.faceapi_offscreen_dependency', 'face-api.js' in extension_pkg and '@tensorflow/tfjs' in extension_pkg and 'face-api.js' not in content, 'face-api roda no offscreen, não no content script')
    ok('extension.offscreen_document', '"offscreen"' in manifest and 'chrome.offscreen' in background and 'dist/offscreen.html' in background and 'OFFSCREEN_DETECT_FACES' in offscreen, 'extensão cria offscreen document para detectar faces')
    ok('extension.offscreen_warmup', 'WARM_FACE_DETECTOR' in content and 'OFFSCREEN_WARM_DETECTOR' in background and 'OFFSCREEN_WARM_DETECTOR' in offscreen, 'sidebar aquece detector offscreen antes da análise')
    ok('extension.offscreen_faceapi_detector', 'TinyFaceDetectorOptions' in offscreen and 'withFaceDescriptors' in offscreen and 'loadFaceApiWeightMap' in offscreen, 'offscreen usa face-api.js com embeddings')
    ok('api.no_second_face_detector', 'opencv-python-headless' not in api_pyproject and 'import cv2' not in face_detector and 'return []' in face_detector, 'backend não mantém segundo stack de detecção')
    ok('web.tfjs_backend_registered', '@tensorflow/tfjs' in web_pkg and "tf.setBackend('cpu')" in web_home and "tf.setBackend('cpu')" in web_admin_person, 'web registra backend TensorFlow antes do face-api')
    ok('extension.models_web_accessible', 'models/*' in manifest, 'modelos locais disponíveis para o offscreen')
    ok('api.client_faces_contract', 'class DetectedFaceIn' in schemas and 'faces: list[DetectedFaceIn]' in schemas, 'API aceita faces detectadas no cliente')
    ok('extension.sidebar_for_detected_images', 'SIDEBAR_ID' in content and 'ensureSidebar' in content, 'sidebar é criada para imagens detectadas')
    ok('extension.incremental_image_scan', 'MutationObserver' in content and 'scheduleScan' in content, 'novas imagens carregadas entram na análise')
    ok('extension.sidebar_small_image_threshold', 'MIN_ARTICLE_IMAGE_WIDTH = 360' in content and 'MIN_ARTICLE_IMAGE_HEIGHT = 220' in content and 'MIN_ARTICLE_IMAGE_AREA = 120_000' in content, 'sidebar aplica corte anti-thumb da home')
    ok('extension.sidebar_detector_no_proxy_permission', 'proxiedImageUrl' not in content and '/api/image-proxy' not in content, 'sidebar não pede recursos via localhost para detectar faces')
    ok('extension.sidebar_uses_offscreen_detector', 'DETECT_FACES' in content and 'detectFacesForCandidate' in content and 'TinyFaceDetectorOptions' not in content, 'sidebar chama detector offscreen sem rodar modelo no content script')
    ok('extension.sidebar_analyzing_state', "status: 'analyzing'" in content and 'Carregando detector e procurando faces' in content and 'pendingImages' in content, 'sidebar mostra estado analisando enquanto offscreen trabalha')
    ok('extension.sidebar_faces_only', 'visibleSidebarImages()' in content and 'imageHasFace(item)' in content, 'sidebar renderiza só imagens com face persistida')
    ok('extension.sidebar_known_image_shows_unknown_faces', 'imageHasMatch(item)' in content and 'item.faces' in content and 'Sem match automático' in content, 'sidebar mostra faces desconhecidas dentro de imagem com pessoa conhecida')
    ok('extension.sidebar_sends_faceapi_faces', 'eligibleCandidates.map' in content and 'faces,' in content and 'Array.isArray(candidate.faces)' in content, 'sidebar envia faces do offscreen para o backend')
    ok('api.client_faces_skip_image_fetch', 'fetched = None if client_sent_faces else fetch_image' in extension_routes and '_faces_for_image(item, image, None)' in extension_routes, 'API não baixa imagem quando recebe faces/embeddings do cliente')
    ok('extension.sidebar_face_crops', 'faceCropImageStyle' in content and 'class="face-thumb-img"' in content and 'overflow: hidden' in content, 'sidebar mostra recortes das faces em vez da imagem inteira')
    ok('extension.sidebar_scroll_to_image', 'scrollToOriginalImage' in content and 'scrollIntoView' in content and 'data-action="scroll-image"' in content, 'clique na face rola para a foto original')
    ok('extension.sidebar_multi_face_detector', 'inputSize: 512' in offscreen and 'scoreThreshold: 0.35' in offscreen, 'detector offscreen fica sensível para múltiplas faces')
    ok('api.extension_merges_new_faces', '_bbox_iou' in extension_routes and 'item.faces is not None' in extension_routes and 'active_existing_faces.append(detected)' in extension_routes, 'API incorpora novas faces enviadas para imagem já existente')
    ok('api.extension_ignores_placeholder_faces', '_is_placeholder_face' in extension_routes and 'not _is_placeholder_face(face)' in extension_routes and '_is_faceapi_face' in extension_routes, 'API ignora placeholder e faces legadas fora do face-api')
    ok('extension.sidebar_show_all_faces_toggle', 'Mostrar todas as imagens com faces' in content and 'showAllFaceImages' in content, 'sidebar tem controle para revelar faces sem match')
    ok('extension.sidebar_clean_suggestion_form', 'name="source_url"' not in content and 'submitter_email' in content and 'Sugestão criada pela sidebar da matéria.' in content, 'form da sidebar infere fonte e reduz campos')
    ok('extension.sidebar_source_from_article', 'source_url: normalizedPageUrl()' in content and 'url.hash = \'\'' in content, 'sugestão usa URL da matéria sem hash')
    ok('extension.unmatched_face_copy', 'Sem match automático' in content, 'faces sem match aparecem para sugestão manual')
    ok('extension.submit_suggestion', 'SUBMIT_SUGGESTION' in content and 'suggested_name' in content, 'usuário consegue sugerir identificação')
    ok('extension.popup_disable_site', 'disabledSites' in popup and 'Desativar neste site' in popup, 'popup permite desativar domínio atual')
    ok('article_discovery.route', '"/extension/discover-article-images"' in extension_routes, 'API expõe descoberta de imagens de matéria')
    ok('article_discovery.allowlist', 'descoberta bloqueada' in extension_routes and '_is_allowed' in extension_routes, 'descoberta respeita allowlist')
    ok('article_discovery.heuristics', 'BLOCKED_IMAGE_HINTS' in discovery_service and 'ARTICLE_IMAGE_HINTS' in discovery_service, 'serviço filtra logos e prioriza imagens jornalísticas')
    ok('article_discovery.browser_optional', 'discover_article_images_browser' in discovery_service and 'playwright.sync_api' in discovery_service, 'serviço suporta renderização opcional com navegador')
    ok('web.article_url_input', '/extension/discover-article-images' in web_home and 'isLikelyImageUrl' in web_home, 'bancada web aceita URL de matéria automaticamente')
    ok('article_discovery.small_images', 'article_discovery_min_image_dimension' in api_config and 'min_dimension' in discovery_service and 'small_image' in discovery_service, 'crawler ignora thumbnails pequenas com limiar configurável')
    ok('article_discovery.image_variant_dedupe', '_variant_key' in discovery_service and '_prefer_image_variant' in discovery_service, 'crawler prefere maior variante da mesma imagem')
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
