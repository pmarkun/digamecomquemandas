// @ts-nocheck
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const button = document.querySelector('#toggle');

function setStatus(message) {
  if (status) status.textContent = message;
}

function refreshStats() {
  chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_STATS' }, (payload) => {
    const data = payload || { images: 0, faces: 0, matches: 0 };
    if (result) {
      result.textContent = `Imagens: ${data.images} | Faces: ${data.faces} | Matches: ${data.matches}`;
    }
  });
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const host = String(new URL(tab?.url || 'https://example.com').hostname).replace(/^www\./, '').toLowerCase();
  chrome.storage.local.get('disabledSites', (data) => {
    const list = new Set((data?.disabledSites || []).map((item: unknown) => String(item).replace(/^www\./, '').toLowerCase()));
    setStatus(list.has(host) ? `Desativado em: ${host}` : `Ativo em: ${host}`);
    button.textContent = list.has(host) ? 'Ativar neste site' : 'Desativar neste site';
  });
  refreshStats();

  button?.addEventListener('click', () => {
    chrome.storage.local.get('disabledSites', (data) => {
      const list = new Set((data?.disabledSites || []).map((item: unknown) => String(item).replace(/^www\./, '').toLowerCase()));
      if (list.has(host)) {
        list.delete(host);
        button.textContent = 'Desativar neste site';
      } else {
        list.add(host);
        button.textContent = 'Ativar neste site';
      }
      chrome.storage.local.set({ disabledSites: Array.from(list) }, () => {
        setStatus(list.has(host) ? `Desativado em: ${host}` : `Ativo em: ${host}`);
        chrome.tabs.query({ active: true, currentWindow: true }, (currentTabs) => {
          const currentTab = currentTabs[0];
          if (!currentTab?.id) {
            return;
          }
          chrome.tabs.sendMessage(currentTab.id, {
            type: 'DISABLED_SITES_UPDATED',
            disabledSites: Array.from(list),
          });
        });
      });
    });
  });
});
