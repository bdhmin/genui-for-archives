-- Create storage bucket for widget thumbnails
-- Note: This needs to be run with storage admin privileges or done via Supabase Dashboard

-- Create the bucket (if using SQL - alternatively do this in Supabase Dashboard > Storage)
INSERT INTO storage.buckets (id, name, public)
VALUES ('widget-thumbnails', 'widget-thumbnails', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to thumbnails
CREATE POLICY "Public read access for widget thumbnails"
ON storage.objects FOR SELECT
USING (bucket_id = 'widget-thumbnails');

-- Allow authenticated uploads (via service role key from API)
CREATE POLICY "Service role upload access for widget thumbnails"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'widget-thumbnails');

-- Allow updates/deletes for service role
CREATE POLICY "Service role update access for widget thumbnails"
ON storage.objects FOR UPDATE
USING (bucket_id = 'widget-thumbnails');

CREATE POLICY "Service role delete access for widget thumbnails"
ON storage.objects FOR DELETE
USING (bucket_id = 'widget-thumbnails');

