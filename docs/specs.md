# Especificação MVP — “Quem Tá Na Foto?”

## 1. Visão geral

Criar uma extensão de Chrome que identifica, em portais de notícia previamente autorizados, possíveis figuras públicas presentes em imagens jornalísticas. A extensão detecta imagens na página, envia para um backend, roda detecção facial + comparação vetorial contra uma base curada de figuras públicas e devolve ao usuário uma interface discreta com os possíveis nomes encontrados.

O sistema também mantém uma wiki pública para cada pessoa identificada, com informações colaborativas, histórico de aparições em matérias, conexões com outras figuras públicas e mecanismo de contestação/opt-out.

O objetivo do MVP não é identificar qualquer pessoa na internet. O objetivo é construir uma ferramenta cívica/jornalística para análise de presença pública em imagens de notícias.

---

## 2. Princípios do MVP

1. Só operar em domínios explicitamente permitidos.
2. Só comparar contra uma base curada de figuras públicas.
3. Não tentar identificar pessoas comuns.
4. Sempre apresentar resultados como “possível identificação”.
5. Exigir score mínimo alto para exibição.
6. Registrar auditoria de decisões, edições e pedidos de remoção.
7. Permitir contestação e opt-out desde o início.
8. Separar dados biométricos/embeddings de dados públicos editoriais.
9. Guardar apenas o necessário: URL, hash da imagem, metadados e embeddings.
10. Preferir revisão humana para inclusão de novas pessoas.

---

## 3. Escopo do MVP

### Incluído

* Extensão Chrome Manifest V3.
* Lista fixa de domínios jornalísticos.
* Detecção de imagens em páginas de notícia.
* Envio das imagens ao backend.
* Detecção de faces.
* Geração de embeddings faciais.
* Comparação com banco vetorial.
* Overlay com possíveis identificações.
* Página pública de pessoa.
* Página pública de matéria/imagem.
* Grafo simples de coaparições.
* Admin básico para pessoas, imagens, matches e pedidos.
* Seed inicial manual com figuras públicas.
* Processo manual de opt-out.
* Docker Compose para rodar local.

### Fora do MVP

* Crawling automático da web.
* Identificação em redes sociais.
* Reconhecimento de pessoas que não estejam na base.
* Cadastro público irrestrito de novas pessoas.
* Moderação complexa estilo Wikipedia.
* Automação completa de verificação de identidade.
* App mobile.
* Busca reversa por imagem.
* Treinamento próprio de modelo facial.

---

## 4. Stack sugerida

### Monorepo

Usar monorepo com:

```txt
apps/
  extension/
  web/
  api/
  worker/
packages/
  shared/
infra/
  docker/
  migrations/
  seed/
```

### Frontend web

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui
* TanStack Query

### Extensão Chrome

* Manifest V3
* TypeScript
* Vite
* Content script
* Background service worker
* Popup simples
* Armazenamento local via chrome.storage

### Backend API

* Python
* FastAPI
* SQLAlchemy ou SQLModel
* Pydantic
* Uvicorn

### Worker de IA

* Python
* InsightFace para detecção/embedding facial
* ONNX Runtime, preferencialmente CPU no MVP
* Pillow/OpenCV para manipulação de imagem

### Banco

* PostgreSQL
* pgvector
* Redis opcional para fila/cache
* MinIO opcional para armazenamento local de imagens, mas no MVP pode evitar salvar imagem inteira

### Infra local

* Docker Compose
* Postgres + pgvector
* API
* Worker
* Web
* Extension em modo dev

---

## 5. Justificativa técnica

Chrome Extension Manifest V3 usa content scripts para interagir com páginas visitadas e service worker no lugar de background pages persistentes. A extensão deve usar content script para descobrir imagens e injetar overlay, e service worker para coordenar chamadas ao backend.

PostgreSQL com pgvector permite guardar embeddings e fazer busca por similaridade no mesmo banco relacional, simplificando o MVP.

FastAPI é adequado para API rápida, tipada e com tarefas assíncronas simples. Para processamento pesado, usar worker separado.

InsightFace é uma opção open source madura para detecção, alinhamento e reconhecimento facial.

---

## 6. Fluxo principal

### 6.1 Usuário abre uma matéria

1. Content script verifica se o domínio está na allowlist.
2. Aguarda carregamento da página.
3. Coleta imagens candidatas:

   * `<img>`
   * `picture/source`
   * imagens OpenGraph se disponíveis
   * imagens acima de tamanho mínimo
4. Ignora:

   * logos
   * sprites
   * ícones
   * imagens muito pequenas
   * anúncios
   * SVGs
5. Para cada imagem candidata:

   * extrai URL absoluta
   * calcula dimensões
   * cria um identificador local
   * envia para backend: URL da página, URL da imagem, domínio, título da página.

### 6.2 Backend processa imagem

1. Recebe requisição.
2. Valida domínio permitido.
3. Baixa imagem no servidor.
4. Calcula hash perceptual e hash criptográfico.
5. Verifica se imagem já foi processada.
6. Detecta faces.
7. Para cada face:

   * gera embedding
   * consulta pgvector
   * retorna candidatos acima do threshold.
8. Persiste evento de aparição.
9. Retorna matches para extensão.

### 6.3 Extensão mostra resultado

1. Content script recebe matches.
2. Desenha marcador discreto sobre a imagem.
3. Ao clicar:

   * mostra card com nomes possíveis
   * score
   * link para perfil
   * link para matéria no sistema
   * aviso: “identificação automatizada sujeita a erro”.

---

## 7. UX da extensão

### Estado inicial

Ícone da extensão no Chrome.

Popup:

```txt
Quem Tá Na Foto?
Status: ativo neste site

Imagens analisadas: 4
Faces encontradas: 7
Possíveis figuras públicas: 3

[Ver resultados]
[Desativar neste site]
```

### Overlay na página

Sobre imagens com matches:

```txt
3 possíveis figuras públicas
```

Ao expandir:

```txt
Possíveis identificações

Marina Silva
score: 0.91
[ver perfil]

Geraldo Alckmin
score: 0.88
[ver perfil]

Identificação automatizada. Pode conter erros.
```

### Visual

Direção de arte: “jornalismo investigativo, não startup fofinha”.

Referências conceituais:

* dossiê público
* marginalia de jornal
* ficha catalográfica
* mapa de relações
* arquivo civil
* transparência institucional

Paleta:

```txt
Fundo principal: #F7F2E8
Texto: #191919
Bordas: #2B2B2B
Destaque: #D94A38
Secundário: #275DAD
Alerta: #E6B800
Neutro: #D8D0C2
```

Tipografia:

* Títulos: serifada editorial, exemplo: Georgia ou Libre Baskerville.
* Interface: sans legível, exemplo: Inter.
* Dados/tabelas: mono, exemplo: IBM Plex Mono.

Estilo:

* bordas finas
* cards secos
* poucos efeitos
* microinterações discretas
* nada de mascote
* nada de “IA mágica”
* linguagem sóbria

Tom de texto:

* “possível identificação”
* “aparição registrada”
* “fonte pública”
* “pedido de contestação”
* “informações indisponíveis por solicitação da pessoa”

Evitar:

* “flagrado”
* “descoberto”
* “exposto”
* “revelado”
* “essa pessoa mentiu”
* “não quer aparecer”

---

## 8. Páginas web

### 8.1 Home

Conteúdo:

* O que é o projeto.
* Como funciona.
* Limites e riscos.
* Política de figuras públicas.
* Link para busca.
* Link para contestação.

### 8.2 Perfil de pessoa

Rota:

```txt
/pessoa/[slug]
```

Campos:

* Nome público
* Foto de referência, opcional
* Cargo/ocupação
* Categoria
* Links públicos
* Status do perfil
* Aviso de identificação automatizada
* Aparições recentes
* Pessoas que mais aparecem junto
* Gráfico temporal
* Histórico de edições
* Botão “contestar este perfil”

Estados possíveis:

```txt
ACTIVE
UNDER_REVIEW
OPTOUT_LIMITED
REMOVED
```

Se opt-out:

```txt
As informações públicas agregadas deste perfil estão indisponíveis por solicitação da pessoa interessada ou representante autorizado. Mantemos apenas o registro mínimo necessário para evitar novas publicações automáticas e preservar auditoria do pedido.
```

### 8.3 Página de matéria

Rota:

```txt
/materia/[id]
```

Campos:

* URL original
* Veículo
* Título
* Data de captura
* Imagens processadas
* Pessoas possivelmente identificadas
* Scores
* Status dos matches
* Link para contestação

### 8.4 Página de coaparição

Rota:

```txt
/pessoa/[slug]/conexoes
```

Mostrar:

* Lista de pessoas que aparecem junto
* Número de matérias
* Última aparição conjunta
* Links para matérias
* Score agregado simples

### 8.5 Admin

Rota:

```txt
/admin
```

Funcionalidades:

* Login simples via usuário/senha no MVP
* CRUD de pessoas
* Upload/adicionar imagens de referência
* Recalcular embeddings
* Revisar matches
* Aprovar/rejeitar matches
* Ver pedidos de contestação
* Marcar opt-out
* Editar allowlist de domínios

---

## 9. Modelo de dados

### people

```sql
id uuid primary key
slug text unique not null
name text not null
display_name text not null
category text not null
description text
public_office text
source_urls text[]
status text not null default 'ACTIVE'
is_public_figure boolean not null default true
created_at timestamptz not null
updated_at timestamptz not null
```

### person_reference_images

```sql
id uuid primary key
person_id uuid references people(id)
source_url text
storage_path text
sha256 text
phash text
status text not null default 'ACTIVE'
created_at timestamptz not null
```

### face_embeddings

```sql
id uuid primary key
person_id uuid references people(id)
reference_image_id uuid references person_reference_images(id)
embedding vector(128)
model_name text not null
model_version text not null
quality_score float
created_at timestamptz not null
```

### articles

```sql
id uuid primary key
url text unique not null
canonical_url text
domain text not null
title text
published_at timestamptz
captured_at timestamptz not null
created_at timestamptz not null
```

### article_images

```sql
id uuid primary key
article_id uuid references articles(id)
image_url text not null
sha256 text
phash text
width int
height int
status text not null default 'PENDING'
created_at timestamptz not null
```

### detected_faces

```sql
id uuid primary key
article_image_id uuid references article_images(id)
bbox jsonb not null
embedding vector(128)
quality_score float
model_name text not null
model_version text not null
created_at timestamptz not null
```

### face_matches

```sql
id uuid primary key
detected_face_id uuid references detected_faces(id)
person_id uuid references people(id)
score float not null
distance float
status text not null default 'AUTO'
reviewed_by uuid
reviewed_at timestamptz
created_at timestamptz not null
```

Statuses:

```txt
AUTO
APPROVED
REJECTED
CONTESTED
HIDDEN_OPTOUT
```

### profile_edits

```sql
id uuid primary key
person_id uuid references people(id)
editor_name text
editor_email text
body jsonb not null
status text not null default 'PENDING'
created_at timestamptz not null
```

### optout_requests

```sql
id uuid primary key
person_id uuid references people(id)
requester_name text not null
requester_email text not null
relationship text
message text
verification_status text not null default 'PENDING'
decision text
decided_by uuid
decided_at timestamptz
created_at timestamptz not null
```

### audit_logs

```sql
id uuid primary key
actor_type text not null
actor_id text
action text not null
entity_type text not null
entity_id uuid
metadata jsonb
created_at timestamptz not null
```

### allowed_domains

```sql
id uuid primary key
domain text unique not null
enabled boolean not null default true
created_at timestamptz not null
```

---

## 10. API

Base:

```txt
/api/v1
```

### Health

```http
GET /health
```

Resposta:

```json
{
  "ok": true
}
```

### Processar página

```http
POST /extension/analyze-page
```

Request:

```json
{
  "page_url": "https://...",
  "title": "Título da matéria",
  "images": [
    {
      "image_url": "https://...",
      "width": 1200,
      "height": 800
    }
  ]
}
```

Response:

```json
{
  "article_id": "uuid",
  "results": [
    {
      "image_url": "https://...",
      "image_id": "uuid",
      "faces": [
        {
          "face_id": "uuid",
          "bbox": {
            "x": 100,
            "y": 50,
            "w": 200,
            "h": 200
          },
          "matches": [
            {
              "person_id": "uuid",
              "name": "Nome",
              "slug": "nome",
              "score": 0.91,
              "profile_url": "http://localhost:3000/pessoa/nome"
            }
          ]
        }
      ]
    }
  ],
  "warnings": [
    "Identificações automatizadas podem conter erros."
  ]
}
```

### Buscar pessoa

```http
GET /people?query=nome
```

### Perfil público

```http
GET /people/{slug}
```

### Aparições de pessoa

```http
GET /people/{slug}/appearances
```

### Conexões

```http
GET /people/{slug}/connections
```

### Criar pedido de contestação

```http
POST /people/{slug}/contest
```

Request:

```json
{
  "requester_name": "Nome",
  "requester_email": "email@example.com",
  "relationship": "self",
  "message": "Solicito revisão..."
}
```

### Admin: criar pessoa

```http
POST /admin/people
```

### Admin: adicionar referência

```http
POST /admin/people/{person_id}/reference-images
```

### Admin: revisar match

```http
POST /admin/matches/{match_id}/review
```

Request:

```json
{
  "status": "APPROVED"
}
```

### Admin: aplicar opt-out

```http
POST /admin/people/{person_id}/optout
```

---

## 11. Matching facial

### Modelo

MVP:

```txt
InsightFace / buffalo_l
embedding_dim = 512
```

### Thresholds iniciais

Configurar em variável de ambiente:

```env
FACE_MATCH_THRESHOLD=0.82
FACE_DISPLAY_THRESHOLD=0.86
FACE_AUTO_APPROVE_THRESHOLD=0.92
MAX_MATCHES_PER_FACE=3
```

Regras:

* Abaixo de `FACE_MATCH_THRESHOLD`: descartar.
* Entre match e display: guardar internamente, não exibir.
* Acima de display: exibir como possível identificação.
* Acima de auto-approve: ainda exibir como possível, mas marcar como alta confiança.
* Nunca mostrar mais de 3 candidatos por face.

### Qualidade mínima

Não processar face se:

* bounding box muito pequena;
* rosto muito virado;
* baixa nitidez;
* óculos/máscara prejudicando muito;
* qualidade abaixo do threshold.

---

## 12. Segurança e privacidade

### Regras obrigatórias

* Não permitir upload público irrestrito no MVP.
* Admin protegido por autenticação.
* CORS restrito à extensão e frontend.
* Rate limit na API.
* Logs sem imagem bruta.
* Não guardar imagem original por padrão.
* Guardar hash e URL.
* Embeddings devem ser tratados como dado sensível.
* Tabelas com embeddings devem ficar isoladas logicamente.
* Auditoria para ações administrativas.
* Botão de contestação visível.

### Texto padrão de aviso

```txt
Esta plataforma usa reconhecimento facial automatizado para comparar imagens jornalísticas com uma base curada de figuras públicas. O resultado pode conter erros e não deve ser tratado como confirmação absoluta de identidade.
```

---

## 13. Allowlist inicial de domínios

```txt
g1.globo.com
oglobo.globo.com
www1.folha.uol.com.br
www.estadao.com.br
noticias.uol.com.br
www.cnnbrasil.com.br
www.metropoles.com
www.poder360.com.br
www.cartacapital.com.br
www.brasildefato.com.br
```

A allowlist deve ficar no banco e também ter fallback no código da extensão.

---

## 14. Seed inicial

Criar script:

```bash
pnpm seed
```

ou

```bash
make seed
```

Seed deve criar:

* domínios permitidos;
* 10 pessoas públicas de exemplo;
* imagens de referência por URL;
* embeddings calculados;
* usuário admin local.

Para o MVP, as imagens de referência podem ser URLs públicas configuradas manualmente em `infra/seed/people.json`.

Formato:

```json
[
  {
    "name": "Pessoa Exemplo",
    "slug": "pessoa-exemplo",
    "category": "politician",
    "description": "Descrição pública curta.",
    "source_urls": ["https://..."],
    "reference_images": ["https://..."]
  }
]
```

---

## 15. Estrutura de diretórios

```txt
quem-ta-na-foto/
  README.md
  docker-compose.yml
  .env.example
  Makefile

  apps/
    extension/
      manifest.json
      src/
        content.ts
        background.ts
        popup/
        overlay/
        api.ts
      package.json
      vite.config.ts

    web/
      app/
        page.tsx
        pessoa/[slug]/page.tsx
        materia/[id]/page.tsx
        admin/page.tsx
      components/
      lib/
      package.json

    api/
      app/
        main.py
        config.py
        db.py
        models.py
        schemas.py
        routes/
          extension.py
          people.py
          admin.py
          health.py
        services/
          image_fetcher.py
          face_detector.py
          matcher.py
          privacy.py
          audit.py
      pyproject.toml

    worker/
      app/
        worker.py
        jobs.py
        face_pipeline.py
      pyproject.toml

  packages/
    shared/
      types.ts

  infra/
    migrations/
    seed/
      people.json
      seed.py
```

---

## 16. Comandos esperados

```bash
make setup
make dev
make migrate
make seed
make test
make lint
```

`make dev` deve subir:

* Postgres com pgvector
* API em `localhost:8000`
* Web em `localhost:3000`
* Worker
* Instrução para carregar extensão em `chrome://extensions`

---

## 17. Variáveis de ambiente

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/qtnf
REDIS_URL=redis://localhost:6379/0

API_BASE_URL=http://localhost:8000
WEB_BASE_URL=http://localhost:3000

ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin

FACE_MODEL_NAME=buffalo_l
FACE_MATCH_THRESHOLD=0.82
FACE_DISPLAY_THRESHOLD=0.86
FACE_AUTO_APPROVE_THRESHOLD=0.92
MAX_MATCHES_PER_FACE=3

STORE_ORIGINAL_IMAGES=false
ALLOWED_EXTENSION_ORIGIN=chrome-extension://*
```

---

## 18. Critérios de aceite

### Extensão

* Ao abrir página de domínio permitido, detectar imagens relevantes.
* Enviar imagens para backend.
* Mostrar overlay apenas quando houver matches.
* Popup mostra contagem de imagens/faces/matches.
* Usuário consegue desativar extensão no domínio atual.

### Backend

* API sobe com `/health`.
* Processa imagem por URL.
* Detecta faces.
* Gera embeddings.
* Compara com pgvector.
* Persiste artigos, imagens, faces e matches.
* Não duplica processamento de imagem já conhecida.

### Web

* Home funciona.
* Perfil de pessoa funciona.
* Página de matéria funciona.
* Página de conexões funciona.
* Formulário de contestação funciona.
* Admin lista pessoas, matches e opt-outs.

### Dados

* Seed cria pelo menos 10 pessoas.
* Cada pessoa tem pelo menos 2 imagens de referência.
* Embeddings são gerados no seed.
* Busca vetorial retorna candidatos.

### Segurança

* Admin exige login.
* Domínio fora da allowlist é recusado.
* Matches abaixo do threshold não são exibidos.
* Opt-out muda perfil para modo limitado.
* Auditoria registra ações administrativas.

---

## 19. Ordem de implementação sugerida para o agente

1. Criar monorepo e Docker Compose.
2. Criar banco, modelos e migrations.
3. Criar API FastAPI básica.
4. Integrar pgvector.
5. Criar pipeline de imagem e face embedding.
6. Criar seed de pessoas.
7. Criar endpoint `/extension/analyze-page`.
8. Criar web Next.js com páginas públicas.
9. Criar admin simples.
10. Criar extensão Chrome.
11. Integrar extensão com API.
12. Polir overlay e popup.
13. Adicionar opt-out.
14. Adicionar testes básicos.
15. Escrever README completo.

---

## 20. README mínimo esperado

O README deve conter:

* O que é o projeto.
* Aviso ético/jurídico.
* Como rodar localmente.
* Como carregar extensão no Chrome.
* Como criar seed.
* Como adicionar pessoa pública.
* Como revisar match.
* Como aplicar opt-out.
* Limitações conhecidas.
* Próximos passos.

---

## 21. Limitações conhecidas

* Reconhecimento facial erra.
* Fotos ruins geram falso negativo.
* Pessoas parecidas geram falso positivo.
* Mudança de idade, barba, óculos e ângulo afetam score.
* Base inicial pequena pode distorcer resultados.
* Notícias usam fotos antigas ou bancos de imagem.
* Uma imagem pode estar replicada em várias matérias.
* Opt-out precisa de processo humano confiável.
* O MVP não resolve toda a camada jurídica.

---

## 22. Próximos passos pós-MVP

* Revisão jurídica/LGPD.
* Relatório de impacto de proteção de dados.
* Moderação colaborativa real.
* Plugin Firefox.
* API pública limitada.
* Dashboard de redes de coaparição.
* Exportação CSV.
* Integração com Wikidata.
* Classificação de contexto da matéria.
* Verificação manual de matches relevantes.
* Diferenciação entre foto de arquivo e foto do evento.
* Sistema de reputação de editores.
* Versionamento público das páginas.
* Modo pesquisa acadêmica.

---

## 23. Prompt final para o Codex

Construa este MVP como um monorepo funcional chamado `quem-ta-na-foto`, seguindo a especificação acima. Priorize funcionamento local com Docker Compose, código limpo, tipagem, README completo e fluxo ponta a ponta: seed de pessoas públicas, processamento de imagem, matching facial, extensão Chrome exibindo overlay e site web com perfis/matérias/admin.

Não implemente features fora do escopo. Quando houver ambiguidade, escolha a opção mais simples, auditável e segura. O resultado deve rodar localmente com `make setup`, `make dev`, `make migrate` e `make seed`.


## Adendo — Nome, moldura narrativa e sugestões manuais

### Nome do projeto

**Diga-me com quem tu andas e direi quem tu és**

Nome curto interno:

```txt
Diga-me
```

Slug/repositório:

```txt
diga-me
```

### Moldura narrativa

A frase “diga-me com quem andas e eu te direi quem tu és” não aparece literalmente na Bíblia, mas é frequentemente associada à tradição cristã e inspirada por passagens como **1 Coríntios 15:33** — “as más companhias corrompem os bons costumes” — e **Provérbios 13:20** — “quem anda com os sábios será sábio”. Essa origem popular-religiosa permite uma camada irônica e política: usar uma máxima moral conservadora para iluminar relações públicas de poder, influência e convivência registradas pela própria imprensa.

### Sugestão manual de identificação

A extensão deve permitir que o usuário clique em uma face detectada, mesmo quando não houver match acima do threshold.

Fluxo:

1. Backend detecta todas as faces viáveis na imagem.
2. Extensão desenha marcação sutil também em faces sem identificação.
3. Ao clicar em uma face não identificada, abrir card:

```txt
Pessoa não identificada

Você acha que sabe quem é?
[ Sugerir identificação ]
```

4. Formulário:

```txt
Nome sugerido
Link de fonte pública, se houver
Comentário opcional
Seu e-mail, opcional
```

5. A sugestão entra como `PENDING_REVIEW`.
6. Nada é exibido publicamente até aprovação manual.
7. Admin pode:

   * aprovar sugestão como match;
   * rejeitar;
   * associar a pessoa existente;
   * criar nova pessoa pública;
   * usar como referência futura, apenas após curadoria.

### Nova tabela: face_suggestions

```sql
id uuid primary key
detected_face_id uuid references detected_faces(id)
suggested_name text not null
suggested_person_id uuid references people(id)
source_url text
comment text
submitter_email text
status text not null default 'PENDING_REVIEW'
reviewed_by uuid
reviewed_at timestamptz
created_at timestamptz not null
```

Statuses:

```txt
PENDING_REVIEW
APPROVED
REJECTED
MERGED
NEEDS_MORE_INFO
```

### Regra importante

Sugestões de usuários **não são fonte de verdade**. Elas são apenas insumos de curadoria e melhoria da base. Nenhuma sugestão deve alterar perfil público, match ou embedding sem revisão manual.

### Critérios de aceite adicionais

* Faces sem match aparecem como “pessoa não identificada”.
* Usuário consegue sugerir uma identificação.
* Sugestão aparece no admin.
* Admin consegue aprovar/rejeitar.
* Aprovação gera match revisado manualmente.
* Sugestão rejeitada não aparece publicamente.
* Toda sugestão gera entrada em audit log.
