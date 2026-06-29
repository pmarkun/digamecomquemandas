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

### Deploy Railway

O deploy recomendado no Railway mantém **dois serviços** e um volume persistente:

- `api`: FastAPI, SQLite em volume Railway e Playwright/Chromium para renderizar matérias quando ativado.
- `web`: Next.js servido separadamente, apontando para a API pública.
- Volume no serviço `api`: montar em `/data`.
- Redis não é obrigatório no fluxo atual; o worker usa arquivo/local demo e pode ficar fora do deploy inicial.

Variáveis sugeridas no serviço `api`:

```env
DATABASE_URL=sqlite:////data/diga-me.sqlite3
ALLOW_SQLITE_FALLBACK=false
SEED_ON_STARTUP=true
SEED_PEOPLE_PATH=
ARTICLE_DISCOVERY_BROWSER_ENABLED=true
ARTICLE_DISCOVERY_MIN_IMAGE_DIMENSION=300
WEB_BASE_URL=https://SEU-WEB.up.railway.app
API_BASE_URL=https://SEU-API.up.railway.app
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
FACE_MATCH_THRESHOLD=0.94
FACE_DISPLAY_THRESHOLD=0.97
FACE_AUTO_APPROVE_THRESHOLD=0.995
```

Depois do primeiro boot com seed concluído, troque `SEED_ON_STARTUP=false` para evitar trabalho desnecessário a cada restart.

Variáveis sugeridas no serviço `web`:

```env
NEXT_PUBLIC_API_BASE_URL=https://SEU-API.up.railway.app/api/v1
API_BASE_URL=https://SEU-API.up.railway.app/api/v1
NEXT_PUBLIC_BOOTSTRAP_MIN_IMAGE_DIMENSION=300
```

Passos via Railway CLI, depois de `railway login` e `railway link`:

```bash
railway add --service api
railway add --service web
railway volume --service api add --mount-path /data
railway variable set DATABASE_URL=sqlite:////data/diga-me.sqlite3 --service api
railway variable set ALLOW_SQLITE_FALLBACK=false --service api
railway variable set SEED_ON_STARTUP=true --service api
railway variable set ARTICLE_DISCOVERY_BROWSER_ENABLED=true --service api
railway variable set NEXT_PUBLIC_API_BASE_URL=https://SEU-API.up.railway.app/api/v1 --service web
railway variable set API_BASE_URL=https://SEU-API.up.railway.app/api/v1 --service web
railway up ./apps/api --path-as-root --service api --detach
railway up ./apps/web --path-as-root --service web --detach
```

No deploy via CLI, cada serviço usa o próprio diretório como contexto e encontra o Dockerfile local:

- `api`: `apps/api/Dockerfile`
- `web`: `apps/web/Dockerfile`

Como alternativa, conecte os dois serviços ao repositório GitHub e defina o Dockerfile de cada serviço pelo dashboard. O serviço `api` deve ter apenas uma réplica quando estiver usando SQLite em volume.

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
5. Abra uma página da allowlist e valide a sidebar da extensão

## Endpoints principais da API

- `GET /api/v1/health`
- `POST /api/v1/extension/discover-article-images`
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
- Extensão V3 mínima com allowlist, análise remota, sidebar incremental de imagens, marcação de pessoa não identificada e sugestão manual.
- Bancada web aceita URL direta de imagem ou URL de matéria permitida; a API descobre imagens prováveis no artigo com heurísticas anti-logo e pode usar navegador renderizado quando configurado.
- Busca vetorial com PostgreSQL + pgvector, mantendo fallback local para testes com SQLite.

## Limitações atuais

- Pipeline usa detector/embedding determinístico por imagem, sem InsightFace real ainda.
- Embeddings faciais são persistidos em coluna `vector(128)` no PostgreSQL/pgvector e também em JSON para fallback de testes.
- Worker é modo demo inicial (sem fila/broker real).
- Renderização server-side de matérias com Chromium/Playwright fica desativada por padrão. Ative com `ARTICLE_DISCOVERY_BROWSER_ENABLED=true` e configure `ARTICLE_DISCOVERY_BROWSER_EXECUTABLE` quando o ambiente não tiver browser gerenciado pelo Playwright.
- O corte mínimo de dimensão para imagens de matéria é configurável por env: `ARTICLE_DISCOVERY_MIN_IMAGE_DIMENSION=300` na API e `NEXT_PUBLIC_BOOTSTRAP_MIN_IMAGE_DIMENSION=300` na bancada web.
