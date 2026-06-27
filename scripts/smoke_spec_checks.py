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


def check_extension_contracts() -> None:
    content = (ROOT / 'apps/extension/src/content.ts').read_text(encoding='utf-8')
    background = (ROOT / 'apps/extension/src/background.ts').read_text(encoding='utf-8')
    popup = (ROOT / 'apps/extension/src/popup/popup.ts').read_text(encoding='utf-8')
    manifest = (ROOT / 'apps/extension/manifest.json').read_text(encoding='utf-8')
    schemas = (ROOT / 'apps/api/app/schemas.py').read_text(encoding='utf-8')
    extension_pkg = (ROOT / 'apps/extension/package.json').read_text(encoding='utf-8')

    ok('extension.allowlist_fallback', 'ALLOWLIST_FALLBACK' in content, 'has fallback local')
    ok('extension.get_allowed_domains_message', 'GET_ALLOWED_DOMAINS' in background, 'background atende consulta de allowlist')
    ok('extension.analyze_page_message', 'ANALYZE_PAGE' in background and '/extension/analyze-page' in background, 'envia página para backend')
    ok('extension.faceapi_dependency', 'face-api.js' in extension_pkg, 'extensão declara face-api.js')
    ok('extension.faceapi_tiny_detector', 'TinyFaceDetectorOptions' in content, 'content script usa TinyFaceDetector')
    ok('extension.faceapi_models_packaged', (ROOT / 'apps/extension/public/models/tiny_face_detector_model-weights_manifest.json').exists() and (ROOT / 'apps/extension/public/models/tiny_face_detector_model-shard1').exists(), 'modelos locais do tiny face detector existem')
    ok('extension.models_web_accessible', 'models/*' in manifest, 'modelos expostos como web_accessible_resources')
    ok('api.client_faces_contract', 'class DetectedFaceIn' in schemas and 'faces: list[DetectedFaceIn]' in schemas, 'API aceita faces detectadas no cliente')
    ok('extension.overlay_for_detected_faces', 'if (entryFaces.length > 0)' in content, 'overlay é criado para faces detectadas')
    ok('extension.unmatched_face_copy', 'Pessoa não identificada' in content, 'faces sem match aparecem como pessoa não identificada')
    ok('extension.submit_suggestion', 'SUBMIT_SUGGESTION' in content and 'suggested_name' in content, 'usuário consegue sugerir identificação')
    ok('extension.popup_disable_site', 'disabledSites' in popup and 'Desativar neste site' in popup, 'popup permite desativar domínio atual')


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
