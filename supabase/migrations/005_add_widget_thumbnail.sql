-- Add thumbnail_url column to store screenshot preview URLs
ALTER TABLE ui_widgets ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add code_hash column to track when component code changes (for re-capturing thumbnails)
ALTER TABLE ui_widgets ADD COLUMN IF NOT EXISTS code_hash TEXT;

