'use client';

import { useEffect, useState, useCallback } from 'react';

interface Job {
  id: string;
  source_file_name: string;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed';
  output_url: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

const statusColors: Record<string, string> = {
  pending: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
  queued: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  processing: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  completed: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

export default function JobList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline/status');
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
        <p className="text-zinc-500 text-sm">Loading jobs...</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Recent Jobs</h2>
        <p className="text-zinc-400 text-sm">No jobs yet. Configure settings and trigger a pipeline run.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Recent Jobs</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
              <th className="pb-3 font-medium">File</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Created</th>
              <th className="pb-3 font-medium">Completed</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-zinc-100 dark:border-zinc-800/50">
                <td className="py-3 pr-4 text-zinc-900 dark:text-zinc-100 max-w-xs truncate">
                  {job.source_file_name}
                </td>
                <td className="py-3 pr-4">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[job.status] || statusColors.pending}`}>
                    {job.status}
                  </span>
                  {job.error && (
                    <span className="block text-xs text-red-500 mt-1 truncate max-w-[200px]" title={job.error}>
                      {job.error}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-zinc-500 text-xs whitespace-nowrap">
                  {formatTime(job.created_at)}
                </td>
                <td className="py-3 text-zinc-500 text-xs whitespace-nowrap">
                  {job.completed_at ? formatTime(job.completed_at) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
