---
name: Bug report
about: Reportar um comportamento incorreto na plataforma
title: "[bug] "
labels: bug
assignees: ""
---

## Descrição

<!-- O que aconteceu e o que era esperado. -->

## Cenário de aceitação

<!-- Ex.: AT-04 (alerta de envase) ou "Parte A — smoke test". -->

## Passos para reproduzir

1.
2.
3.

## Resultado esperado

## Resultado observado

<!-- Inclua mensagens de erro e, se possível, o corpo da resposta da API. -->

## Ambiente

- Commit: <!-- git rev-parse --short HEAD -->
- Sistema operacional:
- Docker Compose:
- Node.js:
- Como está rodando: Docker Compose / `npm start` local / gateway

## Evidências

```text
# docker compose ps
# docker compose logs --tail 50 backend
```

<!-- Anexe capturas de tela do dashboard se o problema for visual. -->

## Checklist

- [ ] Reproduzi o problema com o ambiente recriado (`docker compose up -d --build`).
- [ ] Verifiquei se o problema já não foi reportado.
- [ ] Incluí logs ou evidências suficientes para investigação.
