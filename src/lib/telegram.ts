import { getConfig } from './db';

/**
 * Sends a file to a Telegram bot via the Bot API.
 * Uses native fetch + FormData (Node 18+). No external library needed.
 *
 * Telegram Bot API limits: 50 MB max file size for bots.
 * https://core.telegram.org/bots/api#sendphoto
 * https://core.telegram.org/bots/api#sendvideo
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org';

interface TelegramResult {
   ok: boolean;
   description?: string;
   result?: unknown;
}

async function sendToTelegram(
   botTokenKey: string,
   chatIdKey: string,
   method: 'sendPhoto' | 'sendVideo',
   buffer: Buffer,
   fileName: string,
   caption?: string,
): Promise<boolean> {
   const token = await getConfig(botTokenKey);
   const chatId = await getConfig(chatIdKey);

   if (!token || !chatId) {
      return false; // not configured — silently skip
   }

   const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;
   const formData = new FormData();
   formData.append('chat_id', chatId);

   const fieldName = method === 'sendPhoto' ? 'photo' : 'video';
   const ext = fileName.split('.').pop() || (method === 'sendPhoto' ? 'png' : 'mp4');
   // Convert Buffer to Uint8Array for Blob compatibility
   formData.append(fieldName, new Blob([new Uint8Array(buffer)]), `${fileName}.${ext}`);

   if (caption) {
      formData.append('caption', caption);
   }

   try {
      const response = await fetch(url, { method: 'POST', body: formData });
      const result: TelegramResult = await response.json();

      if (!result.ok) {
         console.error(`[Telegram] ${method} failed:`, result.description);
         return false;
      }

      console.log(`[Telegram] ${method} sent to chat ${chatId}: ${fileName}`);
      return true;
   } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Telegram] ${method} network error:`, msg);
      return false;
   }
}

/**
 * Sends an image to the Telegram image bot.
 * Configure via `telegram_image_bot_token` and `telegram_image_chat_id` config keys.
 */
export async function sendImageToTelegram(
   buffer: Buffer,
   fileName: string,
   caption?: string,
): Promise<boolean> {
   return sendToTelegram(
      'telegram_image_bot_token',
      'telegram_image_chat_id',
      'sendPhoto',
      buffer,
      fileName,
      caption,
   );
}

/**
 * Sends a video to the Telegram video bot.
 * Configure via `telegram_video_bot_token` and `telegram_video_chat_id` config keys.
 */
export async function sendVideoToTelegram(
   buffer: Buffer,
   fileName: string,
   caption?: string,
): Promise<boolean> {
   return sendToTelegram(
      'telegram_video_bot_token',
      'telegram_video_chat_id',
      'sendVideo',
      buffer,
      fileName,
      caption,
   );
}
