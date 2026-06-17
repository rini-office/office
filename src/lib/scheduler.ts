import { runPipeline } from './pipeline';
import { getConfig, setConfig } from './db';

/**
 * Runs the full pipeline: scans input folder, processes images, generates videos.
 * Triggered by Telegram input webhook (replaces old cron scheduler).
 */
export async function executePipeline(): Promise<void> {
  console.log(`[Pipeline] Triggered at ${new Date().toISOString()}`);

  const inputFolderId = await getConfig('drive_input_folder') || await getConfig('drive_source_folder');
  const imageOutputFolderId = await getConfig('drive_image_output_folder') || await getConfig('drive_source_folder');
  const videoOutputFolderId = await getConfig('drive_dest_folder');

  if (!imageOutputFolderId || !videoOutputFolderId) {
    console.error('[Pipeline] Image output or video output folder not configured');
    return;
  }

  try {
    await setConfig('last_run', new Date().toISOString());
    const result = await runPipeline(inputFolderId || '', imageOutputFolderId, videoOutputFolderId);
    await setConfig('last_run_status', result.success ? 'completed' : 'failed');
    console.log(`[Pipeline] Completed: ${result.processed} processed, ${result.failed} failed`);
  } catch (error) {
    console.error('[Pipeline] Error:', error);
    await setConfig('last_run_status', 'error');
    await setConfig('last_run_error', String(error));
  }
}
