import * as cron from 'node-cron';
import { runPipeline } from './pipeline';
import { getConfig, setConfig } from './db';

let currentJob: cron.ScheduledTask | null = null;
let isRunning = false;

export function startScheduler(): void {
  if (currentJob) {
    console.log('[Scheduler] Already running, skipping start');
    return;
  }

  const cronExpression = getConfig('schedule_cron') || '0 8 * * *';
  const scheduleName = getConfig('schedule_name') || 'Daily Morning Pipeline';

  console.log(`[Scheduler] Starting with cron: "${cronExpression}" (${scheduleName})`);

  currentJob = cron.schedule(cronExpression, async () => {
    if (isRunning) {
      console.log('[Scheduler] Previous pipeline still running, skipping this execution');
      return;
    }

    console.log(`[Scheduler] Triggering pipeline at ${new Date().toISOString()}`);
    const inputFolderId = getConfig('drive_input_folder') || getConfig('drive_source_folder');
    const imageOutputFolderId = getConfig('drive_image_output_folder') || getConfig('drive_source_folder');
    const videoOutputFolderId = getConfig('drive_dest_folder');

    if (!imageOutputFolderId || !videoOutputFolderId) {
      console.error('[Scheduler] Image output or video output folder not configured');
      return;
    }

    try {
      isRunning = true;
      setConfig('last_run', new Date().toISOString());
      const result = await runPipeline(inputFolderId || '', imageOutputFolderId, videoOutputFolderId);
      setConfig('last_run_status', result.success ? 'completed' : 'failed');
      setConfig('last_run_summary', JSON.stringify(result));
      console.log(`[Scheduler] Pipeline completed: ${result.processed} processed, ${result.failed} failed`);
    } catch (error) {
      console.error('[Scheduler] Pipeline error:', error);
      setConfig('last_run_status', 'error');
      setConfig('last_run_error', String(error));
    } finally {
      isRunning = false;
    }
  }, {
    timezone: getConfig('schedule_timezone') || 'Asia/Jakarta',
  });

  console.log('[Scheduler] Started successfully');
}

export function stopScheduler(): void {
  if (currentJob) {
    currentJob.stop();
    currentJob = null;
    console.log('[Scheduler] Stopped');
  }
}

export function restartScheduler(): void {
  stopScheduler();
  startScheduler();
}

export function getSchedulerStatus(): {
  running: boolean;
  cronExpression: string | undefined;
  pipelineRunning: boolean;
  lastRun: string | undefined;
  lastRunStatus: string | undefined;
} {
  return {
    running: currentJob !== null,
    cronExpression: getConfig('schedule_cron') || '0 8 * * *',
    pipelineRunning: isRunning,
    lastRun: getConfig('last_run'),
    lastRunStatus: getConfig('last_run_status'),
  };
}
