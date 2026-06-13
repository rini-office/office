import { NextRequest, NextResponse } from 'next/server';
import { updateJob, getJob } from '@/lib/db';
import { downloadVideo } from '@/lib/kie';
import { uploadFile } from '@/lib/drive';
import { getConfig } from '@/lib/db';

export const runtime = 'nodejs';

interface KieWebhookPayload {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    state: string;
    resultJson?: string;
    failMsg?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: KieWebhookPayload = await request.json();
    console.log('[Webhook] Received KIE callback:', JSON.stringify(body).substring(0, 300));

    const taskId = body.data?.taskId;
    if (!taskId) {
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
    }

    // Find the job by kie_task_id
    const { getDb } = await import('@/lib/db');
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE kie_task_id = ?').get(taskId) as {
      id: string;
      source_file_name: string;
      image_output_file_id: string | null;
      status: string;
    } | undefined;

    if (!job) {
      console.log(`[Webhook] No job found for KIE task: ${taskId}`);
      return NextResponse.json({ received: true, note: 'no matching job' });
    }

    const state = body.data?.state || '';

    if (state === 'success' && body.data?.resultJson) {
      try {
        const parsed = JSON.parse(body.data.resultJson);
        const outputUrls: string[] = parsed.resultUrls || [];

        if (outputUrls.length > 0) {
          const videoUrl = outputUrls[0];
          updateJob(job.id, {
            status: 'completed',
            output_url: videoUrl,
          });

          // Auto-upload to Google Drive destination folder
          const destFolderId = getConfig('drive_dest_folder');
          if (destFolderId) {
            try {
              const videoBuffer = await downloadVideo(videoUrl);
              const videoName = job.source_file_name.replace(/\.[^.]+$/, '') + '_video.mp4';
              const uploadedFileId = await uploadFile(destFolderId, videoName, videoBuffer, 'video/mp4');
              updateJob(job.id, {
                output_file_id: uploadedFileId,
                completed_at: new Date().toISOString(),
              });
              console.log(`[Webhook] Uploaded video to Drive: ${videoName}`);
            } catch (uploadErr) {
              console.error('[Webhook] Failed to upload to Drive:', uploadErr);
              updateJob(job.id, {
                completed_at: new Date().toISOString(),
              });
            }
          } else {
            updateJob(job.id, {
              completed_at: new Date().toISOString(),
            });
          }
          console.log(`[Webhook] Job ${job.id} completed successfully`);
        }
      } catch (parseErr) {
        console.error('[Webhook] Failed to parse resultJson:', parseErr);
      }
    } else if (state === 'fail' || body.data?.failMsg) {
      updateJob(job.id, {
        status: 'failed',
        error: body.data?.failMsg || 'Generation failed',
        completed_at: new Date().toISOString(),
      });
      console.log(`[Webhook] Job ${job.id} failed: ${body.data?.failMsg}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
