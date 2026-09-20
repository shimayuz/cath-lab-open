PRAGMA foreign_keys=ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY,
 customer_id TEXT UNIQUE,
 recovery_hash TEXT NOT NULL UNIQUE,
 pending_recovery_hash TEXT,
 auth_epoch INTEGER NOT NULL DEFAULT 0,
 recovery_confirmed INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE TABLE credentials (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 auth_epoch INTEGER NOT NULL,
 public_key TEXT NOT NULL,
 counter INTEGER NOT NULL,
 transports TEXT NOT NULL
);
CREATE INDEX credentials_user ON credentials(user_id);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 auth_epoch INTEGER NOT NULL,
 issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE challenges (
 token_hash TEXT PRIMARY KEY,
 auth_epoch INTEGER NOT NULL,
 challenge TEXT NOT NULL,
 kind TEXT NOT NULL,
 user_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX challenges_expiry ON challenges(expires_at);
CREATE TABLE quotas (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX quotas_expiry ON quotas(expires_at);
CREATE TABLE checkout_leases (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 lock_token TEXT NOT NULL,
 lock_until INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL,
 session_id TEXT
);
CREATE TABLE billing_events (
 id TEXT PRIMARY KEY,
 type TEXT NOT NULL,
 received_at INTEGER NOT NULL
);
CREATE TABLE entitlements (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 active INTEGER NOT NULL,
 checked_at INTEGER NOT NULL
);
-- One conditional INSERT reserves all limits atomically; trigger leaves only counters.
CREATE TABLE jev_reservations (id TEXT PRIMARY KEY, user_second TEXT, global_minute TEXT, user_month TEXT, global_month TEXT, expires_at INTEGER);
CREATE TRIGGER reserve_jev AFTER INSERT ON jev_reservations BEGIN
 INSERT INTO quotas(key,count,expires_at) VALUES(NEW.user_second,1,unixepoch()+2) ON CONFLICT(key) DO UPDATE SET count=count+1;
 INSERT INTO quotas(key,count,expires_at) VALUES(NEW.global_minute,1,unixepoch()+120) ON CONFLICT(key) DO UPDATE SET count=count+1;
 INSERT INTO quotas(key,count,expires_at) VALUES(NEW.user_month,1,NEW.expires_at) ON CONFLICT(key) DO UPDATE SET count=count+1;
 INSERT INTO quotas(key,count,expires_at) VALUES(NEW.global_month,1,NEW.expires_at) ON CONFLICT(key) DO UPDATE SET count=count+1;
 DELETE FROM jev_reservations WHERE id=NEW.id;
END;
