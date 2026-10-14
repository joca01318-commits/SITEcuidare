// Migrações do banco. Nunca edite uma migração já publicada: acrescente uma nova.

export const MIGRATIONS: string[] = [
  /* 1 — estrutura inicial */ `
  CREATE TABLE organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE users (
    id                  TEXT PRIMARY KEY,
    org_id              TEXT NOT NULL REFERENCES organizations(id),
    name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    email               TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash       TEXT NOT NULL,
    role                TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    scope_all           INTEGER NOT NULL DEFAULT 1 CHECK (scope_all IN (0,1)),
    active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    failed_logins       INTEGER NOT NULL DEFAULT 0,
    locked_until        TEXT,
    created_at          TEXT NOT NULL,
    last_login_at       TEXT,
    invite_id           TEXT
  );
  CREATE INDEX users_org ON users(org_id);

  CREATE TABLE invites (
    id           TEXT PRIMARY KEY,
    org_id       TEXT NOT NULL REFERENCES organizations(id),
    code_hash    TEXT NOT NULL UNIQUE,
    code_hint    TEXT NOT NULL,
    label        TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    scope_all    INTEGER NOT NULL DEFAULT 1,
    client_ids   TEXT NOT NULL DEFAULT '[]',
    max_uses     INTEGER,
    uses         INTEGER NOT NULL DEFAULT 0,
    expires_at   TEXT,
    revoked_at   TEXT,
    created_by   TEXT REFERENCES users(id),
    created_at   TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL UNIQUE,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    ip            TEXT,
    user_agent    TEXT,
    revoked_at    TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE rate_events (
    key  TEXT NOT NULL,
    at   INTEGER NOT NULL
  );
  CREATE INDEX rate_events_key ON rate_events(key, at);

  CREATE TABLE clients (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES organizations(id),
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    name_key    TEXT NOT NULL,
    aliases     TEXT NOT NULL DEFAULT '[]',
    notes       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    archived_at TEXT,
    UNIQUE (org_id, name_key)
  );

  CREATE TABLE user_client_access (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, client_id)
  );

  CREATE TABLE files (
    id             TEXT PRIMARY KEY,
    org_id         TEXT NOT NULL REFERENCES organizations(id),
    original_name  TEXT NOT NULL,
    mime           TEXT NOT NULL,
    format         TEXT NOT NULL,
    size           INTEGER NOT NULL,
    sha256         TEXT NOT NULL,
    storage_key    TEXT NOT NULL,
    created_by     TEXT REFERENCES users(id),
    created_at     TEXT NOT NULL
  );

  CREATE TABLE spreadsheets (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES organizations(id),
    title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    category        TEXT NOT NULL DEFAULT 'Geral',
    client_id       TEXT REFERENCES clients(id),
    year            INTEGER CHECK (year IS NULL OR year BETWEEN 2000 AND 2100),
    month           INTEGER CHECK (month IS NULL OR month BETWEEN 1 AND 12),
    columns         TEXT NOT NULL,
    client_column   TEXT,
    schema_rev      INTEGER NOT NULL DEFAULT 1,
    data_rev        INTEGER NOT NULL DEFAULT 0,
    source_file_id  TEXT REFERENCES files(id),
    workbook        TEXT,
    import_notes    TEXT NOT NULL DEFAULT '[]',
    created_by      TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    updated_by      TEXT REFERENCES users(id),
    deleted_at      TEXT,
    deleted_by      TEXT REFERENCES users(id)
  );
  CREATE INDEX spreadsheets_org ON spreadsheets(org_id, deleted_at, updated_at DESC);
  CREATE INDEX spreadsheets_period ON spreadsheets(org_id, year, month);
  CREATE INDEX spreadsheets_client ON spreadsheets(client_id);

  CREATE TABLE records (
    id              TEXT PRIMARY KEY,
    spreadsheet_id  TEXT NOT NULL REFERENCES spreadsheets(id) ON DELETE CASCADE,
    position        REAL NOT NULL,
    client_id       TEXT REFERENCES clients(id),
    data            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
    rev             INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    created_by      TEXT REFERENCES users(id),
    updated_at      TEXT NOT NULL,
    updated_by      TEXT REFERENCES users(id),
    deleted_at      TEXT
  );
  CREATE INDEX records_sheet ON records(spreadsheet_id, deleted_at, position);
  CREATE INDEX records_client ON records(client_id, deleted_at);

  CREATE TABLE versions (
    id              TEXT PRIMARY KEY,
    spreadsheet_id  TEXT NOT NULL REFERENCES spreadsheets(id) ON DELETE CASCADE,
    number          INTEGER NOT NULL,
    reason          TEXT NOT NULL,
    source          TEXT NOT NULL,
    snapshot        TEXT NOT NULL,
    row_count       INTEGER NOT NULL,
    created_by      TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL,
    UNIQUE (spreadsheet_id, number)
  );

  CREATE TABLE audit_events (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id          TEXT NOT NULL,
    at              TEXT NOT NULL,
    user_id         TEXT,
    user_name       TEXT,
    source          TEXT NOT NULL CHECK (source IN ('ui','import','ai','system')),
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT,
    spreadsheet_id  TEXT,
    client_id       TEXT,
    summary         TEXT NOT NULL,
    details         TEXT,
    ip              TEXT
  );
  CREATE INDEX audit_sheet ON audit_events(spreadsheet_id, seq DESC);
  CREATE INDEX audit_org ON audit_events(org_id, seq DESC);
  CREATE INDEX audit_client ON audit_events(client_id, seq DESC);

  -- O histórico de auditoria é somente de inclusão: nem o próprio sistema altera ou apaga.
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

  CREATE TABLE favorites (
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spreadsheet_id  TEXT NOT NULL REFERENCES spreadsheets(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (user_id, spreadsheet_id)
  );

  CREATE TABLE recents (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('spreadsheet','client')),
    ref_id     TEXT NOT NULL,
    viewed_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, kind, ref_id)
  );

  CREATE TABLE conversations (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    state       TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX conversations_user ON conversations(user_id, updated_at DESC);

  CREATE TABLE messages (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content          TEXT NOT NULL,
    payload          TEXT,
    created_at       TEXT NOT NULL
  );
  CREATE INDEX messages_conv ON messages(conversation_id, created_at);

  CREATE TABLE pending_actions (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool             TEXT NOT NULL,
    args             TEXT NOT NULL,
    summary          TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('pending','done','cancelled','expired','failed','undone')),
    result           TEXT,
    created_at       TEXT NOT NULL,
    expires_at       TEXT NOT NULL,
    resolved_at      TEXT
  );

  CREATE VIRTUAL TABLE search_index USING fts5(
    kind UNINDEXED, ref_id UNINDEXED, org_id UNINDEXED, title, body,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
];
