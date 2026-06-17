import { NextRequest, NextResponse } from 'next/server';
import { getAllConfig, setConfig } from '@/lib/db';
import { isAuthenticated, listFolders } from '@/lib/drive';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const config = await getAllConfig();
    const driveReady = await isAuthenticated();

    let folders: { id: string; name: string }[] = [];
    if (driveReady) {
      try {
        folders = await listFolders();
      } catch {
        // Folders might not be loadable if token expired
      }
    }

    return NextResponse.json({
      config: {
        kie_api_key: config.kie_api_key ? '••••••••' : '',
        image_model: config.image_model || 'nano-banana-2',
        drive_input_folder: config.drive_input_folder || config.drive_source_folder || '',
        drive_image_output_folder: config.drive_image_output_folder || config.drive_source_folder || '',
        drive_dest_folder: config.drive_dest_folder || '',
        default_image_to_image_prompt: config.default_image_to_image_prompt || '',
        image_resolution: config.image_resolution || '1K',
        image_aspect_ratio: config.image_aspect_ratio || 'auto',
        image_output_format: config.image_output_format || 'jpg',
        default_prompt: config.default_prompt || '',
        default_duration: config.default_duration || '10',
        google_client_id: config.google_client_id || '',
        google_client_secret: config.google_client_secret ? '••••••••' : '',
        telegram_image_bot_token: config.telegram_image_bot_token ? '••••••••' : '',
        telegram_image_chat_id: config.telegram_image_chat_id || '',
        telegram_video_bot_token: config.telegram_video_bot_token ? '••••••••' : '',
        telegram_video_chat_id: config.telegram_video_chat_id || '',
        telegram_input_bot_token: config.telegram_input_bot_token ? '••••••••' : '',
        telegram_input_chat_id: config.telegram_input_chat_id || '',
      },
      driveReady,
      folders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const fields = [
      'kie_api_key',
      'image_model',
      'google_client_id',
      'google_client_secret',
      'drive_source_folder',
      'drive_input_folder',
      'drive_image_output_folder',
      'drive_dest_folder',
      'default_image_to_image_prompt',
      'image_resolution',
      'image_aspect_ratio',
      'image_output_format',
      'default_prompt',
      'default_duration',
      'telegram_image_bot_token',
      'telegram_image_chat_id',
      'telegram_video_bot_token',
      'telegram_video_chat_id',
      'telegram_input_bot_token',
      'telegram_input_chat_id',
    ];

    for (const field of fields) {
      if (body[field] !== undefined && body[field] !== '' && !body[field].includes('••••')) {
        await setConfig(field, body[field]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
