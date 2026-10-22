# SPEC-GPS-DOCS-001 · GPlanSiS|DOCS — EDMS de documentos técnicos

Estado: BUILD · Metodologia SDD·BE (SPEC → BUILD → SELF-CHECK → RED-TEAM → HUMAN-GATE → DONE)

## 1. Objetivo
Gerir o ciclo de vida de documentos técnicos de engenharia (EPC, owner, fornecedor): lista mestra codificada,
revisões com máquina de estados, workflow de verificação e aprovação, comentários eletrônicos sobre a folha,
emissão por GRD numerada, retorno do cliente, OCR com busca por conteúdo e trilha de auditoria à prova de adulteração.

## 2. Fonte da verdade
PostgreSQL 16 (pgvector, pg_trgm, unaccent, fuzzystrmatch, pgcrypto). Arquivos no MinIO/S3 endereçados por SHA-256;
o banco guarda o hash e é o único dono da ligação arquivo ↔ revisão. Texto de OCR é dado derivado e reprocessável.

## 3. Invariantes (RFC-2119)
| ID | Regra | Materialização |
|---|---|---|
| INV-DOC-001 | O código DEVE ser único por projeto | `uq_document_code` |
| INV-DOC-002 | O código DEVE obedecer à máscara de codificação do projeto | trigger `fn_document_code_check` |
| INV-RET-001 | Documento sob retenção NÃO DEVE ser excluído | trigger `fn_document_retention` |
| INV-REV-001 | Rótulo único por documento; rótulo e documento imutáveis | `uq_revision_label` + trigger |
| INV-REV-002 | No máximo uma revisão vigente por documento | índice único parcial |
| INV-REV-003 | Arquivos de revisão fora de EM_ELABORACAO NÃO PODEM ser incluídos, trocados ou removidos | trigger `fn_revision_file_lock` |
| INV-REV-004 | Revisão EMITIDA DEVE ter PDF, data de emissão e finalidade | CHECK + constraint trigger |
| INV-REV-005 | Transições DEVEM seguir `revision_transition`; revisão nasce em EM_ELABORACAO | trigger |
| INV-REV-006 | APROVADA_INTERNA DEVE ter workflow CONCLUIDO (se o projeto exigir) | constraint trigger |
| INV-REV-007 | APROVADA_INTERNA NÃO PODE ocorrer com comentário OBRIGATORIO aberto na revisão anterior | constraint trigger |
| INV-REV-009 | No máximo uma revisão em andamento por documento | índice único parcial |
| INV-CHK-001 | No máximo um check-out ativo por documento | índice único parcial |
| INV-WF-001 | Decisão DEVE registrar quem e quando; reprovação DEVE ter justificativa | CHECK |
| INV-WF-002 | Só o responsável decide a própria tarefa | CHECK |
| INV-WF-003 | O autor NÃO PODE aprovar a própria revisão (segregação de funções) | trigger |
| INV-WF-004 | Tarefa decidida é imutável | trigger |
| INV-CMT-001 | Marcação DEVE estar dentro da folha (0..1) | CHECK |
| INV-CMT-002 | Conteúdo do comentário é imutável; só o tratamento evolui | trigger |
| INV-GRD-001 | Numeração de GRD única e sem lacuna por projeto, atribuída na emissão | UNIQUE + `fn_grd_emitir` |
| INV-GRD-002 | GRD emitida tem cabeçalho e itens imutáveis | triggers |
| INV-GRD-003 | Item DEVE ser do mesmo projeto e estar aprovado internamente ou emitido | trigger |
| INV-GRD-004 | GRD sem itens NÃO PODE ser emitida | `fn_grd_emitir` |
| INV-GRD-005 | RECEBIDA/CANCELADA são estados finais | trigger |
| INV-AI-001 | Sugestão da IA NÃO DEVE ser aplicada/rejeitada sem decisão humana registrada | CHECK `ck_ai_human_gate` |
| INV-AI-002 | Proposta da IA é imutável e a decisão é final | trigger |
| INV-AUD-001 | Auditoria append-only com encadeamento SHA-256 verificável | triggers + `fn_audit_verify()` |
| INV-FILE-001 | Blob identificado por SHA-256 hex válido | CHECK |
| INV-OCR-001 | Página ≥ 1, confiança 0..100, uma linha por (arquivo, página) | CHECK + PK |

## 4. Critérios de aceite
- Toda invariante acima tem teste RED-TEAM que tenta violá-la direto no banco (`tests/test_invariants_redteam.py`).
- Migration aplica, reverte até zero tabelas e reaplica.
- OCR de prancha escaneada ≥ 75 % de confiança média com Tesseract `por+eng` a 300 dpi (cenário sintético do teste).
- Nenhuma escrita da IA em documento/comentário sem passar por `ai_suggestion` + decisão humana.

## 5. Fora de escopo nesta fase
Visualização de CAD nativo (DWG/DXF/RVT/NWD) no navegador; assinatura digital ICP-Brasil; SSO Keycloak;
distribuição controlada de cópias impressas; envio de GRD por e-mail.
