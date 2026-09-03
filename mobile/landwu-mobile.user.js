// ==UserScript==
// @name         Landwu 手机版做单器
// @namespace    https://user.landwu.com/
// @version      2026.09.03.1
// @description  手机端在 Landwu 页面内处理待付款订单尺码/成分修改。
// @match        https://user.landwu.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/landwu-mobile.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/landwu-mobile.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.__LANDWU_MOBILE_ORDER_TOOL_LOADED__) return;
  window.__LANDWU_MOBILE_ORDER_TOOL_LOADED__ = true;

  const SCRIPT_VERSION = '2026.09.03.1';
  const PANEL_ID = 'landwu-mobile-order-tool';
  const STYLE_ID = `${PANEL_ID}-style`;
  const STORAGE_PREFIX = 'landwu-mobile-order-tool';
  const COLLAPSED_STORAGE_KEY = `${STORAGE_PREFIX}-collapsed`;
  const DB_CACHE_STORAGE_KEY = `${STORAGE_PREFIX}-composition-db-cache`;
  const DEFAULT_DB_URL =
    'https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/composition-db.json';
  const SIZE_TARGETS = ['棉', '涤纶', '人棉', '通用尺码'];
  const JOIN_FIELDS = ['SKU_ID', 'SKU', 'SKC_ID', 'SPU_ID'];

  const state = {
    collapsed: loadCollapsedPreference(),
    loadingOrders: false,
    loadingDb: false,
    orders: [],
    items: [],
    dbRows: [],
    dbIndex: new Map(),
    dbStatus: '数据库未加载',
    status: '待命',
    itemStatus: new Map(),
    busyIds: new Set(),
    lastRefreshText: '',
  };

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function normalizeDbKey(value) {
    if (value === null || value === undefined) return '';
    let text = String(value).trim();
    if (!text || ['nan', 'none', 'null', 'undefined'].includes(text.toLowerCase())) return '';
    text = text.replace(/\t/g, '').replace(/\u3000/g, ' ').trim();
    if (/^[+-]?\d+(\.0+)?$/.test(text)) return text.split('.')[0];
    if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(text)) {
      const numeric = Number(text);
      if (Number.isFinite(numeric)) return Number.isInteger(numeric) ? String(numeric) : String(numeric).replace(/0+$/, '').replace(/\.$/, '');
    }
    return text.replace(/\s+/g, '');
  }

  function normalizeCompositionText(value) {
    return normalizeText(value).toLowerCase().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
  }

  function inferSizeFromComposition(value) {
    const text = normalizeCompositionText(value);
    if (!text) return '';
    if (text.includes('人棉')) return '人棉';
    if (['涤纶', '聚酯', '聚脂', 'polyester'].some((token) => text.includes(token))) return '涤纶';
    if (text.includes('棉') || text.includes('cotton')) return '棉';
    return '';
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
      throw new Error('未读取到 Landwu 登录态，请先在当前手机浏览器登录 Landwu。');
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

  function firstNonEmpty(source, keys) {
    for (const key of keys) {
      const value = normalizeDbKey(source?.[key]);
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
        const sku = firstNonEmpty(detail, ['sku', 'sku_id', 'skuId', 'sku_code', 'skuCode', 'productSku', 'product_sku', 'product_sku_id', 'goods_sku']);
        if (!orderDetailId || !sku) continue;
        const skcId = firstNonEmpty(detail, ['skc', 'SKC', 'skc_id', 'skcId', 'product_skc_id', 'productSkcId']);
        const spuId =
          firstNonEmpty(detail, ['product_id', 'productId', 'spu_id', 'spuId', 'goods_id', 'goodsId', 'design_product_id']) ||
          firstNonEmpty(row, ['product_id', 'productId', 'spu_id', 'spuId', 'goods_id', 'goodsId']);
        const matchCandidates = [
          ['SKU_ID', sku],
          ['SKU', sku],
          ['SKC_ID', skcId],
          ['SPU_ID', spuId],
        ].filter(([, value]) => value);
        items.push({
          key: String(orderDetailId),
          orderDetailId,
          orderNo: normalizeText(row.order_no),
          orderId: firstNonEmpty(row, ['order_id', 'id']),
          tagName: normalizeText(row.tag_name),
          shopName: normalizeText(row.shop_name),
          sku,
          skcId,
          spuId,
          productId: spuId,
          currentSize: normalizeText(detail.size || detail.spec_size || detail.goods_size),
          matchCandidates,
        });
      }
    }
    return items;
  }

  function readRecordValue(record, keys) {
    for (const key of keys) {
      if (record?.[key] !== undefined && record?.[key] !== null) return record[key];
    }
    const entries = Object.entries(record || {});
    for (const key of keys) {
      const lower = key.toLowerCase();
      const found = entries.find(([entryKey]) => String(entryKey).toLowerCase() === lower);
      if (found) return found[1];
    }
    return '';
  }

  function normalizeDbPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.records)) return payload.records;
    if (Array.isArray(payload?.data)) return payload.data;
    if (payload && typeof payload === 'object') return Object.values(payload).filter((item) => item && typeof item === 'object');
    return [];
  }

  function normalizeDbRecord(rawRecord) {
    const record = rawRecord || {};
    const composition = normalizeText(readRecordValue(record, ['composition', '成分', '成份', '材质']));
    const explicitTarget = normalizeText(readRecordValue(record, ['target_size', 'targetSize', '尺码', '目标尺码']));
    const targetSize = SIZE_TARGETS.includes(explicitTarget) ? explicitTarget : inferSizeFromComposition(composition);
    return {
      SKC_ID: normalizeDbKey(readRecordValue(record, ['SKC_ID', 'skc_id', 'skcId', 'skc'])),
      SPU_ID: normalizeDbKey(readRecordValue(record, ['SPU_ID', 'spu_id', 'spuId', 'product_id', 'productId'])),
      SKU_ID: normalizeDbKey(readRecordValue(record, ['SKU_ID', 'SKU ID', 'sku_id', 'skuId', 'skuCode', 'sku_code'])),
      SKU: normalizeDbKey(readRecordValue(record, ['SKU', 'sku', 'productSku', 'product_sku'])),
      composition,
      target_size: targetSize,
    };
  }

  function buildDbIndex(records) {
    const index = new Map();
    for (const record of records) {
      const normalized = normalizeDbRecord(record);
      for (const field of JOIN_FIELDS) {
        const key = normalized[field];
        if (key && !index.has(`${field}:${key}`)) {
          index.set(`${field}:${key}`, { ...normalized, db_field: field });
        }
      }
    }
    return index;
  }

  function saveDbCache(records) {
    try {
      localStorage.setItem(DB_CACHE_STORAGE_KEY, JSON.stringify({ fetchedAt: Date.now(), records }));
    } catch (error) {}
  }

  function loadDbCache() {
    try {
      const cache = JSON.parse(localStorage.getItem(DB_CACHE_STORAGE_KEY) || '{}');
      return Array.isArray(cache.records) ? cache.records : [];
    } catch (error) {
      return [];
    }
  }

  async function loadCompositionDb(force = false) {
    state.loadingDb = true;
    state.dbStatus = '正在读取成分数据库...';
    render();
    try {
      const url = force ? `${DEFAULT_DB_URL}?t=${Date.now()}` : DEFAULT_DB_URL;
      const response = await fetch(url, { cache: force ? 'reload' : 'default' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const records = normalizeDbPayload(payload);
      state.dbRows = records;
      state.dbIndex = buildDbIndex(records);
      state.dbStatus = `数据库已加载 ${records.length} 条`;
      saveDbCache(records);
    } catch (error) {
      const cached = loadDbCache();
      if (cached.length) {
        state.dbRows = cached;
        state.dbIndex = buildDbIndex(cached);
        state.dbStatus = `数据库读取失败，已使用缓存 ${cached.length} 条`;
      } else {
        state.dbRows = [];
        state.dbIndex = new Map();
        state.dbStatus = `数据库未加载：${error.message || error}`;
      }
    } finally {
      state.loadingDb = false;
      render();
    }
  }

  function findSuggestion(item) {
    for (const [field, value] of item.matchCandidates || []) {
      const record = state.dbIndex.get(`${field}:${normalizeDbKey(value)}`);
      if (record) return record;
    }
    return null;
  }

  async function loadPaymentOrders() {
    state.loadingOrders = true;
    state.status = '正在读取待付款订单...';
    render();
    try {
      const result = await apiRequest('POST', '/order/getUserOrderList', {
        status: '2',
        page: '1',
        limit: '100',
      });
      state.orders = getRowsFromOrderList(result);
      state.items = buildSizeItems(state.orders);
      state.lastRefreshText = new Date().toLocaleTimeString();
      state.status = `已读取 ${state.orders.length} 个待付款订单，${state.items.length} 个 SKU`;
    } catch (error) {
      state.status = `读取失败：${error.message || error}`;
    } finally {
      state.loadingOrders = false;
      render();
    }
  }

  async function refreshAll(forceDb = false) {
    if (!readAuth().token) {
      state.status = '请先在当前手机浏览器登录 Landwu，再刷新。';
      render();
      return;
    }
    await loadCompositionDb(forceDb);
    await loadPaymentOrders();
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
    if (!currentColorId && currentColor) currentColorId = findNamedOptionId(colorMap, currentColor);
    if (!currentColorId && currentColor && productId) {
      if (!productInfo) productInfo = await getProductInfo(productId);
      currentColorId = findNamedOptionId(productInfo.color || {}, currentColor);
    }
    if (!currentColorId) throw new Error('找不到原颜色 ID，已阻止提交，避免颜色被默认覆盖');

    await apiRequest('POST', '/order/relateOrderDetailSave', {
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
    });
    item.currentSize = target;
    return { toSize: target, sizeId: targetSizeId };
  }

  async function handleChangeSize(itemKey, targetSize) {
    const item = state.items.find((entry) => entry.key === itemKey);
    if (!item) return;
    const label = `${item.orderNo || '(无订单号)'} / SKU ${item.sku}`;
    if (!window.confirm(`确认把 ${label} 改为“${targetSize}”吗？`)) return;

    state.busyIds.add(itemKey);
    state.itemStatus.set(itemKey, `正在改为 ${targetSize}...`);
    render();
    try {
      await changeSize(item, targetSize);
      state.itemStatus.set(itemKey, `已改为 ${targetSize}`);
      state.status = `${item.orderNo || item.sku} 已改为 ${targetSize}`;
    } catch (error) {
      state.itemStatus.set(itemKey, `失败：${error.message || error}`);
      state.status = `${item.orderNo || item.sku} 修改失败`;
    } finally {
      state.busyIds.delete(itemKey);
      render();
    }
  }

  function getStats() {
    const genericCount = state.items.filter((item) => normalizeText(item.currentSize) === '通用尺码').length;
    const matchedCount = state.items.filter((item) => {
      const suggestion = findSuggestion(item);
      return suggestion && suggestion.target_size;
    }).length;
    return { genericCount, matchedCount };
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 10px;
        bottom: 12px;
        z-index: 2147483647;
        width: min(430px, calc(100vw - 20px));
        color: #111827;
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
        background: #fff;
        border: 1px solid rgba(148, 163, 184, .5);
        border-radius: 12px;
        box-shadow: 0 16px 42px rgba(15, 23, 42, .22);
        overflow: hidden;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID}[data-collapsed="1"] {
        right: 0;
        bottom: 130px;
        width: 42px;
        border-right: 0;
        border-radius: 12px 0 0 12px;
      }
      #${PANEL_ID} .lw-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        color: #fff;
        background: #111827;
        user-select: none;
      }
      #${PANEL_ID}[data-collapsed="1"] .lw-head {
        min-height: 42px;
        padding: 0;
        justify-content: center;
        cursor: pointer;
      }
      #${PANEL_ID} .lw-title { flex: 1; font-weight: 800; }
      #${PANEL_ID}[data-collapsed="1"] .lw-title {
        flex: 0 0 auto;
        font-size: 17px;
        line-height: 42px;
      }
      #${PANEL_ID} .lw-version { font-size: 11px; opacity: .62; }
      #${PANEL_ID}[data-collapsed="1"] .lw-version,
      #${PANEL_ID}[data-collapsed="1"] .lw-head button,
      #${PANEL_ID}[data-collapsed="1"] .lw-body { display: none; }
      #${PANEL_ID} button {
        border: 1px solid #d1d5db;
        border-radius: 9px;
        background: #fff;
        color: #111827;
        cursor: pointer;
        font: inherit;
      }
      #${PANEL_ID} button:disabled { cursor: not-allowed; opacity: .55; }
      #${PANEL_ID} .lw-head button {
        color: #fff;
        background: rgba(255,255,255,.12);
        border-color: rgba(255,255,255,.25);
        padding: 4px 8px;
      }
      #${PANEL_ID} .lw-body {
        max-height: min(78vh, 660px);
        display: flex;
        flex-direction: column;
      }
      #${PANEL_ID} .lw-toolbar {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 10px;
        background: #f8fafc;
        border-bottom: 1px solid #e5e7eb;
      }
      #${PANEL_ID} .lw-toolbar button {
        padding: 9px 10px;
        font-weight: 800;
      }
      #${PANEL_ID} .lw-primary {
        color: #fff;
        background: #16a34a;
        border-color: #15803d;
      }
      #${PANEL_ID} .lw-status {
        padding: 8px 10px;
        color: #475569;
        background: #f8fafc;
        border-bottom: 1px solid #e5e7eb;
        word-break: break-word;
      }
      #${PANEL_ID} .lw-alert {
        margin-top: 6px;
        padding: 7px 8px;
        color: #991b1b;
        background: #fee2e2;
        border-radius: 9px;
      }
      #${PANEL_ID} .lw-list {
        overflow: auto;
        -webkit-overflow-scrolling: touch;
      }
      #${PANEL_ID} .lw-empty {
        padding: 22px 14px;
        color: #64748b;
        text-align: center;
      }
      #${PANEL_ID} .lw-item {
        padding: 11px 10px;
        border-top: 1px solid #eef2f7;
      }
      #${PANEL_ID} .lw-meta {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 4px 8px;
      }
      #${PANEL_ID} .lw-order {
        min-width: 0;
        font-weight: 800;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .lw-size {
        font-size: 12px;
        color: #475569;
        padding: 2px 8px;
        border-radius: 999px;
        background: #f1f5f9;
      }
      #${PANEL_ID} .lw-size[data-generic="1"] {
        color: #b91c1c;
        background: #fee2e2;
      }
      #${PANEL_ID} .lw-line {
        grid-column: 1 / -1;
        min-width: 0;
        color: #64748b;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .lw-suggest {
        margin-top: 8px;
        padding: 7px 8px;
        color: #0f766e;
        background: #ccfbf1;
        border-radius: 9px;
        font-size: 12px;
      }
      #${PANEL_ID} .lw-actions {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 7px;
        margin-top: 9px;
      }
      #${PANEL_ID} .lw-actions button {
        padding: 8px 4px;
        font-weight: 750;
      }
      #${PANEL_ID} .lw-actions button[data-target="棉"] { background: #dcfce7; border-color: #86efac; }
      #${PANEL_ID} .lw-actions button[data-target="涤纶"] { background: #e0f2fe; border-color: #7dd3fc; }
      #${PANEL_ID} .lw-actions button[data-target="人棉"] { background: #fef9c3; border-color: #fde047; }
      #${PANEL_ID} .lw-actions button[data-target="通用尺码"] { background: #f3f4f6; border-color: #d1d5db; }
      #${PANEL_ID} .lw-note {
        margin-top: 7px;
        color: #64748b;
        font-size: 12px;
        word-break: break-word;
      }
      #${PANEL_ID} .lw-note[data-error="1"] { color: #b91c1c; }
      @media (max-width: 520px) {
        #${PANEL_ID} {
          left: 8px;
          right: 8px;
          bottom: 8px;
          width: auto;
        }
        #${PANEL_ID}[data-collapsed="1"] {
          left: auto;
          right: 0;
          bottom: 118px;
          width: 42px;
        }
        #${PANEL_ID} .lw-body { max-height: 82vh; }
      }
    `;
    document.head.appendChild(style);
  }

  function itemMarkup(item) {
    const currentSize = normalizeText(item.currentSize) || '-';
    const isGeneric = currentSize === '通用尺码';
    const note = state.itemStatus.get(item.key) || '';
    const busy = state.busyIds.has(item.key);
    const suggestion = findSuggestion(item);
    const suggestedTarget = suggestion?.target_size || '';
    const buttons = SIZE_TARGETS.map((target) => {
      const disabled = busy || target === currentSize ? ' disabled' : '';
      const label = suggestedTarget === target ? `${target}*` : target;
      return `<button type="button" data-action="change" data-id="${escapeHtml(item.key)}" data-target="${escapeHtml(target)}"${disabled}>${escapeHtml(label)}</button>`;
    }).join('');
    const suggestionHtml = suggestion
      ? `<div class="lw-suggest">建议：${escapeHtml(suggestedTarget || '无法识别')} ｜ ${escapeHtml(suggestion.composition || '-')} ｜ ${escapeHtml(suggestion.db_field || '-')}</div>`
      : '';
    return `
      <div class="lw-item">
        <div class="lw-meta">
          <div class="lw-order">${escapeHtml(item.orderNo || '(无订单号)')} ${escapeHtml(item.tagName || '')}</div>
          <div class="lw-size" data-generic="${isGeneric ? '1' : '0'}">当前：${escapeHtml(currentSize)}</div>
          <div class="lw-line">SKU：${escapeHtml(item.sku)}</div>
          <div class="lw-line">SKC：${escapeHtml(item.skcId || '-')} ｜ SPU：${escapeHtml(item.spuId || '-')}</div>
        </div>
        ${suggestionHtml}
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
    const stats = getStats();
    const alert = stats.genericCount ? `<div class="lw-alert">还有 ${stats.genericCount} 个 SKU 是通用尺码</div>` : '';
    const listHtml = state.items.length
      ? `<div class="lw-list">${state.items.map(itemMarkup).join('')}</div>`
      : `<div class="lw-empty">${state.loadingOrders ? '正在读取待付款...' : '暂无可处理的待付款 SKU。'}</div>`;
    panel.dataset.collapsed = state.collapsed ? '1' : '0';
    panel.innerHTML = `
      <div class="lw-head" data-action="toggle" title="${state.collapsed ? '展开手机版做单器' : '收起'}">
        <div class="lw-title">${state.collapsed ? '做' : '领物手机版做单器'}</div>
        <div class="lw-version">v${escapeHtml(SCRIPT_VERSION)}</div>
        <button type="button" data-action="toggle">收起</button>
      </div>
      <div class="lw-body">
        <div class="lw-toolbar">
          <button type="button" class="lw-primary" data-action="refresh" ${state.loadingOrders ? 'disabled' : ''}>刷新待付款</button>
          <button type="button" data-action="load-db" ${state.loadingDb ? 'disabled' : ''}>更新数据库</button>
        </div>
        <div class="lw-status">
          <div>${escapeHtml(state.status)}</div>
          <div>${escapeHtml(state.dbStatus)} ｜ 匹配建议 ${stats.matchedCount} 个${state.lastRefreshText ? ` ｜ ${escapeHtml(state.lastRefreshText)}` : ''}</div>
          ${alert}
        </div>
        ${listHtml}
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
        refreshAll(false);
      } else if (action === 'load-db') {
        loadCompositionDb(true);
      } else if (action === 'change') {
        handleChangeSize(target.dataset.id, target.dataset.target);
      }
    });
  }

  function boot() {
    render();
    bindEvents();
    if (readAuth().token) {
      refreshAll(false);
    } else {
      state.status = '请先登录 Landwu，再打开手机版做单器刷新。';
      render();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
