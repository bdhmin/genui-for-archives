-- Add last_opened_at column to track when widgets were last viewed/used
ALTER TABLE ui_widgets ADD COLUMN last_opened_at TIMESTAMPTZ DEFAULT NOW();

-- Update existing widgets to have last_opened_at set to their created_at
UPDATE ui_widgets SET last_opened_at = COALESCE(updated_at, created_at, NOW());

-- Create index for sorting by last_opened_at
CREATE INDEX idx_ui_widgets_last_opened ON ui_widgets(last_opened_at DESC);

