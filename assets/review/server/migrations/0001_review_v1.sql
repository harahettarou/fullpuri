PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,login TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states(state_hash TEXT PRIMARY KEY,challenge TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tickets(ticket_hash TEXT PRIMARY KEY,challenge TEXT NOT NULL,user_id TEXT NOT NULL,login TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS entries(
 user_id TEXT NOT NULL,id TEXT NOT NULL,target TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'todo' CHECK(state IN('todo','done')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_reviewed_at TEXT,completed_at TEXT,review_count INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,id));
CREATE INDEX IF NOT EXISTS entries_owner ON entries(user_id,deleted,updated_at);
CREATE TABLE IF NOT EXISTS operations(user_id TEXT NOT NULL,op_id TEXT NOT NULL,entry_id TEXT NOT NULL,action TEXT NOT NULL,
 target TEXT NOT NULL,expected INTEGER NOT NULL,at TEXT NOT NULL,PRIMARY KEY(user_id,op_id));
CREATE TABLE IF NOT EXISTS history(user_id TEXT NOT NULL,op_id TEXT NOT NULL,entry_id TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL,
 PRIMARY KEY(user_id,op_id));
CREATE INDEX IF NOT EXISTS history_owner_entry ON history(user_id,entry_id,at);
CREATE TRIGGER IF NOT EXISTS operation_guard BEFORE INSERT ON operations
WHEN NOT EXISTS(SELECT 1 FROM operations WHERE user_id=NEW.user_id AND op_id=NEW.op_id)
BEGIN
 SELECT (CASE WHEN NEW.action NOT IN ('register','complete','reopen','delete') THEN RAISE(ABORT,'invalid_action') END);
 SELECT (CASE WHEN COALESCE((SELECT version FROM entries WHERE user_id=NEW.user_id AND id=NEW.entry_id),0)!=NEW.expected THEN RAISE(ABORT,'version_conflict') END);
 SELECT (CASE WHEN NEW.action!='register' AND NOT EXISTS(SELECT 1 FROM entries WHERE user_id=NEW.user_id AND id=NEW.entry_id AND deleted=0) THEN RAISE(ABORT,'version_conflict') END);
END;
CREATE TRIGGER IF NOT EXISTS operation_apply AFTER INSERT ON operations
BEGIN
 INSERT INTO entries(user_id,id,target,created_at,updated_at)
 SELECT NEW.user_id,NEW.entry_id,NEW.target,NEW.at,NEW.at WHERE NEW.action='register'
 ON CONFLICT(user_id,id) DO UPDATE SET deleted=0,state='todo',completed_at=NULL,updated_at=NEW.at,version=version+1;
 INSERT INTO history(user_id,op_id,entry_id,action,at)
 SELECT NEW.user_id,NEW.op_id,NEW.entry_id,NEW.action,NEW.at
 WHERE NEW.action='register' OR EXISTS(SELECT 1 FROM entries WHERE user_id=NEW.user_id AND id=NEW.entry_id AND
 ((NEW.action='complete' AND state='todo') OR (NEW.action='reopen' AND state='done') OR NEW.action='delete'));
 UPDATE entries SET
 review_count=review_count+(CASE WHEN NEW.action='complete' AND state='todo' THEN 1 ELSE 0 END),
 last_reviewed_at=(CASE WHEN NEW.action='complete' AND state='todo' THEN NEW.at ELSE last_reviewed_at END),
 completed_at=(CASE WHEN NEW.action='complete' AND state='todo' THEN NEW.at WHEN NEW.action='reopen' THEN NULL ELSE completed_at END),
 state=(CASE WHEN NEW.action='complete' THEN 'done' WHEN NEW.action='reopen' THEN 'todo' ELSE state END),
 deleted=(CASE WHEN NEW.action='delete' THEN 1 ELSE deleted END),version=version+1,updated_at=NEW.at
 WHERE user_id=NEW.user_id AND id=NEW.entry_id AND NEW.action!='register'
 AND ((NEW.action='complete' AND state='todo') OR (NEW.action='reopen' AND state='done') OR NEW.action='delete');
END;
