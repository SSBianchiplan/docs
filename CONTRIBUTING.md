# Como contribuir com o GPlanSiS|DOCS

Obrigado pelo interesse! Este guia explica como propor mudanças de forma que a revisão seja rápida.

## Antes de começar
- Leia o [código de conduta](CODE_OF_CONDUCT.md).
- Para mudanças maiores que uma correção pontual, **abra uma issue primeiro** (modelos "Ideia" ou "Bug") e combine a abordagem.
- Falhas de segurança **não** vão em issue pública: siga a [política de segurança](SECURITY.md).

## Ambiente de desenvolvimento
```bash
cp .env.example .env
docker compose up -d --build                     # stack completa em http://localhost:8080
```
Para iterar mais rápido: suba só `db`, `redis` e `gotenberg` pelo Compose, rode o backend com `uvicorn app.main:app --reload` e o frontend com `npm run dev` (proxy `/api` → `:8000`). Detalhes no [README](README.md#desenvolvimento).

## Organização do código
- `backend/app/sql/` — DDL com as invariantes (`INV-*`). **É a fonte da verdade do domínio.**
- `backend/alembic/versions/` — uma revisão por arquivo SQL novo.
- `backend/app/api/` — rotas FastAPI; validação de formato e permissão por projeto (`services/access.py`).
- `backend/app/services/ocr/` — pipeline e motores de OCR (plugáveis).
- `backend/app/worker.py` — tarefas assíncronas (OCR, verificação de comentários, entrega de eventos).
- `frontend/src/` — páginas React, componentes e cliente da API.

## Regras do projeto
- **Interface em português do Brasil**, textos curtos e diretos.
- **Regra de domínio vai para o banco**: toda invariante nova ganha um ID (`INV-ÁREA-NNN`), entra numa migração nova e recebe um teste em `tests/test_invariants_redteam.py` que tenta violá-la direto no banco.
- **Nunca edite uma migração já publicada**: crie a próxima (`app/sql/00NN_*.sql` + revisão Alembic).
- **IA propõe, humano decide**: nenhuma sugestão de IA altera dados sem aprovação explícita.
- **Somente dados fictícios**: nunca inclua documentos reais, dados de clientes, pessoas ou empresas, `.env`, dumps ou blobs em commits, issues ou capturas.

## Testes antes do PR
```bash
cd backend && pytest && ruff check . && mypy app
cd frontend && npm run typecheck && npm run build
```

## Pull requests
1. Faça um fork e crie uma branch a partir de `main` (`feat/…`, `fix/…`, `docs/…`).
2. Commits pequenos, com mensagem no imperativo explicando o porquê.
3. Preencha o modelo do PR: o que mudou, como testou, capturas se mexer na interface.

## Dúvidas
Abra uma issue com o modelo "Pergunta" ou escreva para contato@gplansis.com.
