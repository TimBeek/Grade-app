-- Additive diagnostics only: never alter operational records or old providers.
ALTER TABLE remarkt_backup_health ADD COLUMN IF NOT EXISTS mirror_configured boolean NOT NULL DEFAULT false;
ALTER TABLE remarkt_backup_health ADD COLUMN IF NOT EXISTS mirror_verified_at timestamptz;
ALTER TABLE remarkt_backup_health ADD COLUMN IF NOT EXISTS mirror_error boolean NOT NULL DEFAULT false;
