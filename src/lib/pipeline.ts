import { v4 as uuidv4 } from 'uuid';
import {
  listImagesInFolder,
  getFileUrl,
  uploadFile,
} from './drive';
import {
  createImageToVideoTask,
  checkTaskStatus,
  downloadVideo,
  generateImage,
  enhanceImage,
  pollImageTaskCompletion,
  downloadImage,
} from './kie';
import { createJob, updateJob, getJob, isFileProcessed, markFileProcessed, getConfig } from './db';

interface PipelineResult {
  success: boolean;
  processed: number;
  failed: number;
  errors: string[];
  jobIds: string[];
}

function getCallbackUrl(): string | undefined {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  if (appUrl.includes('localhost') || appUrl.includes('127.0.0.1') || appUrl.includes('192.168')) {
    return undefined;
  }
  return `${appUrl}/api/webhook/kie`;
}

export async function runPipeline(
  inputFolderId: string,
  imageOutputFolderId: string,
  videoOutputFolderId: string
): Promise<PipelineResult> {
  const pipelineMode = getConfig('pipeline_mode') || 'image-to-image';

  if (pipelineMode === 'text-to-image') {
    return runTextToImagePipeline(imageOutputFolderId, videoOutputFolderId);
  }
  return runImageToImagePipeline(inputFolderId, imageOutputFolderId, videoOutputFolderId);
}

// ── Image-to-Image Pipeline (enhance input images → video) ─────────────────

async function runImageToImagePipeline(
  inputFolderId: string,
  imageOutputFolderId: string,
  videoOutputFolderId: string
): Promise<PipelineResult> {
  const result: PipelineResult = {
    success: true,
    processed: 0,
    failed: 0,
    errors: [],
    jobIds: [],
  };

  console.log(`[Pipeline] Image-to-Image mode - input: ${inputFolderId}, image out: ${imageOutputFolderId}, video out: ${videoOutputFolderId}`);

  const images = await listImagesInFolder(inputFolderId);
  console.log(`[Pipeline] Found ${images.length} images in input folder`);

  // ── Image enhancement config ──
  const enhancePrompt = getConfig('default_image_to_image_prompt') || 'Enhance this image, improve quality, add cinematic lighting';
  const imageModel = getConfig('kie_image_model') || 'nano-banana-2';
  const imageAspectRatio = getConfig('image_aspect_ratio') || 'auto';
  const imageResolution = getConfig('image_resolution') || '1K';
  const imageOutputFormat = getConfig('image_output_format') || 'jpg';

  // ── Video generation config ──
  const defaultPrompt = getConfig('default_prompt') || undefined;
  const defaultDuration = parseInt(getConfig('default_duration') || '10', 10);
  const defaultSound = getConfig('default_sound') !== 'false';
  const videoModel = getConfig('kie_video_model') || 'grok-imagine/image-to-video';
  const callbackUrl = getCallbackUrl();

  for (const image of images) {
    if (isFileProcessed(image.id)) {
      console.log(`[Pipeline] Skipping already processed: ${image.name}`);
      continue;
    }

    const jobId = uuidv4();
    const enhancedName = `enhanced_${image.name.replace(/\.[^.]+$/, '')}.png`;

    try {
      // ── Step 1: Get shareable URL for the input image ──
      let imageUrl = image.webContentLink;
      if (!imageUrl) {
        imageUrl = await getFileUrl(image.id);
      }

      // Create job entry — image processing starts now
      createJob({
        id: jobId,
        source_file_name: enhancedName,
        source_file_id: '',
        status: 'processing_image',
        kie_task_id: null,
        output_url: null,
        output_file_id: null,
        image_prompt: enhancePrompt,
        image_output_file_id: null,
        image_gen_task_id: null,
        duration: defaultDuration,
        resolution: videoModel,
        error: null,
      });

      result.jobIds.push(jobId);

      // ── Step 2: Enhance image via KIE image-to-image ──
      console.log(`[Pipeline] Enhancing: ${image.name}`);
      const enhanceTaskId = await enhanceImage({
        imageUrl,
        prompt: enhancePrompt,
        model: imageModel,
        aspectRatio: imageAspectRatio,
        resolution: imageResolution,
        outputFormat: imageOutputFormat,
        callBackUrl: callbackUrl,
      });

      updateJob(jobId, { image_gen_task_id: enhanceTaskId });

      // ── Step 3: Wait for enhancement to complete ──
      const enhanceResult = await pollImageTaskCompletion(enhanceTaskId, 60, 10000);

      if (enhanceResult.status !== 'success' || enhanceResult.imageUrls.length === 0) {
        throw new Error(enhanceResult.error || 'Image enhancement failed - no output URL');
      }

      const enhancedUrl = enhanceResult.imageUrls[0];
      console.log(`[Pipeline] Image enhanced: ${enhancedUrl}`);

      // ── Step 4: Download and upload enhanced image to Drive ──
      const enhancedBuffer = await downloadImage(enhancedUrl);
      const uploadedImageId = await uploadFile(imageOutputFolderId, enhancedName, enhancedBuffer, 'image/png');
      console.log(`[Pipeline] Enhanced image uploaded: ${enhancedName} (${uploadedImageId})`);

      updateJob(jobId, { image_output_file_id: uploadedImageId, source_file_id: uploadedImageId });

      // ── Step 5: Get shareable URL for the enhanced image ──
      const driveImageUrl = await getFileUrl(uploadedImageId);

      // ── Step 6: Create KIE video generation task ──
      updateJob(jobId, { status: 'processing_video' });

      const videoTaskId = await createImageToVideoTask({
        imageUrl: driveImageUrl,
        prompt: defaultPrompt,
        duration: defaultDuration,
        sound: defaultSound,
        model: videoModel,
        callBackUrl: callbackUrl,
      });

      updateJob(jobId, { kie_task_id: videoTaskId });
      console.log(`[Pipeline] Video task created: ${videoTaskId}`);

      // ── Step 7: Wait for video generation ──
      const videoResult = await checkTaskStatus(videoTaskId);

      if (videoResult.status !== 'success' && videoResult.status !== 'failed') {
        const finalResult = await pollUntilDone(videoTaskId, 30, 15000);
        if (!finalResult) {
          throw new Error(`Video task ${videoTaskId} timed out`);
        }
        Object.assign(videoResult, finalResult);
      }

      if (videoResult.status !== 'success' || (!videoResult.outputUrl && !videoResult.outputUrls?.length)) {
        throw new Error(videoResult.error || 'Video generation failed - no output URL');
      }

      const videoUrl = videoResult.outputUrl || videoResult.outputUrls![0];

      // ── Step 8: Download video and upload to Drive ──
      const videoBuffer = await downloadVideo(videoUrl);
      const videoName = enhancedName.replace(/\.[^.]+$/, '') + '_video.mp4';
      const uploadedVideoId = await uploadFile(videoOutputFolderId, videoName, videoBuffer, 'video/mp4');

      updateJob(jobId, {
        status: 'completed',
        output_url: videoUrl,
        output_file_id: uploadedVideoId,
        completed_at: new Date().toISOString(),
      });

      markFileProcessed(image.id);
      result.processed++;
      console.log(`[Pipeline] Completed: ${image.name} -> ${enhancedName} -> ${videoName}`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] Failed: ${image.name} - ${errorMsg}`);

      if (!getJob(jobId)) {
        try {
          createJob({
            id: jobId,
            source_file_name: enhancedName,
            source_file_id: '',
            status: 'failed',
            kie_task_id: null,
            output_url: null,
            output_file_id: null,
            image_prompt: enhancePrompt,
            image_output_file_id: null,
            image_gen_task_id: null,
            duration: defaultDuration,
            resolution: videoModel,
            error: errorMsg,
          });
        } catch { /* ignore */ }
      }

      try {
        updateJob(jobId, {
          status: 'failed',
          error: errorMsg,
          completed_at: new Date().toISOString(),
        });
      } catch { /* ignore */ }

      result.failed++;
      result.errors.push(`${image.name}: ${errorMsg}`);
    }
  }

  result.success = result.failed === 0;
  console.log(`[Pipeline] Image-to-Image done - ${result.processed} processed, ${result.failed} failed`);
  return result;
}

// ── Text-to-Image Pipeline (generate images from prompts → video) ──────────

async function runTextToImagePipeline(
  imageOutputFolderId: string,
  videoOutputFolderId: string
): Promise<PipelineResult> {
  const result: PipelineResult = {
    success: true,
    processed: 0,
    failed: 0,
    errors: [],
    jobIds: [],
  };

  console.log(`[Pipeline] Text-to-Image mode - image out: ${imageOutputFolderId}, video out: ${videoOutputFolderId}`);

  const imagePrompt = getConfig('default_image_prompt') || 'A beautiful cinematic scene, high quality, photorealistic';
  const imageCount = parseInt(getConfig('image_count') || '1', 10);
  const imageModel = getConfig('kie_image_model') || 'grok-imagine/text-to-image';
  const imageResolution = getConfig('text_image_resolution') || '1024x1024';

  const defaultPrompt = getConfig('default_prompt') || undefined;
  const defaultDuration = parseInt(getConfig('default_duration') || '10', 10);
  const defaultSound = getConfig('default_sound') !== 'false';
  const videoModel = getConfig('kie_video_model') || 'grok-imagine/image-to-video';
  const callbackUrl = getCallbackUrl();

  const variantSuffixes = ['', 'variant B', 'variant C', 'variant D', 'variant E'];

  for (let i = 0; i < imageCount; i++) {
    const variantSuffix = i < variantSuffixes.length ? ` (${variantSuffixes[i]})` : ` (variant ${i + 1})`;
    const prompt = imagePrompt + variantSuffix;
    const jobId = uuidv4();
    const imageName = `generated_image_${Date.now()}_${i + 1}.png`;

    console.log(`[Pipeline] Generating image ${i + 1}/${imageCount}: "${prompt.substring(0, 80)}..."`);

    try {
      // Create job entry — image generation starts now
      createJob({
        id: jobId,
        source_file_name: imageName,
        source_file_id: '',
        status: 'processing_image',
        kie_task_id: null,
        output_url: null,
        output_file_id: null,
        image_prompt: prompt,
        image_output_file_id: null,
        image_gen_task_id: null,
        duration: defaultDuration,
        resolution: videoModel,
        error: null,
      });

      result.jobIds.push(jobId);

      const imageTaskId = await generateImage({
        prompt,
        model: imageModel,
        count: 1,
        resolution: imageResolution,
        callBackUrl: callbackUrl,
      });

      updateJob(jobId, { image_gen_task_id: imageTaskId });

      const imageResult = await pollImageTaskCompletion(imageTaskId, 60, 10000);

      if (imageResult.status !== 'success' || imageResult.imageUrls.length === 0) {
        throw new Error(imageResult.error || 'Image generation failed - no output URL');
      }

      const imageUrl = imageResult.imageUrls[0];
      const imageBuffer = await downloadImage(imageUrl);
      const uploadedImageId = await uploadFile(imageOutputFolderId, imageName, imageBuffer, 'image/png');

      updateJob(jobId, { image_output_file_id: uploadedImageId, source_file_id: uploadedImageId });

      const driveImageUrl = await getFileUrl(uploadedImageId);

      updateJob(jobId, { status: 'processing_video' });

      const videoTaskId = await createImageToVideoTask({
        imageUrl: driveImageUrl,
        prompt: defaultPrompt,
        duration: defaultDuration,
        sound: defaultSound,
        model: videoModel,
        callBackUrl: callbackUrl,
      });

      updateJob(jobId, { kie_task_id: videoTaskId });

      const videoResult = await checkTaskStatus(videoTaskId);

      if (videoResult.status !== 'success' && videoResult.status !== 'failed') {
        const finalResult = await pollUntilDone(videoTaskId, 30, 15000);
        if (!finalResult) {
          throw new Error(`Video task ${videoTaskId} timed out`);
        }
        Object.assign(videoResult, finalResult);
      }

      if (videoResult.status !== 'success' || (!videoResult.outputUrl && !videoResult.outputUrls?.length)) {
        throw new Error(videoResult.error || 'Video generation failed - no output URL');
      }

      const videoUrl = videoResult.outputUrl || videoResult.outputUrls![0];
      const videoBuffer = await downloadVideo(videoUrl);
      const videoName = imageName.replace(/\.[^.]+$/, '') + '_video.mp4';
      const uploadedVideoId = await uploadFile(videoOutputFolderId, videoName, videoBuffer, 'video/mp4');

      updateJob(jobId, {
        status: 'completed',
        output_url: videoUrl,
        output_file_id: uploadedVideoId,
        completed_at: new Date().toISOString(),
      });

      result.processed++;
      console.log(`[Pipeline] Completed ${i + 1}/${imageCount}: ${imageName} -> ${videoName}`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] Failed image ${i + 1}/${imageCount}: ${errorMsg}`);

      if (!getJob(jobId)) {
        try {
          createJob({
            id: jobId,
            source_file_name: imageName,
            source_file_id: '',
            status: 'failed',
            kie_task_id: null,
            output_url: null,
            output_file_id: null,
            image_prompt: prompt,
            image_output_file_id: null,
            image_gen_task_id: null,
            duration: defaultDuration,
            resolution: videoModel,
            error: errorMsg,
          });
        } catch { /* ignore */ }
      }

      try {
        updateJob(jobId, {
          status: 'failed',
          error: errorMsg,
          completed_at: new Date().toISOString(),
        });
      } catch { /* ignore */ }

      result.failed++;
      result.errors.push(`${imageName}: ${errorMsg}`);
    }
  }

  result.success = result.failed === 0;
  console.log(`[Pipeline] Text-to-Image done - ${result.processed} processed, ${result.failed} failed`);
  return result;
}

async function pollUntilDone(
  taskId: string,
  maxAttempts: number,
  intervalMs: number
): Promise<{ status: string; outputUrl?: string; outputUrls?: string[]; error?: string } | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const status = await checkTaskStatus(taskId);

    console.log(`[Pipeline] Poll ${i + 1}/${maxAttempts}: ${taskId} = ${status.status}`);

    if (status.status === 'success' || status.status === 'failed') {
      return status;
    }
  }
  return null;
}
