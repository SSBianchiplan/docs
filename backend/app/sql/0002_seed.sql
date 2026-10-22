-- GPlanSiS|DOCS · migration 0002 · catálogos base (idempotente)
INSERT INTO discipline (code, name) VALUES
  ('GER','Geral'), ('CIV','Civil'), ('EST','Estruturas'), ('MEC','Mecânica'),
  ('TUB','Tubulação'), ('ELE','Elétrica'), ('INS','Instrumentação'), ('AUT','Automação'),
  ('PRO','Processo'), ('ARQ','Arquitetura'), ('HVAC','Ar-condicionado e ventilação'),
  ('SEG','Segurança'), ('MA','Meio ambiente'), ('QUA','Qualidade')
ON CONFLICT (code) DO NOTHING;

INSERT INTO doc_type (code, name, metadata_schema) VALUES
  ('DE',  'Desenho', '{"type":"object","properties":{"formato":{"type":"string","enum":["A0","A1","A2","A3","A4"]},"escala":{"type":"string"},"folha":{"type":"string"}}}'),
  ('MD',  'Memorial descritivo', '{}'),
  ('MC',  'Memória de cálculo', '{}'),
  ('ET',  'Especificação técnica', '{}'),
  ('FD',  'Folha de dados', '{"type":"object","properties":{"tag":{"type":"string"}}}'),
  ('LM',  'Lista de materiais', '{}'),
  ('LI',  'Lista de instrumentos', '{}'),
  ('DF',  'Diagrama de fluxo / P&ID', '{"type":"object","properties":{"sistema":{"type":"string"}}}'),
  ('RT',  'Relatório técnico', '{}'),
  ('PR',  'Procedimento', '{}'),
  ('DB',  'Databook', '{}'),
  ('CT',  'Certificado', '{}')
ON CONFLICT (code) DO NOTHING;

-- Fluxo padrão: verificação por disciplina → aprovação pelo controle de documentos
INSERT INTO workflow_template (id, project_id, name) VALUES
  ('00000000-0000-0000-0000-00000000f001', NULL, 'Verificação + aprovação (padrão)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO workflow_template_step (template_id, step_order, name, role_required, sla_hours) VALUES
  ('00000000-0000-0000-0000-00000000f001', 1, 'Verificação técnica', 'REVISOR', 48),
  ('00000000-0000-0000-0000-00000000f001', 2, 'Aprovação do controle de documentos', 'CONTROLADOR', 24)
ON CONFLICT DO NOTHING;
