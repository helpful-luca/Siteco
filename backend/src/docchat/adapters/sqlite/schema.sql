-- Source of truth for metadata. LanceDB only holds the search index.
-- Timestamps are ISO 8601 UTC strings. JSON columns are validated by Pydantic before writing.

CREATE TABLE IF NOT EXISTS preferences (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  data          TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('pdf', 'txt', 'md', 'html')),
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL UNIQUE,
  page_count    INTEGER,
  chunk_count   INTEGER,
  char_count    INTEGER,
  status        TEXT NOT NULL CHECK (status IN
                ('scanning', 'queued', 'parsing', 'embedding', 'ready', 'failed', 'deleting')),
  progress      REAL NOT NULL DEFAULT 0,
  error_code    TEXT,
  error_params  TEXT NOT NULL DEFAULT '{}',
  notices       TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  ready_at      TEXT,
  -- 0: uploaded into a chat only; it is searched there and leaves with the last such chat.
  in_library    INTEGER NOT NULL DEFAULT 1 CHECK (in_library IN (0, 1)),
  source_url    TEXT  -- imported from this link (shown in the details), else NULL
);
CREATE INDEX IF NOT EXISTS ix_documents_status ON documents(status);

CREATE TABLE IF NOT EXISTS chats (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  title_source  TEXT NOT NULL DEFAULT 'auto' CHECK (title_source IN ('auto', 'user')),
  scope         TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'selected')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_chats_updated ON chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_documents (
  chat_id       TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, document_id)
);

-- Documents uploaded into a chat. Always in that chat's scope, whatever the library selection.
CREATE TABLE IF NOT EXISTS chat_attachments (
  chat_id       TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (chat_id, document_id)
);
CREATE INDEX IF NOT EXISTS ix_chat_attachments_document ON chat_attachments(document_id);

CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  chat_id           TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  parent_id         TEXT REFERENCES messages(id) ON DELETE CASCADE,
  client_message_id TEXT,
  content           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'complete' CHECK (status IN
                    ('streaming', 'complete', 'truncated', 'stopped', 'interrupted',
                     'refused', 'error', 'sources_only')),
  error_code        TEXT,
  error_request_id  TEXT,
  model             TEXT,
  effort            TEXT,
  lane              TEXT CHECK (lane IN ('a', 'b')),
  comparison_id     TEXT,
  is_preferred      INTEGER NOT NULL DEFAULT 1,
  sources           TEXT NOT NULL DEFAULT '[]',
  sources_mode      TEXT,
  citations         TEXT NOT NULL DEFAULT '[]',
  notices           TEXT NOT NULL DEFAULT '[]',
  usage             TEXT,
  cost_usd          REAL,
  ttft_ms           INTEGER,
  total_ms          INTEGER,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_messages_chat ON messages(chat_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_client ON messages(chat_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- No foreign key on purpose: deleting chats must not rewrite the usage history.
CREATE TABLE IF NOT EXISTS usage_ledger (
  day           TEXT PRIMARY KEY,
  cost_usd      REAL NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  requests      INTEGER NOT NULL DEFAULT 0
);
