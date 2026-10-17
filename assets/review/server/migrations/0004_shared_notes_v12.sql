CREATE TABLE IF NOT EXISTS shared_notes(
 id TEXT PRIMARY KEY,target TEXT NOT NULL,body TEXT NOT NULL,
 created_by TEXT NOT NULL,created_label TEXT NOT NULL,updated_by TEXT NOT NULL,updated_label TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shared_notes_updated ON shared_notes(deleted,updated_at);
CREATE TABLE IF NOT EXISTS shared_note_operations(
 actor_id TEXT NOT NULL,op_id TEXT NOT NULL,entry_id TEXT NOT NULL,action TEXT NOT NULL,
 target TEXT NOT NULL,body TEXT NOT NULL,expected INTEGER NOT NULL,at TEXT NOT NULL,
 actor_label TEXT NOT NULL,is_admin INTEGER NOT NULL,
 PRIMARY KEY(actor_id,op_id)
);
CREATE TABLE IF NOT EXISTS shared_note_history(
 entry_id TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL,
 actor_id TEXT NOT NULL,actor_label TEXT NOT NULL,body TEXT NOT NULL,deleted INTEGER NOT NULL,
 PRIMARY KEY(entry_id,version)
);
CREATE TRIGGER IF NOT EXISTS shared_note_guard BEFORE INSERT ON shared_note_operations
WHEN NOT EXISTS(SELECT 1 FROM shared_note_operations WHERE actor_id=NEW.actor_id AND op_id=NEW.op_id)
BEGIN
 SELECT (CASE WHEN NEW.action NOT IN ('put','delete','restore') THEN RAISE(ABORT,'invalid_action') END);
 SELECT (CASE WHEN NEW.action IN ('delete','restore') AND NEW.is_admin!=1 THEN RAISE(ABORT,'admin_required') END);
 SELECT (CASE WHEN COALESCE((SELECT version FROM shared_notes WHERE id=NEW.entry_id),0)!=NEW.expected THEN RAISE(ABORT,'version_conflict') END);
 SELECT (CASE WHEN NEW.action='put' AND EXISTS(SELECT 1 FROM shared_notes WHERE id=NEW.entry_id AND deleted=1) THEN RAISE(ABORT,'restore_required') END);
 SELECT (CASE WHEN NEW.action='delete' AND NOT EXISTS(SELECT 1 FROM shared_notes WHERE id=NEW.entry_id AND deleted=0) THEN RAISE(ABORT,'version_conflict') END);
 SELECT (CASE WHEN NEW.action='restore' AND NOT EXISTS(SELECT 1 FROM shared_notes WHERE id=NEW.entry_id AND deleted=1) THEN RAISE(ABORT,'version_conflict') END);
END;
CREATE TRIGGER IF NOT EXISTS shared_note_apply AFTER INSERT ON shared_note_operations
BEGIN
 INSERT INTO shared_notes(id,target,body,created_by,created_label,updated_by,updated_label,created_at,updated_at)
 VALUES(NEW.entry_id,NEW.target,NEW.body,NEW.actor_id,NEW.actor_label,NEW.actor_id,NEW.actor_label,NEW.at,NEW.at)
 ON CONFLICT(id) DO UPDATE SET
 body=(CASE WHEN NEW.action='put' THEN NEW.body ELSE body END),
 updated_by=NEW.actor_id,updated_label=NEW.actor_label,updated_at=NEW.at,
 deleted=(CASE WHEN NEW.action='delete' THEN 1 ELSE 0 END),version=version+1;
 INSERT INTO shared_note_history(entry_id,version,action,at,actor_id,actor_label,body,deleted)
 SELECT id,version,NEW.action,NEW.at,NEW.actor_id,NEW.actor_label,body,deleted FROM shared_notes WHERE id=NEW.entry_id;
END;
