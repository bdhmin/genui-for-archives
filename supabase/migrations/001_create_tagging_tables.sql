-- Migration: Create tagging system tables
-- Run this in your Supabase SQL editor

-- Round 1 tags: descriptive sentence tags per conversation
CREATE TABLE IF NOT EXISTS conversation_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,  -- e.g., "The user wants to know the calorie count of their meal..."
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Round 2 tags: higher-level pattern tags across conversations
CREATE TABLE IF NOT EXISTS global_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag TEXT NOT NULL UNIQUE,  -- e.g., "Needs to know calorie count of a meal"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Junction table: links conversations to global tags
CREATE TABLE IF NOT EXISTS conversation_global_tags (
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  global_tag_id UUID REFERENCES global_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, global_tag_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_conversation_tags_conversation_id ON conversation_tags(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_global_tags_conversation_id ON conversation_global_tags(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_global_tags_global_tag_id ON conversation_global_tags(global_tag_id);

-- Enable RLS (Row Level Security) - adjust policies as needed
ALTER TABLE conversation_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_global_tags ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for edge functions)
CREATE POLICY "Service role full access to conversation_tags" ON conversation_tags
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to global_tags" ON global_tags
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to conversation_global_tags" ON conversation_global_tags
  FOR ALL USING (true) WITH CHECK (true);

