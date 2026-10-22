-- Initial schema for the college chatbot. Written in portable SQL so the
-- later Supabase Postgres migration (ticket 11) can reuse the same shape.

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('bot_active', 'awaiting_staff', 'claimed', 'closed')),
  created_at TEXT NOT NULL
);

CREATE TABLE visitor_sessions (
  token_hash TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_visitor_sessions_conversation ON visitor_sessions(conversation_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('visitor', 'bot', 'staff')),
  text TEXT NOT NULL,
  link TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE answer_rules (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  response TEXT NOT NULL,
  link TEXT,
  phrases TEXT NOT NULL,
  keywords TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  updated_at TEXT NOT NULL
);
