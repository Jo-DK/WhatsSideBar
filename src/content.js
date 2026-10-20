/*
 * WhatsSideBar — recolhe a coluna de conversas do WhatsApp Web.
 *
 * As classes CSS do WhatsApp Web sao ofuscadas e mudam com frequencia, entao
 * nada aqui depende delas. A coluna e achada pela estrutura e os elementos
 * interessantes recebem atributos data-wsb-* proprios, que sao os unicos
 * seletores usados em content.css.
 */
(() => {
  'use strict';

  if (window.top !== window) return;

  const DEFAULTS = {
    enabled: false,
    width: 210,
    showName: true,
    hidePreview: true,
    hideTime: true,
  };

  const ICON_ONLY_WIDTH = 76;
  const MIN_WIDTH = 120;
  const MAX_WIDTH = 520;

  const root = document.documentElement;
  const store = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;

  let cfg = { ...DEFAULTS };
  let column = null;
  let columnVia = null; // 'main' (regra boa) | 'width' | 'side' (fallbacks)
  let taggedAncestors = [];
  let handle = null;
  let handleBtn = null;
  let line = null;
  let lineColor = '';
  let rowObserver = null;
  let columnObserver = null;
  let edgeObserver = null;
  let tagTimer = 0;
  let gridParent = null;
  let gridPrevValue = null;

  /* ------------------------------------------------------------------ util */

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function effectiveWidth() {
    return cfg.showName ? clamp(Number(cfg.width) || DEFAULTS.width, MIN_WIDTH, MAX_WIDTH) : ICON_ONLY_WIDTH;
  }

  function loadCfg() {
    return new Promise((resolve) => {
      if (!store) return resolve({ ...DEFAULTS });
      try {
        store.get(DEFAULTS, (v) => resolve({ ...DEFAULTS, ...(v || {}) }));
      } catch {
        resolve({ ...DEFAULTS });
      }
    });
  }

  function saveCfg(patch) {
    try {
      store && store.set(patch);
    } catch {
      /* ignore */
    }
  }

  /* -------------------------------------------------------- achar a coluna */

  // Regra boa: subindo de #pane-side, o ancestral que tem um IRMAO contendo
  // #main (o painel da conversa). Esse ancestral e a coluna inteira da lista —
  // nao #side, que pode ser so um pedaco dela.
  //
  // Os fallbacks existem porque #main so aparece com uma conversa aberta: no
  // boot do app a regra boa nao casa. Por isso a deteccao e refeita enquanto o
  // resultado vier de um fallback (ver ensureColumn).
  function findColumn() {
    const pane = document.querySelector('#pane-side');
    if (!pane) return null;

    let el = pane;
    while (el && el.parentElement && el.parentElement !== root) {
      const parent = el.parentElement;
      const sibHasMain = Array.prototype.some.call(
        parent.children,
        (sib) => sib !== el && (sib.id === 'main' || sib.querySelector('#main'))
      );
      if (sibHasMain) return { el, via: 'main' };
      el = parent;
    }

    // Sem #main: o primeiro ancestral cujo pai e bem mais largo que ele, ou
    // seja, a coluna dentro da linha do app.
    el = pane;
    while (el && el.parentElement && el.parentElement !== root) {
      const parent = el.parentElement;
      if (parent.offsetWidth - el.offsetWidth > 120) return { el, via: 'width' };
      el = parent;
    }

    const side = document.querySelector('#side');
    if (side && side.contains(pane)) return { el: side, via: 'side' };

    return null;
  }

  function clearColumnTags() {
    if (column) column.removeAttribute('data-wsb-el');
    for (const a of taggedAncestors) a.removeAttribute('data-wsb-el');
    taggedAncestors = [];
    column = null;
    columnVia = null;
  }

  function ensureColumn() {
    const pane = document.querySelector('#pane-side');
    if (!pane) {
      if (column) clearColumnTags();
      return null;
    }

    // 'main' e definitivo; qualquer outro resultado e provisorio e refeito.
    if (column && column.isConnected && columnVia === 'main') return column;

    const found = findColumn();
    if (!found) {
      if (column && !column.isConnected) clearColumnTags();
      return column && column.isConnected ? column : null;
    }

    if (found.el === column && column.isConnected) {
      columnVia = found.via;
      return column;
    }

    clearColumnTags();
    column = found.el;
    columnVia = found.via;
    column.setAttribute('data-wsb-el', 'column');

    // min-width: 0 na cadeia de ancestrais, senao um min-width herdado do
    // layout do app impede a coluna de encolher de verdade.
    let p = column.parentElement;
    while (p && p !== root && p !== document.body) {
      p.setAttribute('data-wsb-el', 'ancestor');
      taggedAncestors.push(p);
      if (p.id === 'app') break;
      p = p.parentElement;
    }

    watchEdge();
    return column;
  }

  /* ------------------------------------------------------------- grid host */

  // Se o pai da coluna for um CSS grid, a largura do filho nao vence a trilha
  // do grid: nesse caso reescrevemos grid-template-columns.
  function applyGridHost() {
    const parent = column && column.parentElement;

    if (gridParent && (gridParent !== parent || !cfg.enabled || !column)) {
      gridParent.style.gridTemplateColumns = gridPrevValue || '';
      gridParent = null;
      gridPrevValue = null;
    }

    if (!cfg.enabled || !column || !parent) return;

    const cs = getComputedStyle(parent);
    if (!cs.display.includes('grid')) return;

    const tracks = cs.gridTemplateColumns.split(' ').filter(Boolean);
    if (tracks.length < 2) return;

    const kids = Array.prototype.filter.call(parent.children, (k) => getComputedStyle(k).display !== 'none');
    const idx = kids.indexOf(column);
    if (idx < 0 || idx >= tracks.length) return;

    const w = effectiveWidth() + 'px';
    const flexIdx = idx + 1 < tracks.length ? idx + 1 : idx - 1;
    const next = tracks.map((t, i) => (i === idx ? w : i === flexIdx ? 'minmax(0, 1fr)' : t));

    if (gridParent !== parent) {
      gridParent = parent;
      gridPrevValue = parent.style.gridTemplateColumns;
    }
    parent.style.setProperty('grid-template-columns', next.join(' '), 'important');
  }

  /* ------------------------------------------------- marcar linhas da lista */

  // A linha da conversa nao tem role nem classe estavel. Ela e o ancestral do
  // nome que e filho do container que se repete: aquele com >= 3 filhos que
  // tambem contem um span[title].
  function rowOfName(name, pane) {
    let n = name;
    let guard = 0;
    while (n && n.parentElement && n !== pane && guard++ < 12) {
      const p = n.parentElement;
      if (p === pane) return n;
      const kids = p.children;
      if (kids.length >= 3) {
        let withNames = 0;
        for (const k of kids) {
          if (k.querySelector('span[title]') && ++withNames >= 3) break;
        }
        if (withNames >= 3) return n;
      }
      n = p;
    }
    return null;
  }

  // Dentro da linha: sobe do span[title] do nome ate o elemento cujo irmao
  // seguinte comeca ABAIXO dele (geometria, nao classe). Esse par e
  // [linha do nome, linha da previa].
  function tagFromName(name, pane) {
    const row = rowOfName(name, pane);
    if (!row) return false;

    const rowH = row.getBoundingClientRect().height;
    if (!rowH) return false; // fora da viewport virtual: tenta depois

    let node = name;
    while (node && node !== row && node.parentElement) {
      const sib = node.nextElementSibling;
      if (sib) {
        const a = node.getBoundingClientRect();
        const b = sib.getBoundingClientRect();
        if (!a.height || !b.height) return false;
        // o par tem que caber dentro da linha: protege contra casar a linha
        // inteira com a linha seguinte da lista
        if (b.top >= a.bottom - 2 && a.height <= rowH * 0.8) {
          const titleRow = node;
          const msgRow = sib;
          const content = node.parentElement;

          content.setAttribute('data-wsb-el', 'content');
          if (content.parentElement) content.parentElement.setAttribute('data-wsb-el', 'rowflex');

          msgRow.setAttribute('data-wsb-el', 'msgrow');
          if (msgRow.firstElementChild) msgRow.firstElementChild.setAttribute('data-wsb-el', 'preview');

          // na linha do nome, tudo que nao contem o nome e metadado (hora)
          Array.prototype.forEach.call(titleRow.children, (child) => {
            if (!child.contains(name)) child.setAttribute('data-wsb-el', 'meta');
          });

          row.setAttribute('data-wsb-row', 'done');
          name.setAttribute('data-wsb-name', '1');
          return true;
        }
      }
      node = node.parentElement;
    }
    return false;
  }

  function tagRows() {
    const pane = document.querySelector('#pane-side');
    if (!pane) return;
    const names = pane.querySelectorAll('span[title]:not([data-wsb-name])');
    for (const name of names) tagFromName(name, pane);
  }

  function tagRowsSoon() {
    if (tagTimer) return;
    tagTimer = setTimeout(() => {
      tagTimer = 0;
      if (cfg.enabled) tagRows();
    }, 120);
  }

  function startRowTagging() {
    tagRowsSoon();
    const pane = document.querySelector('#pane-side');
    if (!pane || rowObserver) return;
    // Só childList: nossas proprias mudancas sao de atributo, sem laco.
    rowObserver = new MutationObserver(tagRowsSoon);
    rowObserver.observe(pane, { childList: true, subtree: true });
  }

  function stopRowTagging() {
    if (rowObserver) {
      rowObserver.disconnect();
      rowObserver = null;
    }
  }

  /* ------------------------------------------------- a divisoria (a linha) */

  // A divisoria original fica na camada sobreposta, presa na largura antiga, e
  // e escondida no colapso. Desenhamos a nossa na borda nova com a cor DELA: o
  // CSS usa var(--WDS-lines-divider) (o token do WhatsApp) e isto aqui e o
  // plano B, caso o token nao esteja no alcance do nosso elemento.
  const TRANSPARENTE = /^(transparent|rgba\(0, 0, 0, 0\))$/;

  function corVisivel(v) {
    const c = String(v || '').replace(/\s+/g, ' ').trim();
    return c && !TRANSPARENTE.test(c) ? c : '';
  }

  // Uma borda sem cor propria resolve para currentColor — a cor do TEXTO — e era
  // isso que deixava a linha escura demais. Como nao da para confiar na largura
  // (quando NOS escondemos o span, o Chrome passa a reportar largura 0),
  // a trava e comparar com a cor do texto do proprio elemento.
  function corDeBorda(cs) {
    const texto = corVisivel(cs.color);
    const lados = [
      'border-inline-start-color',
      'border-inline-end-color',
      'border-left-color',
      'border-right-color',
    ];
    for (const lado of lados) {
      const cor = corVisivel(cs.getPropertyValue(lado));
      if (cor && cor !== texto) return cor;
    }
    return '';
  }

  function captureLineColor() {
    // 1) o token do design system do WhatsApp, quando estiver no alcance
    const token = corVisivel(getComputedStyle(root).getPropertyValue('--WDS-lines-divider'));
    if (token) {
      lineColor = token;
      return lineColor;
    }

    // 2) a divisoria original: borda de verdade e, so entao, fundo
    const alvos = [
      '[data-testid="drawer-left"] > div > span',
      '[data-testid="drawer-middle"] > div > span',
      '[data-testid="drawer-left"]',
    ];
    for (const sel of alvos) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const cor = corDeBorda(cs) || corVisivel(cs.backgroundColor);
      if (cor) {
        lineColor = cor;
        return lineColor;
      }
    }

    return lineColor; // mantem a ultima cor boa / o padrao do CSS
  }

  /* ----------------------------------------------------------- o botao/alca */

  const CHEVRON =
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M14.7 5.3a1 1 0 0 1 0 1.4L9.42 12l5.3 5.3a1 1 0 0 1-1.42 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z" fill="currentColor"/>' +
    '</svg>';

  function ensureHandle() {
    if (handle && handle.isConnected) return handle;

    handle = document.createElement('div');
    handle.id = 'wsb-handle';

    handleBtn = document.createElement('button');
    handleBtn.id = 'wsb-btn';
    handleBtn.type = 'button';
    handleBtn.tabIndex = -1;
    handleBtn.innerHTML = CHEVRON;

    // Nao roubar o foco do campo de mensagem.
    handleBtn.addEventListener('mousedown', (e) => e.preventDefault());
    handleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    handle.appendChild(handleBtn);

    line = document.createElement('div');
    line.id = 'wsb-line';

    document.body.appendChild(line);
    document.body.appendChild(handle);
    return handle;
  }

  function syncHandle() {
    ensureHandle();
    const on = !!cfg.enabled;
    handle.hidden = !column;
    handle.dataset.wsbState = on ? 'on' : 'off';
    const label = on ? 'Expandir lista de conversas (Alt+Shift+C)' : 'Recolher lista de conversas (Alt+Shift+C)';
    handleBtn.title = label;
    handleBtn.setAttribute('aria-label', label);
    handleBtn.setAttribute('aria-pressed', String(on));

    const cor = captureLineColor();
    if (line) {
      line.hidden = !column;
      if (cor) line.style.setProperty('--wsb-line', cor);
    }

    updateEdge();
  }

  /* --------------------------------------------------------------- posicao */

  function updateEdge() {
    if (!column || !column.isConnected) return;
    const r = column.getBoundingClientRect();
    root.style.setProperty('--wsb-edge', Math.round(r.right) + 'px');
  }

  function watchEdge() {
    if (edgeObserver) edgeObserver.disconnect();
    if (!column || typeof ResizeObserver === 'undefined') return;
    edgeObserver = new ResizeObserver(() => updateEdge());
    edgeObserver.observe(column);
  }

  // A lista de conversas e virtualizada e mede a largura no resize; sem esse
  // empurrao as linhas ficam com a largura antiga ate o proximo scroll.
  function nudgeResize() {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      updateEdge();
    });
  }

  /* ----------------------------------------------------------------- aplicar */

  function apply() {
    ensureColumn();

    // antes de ligar o estado: no primeiro apply as divisorias ainda estao
    // visiveis, que e a leitura mais confiavel
    captureLineColor();

    root.style.setProperty('--wsb-width', effectiveWidth() + 'px');
    root.dataset.wsbState = cfg.enabled ? 'on' : 'off';
    root.dataset.wsbNames = cfg.showName ? 'on' : 'off';
    root.dataset.wsbPreview = cfg.hidePreview ? 'off' : 'on';
    root.dataset.wsbTime = cfg.hideTime ? 'off' : 'on';

    applyGridHost();

    if (cfg.enabled) startRowTagging();
    else stopRowTagging();

    syncHandle();
    nudgeResize();
  }

  function toggle() {
    cfg.enabled = !cfg.enabled;
    saveCfg({ enabled: cfg.enabled });
    apply();
  }

  /* ------------------------------------------------------------------ eventos */

  if (store && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let touched = false;
      for (const key of Object.keys(DEFAULTS)) {
        if (key in changes) {
          cfg[key] = changes[key].newValue;
          touched = true;
        }
      }
      if (touched) apply();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyC') {
      e.preventDefault();
      toggle();
    }
  });

  window.addEventListener('resize', updateEdge);

  // O WhatsApp monta o layout aos poucos (QR, boot, reconexao). Enquanto a
  // coluna vier de um fallback, refaz a deteccao: quando #main aparece, a
  // regra boa passa a valer e a coluna certa assume.
  function watchApp() {
    if (columnObserver) return;
    let pending = 0;
    columnObserver = new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = 0;
        const stale = !column || !column.isConnected;
        if (stale || columnVia !== 'main') apply();
        else if (cfg.enabled) tagRowsSoon();
      }, 300);
    });
    columnObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* -------------------------------------------------------------------- boot */

  (async () => {
    cfg = await loadCfg();
    apply();
    watchApp();
  })();
})();
