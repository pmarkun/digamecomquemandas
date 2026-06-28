// @ts-nocheck
import * as faceapi from 'face-api.js';

const ALLOWLIST_FALLBACK = [
  'g1.globo.com',
  'oglobo.globo.com',
  'www1.folha.uol.com.br',
  'www.estadao.com.br',
  'noticias.uol.com.br',
  'www.cnnbrasil.com.br',
  'www.metropoles.com',
  'www.poder360.com.br',
  'www.cartacapital.com.br',
  'www.brasildefato.com.br',
];

const WEB_BASE = 'http://localhost:3000';
const SIDEBAR_ID = 'qtnf-sidebar-root';

type CandidateImage = {
  node: HTMLImageElement;
  image_url: string;
  width: number;
  height: number;
  faces?: DetectedFacePayload[];
};

type DetectedFacePayload = {
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
  embedding?: number[];
  embedding_model?: string;
};

type SidebarImage = {
  image_url: string;
  width: number;
  height: number;
  status: 'queued' | 'analyzing' | 'ready' | 'error';
  articleId?: string;
  faces: any[];
  warning?: string;
};

const state = {
  disabledSites: new Set(),
  allowlist: new Set<string>(ALLOWLIST_FALLBACK),
  processedImages: new Set<string>(),
  analyzing: false,
  queuedScan: false,
  sidebarOpen: true,
  sidebarRoot: null as ShadowRoot | null,
  sidebarImages: [] as SidebarImage[],
  analysis: {
    images: 0,
    faces: 0,
    matches: 0,
  },
};

let faceModelLoad: Promise<void> | null = null;
let scanTimer: number | undefined;
let autocompleteTimer: number | undefined;

function normalizeHost(hostname: string) {
  return hostname.replace(/^www\./, '').toLowerCase();
}

function isAllowedDomain(hostname: string) {
  return state.allowlist.has(normalizeHost(hostname));
}

function loadFaceDetector() {
  if (!faceModelLoad) {
    faceModelLoad = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(chrome.runtime.getURL('models')),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(chrome.runtime.getURL('models')),
      faceapi.nets.faceRecognitionNet.loadFromUri(chrome.runtime.getURL('models')),
    ]).then(() => undefined);
  }
  return faceModelLoad;
}

function bboxFromDetection(detection: any, image: HTMLImageElement): DetectedFacePayload | null {
  const source = detection?.detection || detection;
  const box = source?.box;
  if (!box) {
    return null;
  }

  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const sourceWidth = source.imageWidth || naturalWidth;
  const sourceHeight = source.imageHeight || naturalHeight;
  const scaleX = naturalWidth / (sourceWidth || naturalWidth || 1);
  const scaleY = naturalHeight / (sourceHeight || naturalHeight || 1);
  const x = Math.max(0, Number(box.x) * scaleX);
  const y = Math.max(0, Number(box.y) * scaleY);
  const w = Math.max(0, Number(box.width) * scaleX);
  const h = Math.max(0, Number(box.height) * scaleY);

  if (![x, y, w, h].every(Number.isFinite) || w < 24 || h < 24) {
    return null;
  }

  return {
    x,
    y,
    w: Math.min(w, naturalWidth - x),
    h: Math.min(h, naturalHeight - y),
    score: typeof source.score === 'number' ? source.score : undefined,
    ...(detection?.descriptor?.length === 128
      ? { embedding: Array.from(detection.descriptor).map(Number), embedding_model: 'face-api.js/faceRecognitionNet' }
      : {}),
  };
}

async function detectFacesForImage(image: HTMLImageElement): Promise<DetectedFacePayload[] | undefined> {
  try {
    await loadFaceDetector();
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
    let detections;
    try {
      detections = await faceapi.detectAllFaces(image, options).withFaceLandmarks(true).withFaceDescriptors();
    } catch (_descriptorError: unknown) {
      detections = await faceapi.detectAllFaces(image, options);
    }

    return detections
      .map((detection: any) => bboxFromDetection(detection, image))
      .filter(Boolean) as DetectedFacePayload[];
  } catch (_error: unknown) {
    return undefined;
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function matchLink(articleId: string): string {
  return `${WEB_BASE}/materia/${articleId}`;
}

function srcFromImage(img: HTMLImageElement) {
  return img.currentSrc || img.getAttribute('src') || img.src || '';
}

function reportToPopup() {
  chrome.runtime.sendMessage({ type: 'REPORT_ANALYSIS_STATS', payload: state.analysis });
}

function parseImages(): CandidateImage[] {
  const nodes = Array.from(document.querySelectorAll('img')).filter((el) => {
    if (!(el instanceof HTMLImageElement) || !el.complete) {
      return false;
    }

    const rawSrc = srcFromImage(el);
    const alt = (el.getAttribute('alt') || '').toLowerCase();
    if (el.naturalWidth <= 160 || el.naturalHeight <= 160) {
      return false;
    }
    if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.includes('svg')) {
      return false;
    }
    if (/logo|sprite|icon|badge|avatar|emoji|gif|placeholder/.test(rawSrc.toLowerCase())) {
      return false;
    }
    if (/logo|sprite|icone|marca|avatar/.test(alt)) {
      return false;
    }
    return true;
  });

  const seen = new Set<string>();
  return nodes
    .map((img) => {
      const image_url = String(new URL(srcFromImage(img), location.href));
      return { node: img, image_url, width: Math.round(img.naturalWidth), height: Math.round(img.naturalHeight) };
    })
    .filter((item) => {
      if (!item.image_url || seen.has(item.image_url) || state.processedImages.has(item.image_url)) {
        return false;
      }
      seen.add(item.image_url);
      return true;
    });
}

function upsertSidebarImage(next: SidebarImage) {
  const index = state.sidebarImages.findIndex((item) => item.image_url === next.image_url);
  if (index >= 0) {
    state.sidebarImages[index] = { ...state.sidebarImages[index], ...next };
  } else {
    state.sidebarImages.unshift(next);
  }
  renderSidebar();
}

function statusText(item: SidebarImage) {
  if (item.status === 'queued') {
    return 'Na fila';
  }
  if (item.status === 'analyzing') {
    return 'Analisando';
  }
  if (item.status === 'error') {
    return 'Erro';
  }
  if (item.faces.length === 0) {
    return 'Sem faces';
  }
  const matches = item.faces.reduce((total, face) => total + (face.matches?.length || 0), 0);
  return `${item.faces.length} face(s), ${matches} match(es)`;
}

function faceName(face: any, index: number) {
  const match = face.matches?.[0];
  return match?.name || `Rosto ${index + 1}`;
}

function confidenceLabel(face: any) {
  const match = face.matches?.[0];
  return match ? `${Math.round(Number(match.score || 0) * 100)}%` : 'sem identificação';
}

function suggestionForm(face: any) {
  const faceId = escapeHtml(face.face_id || '');
  const datalistId = `qtnf-people-${faceId}`;
  return `<form class="suggestion-form" data-qtnf-suggestion-form="true" data-face-id="${faceId}">
    <label>
      Nome da pessoa
      <input name="suggested_name" data-qtnf-person-input="${faceId}" list="${datalistId}" autocomplete="off" required />
      <datalist id="${datalistId}"></datalist>
    </label>
    <label>
      Fonte pública
      <input name="source_url" type="url" placeholder="https://..." />
    </label>
    <label>
      Comentário
      <textarea name="comment" rows="2"></textarea>
    </label>
    <label>
      Seu e-mail
      <input name="submitter_email" type="email" />
    </label>
    <button type="submit">Enviar sugestão</button>
    <a href="${WEB_BASE}/admin?new_person=1" target="_blank" rel="noreferrer">Criar novo registro no admin</a>
    <div class="form-feedback" data-qtnf-suggestion-feedback></div>
  </form>`;
}

function renderFaces(item: SidebarImage) {
  if (item.status !== 'ready') {
    return '';
  }
  if (!item.faces.length) {
    return '<p class="empty">Nenhuma face persistida para esta imagem.</p>';
  }

  return `<div class="face-list">
    ${item.faces
      .map((face, index) => {
        const matches = face.matches || [];
        return `<details class="face-card" ${index === 0 ? 'open' : ''}>
          <summary>
            <span>${escapeHtml(faceName(face, index))}</span>
            <small>${escapeHtml(confidenceLabel(face))}</small>
          </summary>
          ${
            matches.length
              ? `<div class="match-list">
                ${matches
                  .map(
                    (match: any) => `<a class="match-row" href="${escapeHtml(match.profile_url || '#')}" target="_blank" rel="noreferrer">
                      <span>${escapeHtml(match.name)}</span>
                      <small>score ${Number(match.score || 0).toFixed(3)}</small>
                    </a>`,
                  )
                  .join('')}
              </div>`
              : `<p class="empty">Sem match automático. Sugira uma identificação para curadoria.</p>${suggestionForm(face)}`
          }
        </details>`;
      })
      .join('')}
  </div>`;
}

function sidebarMarkup() {
  const totalFaces = state.sidebarImages.reduce((total, item) => total + item.faces.length, 0);
  const totalMatches = state.sidebarImages.reduce(
    (total, item) => total + item.faces.reduce((count, face) => count + (face.matches?.length || 0), 0),
    0,
  );

  return `<style>
    :host {
      all: initial;
      color-scheme: light;
      font-family: Georgia, 'Times New Roman', serif;
    }
    * {
      box-sizing: border-box;
    }
    a {
      color: #275dad;
    }
    button,
    input,
    textarea {
      font: inherit;
    }
    .rail {
      background: #191919;
      border: 1px solid #191919;
      bottom: 18px;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
      color: #f7f2e8;
      display: ${state.sidebarOpen ? 'grid' : 'none'};
      grid-template-rows: auto auto minmax(0, 1fr);
      max-height: calc(100vh - 36px);
      position: fixed;
      right: 18px;
      top: 18px;
      width: min(390px, calc(100vw - 36px));
      z-index: 2147483647;
    }
    .toggle {
      background: #191919;
      border: 1px solid #191919;
      color: #f7f2e8;
      display: ${state.sidebarOpen ? 'none' : 'block'};
      font: 700 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      padding: 10px 12px;
      position: fixed;
      right: 18px;
      top: 18px;
      z-index: 2147483647;
    }
    .head {
      background:
        linear-gradient(90deg, rgba(25, 25, 25, 0.04) 1px, transparent 1px),
        linear-gradient(rgba(25, 25, 25, 0.035) 1px, transparent 1px),
        #f7f2e8;
      background-size: 24px 24px;
      border-bottom: 1px solid #191919;
      color: #191919;
      padding: 14px;
    }
    .brand-row,
    .stats,
    .card-head,
    summary,
    .match-row {
      align-items: center;
      display: flex;
      gap: 10px;
      justify-content: space-between;
    }
    .brand {
      font-size: 20px;
      font-weight: 800;
      line-height: 1;
    }
    .close {
      background: #f7f2e8;
      border: 1px solid #191919;
      color: #191919;
      min-height: 30px;
      min-width: 30px;
    }
    .eyebrow,
    .stats,
    .status,
    .dims,
    .muted,
    small,
    .form-feedback {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: 0;
    }
    .eyebrow {
      font-size: 11px;
      margin: 0 0 6px;
      text-transform: uppercase;
    }
    .lede {
      line-height: 1.4;
      margin: 8px 0 0;
    }
    .stats {
      background: #fffaf0;
      border-bottom: 1px solid #191919;
      color: #191919;
      font-size: 12px;
      padding: 9px 14px;
    }
    .list {
      background: #f7f2e8;
      color: #191919;
      display: grid;
      gap: 10px;
      overflow: auto;
      padding: 10px;
    }
    .image-card {
      background: #fffaf0;
      border: 1px solid #2b2b2b;
      display: grid;
      gap: 10px;
      padding: 10px;
    }
    .thumb {
      background: #eadcc7;
      border: 1px solid rgba(25, 25, 25, 0.22);
      display: block;
      max-height: 190px;
      object-fit: contain;
      width: 100%;
    }
    .status {
      background: #191919;
      color: #f7f2e8;
      font-size: 11px;
      padding: 4px 7px;
      white-space: nowrap;
    }
    .dims,
    .muted,
    small,
    .empty {
      color: #555;
      font-size: 12px;
    }
    .card-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 13px;
    }
    .face-list {
      display: grid;
      gap: 8px;
    }
    .face-card {
      border: 1px solid rgba(25, 25, 25, 0.18);
      background: #fff4dd;
    }
    summary {
      cursor: pointer;
      font-weight: 800;
      list-style: none;
      padding: 8px;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    .match-list,
    .suggestion-form {
      border-top: 1px solid rgba(25, 25, 25, 0.16);
      display: grid;
      gap: 7px;
      padding: 8px;
    }
    .match-row {
      background: #fffaf0;
      border: 1px solid rgba(25, 25, 25, 0.12);
      padding: 7px;
      text-decoration: none;
    }
    .suggestion-form label {
      display: grid;
      gap: 4px;
      font-size: 12px;
      font-weight: 800;
    }
    .suggestion-form input,
    .suggestion-form textarea {
      background: #fffaf0;
      border: 1px solid #2b2b2b;
      color: #191919;
      min-height: 32px;
      padding: 6px;
      width: 100%;
    }
    .suggestion-form button {
      background: #191919;
      border: 1px solid #191919;
      color: #f7f2e8;
      min-height: 34px;
    }
    .empty-state {
      border: 1px dashed rgba(25, 25, 25, 0.35);
      color: #555;
      line-height: 1.45;
      padding: 18px;
      text-align: center;
    }
  </style>
  <button class="toggle" data-action="open">Diga-me</button>
  <aside class="rail" aria-live="polite">
    <header class="head">
      <p class="eyebrow">Quem ta na foto?</p>
      <div class="brand-row">
        <div class="brand">Diga-me</div>
        <button class="close" data-action="close" type="button" aria-label="Recolher">×</button>
      </div>
      <p class="lede">Imagens da matéria entram aqui conforme carregam na página.</p>
    </header>
    <div class="stats">
      <span>${state.sidebarImages.length} imagem(ns)</span>
      <span>${totalFaces} face(s)</span>
      <span>${totalMatches} match(es)</span>
    </div>
    <section class="list">
      ${
        state.sidebarImages.length
          ? state.sidebarImages
              .map(
                (item) => `<article class="image-card">
                  <div class="card-head">
                    <strong>${escapeHtml(statusText(item))}</strong>
                    <span class="status">${escapeHtml(item.status)}</span>
                  </div>
                  <img class="thumb" src="${escapeHtml(item.image_url)}" alt="" loading="lazy" />
                  <div class="dims">${item.width} × ${item.height}</div>
                  ${item.warning ? `<p class="empty">${escapeHtml(item.warning)}</p>` : ''}
                  ${renderFaces(item)}
                  <div class="card-links">
                    <a href="${escapeHtml(item.image_url)}" target="_blank" rel="noreferrer">Abrir imagem</a>
                    ${item.articleId ? `<a href="${matchLink(item.articleId)}" target="_blank" rel="noreferrer">Matéria no sistema</a>` : ''}
                  </div>
                </article>`,
              )
              .join('')
          : '<div class="empty-state">Aguardando imagens grandes da pagina autorizada.</div>'
      }
    </section>
  </aside>`;
}

function ensureSidebar() {
  if (state.sidebarRoot) {
    return state.sidebarRoot;
  }

  const existing = document.getElementById(SIDEBAR_ID);
  if (existing) {
    existing.remove();
  }

  const host = document.createElement('div');
  host.id = SIDEBAR_ID;
  document.documentElement.appendChild(host);
  state.sidebarRoot = host.attachShadow({ mode: 'open' });
  renderSidebar();
  return state.sidebarRoot;
}

function bindSidebarEvents(root: ShadowRoot) {
  root.querySelectorAll('[data-action="close"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.sidebarOpen = false;
      renderSidebar();
    });
  });

  root.querySelectorAll('[data-action="open"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.sidebarOpen = true;
      renderSidebar();
    });
  });

  root.querySelectorAll('[data-qtnf-suggestion-form="true"]').forEach((form) => {
    bindSuggestionForm(form as HTMLFormElement);
  });
}

function renderSidebar() {
  const root = ensureSidebar();
  root.innerHTML = sidebarMarkup();
  bindSidebarEvents(root);
}

function bindSuggestionForm(form: HTMLFormElement) {
  const faceId = form.dataset.faceId || '';
  const input = form.querySelector(`[data-qtnf-person-input="${CSS.escape(faceId)}"]`) as HTMLInputElement | null;
  const list = form.querySelector(`#qtnf-people-${CSS.escape(faceId)}`) as HTMLDataListElement | null;
  const feedback = form.querySelector('[data-qtnf-suggestion-feedback]') as HTMLDivElement | null;

  input?.addEventListener('input', () => {
    window.clearTimeout(autocompleteTimer);
    const query = input.value.trim();
    if (!list || query.length < 2) {
      if (list) {
        list.innerHTML = '';
      }
      return;
    }

    autocompleteTimer = window.setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'SEARCH_PEOPLE', query }, (response) => {
        if (!response?.ok || !Array.isArray(response.payload)) {
          return;
        }

        list.innerHTML = response.payload
          .map((person: any) => `<option value="${escapeHtml(person.display_name || person.name)}" data-person-id="${escapeHtml(person.id)}"></option>`)
          .join('');
      });
    }, 180);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('suggested_name') || '').trim();
    const selectedOption = Array.from(form.querySelectorAll('option')).find((option: any) => option.value === name) as HTMLOptionElement | undefined;
    const payload = {
      suggested_name: name,
      suggested_person_id: selectedOption?.dataset.personId || null,
      source_url: String(data.get('source_url') || '').trim() || null,
      comment: String(data.get('comment') || '').trim() || null,
      submitter_email: String(data.get('submitter_email') || '').trim() || null,
    };

    if (!payload.suggested_name) {
      if (feedback) {
        feedback.textContent = 'Informe um nome sugerido.';
      }
      return;
    }

    if (feedback) {
      feedback.textContent = 'Enviando sugestao...';
    }
    chrome.runtime.sendMessage({ type: 'SUBMIT_SUGGESTION', faceId, payload }, (response) => {
      if (feedback) {
        feedback.textContent = response?.ok
          ? 'Sugestao enviada. Ela aparece publicamente so apos revisao.'
          : 'Nao foi possivel enviar a sugestao agora.';
      }
      if (response?.ok) {
        form.reset();
      }
    });
  }, { once: true });
}

function updateStats() {
  state.analysis.images = state.sidebarImages.length;
  state.analysis.faces = state.sidebarImages.reduce((total, item) => total + item.faces.length, 0);
  state.analysis.matches = state.sidebarImages.reduce(
    (total, item) => total + item.faces.reduce((count, face) => count + (face.matches?.length || 0), 0),
    0,
  );
  reportToPopup();
}

async function analyzeCandidates(candidates: CandidateImage[]) {
  const candidatesWithFaces = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      faces: await detectFacesForImage(candidate.node),
    })),
  );
  const candidateByUrl = new Map(candidatesWithFaces.map((candidate) => [candidate.image_url, candidate]));
  const payload = {
    page_url: window.location.href,
    title: document.title,
    images: candidatesWithFaces.map(({ image_url, width, height, faces }) => ({
      image_url,
      width,
      height,
      ...(faces !== undefined ? { faces } : {}),
    })),
  };

  chrome.runtime.sendMessage({ type: 'ANALYZE_PAGE', payload }, (response) => {
    if (!response?.ok) {
      candidatesWithFaces.forEach((candidate) => {
        upsertSidebarImage({
          image_url: candidate.image_url,
          width: candidate.width,
          height: candidate.height,
          status: 'error',
          faces: [],
          warning: 'Nao foi possivel analisar esta imagem agora.',
        });
      });
      updateStats();
      return;
    }

    const result = response.payload;
    const returnedUrls = new Set<string>();
    result.results?.forEach((entry: any) => {
      const candidate = candidateByUrl.get(entry.image_url);
      if (!candidate) {
        return;
      }
      returnedUrls.add(entry.image_url);
      upsertSidebarImage({
        image_url: candidate.image_url,
        width: candidate.width,
        height: candidate.height,
        status: 'ready',
        articleId: result.article_id || '',
        faces: Array.isArray(entry.faces) ? entry.faces : [],
      });
    });

    candidatesWithFaces.forEach((candidate) => {
      if (!returnedUrls.has(candidate.image_url)) {
        upsertSidebarImage({
          image_url: candidate.image_url,
          width: candidate.width,
          height: candidate.height,
          status: 'ready',
          articleId: result.article_id || '',
          faces: [],
        });
      }
    });
    updateStats();
  });
}

async function scanForNewImages() {
  const url = new URL(window.location.href);
  const host = normalizeHost(url.hostname);

  if (!isAllowedDomain(host) || state.disabledSites.has(host)) {
    return;
  }

  ensureSidebar();
  if (state.analyzing) {
    state.queuedScan = true;
    return;
  }

  const candidates = parseImages();
  if (candidates.length === 0) {
    return;
  }

  state.analyzing = true;
  candidates.forEach((candidate) => {
    state.processedImages.add(candidate.image_url);
    upsertSidebarImage({
      image_url: candidate.image_url,
      width: candidate.width,
      height: candidate.height,
      status: 'analyzing',
      faces: [],
    });
  });
  updateStats();

  try {
    await analyzeCandidates(candidates);
  } finally {
    state.analyzing = false;
    if (state.queuedScan) {
      state.queuedScan = false;
      scheduleScan(300);
    }
  }
}

function scheduleScan(delay = 600) {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => {
    void scanForNewImages();
  }, delay);
}

function observePageImages() {
  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'data-src', 'data-original'],
  });
  document.addEventListener('load', (event) => {
    if (event.target instanceof HTMLImageElement) {
      scheduleScan(120);
    }
  }, true);
}

chrome.storage.local.get('disabledSites', (data) => {
  const list = data?.disabledSites || [];
  state.disabledSites = new Set((list || []).map((item: unknown) => normalizeHost(String(item))));
});

chrome.runtime.sendMessage({ type: 'GET_ALLOWED_DOMAINS' }, (response) => {
  const payload = response?.payload;
  if (Array.isArray(payload) && payload.length > 0) {
    state.allowlist = new Set(payload.map((entry: unknown) => normalizeHost(String(entry))));
  }
  scheduleScan(100);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'DISABLED_SITES_UPDATED') {
    state.disabledSites = new Set((message.disabledSites || []).map((item: unknown) => normalizeHost(String(item))));
  }
});

window.addEventListener('load', () => scheduleScan(800));
observePageImages();
