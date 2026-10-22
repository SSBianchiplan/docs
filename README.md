<p align="center">
  <a href="https://docs.gplansis.com"><img src=".github/capa.png" alt="GPlanSiS|DOCS — toda revisão rastreada, toda emissão com prova" width="100%"></a>
</p>

<h1 align="center">GPlanSiS|DOCS</h1>

<p align="center">
  <strong>EDMS de documentos técnicos de engenharia: lista mestra codificada, revisões com máquina de estados, workflow de verificação e aprovação, comentários na folha, GRD numerada, retorno do cliente e OCR com busca por conteúdo.</strong><br>
  A IA propõe; o humano decide — e o banco garante.
</p>

<p align="center">
  <a href="https://docs.gplansis.com"><img alt="No ar" src="https://img.shields.io/badge/no%20ar-docs.gplansis.com-40b4ba?style=flat-square"></a>
  <img alt="Versão" src="https://img.shields.io/badge/vers%C3%A3o-0.1.0-151d25?style=flat-square">
  <a href="LICENSE"><img alt="licença MIT" src="https://img.shields.io/badge/licen%C3%A7a-MIT-2ea44f?style=flat-square"></a>
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-Python%203.12-151d25?style=flat-square&logo=fastapi&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL%2016-pgvector-151d25?style=flat-square&logo=postgresql&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React%2019-TypeScript-151d25?style=flat-square&logo=react&logoColor=white">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-instal%C3%A1vel-151d25?style=flat-square">
  <a href="CONTRIBUTING.md"><img alt="Contribuições bem-vindas" src="https://img.shields.io/badge/contribui%C3%A7%C3%B5es-bem--vindas-217a45?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://docs.gplansis.com"><b>➜ Abrir o GPlanSiS|DOCS em docs.gplansis.com</b></a>
</p>

---

## O que é

O **GPlanSiS|DOCS** gerencia o ciclo de vida de documentos técnicos de engenharia — para EPC, *owner* ou fornecedor: da lista mestra codificada à emissão para construção, com revisões controladas, aprovação interna, guia de remessa (GRD), retorno do cliente e trilha de auditoria à prova de adulteração.

O diferencial é onde as regras moram: **as invariantes de negócio estão no PostgreSQL** (31 regras nomeadas, `INV-*`, materializadas em restrições e *triggers*), não só na interface. Uma revisão emitida sem PDF, um arquivo trocado depois da verificação ou uma sugestão de IA aplicada sem clique humano são recusados pelo banco — e há testes *red-team* que tentam violá-las diretamente.

A especificação está em [`docs/SPEC-GPS-DOCS-001.md`](docs/SPEC-GPS-DOCS-001.md).

## Funcionalidades

### Documentos e revisões
- **Lista mestra** com código gerado pela **máscara de codificação do projeto** (`{PROJ}-{AREA}-{DISC}-{TIPO}-{SEQ:4}`, com prévia ao vivo), filtros por disciplina, tipo, situação e atrasados, e exportação CSV.
- **Revisões com máquina de estados**: em elaboração → em verificação → aprovada interna → emitida → retorno do cliente (A/B/C/D) → nova revisão; rótulos automáticos (A, B, C… ou 0, 1, 2…) e uma única revisão vigente.
- **Check-out / check-in**, arquivos por papel (PDF, nativo, anexo) identificados por **SHA-256**, conversão Office → PDF (Gotenberg) e trava de arquivos fora de elaboração.
- **Comentários marcados na folha** (área no visualizador PDF.js), por categoria (geral, técnico, editorial, obrigatório), com tratamento registrado — comentário obrigatório aberto bloqueia a aprovação da revisão seguinte.

### Fluxo e emissão
- **Workflow de verificação e aprovação** por etapas com responsável, perfil exigido e SLA; fluxo padrão ou próprio por projeto; segregação autor ≠ aprovador; caixa de **Pendências**.
- **GRD numerada** por projeto (finalidades PI, PA, PC, CE, CA), emissão, registro de recebimento e cancelamento.
- **Retorno do cliente** (aprovado, aprovado com comentários, reprovado) gravado na revisão.

### Projetos
- **Assistente em 6 etapas**: identificação e prazos → máscara de codificação → áreas e disciplinas → fluxo de aprovação → equipe → revisão.
- **Página do projeto** com **curva S** (planejado pela data prevista × realizado pela 1ª emissão em GRD), avanço por disciplina, atrasados, equipe, estrutura, fluxos, **importação de lista por CSV** (tudo ou nada) e arquivamento.

### OCR e busca
- **Pipeline de OCR**: normaliza para PDF → detecta camada de texto por página → OCR só onde falta, com correção de inclinação e orientação, CLAHE e detecção de desenho técnico → pranchas grandes fatiadas com sobreposição → **PDF/A pesquisável** (OCRmyPDF) → miniatura → **leitura do carimbo** (PT/EN).
- **Busca** por código, título e conteúdo: texto completo, trigramas, **fonética** e, opcionalmente, **semântica** (pgvector + embeddings).
- Motor plugável: **Tesseract** por padrão, **PaddleOCR** opcional.

### IA que propõe
- Leitura do carimbo e **verificação de comentários atendidos** (heurística de diferenças ou Claude, se houver chave) gravam apenas **sugestões em proposta**. Aplicar exige clique humano; o banco recusa qualquer outro caminho (`INV-AI-001`).
- A chave da Anthropic pode ser cadastrada no painel (cifrada com `CONFIG_SEGREDO`) e nunca chega ao navegador.

### Plataforma
- **Perfis por projeto**: Admin, Controlador, Autor, Revisor, Leitor e Externo; administrador inicial protegido; troca obrigatória de senha; "sair de todos os outros aparelhos".
- **Solicitar acesso** na página pública, com aprovação por um administrador.
- **Auditoria encadeada** com verificação de integridade.
- **Integrações** com GPlanSiS|Drawings, Writer e Sheets: áreas próprias, entrada única (SSO) nos dois sentidos e fila de eventos entregue pelo worker com assinatura **HMAC**.
- **PWA** (Workbox), temas claro e escuro, layout adaptado ao celular.
- **Protótipo standalone** (`prototipo/index.html`): um único arquivo, sem dependências, com dados de exemplo e as mesmas regras (recusas com o código `INV-*`).

## Telas

| Painel | Lista mestra |
|---|---|
| ![Painel com pendências, emissões por semana e situação das revisões](.github/telas/painel.png) | ![Lista mestra com códigos, revisões e situação](.github/telas/lista-mestra.png) |
| **Revisão com comentários na folha** | **Projeto com curva S** |
| ![Ficha do documento com visualizador PDF e comentários marcados](.github/telas/documento-comentarios.png) | ![Página do projeto com curva S e avanço por disciplina](.github/telas/projeto-curva-s.png) |

> Capturas feitas numa instância local com um projeto e documentos **fictícios** (nenhum documento real de usuário ou empresa).

## Arquitetura

```mermaid
flowchart LR
    subgraph Navegador
        PWA["React 19 + Vite (PWA)<br/>TanStack Query · Zustand · PDF.js"]
    end
    subgraph Stack["docker compose"]
        WEB["web · nginx<br/>estático + CSP"]
        API["api · FastAPI<br/>SQLAlchemy async"]
        WK["worker · arq<br/>OCR, IA, entregas"]
        DB[("PostgreSQL 16<br/>invariantes · FTS · trigram<br/>fonética · pgvector · auditoria")]
        RD[("Redis<br/>fila")]
        GT["Gotenberg<br/>Office/HTML → PDF"]
        BL[("blobs<br/>volume ou S3/MinIO")]
    end
    CADDY["Caddy<br/>TLS"]
    IA["API Anthropic<br/>(opcional)"]
    SIS["GPlanSiS Drawings · Writer · Sheets"]

    PWA --> CADDY --> WEB -- "/api" --> API
    API --> DB
    API --> BL
    API -- "enfileira" --> RD --> WK
    WK --> DB
    WK --> BL
    WK --> GT
    WK -. "sugestões" .-> IA
    WK -- "eventos HMAC" --> SIS
    SIS -- "SSO / arquivos" --> API
```

- **SQL-first**: o DDL com as invariantes vive em `backend/app/sql/*.sql`; o Alembic apenas aplica esses arquivos em ordem.
- O nginx resolve a API a cada requisição: se a API cair, o site responde 502 em vez de entrar em *loop*.
- Custo conhecido: páginas escaneadas passam por OCR duas vezes (motor próprio para palavras e confiança; OCRmyPDF para a camada do PDF/A). Desligue `OCR_ARCHIVE_PDFA` se o volume for alto e o PDF/A não for exigido.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, Vite 6, TypeScript strict, Tailwind v4, TanStack Query/Virtual, Zustand, PDF.js, Workbox (PWA), fontes Barlow e IBM Plex Mono |
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 async, asyncpg, Alembic, arq |
| Banco | PostgreSQL 16 + pgvector, pg_trgm, unaccent, fuzzystrmatch, pgcrypto |
| Documentos | Gotenberg (LibreOffice/Chromium), Tesseract, OCRmyPDF, OpenCV, pypdfium2; PaddleOCR opcional |
| IA | SDK `anthropic` (opcional), fastembed para busca semântica (opcional) |
| Implantação | Docker Compose, nginx, Caddy; armazenamento em volume ou S3/MinIO |

## Como rodar localmente

Requisitos: Docker com Compose.

```bash
git clone https://github.com/SSBianchiplan/docs.git
cd docs
cp .env.example .env          # troque os segredos (openssl rand -hex 32)
docker compose up -d --build
```

Abra <http://localhost:8080> (ou a porta de `WEB_PORT`). Entre com `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` e defina a nova senha. Documentação da API em `/api/docs` só com `APP_ENV=dev` (em produção o Swagger e o OpenAPI ficam desligados, e a API não sobe com `JWT_SECRET` ou `BOOTSTRAP_ADMIN_PASSWORD` padrão).

**Primeiro roteiro:** Projetos → *Novo projeto* (máscara, áreas, disciplinas, equipe) → Lista mestra → *Novo documento* (arraste o PDF) → *Enviar para verificação* → revisor e controlador aprovam em Pendências → GRD → *Emitir* → registrar o retorno do cliente → *Nova revisão*.

Para ver o sistema sem instalar nada, abra `prototipo/index.html` no navegador.

### Desenvolvimento

```bash
# backend (precisa de PostgreSQL 16 com pgvector e Redis)
cd backend
pip install -r requirements/base.txt -r requirements/ocr.txt -r requirements/dev.txt
alembic upgrade head && uvicorn app.main:app --reload          # :8000
arq app.worker.WorkerSettings                                   # worker de OCR

# testes (34): domínio, motor de OCR e red-team das invariantes
TEST_DSN=postgresql://usuario:senha@localhost:5432/edms_test pytest
ruff check . && mypy app

# frontend
cd frontend && npm install && npm run dev                       # :5173, proxy /api → :8000
npm run typecheck
npm run gen:api                                                 # tipos a partir do OpenAPI
```

Atalho com o próprio Compose: `docker compose run --rm -u root api sh -c "pip install -r requirements/dev.txt && TEST_DSN=postgresql://edms:<senha>@db:5432/edms pytest"` (os testes rodam em transação desfeita ao final).

Extras de build do backend (`EXTRAS` no `docker-compose.yml`): `ocr` (sempre), `llm` (Claude), `embeddings` (busca semântica), `paddle` (PaddleOCR; imagem bem maior).

## Estrutura de pastas

```
docs/
├── backend/
│   ├── app/
│   │   ├── api/            # rotas: documentos, revisões, workflow, GRD, projetos, busca, IA, integração…
│   │   ├── core/           # configuração, banco, segurança (JWT/argon2), armazenamento, config do sistema
│   │   ├── services/       # acesso por projeto, codificação, OCR (pipeline, motores, carimbo), fila, embeddings
│   │   ├── sql/            # DDL com as invariantes (0001…0008) — fonte da verdade do banco
│   │   ├── main.py         # aplicação FastAPI
│   │   └── worker.py       # worker arq: OCR, verificação de comentários, entrega de eventos
│   ├── alembic/            # revisões que aplicam app/sql/*.sql
│   ├── tests/              # domínio, OCR e red-team das invariantes
│   ├── requirements/       # base, dev, ocr, llm, embeddings, paddle
│   └── Dockerfile
├── frontend/
│   ├── src/                # páginas, componentes, lib, store
│   ├── public/             # logo, ícones PWA
│   ├── nginx.conf          # estático + CSP + proxy /api
│   └── Dockerfile
├── prototipo/index.html    # protótipo standalone (localStorage, OCR simulado)
├── docs/SPEC-GPS-DOCS-001.md
├── deploy/docs.caddy       # bloco do Caddy
├── docker-compose.yml
└── .env.example
```

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `POSTGRES_PASSWORD` | Senha do PostgreSQL do Compose |
| `JWT_SECRET` | Assinatura dos tokens de sessão (obrigatório trocar) |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` | Administrador inicial (recriado/reativado a cada subida; troca de senha obrigatória) |
| `STORAGE_BACKEND`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Armazenamento: `fs` (volume `blobs`, padrão) ou `s3` |
| `OCR_ENGINE`, `OCR_LANGUAGES`, `OCR_DPI`, `OCR_ARCHIVE_PDFA`, `MAX_UPLOAD_MB` | Motor e parâmetros de OCR, limite de upload |
| `EMBEDDINGS_ENABLED` | Liga a busca semântica (build com `embeddings`) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | IA opcional (a chave do painel tem precedência) |
| `CONFIG_SEGREDO` | Cifra segredos guardados pelo painel (ex.: chave da IA) |
| `INTEGRACAO_DRAWINGS_SEGREDO`, `DRAWINGS_URL`, `DRAWINGS_WEBHOOK_URL` | Integração com o GPlanSiS\|Drawings |
| `INTEGRACAO_WRITER_SEGREDO`, `WRITER_URL`, `WRITER_WEBHOOK_URL` | Integração com o GPlanSiS\|Writer |
| `INTEGRACAO_SHEETS_SEGREDO`, `SHEETS_URL`, `SHEETS_WEBHOOK_URL` | Integração com o GPlanSiS\|Sheets |
| `WEB_PORT`, `API_WORKERS` | Porta local do container web e workers do uvicorn |

Modelo em [`.env.example`](.env.example). Nunca versione o `.env`.

## Estado da qualidade (SDD·BE)

| Gate | Estado | Evidência |
|---|---|---|
| SPEC | PASS | `docs/SPEC-GPS-DOCS-001.md` + `backend/app/sql/`: 31 invariantes nomeadas |
| BUILD | PASS | migrações aplicam em PostgreSQL 16 |
| SELF-CHECK | PASS c/ ressalva | 34 testes verdes (conferido nesta publicação), `mypy --strict`, `ruff` e `tsc` strict; tipos do front ainda escritos à mão (migrar para `gen:api`) |
| RED-TEAM | PASS | `test_invariants_redteam.py` tenta violar as invariantes direto no banco |
| HUMAN-GATE | pendente | revisão do contrato da API, perfis e política de retenção |
| DONE | pendente | runbook de backup e restauração testada |

## Contribua

O DOCS quer ser uma alternativa aberta e séria aos EDMS de engenharia: regra no banco, auditoria verificável e IA que só propõe. **Toda ajuda conta.**

**Por onde começar (boas primeiras issues):**
- 🧾 **Tipos gerados**: migrar `frontend/src/lib/types.ts` para os tipos do OpenAPI (`npm run gen:api`).
- 🧪 **CI**: GitHub Actions com PostgreSQL/pgvector de serviço rodando `pytest`, `ruff`, `mypy` e `npm run typecheck`.
- 💾 **Backup e restauração**: runbook e script (pg_dump + espelho dos blobs) com teste de restauração.
- 🔍 **OCR**: avaliar docTR/Surya como motores plugáveis; melhorar a leitura de carimbos em pranchas rotacionadas.
- 📐 **Comparação de revisões**: diferença visual entre duas revisões de um desenho.
- 🌐 **Internacionalização** da interface (hoje em pt-BR) e do carimbo.
- ♿ **Acessibilidade**: navegação por teclado no visualizador e nos comentários.
- 📚 **Documentação**: guias para controladores de documentos e exemplos de máscaras de codificação.

Leia o [guia de contribuição](CONTRIBUTING.md), abra uma [issue](../../issues/new/choose) para combinar a ideia e mande seu pull request. Siga o [código de conduta](CODE_OF_CONDUCT.md). Encontrou uma falha de segurança? Veja a [política de segurança](SECURITY.md) — não abra issue pública.

## Licença

Código próprio sob a **[licença MIT](LICENSE)** — Copyright (c) 2026 GPlanSiS.

Fora as fontes em `gotenberg/fonts/`, nenhum código de terceiros está copiado no repositório; as dependências são instaladas por pip/npm ou usadas como imagens Docker, cada uma sob a própria licença — entre elas FastAPI (MIT), SQLAlchemy (MIT), React (MIT), PDF.js (Apache-2.0), fontes Barlow e IBM Plex Mono (SIL OFL 1.1, via `@fontsource`), Tesseract (Apache-2.0), OCRmyPDF (MPL-2.0), Gotenberg (MIT; a imagem `gotenberg/` acrescenta as fontes IBM Plex Sans, Serif e Mono, SIL OFL 1.1, copiadas de google/fonts com a licença em `gotenberg/fonts/OFL.txt`) e, dentro da imagem do backend, Ghostscript (AGPL-3.0, instalado pelo `apt` e executado como processo externo).

## Créditos

Desenvolvido pela **[GPlanSiS|Group](https://gplansis.com)** · contato: [contato@gplansis.com](mailto:contato@gplansis.com)

Referências pesquisadas no desenho do sistema: Greendocs/W3K, Paperless-ngx, Mayan EDMS e benchmarks de OCR de 2026 (Tesseract, PaddleOCR, docTR, Surya).

<p align="center"><a href="https://docs.gplansis.com"><b>docs.gplansis.com</b></a></p>
