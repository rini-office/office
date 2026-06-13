import { NextRequest, NextResponse } from 'next/server';
import { handleAuthCallback } from '@/lib/drive';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    await handleAuthCallback(code);

    // Redirect back to main page after successful auth
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${appUrl}?drive_connected=true`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${appUrl}?drive_error=${encodeURIComponent(message)}`);
  }
}
