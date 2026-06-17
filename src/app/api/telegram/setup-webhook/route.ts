import { NextRequest, NextResponse } from 'next/server';
import { setTelegramWebhook, deleteTelegramWebhook, getTelegramWebhookInfo } from '@/lib/telegram';

export const runtime = 'nodejs';

/**
 * Unified Telegram webhook management page.
 *
 * ?action=register-image   → register image bot webhook (callback_query only)
 * ?action=reset-image      → delete + re-register image bot
 * ?action=delete-image     → delete image bot webhook
 *
 * ?action=register-input   → register input bot webhook (message only)
 * ?action=reset-input      → delete + re-register input bot
 * ?action=delete-input     → delete input bot webhook
 */
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

  if (appUrl.includes('localhost')) {
    const info = await getTelegramWebhookInfo();
    return new NextResponse(
      `<html><body style="color:#fff;background:#111;font-family:system-ui;padding:20px">
        <h2>Localhost — webhook tidak bisa didaftarkan</h2>
        <p>Deploy ke Vercel dulu, lalu buka halaman ini di production URL.</p>
        <pre>${JSON.stringify(info, null, 2)}</pre>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // ── Image bot actions ──
  if (action === 'register-image') {
    const webhookUrl = `${appUrl}/api/webhook/telegram`;
    const ok = await setTelegramWebhook(webhookUrl, webhookSecret, 'telegram_image_bot_token', ['callback_query']);
    const info = await getTelegramWebhookInfo();
    return NextResponse.json({ bot: 'image', action: 'register', success: ok, webhookUrl, info });
  }
  if (action === 'reset-image') {
    await deleteTelegramWebhook();
    await new Promise(r => setTimeout(r, 500));
    const ok = await setTelegramWebhook(`${appUrl}/api/webhook/telegram`, webhookSecret, 'telegram_image_bot_token', ['callback_query']);
    const info = await getTelegramWebhookInfo();
    return NextResponse.json({ bot: 'image', action: 'reset', success: ok, info });
  }
  if (action === 'delete-image') {
    const ok = await deleteTelegramWebhook();
    return NextResponse.json({ bot: 'image', action: 'delete', success: ok });
  }

  // ── Input bot actions ──
  if (action === 'register-input') {
    const webhookUrl = `${appUrl}/api/webhook/telegram-input`;
    const ok = await setTelegramWebhook(webhookUrl, webhookSecret, 'telegram_input_bot_token', ['message']);
    const info = await getTelegramWebhookInfo('telegram_input_bot_token');
    return NextResponse.json({ bot: 'input', action: 'register', success: ok, webhookUrl, info });
  }
  if (action === 'reset-input') {
    await deleteTelegramWebhook('telegram_input_bot_token');
    await new Promise(r => setTimeout(r, 500));
    const ok = await setTelegramWebhook(`${appUrl}/api/webhook/telegram-input`, webhookSecret, 'telegram_input_bot_token', ['message']);
    const info = await getTelegramWebhookInfo('telegram_input_bot_token');
    return NextResponse.json({ bot: 'input', action: 'reset', success: ok, info });
  }
  if (action === 'delete-input') {
    const ok = await deleteTelegramWebhook('telegram_input_bot_token');
    return NextResponse.json({ bot: 'input', action: 'delete', success: ok });
  }

  // ── Diagnostic page ──
  const [imageInfo, inputInfo] = await Promise.all([
    getTelegramWebhookInfo().catch(() => null),
    getTelegramWebhookInfo('telegram_input_bot_token').catch(() => null),
  ]);

  const html = renderPage(appUrl, webhookSecret, imageInfo, inputInfo);
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function renderPage(
  appUrl: string,
  secretSet: string,
  imageInfo: Record<string, unknown> | null,
  inputInfo: Record<string, unknown> | null,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telegram Webhook Setup</title>
<style>
  * { box-sizing:border-box }
  body { font-family:system-ui; max-width:750px; margin:30px auto; padding:16px; background:#111; color:#eee }
  h1 { font-size:1.3em; margin-bottom:4px }
  .sub { color:#888; font-size:.85em; margin-bottom:20px }
  .bot-card { background:#1a1a2e; border:1px solid #333; border-radius:8px; padding:16px; margin:14px 0 }
  .bot-card h2 { margin-top:0; font-size:1.1em }
  .ok { color:#4caf50 } .warn { color:#ff9800 } .err { color:#f44336 }
  .mono { font-family:monospace; font-size:.85em; word-break:break-all }
  .btn { display:inline-block; padding:7px 14px; margin:3px; border-radius:4px; text-decoration:none; font-weight:600; font-size:.85em }
  .btn-go { background:#4caf50; color:#fff } .btn-warn { background:#ff9800; color:#000 } .btn-danger { background:#f44336; color:#fff }
  table { width:100%; border-collapse:collapse; margin:10px 0 }
  td { padding:5px 8px; border-bottom:1px solid #333 }
  td:first-child { color:#999; width:140px }
</style>
</head>
<body>
<h1>🔧 Telegram Webhook Manager</h1>
<p class="sub">${appUrl}</p>

${botCard('🖼️ Image Bot (output)', 'telegram_image_bot_token', 'telegram_image_chat_id', `${appUrl}/api/webhook/telegram`, 'callback_query', imageInfo, 'image')}

${botCard('📥 Input Bot (receive photos)', 'telegram_input_bot_token', 'telegram_input_chat_id', `${appUrl}/api/webhook/telegram-input`, 'message', inputInfo, 'input')}

<p style="color:#666;font-size:.8em;margin-top:24px">
  TELEGRAM_WEBHOOK_SECRET: ${secretSet ? '<span class="ok">set ✅</span>' : '<span class="warn">not set ⚠️</span>'}
</p>
</body>
</html>`;
}

function botCard(
  title: string,
  tokenKey: string,
  chatKey: string,
  webhookUrl: string,
  allowed: string,
  info: Record<string, unknown> | null,
  botId: string,
): string {
  const result = (info as Record<string, unknown> | undefined)?.result as Record<string, unknown> | undefined;
  const hasUrl = !!result?.url;
  const hasCallback = ((result?.allowed_updates as string[]) || []).includes(allowed);
  const lastErr = result?.last_error_message as string | undefined;

  let diagnosis = '';
  if (!result) {
    diagnosis = '<span class="err">❌ Webhook tidak terdaftar</span>';
  } else if (!hasUrl) {
    diagnosis = '<span class="err">❌ URL kosong</span>';
  } else if (!hasCallback) {
    diagnosis = `<span class="err">❌ allowed_updates tidak termasuk "${allowed}"!</span>`;
  } else if (lastErr) {
    diagnosis = `<span class="warn">⚠️ Last error: ${lastErr}</span>`;
  } else {
    diagnosis = '<span class="ok">✅ OK</span>';
  }

  return `<div class="bot-card">
<h2>${title}</h2>
<table>
<tr><td>Token key</td><td class="mono">${tokenKey}</td></tr>
<tr><td>Chat key</td><td class="mono">${chatKey}</td></tr>
<tr><td>Webhook URL</td><td class="mono">${webhookUrl}</td></tr>
<tr><td>Allowed updates</td><td class="mono">${JSON.stringify(result?.allowed_updates || [])}</td></tr>
<tr><td>Pending</td><td>${result?.pending_update_count ?? '?'}</td></tr>
<tr><td>Last error</td><td>${lastErr ? `<span class="err">${lastErr}</span>` : '<span class="ok">none</span>'}</td></tr>
<tr><td>Diagnosis</td><td>${diagnosis}</td></tr>
</table>
<a class="btn btn-go" href="?action=register-${botId}">Register</a>
<a class="btn btn-warn" href="?action=reset-${botId}">Full Reset</a>
<a class="btn btn-danger" href="?action=delete-${botId}">Delete</a>
</div>`;
}
