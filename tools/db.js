// zeph — local workflow database (single-file SQLite, zero install).
//
// Uses Node's built-in SQLite (node:sqlite, needs --experimental-sqlite).
// The database is a single file `zeph.db` at the repo root. It is gitignored;
// `zeph export` writes a committable books.json snapshot for version control.
//
// The DB never OWNS the book files — it only references where they already sit
// on disk (register-in-place). Nothing is moved or copied by importing.

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.join(__dirname, "..");
const DB_PATH = process.env.ZEPH_DB || path.join(ROOT, "zeph.db");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS book (
    id         TEXT PRIMARY KEY,   -- stable slug, e.g. "grade-2-english-lb"
    title      TEXT NOT NULL,      -- human title derived from the manuscript name
    grade      TEXT,               -- "Grade 2" | "Form 4" | null
    subject    TEXT,               -- from overrides.subject / theme
    kind       TEXT,               -- "LB" (learner) | "TG" (teacher)
    author     TEXT,               -- overrides.authors joined
    theme      TEXT,               -- engine theme (autoTheme)
    state      TEXT DEFAULT 'drafting',  -- see STATES below
    page_cap   INTEGER,            -- CDC page ceiling if known
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS version (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id       TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,   -- manuscript | overrides | typeset_pdf
                                   --   | annotated_pdf | corrections_log
    original_name TEXT,            -- filename as it arrived
    stored_path   TEXT,            -- absolute path where the file lives now
    hash          TEXT,            -- sha256 of contents (identity, not filename)
    note          TEXT,
    ingested_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS round (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id         TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
    number          INTEGER NOT NULL,        -- 1, 2, 3 … per book
    sent_version    INTEGER REFERENCES version(id),   -- what we sent out
    returned_version INTEGER REFERENCES version(id),  -- annotated file we got back
    sent_at         TEXT,
    returned_at     TEXT,
    status          TEXT DEFAULT 'open'      -- open | applying | closed
  );

  CREATE TABLE IF NOT EXISTS comment (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id  INTEGER NOT NULL REFERENCES round(id) ON DELETE CASCADE,
    page_ref  TEXT,        -- page as cited by the reviewer
    anchor    TEXT,        -- quoted/highlighted text the note attaches to
    note      TEXT,        -- the reviewer's comment
    action    TEXT,        -- how we resolved it (override key, edit, flag…)
    status    TEXT DEFAULT 'pending'   -- pending | done | flagged | wontfix
  );

  CREATE INDEX IF NOT EXISTS idx_version_book ON version(book_id);
  CREATE INDEX IF NOT EXISTS idx_round_book   ON round(book_id);
  CREATE INDEX IF NOT EXISTS idx_comment_round ON comment(round_id);
`);

// Book lifecycle states, in order.
const STATES = [
  "drafting",           // manuscript in hand, not yet typeset
  "typesetting",        // being laid out
  "sent-for-proofread", // typeset PDF sent to reviewer
  "returned",           // annotated copy came back
  "applying-corrections",
  "approved",
  "published",
];

module.exports = { db, DB_PATH, ROOT, STATES };
