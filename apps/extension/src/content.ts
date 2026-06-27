// @ts-nocheck
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

type CandidateImage = {
  node: HTMLImageElement;
  image_url: string;
  width: number;
  height: number;
};

const state = {
  disabledSites: new Set(),
  allowlist: new Set<string>(ALLOWLIST_FALLBACK),
  analyzed: false,
  analysis: {
    images: 0,
    faces: 0,
    matches: 0,
  },
};

const WEB_BASE = 'http://localhost:3000';

function isAllowedDomain(hostname: string) {
  const normalized = hostname.replace(/^www\./, '').toLowerCase();
  return state.allowlist.has(normalized);
}

function normalizeHost(hostname: string) {
  return hostname.replace(/^www\./, '').toLowerCase();
}

function styleBadge(matchCount: number) {
  return `${matchCount} possíveis figuras públicas`;
}

function matchLink(articleId: string): string {
  return `${WEB_BASE}/materia/${articleId}`;
}

function buildOverlay(image: HTMLImageElement, matches: any[], faceId: string, articleId: string) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';

  const badge = document.createElement('div');
  badge.textContent = styleBadge(matches.length);
  badge.style.position = 'absolute';
  badge.style.left = '0';
  badge.style.bottom = '0';
  badge.style.background = 'rgba(255,255,255,0.85)';
  badge.style.color = '#191919';
  badge.style.fontSize = '11px';
  badge.style.padding = '2px 6px';
  badge.style.border = '1px solid #2B2B2B';
  badge.style.zIndex = '2147483647';

  const button = document.createElement('button');
  button.textContent = 'Ver possibilidades';
  button.style.position = 'absolute';
  button.style.top = '0';
  button.style.right = '0';
  button.style.zIndex = '2147483647';

  const popup = document.createElement('div');
  popup.style.position = 'absolute';
  popup.style.top = '18px';
  popup.style.right = '0';
  popup.style.padding = '8px';
  popup.style.display = 'none';
  popup.style.width = '240px';
  popup.style.background = '#fff';
  popup.style.color = '#191919';
  popup.style.border = '1px solid #2B2B2B';
  popup.style.fontSize = '12px';
  popup.style.zIndex = '2147483650';

  button.addEventListener('click', () => {
    const rows = matches
      .map(
        (match: any) =>
          `<div>
            <div><strong>${match.name}</strong> — score ${match.score.toFixed(3)}</div>
            <div><a href="${match.profile_url || '#'}">${match.profile_url ? 'Perfil público' : 'Sem perfil disponível'}</a></div>
          </div>`,
      )
      .join('');
    const articleHref = articleId ? `<div><a href="${matchLink(articleId)}">Ver matéria no sistema</a></div>` : '';
    popup.innerHTML = `${rows}
      ${articleHref}
      <div style="margin-top: 6px; font-size: 11px; color: #444;">Identificação automatizada pode conter erros.</div>`;
    popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
  });

  wrapper.appendChild(image.cloneNode(true));
  wrapper.appendChild(badge);
  wrapper.appendChild(button);
  wrapper.appendChild(popup);
  image.replaceWith(wrapper);
}

function parseImages(): CandidateImage[] {
  const nodes = Array.from(document.querySelectorAll('img')).filter((el) => {
    const src = el.getAttribute('src') || '';
    const alt = (el.getAttribute('alt') || '').toLowerCase();
    if (el.naturalWidth <= 160 || el.naturalHeight <= 160) {
      return false;
    }
    if (src.startsWith('data:') || src.includes('svg')) {
      return false;
    }
    if (/logo|sprite|icon|badge|avatar|emoji|gif|placeholder/.test(src.toLowerCase())) {
      return false;
    }
    if (/logo|sprite|icone|marca|avatar/.test(alt)) {
      return false;
    }
    return true;
  });

  const seen = new Set<string>();
  const safeCandidates = nodes
    .map((img) => {
      const image_url = String(new URL(srcFromImage(img), location.href));
      return { node: img, image_url, width: Math.round(img.naturalWidth), height: Math.round(img.naturalHeight) };
    })
    .filter((item) => {
      if (!item.image_url || seen.has(item.image_url)) {
        return false;
      }
      seen.add(item.image_url);
      return true;
    });

  return safeCandidates;
}

function srcFromImage(img: HTMLImageElement) {
  return img.getAttribute('src') || img.currentSrc || img.src || '';
}

function buildImageMapFromCandidates(candidates: CandidateImage[]) {
  const index = new Map<string, CandidateImage[]>();
  for (const item of candidates) {
    const existing = index.get(item.image_url) || [];
    existing.push(item);
    index.set(item.image_url, existing);
  }
  return index;
}

function matchImagesForResult(imageMap: Map<string, CandidateImage[]>, imageUrl: string): CandidateImage | null {
  const candidates = imageMap.get(imageUrl);
  if (!candidates || candidates.length === 0) {
    return null;
  }
  return candidates.shift() || null;
}

function reportToPopup() {
  chrome.runtime.sendMessage({ type: 'REPORT_ANALYSIS_STATS', payload: state.analysis });
}

async function analyzeCurrentPage() {
  const url = new URL(window.location.href);
  const host = normalizeHost(url.hostname);

  if (!isAllowedDomain(host)) {
    return;
  }

  if (state.disabledSites.has(host)) {
    return;
  }

  if (state.analyzed) {
    return;
  }

  const candidates = parseImages();
  const imageMap = buildImageMapFromCandidates(candidates);
  state.analysis.images = candidates.length;
  state.analysis.faces = 0;
  state.analysis.matches = 0;
  reportToPopup();

  const payload = {
    page_url: window.location.href,
    title: document.title,
    images: candidates.map(({ image_url, width, height }) => ({
      image_url,
      width,
      height,
    })),
  };

  chrome.runtime.sendMessage({ type: 'ANALYZE_PAGE', payload }, (response) => {
    if (!response?.ok) {
      return;
    }

    const result = response.payload;
    result.results?.forEach((entry: any) => {
      const candidate = matchImagesForResult(imageMap, entry.image_url);
      const imageElement = candidate?.node;
      if (!imageElement || entry.faces.length === 0) {
        return;
      }

      const entryMatches = [];
      let firstFaceId = `${entry.image_id}-${Math.random()}`;
      for (const face of entry.faces) {
        const matches = face.matches || [];
        state.analysis.faces += 1;
        state.analysis.matches += matches.length;
        if (matches.length > 0) {
          firstFaceId = face.face_id || firstFaceId;
          entryMatches.push(...matches);
        }
      }

      if (entryMatches.length > 0) {
        buildOverlay(imageElement, entryMatches, firstFaceId, result.article_id || '');
      }
    });
    state.analyzed = true;
    reportToPopup();
  });
}

chrome.storage.local.get('disabledSites', (data) => {
  const list = data?.disabledSites || [];
  state.disabledSites = new Set((list || []).map((item: unknown) => String(item).replace(/^www\./, '').toLowerCase()));
});

chrome.runtime.sendMessage({ type: 'GET_ALLOWED_DOMAINS' }, (response) => {
  const payload = response?.payload;
  if (Array.isArray(payload) && payload.length > 0) {
    state.allowlist = new Set(payload.map((entry: unknown) => String(entry).toLowerCase().replace(/^www\./, '')));
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'DISABLED_SITES_UPDATED') {
    state.disabledSites = new Set((message.disabledSites || []).map((item: unknown) => String(item).replace(/^www\./, '').toLowerCase()));
  }
});

window.addEventListener('load', () => setTimeout(analyzeCurrentPage, 800));
