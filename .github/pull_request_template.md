## O que muda
<!-- Resumo da mudança e o porquê. Referencie a issue: "Fecha #123". -->

## Tipo
- [ ] Correção de bug
- [ ] Nova funcionalidade
- [ ] Documentação
- [ ] Refatoração / manutenção

## Como testei
<!-- Passos, ambiente (docker compose / local), saída de pytest, ruff, mypy e tsc. -->

## Capturas
<!-- Se mexeu na interface, antes/depois — só com documentos e dados fictícios. -->

## Checklist
- [ ] Regra nova de domínio materializada no banco (`backend/app/sql/`) com invariante nomeada e teste RED-TEAM
- [ ] Migração nova (nenhuma migração publicada foi editada) e revisão Alembic correspondente
- [ ] `pytest`, `ruff`, `mypy --strict` e `npm run typecheck` limpos
- [ ] Sem segredos, `.env`, dumps ou documentos reais no commit
- [ ] Textos da interface em pt-BR
