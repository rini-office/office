import { NextRequest, NextResponse } from 'next/server';
import { getDb, updateJob } from '@/lib/db';
import { checkTaskStatus } from '@/lib/kie';

export const runtime = 'nodejs';

// GET: check stuck job status via KIE API
// POST: reset processed file or stuck job
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 });
    }

    const result = await checkTaskStatus(taskId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const db = getDb();

    if (body.action === 'reset_processed') {
      const fileId = body.fileId;
      if (!fileId) {
        return NextResponse.json({ error: 'fileId required' }, { status: 400 });
      }
      db.prepare('DELETE FROM processed_files WHERE file_id = ?').run(fileId);
      return NextResponse.json({ success: true, message: `File ${fileId} reset` });
    }

    if (body.action === 'retry_job') {
      const jobId = body.jobId;
      if (!jobId) {
        return NextResponse.json({ error: 'jobId required' }, { status: 400 });
      }
      updateJob(jobId, { status: 'pending', error: null, kie_task_id: null });
      return NextResponse.json({ success: true, message: `Job ${jobId} reset to pending` });
    }

    if (body.action === 'clear_all') {
      db.exec('DELETE FROM jobs');
      db.exec('DELETE FROM processed_files');
      return NextResponse.json({ success: true, message: 'All jobs and processed files cleared' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
