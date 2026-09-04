// ==UserScript==
// @name         Landwu 手机做单工作台
// @namespace    https://user.landwu.com/
// @version      2026.09.04.1
// @description  手机端独立处理 JIT 物流、看图、成分尺码与支付。
// @match        https://user.landwu.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/landwu-mobile-v2026.09.04.1.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/landwu-mobile-v2026.09.04.1.user.js
// ==/UserScript==

(function () {
  'use strict';

  var SCRIPT_VERSION = '2026.09.04.1';
  var ROOT_ID = 'landwu-mobile-workbench-v2';
  var STYLE_ID = ROOT_ID + '-style';
  var CONFIRM_ID = ROOT_ID + '-confirm';
  var IMAGE_PREVIEW_ID = ROOT_ID + '-image-preview';
  var DB_URL = 'https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/composition-db.json';
  var SIZE_TARGETS = ['棉', '涤纶', '人棉', '通用尺码'];
  var DB_FIELDS = ['SKU_ID', 'SKU', 'SKC_ID', 'SPU_ID'];
  var PRODUCT_NO_FIELDS = [
    '货号', '款号', '商品货号', 'product_no', 'productNo', 'product_sn', 'productSn',
    'product_number', 'productNumber', 'product_code', 'productCode', 'goods_no', 'goodsNo',
    'goods_sn', 'goodsSn', 'goods_code', 'goodsCode', 'style_no', 'styleNo', 'article_no',
    'articleNo', 'item_no', 'itemNo', 'spu_code', 'spuCode',
  ];
  var PRODUCT_NO_POLYESTER_FALLBACK_START = '20260701';
  var IMAGE_FIELDS = [
    'image', 'pic', 'img', 'url', 'src',
    'image_url', 'imageUrl', 'img_url', 'imgUrl',
    'picture', 'pictures', 'photo', 'photos',
    'main_image', 'mainImage', 'product_image', 'productImage',
    'goods_image', 'goodsImage', 'sku_image', 'skuImage',
    'thumb', 'thumbnail', 'thumb_url', 'thumbUrl',
  ];
  var CACHE_DB_NAME = 'landwu-mobile-workbench';
  var CACHE_STORE_NAME = 'cache';
  var CACHE_KEY = 'composition-db-v1';
  var authTimer = null;
  var toastTimer = null;

  if (window.__LANDWU_MOBILE_WORKBENCH_VERSION__ === SCRIPT_VERSION) return;
  window.__LANDWU_MOBILE_WORKBENCH_VERSION__ = SCRIPT_VERSION;

  var state = {
    authReady: false,
    activeTab: 'edit',
    loadingOrders: false,
    loadingDb: false,
    busyAction: '',
    tags: [],
    tagMap: new Map(),
    jitTag: null,
    editOrders: [],
    paymentOrders: [],
    items: [],
    dbRows: [],
    dbIndex: new Map(),
    dbStatus: '数据库未加载',
    orderStatus: '等待刷新',
    lastRefreshText: '',
    operation: null,
    itemStatus: new Map(),
    busyItemIds: new Set(),
    toast: null,
  };

  function normalizeText(value) {
    return String(value === null || value === undefined ? '' : value).trim();
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
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

  function readAuth() {
    try {
      var userInfo = parseJson(localStorage.getItem('user_info'), {});
      var token = normalizeText(localStorage.getItem('access_token'));
      var factoryId = normalizeText(userInfo.factory_id || userInfo.factoryId);
      var masterFactoryId = normalizeText(
        userInfo.master_factory_id || userInfo.masterFactoryId || (factoryId ? '6' + factoryId : '')
      );
      return {
        token: token,
        factoryId: factoryId,
        masterFactoryId: masterFactoryId,
        username: normalizeText(userInfo.nickname || userInfo.username || userInfo.company_name),
      };
    } catch (error) {
      return { token: '', factoryId: '', masterFactoryId: '', username: '' };
    }
  }

  function requireAuth() {
    var auth = readAuth();
    if (!auth.token || !auth.factoryId) {
      throw new Error('登录态未读取到，请返回领物页面重新登录');
    }
    return auth;
  }

  function sleep(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  function requestText(method, url, headers, body, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = timeoutMs || 60000;
      xhr.withCredentials = url.indexOf(window.location.origin) === 0;
      Object.keys(headers || {}).forEach(function (name) {
        xhr.setRequestHeader(name, headers[name]);
      });
      xhr.onload = function () {
        resolve({ status: xhr.status, text: xhr.responseText || '', statusText: xhr.statusText || '' });
      };
      xhr.onerror = function () {
        reject(new Error('网络连接失败：' + (new URL(url)).host));
      };
      xhr.ontimeout = function () {
        reject(new Error('请求超时：' + (new URL(url)).host));
      };
      xhr.send(body === undefined ? null : body);
    });
  }

  async function apiRequest(method, apiPath, payload) {
    var auth = requireAuth();
    var upperMethod = method.toUpperCase();
    var url = new URL('/api' + apiPath, window.location.origin);
    var headers = {
      Authorization: 'Bearer ' + auth.token,
      'X-CSRF-TOKEN': 'Bearer ' + auth.token,
      'm-master-factory-id': 'factory:' + (auth.masterFactoryId || '6' + auth.factoryId),
      'Content-Type': 'application/json;charset=UTF-8',
      lange: 'zh-CN',
    };
    var body;

    if (upperMethod === 'GET') {
      var query = Object.assign({}, payload || {}, { api_token: auth.token, lange: 'zh' });
      Object.keys(query).forEach(function (key) {
        url.searchParams.set(key, String(query[key] === null || query[key] === undefined ? '' : query[key]));
      });
    } else {
      var bodyPayload = Object.assign({}, payload || {}, { api_token: auth.token });
      if (!bodyPayload.lange) bodyPayload.lange = 'zh-CN';
      body = JSON.stringify(bodyPayload);
    }

    var response = await requestText(upperMethod, url.toString(), headers, body, 60000);
    var data;
    try {
      data = JSON.parse(response.text);
    } catch (error) {
      throw new Error(apiPath + ' 返回内容异常：' + response.text.slice(0, 100));
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(apiPath + ' HTTP ' + response.status + '：' + (data.msg || data.message || response.statusText));
    }
    if (data.code !== undefined && Number(data.code) !== 1) {
      throw new Error(data.msg || data.message || (apiPath + ' 调用失败'));
    }
    return data;
  }

  function firstNonEmpty(source, keys) {
    var object = source || {};
    for (var index = 0; index < keys.length; index += 1) {
      var value = normalizeDbKey(object[keys[index]]);
      if (value) return value;
    }
    return '';
  }

  function normalizeImageUrl(value) {
    var text = normalizeText(value);
    if (!text) return '';
    if (text.indexOf('//') === 0) return window.location.protocol + text;
    if (/^https?:\/\//i.test(text) || /^data:image\//i.test(text)) return text;
    if (text.charAt(0) === '/') return (new URL(text, window.location.origin)).toString();
    return '';
  }

  function resizeImageUrl(imageUrl, size) {
    var url = normalizeImageUrl(imageUrl);
    if (!url || /^data:image\//i.test(url)) return url;
    var resizeArg = 'image/resize,l_' + String(size || 600) + '/imageslim';
    if (url.indexOf('x-image-process=') >= 0) {
      return url.replace(/x-image-process=[^&]+/, 'x-image-process=' + resizeArg);
    }
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'x-image-process=' + resizeArg;
  }

  function addImageUrl(urls, seen, value) {
    var url = normalizeImageUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  }

  function collectImageUrls(value, urls, seen) {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(function (entry) { collectImageUrls(entry, urls, seen); });
      return;
    }
    if (typeof value === 'object') {
      IMAGE_FIELDS.forEach(function (field) {
        if (Object.prototype.hasOwnProperty.call(value, field)) collectImageUrls(value[field], urls, seen);
      });
      return;
    }
    var text = normalizeText(value);
    if (!text) return;
    if ((text.charAt(0) === '[' || text.charAt(0) === '{') && text.length < 20000) {
      var parsed = parseJson(text, null);
      if (parsed) {
        collectImageUrls(parsed, urls, seen);
        return;
      }
    }
    if (/^data:image\//i.test(text) || /^https?:\/\//i.test(text) || text.indexOf('//') === 0 || text.charAt(0) === '/') {
      addImageUrl(urls, seen, text);
      return;
    }
    text.split(/[\s,;，；]+/).forEach(function (part) {
      addImageUrl(urls, seen, part);
    });
  }

  function imageItemsForDetail(row, detail) {
    var urls = [];
    var seen = new Set();
    IMAGE_FIELDS.forEach(function (field) {
      collectImageUrls((detail || {})[field], urls, seen);
    });
    if (!urls.length) {
      IMAGE_FIELDS.forEach(function (field) {
        collectImageUrls((row || {})[field], urls, seen);
      });
    }
    return urls.map(function (url, index) {
      return {
        url: url,
        thumbUrl: resizeImageUrl(url, 600),
        highUrl: resizeImageUrl(url, 1200),
        label: '图 ' + String(index + 1),
      };
    });
  }

  function normalizeOrderPage(result) {
    var body = result && result.data ? result.data : {};
    var rows = [];
    if (Array.isArray(body)) rows = body;
    else if (Array.isArray(body.data)) rows = body.data;
    else if (Array.isArray(body.list)) rows = body.list;
    else if (Array.isArray(body.rows)) rows = body.rows;
    return {
      rows: rows,
      total: Number(body.total || rows.length || 0),
      page: Number(body.current_page || body.page || 1),
      lastPage: Number(body.last_page || body.lastPage || 1),
    };
  }

  async function getPlatformTags() {
    var result = await apiRequest('POST', '/plat/getOrderPlatformTags', {});
    return Array.isArray(result.data) ? result.data : [];
  }

  async function listAllOrders(status, platOrderType) {
    var rows = [];
    var page = 1;
    var maxPages = 50;
    while (page <= maxPages) {
      var payload = { status: String(status), page: String(page), limit: '100' };
      if (platOrderType !== undefined && platOrderType !== null && platOrderType !== '') {
        payload.plat_order_type = String(platOrderType);
      }
      var pageData = normalizeOrderPage(await apiRequest('POST', '/order/getUserOrderList', payload));
      rows = rows.concat(pageData.rows);
      if (!pageData.rows.length || page >= pageData.lastPage) break;
      page += 1;
    }
    return rows;
  }

  function tagNameForOrder(row) {
    var tagName = state.tagMap.get(normalizeText(row.plat_order_type));
    if (tagName) return tagName;
    if (String(row.plat_order_type) === '0') return 'VMI';
    return '未标记';
  }

  function enrichOrders(rows) {
    return rows.map(function (row) {
      return Object.assign({}, row, { tag_name: tagNameForOrder(row) });
    });
  }

  function buildSizeItems(rows) {
    var items = [];
    rows.forEach(function (row) {
      var details = Array.isArray(row.detail) ? row.detail : [];
      details.forEach(function (detail) {
        if (!detail || typeof detail !== 'object') return;
        var orderDetailId = firstNonEmpty(detail, ['id', 'order_detail_id', 'item_id']);
        var sku = firstNonEmpty(detail, ['sku', 'sku_id', 'skuId', 'sku_code', 'skuCode', 'productSku', 'product_sku', 'product_sku_id', 'goods_sku']);
        if (!orderDetailId || !sku) return;
        var skcId = firstNonEmpty(detail, ['skc', 'SKC', 'skc_id', 'skcId', 'product_skc_id', 'productSkcId']);
        var spuId =
          firstNonEmpty(detail, ['product_id', 'productId', 'spu_id', 'spuId', 'goods_id', 'goodsId', 'design_product_id']) ||
          firstNonEmpty(row, ['product_id', 'productId', 'spu_id', 'spuId', 'goods_id', 'goodsId']);
        var productNo = firstNonEmpty(detail, PRODUCT_NO_FIELDS) || firstNonEmpty(row, PRODUCT_NO_FIELDS);
        var candidates = [
          ['SKU_ID', sku],
          ['SKU', sku],
          ['SKC_ID', skcId],
          ['SPU_ID', spuId],
        ].filter(function (entry) {
          return Boolean(entry[1]);
        });
        items.push({
          key: String(orderDetailId),
          orderDetailId: orderDetailId,
          orderNo: normalizeText(row.order_no),
          orderId: firstNonEmpty(row, ['order_id', 'id']),
          tagName: normalizeText(row.tag_name),
          shopName: normalizeText(row.shop_name),
          sku: sku,
          skcId: skcId,
          spuId: spuId,
          productId: spuId,
          productNo: productNo,
          currentSize: normalizeText(detail.size || detail.spec_size || detail.goods_size),
          currentSizeId: normalizeDbKey(detail.size_id || detail.sizeId),
          listDetail: detail,
          matchCandidates: candidates,
          imageItems: imageItemsForDetail(row, detail),
        });
      });
    });
    return items;
  }

  async function refreshOrders(forceDuringOperation) {
    if (state.loadingOrders || (state.busyAction === 'logistics' && !forceDuringOperation)) return;
    state.loadingOrders = true;
    state.orderStatus = '正在读取订单...';
    render();
    try {
      state.tags = await getPlatformTags();
      state.tagMap = new Map();
      state.tags.forEach(function (tag) {
        var name = normalizeText(tag.name);
        if (name) state.tagMap.set(normalizeText(tag.id), name);
      });
      state.jitTag = state.tags.find(function (tag) {
        return normalizeText(tag.name).toUpperCase() === 'JIT';
      }) || null;

      var result = await Promise.all([listAllOrders(1), listAllOrders(2)]);
      state.editOrders = enrichOrders(result[0]);
      state.paymentOrders = enrichOrders(result[1]);
      state.items = buildSizeItems(state.paymentOrders);
      state.lastRefreshText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      state.orderStatus =
        '待编辑 ' + state.editOrders.length + ' 单，待付款 ' + state.paymentOrders.length + ' 单';
      if (!state.editOrders.some(isJitOrder) && state.paymentOrders.length) state.activeTab = 'payment';
    } catch (error) {
      state.orderStatus = '订单读取失败：' + (error.message || error);
      showToast(state.orderStatus, 'error');
    } finally {
      state.loadingOrders = false;
      render();
    }
  }

  async function refreshAll() {
    var tasks = [refreshOrders()];
    if (!state.dbRows.length && !state.loadingDb) tasks.push(loadCompositionDb(false));
    await Promise.allSettled(tasks);
  }

  function normalizeDbKey(value) {
    if (value === null || value === undefined) return '';
    var text = String(value).trim();
    if (!text || ['nan', 'none', 'null', 'undefined'].indexOf(text.toLowerCase()) >= 0) return '';
    text = text.replace(/\t/g, '').replace(/\u3000/g, ' ').trim();
    if (/^[+-]?\d+(\.0+)?$/.test(text)) return text.split('.')[0];
    if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(text)) {
      var numeric = Number(text);
      if (Number.isFinite(numeric)) {
        return Number.isInteger(numeric) ? String(numeric) : String(numeric).replace(/0+$/, '').replace(/\.$/, '');
      }
    }
    return text.replace(/\s+/g, '');
  }

  function normalizeCompositionText(value) {
    return normalizeText(value).toLowerCase().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
  }

  function inferSizeFromComposition(value) {
    var text = normalizeCompositionText(value);
    if (!text) return '';
    if (text.indexOf('人棉') >= 0) return '人棉';
    if (['涤纶', '聚酯', '聚脂', 'polyester'].some(function (token) { return text.indexOf(token) >= 0; })) return '涤纶';
    if (text.indexOf('棉') >= 0 || text.indexOf('cotton') >= 0) return '棉';
    return '';
  }

  function readRecordValue(record, keys) {
    var source = record || {};
    for (var index = 0; index < keys.length; index += 1) {
      if (source[keys[index]] !== undefined && source[keys[index]] !== null) return source[keys[index]];
    }
    var entries = Object.entries(source);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      var lower = keys[keyIndex].toLowerCase();
      var found = entries.find(function (entry) {
        return String(entry[0]).toLowerCase() === lower;
      });
      if (found) return found[1];
    }
    return '';
  }

  function normalizeDbPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload && payload.records)) return payload.records;
    if (Array.isArray(payload && payload.data)) return payload.data;
    if (payload && typeof payload === 'object') {
      return Object.values(payload).filter(function (item) {
        return item && typeof item === 'object';
      });
    }
    return [];
  }

  function normalizeDbRecord(rawRecord) {
    var record = rawRecord || {};
    var composition = normalizeText(readRecordValue(record, ['composition', '成分', '成份', '材质']));
    var explicitTarget = normalizeText(readRecordValue(record, ['target_size', 'targetSize', '尺码', '目标尺码']));
    var targetSize = SIZE_TARGETS.indexOf(explicitTarget) >= 0 ? explicitTarget : inferSizeFromComposition(composition);
    return {
      SKC_ID: normalizeDbKey(readRecordValue(record, ['SKC_ID', 'skc_id', 'skcId', 'skc'])),
      SPU_ID: normalizeDbKey(readRecordValue(record, ['SPU_ID', 'spu_id', 'spuId', 'product_id', 'productId'])),
      SKU_ID: normalizeDbKey(readRecordValue(record, ['SKU_ID', 'SKU ID', 'sku_id', 'skuId', 'skuCode', 'sku_code'])),
      SKU: normalizeDbKey(readRecordValue(record, ['SKU', 'sku', 'productSku', 'product_sku'])),
      composition: composition,
      target_size: targetSize,
    };
  }

  function buildDbIndex(records) {
    var index = new Map();
    records.forEach(function (record) {
      var normalized = normalizeDbRecord(record);
      DB_FIELDS.forEach(function (field) {
        var key = normalized[field];
        if (key && !index.has(field + ':' + key)) {
          index.set(field + ':' + key, Object.assign({}, normalized, { db_field: field }));
        }
      });
    });
    return index;
  }

  function openCacheDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('当前 WebView 不支持数据库缓存'));
        return;
      }
      var request = indexedDB.open(CACHE_DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) db.createObjectStore(CACHE_STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('打开缓存失败')); };
    });
  }

  async function readDbCache() {
    var db = await openCacheDb();
    try {
      return await new Promise(function (resolve, reject) {
        var request = db.transaction(CACHE_STORE_NAME, 'readonly').objectStore(CACHE_STORE_NAME).get(CACHE_KEY);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error || new Error('读取缓存失败')); };
      });
    } finally {
      db.close();
    }
  }

  async function writeDbCache(records) {
    var db = await openCacheDb();
    try {
      await new Promise(function (resolve, reject) {
        var request = db.transaction(CACHE_STORE_NAME, 'readwrite').objectStore(CACHE_STORE_NAME).put(
          { fetchedAt: Date.now(), records: records },
          CACHE_KEY
        );
        request.onsuccess = function () { resolve(); };
        request.onerror = function () { reject(request.error || new Error('写入缓存失败')); };
      });
    } finally {
      db.close();
    }
  }

  function useCompositionRecords(records, sourceText) {
    state.dbRows = records;
    state.dbIndex = buildDbIndex(records);
    state.dbStatus = sourceText + ' ' + records.length + ' 条';
  }

  async function loadCompositionDb(force) {
    if (state.loadingDb) return;
    state.loadingDb = true;
    state.dbStatus = '正在读取成分数据库...';
    render();

    if (!force && !state.dbRows.length) {
      try {
        var cached = await Promise.race([
          readDbCache(),
          sleep(800).then(function () { return null; }),
        ]);
        if (cached && Array.isArray(cached.records) && cached.records.length) {
          useCompositionRecords(cached.records, '已加载本机缓存');
          render();
        }
      } catch (cacheError) {}
    }

    try {
      var url = force ? DB_URL + '?t=' + Date.now() : DB_URL;
      var response = await requestText('GET', url, {}, undefined, 90000);
      if (response.status < 200 || response.status >= 300) throw new Error('HTTP ' + response.status);
      var records = normalizeDbPayload(JSON.parse(response.text));
      if (!records.length) throw new Error('数据库为空');
      useCompositionRecords(records, '云端数据库');
      try {
        await writeDbCache(records);
      } catch (cacheWriteError) {}
    } catch (error) {
      if (state.dbRows.length) {
        state.dbStatus = '云端更新失败，继续使用缓存 ' + state.dbRows.length + ' 条';
      } else {
        state.dbStatus = '数据库未加载，可手动改尺码';
      }
      showToast('成分数据库读取失败：' + (error.message || error), 'warning');
    } finally {
      state.loadingDb = false;
      render();
    }
  }

  function findSuggestion(item) {
    var candidates = item.matchCandidates || [];
    for (var index = 0; index < candidates.length; index += 1) {
      var field = candidates[index][0];
      var value = candidates[index][1];
      var record = state.dbIndex.get(field + ':' + normalizeDbKey(value));
      if (record) return record;
    }
    return inferPolyesterFallbackFromProductNo(item.productNo);
  }

  function parseProductNoUploadDate(value) {
    var text = normalizeText(value);
    var matcher = /20\d{6}/g;
    var match;
    while ((match = matcher.exec(text))) {
      var token = match[0];
      var year = Number(token.slice(0, 4));
      var month = Number(token.slice(4, 6));
      var day = Number(token.slice(6, 8));
      var date = new Date(year, month - 1, day);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return token;
    }
    return '';
  }

  function inferPolyesterFallbackFromProductNo(value) {
    var productNo = normalizeText(value);
    var dateToken = parseProductNoUploadDate(productNo);
    if (!productNo || !dateToken || dateToken < PRODUCT_NO_POLYESTER_FALLBACK_START) return null;
    var dateText = dateToken.slice(0, 4) + '-' + dateToken.slice(4, 6) + '-' + dateToken.slice(6, 8);
    return {
      target_size: '涤纶',
      composition: '货号 ' + productNo + ' 日期 ' + dateText + ' >= 2026-07-01，默认涤纶',
      db_field: '货号日期兜底',
      product_no: productNo,
      product_no_date: dateText,
    };
  }

  function isJitOrder(row) {
    return normalizeText(row.tag_name).toUpperCase() === 'JIT';
  }

  function isVmiOrder(row) {
    return normalizeText(row.tag_name).toUpperCase() === 'VMI';
  }

  function orderIdFor(row) {
    return normalizeText((row || {}).order_id || (row || {}).id);
  }

  function getPaymentJitRows(rows) {
    return (rows || state.paymentOrders).filter(function (row) {
      return isJitOrder(row) && Boolean(orderIdFor(row));
    });
  }

  function getCounts() {
    var jit = state.editOrders.filter(isJitOrder).length;
    var vmi = state.editOrders.filter(isVmiOrder).length;
    var generic = state.items.filter(function (item) {
      return normalizeText(item.tagName).toUpperCase() === 'JIT' && normalizeText(item.currentSize) === '通用尺码';
    }).length;
    var matched = state.items.filter(function (item) {
      var suggestion = findSuggestion(item);
      return Boolean(suggestion && suggestion.target_size);
    }).length;
    var actionable = state.items.filter(function (item) {
      var suggestion = findSuggestion(item);
      return Boolean(suggestion && suggestion.target_size && suggestion.target_size !== normalizeText(item.currentSize));
    }).length;
    return {
      edit: state.editOrders.length,
      jit: jit,
      vmi: vmi,
      payment: state.paymentOrders.length,
      paymentJit: getPaymentJitRows().length,
      generic: generic,
      matched: matched,
      actionable: actionable,
    };
  }

  async function getCompanyList(platId) {
    var result = await apiRequest('POST', '/logistic/getCompanyList', { plat_id: String(platId) });
    var data = result.data || [];
    if (!Array.isArray(data) && data && typeof data === 'object') data = data.data || data.list || [];
    return (Array.isArray(data) ? data : []).map(function (company) {
      return Object.assign({}, company, { id: company.id || company.logistic_id });
    });
  }

  async function findTemuCompany(platId) {
    var companies = await getCompanyList(platId);
    var company = companies.find(function (item) {
      return (normalizeText(item.name) + ' ' + normalizeText(item.code)).toLowerCase().indexOf('temu') >= 0;
    });
    if (!company) throw new Error('平台 ' + platId + ' 未找到 TEMU 物流');
    return company;
  }

  async function getOrderCompanyPreview(platId, orderIds, logisticId) {
    var result = await apiRequest('POST', '/logistic/getOrderCompany', {
      plat_id: String(platId),
      order_id: orderIds.join(','),
      logistic_id: String(logisticId),
    });
    return result.data || {};
  }

  function setOperation(title, detail, current, total, tone) {
    state.operation = {
      title: title,
      detail: detail,
      current: Number(current || 0),
      total: Number(total || 0),
      tone: tone || 'working',
    };
    render();
  }

  async function prepareLogistics(rows) {
    var groups = new Map();
    rows.forEach(function (row) {
      var platId = normalizeText(row.plat_id);
      if (!platId) throw new Error('订单 ' + normalizeText(row.order_no) + ' 缺少平台 ID');
      if (!groups.has(platId)) groups.set(platId, []);
      groups.get(platId).push(row);
    });

    var plans = [];
    var entries = Array.from(groups.entries());
    for (var groupIndex = 0; groupIndex < entries.length; groupIndex += 1) {
      var platId = entries[groupIndex][0];
      var groupRows = entries[groupIndex][1];
      setOperation(
        '正在预检 TEMU 物流',
        '检查第 ' + (groupIndex + 1) + '/' + entries.length + ' 个平台',
        0,
        rows.length,
        'working'
      );
      var company = await findTemuCompany(platId);
      var companyId = company.id || company.logistic_id;
      var preview = await getOrderCompanyPreview(
        platId,
        groupRows.map(function (row) { return String(row.order_id); }),
        companyId
      );
      var express = preview.express || {};
      if (Array.isArray(express)) express = express.length ? express[0] : {};
      var okNum = Number(preview.ok_num || 0);
      var noNum = Number(preview.no_num || 0);
      if (okNum !== groupRows.length || noNum !== 0) {
        throw new Error(
          '物流预检未通过：可修改 ' + okNum + ' 单，不可修改 ' + noNum + ' 单，已全部停止'
        );
      }
      plans.push({
        platId: platId,
        rows: groupRows,
        company: company,
        express: express,
      });
    }
    return plans;
  }

  async function waitForPayment(orderIds) {
    var targetIds = new Set(orderIds.map(String));
    var latestRows = [];
    for (var attempt = 1; attempt <= 8; attempt += 1) {
      setOperation(
        '物流已提交',
        '等待订单进入待付款，第 ' + attempt + '/8 次检查',
        orderIds.length - targetIds.size,
        orderIds.length,
        'working'
      );
      latestRows = await listAllOrders(2);
      latestRows.forEach(function (row) {
        targetIds.delete(String(row.order_id || ''));
      });
      if (!targetIds.size) break;
      await sleep(1500);
    }
    return { rows: latestRows, missingIds: Array.from(targetIds) };
  }

  async function advanceAllJitOrders() {
    if (state.busyAction) return;
    var rows = state.editOrders.filter(isJitOrder);
    if (!rows.length) {
      showToast('当前没有待编辑 JIT', 'warning');
      return;
    }
    var confirmed = await showConfirm(
      '确认推进待付款',
      '将对 ' + rows.length + ' 个待编辑 JIT 做 TEMU 物流预检，全部通过后真实提交。\nVMI 不会处理。',
      '确认并开始'
    );
    if (!confirmed) return;

    state.busyAction = 'logistics';
    var successRows = [];
    var failedRows = [];
    var waitResult = { missingIds: [] };
    try {
      var plans = await prepareLogistics(rows);
      var completed = 0;
      for (var planIndex = 0; planIndex < plans.length; planIndex += 1) {
        var plan = plans[planIndex];
        for (var rowIndex = 0; rowIndex < plan.rows.length; rowIndex += 1) {
          var row = plan.rows[rowIndex];
          setOperation(
            '正在改 TEMU 物流',
            normalizeText(row.order_no) || ('订单 ' + (completed + 1)),
            completed,
            rows.length,
            'working'
          );
          try {
            await apiRequest('POST', '/logistic/changeExpressSave', {
              plat_id: String(plan.platId),
              order_id: String(row.order_id),
              express_price: String(
                plan.express.price === null || plan.express.price === undefined ? 0 : plan.express.price
              ),
              express_id: String(plan.express.id || plan.company.id || plan.company.logistic_id),
              express_company: String(plan.express.name || plan.company.name || 'TEMU'),
            });
            successRows.push(row);
          } catch (error) {
            failedRows.push({ row: row, error: error });
          }
          completed += 1;
        }
      }

      if (successRows.length) {
        waitResult = await waitForPayment(successRows.map(function (row) { return String(row.order_id); }));
      }
      state.activeTab = 'payment';
      await refreshOrders(true);
      if (failedRows.length) {
        setOperation(
          '部分订单处理失败',
          '成功 ' + successRows.length + ' 单，失败 ' + failedRows.length + ' 单',
          successRows.length,
          rows.length,
          'error'
        );
        showToast('改物流完成：成功 ' + successRows.length + '，失败 ' + failedRows.length, 'error');
      } else if (waitResult.missingIds.length) {
        setOperation(
          '物流已提交，订单仍在流转',
          '成功提交 ' + successRows.length + ' 单，仍有 ' + waitResult.missingIds.length + ' 单暂未进入待付款',
          successRows.length - waitResult.missingIds.length,
          rows.length,
          'working'
        );
        showToast('物流已提交，稍后再刷新待付款', 'warning');
      } else {
        setOperation(
          '已推进到待付款',
          '成功处理 ' + successRows.length + ' 个 JIT',
          successRows.length,
          rows.length,
          'success'
        );
        showToast('已把 ' + successRows.length + ' 个 JIT 推进到待付款', 'success');
      }
    } catch (error) {
      setOperation('改物流已停止', error.message || String(error), 0, rows.length, 'error');
      showToast(error.message || String(error), 'error');
    } finally {
      state.busyAction = '';
      render();
    }
  }

  var OPTION_ID_FIELDS = [
    'id', 'option_id', 'optionId', 'size_id', 'sizeId',
    'value_id', 'valueId', 'code_id', 'codeId', 'key',
  ];
  var OPTION_VALUE_FIELDS = [
    'name_zh', 'zh_name', 'cn_name', 'cnName', 'display_name', 'displayName',
    'label', 'title', 'name', 'text', 'value', 'size', 'code', 'value_code', 'valueCode',
  ];

  function optionKey(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function firstOptionId() {
    var sources = Array.prototype.slice.call(arguments);
    for (var sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      var source = sources[sourceIndex];
      if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
      var value = optionFieldValue(source, OPTION_ID_FIELDS);
      if (value !== null && value !== undefined && value !== '') return normalizeDbKey(value);
      if (source.size && typeof source.size === 'object' && !Array.isArray(source.size)) {
        value = optionFieldValue(source.size, OPTION_ID_FIELDS);
        if (value !== null && value !== undefined && value !== '') return normalizeDbKey(value);
      }
      if (source.data && typeof source.data === 'object' && !Array.isArray(source.data)) {
        value = optionFieldValue(source.data, OPTION_ID_FIELDS);
        if (value !== null && value !== undefined && value !== '') return normalizeDbKey(value);
      }
    }
    return '';
  }

  function optionFieldValue(option, fields) {
    if (!option || typeof option !== 'object') return '';
    var aliases = fields.map(optionKey);
    var keys = Object.keys(option);
    for (var index = 0; index < keys.length; index += 1) {
      if (aliases.indexOf(optionKey(keys[index])) >= 0 && option[keys[index]] !== null && option[keys[index]] !== undefined && option[keys[index]] !== '') {
        return option[keys[index]];
      }
    }
    return '';
  }

  function optionId(option, fallback) {
    var value = optionFieldValue(option, OPTION_ID_FIELDS);
    if (value !== null && value !== undefined && value !== '') return normalizeDbKey(value);
    var scalar = normalizeDbKey(option);
    return /^\d+$/.test(scalar) ? scalar : normalizeDbKey(fallback || '');
  }

  function optionSearchValues(option) {
    if (!option || typeof option !== 'object') {
      var plain = normalizeText(option);
      return plain ? [plain] : [];
    }
    var values = [];
    OPTION_VALUE_FIELDS.forEach(function (field) {
      var value = optionFieldValue(option, [field]);
      var text = normalizeText(value);
      if (text && values.indexOf(text) < 0) values.push(text);
    });
    return values;
  }

  function optionName(option, fallback) {
    var values = optionSearchValues(option);
    return values[0] || normalizeText(fallback);
  }

  function eachNamedOption(options, callback) {
    if (Array.isArray(options)) {
      options.forEach(function (option) {
        callback(optionId(option, ''), option);
      });
      return;
    }
    Object.entries(options || {}).forEach(function (entry) {
      callback(optionId(entry[1], entry[0]), entry[1]);
    });
  }

  function findNamedOption(options, targetSize) {
    var target = normalizeText(targetSize);
    var found = null;
    if (!target) return found;
    eachNamedOption(options, function (id, option) {
      if (!found && optionSearchValues(option).indexOf(target) >= 0) {
        found = { id: id, name: optionName(option, target), raw: option };
      }
    });
    return found;
  }

  function findNamedOptionId(options, targetSize) {
    var found = findNamedOption(options, targetSize);
    return found ? normalizeText(found.id) : '';
  }

  function findOptionById(options, value) {
    var wanted = normalizeDbKey(value);
    var found = null;
    if (!wanted) return found;
    eachNamedOption(options, function (id, option) {
      if (!found && normalizeDbKey(id) === wanted) {
        found = { id: id, name: optionName(option), raw: option };
      }
    });
    return found;
  }

  function formatOptionNames(options) {
    var names = [];
    eachNamedOption(options, function (_id, option) {
      var name = optionName(option);
      if (name && names.indexOf(name) < 0) names.push(name);
    });
    return names.slice(0, 12).join('、');
  }

  function getDataBody(result) {
    return result && result.data && result.data.data ? result.data.data : (result.data || result || {});
  }

  async function getEditDetail(orderDetailId) {
    return getDataBody(await apiRequest('GET', '/order/getEditDetail', { ids: orderDetailId, type: 1 }));
  }

  async function getProductInfo(productId) {
    return getDataBody(await apiRequest('GET', '/order/getProductInfo', { productId: productId }));
  }

  async function getOrderSizeState(item) {
    var editDetail = await getEditDetail(item.orderDetailId);
    var current = editDetail.data || {};
    var sizeOptions = editDetail.size || editDetail.sizes || {};
    var productId = normalizeText(editDetail.product_id || current.product_id || item.productId);
    var productInfo = null;
    if (!Object.keys(sizeOptions || {}).length && productId) {
      productInfo = await getProductInfo(productId);
      sizeOptions = productInfo.size || productInfo.sizes || {};
    }
    var currentSizeId = firstOptionId(editDetail, current, item, item.listDetail || {});
    var currentOption = findOptionById(sizeOptions, currentSizeId);
    if (!currentOption) {
      currentOption = findNamedOption(sizeOptions, current.size || item.currentSize || '');
      if (currentOption) currentSizeId = normalizeDbKey(currentOption.id);
    }
    var currentSizeName = normalizeText(
      (currentOption && currentOption.name) || current.size || item.currentSize
    );
    var result = {
      editDetail: editDetail,
      productInfo: productInfo,
      productId: productId,
      sizeOptions: sizeOptions,
      currentSizeId: currentSizeId,
      currentSizeName: currentSizeName,
    };
    item.currentSizeId = currentSizeId;
    if (currentSizeName) item.currentSize = currentSizeName;
    item.sizeOptions = sizeOptions;
    item.sizeState = result;
    return result;
  }

  async function changeSize(item, targetSize) {
    var target = normalizeText(targetSize);
    if (!target) throw new Error('目标尺码为空');

    var sizeState = await getOrderSizeState(item);
    var editDetail = sizeState.editDetail;
    var sizeMap = sizeState.sizeOptions || {};
    var colorMap = editDetail.color || {};
    var current = editDetail.data || {};
    var productId = normalizeText(sizeState.productId || item.productId);
    var productInfo = sizeState.productInfo;
    var targetOption = findNamedOption(sizeMap, target);
    var targetSizeId = targetOption ? normalizeText(targetOption.id) : '';

    if (!targetSizeId && productId) {
      productInfo = await getProductInfo(productId);
      var productSizeMap = productInfo.size || {};
      targetOption = findNamedOption(productSizeMap, target);
      targetSizeId = targetOption ? normalizeText(targetOption.id) : '';
      if (targetSizeId) {
        sizeMap = productSizeMap;
        item.sizeOptions = sizeMap;
      }
    }
    if (!targetSizeId) {
      var options = formatOptionNames(sizeMap);
      throw new Error('找不到尺码：' + target + (options ? '；可选：' + options : ''));
    }

    var currentSizeId = normalizeDbKey(sizeState.currentSizeId);
    if (currentSizeId && normalizeDbKey(targetSizeId) === currentSizeId) {
      item.currentSizeId = currentSizeId;
      item.currentSize = sizeState.currentSizeName || target;
      return { skipped: true, currentSizeId: currentSizeId };
    }

    var currentColor = normalizeText(current.colour || current.color);
    var currentColorId = normalizeText(current.colour_id || current.color_id);
    if (!currentColorId && currentColor) currentColorId = findNamedOptionId(colorMap, currentColor);
    if (!currentColorId && currentColor && productId) {
      if (!productInfo) productInfo = await getProductInfo(productId);
      currentColorId = findNamedOptionId(productInfo.color || {}, currentColor);
    }
    if (!currentColorId) throw new Error('找不到原颜色 ID，已阻止提交');

    await apiRequest('POST', '/order/relateOrderDetailSave', {
      productId: productId,
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
    item.currentSizeId = normalizeDbKey(targetSizeId);
    return { skipped: false, currentSizeId: item.currentSizeId };
  }

  async function handleChangeSize(itemKey, targetSize) {
    if (state.busyAction) return;
    var item = state.items.find(function (entry) { return entry.key === itemKey; });
    if (!item || state.busyItemIds.has(itemKey)) return;
    var confirmed = await showConfirm(
      '确认修改尺码',
      (item.orderNo || item.sku) + '\n' + (item.currentSize || '-') + ' 改为 ' + targetSize,
      '确认修改'
    );
    if (!confirmed) return;

    state.busyItemIds.add(itemKey);
    state.itemStatus.set(itemKey, { text: '正在改为 ' + targetSize + '...', tone: 'working' });
    render();
    try {
      var changeResult = await changeSize(item, targetSize);
      var doneText = changeResult && changeResult.skipped ? '已是 ' + targetSize : '已改为 ' + targetSize;
      state.itemStatus.set(itemKey, { text: doneText, tone: 'success' });
      showToast((item.orderNo || item.sku) + ' ' + doneText, 'success');
    } catch (error) {
      state.itemStatus.set(itemKey, { text: '失败：' + (error.message || error), tone: 'error' });
      showToast(error.message || String(error), 'error');
    } finally {
      state.busyItemIds.delete(itemKey);
      render();
    }
  }

  async function applyAllSuggestions() {
    if (state.busyAction) return;
    var candidates = state.items.map(function (item) {
      return { item: item, suggestion: findSuggestion(item) };
    }).filter(function (entry) {
      return entry.suggestion && entry.suggestion.target_size;
    });
    var targets = [];
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      var candidate = candidates[candidateIndex];
      var targetSize = normalizeText(candidate.suggestion.target_size);
      try {
        var sizeState = await getOrderSizeState(candidate.item);
        var targetOption = findNamedOption(sizeState.sizeOptions, targetSize);
        var sameById = targetOption && sizeState.currentSizeId &&
          normalizeDbKey(targetOption.id) === normalizeDbKey(sizeState.currentSizeId);
        if (!sameById && targetSize !== normalizeText(candidate.item.currentSize)) {
          targets.push(candidate);
        }
      } catch (error) {
        // 详情读取失败时保留手动/提交路径，但不猜测外语值的含义。
        if (targetSize !== normalizeText(candidate.item.currentSize)) targets.push(candidate);
      }
    }
    if (!targets.length) {
      showToast('没有需要修改的匹配项', 'warning');
      return;
    }
    var confirmed = await showConfirm(
      '确认批量修改',
      '将按成分数据库修改 ' + targets.length + ' 个 SKU。\n提交过程中会逐项显示进度。',
      '修改 ' + targets.length + ' 项'
    );
    if (!confirmed) return;

    state.busyAction = 'size-batch';
    var successCount = 0;
    var failedCount = 0;
    for (var index = 0; index < targets.length; index += 1) {
      var target = targets[index];
      var targetSize = target.suggestion.target_size;
      setOperation(
        '正在修改匹配尺码',
        (target.item.orderNo || target.item.sku) + ' 改为 ' + targetSize,
        index,
        targets.length,
        'working'
      );
      state.itemStatus.set(target.item.key, { text: '正在改为 ' + targetSize + '...', tone: 'working' });
      try {
        var changeResult = await changeSize(target.item, targetSize);
        successCount += 1;
        state.itemStatus.set(target.item.key, {
          text: changeResult && changeResult.skipped ? '已是 ' + targetSize : '已改为 ' + targetSize,
          tone: 'success',
        });
      } catch (error) {
        failedCount += 1;
        state.itemStatus.set(target.item.key, { text: '失败：' + (error.message || error), tone: 'error' });
      }
    }

    state.busyAction = '';
    setOperation(
      failedCount ? '匹配修改已完成' : '匹配尺码全部修改完成',
      '成功 ' + successCount + ' 项，失败 ' + failedCount + ' 项',
      successCount,
      targets.length,
      failedCount ? 'error' : 'success'
    );
    showToast('尺码修改完成：成功 ' + successCount + '，失败 ' + failedCount, failedCount ? 'warning' : 'success');
    render();
  }

  function textHasPaymentRisk(value) {
    var text = normalizeText(value);
    if (!text) return false;
    var negativeTerms = ['失败', '错误', '不可', '不能', '无法', '不支持', '余额不足', '未通过', '已取消', '不存在', '无效', '风险'];
    if (negativeTerms.some(function (term) { return text.indexOf(term) >= 0; })) return true;
    return text.indexOf('异常') >= 0 && ['无异常', '没有异常', '未发现异常'].every(function (term) {
      return text.indexOf(term) < 0;
    });
  }

  function inspectPaymentPreviewIds(preview, expectedIds) {
    var expected = expectedIds.map(String);
    var found = new Set();
    var sawOrderIdField = false;

    function scanScalar(value) {
      if (value === null || value === undefined || typeof value === 'boolean') return;
      var text = String(value);
      expected.forEach(function (expectedId) {
        var escaped = expectedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if ((new RegExp('(^|\\D)' + escaped + '(\\D|$)')).test(text)) found.add(expectedId);
      });
    }

    function scanValue(value) {
      if (Array.isArray(value)) value.forEach(scanValue);
      else if (value && typeof value === 'object') Object.keys(value).forEach(function (key) { scanValue(value[key]); });
      else scanScalar(value);
    }

    function walk(value) {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (!value || typeof value !== 'object') return;
      Object.keys(value).forEach(function (key) {
        var normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if ((normalizedKey.indexOf('order') >= 0 && normalizedKey.indexOf('id') >= 0) || normalizedKey === 'ids' || normalizedKey === 'idlist') {
          sawOrderIdField = true;
        }
        if (normalizedKey.indexOf('id') >= 0 || normalizedKey.indexOf('order') >= 0) scanValue(value[key]);
        walk(value[key]);
      });
    }

    walk(preview);
    return { found: found, sawOrderIdField: sawOrderIdField };
  }

  function validatePaymentPreview(preview, expectedIds) {
    var issues = [];
    var goodKeys = ['ok', 'success', 'pass', 'passed', 'canpay', 'allowpay', 'allowedpay', 'available', 'valid', 'checked'];
    var badKeys = ['error', 'haserror', 'fail', 'failed', 'invalid', 'disabled', 'risk', 'hasrisk', 'rejected', 'abnormal', 'hasabnormal', 'unpayable'];
    var badListTokens = ['error', 'fail', 'invalid', 'abnormal', 'unpay', 'reject', 'disable', 'risk'];

    function addIssue(message) {
      if (issues.indexOf(message) < 0 && issues.length < 20) issues.push(message);
    }

    function walk(value, path) {
      if (Array.isArray(value)) {
        value.forEach(function (item, index) { walk(item, path + '[' + index + ']'); });
        return;
      }
      if (!value || typeof value !== 'object') {
        if (typeof value === 'string' && textHasPaymentRisk(value)) addIssue(path + '：' + value.slice(0, 80));
        return;
      }
      Object.keys(value).forEach(function (key) {
        var child = value[key];
        var keyName = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        var childPath = path + '.' + key;
        if (typeof child === 'boolean') {
          if (goodKeys.indexOf(keyName) >= 0 && !child) addIssue(childPath + '=false');
          if (badKeys.indexOf(keyName) >= 0 && child) addIssue(childPath + '=true');
        } else if (typeof child === 'number') {
          if (goodKeys.indexOf(keyName) >= 0 && child === 0) addIssue(childPath + '=0');
          if (badKeys.indexOf(keyName) >= 0 && child !== 0) addIssue(childPath + '=' + child);
        } else if (typeof child === 'string' && textHasPaymentRisk(child)) {
          addIssue(childPath + '：' + child.slice(0, 80));
        } else if (Array.isArray(child) && child.length && badListTokens.some(function (token) { return keyName.indexOf(token) >= 0; })) {
          addIssue(childPath + ' 非空');
        }
        walk(child, childPath);
      });
    }

    if (!expectedIds.length) addIssue('没有待支付订单');
    if (!preview || typeof preview !== 'object' || Array.isArray(preview) || !Object.keys(preview).length) {
      addIssue('支付预检返回为空');
    }
    walk(preview, 'preview');
    var previewIds = inspectPaymentPreviewIds(preview, expectedIds);
    var missingIds = expectedIds.filter(function (id) { return !previewIds.found.has(String(id)); });
    if ((previewIds.found.size || previewIds.sawOrderIdField) && missingIds.length) {
      addIssue('支付预检未覆盖订单 ID：' + missingIds.slice(0, 5).join(','));
    }
    if (issues.length) throw new Error('支付预检未通过，已阻止支付：' + issues.slice(0, 5).join('；'));
  }

  function requireSamePaymentScope(expectedIds, rows) {
    var expected = expectedIds.map(String).sort();
    var actual = getPaymentJitRows(rows).map(orderIdFor).sort();
    if (expected.length !== actual.length || expected.some(function (id, index) { return id !== actual[index]; })) {
      throw new Error('待付款 JIT 订单范围已变化，已阻止支付。请刷新后重新确认');
    }
    return actual;
  }

  function paymentOrderPreview(rows, limit) {
    var values = rows.map(function (row) { return normalizeText(row.order_no) || orderIdFor(row); }).filter(Boolean);
    var max = limit || 6;
    return values.slice(0, max).join('、') + (values.length > max ? '等 ' + values.length + ' 单' : '');
  }

  async function inspectPaymentSizeRisk(rows) {
    var expectedIds = new Set((rows || []).map(orderIdFor));
    var genericItems = [];
    var unresolvedItems = [];
    var seenGeneric = new Set();
    var seenUnresolved = new Set();
    for (var index = 0; index < state.items.length; index += 1) {
      var item = state.items[index];
      if (!expectedIds.has(String(item.orderId))) continue;
      try {
        var sizeState = await getOrderSizeState(item);
        var genericOption = findNamedOption(sizeState.sizeOptions, '通用尺码');
        var isGeneric = Boolean(
          genericOption && sizeState.currentSizeId &&
          normalizeDbKey(genericOption.id) === normalizeDbKey(sizeState.currentSizeId)
        ) || normalizeText(sizeState.currentSizeName) === '通用尺码';
        if (isGeneric && !seenGeneric.has(item.key)) {
          genericItems.push(item);
          seenGeneric.add(item.key);
        } else if (!sizeState.currentSizeId || !Object.keys(sizeState.sizeOptions || {}).length) {
          if (!seenUnresolved.has(item.key)) {
            unresolvedItems.push(item);
            seenUnresolved.add(item.key);
          }
        }
      } catch (error) {
        if (!seenUnresolved.has(item.key)) {
          unresolvedItems.push(item);
          seenUnresolved.add(item.key);
        }
      }
    }
    return { genericItems: genericItems, unresolvedItems: unresolvedItems };
  }

  async function payAllJitOrders() {
    if (state.busyAction) return;
    var rows = getPaymentJitRows();
    if (!rows.length) {
      showToast('当前没有待付款 JIT', 'warning');
      return;
    }
    var expectedIds = rows.map(orderIdFor);
    var risk = await inspectPaymentSizeRisk(rows);
    var genericItems = risk.genericItems;
    var unresolvedItems = risk.unresolvedItems;
    var riskItems = genericItems.concat(unresolvedItems);
    var message = [
      '将对 ' + rows.length + ' 个待付款 JIT 先预检，通过后真实支付。',
      'VMI 不会支付。',
      '订单：' + paymentOrderPreview(rows),
    ];
    if (riskItems.length) {
      message.push('', '警告：' + genericItems.length + ' 个 SKU 仍是“通用尺码”，' + unresolvedItems.length + ' 个无法确认尺码。');
    }
    message.push('', '请确认订单、图片和尺码无误。');
    var confirmed = await showConfirm('确认真实支付', message.join('\n'), riskItems.length ? '仍要支付' : '预检并支付');
    if (!confirmed) return;

    state.busyAction = 'payment';
    render();
    try {
      if (!state.jitTag || !state.jitTag.id) throw new Error('未找到 JIT 平台标签，已阻止支付');
      setOperation('正在核对待付款 JIT', '重新读取订单范围', 0, 3, 'working');
      var liveRows = enrichOrders(await listAllOrders(2, state.jitTag.id));
      var liveIds = requireSamePaymentScope(expectedIds, liveRows);

      setOperation('正在支付预检', '检查 ' + liveIds.length + ' 个 JIT', 1, 3, 'working');
      var previewResult = await apiRequest('POST', '/order/getCheckOrder', { ids: liveIds.join(','), lange: 'zh' });
      var preview = previewResult.data || {};
      validatePaymentPreview(preview, liveIds);

      setOperation('支付预检通过', '最后核对订单范围', 2, 3, 'working');
      var latestRows = enrichOrders(await listAllOrders(2, state.jitTag.id));
      requireSamePaymentScope(liveIds, latestRows);
      await apiRequest('POST', '/order/orderPay', { ids: liveIds.join(',') });

      setOperation('支付已提交', '成功提交 ' + liveIds.length + ' 个待付款 JIT', 3, 3, 'success');
      showToast('已提交支付 ' + liveIds.length + ' 单', 'success');
      await refreshOrders(true);
    } catch (error) {
      setOperation('支付已停止', error.message || String(error), 0, 3, 'error');
      showToast(error.message || String(error), 'error');
    } finally {
      state.busyAction = '';
      render();
    }
  }

  function showToast(message, tone) {
    state.toast = { message: normalizeText(message), tone: tone || 'info' };
    render();
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      state.toast = null;
      render();
    }, 4200);
  }

  function showConfirm(title, message, confirmLabel) {
    return new Promise(function (resolve) {
      var existing = document.getElementById(CONFIRM_ID);
      if (existing) existing.remove();
      var layer = document.createElement('div');
      layer.id = CONFIRM_ID;
      layer.innerHTML = [
        '<div class="lw-confirm-box" role="dialog" aria-modal="true">',
        '<div class="lw-confirm-title"></div>',
        '<div class="lw-confirm-message"></div>',
        '<div class="lw-confirm-actions">',
        '<button type="button" data-result="cancel">取消</button>',
        '<button type="button" class="lw-confirm-primary" data-result="confirm"></button>',
        '</div>',
        '</div>',
      ].join('');
      layer.querySelector('.lw-confirm-title').textContent = title;
      layer.querySelector('.lw-confirm-message').textContent = message;
      layer.querySelector('.lw-confirm-primary').textContent = confirmLabel;
      layer.addEventListener('click', function (event) {
        var button = event.target.closest('[data-result]');
        if (!button) return;
        var confirmed = button.dataset.result === 'confirm';
        layer.remove();
        resolve(confirmed);
      });
      document.body.appendChild(layer);
    });
  }

  function operationMarkup() {
    if (!state.operation) return '';
    var operation = state.operation;
    var total = Math.max(operation.total || 0, 1);
    var percent = Math.max(0, Math.min(100, Math.round((operation.current || 0) * 100 / total)));
    return [
      '<section class="lw-operation" data-tone="', escapeHtml(operation.tone), '">',
      '<div class="lw-operation-head"><strong>', escapeHtml(operation.title), '</strong>',
      '<span>', escapeHtml(operation.current), '/', escapeHtml(operation.total), '</span></div>',
      '<div class="lw-progress"><i style="width:', percent, '%"></i></div>',
      '<div class="lw-operation-detail">', escapeHtml(operation.detail), '</div>',
      '</section>',
    ].join('');
  }

  function editOrderMarkup(row) {
    var tag = normalizeText(row.tag_name) || '未标记';
    var tone = tag.toUpperCase() === 'JIT' ? 'jit' : (tag.toUpperCase() === 'VMI' ? 'vmi' : 'other');
    return [
      '<div class="lw-order-row">',
      '<div class="lw-order-main">',
      '<strong>', escapeHtml(row.order_no || '(无订单号)'), '</strong>',
      '<span>', escapeHtml(row.shop_name || row.plat_name || ''), '</span>',
      '</div>',
      '<div class="lw-order-side">',
      '<span class="lw-tag" data-tone="', tone, '">', escapeHtml(tag), '</span>',
      '<small>', escapeHtml(row.express_name || '未改物流'), '</small>',
      '</div>',
      '</div>',
    ].join('');
  }

  function editTabMarkup(counts) {
    var sorted = state.editOrders.slice().sort(function (left, right) {
      return Number(isJitOrder(right)) - Number(isJitOrder(left));
    });
    var list = sorted.length
      ? '<div class="lw-order-list">' + sorted.map(editOrderMarkup).join('') + '</div>'
      : '<div class="lw-empty"><strong>当前没有待编辑订单</strong><span>可以切到待付款检查成分尺码</span></div>';
    return [
      '<section class="lw-action-band">',
      '<div><span class="lw-eyebrow">待编辑 JIT</span>',
      '<h2>', counts.jit, ' 单可推进</h2>',
      '<p>统一改为 TEMU 物流并进入待付款，VMI ', counts.vmi, ' 单自动跳过。</p></div>',
      '<button type="button" class="lw-primary-action" data-action="advance"',
      (!counts.jit || state.busyAction ? ' disabled' : ''), '>',
      state.busyAction === 'logistics' ? '正在处理...' : '一键推进待付款',
      '</button>',
      '</section>',
      operationMarkup(),
      '<div class="lw-section-title"><strong>待编辑明细</strong><span>', counts.edit, ' 单</span></div>',
      list,
    ].join('');
  }

  function imageStripMarkup(item) {
    var images = Array.isArray(item.imageItems) ? item.imageItems : [];
    if (!images.length) {
      return '<div class="lw-image-empty">无图链</div>';
    }
    return [
      '<div class="lw-image-strip">',
      images.map(function (image, index) {
        return [
          '<button type="button" class="lw-thumb" data-action="preview-image"',
          ' data-id="', escapeHtml(item.key), '" data-index="', String(index), '" title="全屏查看">',
          '<img src="', escapeHtml(image.thumbUrl || image.url), '" alt="', escapeHtml((item.sku || '') + ' 图片'), '" loading="lazy">',
          '<span>', String(index + 1), ' / ', String(images.length), '</span>',
          '</button>',
        ].join('');
      }).join(''),
      '</div>',
    ].join('');
  }

  function sizeItemMarkup(item) {
    var currentSize = normalizeText(item.currentSize) || '-';
    var suggestion = findSuggestion(item);
    var suggestedTarget = suggestion && suggestion.target_size ? suggestion.target_size : '';
    var note = state.itemStatus.get(item.key);
    var busy = state.busyItemIds.has(item.key) || Boolean(state.busyAction);
    var buttons = SIZE_TARGETS.map(function (target) {
      return [
        '<button type="button" data-action="change-size" data-id="', escapeHtml(item.key),
        '" data-target="', escapeHtml(target), '"',
        (busy || target === currentSize ? ' disabled' : ''),
        (target === suggestedTarget ? ' class="is-suggested"' : ''),
        '>', escapeHtml(target), target === suggestedTarget ? '<small>建议</small>' : '', '</button>',
      ].join('');
    }).join('');
    var suggestionMarkup = suggestion
      ? [
        '<div class="lw-suggestion">',
        '<strong>建议 ', escapeHtml(suggestedTarget || '无法识别'), '</strong>',
        '<span>', escapeHtml(suggestion.composition || '无成分说明'), ' · ', escapeHtml(suggestion.db_field || ''), ' 匹配</span>',
        '</div>',
      ].join('')
      : '<div class="lw-no-match">数据库暂无匹配，可手动选择</div>';
    return [
      '<article class="lw-size-item">',
      '<div class="lw-size-head">',
      '<div><strong>', escapeHtml(item.orderNo || '(无订单号)'), '</strong>',
      '<span>', escapeHtml(item.tagName || ''), ' · SKU ', escapeHtml(item.sku), '</span></div>',
      '<span class="lw-current-size" data-generic="', currentSize === '通用尺码' ? '1' : '0', '">',
      escapeHtml(currentSize), '</span>',
      '</div>',
      imageStripMarkup(item),
      suggestionMarkup,
      '<div class="lw-size-actions">', buttons, '</div>',
      note ? '<div class="lw-item-note" data-tone="' + escapeHtml(note.tone) + '">' + escapeHtml(note.text) + '</div>' : '',
      '</article>',
    ].join('');
  }

  function paymentTabMarkup(counts) {
    var list = state.items.length
      ? '<div class="lw-size-list">' + state.items.map(sizeItemMarkup).join('') + '</div>'
      : '<div class="lw-empty"><strong>暂无待付款 SKU</strong><span>先到“待编辑”把 JIT 推进来</span></div>';
    var alert = counts.generic
      ? '<div class="lw-warning"><strong>' + counts.generic + ' 个 SKU 仍是通用尺码</strong><span>付款前请确认已经改好</span></div>'
      : '';
    return [
      '<section class="lw-db-bar">',
      '<div><strong>', escapeHtml(state.dbStatus), '</strong>',
      '<span>已匹配 ', counts.matched, ' 个，待修改 ', counts.actionable, ' 个</span></div>',
      '<button type="button" class="lw-icon-button" data-action="update-db" title="更新成分数据库"',
      (state.loadingDb ? ' disabled' : ''), '>&#8635;</button>',
      '</section>',
      alert,
      '<section class="lw-action-band lw-payment-action">',
      '<div><span class="lw-eyebrow">成分尺码</span>',
      '<h2>', counts.payment, ' 单待付款</h2>',
      '<p>按云端成分库匹配，也可以逐个手动修改。</p></div>',
      '<button type="button" class="lw-primary-action" data-action="apply-suggestions"',
      (!counts.actionable || state.busyAction ? ' disabled' : ''), '>',
      state.busyAction === 'size-batch' ? '正在修改...' : '修改匹配项 (' + counts.actionable + ')',
      '</button>',
      '</section>',
      '<section class="lw-action-band lw-pay-band">',
      '<div><span class="lw-eyebrow">待付款 JIT</span>',
      '<h2>', counts.paymentJit, ' 单可支付</h2>',
      '<p>支付前会重新核对订单并执行预检，VMI 自动跳过。</p></div>',
      '<button type="button" class="lw-primary-action lw-pay-action" data-action="pay-jit"',
      (!counts.paymentJit || state.busyAction ? ' disabled' : ''), '>',
      state.busyAction === 'payment' ? '正在预检...' : '预检并支付 JIT',
      '</button>',
      '</section>',
      operationMarkup(),
      '<div class="lw-section-title"><strong>待付款明细</strong><span>', state.items.length, ' 个 SKU</span></div>',
      list,
    ].join('');
  }

  function closeImagePreview() {
    var preview = document.getElementById(IMAGE_PREVIEW_ID);
    if (preview) preview.remove();
  }

  function findItemByKey(key) {
    return state.items.find(function (item) {
      return String(item.key) === String(key);
    });
  }

  function openImagePreview(itemKey, imageIndex) {
    var item = findItemByKey(itemKey);
    var images = item && Array.isArray(item.imageItems) ? item.imageItems : [];
    var image = images[Number(imageIndex) || 0] || images[0];
    if (!item || !image) {
      showToast('这个 SKU 没有返回图片', 'warning');
      return;
    }
    closeImagePreview();
    var preview = document.createElement('div');
    preview.id = IMAGE_PREVIEW_ID;
    preview.innerHTML = [
      '<div class="lw-preview-backdrop" data-action="close-preview"></div>',
      '<section class="lw-preview-sheet" role="dialog" aria-modal="true">',
      '<header><div><strong>', escapeHtml(item.orderNo || '-'), '</strong>',
      '<span>SKU ', escapeHtml(item.sku || '-'), ' · 当前 ', escapeHtml(item.currentSize || '-'), '</span></div>',
      '<button type="button" data-action="close-preview" aria-label="关闭">×</button></header>',
      '<div class="lw-preview-frame">',
      '<img src="', escapeHtml(image.highUrl || image.url), '" alt="', escapeHtml((item.sku || '') + ' 高清图'), '">',
      '</div>',
      '<footer>图片来自领物接口，仅用于付款前核对款式。</footer>',
      '</section>',
    ].join('');
    document.body.appendChild(preview);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      'html.lw-workbench-open, body.lw-workbench-open { overflow: hidden !important; }',
      '#' + ROOT_ID + ' { position: fixed; inset: 0; z-index: 2147483646; overflow: hidden; color: #20242a; background: #f2f4f6; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; font-size: 14px; letter-spacing: 0; }',
      '#' + ROOT_ID + ' * { box-sizing: border-box; letter-spacing: 0; }',
      '#' + ROOT_ID + ' button { font: inherit; letter-spacing: 0; -webkit-tap-highlight-color: transparent; }',
      '#' + ROOT_ID + ' .lw-shell { height: 100%; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }',
      '#' + ROOT_ID + ' .lw-appbar { min-height: 70px; padding: calc(12px + env(safe-area-inset-top)) 16px 12px; display: flex; align-items: center; gap: 12px; color: #fff; background: #20242a; }',
      '#' + ROOT_ID + ' .lw-brand { flex: 1; min-width: 0; }',
      '#' + ROOT_ID + ' .lw-brand strong { display: block; font-size: 19px; line-height: 1.25; }',
      '#' + ROOT_ID + ' .lw-brand span { display: block; margin-top: 3px; color: #b9c0c9; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#' + ROOT_ID + ' .lw-icon-button { width: 42px; height: 42px; flex: 0 0 42px; border: 1px solid #d8dde3; border-radius: 6px; color: #343a42; background: #fff; font-size: 23px; line-height: 1; }',
      '#' + ROOT_ID + ' .lw-appbar .lw-icon-button { color: #fff; border-color: #555e69; background: #343a42; }',
      '#' + ROOT_ID + ' .lw-icon-button:disabled { opacity: .45; }',
      '#' + ROOT_ID + ' .lw-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #dfe3e8; background: #fff; }',
      '#' + ROOT_ID + ' .lw-metric { min-width: 0; padding: 12px 6px 10px; text-align: center; border-right: 1px solid #edf0f2; }',
      '#' + ROOT_ID + ' .lw-metric:last-child { border-right: 0; }',
      '#' + ROOT_ID + ' .lw-metric strong { display: block; color: #171a1f; font-size: 22px; line-height: 1; }',
      '#' + ROOT_ID + ' .lw-metric span { display: block; margin-top: 6px; color: #737b85; font-size: 11px; white-space: nowrap; }',
      '#' + ROOT_ID + ' .lw-tabs { display: grid; grid-template-columns: 1fr 1fr; padding: 8px 12px 0; gap: 6px; background: #fff; border-bottom: 1px solid #dfe3e8; }',
      '#' + ROOT_ID + ' .lw-tab { min-height: 46px; border: 0; border-bottom: 3px solid transparent; color: #6e7680; background: transparent; font-weight: 700; }',
      '#' + ROOT_ID + ' .lw-tab b { display: inline-block; min-width: 23px; margin-left: 6px; padding: 2px 6px; border-radius: 10px; color: #5b636d; background: #e9edf1; font-size: 12px; }',
      '#' + ROOT_ID + ' .lw-tab.is-active { color: #137044; border-bottom-color: #169b5b; }',
      '#' + ROOT_ID + ' .lw-tab.is-active b { color: #fff; background: #169b5b; }',
      '#' + ROOT_ID + ' .lw-main { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding-bottom: calc(18px + env(safe-area-inset-bottom)); }',
      '#' + ROOT_ID + ' .lw-status-line { min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 14px; color: #69717b; background: #e9edf0; font-size: 11px; }',
      '#' + ROOT_ID + ' .lw-status-line span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#' + ROOT_ID + ' .lw-action-band { display: grid; grid-template-columns: minmax(0, 1fr) minmax(132px, 42%); align-items: center; gap: 12px; padding: 18px 14px; background: #fff; border-bottom: 1px solid #dfe3e8; }',
      '#' + ROOT_ID + ' .lw-eyebrow { display: block; color: #747c86; font-size: 11px; font-weight: 700; }',
      '#' + ROOT_ID + ' .lw-action-band h2 { margin: 3px 0 4px; font-size: 22px; line-height: 1.25; }',
      '#' + ROOT_ID + ' .lw-action-band p { margin: 0; color: #727a84; font-size: 12px; line-height: 1.5; }',
      '#' + ROOT_ID + ' .lw-primary-action { width: 100%; min-width: 0; min-height: 52px; padding: 10px 12px; border: 0; border-radius: 6px; color: #fff; background: #168a50; font-weight: 800; white-space: normal; overflow-wrap: anywhere; box-shadow: 0 4px 12px rgba(12, 91, 52, .18); }',
      '#' + ROOT_ID + ' .lw-primary-action:active { background: #116d3f; }',
      '#' + ROOT_ID + ' .lw-primary-action:disabled { color: #8d959e; background: #dfe3e6; box-shadow: none; }',
      '#' + ROOT_ID + ' .lw-pay-band { border-top: 1px solid #dfe3e8; }',
      '#' + ROOT_ID + ' .lw-pay-action { background: #b42318; box-shadow: 0 4px 12px rgba(180, 35, 24, .18); }',
      '#' + ROOT_ID + ' .lw-pay-action:active { background: #8f1c13; }',
      '#' + ROOT_ID + ' .lw-pay-action:disabled { color: #8d959e; background: #dfe3e6; box-shadow: none; }',
      '#' + ROOT_ID + ' .lw-section-title { display: flex; align-items: center; justify-content: space-between; padding: 15px 14px 8px; color: #343a42; }',
      '#' + ROOT_ID + ' .lw-section-title span { color: #7b838d; font-size: 12px; }',
      '#' + ROOT_ID + ' .lw-order-list, #' + ROOT_ID + ' .lw-size-list { margin: 0 10px; background: #fff; border: 1px solid #dfe3e8; border-radius: 6px; overflow: hidden; }',
      '#' + ROOT_ID + ' .lw-order-row { min-height: 62px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid #edf0f2; }',
      '#' + ROOT_ID + ' .lw-order-row:last-child { border-bottom: 0; }',
      '#' + ROOT_ID + ' .lw-order-main { flex: 1; min-width: 0; }',
      '#' + ROOT_ID + ' .lw-order-main strong, #' + ROOT_ID + ' .lw-order-main span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#' + ROOT_ID + ' .lw-order-main strong { font-size: 13px; }',
      '#' + ROOT_ID + ' .lw-order-main span { margin-top: 5px; color: #7b838d; font-size: 11px; }',
      '#' + ROOT_ID + ' .lw-order-side { flex: 0 0 auto; text-align: right; }',
      '#' + ROOT_ID + ' .lw-order-side small { display: block; max-width: 120px; margin-top: 5px; color: #7b838d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#' + ROOT_ID + ' .lw-tag { display: inline-block; min-width: 38px; padding: 3px 7px; border-radius: 4px; text-align: center; font-size: 11px; font-weight: 800; }',
      '#' + ROOT_ID + ' .lw-tag[data-tone="jit"] { color: #0e6b3d; background: #d9f3e5; }',
      '#' + ROOT_ID + ' .lw-tag[data-tone="vmi"] { color: #88520b; background: #f8e8c8; }',
      '#' + ROOT_ID + ' .lw-tag[data-tone="other"] { color: #5c6470; background: #e9edf1; }',
      '#' + ROOT_ID + ' .lw-operation { margin: 10px 10px 0; padding: 12px; border: 1px solid #b8d7c6; border-radius: 6px; background: #edf8f2; }',
      '#' + ROOT_ID + ' .lw-operation[data-tone="error"] { border-color: #e5b6b6; background: #fff0f0; }',
      '#' + ROOT_ID + ' .lw-operation[data-tone="success"] { border-color: #a8d8bc; background: #e8f7ef; }',
      '#' + ROOT_ID + ' .lw-operation-head { display: flex; justify-content: space-between; gap: 10px; }',
      '#' + ROOT_ID + ' .lw-operation-head span { color: #68717b; font-size: 12px; }',
      '#' + ROOT_ID + ' .lw-progress { height: 5px; margin: 9px 0 7px; overflow: hidden; background: #d6dde2; border-radius: 3px; }',
      '#' + ROOT_ID + ' .lw-progress i { display: block; height: 100%; background: #168a50; transition: width .2s ease; }',
      '#' + ROOT_ID + ' .lw-operation[data-tone="error"] .lw-progress i { background: #c04444; }',
      '#' + ROOT_ID + ' .lw-operation-detail { color: #69717b; font-size: 12px; word-break: break-word; }',
      '#' + ROOT_ID + ' .lw-db-bar { display: flex; align-items: center; gap: 10px; padding: 11px 14px; background: #fff; border-bottom: 1px solid #dfe3e8; }',
      '#' + ROOT_ID + ' .lw-db-bar > div { flex: 1; min-width: 0; }',
      '#' + ROOT_ID + ' .lw-db-bar strong, #' + ROOT_ID + ' .lw-db-bar span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#' + ROOT_ID + ' .lw-db-bar strong { font-size: 12px; }',
      '#' + ROOT_ID + ' .lw-db-bar span { margin-top: 3px; color: #7b838d; font-size: 11px; }',
      '#' + ROOT_ID + ' .lw-db-bar .lw-icon-button { width: 36px; height: 36px; flex-basis: 36px; font-size: 20px; }',
      '#' + ROOT_ID + ' .lw-warning { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; color: #8a3b18; background: #fff0dc; border-bottom: 1px solid #efcfaa; }',
      '#' + ROOT_ID + ' .lw-warning strong { font-size: 12px; }',
      '#' + ROOT_ID + ' .lw-warning span { font-size: 11px; text-align: right; }',
      '#' + ROOT_ID + ' .lw-size-item { padding: 13px 12px; border-bottom: 1px solid #e7ebee; background: #fff; }',
      '#' + ROOT_ID + ' .lw-size-item:last-child { border-bottom: 0; }',
      '#' + ROOT_ID + ' .lw-size-head { display: flex; align-items: flex-start; gap: 8px; }',
      '#' + ROOT_ID + ' .lw-size-head > div { flex: 1; min-width: 0; }',
      '#' + ROOT_ID + ' .lw-size-head strong, #' + ROOT_ID + ' .lw-size-head span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#' + ROOT_ID + ' .lw-size-head span { margin-top: 4px; color: #7b838d; font-size: 11px; }',
      '#' + ROOT_ID + ' .lw-current-size { flex: 0 0 auto; max-width: 92px; padding: 5px 8px; color: #3e4751; background: #e9edf1; border-radius: 4px; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#' + ROOT_ID + ' .lw-current-size[data-generic="1"] { color: #a52828; background: #ffe0e0; }',
      '#' + ROOT_ID + ' .lw-image-strip { display: flex; gap: 10px; margin-top: 10px; overflow-x: auto; padding: 0 1px 5px; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; }',
      '#' + ROOT_ID + ' .lw-thumb { position: relative; flex: 0 0 calc(100% - 12px); width: calc(100% - 12px); height: 260px; padding: 0; overflow: hidden; border: 1px solid #d8dde3; border-radius: 6px; background: #f6f8fa; scroll-snap-align: start; }',
      '#' + ROOT_ID + ' .lw-thumb img { width: 100%; height: 100%; display: block; object-fit: contain; }',
      '#' + ROOT_ID + ' .lw-thumb span { position: absolute; right: 5px; bottom: 5px; padding: 2px 6px; color: #fff; background: rgba(22, 26, 31, .76); border-radius: 4px; font-size: 10px; font-weight: 800; }',
      '#' + ROOT_ID + ' .lw-image-empty { margin-top: 10px; padding: 10px; color: #8a3b18; background: #fff6e8; border: 1px dashed #e6bd88; border-radius: 6px; font-size: 12px; text-align: center; }',
      '#' + ROOT_ID + ' .lw-suggestion, #' + ROOT_ID + ' .lw-no-match { margin-top: 10px; padding: 8px 9px; border-left: 3px solid #168a50; background: #eef7f2; }',
      '#' + ROOT_ID + ' .lw-suggestion strong, #' + ROOT_ID + ' .lw-suggestion span { display: block; }',
      '#' + ROOT_ID + ' .lw-suggestion strong { color: #126d42; font-size: 12px; }',
      '#' + ROOT_ID + ' .lw-suggestion span { margin-top: 3px; color: #64706a; font-size: 11px; word-break: break-word; }',
      '#' + ROOT_ID + ' .lw-no-match { color: #747c86; border-left-color: #aeb5bd; background: #f2f4f6; font-size: 11px; }',
      '#' + ROOT_ID + ' .lw-size-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 10px; }',
      '#' + ROOT_ID + ' .lw-size-actions button { min-height: 43px; padding: 7px; border: 1px solid #d8dde3; border-radius: 5px; color: #343a42; background: #fff; font-weight: 700; }',
      '#' + ROOT_ID + ' .lw-size-actions button small { margin-left: 4px; color: #168a50; font-size: 9px; }',
      '#' + ROOT_ID + ' .lw-size-actions button.is-suggested { color: #126d42; border-color: #69b78f; background: #e8f6ee; }',
      '#' + ROOT_ID + ' .lw-size-actions button:disabled { opacity: .45; }',
      '#' + ROOT_ID + ' .lw-item-note { margin-top: 8px; color: #67717b; font-size: 11px; word-break: break-word; }',
      '#' + ROOT_ID + ' .lw-item-note[data-tone="success"] { color: #117044; }',
      '#' + ROOT_ID + ' .lw-item-note[data-tone="error"] { color: #b02d2d; }',
      '#' + ROOT_ID + ' .lw-empty { margin: 0 10px; padding: 42px 20px; text-align: center; color: #7b838d; background: #fff; border: 1px solid #dfe3e8; border-radius: 6px; }',
      '#' + ROOT_ID + ' .lw-empty strong, #' + ROOT_ID + ' .lw-empty span { display: block; }',
      '#' + ROOT_ID + ' .lw-empty strong { color: #444b54; }',
      '#' + ROOT_ID + ' .lw-empty span { margin-top: 7px; font-size: 12px; }',
      '#' + ROOT_ID + ' .lw-toast { position: fixed; left: 14px; right: 14px; bottom: calc(14px + env(safe-area-inset-bottom)); z-index: 3; padding: 12px 14px; color: #fff; background: #343a42; border-radius: 6px; box-shadow: 0 8px 26px rgba(0,0,0,.22); text-align: center; font-weight: 700; }',
      '#' + ROOT_ID + ' .lw-toast[data-tone="success"] { background: #126d42; }',
      '#' + ROOT_ID + ' .lw-toast[data-tone="warning"] { background: #9a5915; }',
      '#' + ROOT_ID + ' .lw-toast[data-tone="error"] { background: #a72d2d; }',
      '#' + CONFIRM_ID + ' { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: flex-end; padding: 16px 14px calc(16px + env(safe-area-inset-bottom)); background: rgba(22, 26, 31, .56); font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }',
      '#' + CONFIRM_ID + ' * { box-sizing: border-box; letter-spacing: 0; }',
      '#' + CONFIRM_ID + ' .lw-confirm-box { width: 100%; max-width: 520px; margin: 0 auto; padding: 18px; color: #20242a; background: #fff; border-radius: 8px; box-shadow: 0 18px 48px rgba(0,0,0,.28); }',
      '#' + CONFIRM_ID + ' .lw-confirm-title { font-size: 19px; font-weight: 800; }',
      '#' + CONFIRM_ID + ' .lw-confirm-message { margin-top: 10px; color: #626b75; line-height: 1.7; white-space: pre-line; }',
      '#' + CONFIRM_ID + ' .lw-confirm-actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 9px; margin-top: 18px; }',
      '#' + CONFIRM_ID + ' button { min-height: 48px; border: 1px solid #d5dae0; border-radius: 6px; color: #424952; background: #fff; font: 700 14px "Microsoft YaHei", "PingFang SC", sans-serif; }',
      '#' + CONFIRM_ID + ' .lw-confirm-primary { color: #fff; border-color: #168a50; background: #168a50; }',
      '#' + IMAGE_PREVIEW_ID + ' { position: fixed; inset: 0; z-index: 2147483647; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }',
      '#' + IMAGE_PREVIEW_ID + ' * { box-sizing: border-box; letter-spacing: 0; }',
      '#' + IMAGE_PREVIEW_ID + ' .lw-preview-backdrop { position: absolute; inset: 0; background: rgba(9, 12, 16, .82); }',
      '#' + IMAGE_PREVIEW_ID + ' .lw-preview-sheet { position: absolute; inset: calc(12px + env(safe-area-inset-top)) 10px calc(12px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; overflow: hidden; color: #f6f8fa; }',
      '#' + IMAGE_PREVIEW_ID + ' header { min-height: 54px; display: flex; align-items: center; gap: 10px; padding: 0 2px 10px; }',
      '#' + IMAGE_PREVIEW_ID + ' header div { flex: 1; min-width: 0; }',
      '#' + IMAGE_PREVIEW_ID + ' header strong, #' + IMAGE_PREVIEW_ID + ' header span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#' + IMAGE_PREVIEW_ID + ' header span { margin-top: 4px; color: #c5ccd4; font-size: 12px; }',
      '#' + IMAGE_PREVIEW_ID + ' header button { width: 44px; height: 44px; flex: 0 0 44px; border: 1px solid rgba(255,255,255,.34); border-radius: 6px; color: #fff; background: rgba(255,255,255,.12); font-size: 28px; line-height: 1; }',
      '#' + IMAGE_PREVIEW_ID + ' .lw-preview-frame { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 6px; background: #11161c; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; }',
      '#' + IMAGE_PREVIEW_ID + ' .lw-preview-frame img { max-width: 100%; max-height: 100%; object-fit: contain; background: #fff; border-radius: 4px; }',
      '#' + IMAGE_PREVIEW_ID + ' footer { padding-top: 10px; color: #c5ccd4; font-size: 12px; text-align: center; }',
      '@media (min-width: 720px) { #' + ROOT_ID + ' .lw-shell { max-width: 640px; margin: 0 auto; border-left: 1px solid #d8dde3; border-right: 1px solid #d8dde3; } #' + ROOT_ID + ' { background: #dfe3e6; } }',
      '@media (max-width: 370px) { #' + ROOT_ID + ' .lw-action-band { grid-template-columns: 1fr; } #' + ROOT_ID + ' .lw-primary-action { width: 100%; } #' + ROOT_ID + ' .lw-metric strong { font-size: 19px; } }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureViewport() {
    var viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
    }
    viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
  }

  function render(resetScroll) {
    if (!state.authReady) return;
    ensureViewport();
    injectStyle();
    document.documentElement.classList.add('lw-workbench-open');
    document.body.classList.add('lw-workbench-open');
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    var previousMain = root.querySelector('.lw-main');
    var scrollTop = previousMain && !resetScroll ? previousMain.scrollTop : 0;
    var counts = getCounts();
    var auth = readAuth();
    var content = state.activeTab === 'edit' ? editTabMarkup(counts) : paymentTabMarkup(counts);
    root.innerHTML = [
      '<div class="lw-shell">',
      '<header class="lw-appbar">',
      '<div class="lw-brand"><strong>领物做单器</strong>',
      '<span>', escapeHtml(auth.username || ('工厂 ' + auth.factoryId)), ' · v', SCRIPT_VERSION, '</span></div>',
      '<button type="button" class="lw-icon-button" data-action="refresh" title="刷新订单"',
      (state.loadingOrders || state.busyAction ? ' disabled' : ''), '>&#8635;</button>',
      '</header>',
      '<section class="lw-summary">',
      '<div class="lw-metric"><strong>', counts.edit, '</strong><span>待编辑</span></div>',
      '<div class="lw-metric"><strong>', counts.jit, '</strong><span>JIT</span></div>',
      '<div class="lw-metric"><strong>', counts.vmi, '</strong><span>VMI</span></div>',
      '<div class="lw-metric"><strong>', counts.payment, '</strong><span>待付款</span></div>',
      '</section>',
      '<nav class="lw-tabs">',
      '<button type="button" class="lw-tab', state.activeTab === 'edit' ? ' is-active' : '', '" data-action="tab" data-tab="edit">待编辑<b>', counts.edit, '</b></button>',
      '<button type="button" class="lw-tab', state.activeTab === 'payment' ? ' is-active' : '', '" data-action="tab" data-tab="payment">待付款<b>', counts.payment, '</b></button>',
      '</nav>',
      '<div class="lw-status-line"><span>', escapeHtml(state.orderStatus), '</span><span>', escapeHtml(state.lastRefreshText), '</span></div>',
      '<main class="lw-main">', content, '</main>',
      state.toast ? '<div class="lw-toast" data-tone="' + escapeHtml(state.toast.tone) + '">' + escapeHtml(state.toast.message) + '</div>' : '',
      '</div>',
    ].join('');
    var nextMain = root.querySelector('.lw-main');
    if (nextMain) nextMain.scrollTop = scrollTop;
  }

  function unmount() {
    var root = document.getElementById(ROOT_ID);
    if (root) root.remove();
    closeImagePreview();
    document.documentElement.classList.remove('lw-workbench-open');
    if (document.body) document.body.classList.remove('lw-workbench-open');
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var previewTarget = event.target.closest('#' + IMAGE_PREVIEW_ID + ' [data-action]');
      if (previewTarget) {
        if (previewTarget.dataset.action === 'close-preview') closeImagePreview();
        return;
      }
      var target = event.target.closest('#' + ROOT_ID + ' [data-action]');
      if (!target) return;
      var action = target.dataset.action;
      if (action === 'refresh') {
        refreshOrders();
      } else if (action === 'tab') {
        state.activeTab = target.dataset.tab || 'edit';
        state.operation = null;
        render(true);
      } else if (action === 'advance') {
        advanceAllJitOrders();
      } else if (action === 'update-db') {
        loadCompositionDb(true);
      } else if (action === 'apply-suggestions') {
        applyAllSuggestions();
      } else if (action === 'pay-jit') {
        payAllJitOrders();
      } else if (action === 'preview-image') {
        openImagePreview(target.dataset.id, target.dataset.index);
      } else if (action === 'change-size') {
        handleChangeSize(target.dataset.id, target.dataset.target);
      }
    });
  }

  function checkAuth() {
    var auth = readAuth();
    var ready = Boolean(auth.token && auth.factoryId);
    if (ready && !state.authReady) {
      state.authReady = true;
      render(true);
      refreshAll();
    } else if (!ready && state.authReady) {
      state.authReady = false;
      unmount();
    }
  }

  function start() {
    bindEvents();
    checkAuth();
    authTimer = window.setInterval(checkAuth, 1200);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkAuth();
    });
    window.__LANDWU_MOBILE_WORKBENCH__ = {
      version: SCRIPT_VERSION,
      state: state,
      refresh: refreshAll,
    };
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
