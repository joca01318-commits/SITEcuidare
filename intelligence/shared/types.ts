// Tipos compartilhados entre o servidor e a interface.

export type Role = "admin" | "editor" | "viewer";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  editor: "Editor",
  viewer: "Leitura",
};

export type ColumnType = "text" | "number" | "currency" | "date" | "select" | "boolean" | "formula";

/**
 * Papel semântico de uma coluna. É o que permite à assistente entender
 * "o valor pago", "o cliente" ou "o status" sem depender do nome exato da coluna.
 */
export type ColumnRole =
  | "client"
  | "worker"
  | "status"
  | "amount"
  | "payment_date"
  | "date"
  | "quantity"
  | "unit_value"
  | "absences"
  | "notes"
  | "regime"
  | "shift";

export const COLUMN_ROLE_LABEL: Record<ColumnRole, string> = {
  client: "Cliente / assistido",
  worker: "Cuidador(a)",
  status: "Situação do pagamento",
  amount: "Valor pago / a pagar",
  payment_date: "Data do pagamento",
  date: "Data",
  quantity: "Quantidade de plantões",
  unit_value: "Valor unitário",
  absences: "Faltas",
  notes: "Observações",
  regime: "Regime de contratação",
  shift: "Turno",
};

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  /** Opções de uma coluna de seleção. */
  options?: string[];
  /** Expressão de uma coluna calculada, com referências no formato {id_da_coluna}. */
  formula?: string;
  width?: number;
  role?: ColumnRole;
  /** Dado pessoal (PIX, CPF, telefone…): mascarado para leitura e nunca enviado a IA externa. */
  sensitive?: boolean;
  /** Ao criar a planilha do mês seguinte, o valor desta coluna é copiado. */
  carryOver?: boolean;
  /** Para colunas de situação: quais valores significam "pendente" e "pago". */
  pendingValues?: string[];
  paidValues?: string[];
}

export type CellValue = string | number | boolean | null;
export type RowData = Record<string, CellValue>;

export interface SheetRecord {
  id: string;
  position: number;
  clientId: string | null;
  data: RowData;
  rev: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SpreadsheetSummary {
  id: string;
  title: string;
  category: string;
  clientId: string | null;
  clientName: string | null;
  year: number | null;
  month: number | null;
  rowCount: number;
  updatedAt: string;
  updatedByName: string | null;
  sourceFormat: string | null;
  sourceFileName: string | null;
  workbook: string | null;
  favorite: boolean;
}

export interface SpreadsheetDetail extends SpreadsheetSummary {
  columns: Column[];
  clientColumn: string | null;
  schemaRev: number;
  dataRev: number;
  records: SheetRecord[];
  /** Quando a planilha é geral (vários clientes) e foi aberta filtrada por um cliente. */
  filteredClientId: string | null;
  filteredClientName: string | null;
  canEdit: boolean;
  importNotes: string[];
}

export interface ClientSummary {
  id: string;
  name: string;
  aliases: string[];
  notes: string | null;
  spreadsheetCount: number;
  updatedAt: string;
}

export type AuditSource = "ui" | "import" | "ai" | "system";

export interface AuditEvent {
  seq: number;
  at: string;
  userName: string | null;
  source: AuditSource;
  action: string;
  summary: string;
  spreadsheetId: string | null;
  spreadsheetTitle: string | null;
  clientId: string | null;
  details: AuditDetail[] | null;
}

export interface AuditDetail {
  recordId?: string;
  column?: string;
  before?: unknown;
  after?: unknown;
}

export interface CellOp {
  recordId: string;
  columnId: string;
  value: CellValue;
  /** Valor que o usuário via antes de editar. Se mudou no servidor, há conflito. */
  expected: CellValue;
}

export interface CellConflict {
  recordId: string;
  columnId: string;
  current: CellValue;
  attempted: CellValue;
  byName: string | null;
  at: string | null;
}

export const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** Ação que a assistente propõe à interface (abrir, confirmar, desfazer…). */
export type AssistantAction =
  | { kind: "open_spreadsheet"; spreadsheetId: string; clientId?: string | null; label: string }
  | { kind: "open_client"; clientId: string; label: string }
  | { kind: "confirm"; pendingId: string; label: string }
  | { kind: "cancel"; pendingId: string; label: string }
  | { kind: "undo"; pendingId: string; label: string }
  | { kind: "download"; url: string; label: string }
  | { kind: "suggest"; text: string };

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  actions?: AssistantAction[];
  table?: { columns: string[]; rows: (string | number | null)[][]; footer?: (string | number | null)[] };
  pending?: { id: string; status: string; summary: string; changes?: { label: string; value: string }[] };
  engine?: string;
}
