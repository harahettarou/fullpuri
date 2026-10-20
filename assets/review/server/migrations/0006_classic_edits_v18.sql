CREATE TABLE IF NOT EXISTS classic_edits(page_key TEXT PRIMARY KEY,draft TEXT NOT NULL,published TEXT,version INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,published_at TEXT);
CREATE TABLE IF NOT EXISTS classic_edit_operations(actor_id TEXT NOT NULL,op_id TEXT NOT NULL,page_key TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL,expected INTEGER NOT NULL,at TEXT NOT NULL,is_admin INTEGER NOT NULL,PRIMARY KEY(actor_id,op_id));
CREATE TABLE IF NOT EXISTS classic_edit_history(page_key TEXT NOT NULL,version INTEGER NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL,draft TEXT NOT NULL,published TEXT,PRIMARY KEY(page_key,version));
CREATE TRIGGER IF NOT EXISTS classic_edit_guard BEFORE INSERT ON classic_edit_operations
WHEN NOT EXISTS(SELECT 1 FROM classic_edit_operations WHERE actor_id=NEW.actor_id AND op_id=NEW.op_id)
BEGIN
 SELECT CASE WHEN NEW.is_admin!=1 THEN RAISE(ABORT,'admin_required') END;
 SELECT CASE WHEN NEW.action NOT IN ('save','publish','unpublish') THEN RAISE(ABORT,'invalid_action') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM classic_edits WHERE page_key=NEW.page_key AND version=NEW.expected) THEN RAISE(ABORT,'version_conflict') END;
 SELECT CASE WHEN NEW.action='publish' AND EXISTS(SELECT 1 FROM classic_edits WHERE page_key=NEW.page_key AND draft='null') THEN RAISE(ABORT,'draft_required') END;
END;
CREATE TRIGGER IF NOT EXISTS classic_edit_apply AFTER INSERT ON classic_edit_operations
BEGIN
 UPDATE classic_edits SET draft=CASE WHEN NEW.action='save' THEN NEW.data ELSE draft END,published=CASE WHEN NEW.action='publish' THEN draft WHEN NEW.action='unpublish' THEN NULL ELSE published END,published_at=CASE WHEN NEW.action='publish' THEN NEW.at WHEN NEW.action='unpublish' THEN NULL ELSE published_at END,version=version+1,updated_at=NEW.at WHERE page_key=NEW.page_key;
 INSERT INTO classic_edit_history SELECT page_key,version,NEW.actor_id,NEW.action,NEW.at,draft,published FROM classic_edits WHERE page_key=NEW.page_key;
END;
