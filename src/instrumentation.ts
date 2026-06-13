import { startScheduler } from '@/lib/scheduler';
import { getConfig } from '@/lib/db';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('@/lib/scheduler');

    // Start the scheduler if it was running before
    const wasRunning = getConfig('scheduler_running');
    if (wasRunning !== 'false') {
      startScheduler();
    }
  }
}
