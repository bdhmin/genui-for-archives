-- Migration: Add widget_id column to conversations table
-- This allows widget-editing conversations to be linked to their respective widgets

-- Add widget_id column to conversations table
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS widget_id UUID REFERENCES ui_widgets(id) ON DELETE SET NULL;

-- Create index for efficient lookups of conversations by widget
CREATE INDEX IF NOT EXISTS idx_conversations_widget_id ON conversations(widget_id);

-- Add comment for documentation
COMMENT ON COLUMN conversations.widget_id IS 'Links this conversation to a widget for widget-editing chat sessions';

