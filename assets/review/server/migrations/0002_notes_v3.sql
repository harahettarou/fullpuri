CREATE TABLE IF NOT EXISTS notes(
 user_id TEXT NOT NULL,id TEXT NOT NULL,target TEXT NOT NULL,body TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,id)
);
CREATE INDEX IF NOT EXISTS notes_owner ON notes(user_id,deleted,updated_at);
CREATE TABLE IF NOT EXISTS note_operations(
 user_id TEXT NOT NULL,op_id TEXT NOT NULL,entry_id TEXT NOT NULL,action TEXT NOT NULL,
 target TEXT NOT NULL,body TEXT NOT NULL,expected INTEGER NOT NULL,at TEXT NOT NULL,
 PRIMARY KEY(user_id,op_id)
);
CREATE TRIGGER IF NOT EXISTS note_guard BEFORE INSERT ON note_operations
WHEN NOT EXISTS(SELECT 1 FROM note_operations WHERE user_id=NEW.user_id AND op_id=NEW.op_id)
BEGIN
 SELECT (CASE WHEN NEW.action NOT IN ('put','delete') THEN RAISE(ABORT,'invalid_action') END);
 SELECT (CASE WHEN COALESCE((SELECT version FROM notes WHERE user_id=NEW.user_id AND id=NEW.entry_id),0)!=NEW.expected THEN RAISE(ABORT,'version_conflict') END);
 SELECT (CASE WHEN NEW.action='delete' AND NOT EXISTS(SELECT 1 FROM notes WHERE user_id=NEW.user_id AND id=NEW.entry_id AND deleted=0) THEN RAISE(ABORT,'version_conflict') END);
END;
CREATE TRIGGER IF NOT EXISTS note_apply AFTER INSERT ON note_operations
BEGIN
 INSERT INTO notes(user_id,id,target,body,created_at,updated_at,deleted)
 VALUES(NEW.user_id,NEW.entry_id,NEW.target,NEW.body,NEW.at,NEW.at,(CASE WHEN NEW.action='delete' THEN 1 ELSE 0 END))
 ON CONFLICT(user_id,id) DO UPDATE SET
 body=excluded.body,updated_at=excluded.updated_at,deleted=excluded.deleted,version=version+1;
END;
