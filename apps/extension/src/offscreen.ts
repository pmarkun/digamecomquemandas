// @ts-nocheck
import * as tf from '@tensorflow/tfjs';
import * as faceapi from 'face-api.js';

let modelLoad: Promise<void> | null = null;

function concatArrayBuffers(buffers: ArrayBuffer[]) {
  const totalBytes = buffers.reduce((total, buffer) => total + buffer.byteLength, 0);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  buffers.forEach((buffer) => {
    bytes.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  });
  return bytes.buffer;
}

async function fetchModelFile(modelBaseUrl: string, file: string) {
  const response = await fetch(`${modelBaseUrl}${file}`, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`model fetch ${file}: ${response.status}`);
  }
  return response;
}

async function loadFaceApiWeightMap(modelBaseUrl: string, manifestFile: string) {
  const manifestResponse = await fetchModelFile(modelBaseUrl, manifestFile);
  const manifest = await manifestResponse.json();
  const weightMap = {};

  for (const group of manifest) {
    const buffers = await Promise.all(
      group.paths.map(async (path: string) => {
        const shardResponse = await fetchModelFile(modelBaseUrl, path);
        return shardResponse.arrayBuffer();
      }),
    );
    Object.assign(weightMap, tf.io.decodeWeights(concatArrayBuffers(buffers), group.weights));
  }

  return weightMap;
}

async function loadFaceApiNet(net: any, modelBaseUrl: string, manifestFile: string) {
  const weightMap = await loadFaceApiWeightMap(modelBaseUrl, manifestFile);
  net.loadFromWeightMap(weightMap);
}

function loadModels() {
  if (!modelLoad) {
    modelLoad = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      const modelBaseUrl = chrome.runtime.getURL('dist/models/');
      await Promise.all([
        loadFaceApiNet(faceapi.nets.tinyFaceDetector, modelBaseUrl, 'tiny_face_detector_model-weights_manifest.json'),
        loadFaceApiNet(faceapi.nets.faceLandmark68TinyNet, modelBaseUrl, 'face_landmark_68_tiny_model-weights_manifest.json'),
        loadFaceApiNet(faceapi.nets.faceRecognitionNet, modelBaseUrl, 'face_recognition_model-weights_manifest.json'),
      ]);
    })().catch((error) => {
      modelLoad = null;
      throw error;
    });
  }
  return modelLoad;
}

function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Imagem não carregada no offscreen.'));
    };
    image.src = url;
  });
}

function normalizeDetection(detection: any, width: number, height: number) {
  const source = detection?.detection || detection;
  const box = source?.box;
  if (!box) {
    return null;
  }

  const x = Math.max(0, Number(box.x));
  const y = Math.max(0, Number(box.y));
  const w = Math.max(0, Number(box.width));
  const h = Math.max(0, Number(box.height));
  if (![x, y, w, h].every(Number.isFinite) || w < 24 || h < 24) {
    return null;
  }

  return {
    x,
    y,
    w: Math.min(w, width - x),
    h: Math.min(h, height - y),
    score: typeof source.score === 'number' ? source.score : undefined,
    ...(detection?.descriptor?.length === 128
      ? { embedding: Array.from(detection.descriptor).map(Number), embedding_model: 'face-api.js/faceRecognitionNet' }
      : {}),
  };
}

async function detectFaces(imageUrl: string) {
  await loadModels();
  const response = await fetch(imageUrl, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`image fetch ${response.status}`);
  }

  const image = await imageFromBlob(await response.blob());
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas indisponível no offscreen.');
  }
  context.drawImage(image, 0, 0, width, height);

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.35 });
  let detections;
  try {
    detections = await faceapi.detectAllFaces(canvas, options).withFaceLandmarks(true).withFaceDescriptors();
  } catch (_descriptorError: unknown) {
    detections = await faceapi.detectAllFaces(canvas, options);
  }

  return detections
    .map((detection: any) => normalizeDetection(detection, width, height))
    .filter(Boolean);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OFFSCREEN_WARM_DETECTOR') {
    loadModels()
      .then(() => sendResponse({ ok: true, payload: { ready: true } }))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'erro ao carregar detector offscreen' }));
    return true;
  }

  if (message?.type !== 'OFFSCREEN_DETECT_FACES') {
    return false;
  }

  detectFaces(String(message.imageUrl || ''))
    .then((faces) => sendResponse({ ok: true, payload: { faces } }))
    .catch((error) => sendResponse({ ok: false, error: error.message || 'erro no detector offscreen' }));
  return true;
});
