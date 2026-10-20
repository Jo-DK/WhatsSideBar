'use strict';

const DEFAULTS = {
  enabled: false,
  width: 210,
  showName: true,
  hidePreview: true,
  hideTime: true,
};

const el = {
  enabled: document.getElementById('enabled'),
  width: document.getElementById('width'),
  widthOut: document.getElementById('width-out'),
  widthRow: document.getElementById('width-row'),
  showName: document.getElementById('showName'),
  hidePreview: document.getElementById('hidePreview'),
  hideTime: document.getElementById('hideTime'),
};

function render(cfg) {
  el.enabled.checked = !!cfg.enabled;
  el.width.value = cfg.width;
  el.widthOut.value = cfg.width + 'px';
  el.showName.checked = !!cfg.showName;
  el.hidePreview.checked = !!cfg.hidePreview;
  el.hideTime.checked = !!cfg.hideTime;
  el.widthRow.dataset.disabled = String(!cfg.showName);
}

chrome.storage.local.get(DEFAULTS, (stored) => render({ ...DEFAULTS, ...(stored || {}) }));

el.enabled.addEventListener('change', () => chrome.storage.local.set({ enabled: el.enabled.checked }));
el.hidePreview.addEventListener('change', () => chrome.storage.local.set({ hidePreview: el.hidePreview.checked }));
el.hideTime.addEventListener('change', () => chrome.storage.local.set({ hideTime: el.hideTime.checked }));

el.showName.addEventListener('change', () => {
  el.widthRow.dataset.disabled = String(!el.showName.checked);
  chrome.storage.local.set({ showName: el.showName.checked });
});

el.width.addEventListener('input', () => {
  el.widthOut.value = el.width.value + 'px';
  chrome.storage.local.set({ width: Number(el.width.value) });
});
