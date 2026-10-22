// Tipos de fronteira. Transitório: `npm run gen:api` gera src/lib/openapi.d.ts do OpenAPI do backend
// e estes aliases devem migrar para ele (gate SELF-CHECK).
export type RevisionStatus =
  | "EM_ELABORACAO" | "EM_VERIFICACAO" | "APROVADA_INTERNA" | "EMITIDA" | "APROVADA"
  | "APROVADA_COM_COMENTARIOS" | "REPROVADA" | "SUPERADA" | "CANCELADA";
export type Purpose = "PI" | "PA" | "PC" | "CE" | "CA";
export type Role = "ADMIN" | "CONTROLADOR" | "AUTOR" | "REVISOR" | "LEITOR" | "EXTERNO";

export interface User { id: string; email: string; name: string; is_admin: boolean; must_change_password?: boolean }
export interface AdminUser {
  id: string; name: string; email: string; company: string | null; is_admin: boolean; is_external: boolean;
  is_active: boolean; must_change_password: boolean; last_login_at: string | null; created_at: string;
  is_master: boolean; projects: number;
}
export interface AccessRequest {
  id: string; name: string; email: string; company: string | null; message: string | null;
  status: "PENDENTE" | "APROVADA" | "RECUSADA"; created_at: string; decided_at: string | null; decided_by_name: string | null;
}
export type Confidentiality = "PUBLICO" | "INTERNO" | "CONFIDENCIAL" | "RESTRITO";
export interface Project {
  id: string; code: string; name: string; client: string | null; code_mask: string;
  require_workflow: boolean; my_role: Role | null; documents: number; active: boolean;
  start_date: string | null; end_date: string | null; location: string | null;
  revision_scheme: "auto" | "numeric"; default_confidentiality: Confidentiality; default_template_id: string | null;
  issued: number; late: number; progress_pct: number; members: number; has_areas: boolean;
}
export interface WorkflowTemplate {
  id: string; name: string; project_id: string | null; active?: boolean; uses?: number;
  steps: { step_order: number; name: string; role_required: Role; sla_hours: number }[];
}
export interface ProjectDetail {
  project: {
    id: string; code: string; name: string; client: string | null; description: string | null; contract: string | null;
    location: string | null; start_date: string | null; end_date: string | null; code_mask: string; code_regex: string;
    revision_scheme: "auto" | "numeric"; require_workflow: boolean; default_confidentiality: Confidentiality;
    retention_years: number | null; default_template_id: string | null; active: boolean; created_at: string;
    created_by_name: string | null;
  };
  my_role: Role;
  areas: { code: string; name: string; documents: number }[];
  disciplines: string[];
  templates: WorkflowTemplate[];
}
export interface Progress {
  totals: { documents: number; weight: number; planned: number; issued: number; issued_weight: number;
    planned_weight_to_date: number; late: number; client_approved: number; client_rejected: number;
    first_planned: string | null; last_planned: string | null };
  actual_pct: number; planned_pct: number;
  curve: { week: string; planned: number; actual: number | null }[];
  by_discipline: { discipline: string; documents: number; issued: number; late: number }[];
  late: { id: string; code: string; title: string; planned_issue_date: string; revision_label: string | null;
    revision_status: RevisionStatus | null; days_late: number }[];
}
export interface Catalog {
  disciplines: { code: string; name: string }[];
  doc_types: { code: string; name: string; metadata_schema: Record<string, unknown> }[];
  workflow_templates: WorkflowTemplate[];
  areas: { project_id: string; code: string; name: string }[];
  project_disciplines: { project_id: string; code: string }[];
}
export interface Member { id: string; name: string; email: string; company: string | null; role: Role }
export interface MasterRow {
  id: string; project_code: string; code: string; title: string; discipline_code: string; doc_type_code: string;
  area: string | null; originator: string | null; confidentiality: string; tags: string[]; updated_at: string;
  revision_id: string | null; revision_label: string | null; revision_status: RevisionStatus | null;
  purpose: Purpose | null; issued_at: string | null; client_return_code: string | null;
  open_comments: number; checked_out_by: string | null;
  planned_issue_date: string | null; weight: number; first_issued_at: string | null; late: boolean;
}
export interface Page<T> { total: number; page: number; size: number; items: T[] }
export interface FileInfo {
  id: string; role: "PDF" | "NATIVO" | "ANEXO"; filename: string; sha256: string; size: number; mime: string;
  ocr_status: "PENDENTE" | "PROCESSANDO" | "CONCLUIDO" | "FALHOU" | "IGNORADO" | null;
  ocr_engine: string | null; pages: number | null; confidence: number | null;
  has_archive: boolean; has_thumb: boolean; ocr_error: string | null;
}
export interface Revision {
  id: string; label: string; status: RevisionStatus; purpose: Purpose | null; description: string | null;
  is_current: boolean; created_at: string; issued_at: string | null; client_return_code: string | null;
  client_returned_at: string | null; created_by_name: string; created_by: string; open_comments: number;
  files: FileInfo[] | null;
  grds: { grd_id: string; number: number | null; status: string; recipient: string; issued_at: string | null }[] | null;
}
export interface Suggestion {
  id: string; kind: "METADADOS_CARIMBO" | "COMENTARIO_ATENDIDO" | "CLASSIFICACAO";
  payload: Record<string, string>; confidence: number | null; engine: string; created_at: string;
  target_type: string; target_id: string; status?: string;
}
export interface WorkflowInfo {
  id: string; revision_id: string; status: string; current_step: number; started_at: string; finished_at: string | null;
  template_name: string;
  tasks: { id: string; step_order: number; step_name: string; assignee: string; status: string; due_at: string; decided_at: string | null; note: string | null }[] | null;
}
export interface DocumentDetail {
  document: {
    id: string; project_id: string; project_code: string; project_name: string; code: string; title: string;
    discipline_code: string; discipline_name: string; doc_type_code: string; doc_type_name: string;
    area: string | null; originator: string | null; confidentiality: string; metadata: Record<string, unknown>;
    tags: string[]; retention_until: string | null; created_at: string; updated_at: string; created_by_name: string;
    planned_issue_date: string | null; weight: number; project_active: boolean;
  };
  my_role: Role;
  revisions: Revision[];
  checkout: { id: string; user_id: string; name: string; checked_out_at: string; note: string | null } | null;
  suggestions: Suggestion[];
  workflows: WorkflowInfo[];
}
export interface Comment {
  id: string; page: number | null; x: number | null; y: number | null; w: number | null; h: number | null;
  category: "GERAL" | "TECNICO" | "EDITORIAL" | "OBRIGATORIO"; body: string; status: "ABERTO" | "RESOLVIDO" | "NAO_APLICAVEL";
  resolution: string | null; created_at: string; resolved_at: string | null; author: string;
  resolved_by_name: string | null; resolved_in_label: string | null;
}
export interface Task {
  id: string; step_name: string; step_order: number; status: string; due_at: string; created_at: string; overdue: boolean;
  revision_id: string; revision_label: string; document_id: string; code: string; title: string;
  project_code: string; template_name: string;
}
export interface GrdRow {
  id: string; number: number | null; project_code: string; code: string | null; recipient: string; purpose: Purpose;
  status: "RASCUNHO" | "EMITIDA" | "RECEBIDA" | "CANCELADA"; created_at: string; issued_at: string | null;
  received_at: string | null; items: number;
}
export interface GrdDetail {
  grd: GrdRow & { project_id: string; project_name: string; client: string | null; recipient_email: string | null;
    notes: string | null; received_by: string | null; manifest_sha256: string | null; issued_by_name: string | null };
  items: { revision_id: string; copies: number; media: string; document_id: string; code: string; title: string;
    label: string; status: RevisionStatus; purpose: Purpose | null; discipline_code: string; doc_type_code: string; files: string | null }[];
}
export interface Dashboard {
  counters: { documents: number; my_tasks: number; my_overdue: number; grds_awaiting_receipt: number;
    mandatory_open: number; ocr_queue: number; ocr_failed: number; ai_pending: number };
  by_status: { status: string; n: number }[];
  by_discipline: { discipline: string; n: number }[];
  emissions: { week: string; n: number }[];
  overdue: { id: string; step_name: string; due_at: string; assignee: string; document_id: string; code: string; revision_label: string }[];
  recent: { document_id: string; code: string; title: string; label: string; status: RevisionStatus; created_at: string }[];
}
export interface SearchHit {
  document_id: string; code: string; title: string; rank: number; revision_label?: string; status?: RevisionStatus;
  file_id?: string; filename?: string; snippet?: string; page?: number;
}
export interface AuditRow { id: number; at: string; entity: string; entity_id: string; action: string; data: Record<string, unknown>; hash: string; actor: string | null }
