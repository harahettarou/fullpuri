CREATE TABLE IF NOT EXISTS materials(
 id TEXT PRIMARY KEY,pdf_key TEXT NOT NULL UNIQUE,sha256 TEXT NOT NULL,file_size INTEGER NOT NULL,page_count INTEGER NOT NULL,
 draft TEXT NOT NULL,published TEXT,published_at TEXT,uploaded INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS materials_public ON materials(archived,uploaded,published_at);
CREATE TABLE IF NOT EXISTS material_operations(
 actor_id TEXT NOT NULL,op_id TEXT NOT NULL,material_id TEXT NOT NULL,action TEXT NOT NULL,
 data TEXT NOT NULL,expected INTEGER NOT NULL,at TEXT NOT NULL,is_admin INTEGER NOT NULL,
 PRIMARY KEY(actor_id,op_id)
);
CREATE TABLE IF NOT EXISTS material_history(
 material_id TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,actor_id TEXT NOT NULL,at TEXT NOT NULL,
 draft TEXT NOT NULL,published TEXT,archived INTEGER NOT NULL,
 PRIMARY KEY(material_id,version)
);
CREATE TRIGGER IF NOT EXISTS material_guard BEFORE INSERT ON material_operations
WHEN NOT EXISTS(SELECT 1 FROM material_operations WHERE actor_id=NEW.actor_id AND op_id=NEW.op_id)
BEGIN
 SELECT (CASE WHEN NEW.is_admin!=1 THEN RAISE(ABORT,'admin_required') END);
 SELECT (CASE WHEN NEW.action NOT IN ('save','publish','unpublish','archive','restore') THEN RAISE(ABORT,'invalid_action') END);
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM materials WHERE id=NEW.material_id AND version=NEW.expected) THEN RAISE(ABORT,'version_conflict') END);
 SELECT (CASE WHEN NEW.action='publish' AND NOT EXISTS(SELECT 1 FROM materials WHERE id=NEW.material_id AND uploaded=1 AND archived=0) THEN RAISE(ABORT,'not_ready') END);
 SELECT (CASE WHEN NEW.action IN ('save','unpublish') AND EXISTS(SELECT 1 FROM materials WHERE id=NEW.material_id AND archived=1) THEN RAISE(ABORT,'archived') END);
END;
CREATE TRIGGER IF NOT EXISTS material_apply AFTER INSERT ON material_operations
BEGIN
 UPDATE materials SET
 draft=(CASE WHEN NEW.action='save' THEN NEW.data ELSE draft END),
 published=(CASE WHEN NEW.action='publish' THEN draft WHEN NEW.action='unpublish' THEN NULL ELSE published END),
 published_at=(CASE WHEN NEW.action='publish' THEN NEW.at WHEN NEW.action='unpublish' THEN NULL ELSE published_at END),
 archived=(CASE WHEN NEW.action='archive' THEN 1 WHEN NEW.action='restore' THEN 0 ELSE archived END),
 version=version+1,updated_at=NEW.at WHERE id=NEW.material_id;
 INSERT INTO material_history(material_id,version,action,actor_id,at,draft,published,archived)
 SELECT id,version,NEW.action,NEW.actor_id,NEW.at,draft,published,archived FROM materials WHERE id=NEW.material_id;
END;
