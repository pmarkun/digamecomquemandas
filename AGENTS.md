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
