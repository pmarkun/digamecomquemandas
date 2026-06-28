# AGENTS.md

## Projeto

Este repositório implementa o **Diga-me / Quem Tá Na Foto?**: API, web admin/home e extensão para identificar figuras públicas em imagens de matérias jornalísticas.

## Ambiente

- Estamos no NixOS. Use `nix develop --command ...` para comandos de desenvolvimento, lint, testes, builds e servidores locais.
- Use `uv` para Python; não use `pip` diretamente.
- Use `pnpm` para apps web/extension.
- Não assuma que serviços locais em `3000` ou `8000` estão rodando com o código atual; verifique antes.

## Fluxo de Trabalho

- Leia o código existente antes de alterar arquitetura ou contratos.
- Preserve mudanças do usuário e não reverta arquivos sem pedido explícito.
- Faça mudanças pequenas e focadas.
- Use `apply_patch` para edições manuais.
- Não rode migrações destrutivas, deploy ou alterações de produção sem confirmação explícita.

## Servidores Locais

- Para desenvolvimento iterativo, prefira rodar API e web diretamente no host em modo dev, em vez de rebuildar imagens Docker.
- Use Docker/Compose apenas para dependências locais como Postgres e Redis, salvo quando a tarefa for validar especificamente o build/container.
- Se `localhost:3000` ou `localhost:8000` estiverem ocupados por containers antigos, pare somente `api` e `web` antes de subir os servidores dev.

Comandos usuais:

```bash
docker compose -f infra/docker/docker-compose.yml stop api web
nix develop --command bash -lc 'cd apps/api && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000'
nix develop --command env NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 API_BASE_URL=http://localhost:8000/api/v1 pnpm dev -H 0.0.0.0 -p 3000
```

## Validação

Antes de finalizar mudanças de código relevantes, rode o que couber:

```bash
nix develop --command make lint
nix develop --command make test
nix develop --command pnpm --filter ./apps/web build
nix develop --command pnpm --filter ./apps/extension build
```

Se algum comando não puder ser executado, informe o comando, o erro e o risco restante.

## Captura de Matérias e Imagens

- O detector principal deve continuar sendo `face-api.js` no cliente/browser/offscreen; o backend não deve introduzir um segundo stack de detecção facial.
- Quando o cliente já envia bbox + embedding, o backend não deve baixar/processar a imagem para detectar faces.
- Regras por portal devem ser plugáveis e extensíveis: evite heurísticas globais frágeis quando houver seletor específico por domínio.
- Para coletores de portais, valide com amostras reais de links e registre warnings quando cair em fallback.
- Não exponha scores técnicos ou debug fora de superfícies explicitamente marcadas como debug/admin.

## Git

- Faça commits atômicos quando o usuário pedir para finalizar ou quando a mudança ficar consistente e validada.
- Não faça push sem pedido explícito.
- Antes de commit, confira `git status --short` e `git diff --check`.
