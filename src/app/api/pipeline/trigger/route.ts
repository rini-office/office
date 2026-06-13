import { NextRequest, NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pipeline';
import { getConfig } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const pipelineMode = getConfig('pipeline_mode') || 'image-to-image';
    const inputFolderId = getConfig('drive_input_folder') || getConfig('drive_source_folder');
    const imageOutputFolderId = getConfig('drive_image_output_folder') || getConfig('drive_source_folder');
    const videoOutputFolderId = getConfig('drive_dest_folder');

    if (pipelineMode === 'image-to-image') {
      if (!inputFolderId || !imageOutputFolderId || !videoOutputFolderId) {
        return NextResponse.json(
          { error: 'Input folder, image output folder, or video output folder not configured. Please set them in Settings.' },
          { status: 400 }
        );
      }
    } else {
      if (!imageOutputFolderId || !videoOutputFolderId) {
        return NextResponse.json(
          { error: 'Image output folder or video output folder not configured. Please set them in Settings.' },
          { status: 400 }
        );
      }
    }

    const result = await runPipeline(inputFolderId || '', imageOutputFolderId, videoOutputFolderId);

    return NextResponse.json({
      success: result.success,
      processed: result.processed,
      failed: result.failed,
      errors: result.errors,
      jobIds: result.jobIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
