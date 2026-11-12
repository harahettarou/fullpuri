-- Apply as one D1 batch before deploying the Worker that accepts uncertain.
ALTER TABLE entries ADD COLUMN mark TEXT NOT NULL DEFAULT 'review' CHECK(mark IN ('review','uncertain'));
DROP TRIGGER operation_guard;
DROP TRIGGER operation_apply;

CREATE TRIGGER operation_guard BEFORE INSERT ON operations WHEN NOT EXISTS(
  SELECT 1 FROM operations
  WHERE user_id=NEW.user_id AND op_id=NEW.op_id ) BEGIN
  SELECT (CASE
   WHEN NEW.action NOT IN ('register','uncertain','complete','reopen','delete')
   THEN RAISE(ABORT,'invalid_action')
  END);
   SELECT (CASE
   WHEN COALESCE(
    (SELECT version FROM entries
     WHERE user_id=NEW.user_id AND id=NEW.entry_id),0
   ) != NEW.expected
   THEN RAISE(ABORT,'version_conflict')
  END);
   SELECT (CASE
   WHEN NEW.action NOT IN ('register','uncertain')
    AND NOT EXISTS(
     SELECT 1 FROM entries
     WHERE user_id=NEW.user_id
      AND id=NEW.entry_id
      AND deleted=0
    )
   THEN RAISE(ABORT,'version_conflict')
  END); END;

CREATE TRIGGER operation_apply AFTER INSERT ON operations BEGIN
  INSERT INTO entries(
   user_id,id,target,created_at,updated_at,mark
  )
  SELECT
   NEW.user_id,NEW.entry_id,NEW.target,NEW.at,NEW.at,CASE WHEN NEW.action='uncertain' THEN 'uncertain' ELSE 'review' END
  WHERE NEW.action IN ('register','uncertain')
  ON CONFLICT(user_id,id) DO UPDATE SET
   deleted=0,
   state='todo',
   mark=excluded.mark,
   completed_at=NULL,
   updated_at=NEW.at,
   version=version+1;
   INSERT INTO history(
   user_id,op_id,entry_id,action,at
  )
  SELECT
   NEW.user_id,NEW.op_id,NEW.entry_id,NEW.action,NEW.at
  WHERE NEW.action IN ('register','uncertain')
  OR EXISTS(
   SELECT 1 FROM entries
   WHERE user_id=NEW.user_id
    AND id=NEW.entry_id
    AND (
     (NEW.action='complete' AND state='todo')
     OR (NEW.action='reopen' AND (state='done' OR mark='uncertain'))
     OR NEW.action='delete'
    )
  );
   UPDATE entries SET
   review_count=review_count+(CASE
    WHEN NEW.action='complete' AND state='todo'
    THEN 1 ELSE 0
   END),
   last_reviewed_at=(CASE
    WHEN NEW.action='complete' AND state='todo'
    THEN NEW.at ELSE last_reviewed_at
   END),
   completed_at=(CASE
    WHEN NEW.action='complete' AND state='todo'
    THEN NEW.at
    WHEN NEW.action='reopen' THEN NULL
    ELSE completed_at
   END),
   state=(CASE
    WHEN NEW.action='complete' THEN 'done'
    WHEN NEW.action='reopen' THEN 'todo'
    ELSE state
   END),
   mark=(CASE WHEN NEW.action='reopen' THEN 'review' ELSE mark END),
   deleted=(CASE
    WHEN NEW.action='delete' THEN 1
    ELSE deleted
   END),
   version=version+1,
   updated_at=NEW.at
  WHERE user_id=NEW.user_id
   AND id=NEW.entry_id
   AND NEW.action NOT IN ('register','uncertain')
   AND (
    (NEW.action='complete' AND state='todo')
    OR (NEW.action='reopen' AND (state='done' OR mark='uncertain'))
    OR NEW.action='delete'
   ); END;
