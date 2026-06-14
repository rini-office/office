import { NextRequest, NextResponse } from 'next/server';
import { executePipeline } from '@/lib/scheduler';
import { getConfig } from '@/lib/db';
import { shouldRunCron } from '@/lib/cron';

export const runtime = 'nodejs';

// Vercel Cron Job endpoint — called every 5 min, checks schedule_cron from DB
// to decide whether to actually run the pipeline.

export async function GET(request: NextRequest) {
  try {
    // Verify CRON_SECRET to prevent unauthorized access
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const schedulerRunning = await getConfig('scheduler_running');
    if (schedulerRunning === 'false') {
      return NextResponse.json({ skipped: true, reason: 'scheduler_running is false' });
    }

    // Dynamic schedule: check if it's time to run based on configured cron expression
    const cronExpression = await getConfig('schedule_cron') || '0 8 * * *';
    const lastRun = await getConfig('last_run');

    if (!shouldRunCron(cronExpression, lastRun)) {
      const nextRun = await import('@/lib/cron').then(m =>
        m.getNextCronTime(cronExpression)
      );
      return NextResponse.json({
        skipped: true,
        reason: 'Not yet time for next run',
        nextRun: nextRun.toISOString(),
      });
    }

    await executePipeline();

    const lastRunStatus = await getConfig('last_run_status') || 'unknown';
    return NextResponse.json({ success: true, status: lastRunStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Cron] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
