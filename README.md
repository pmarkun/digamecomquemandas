# diga-me (nome curto do projeto “Quem Tá Na Foto?”)

Implementação inicial do MVP com monorepo, API, web, worker e extensão Chrome.

## Estrutura

```text
apps/
  extension/
    src/
  web/
  api/
  worker/
packages/
  shared/
infra/
  docker/
  seed/
```

## Setup local

```bash
cp .env.example .env
nix develop
make setup
```

### Bootstrap com Nix flake

```bash
nix develop
nix run .#init
```

Ou, de forma equivalente:

```bash
nix develop
make setup
```

### Rodar ambiente completo

```bash
make dev
```

Serviços esperados:
- `localhost:5432` PostgreSQL (pgvector)
- `localhost:6379` Redis
- `localhost:8000` API FastAPI
- `localhost:3000` Web
- `diga-me-worker` em execução contínua

### Banco e seed

```bash
make migrate
make seed
```

### Extensão Chrome

1. Abra `chrome://extensions/`
2. Ative **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação**
4. Selecione `apps/extension/`
5. Abra uma página da allowlist e valide overlay da extensão

## Endpoints principais da API

- `GET /api/v1/health`
- `POST /api/v1/extension/analyze-page`
- `POST /api/v1/extension/faces/{face_id}/suggestions`
- `GET /api/v1/people`
- `GET /api/v1/people/{slug}`
- `GET /api/v1/people/{slug}/appearances`
- `GET /api/v1/people/{slug}/connections`
- `POST /api/v1/people/{slug}/contest`
- `POST /api/v1/admin/login`
- `POST /api/v1/admin/people`
- `POST /api/v1/admin/people/{person_id}/reference-images`
- `POST /api/v1/admin/matches/{match_id}/review`
- `POST /api/v1/admin/suggestions/{suggestion_id}/review`
- `POST /api/v1/admin/people/{person_id}/optout`

## O que está pronto (MVP)

- Estrutura do monorepo conforme especificado.
- API com fluxo ponta a ponta de análise de página, resultados e contestação.
- Web pública com páginas: home, perfil, conexões, matéria e admin.
- Seed inicial (`infra/seed/people.json`) com 10 pessoas e 2 imagens públicas.
- Extensão V3 mínima com allowlist, análise remota, overlay, marcação de pessoa não identificada e sugestão manual.
- Busca vetorial com PostgreSQL + pgvector, mantendo fallback local para testes com SQLite.

## Limitações atuais

- Pipeline usa detector/embedding determinístico por imagem, sem InsightFace real ainda.
- Embeddings faciais são persistidos em coluna `vector(128)` no PostgreSQL/pgvector e também em JSON para fallback de testes.
- Worker é modo demo inicial (sem fila/broker real).
