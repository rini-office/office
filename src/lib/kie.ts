import { getConfig } from './db';

const KIE_API_BASE = 'https://api.kie.ai';

interface KieApiResponse {
  code: number;
  msg: string;
  data?: {
    taskId?: string;
    state?: string;
    resultJson?: string;
    failMsg?: string;
    progress?: number;
    creditsConsumed?: number;
  };
}

function getApiKey(): string {
  const key = getConfig('kie_api_key');
  if (!key) {
    throw new Error('KIE API key not configured. Please set kie_api_key in settings.');
  }
  return key;
}

async function kieGet(endpoint: string): Promise<KieApiResponse> {
  const response = await fetch(`${KIE_API_BASE}${endpoint}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`KIE API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function kiePost(endpoint: string, body: Record<string, unknown>): Promise<KieApiResponse> {
  const response = await fetch(`${KIE_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`KIE API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export interface VideoGenerationParams {
  imageUrl: string;
  prompt?: string;
  duration?: number;
  sound?: boolean;
  model?: string;
  callBackUrl?: string;
  mode?: string;       // Grok: fun/normal/spicy
  resolution?: string; // Grok: 480p/720p, Kling: n/a
}

function buildRequestBody(params: VideoGenerationParams): Record<string, unknown> {
  const model = params.model || getConfig('kie_video_model') || 'grok-imagine/image-to-video';
  const isGrok = model.includes('grok');
  const isKling = model.includes('kling');
  const isVeo = model.includes('veo');

  const input: Record<string, unknown> = {
    image_urls: [params.imageUrl],
  };

  // Prompt
  if (params.prompt || !isGrok) {
    input.prompt = params.prompt || 'Generate a cinematic video from this image';
  }

  // Duration - always string per KIE spec
  const dur = params.duration || (isGrok ? 10 : 5);
  input.duration = String(dur);

  if (isGrok) {
    input.mode = params.mode || getConfig('default_mode') || 'normal';
    input.resolution = "480p";
    // aspect_ratio only for multi-image (2+ image_urls) — single image follows image dimensions per spec
    // Don't send aspect_ratio for single image
  }

  if (isKling) {
    input.sound = params.sound ?? (getConfig('default_sound') !== 'false');
  }

  if (isVeo) {
    input.sound = params.sound ?? true;
  }

  const body: Record<string, unknown> = { model, input };

  if (params.callBackUrl) {
    body.callBackUrl = params.callBackUrl;
  }

  return body;
}

export async function createImageToVideoTask(params: VideoGenerationParams): Promise<string> {
  const body = buildRequestBody(params);

  const result = await kiePost('/api/v1/jobs/createTask', body);

  if (result.code !== 200) {
    throw new Error(`KIE task creation failed (${result.code}): ${result.msg}`);
  }

  return result.data!.taskId!;
}

export interface TaskStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  outputUrl?: string;
  outputUrls?: string[];
  error?: string;
  progress?: number;
}

export async function checkTaskStatus(taskId: string): Promise<TaskStatus> {
  const result = await kieGet(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);

  if (result.code !== 200 && result.code !== 505) {
    throw new Error(`KIE task query failed (${result.code}): ${result.msg}`);
  }

  const state = result.data?.state || 'pending';
  let outputUrls: string[] = [];

  if (result.data?.resultJson) {
    try {
      const parsed = JSON.parse(result.data.resultJson);
      if (parsed.resultUrls && Array.isArray(parsed.resultUrls)) {
        outputUrls = parsed.resultUrls;
      }
    } catch {
      // resultJson might not be valid JSON
    }
  }

  return {
    taskId,
    status: state as TaskStatus['status'],
    outputUrl: outputUrls[0],
    outputUrls,
    error: result.data?.failMsg || undefined,
    progress: result.data?.progress,
  };
}

export async function pollTaskCompletion(
  taskId: string,
  maxAttempts = 120,
  intervalMs = 15000
): Promise<TaskStatus> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await checkTaskStatus(taskId);

    if (status.status === 'success' || status.status === 'failed') {
      return status;
    }

    console.log(`[KIE] Task ${taskId} status: ${status.status} (progress: ${status.progress ?? '?'}%)`);

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Task ${taskId} timed out after ${maxAttempts} polling attempts`);
}

export async function downloadVideo(url: string): Promise<Buffer> {
  return downloadMedia(url);
}

// ── Image-to-Image (Enhancement) ───────────────────────────────────────────

export interface ImageToImageParams {
  imageUrl: string;
  prompt?: string;
  model?: string;
  aspectRatio?: string;   // "auto", "1:1", "16:9", "9:16", etc.
  resolution?: string;    // "1K", "2K", "4K"
  outputFormat?: string;  // "png", "jpg"
  callBackUrl?: string;
}

function buildImageToImageRequestBody(params: ImageToImageParams): Record<string, unknown> {
  const model = params.model || getConfig('kie_image_model') || 'nano-banana-2';

  const input: Record<string, unknown> = {
    prompt: params.prompt || getConfig('default_image_to_image_prompt') || 'Enhance this image, improve quality, add cinematic lighting and detail',
    image_input: [params.imageUrl],
    aspect_ratio: params.aspectRatio || getConfig('image_aspect_ratio') || 'auto',
    resolution: params.resolution || getConfig('image_resolution') || '1K',
    output_format: params.outputFormat || getConfig('image_output_format') || 'jpg',
  };

  const body: Record<string, unknown> = { model, input };

  if (params.callBackUrl) {
    body.callBackUrl = params.callBackUrl;
  }

  return body;
}

export async function enhanceImage(params: ImageToImageParams): Promise<string> {
  const body = buildImageToImageRequestBody(params);

  const result = await kiePost('/api/v1/jobs/createTask', body);

  if (result.code !== 200) {
    throw new Error(`KIE image-to-image failed (${result.code}): ${result.msg}`);
  }

  return result.data!.taskId!;
}

// ── Text-to-Image Generation ──────────────────────────────────────────────

export interface ImageGenerationParams {
  prompt: string;
  model?: string;
  count?: number;
  resolution?: string;  // e.g. "1024x1024", "1792x1024"
  callBackUrl?: string;
}

function buildImageRequestBody(params: ImageGenerationParams): Record<string, unknown> {
  const model = params.model || getConfig('kie_image_model') || 'grok-imagine/text-to-image';
  const count = params.count || 1;
  const resolution = params.resolution || '1024x1024';

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    num_images: count,
    resolution,
  };

  const body: Record<string, unknown> = { model, input };

  if (params.callBackUrl) {
    body.callBackUrl = params.callBackUrl;
  }

  return body;
}

export async function generateImage(params: ImageGenerationParams): Promise<string> {
  const body = buildImageRequestBody(params);

  const result = await kiePost('/api/v1/jobs/createTask', body);

  if (result.code !== 200) {
    throw new Error(`KIE image generation failed (${result.code}): ${result.msg}`);
  }

  return result.data!.taskId!;
}

export interface ImageTaskStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  imageUrls: string[];
  error?: string;
  progress?: number;
}

export async function checkImageTaskStatus(taskId: string): Promise<ImageTaskStatus> {
  const result = await kieGet(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);

  if (result.code !== 200 && result.code !== 505) {
    throw new Error(`KIE image task query failed (${result.code}): ${result.msg}`);
  }

  const state = result.data?.state || 'pending';
  let imageUrls: string[] = [];

  if (result.data?.resultJson) {
    try {
      const parsed = JSON.parse(result.data.resultJson);
      const urls = parsed.resultUrls || parsed.imageUrls || parsed.images || [];
      imageUrls = Array.isArray(urls) ? urls : [];
    } catch {
      // resultJson might not be valid JSON
    }
  }

  return {
    taskId,
    status: state as ImageTaskStatus['status'],
    imageUrls,
    error: result.data?.failMsg || undefined,
    progress: result.data?.progress,
  };
}

export async function pollImageTaskCompletion(
  taskId: string,
  maxAttempts = 120,
  intervalMs = 15000
): Promise<ImageTaskStatus> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await checkImageTaskStatus(taskId);

    if (status.status === 'success' || status.status === 'failed') {
      return status;
    }

    console.log(`[KIE] Image task ${taskId} status: ${status.status} (progress: ${status.progress ?? '?'}%)`);

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Image task ${taskId} timed out after ${maxAttempts} polling attempts`);
}

export async function downloadImage(url: string): Promise<Buffer> {
  return downloadMedia(url);
}

// ── Shared download helper ────────────────────────────────────────────────

async function downloadMedia(url: string): Promise<Buffer> {
  // Use KIE download proxy for reliable download with auth
  const proxyRes = await fetch(`${KIE_API_BASE}/api/v1/common/download-url`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  let downloadUrl = url;
  if (proxyRes.ok) {
    const json = await proxyRes.json() as { code: number; data: string };
    if (json.code === 200 && json.data) {
      downloadUrl = json.data;
    }
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
