import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = {
  params: Promise<{ id: string }>;
};

// POST: Upload thumbnail for a widget
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { imageData, codeHash } = body as { 
      imageData: string; // base64 encoded PNG
      codeHash: string;  // hash of component code to track changes
    };

    if (!imageData) {
      return NextResponse.json({ error: 'imageData is required' }, { status: 400 });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const supabase = getSupabaseServerClient();

    // Verify widget exists
    const { data: widget, error: widgetError } = await supabase
      .from('ui_widgets')
      .select('id, code_hash')
      .eq('id', id)
      .single();

    if (widgetError || !widget) {
      return NextResponse.json({ error: 'Widget not found' }, { status: 404 });
    }

    // Skip if code hash matches (thumbnail already up to date)
    if (widget.code_hash === codeHash) {
      return NextResponse.json({ success: true, skipped: true, message: 'Thumbnail already up to date' });
    }

    // Convert base64 to buffer
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique filename
    const filename = `${id}-${Date.now()}.png`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('widget-thumbnails')
      .upload(filename, buffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) {
      console.error(`[Thumbnail API] Error uploading thumbnail for ${id}:`, uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('widget-thumbnails')
      .getPublicUrl(filename);

    const thumbnailUrl = urlData.publicUrl;

    // Update widget with thumbnail URL and code hash
    const { error: updateError } = await supabase
      .from('ui_widgets')
      .update({ 
        thumbnail_url: thumbnailUrl,
        code_hash: codeHash,
      })
      .eq('id', id);

    if (updateError) {
      console.error(`[Thumbnail API] Error updating widget ${id}:`, updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Delete old thumbnails for this widget (cleanup)
    const { data: files } = await supabase.storage
      .from('widget-thumbnails')
      .list('', {
        search: id,
      });

    if (files && files.length > 1) {
      // Keep only the newest file
      const oldFiles = files
        .filter(f => f.name !== filename)
        .map(f => f.name);
      
      if (oldFiles.length > 0) {
        await supabase.storage
          .from('widget-thumbnails')
          .remove(oldFiles);
      }
    }

    return NextResponse.json({ 
      success: true, 
      thumbnailUrl,
    });
  } catch (error) {
    console.error('[Thumbnail API] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to upload thumbnail' }, { status: 500 });
  }
}

