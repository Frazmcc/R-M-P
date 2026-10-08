-- Rate My Poo: converted WebP only; never persist an uploaded original.
-- All images remain private until moderated. Safe on a new, empty Neon project.
CREATE TABLE IF NOT EXISTS entries (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(90) NOT NULL,
  nickname VARCHAR(35) NOT NULL DEFAULT 'Anonymous',
  created BIGINT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  image BYTEA,
  image_sha VARCHAR(64) NOT NULL,
  ip_hash VARCHAR(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_status_created_idx ON entries(status, created DESC);
CREATE INDEX IF NOT EXISTS entries_source_limiter_idx ON entries(ip_hash, created DESC);
CREATE INDEX IF NOT EXISTS entries_sha_idx ON entries(image_sha);
CREATE TABLE IF NOT EXISTS votes (
  id BIGSERIAL PRIMARY KEY,
  entry_id BIGINT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  voter_hash VARCHAR(64) NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  UNIQUE (entry_id, voter_hash)
);
CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  entry_id BIGINT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  reporter_hash VARCHAR(64) NOT NULL,
  reason VARCHAR(200) NOT NULL,
  created BIGINT NOT NULL,
  UNIQUE (entry_id, reporter_hash)
);
