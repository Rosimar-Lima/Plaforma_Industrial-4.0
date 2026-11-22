# Guia de contribuição

Este documento define o fluxo de branches da **Plataforma Industrial 4.0**.
O objetivo é manter a `main` sempre publicável e permitir que mais de um
desenvolvedor trabalhe ao mesmo tempo sem sobrescrever o trabalho dos outros.

## Visão geral

```text
main     ──● v1.0.0────────────────────◀──● v1.1.0
           ▲                              ▲
           │                              │
develop  ──●──●──●──●──●──●──●──●──●──────┘
            ▲  ▲  ▲
            │  │  └── feature/gateway-ads-real
            │  └────── feature/producao-por-turno
            └───────── fix/modal-os
```

## Branches

| Branch | Finalidade |
| --- | --- |
| `main` | Versão publicável. Cada merge relevante gera uma tag/release. É a branch padrão do repositório. |
| `develop` | Integração da próxima versão. Todas as branches de trabalho voltam para ela. |
| `feature/*` | Nova funcionalidade. Nasce de `develop` e retorna para `develop`. |
| `fix/*` | Correção de bug. Nasce de `develop` e retorna para `develop`. |
| `release/*` | Estabilização da versão. Nasce de `develop`, vai para `main` e volta para `develop`. |
| `hotfix/*` | Correção urgente em produção. Nasce de `main`, vai para `main` e volta para `develop`. |

## Regras

1. **Nunca faça commit direto em `main` ou `develop`.** Use pull request.
2. Toda `feature/*` ou `fix/*` deve nascer de `develop`.
3. Antes de abrir o PR, atualize sua branch com `develop`.
4. A `main` só recebe mudanças vindas de `release/*` ou `hotfix/*`.
5. Ao publicar uma release, crie a tag na `main` seguindo `vMAJOR.MINOR.PATCH`.
6. Não apague branches após o merge sem antes conferir o histórico no GitHub.

## Convenção de nomes

Use nomes curtos, em minúsculas, com `-` entre as palavras:

```text
feature/gateway-ads-real
feature/producao-por-turno
fix/modal-os
docs/fluxo-git
release/v1.1.0
hotfix/v1.0.1
```

## Mensagens de commit

Escreva mensagens em português, no imperativo e sem ponto final:

```text
Adiciona leitura de runtime no adaptador ADS
Corrige conversão de BIGINT na API de manutenção
Documenta fluxo de branches
```

## Trabalhando em uma funcionalidade

No terminal do VS Code:

```powershell
git switch develop
git pull origin develop
git switch -c feature/gateway-ads-real
```

Faça seus commits e envie a branch:

```powershell
git add .
git commit -m "Adiciona leitura de runtime no adaptador ADS"
git push -u origin feature/gateway-ads-real
```

Abra um PR de `feature/gateway-ads-real` para `develop`.

Se a `develop` avançar enquanto você trabalha:

```powershell
git fetch origin
git rebase origin/develop
```

Se preferir não usar rebase:

```powershell
git fetch origin
git merge origin/develop
```

## Preparando uma release

Quando a `develop` estiver pronta e estável:

```powershell
git switch develop
git pull origin develop
git switch -c release/v1.1.0
git push -u origin release/v1.1.0
```

Nessa branch, aceite **somente correções**. Depois:

1. Abra PR de `release/v1.1.0` para `main`.
2. Após o merge na `main`, crie a tag `v1.1.0` e publique a release no GitHub.
3. Abra PR de `release/v1.1.0` para `develop` (ou faça o merge de volta) para
   levar as correções da estabilização para a próxima versão.

## Correção urgente

```powershell
git switch main
git pull origin main
git switch -c hotfix/v1.0.1
git push -u origin hotfix/v1.0.1
```

Depois:

1. PR de `hotfix/v1.0.1` para `main`.
2. Tag `v1.0.1` e release.
3. Merge de `hotfix/v1.0.1` de volta em `develop`.

## Versionamento

Siga Semantic Versioning a partir da `v1.0.0`:

| Tipo de mudança | Versão |
| --- | --- |
| Correção compatível | `v1.0.1` |
| Nova funcionalidade compatível | `v1.1.0` |
| Quebra de contrato da API/telemetria | `v2.0.0` |

A integração com o CLP real, por exemplo, é uma nova funcionalidade compatível:
`v1.1.0`.

## Proteção das branches no GitHub

Em **Settings → Branches**, proteja `main` e `develop`:

- exigir pull request antes do merge;
- bloquear push direto;
- exigir pelo menos 1 aprovação;
- exigir checks de CI quando estiverem disponíveis;
- não permitir exclusão.

A `main` deve continuar como branch padrão do repositório.

## Comandos úteis

```powershell
git status -sb
git branch -vv
git fetch origin --prune
git log --oneline --decorate --graph --all -20
```
