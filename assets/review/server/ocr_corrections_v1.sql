CREATE TABLE IF NOT EXISTS ocr_corrections (
 id TEXT PRIMARY KEY,
 page TEXT NOT NULL,
 no INTEGER NOT NULL,
 rect TEXT NOT NULL,
 text TEXT NOT NULL,
 original TEXT NOT NULL,
 version INTEGER NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
