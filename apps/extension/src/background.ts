// @ts-nocheck
const API_BASE = 'http://localhost:8000/api/v1';
const ALLOW_DOMAINS_FALLBACK = [
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

let lastAnalysis = {
  images: 0,
  faces: 0,
  matches: 0,
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_ALLOWED_DOMAINS') {
    fetch(`${API_BASE}/allowed-domains`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        const list = Array.isArray(rows) ? rows.map((row) => String(row.domain || '').toLowerCase()) : [];
        sendResponse({ ok: true, payload: list.filter(Boolean) });
      })
      .catch((_error) => {
        sendResponse({ ok: true, payload: ALLOW_DOMAINS_FALLBACK });
      });
    return true;
  }

  if (message?.type === 'ANALYZE_PAGE') {
    fetch(`${API_BASE}/extension/analyze-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.payload),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || 'Erro no backend');
        }
        return res.json();
      })
      .then((data) => sendResponse({ ok: true, payload: data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'erro' }));
    return true;
  }

  if (message?.type === 'SUBMIT_SUGGESTION') {
    const faceId = message.faceId;
    const payload = message.payload;
    fetch(`${API_BASE}/extension/faces/${faceId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || 'Erro ao enviar sugestão');
        }
        return res.json();
      })
      .then((data) => sendResponse({ ok: true, payload: data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'erro' }));
    return true;
  }

  if (message?.type === 'SEARCH_PEOPLE') {
    const query = encodeURIComponent(String(message.query || '').trim());
    if (!query) {
      sendResponse({ ok: true, payload: [] });
      return true;
    }

    fetch(`${API_BASE}/people?query=${query}`)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || 'Erro ao buscar pessoas');
        }
        return res.json();
      })
      .then((data) => sendResponse({ ok: true, payload: Array.isArray(data) ? data : [] }))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'erro' }));
    return true;
  }

  if (message?.type === 'REPORT_ANALYSIS_STATS') {
    lastAnalysis = message.payload || lastAnalysis;
    return false;
  }

  if (message?.type === 'GET_ANALYSIS_STATS') {
    sendResponse(lastAnalysis);
    return true;
  }

  return false;
});
