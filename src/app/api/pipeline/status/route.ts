import { NextRequest, NextResponse } from 'next/server';
import { getJob, getRecentJobs, getJobStats, getDb } from '@/lib/db';
import { getSchedulerStatus } from '@/lib/scheduler';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('id');

    if (jobId) {
      const job = getJob(jobId);
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }
      return NextResponse.json({ job });
    }

    const jobs = getRecentJobs(20);
    const stats = getJobStats();
    const scheduler = getSchedulerStatus();

    return NextResponse.json({ jobs, stats, scheduler });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
