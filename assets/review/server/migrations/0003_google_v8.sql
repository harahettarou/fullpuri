CREATE TABLE IF NOT EXISTS google_identities(
 subject TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,
 display_login TEXT NOT NULL,linked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS google_states(
 state_hash TEXT PRIMARY KEY,challenge TEXT NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,
 source_user_id TEXT,source_session_hash TEXT,expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS google_tickets(
 ticket_hash TEXT PRIMARY KEY,challenge TEXT NOT NULL,subject TEXT NOT NULL,display_login TEXT NOT NULL,
 source_user_id TEXT,source_session_hash TEXT,expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS google_states_expiry ON google_states(expires);
CREATE INDEX IF NOT EXISTS google_tickets_expiry ON google_tickets(expires);
