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
  if (matchCount === 0) {
    return 'Pessoa não identificada';
  }
  return `${matchCount} possíveis figuras públicas`;
}

function matchLink(articleId: string): string {
  return `${WEB_BASE}/materia/${articleId}`;
}

function suggestionForm(faceId: string) {
  return `<form data-qtnf-suggestion-form="true" style="display: grid; gap: 6px; margin-top: 6px;">
    <label>
      Nome da pessoa
      <input name="suggested_name" data-qtnf-person-input="${faceId}" list="qtnf-people-${faceId}" autocomplete="off" required style="width: 100%;" />
      <datalist id="qtnf-people-${faceId}"></datalist>
    </label>
    <label>
      Link de fonte pública
      <input name="source_url" type="url" style="width: 100%;" />
    </label>
    <label>
      Comentário
      <textarea name="comment" style="width: 100%;"></textarea>
    </label>
    <label>
      Seu e-mail
      <input name="submitter_email" type="email" style="width: 100%;" />
    </label>
    <button type="submit" data-face-id="${faceId}">Enviar sugestão para revisão</button>
    <a href="${WEB_BASE}/admin?new_person=1" target="_blank" rel="noreferrer">Criar novo registro no admin</a>
    <div data-qtnf-suggestion-feedback style="font-size: 11px;"></div>
  </form>`;
}

function bindAutocomplete(popup: HTMLDivElement, faceId: string) {
  const input = popup.querySelector(`[data-qtnf-person-input="${faceId}"]`) as HTMLInputElement | null;
  const list = popup.querySelector(`#qtnf-people-${faceId}`) as HTMLDataListElement | null;
  if (!input || !list) {
    return;
  }

  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) {
      list.innerHTML = '';
      return;
    }

    timer = window.setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'SEARCH_PEOPLE', query }, (response) => {
        if (!response?.ok || !Array.isArray(response.payload)) {
          return;
        }

        list.innerHTML = response.payload
          .map((person: any) => `<option value="${person.display_name || person.name}" data-person-id="${person.id}"></option>`)
          .join('');
      });
    }, 180);
  });
}

function bindSuggestionForm(popup: HTMLDivElement, faceId: string) {
  const form = popup.querySelector('[data-qtnf-suggestion-form="true"]') as HTMLFormElement | null;
  const feedback = popup.querySelector('[data-qtnf-suggestion-feedback]') as HTMLDivElement | null;
  bindAutocomplete(popup, faceId);
  if (!form) {
    return;
  }

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

    chrome.runtime.sendMessage({ type: 'SUBMIT_SUGGESTION', faceId, payload }, (response) => {
      if (feedback) {
        feedback.textContent = response?.ok
          ? 'Sugestão enviada. Ela só aparece publicamente após revisão manual.'
          : 'Não foi possível enviar a sugestão agora.';
      }
      if (response?.ok) {
        form.reset();
      }
    });
  }, { once: true });
}

function faceLabel(face: any) {
  const matches = face.matches || [];
  return matches.length > 0 ? styleBadge(matches.length) : 'Pessoa não identificada';
}

function positionMarker(marker: HTMLElement, face: any, image: HTMLImageElement) {
  const bbox = face.bbox || {};
  const naturalWidth = image.naturalWidth || image.width || 1;
  const naturalHeight = image.naturalHeight || image.height || 1;
  const left = Math.max(0, (Number(bbox.x || 0) / naturalWidth) * 100);
  const top = Math.max(0, (Number(bbox.y || 0) / naturalHeight) * 100);
  const width = Math.min(100 - left, (Number(bbox.w || naturalWidth * 0.2) / naturalWidth) * 100);
  const height = Math.min(100 - top, (Number(bbox.h || naturalHeight * 0.2) / naturalHeight) * 100);

  marker.style.left = `${left}%`;
  marker.style.top = `${top}%`;
  marker.style.width = `${Math.max(8, width)}%`;
  marker.style.height = `${Math.max(8, height)}%`;
}

function buildOverlay(image: HTMLImageElement, faces: any[], articleId: string) {
  const target = image.parentElement?.tagName === 'PICTURE' ? image.parentElement : image;
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = getComputedStyle(target).display === 'block' ? 'block' : 'inline-block';
  wrapper.style.maxWidth = '100%';
  wrapper.style.verticalAlign = 'top';
  wrapper.dataset.qtnfOverlay = 'true';

  target.parentNode?.insertBefore(wrapper, target);
  wrapper.appendChild(target);

  faces.forEach((face: any, index: number) => {
    const matches = face.matches || [];
    const faceId = face.face_id || '';
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.textContent = faceLabel(face);
    marker.style.position = 'absolute';
    marker.style.background = matches.length > 0 ? 'rgba(39,93,173,0.16)' : 'rgba(217,74,56,0.14)';
    marker.style.color = '#191919';
    marker.style.border = matches.length > 0 ? '2px solid #275DAD' : '2px solid #D94A38';
    marker.style.padding = '2px';
    marker.style.fontFamily = 'Georgia, serif';
    marker.style.fontSize = '11px';
    marker.style.lineHeight = '1.15';
    marker.style.cursor = 'pointer';
    marker.style.zIndex = '2147483647';
    marker.style.boxShadow = '0 2px 10px rgba(0,0,0,0.18)';
    positionMarker(marker, face, image);

    const popup = document.createElement('div');
    popup.style.position = 'absolute';
    popup.style.left = marker.style.left;
    popup.style.top = `calc(${marker.style.top} + ${marker.style.height} + 8px)`;
    popup.style.padding = '10px';
    popup.style.display = 'none';
    popup.style.width = '280px';
    popup.style.maxWidth = 'calc(100% - 20px)';
    popup.style.background = '#F7F2E8';
    popup.style.color = '#191919';
    popup.style.border = '1px solid #2B2B2B';
    popup.style.fontFamily = 'Georgia, serif';
    popup.style.fontSize = '12px';
    popup.style.lineHeight = '1.45';
    popup.style.boxShadow = '0 8px 24px rgba(0,0,0,0.22)';
    popup.style.zIndex = '2147483650';

    marker.addEventListener('click', () => {
      wrapper.querySelectorAll('[data-qtnf-face-popup]').forEach((node: any) => {
        if (node !== popup) {
          node.style.display = 'none';
        }
      });

    const rows = matches.length > 0
      ? matches
          .map(
            (match: any) =>
              `<div>
                <div><strong>${match.name}</strong> — score ${match.score.toFixed(3)}</div>
                <div><a href="${match.profile_url || '#'}">${match.profile_url ? 'Perfil público' : 'Sem perfil disponível'}</a></div>
              </div>`,
          )
          .join('')
      : `<div>
          <strong>Pessoa não identificada</strong>
          <p>Você acha que sabe quem é? Busque uma pessoa existente ou envie um novo nome para curadoria.</p>
        </div>`;
    const articleHref = articleId ? `<div><a href="${matchLink(articleId)}">Ver matéria no sistema</a></div>` : '';
    popup.innerHTML = `${rows}
      ${articleHref}
      ${matches.length === 0 && faceId ? suggestionForm(faceId) : ''}
      <div style="margin-top: 6px; font-size: 11px; color: #444;">Identificação automatizada pode conter erros.</div>`;
    if (matches.length === 0 && faceId) {
      bindSuggestionForm(popup, faceId);
    }
    popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
  });

    popup.dataset.qtnfFacePopup = String(index);
    wrapper.appendChild(marker);
    wrapper.appendChild(popup);
  });
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

      const entryFaces = [];
      for (const face of entry.faces) {
        const matches = face.matches || [];
        state.analysis.faces += 1;
        state.analysis.matches += matches.length;
        entryFaces.push(face);
      }

      if (entryFaces.length > 0) {
        buildOverlay(imageElement, entryFaces, result.article_id || '');
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
