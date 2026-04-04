-- v3.2 Migration: Add trailing stop support
-- Run: node .\node_modules\wrangler\bin\wrangler.js d1 execute ymsa-db --remote --file=src/db/migrate-v3.2.sql

-- Add trailing_state column to trades (stores JSON TrailingState)
ALTER TABLE trades ADD COLUMN trailing_state TEXT;
