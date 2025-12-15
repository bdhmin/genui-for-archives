-- UI Widgets: Generated React components for each global tag
CREATE TABLE ui_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_tag_id UUID UNIQUE REFERENCES global_tags(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  component_code TEXT NOT NULL,
  data_schema JSONB NOT NULL,
  dependencies JSONB DEFAULT '{}',
  status TEXT DEFAULT 'generating' CHECK (status IN ('generating', 'active', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Widget Data: The actual data displayed/edited in each widget
CREATE TABLE ui_widget_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_id UUID REFERENCES ui_widgets(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_ui_widgets_global_tag ON ui_widgets(global_tag_id);
CREATE INDEX idx_ui_widgets_status ON ui_widgets(status);
CREATE INDEX idx_ui_widget_data_widget ON ui_widget_data(widget_id);
CREATE INDEX idx_ui_widget_data_conversation ON ui_widget_data(source_conversation_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_widget_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER trigger_ui_widgets_updated_at
  BEFORE UPDATE ON ui_widgets
  FOR EACH ROW
  EXECUTE FUNCTION update_widget_updated_at();

CREATE TRIGGER trigger_ui_widget_data_updated_at
  BEFORE UPDATE ON ui_widget_data
  FOR EACH ROW
  EXECUTE FUNCTION update_widget_updated_at();

