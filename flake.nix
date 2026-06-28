{
  description = "Monorepo diga-me (Quem Tá Na Foto?)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    nixpkgs,
    flake-utils,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {
        inherit system;
      };
      cacheBase = ".diga-me-cache";
    in {
      devShells.default = pkgs.mkShell {
        name = "diga-me-dev";
        packages = with pkgs; [
          bash
          cacert
          chromium
          coreutils
          docker
          docker-compose
          git
          gnumake
          nodejs_22
          openssl
          openssl.dev
          pnpm
          python313
          uv
        ];

        shellHook = ''
          export DIGA_ME_REPO_ROOT="$PWD"
          export UV_CACHE_DIR="$DIGA_ME_REPO_ROOT/${cacheBase}/uv"
          export PNPM_HOME="$DIGA_ME_REPO_ROOT/${cacheBase}/pnpm"
          export PNPM_STORE_DIR="$DIGA_ME_REPO_ROOT/${cacheBase}/pnpm/store"
          export XDG_DATA_HOME="$DIGA_ME_REPO_ROOT/${cacheBase}/xdg"
          export ARTICLE_DISCOVERY_BROWSER_EXECUTABLE="''${ARTICLE_DISCOVERY_BROWSER_EXECUTABLE:-${pkgs.chromium}/bin/chromium}"
          mkdir -p "$UV_CACHE_DIR" "$PNPM_HOME" "$PNPM_STORE_DIR" "$XDG_DATA_HOME"

          if [ ! -f .env ] && [ -f .env.example ]; then
            cp .env.example .env
            echo "[diga-me] .env criado automaticamente em $(pwd)/.env"
          fi

          echo "diga-me (Quem Tá Na Foto?)"
          echo "Comandos esperados: make setup | make dev | make migrate | make seed | make test | make lint"
          echo "Use: nix run .#init para preparar dependências e bootstrap"
          echo "Ou: make setup"
        '';
      };

      packages.init = pkgs.writeShellApplication {
        name = "diga-me-init";
        runtimeInputs = [pkgs.gnumake pkgs.python313 pkgs.uv pkgs.pnpm];
        text = ''
          set -eu
          make setup
        '';
      };

      apps.init = flake-utils.lib.mkApp {
        drv = pkgs.writeShellScriptBin "diga-me-init" ''
          exec ${pkgs.gnumake}/bin/make setup
        '';
      };

      checks = {
        smokeSpecChecks = pkgs.stdenv.mkDerivation {
          name = "diga-me-smoke-spec-checks";
          src = ./.;
          nativeBuildInputs = [ pkgs.python313 ];
          buildPhase = ''
            python3 scripts/smoke_spec_checks.py
          '';
          installPhase = ''
            mkdir -p "$out"
          '';
        };
      };
    });
}
