import { CSSProperties } from 'react';
import { api } from '@/lib/api';

export type BBox = { x: number; y: number; w: number; h: number };

export type DetectedFacePayload = {
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
  embedding?: number[];
  embedding_model?: string;
};

export type RunArticle = {
  id: string;
  source: string;
  domain: string;
  section_url: string;
  article_url: string;
  title?: string | null;
  status: string;
  article_id?: string | null;
  image_count: number;
  face_count: number;
  warnings: string[];
  images: BootstrapImage[];
};

export type BootstrapFace = {
  face_id: string;
  bbox: BBox;
  quality_score?: number | null;
  matches: BootstrapMatch[];
  suggestions: BootstrapSuggestion[];
};

export type BootstrapMatch = {
  id: string;
  person_id: string;
  person_name: string;
  person_slug: string;
  score: number;
  status: string;
};

export type BootstrapSuggestion = {
  id: string;
  suggested_name: string;
  suggested_person_id?: string | null;
  suggested_person_name?: string | null;
  status: string;
};

export type BootstrapGroupFace = {
  face_id: string;
  bbox: BBox;
  image_id?: string | null;
  image_url?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  article_url?: string | null;
  article_title?: string | null;
};

export type BootstrapImage = {
  image_id: string;
  image_url: string;
  width?: number | null;
  height?: number | null;
  status: string;
  faces: BootstrapFace[];
};

export type BootstrapGroup = {
  group_id: string;
  face_count: number;
  article_count: number;
  faces: BootstrapGroupFace[];
};

export type BootstrapRun = {
  id: string;
  status: string;
  limit_per_source: number;
  render_browser: boolean;
  warnings: string[];
  counts: {
    articles: number;
    images: number;
    faces: number;
    statuses: Record<string, number>;
  };
  articles: RunArticle[];
  groups: BootstrapGroup[];
};

type DiscoveredImage = {
  image_url: string;
  width?: number | null;
  height?: number | null;
};

type DiscoverResponse = {
  page_url: string;
  title?: string | null;
  images: DiscoveredImage[];
  warnings: string[];
};

type AnalyzeResponse = {
  article_id: string;
  results: Array<{ image_url: string; image_id: string; faces: Array<{ face_id: string }> }>;
  warnings: string[];
};

type AnalyzedImagePayload = {
  image_url: string;
  width: number | null;
  height: number | null;
  faces: DetectedFacePayload[];
};

type ProcessArticleOptions = {
  runId: string;
  token: string;
  renderBrowser: boolean;
  maxImages?: number;
};

let faceModelLoad: Promise<unknown> | null = null;
const BOOTSTRAP_MIN_IMAGE_DIMENSION = Number(process.env.NEXT_PUBLIC_BOOTSTRAP_MIN_IMAGE_DIMENSION || 300);

function headersFor(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function proxiedImageUrl(url: string) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

async function loadFaceModels() {
  const [tf, faceapi] = await Promise.all([import('@tensorflow/tfjs'), import('face-api.js')]);
  if (!faceModelLoad) {
    faceModelLoad = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
    })();
  }
  await faceModelLoad;
  return faceapi;
}

function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Imagem não carregada para detecção.'));
    image.src = proxiedImageUrl(url);
  });
}

function facePayloadFromDetection(detection: unknown, image: HTMLImageElement): DetectedFacePayload | null {
  const naturalWidth = image.naturalWidth || 1;
  const naturalHeight = image.naturalHeight || 1;
  const candidate = detection as {
    detection?: { box?: { x: number; y: number; width: number; height: number }; score?: number; imageWidth?: number; imageHeight?: number };
    box?: { x: number; y: number; width: number; height: number };
    score?: number;
    imageWidth?: number;
    imageHeight?: number;
    descriptor?: Float32Array | number[];
  };
  const source = candidate.detection || candidate;
  const box = source.box;
  if (!box) return null;

  const sourceWidth = source.imageWidth || naturalWidth;
  const sourceHeight = source.imageHeight || naturalHeight;
  const scaleX = naturalWidth / sourceWidth;
  const scaleY = naturalHeight / sourceHeight;
  const x = Math.max(0, Number(box.x) * scaleX);
  const y = Math.max(0, Number(box.y) * scaleY);
  const w = Math.min(Math.max(0, Number(box.width) * scaleX), naturalWidth - x);
  const h = Math.min(Math.max(0, Number(box.height) * scaleY), naturalHeight - y);
  if (![x, y, w, h].every(Number.isFinite) || w < 18 || h < 18) return null;

  const descriptor = candidate.descriptor ? Array.from(candidate.descriptor).map(Number) : undefined;
  return {
    x,
    y,
    w,
    h,
    score: typeof source.score === 'number' ? source.score : undefined,
    ...(descriptor?.length === 128 ? { embedding: descriptor, embedding_model: 'face-api.js/faceRecognitionNet' } : {}),
  };
}

async function detectFaces(imageUrl: string): Promise<{ width: number; height: number; faces: DetectedFacePayload[] }> {
  const faceapi = await loadFaceModels();
  const image = await imageFromUrl(imageUrl);
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.35 });
  let detections: unknown[];
  try {
    detections = await faceapi.detectAllFaces(image, options).withFaceLandmarks(true).withFaceDescriptors();
  } catch (_error: unknown) {
    detections = await faceapi.detectAllFaces(image, options);
  }
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    faces: detections
      .map((detection) => facePayloadFromDetection(detection, image))
      .filter(Boolean) as DetectedFacePayload[],
  };
}

function imageArea(image: { width?: number | null; height?: number | null }) {
  return Number(image.width || 0) * Number(image.height || 0);
}

function imageVariantKey(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    for (const key of ['w', 'width', 'h', 'height', 'resize', 'size', 'crop', 'fit', 'quality', 'q', 'format', 'auto', 'dpr']) {
      url.searchParams.delete(key);
    }
    url.pathname = url.pathname
      .replace(/([_-])\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '$1SIZE')
      .replace(/([_-])\d{2,5}(?=\.[a-z0-9]+$)/i, '$1SIZE')
      .replace(/\/(?:w|width|h|height|fit-in|resize)\/\d{2,5}(?=\/)/gi, '/SIZE');
    return url.toString();
  } catch {
    return rawUrl.replace(/([_-])\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '$1SIZE');
  }
}

function dedupeImageVariants(images: AnalyzedImagePayload[]) {
  const byVariant = new Map<string, AnalyzedImagePayload>();
  let dropped = 0;
  for (const image of images) {
    const key = imageVariantKey(image.image_url);
    const current = byVariant.get(key);
    if (!current) {
      byVariant.set(key, image);
      continue;
    }
    dropped += 1;
    const currentArea = imageArea(current);
    const nextArea = imageArea(image);
    if (nextArea > currentArea || (nextArea === currentArea && image.image_url.length > current.image_url.length)) {
      byVariant.set(key, image);
    }
  }
  return { images: Array.from(byVariant.values()), dropped };
}

function isTooSmallForBootstrap(image: { width?: number | null; height?: number | null }) {
  const minDimension = bootstrapMinImageDimension();
  return Boolean(image.width && image.height && (image.width < minDimension || image.height < minDimension));
}

export function bootstrapMinImageDimension() {
  return Number.isFinite(BOOTSTRAP_MIN_IMAGE_DIMENSION) && BOOTSTRAP_MIN_IMAGE_DIMENSION > 0
    ? BOOTSTRAP_MIN_IMAGE_DIMENSION
    : 300;
}

export function cropStyle(face: BootstrapFace, image: BootstrapImage): CSSProperties {
  const width = Math.max(1, Number(image.width || 1));
  const height = Math.max(1, Number(image.height || 1));
  const padX = Math.max(18, Number(face.bbox.w || 0) * 0.55);
  const padY = Math.max(18, Number(face.bbox.h || 0) * 0.65);
  const rawX = Math.max(0, Number(face.bbox.x || 0) - padX);
  const rawY = Math.max(0, Number(face.bbox.y || 0) - padY);
  const rawW = Math.min(width - rawX, Number(face.bbox.w || 0) + padX * 2);
  const rawH = Math.min(height - rawY, Number(face.bbox.h || 0) + padY * 2);
  const square = Math.max(rawW, rawH, 80);
  const cropW = Math.min(width, square);
  const cropH = Math.min(height, square);
  const cropX = Math.max(0, Math.min(width - cropW, rawX - (cropW - rawW) / 2));
  const cropY = Math.max(0, Math.min(height - cropH, rawY - (cropH - rawH) / 2));
  const frame = 72;
  const scale = frame / cropW;
  return {
    height: `${height * scale}px`,
    left: `${-cropX * scale}px`,
    position: 'absolute',
    top: `${-cropY * scale}px`,
    width: `${width * scale}px`,
  };
}

export async function processBootstrapArticle(article: RunArticle, options: ProcessArticleOptions) {
  const warnings: string[] = [];
  try {
    const discovery = await api.post<DiscoverResponse>('/extension/discover-article-images', {
      page_url: article.article_url,
      render_browser: options.renderBrowser,
      max_images: options.maxImages || 4,
    });
    warnings.push(...(discovery.warnings || []));
    const detectedImages: AnalyzedImagePayload[] = [];
    for (const image of discovery.images) {
      try {
        const detected = await detectFaces(image.image_url);
        if (isTooSmallForBootstrap(detected)) {
          warnings.push(`Imagem ignorada: menor que ${bootstrapMinImageDimension()}px (${detected.width} × ${detected.height}).`);
          continue;
        }
        if (detected.faces.length > 0) {
          detectedImages.push({
            image_url: image.image_url,
            width: detected.width || image.width || null,
            height: detected.height || image.height || null,
            faces: detected.faces,
          });
        }
      } catch (error: unknown) {
        warnings.push(`Imagem ignorada: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
      }
    }
    const { images: analyzedImages, dropped } = dedupeImageVariants(detectedImages);
    if (dropped > 0) {
      warnings.push(`${dropped} variante(s) menor(es) da mesma imagem ignorada(s).`);
    }

    if (analyzedImages.length === 0) {
      return attachBootstrapArticle(options, article, {
        status: 'NO_FACES',
        image_count: discovery.images.length,
        face_count: 0,
        warnings,
      });
    }

    const analyzed = await api.post<AnalyzeResponse>('/extension/analyze-page', {
      page_url: article.article_url,
      title: article.title,
      images: analyzedImages,
    });
    warnings.push(...(analyzed.warnings || []));
    const faceCount = analyzed.results.reduce((total, item) => total + item.faces.length, 0);
    return attachBootstrapArticle(options, article, {
      article_id: analyzed.article_id,
      status: faceCount > 0 ? 'ANALYZED' : 'NO_FACES',
      image_count: analyzedImages.length,
      face_count: faceCount,
      warnings,
    });
  } catch (error: unknown) {
    return attachBootstrapArticle(options, article, {
      status: 'ERROR',
      image_count: 0,
      face_count: 0,
      warnings: [error instanceof Error ? error.message : 'Erro desconhecido'],
    });
  }
}

async function attachBootstrapArticle(
  options: ProcessArticleOptions,
  article: RunArticle,
  payload: { article_id?: string | null; status: string; image_count: number; face_count: number; warnings: string[] },
) {
  return api.post(
    `/admin/bootstrap-runs/${options.runId}/articles/${article.id}/attach`,
    payload,
    headersFor(options.token),
  );
}
