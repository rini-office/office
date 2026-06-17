import { NextRequest, NextResponse } from 'next/server';
import { setTelegramWebhook, deleteTelegramWebhook, getTelegramWebhookInfo } from '@/lib/telegram';

export const runtime = 'nodejs';

/**
 * GET  ?action=register → register webhook
 * GET  (no param)       → show current webhook status
 * POST                  → register webhook
 * DELETE                → remove webhook
 */
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action');

  // One-click register from browser
  if (action === 'register') {
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const webhookUrl = `${appUrl}/api/webhook/telegram`;
      const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

      if (appUrl.includes('localhost')) {
        return NextResponse.json({ error: 'Cannot register webhook on localhost. Deploy to Vercel first.' }, { status: 400 });
      }

      const success = await setTelegramWebhook(webhookUrl, webhookSecret);
      const info = await getTelegramWebhookInfo();

      return NextResponse.json({
        success,
        webhookUrl,
        message: success
          ? '✅ Webhook registered! Telegram will send updates here.'
          : '❌ Failed to set webhook. Check telegram_image_bot_token.',
        info,
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // Default: show status
  try {
    const info = await getTelegramWebhookInfo();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.json({
      webhookUrl: `${appUrl}/api/webhook/telegram`,
      info,
      tip: 'Add ?action=register to this URL to set up the webhook.',
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const webhookUrl = `${appUrl}/api/webhook/telegram`;
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

    if (appUrl.includes('localhost')) {
      return NextResponse.json({
        error: 'Cannot register webhook on localhost. Deploy to Vercel first.',
      }, { status: 400 });
    }

    const success = await setTelegramWebhook(webhookUrl, webhookSecret);

    if (success) {
      return NextResponse.json({
        success: true,
        webhookUrl,
        message: 'Webhook registered. Telegram will now send updates to this URL.',
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'Failed to set webhook. Check that telegram_image_bot_token is configured correctly.',
      }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const success = await deleteTelegramWebhook();
    return NextResponse.json({
      success,
      message: success ? 'Webhook removed' : 'Failed to remove webhook',
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
