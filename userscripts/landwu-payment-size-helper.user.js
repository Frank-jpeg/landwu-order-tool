// ==UserScript==
// @name         Landwu 待付款快速改尺码
// @namespace    https://user.landwu.com/
// @version      2026.08.03.3
// @description  在 Landwu 待付款页面快速把订单明细尺码改为棉、涤纶、人棉或通用尺码。
// @match        https://user.landwu.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/main/userscripts/landwu-payment-size-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/main/userscripts/landwu-payment-size-helper.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '2026.08.03.3';
  const PANEL_ID = 'landwu-payment-size-helper';
  const STYLE_ID = `${PANEL_ID}-style`;
  const COLLAPSED_STORAGE_KEY = `${PANEL_ID}-collapsed`;
  const SIZE_TARGETS = ['棉', '涤纶', '人棉', '通用尺码'];

  const state = {
    collapsed: loadCollapsedPreference(),
    loading: false,
    rows: [],
    items: [],
    status: '待命',
    itemStatus: new Map(),
    busyIds: new Set(),
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function parseJson(value, fallback) {
    try {
      return JSON.parse(value || '');
    } catch (error) {
      return fallback;
    }
  }

  function loadCollapsedPreference() {
    try {
      const value = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      return value === null ? true : value !== '0';
    } catch (error) {
      return true;
    }
  }

  function saveCollapsedPreference(collapsed) {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch (error) {}
  }

  function readAuth() {
    const userInfo = parseJson(localStorage.getItem('user_info'), {});
    const token = normalizeText(localStorage.getItem('access_token'));
    const factoryId = normalizeText(userInfo.factory_id || userInfo.factoryId);
    const masterFactoryId = normalizeText(
      userInfo.master_factory_id || userInfo.masterFactoryId || (factoryId ? `6${factoryId}` : ''),
    );
    return { token, factoryId, masterFactoryId };
  }

  function requireAuth() {
    const auth = readAuth();
    if (!auth.token || !auth.factoryId) {
      throw new Error('未读取到 Landwu 登录态，请先在当前浏览器登录 Landwu。');
    }
    return auth;
  }

  function buildHeaders(auth) {
    return {
      Authorization: `Bearer ${auth.token}`,
      'X-CSRF-TOKEN': `Bearer ${auth.token}`,
      'm-master-factory-id': `factory:${auth.masterFactoryId || `6${auth.factoryId}`}`,
      'Content-Type': 'application/json;charset=UTF-8',
      lange: 'zh-CN',
    };
  }

  async function apiRequest(method, apiPath, payload) {
    const auth = requireAuth();
    const isGet = method.toUpperCase() === 'GET';
    const url = new URL(`/api${apiPath}`, window.location.origin);
    const options = {
      method,
      headers: buildHeaders(auth),
      credentials: 'include',
    };

    if (isGet) {
      const query = { ...(payload || {}), api_token: auth.token, lange: 'zh' };
      Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value ?? '')));
    } else {
      options.body = JSON.stringify({
        ...(payload || {}),
        api_token: auth.token,
        lange: 'zh-CN',
      });
    }

    const response = await fetch(url.toString(), options);
    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (error) {
      throw new Error(`${apiPath} 返回非 JSON：${rawText.slice(0, 120)}`);
    }
    if (!response.ok) {
      throw new Error(`${apiPath} HTTP ${response.status}：${data?.msg || data?.message || response.statusText}`);
    }
    if (data?.code !== undefined && Number(data.code) !== 1) {
      throw new Error(`${apiPath} 失败：${data?.msg || data?.message || '未知错误'}`);
    }
    return data;
  }

  function getDataBody(result) {
    return result?.data?.data || result?.data || result || {};
  }

  function getRowsFromOrderList(result) {
    const body = getDataBody(result);
    if (Array.isArray(body)) return body;
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.list)) return body.list;
    if (Array.isArray(body.rows)) return body.rows;
    return [];
  }

  async function loadPaymentOrders() {
    state.loading = true;
    state.status = '正在读取待付款订单...';
    render();
    try {
      const result = await apiRequest('POST', '/order/getUserOrderList', {
        status: '2',
        page: '1',
        limit: '100',
      });
      state.rows = getRowsFromOrderList(result);
      state.items = buildSizeItems(state.rows);
      state.status = `已读取 ${state.rows.length} 个待付款订单，${state.items.length} 个 SKU 可处理。`;
    } catch (error) {
      state.status = `读取失败：${error.message || error}`;
    } finally {
      state.loading = false;
      render();
    }
  }

  function firstNonEmpty(source, keys) {
    for (const key of keys) {
      const value = normalizeText(source?.[key]);
      if (value) return value;
    }
    return '';
  }

  function buildSizeItems(rows) {
    const items = [];
    for (const row of rows) {
      const details = Array.isArray(row?.detail) ? row.detail : [];
      for (const detail of details) {
        if (!detail || typeof detail !== 'object') continue;
        const orderDetailId = firstNonEmpty(detail, ['id', 'order_detail_id', 'item_id']);
        const sku = firstNonEmpty(detail, ['sku', 'productSku', 'product_sku', 'product_sku_id', 'goods_sku']);
        if (!orderDetailId || !sku) continue;
        items.push({
          key: String(orderDetailId),
          orderDetailId,
          orderNo: normalizeText(row.order_no),
          orderId: firstNonEmpty(row, ['order_id', 'id']),
          tagName: normalizeText(row.tag_name),
          shopName: normalizeText(row.shop_name),
          sku,
          productId:
            firstNonEmpty(detail, ['product_id', 'productId', 'spu_id', 'spuId', 'goods_id', 'goodsId']) ||
            firstNonEmpty(row, ['product_id', 'productId', 'spu_id', 'spuId', 'goods_id', 'goodsId']),
          currentSize: firstNonEmpty(detail, ['size', 'spec_size', 'goods_size']),
        });
      }
    }
    return items;
  }

  function optionName(option) {
    if (!option || typeof option !== 'object') return normalizeText(option);
    return normalizeText(option.name || option.name_zh || option.zh_name || option.value);
  }

  function findNamedOptionId(options, targetSize) {
    const target = normalizeText(targetSize);
    if (!target) return '';
    if (Array.isArray(options)) {
      for (const option of options) {
        if (optionName(option) === target) return normalizeText(option.id);
      }
      return '';
    }
    if (options && typeof options === 'object') {
      for (const [optionId, option] of Object.entries(options)) {
        if (optionName(option) === target) return normalizeText(optionId);
      }
    }
    return '';
  }

  function formatOptionNames(options) {
    const values = Array.isArray(options) ? options : Object.values(options || {});
    return values.map(optionName).filter(Boolean).slice(0, 12).join('、');
  }

  async function getEditDetail(orderDetailId) {
    const result = await apiRequest('GET', '/order/getEditDetail', {
      ids: orderDetailId,
      type: 1,
    });
    return getDataBody(result);
  }

  async function getProductInfo(productId) {
    const result = await apiRequest('GET', '/order/getProductInfo', {
      productId,
    });
    return getDataBody(result);
  }

  async function changeSize(item, targetSize) {
    const target = normalizeText(targetSize);
    if (!target) throw new Error('目标尺码为空');
    if (target === normalizeText(item.currentSize)) throw new Error(`当前已经是 ${target}`);

    const editDetail = await getEditDetail(item.orderDetailId);
    let sizeMap = editDetail.size || {};
    const colorMap = editDetail.color || {};
    const current = editDetail.data || {};
    const productId = normalizeText(editDetail.product_id || current.product_id || item.productId);
    let productInfo = null;

    let targetSizeId = findNamedOptionId(sizeMap, target);
    if (!targetSizeId && productId) {
      productInfo = await getProductInfo(productId);
      const productSizeMap = productInfo.size || {};
      targetSizeId = findNamedOptionId(productSizeMap, target);
      if (targetSizeId) sizeMap = productSizeMap;
    }
    if (!targetSizeId) {
      const options = formatOptionNames(sizeMap);
      throw new Error(`找不到尺码：${target}${options ? `；当前可选：${options}` : ''}`);
    }

    const currentColor = normalizeText(current.colour || current.color);
    let currentColorId = normalizeText(current.colour_id || current.color_id);
    if (!currentColorId && currentColor) {
      currentColorId = findNamedOptionId(colorMap, currentColor);
    }
    if (!currentColorId && currentColor && productId) {
      if (!productInfo) productInfo = await getProductInfo(productId);
      currentColorId = findNamedOptionId(productInfo.color || {}, currentColor);
    }
    if (!currentColorId) {
      throw new Error('找不到原颜色 ID，已阻止提交，避免颜色被默认覆盖');
    }

    const payload = {
      productId,
      colourId: currentColorId,
      sizeId: targetSizeId,
      buyNumber: current.buy_number || 1,
      is_img_custom: current.is_img_custom || '',
      fabric_id: current.fabric_id || '',
      order_detail_id: current.id || item.orderDetailId,
      order_id: current.order_id || item.orderId,
      isSave: 1,
      type: 1,
      lange: 'zh',
    };
    await apiRequest('POST', '/order/relateOrderDetailSave', payload);
    item.currentSize = target;
    return { fromSize: current.size || '', toSize: target, sizeId: targetSizeId };
  }

  async function handleChangeSize(orderDetailId, targetSize) {
    const item = state.items.find((entry) => entry.key === orderDetailId);
    if (!item) return;
    const label = `${item.orderNo || '(无订单号)'} / SKU ${item.sku}`;
    if (!window.confirm(`确认把 ${label} 改为“${targetSize}”吗？`)) return;

    state.busyIds.add(orderDetailId);
    state.itemStatus.set(orderDetailId, `正在改为 ${targetSize}...`);
    render();
    try {
      await changeSize(item, targetSize);
      state.itemStatus.set(orderDetailId, `已改为 ${targetSize}`);
      state.status = `${item.orderNo || item.sku} 已改为 ${targetSize}`;
    } catch (error) {
      state.itemStatus.set(orderDetailId, `失败：${error.message || error}`);
      state.status = `${item.orderNo || item.sku} 修改失败`;
    } finally {
      state.busyIds.delete(orderDetailId);
      render();
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 14px;
        bottom: 16px;
        z-index: 2147483647;
        width: 420px;
        max-width: calc(100vw - 24px);
        color: #1f2937;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
        box-shadow: 0 14px 38px rgba(15, 23, 42, .22);
        border: 1px solid rgba(148, 163, 184, .45);
        border-radius: 10px;
        background: #fff;
        overflow: hidden;
        transition: right .18s ease, bottom .18s ease, width .18s ease, border-radius .18s ease;
      }
      #${PANEL_ID}[data-collapsed="1"] {
        right: 0;
        bottom: 110px;
        width: 42px;
        max-width: 42px;
        border-right: 0;
        border-radius: 10px 0 0 10px;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .lw-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 10px;
        color: #fff;
        background: #111827;
        user-select: none;
      }
      #${PANEL_ID}[data-collapsed="1"] .lw-head {
        min-height: 112px;
        padding: 10px 6px;
        justify-content: center;
        cursor: pointer;
      }
      #${PANEL_ID} .lw-title { font-weight: 700; flex: 1; }
      #${PANEL_ID}[data-collapsed="1"] .lw-title {
        writing-mode: vertical-rl;
        letter-spacing: 1px;
        line-height: 1.1;
        text-align: center;
      }
      #${PANEL_ID} .lw-version { opacity: .65; font-size: 11px; }
      #${PANEL_ID}[data-collapsed="1"] .lw-version,
      #${PANEL_ID}[data-collapsed="1"] .lw-head button {
        display: none;
      }
      #${PANEL_ID} button {
        border: 1px solid #d1d5db;
        border-radius: 7px;
        background: #fff;
        color: #111827;
        cursor: pointer;
        font: inherit;
      }
      #${PANEL_ID} button:disabled { cursor: not-allowed; opacity: .55; }
      #${PANEL_ID} .lw-head button {
        border-color: rgba(255,255,255,.2);
        background: rgba(255,255,255,.12);
        color: #fff;
        padding: 4px 8px;
      }
      #${PANEL_ID} .lw-body { display: block; }
      #${PANEL_ID}[data-collapsed="1"] .lw-body { display: none; }
      #${PANEL_ID} .lw-toolbar {
        display: flex;
        gap: 8px;
        padding: 9px 10px 7px;
        background: #f8fafc;
        border-bottom: 1px solid #e5e7eb;
      }
      #${PANEL_ID} .lw-toolbar button {
        padding: 6px 10px;
        background: #16a34a;
        border-color: #15803d;
        color: #fff;
        font-weight: 700;
      }
      #${PANEL_ID} .lw-status {
        padding: 0 10px 8px;
        background: #f8fafc;
        color: #64748b;
        min-height: 24px;
      }
      #${PANEL_ID} .lw-list {
        max-height: min(520px, calc(100vh - 170px));
        overflow: auto;
      }
      #${PANEL_ID} .lw-empty {
        padding: 18px 12px;
        color: #64748b;
        text-align: center;
      }
      #${PANEL_ID} .lw-item {
        padding: 10px;
        border-top: 1px solid #eef2f7;
      }
      #${PANEL_ID} .lw-meta {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 4px 8px;
        align-items: baseline;
      }
      #${PANEL_ID} .lw-order {
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .lw-size {
        font-size: 12px;
        color: #475569;
        padding: 2px 7px;
        border-radius: 999px;
        background: #f1f5f9;
      }
      #${PANEL_ID} .lw-size[data-generic="1"] {
        color: #b91c1c;
        background: #fee2e2;
      }
      #${PANEL_ID} .lw-sku {
        grid-column: 1 / -1;
        color: #64748b;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .lw-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      #${PANEL_ID} .lw-actions button {
        padding: 5px 9px;
        min-width: 54px;
      }
      #${PANEL_ID} .lw-actions button[data-target="棉"] {
        background: #dcfce7;
        border-color: #86efac;
      }
      #${PANEL_ID} .lw-actions button[data-target="涤纶"] {
        background: #e0f2fe;
        border-color: #7dd3fc;
      }
      #${PANEL_ID} .lw-actions button[data-target="人棉"] {
        background: #fef9c3;
        border-color: #fde047;
      }
      #${PANEL_ID} .lw-actions button[data-target="通用尺码"] {
        background: #f3f4f6;
        border-color: #d1d5db;
      }
      #${PANEL_ID} .lw-note {
        margin-top: 6px;
        color: #64748b;
        font-size: 12px;
        word-break: break-word;
      }
      #${PANEL_ID} .lw-note[data-error="1"] { color: #b91c1c; }
      @media (max-width: 540px) {
        #${PANEL_ID} {
          left: 10px;
          right: 10px;
          bottom: 10px;
          width: auto;
        }
        #${PANEL_ID}[data-collapsed="1"] {
          left: auto;
          right: 0;
          bottom: 96px;
          width: 40px;
          max-width: 40px;
        }
        #${PANEL_ID} .lw-list {
          max-height: min(62vh, 520px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function itemMarkup(item) {
    const note = state.itemStatus.get(item.key) || '';
    const busy = state.busyIds.has(item.key);
    const currentSize = normalizeText(item.currentSize) || '-';
    const isGeneric = currentSize === '通用尺码';
    const buttons = SIZE_TARGETS.map((target) => {
      const disabled = busy || target === currentSize ? ' disabled' : '';
      return `<button type="button" data-action="change" data-id="${escapeHtml(item.key)}" data-target="${escapeHtml(target)}"${disabled}>${escapeHtml(target)}</button>`;
    }).join('');
    return `
      <div class="lw-item">
        <div class="lw-meta">
          <div class="lw-order">${escapeHtml(item.orderNo || '(无订单号)')} ${escapeHtml(item.tagName || '')}</div>
          <div class="lw-size" data-generic="${isGeneric ? '1' : '0'}">当前：${escapeHtml(currentSize)}</div>
          <div class="lw-sku">SKU：${escapeHtml(item.sku)}${item.shopName ? ` ｜ ${escapeHtml(item.shopName)}` : ''}</div>
        </div>
        <div class="lw-actions">${buttons}</div>
        ${note ? `<div class="lw-note" data-error="${note.startsWith('失败') ? '1' : '0'}">${escapeHtml(note)}</div>` : ''}
      </div>
    `;
  }

  function render() {
    injectStyle();
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }
    const body = state.items.length
      ? `<div class="lw-list">${state.items.map(itemMarkup).join('')}</div>`
      : `<div class="lw-empty">${state.loading ? '正在读取...' : '没有读取到可处理的待付款 SKU。'}</div>`;
    panel.dataset.collapsed = state.collapsed ? '1' : '0';
    panel.innerHTML = `
      <div class="lw-head" data-action="toggle" title="${state.collapsed ? '展开快速改尺码' : '收起到屏幕边缘'}">
        <div class="lw-title">待付款快速改尺码</div>
        <div class="lw-version">v${escapeHtml(SCRIPT_VERSION)}</div>
        <button type="button" data-action="toggle">${state.collapsed ? '展开' : '收起'}</button>
      </div>
      <div class="lw-body">
        <div class="lw-toolbar">
          <button type="button" data-action="refresh" ${state.loading ? 'disabled' : ''}>刷新待付款</button>
        </div>
        <div class="lw-status">${escapeHtml(state.status)}</div>
        ${body}
      </div>
    `;
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest(`#${PANEL_ID} [data-action]`);
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'toggle') {
        state.collapsed = !state.collapsed;
        saveCollapsedPreference(state.collapsed);
        render();
      } else if (action === 'refresh') {
        loadPaymentOrders();
      } else if (action === 'change') {
        handleChangeSize(target.dataset.id, target.dataset.target);
      }
    });
  }

  function boot() {
    render();
    bindEvents();
    if (readAuth().token) {
      loadPaymentOrders();
    } else {
      state.status = '请先登录 Landwu，再点击刷新待付款。';
      render();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
