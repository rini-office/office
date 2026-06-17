import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/db';
import { uploadFile } from '@/lib/drive';
import { downloadTelegramFile } from '@/lib/telegram';
import { executePipeline } from '@/lib/scheduler';

export const runtime = 'nodejs';

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number | string };
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      file_size?: number;
    }>;
    caption?: string;
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
    };
  };
}

export async function POST(request: NextRequest) {
  try {
    const secretHeader = request.headers.get('x-telegram-bot-api-secret-token');
    if (TELEGRAM_WEBHOOK_SECRET && secretHeader !== TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: TelegramUpdate = await request.json();
    console.log('[TelegramInput] Update:', JSON.stringify(body).substring(0, 500));

    const message = body.message;
    if (!message) {
      return NextResponse.json({ ok: true, note: 'no message' });
    }

    // Verify chat ID matches the configured input chat
    const expectedChatId = await getConfig('telegram_input_chat_id');
    if (expectedChatId && String(message.chat.id) !== expectedChatId) {
      console.log(`[TelegramInput] Ignoring message from chat ${message.chat.id} (expected ${expectedChatId})`);
      return NextResponse.json({ ok: true, note: 'wrong chat' });
    }

    // Determine file source: photo or document
    let fileId: string | null = null;
    let fileName: string | null = null;

    if (message.photo && message.photo.length > 0) {
      // Get the largest photo (last in array)
      const largest = message.photo[message.photo.length - 1];
      fileId = largest.file_id;
      fileName = `telegram_photo_${Date.now()}.jpg`;
    } else if (message.document?.mime_type?.startsWith('image/')) {
      fileId = message.document.file_id;
      fileName = message.document.file_name || `telegram_doc_${Date.now()}.jpg`;
    }

    if (!fileId) {
      return NextResponse.json({ ok: true, note: 'no image in message' });
    }

    // Download from Telegram
    const downloaded = await downloadTelegramFile(fileId, 'telegram_input_bot_token');
    if (!downloaded) {
      console.error('[TelegramInput] Failed to download file');
      return NextResponse.json({ ok: false, error: 'download failed' }, { status: 500 });
    }

    // Upload to Drive input folder
    const inputFolderId = await getConfig('drive_input_folder');
    if (!inputFolderId) {
      console.error('[TelegramInput] drive_input_folder not configured');
      return NextResponse.json({ ok: false, error: 'input folder not configured' }, { status: 500 });
    }

    const uploadedId = await uploadFile(inputFolderId, fileName!, downloaded.buffer, 'image/jpeg');
    console.log(`[TelegramInput] Uploaded to Drive: ${fileName} (${uploadedId})`);

    // Trigger pipeline immediately
    try {
      await executePipeline();
      console.log('[TelegramInput] Pipeline triggered');
    } catch (err) {
      console.error('[TelegramInput] Pipeline trigger error (file uploaded, pipeline will retry):', err);
    }

    return NextResponse.json({ ok: true, fileId: uploadedId, fileName });
  } catch (error) {
    console.error('[TelegramInput] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
