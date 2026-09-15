export function loginPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>API Router - 登录</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
<div class="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
  <h1 class="text-2xl font-bold text-center mb-6">API Router</h1>
  <form id="loginForm" class="space-y-4">
    <div>
      <label class="block text-sm text-gray-600 mb-1">密码</label>
      <input id="pass" type="password" class="w-full border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="输入管理密码" autofocus>
    </div>
    <div id="err" class="text-red-500 text-sm hidden"></div>
    <button type="submit" class="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition">登录</button>
  </form>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = document.getElementById('pass').value;
  const errEl = document.getElementById('err');
  errEl.classList.add('hidden');
  try {
    const r = await fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    const data = await r.json();
    if (data.success) {
      window.location.reload();
    } else {
      errEl.textContent = data.error || '登录失败';
      errEl.classList.remove('hidden');
    }
  } catch (err) {
    errEl.textContent = '网络错误';
    errEl.classList.remove('hidden');
  }
});
</script>
</body>
</html>`;
}

export function adminPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>API Router</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  .tab-active { border-bottom: 2px solid #2563eb; color: #2563eb; font-weight: 600; }
  .modal-bg { background: rgba(0,0,0,.4); }
  pre { white-space: pre-wrap; word-break: break-all; }
  input, textarea, select { font-size: 14px; }
</style>
</head>
<body class="bg-gray-50 text-gray-800 min-h-screen">
<div class="max-w-6xl mx-auto px-4 py-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold">API Router</h1>
    <div class="flex items-center gap-4">
      <span id="statsBar" class="text-sm text-gray-500"></span>
      <button onclick="logout()" class="text-sm text-gray-400 hover:text-red-500">退出</button>
    </div>
  </div>
  <div class="border-b mb-4 flex gap-6 text-sm">
    <button class="tab pb-2 tab-active" data-tab="dashboard">主页</button>
    <button class="tab pb-2" data-tab="channels">渠道</button>
    <button class="tab pb-2" data-tab="models">模型</button>
    <button class="tab pb-2" data-tab="tokens">令牌</button>
    <button class="tab pb-2" data-tab="routing">路由测试</button>
    <button class="tab pb-2" data-tab="logs">日志</button>
  </div>
  <div id="content"></div>
</div>

<!-- Modal -->
<div id="modal" class="fixed inset-0 modal-bg hidden items-center justify-center z-50" onclick="if(event.target===this)closeModal()">
  <div class="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
    <div class="p-6" id="modalBody"></div>
  </div>
</div>

<script>
const H = { 'Content-Type': 'application/json' };
const api = (path, opts = {}) => fetch('/admin/api' + path, { headers: H, credentials: 'same-origin', ...opts }).then(r => {
  if (r.status === 401) { window.location.reload(); throw new Error('session expired'); }
  return r.json();
});

let currentTab = 'dashboard';

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('tab-active'));
    btn.classList.add('tab-active');
    currentTab = btn.dataset.tab;
    render();
  });
});

function $(id) { return document.getElementById(id); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function ts(epoch) { return epoch ? new Date(epoch * 1000).toLocaleString('zh-CN') : '-'; }

function showModal(html) { $('modalBody').innerHTML = html; $('modal').classList.remove('hidden'); $('modal').classList.add('flex'); }
function closeModal() { $('modal').classList.add('hidden'); $('modal').classList.remove('flex'); }

window.logout = async () => {
  await fetch('/admin/api/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.reload();
};

async function loadStats() {
  const r = await api('/stats');
  if (r.success) {
    const d = r.data;
    $('statsBar').textContent = d.channels + ' 渠道 · ' + d.models + ' 模型 · ' + d.tokens + ' 令牌 · ' + d.requests + ' 请求 · ' + d.cooldowns + ' 冷却中';
  }
}

// ─── Channels ───
async function renderChannels() {
  const r = await api('/channels');
  const rows = r.data || [];
  let html = '<div class="flex justify-between items-center mb-4"><h2 class="text-lg font-semibold">渠道管理</h2>'
    + '<button onclick="showChannelForm()" class="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">+ 添加渠道</button></div>';
  html += '<div class="bg-white rounded-lg shadow overflow-hidden"><table class="w-full text-sm">'
    + '<thead class="bg-gray-50"><tr><th class="p-3 text-left">ID</th><th class="p-3 text-left">名称</th><th class="p-3 text-left">前缀</th><th class="p-3 text-left">计费</th><th class="p-3 text-left">地址</th><th class="p-3 text-left">模型数</th><th class="p-3 text-left">优先级</th><th class="p-3 text-left">状态</th><th class="p-3 text-left">操作</th></tr></thead><tbody>';
  for (const ch of rows) {
    const mc = (ch.models || '').split(',').filter(Boolean).length;
    const st = ch.status === 1 ? '<span class="text-green-600">启用</span>' : '<span class="text-red-500">停用</span>';
    const fm = ch.free_models || '';
    const free = fm === '*' ? '<span class="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">全免费</span>'
      : fm ? '<span class="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700" title="' + esc(fm) + '">部分免费</span>'
      : '<span class="px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700">付费</span>';
    html += '<tr class="border-t"><td class="p-3">' + ch.id + '</td><td class="p-3 font-medium">' + esc(ch.name)
      + '</td><td class="p-3 font-mono text-xs text-purple-600">' + esc(ch.prefix || '')
      + '</td><td class="p-3">' + free
      + '</td><td class="p-3 text-gray-500 text-xs">' + esc(ch.base_url)
      + '</td><td class="p-3">' + mc + '</td><td class="p-3">' + ch.priority
      + '</td><td class="p-3">' + st
      + '</td><td class="p-3 space-x-2">'
      + '<button onclick="editChannel(' + ch.id + ')" class="text-blue-600 hover:underline text-xs">编辑</button>'
      + '<button onclick="testChannel(' + ch.id + ')" class="text-green-600 hover:underline text-xs">测试</button>'
      + '<button onclick="syncChannel(' + ch.id + ')" class="text-purple-600 hover:underline text-xs">同步模型</button>'
      + '<button onclick="checkBalance(' + ch.id + ')" class="text-teal-600 hover:underline text-xs">余额</button>'
      + '<button onclick="toggleChannel(' + ch.id + ',' + ch.status + ')" class="text-orange-600 hover:underline text-xs">' + (ch.status === 1 ? '停用' : '启用') + '</button>'
      + '<button onclick="deleteChannel(' + ch.id + ')" class="text-red-500 hover:underline text-xs">删除</button>'
      + '</td></tr>';
  }
  html += '</tbody></table></div>';
  $('content').innerHTML = html;
}

function channelFormHtml(ch) {
  const c = ch || { name: '', prefix: '', base_url: '', api_key: '', models: '', free_models: '', balance_url: '', balance_field: '', balance_unit: '', priority: 0 };
  const title = ch ? '编辑渠道 #' + ch.id : '添加渠道';
  return '<h3 class="text-lg font-semibold mb-4">' + title + '</h3>'
    + '<div class="space-y-3">'
    + '<div class="flex gap-3"><div class="flex-1"><label class="block text-sm text-gray-600 mb-1">名称</label><input id="f_name" class="w-full border rounded px-3 py-2" value="' + esc(c.name) + '"></div>'
    + '<div class="w-32"><label class="block text-sm text-gray-600 mb-1">前缀（自动生成）</label><input id="f_prefix" class="w-full border rounded px-3 py-2 font-mono" value="' + esc(c.prefix || '') + '" placeholder="自动"></div></div>'
    + '<div><label class="block text-sm text-gray-600 mb-1">免费模型规则 <span class="text-gray-400 font-normal">（* = 全免费，留空 = 无免费，逗号分隔关键词 = 匹配的模型免费）</span></label><input id="f_free_models" class="w-full border rounded px-3 py-2 font-mono text-xs" value="' + esc(c.free_models || '') + '" placeholder="例: Qwen/,deepseek-ai/,THUDM/,meta-llama/"></div>'
    + '<div><label class="block text-sm text-gray-600 mb-1">Base URL</label><input id="f_base_url" class="w-full border rounded px-3 py-2" value="' + esc(c.base_url) + '" placeholder="https://api.example.com/v1"></div>'
    + '<div><label class="block text-sm text-gray-600 mb-1">API Key（多个用换行分隔）</label><textarea id="f_api_key" class="w-full border rounded px-3 py-2 h-20 font-mono text-xs">' + esc(c.api_key || '') + '</textarea></div>'
    + '<div><label class="block text-sm text-gray-600 mb-1">模型列表（逗号分隔，或添加后点同步自动拉取）</label><textarea id="f_models" class="w-full border rounded px-3 py-2 h-20 font-mono text-xs">' + esc(c.models || '') + '</textarea></div>'
    + '<details class="border rounded p-3"><summary class="text-sm font-medium text-gray-700 cursor-pointer">余额监控配置 <span class="text-gray-400 font-normal">（主流渠道自动识别，留空即可）</span></summary>'
    + '<div class="mt-3 space-y-2">'
    + '<p class="text-xs text-gray-400">SiliconFlow / DeepSeek / OpenRouter 自动识别，无需手动填写。其他渠道如需监控余额，请填写以下配置。</p>'
    + '<div class="grid grid-cols-3 gap-2">'
    + '<div><label class="block text-xs text-gray-500 mb-1">余额接口路径</label><input id="f_balance_url" class="w-full border rounded px-2 py-1.5 font-mono text-xs" value="' + esc(c.balance_url || '') + '" placeholder="/v1/user/info"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">余额字段路径</label><input id="f_balance_field" class="w-full border rounded px-2 py-1.5 font-mono text-xs" value="' + esc(c.balance_field || '') + '" placeholder="data.balance"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">单位</label><input id="f_balance_unit" class="w-full border rounded px-2 py-1.5 text-xs" value="' + esc(c.balance_unit || '') + '" placeholder="元"></div>'
    + '</div></div></details>'
    + '<div><label class="block text-sm text-gray-600 mb-1">优先级</label><input id="f_priority" type="number" class="w-full border rounded px-3 py-2" value="' + (c.priority || 0) + '"></div>'
    + '<div class="flex gap-3 pt-2">'
    + '<button onclick="saveChannel(' + (ch ? ch.id : 'null') + ')" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">保存</button>'
    + '<button onclick="closeModal()" class="border px-4 py-2 rounded">取消</button>'
    + '</div></div>';
}

window.showChannelForm = () => showModal(channelFormHtml());
window.editChannel = async (id) => {
  const r = await api('/channels');
  const ch = (r.data || []).find(c => c.id === id);
  if (ch) showModal(channelFormHtml(ch));
};
window.saveChannel = async (id) => {
  const data = { name: $('f_name').value, prefix: $('f_prefix').value, base_url: $('f_base_url').value, api_key: $('f_api_key').value, models: $('f_models').value, free_models: $('f_free_models').value.trim(), balance_url: $('f_balance_url').value.trim(), balance_field: $('f_balance_field').value.trim(), balance_unit: $('f_balance_unit').value.trim(), priority: Number($('f_priority').value) };
  if (id) await api('/channels/' + id, { method: 'PUT', body: JSON.stringify(data) });
  else await api('/channels', { method: 'POST', body: JSON.stringify(data) });
  closeModal(); render();
};
window.deleteChannel = async (id) => { if (confirm('确认删除渠道 #' + id + '？')) { await api('/channels/' + id, { method: 'DELETE' }); render(); } };
window.toggleChannel = async (id, st) => { await api('/channels/' + id, { method: 'PUT', body: JSON.stringify({ status: st === 1 ? 2 : 1 }) }); render(); };
window.testChannel = async (id) => {
  showModal('<p class="text-gray-500">测试中...</p>');
  const r = await api('/channels/' + id + '/test', { method: 'POST' });
  showModal('<h3 class="font-semibold mb-2">测试结果</h3><p class="mb-2">' + (r.success ? '<span class="text-green-600">连接成功</span>' : '<span class="text-red-500">连接失败</span>') + ' (HTTP ' + (r.status || 'N/A') + ')</p><pre class="bg-gray-50 p-3 rounded text-xs max-h-64 overflow-auto">' + esc(r.body || r.error || '') + '</pre>');
};
window.syncChannel = async (id) => {
  showModal('<p class="text-gray-500">同步模型列表中...</p>');
  const r = await api('/channels/' + id + '/sync-models', { method: 'POST' });
  showModal('<h3 class="font-semibold mb-2">同步结果</h3><p>' + (r.success ? '成功拉取 ' + r.models_count + ' 个模型' : '失败: ' + esc(r.error || '')) + '</p>');
  if (r.success) setTimeout(render, 500);
};

// ─── Models (category routing view) ───
let modelsStrategy = 'smart';
async function renderModels() {
  const r = await api('/routing/overview?strategy=' + modelsStrategy);
  const strategies = r.strategies || {};
  const items = r.data || [];
  const total = r.total_models || 0;
  const chMap = r.channelMap || {};

  let html = '<div class="flex justify-between items-center mb-4"><h2 class="text-lg font-semibold">智能路由 <span class="text-sm font-normal text-gray-400">(' + total + ' 模型)</span></h2>'
    + '<button onclick="syncAllChannels()" id="syncAllBtn" class="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700">刷新全部渠道模型</button></div>';

  // strategy tabs
  html += '<div class="flex flex-wrap gap-2 mb-4">';
  for (const [k, label] of Object.entries(strategies)) {
    const active = k === modelsStrategy;
    html += '<button onclick="switchStrategy(\\'' + k + '\\')" class="px-4 py-1.5 rounded-full text-sm border transition '
      + (active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400') + '">' + esc(label) + '</button>';
  }
  html += '</div>';

  // category list - expandable
  html += '<div class="space-y-2">';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const badge = item.isFree
      ? '<span class="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">免费</span>'
      : '<span class="px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700">付费</span>';
    const modelName = item.selected ? esc(item.selected) : '<span class="text-gray-400">无可用模型</span>';
    const chLabel = item.selected && chMap[item.selected] ? '<span class="text-xs text-purple-500 font-mono">[' + esc(chMap[item.selected]) + ']</span>' : '';
    html += '<div class="bg-white rounded-lg shadow-sm border overflow-hidden">'
      + '<div class="p-4 flex items-center justify-between cursor-pointer select-none" onclick="toggleCat(' + i + ')">'
      + '<div class="flex items-center gap-3 flex-wrap">'
      + '<span class="font-medium text-gray-700 w-28">' + esc(item.label) + '</span>'
      + '<span class="font-mono text-sm text-blue-700">' + modelName + '</span>'
      + ' ' + chLabel + ' ' + badge
      + '</div>'
      + '<div class="flex items-center gap-3"><span class="text-sm text-gray-400">备选 ' + item.poolSize + ' 个</span><span class="text-gray-400 cat-arrow" id="arrow_' + i + '">▶</span></div>'
      + '</div>';
    // expandable top models
    html += '<div id="cat_' + i + '" class="hidden border-t bg-gray-50 px-4 py-2">';
    const tops = item.topModels || [];
    if (tops.length > 0) {
      html += '<div class="grid gap-1">';
      for (let j = 0; j < tops.length; j++) {
        const tm = tops[j];
        const isFirst = j === 0;
        const fb = tm.isFree ? '<span class="px-1 py-0.5 rounded text-xs bg-green-100 text-green-700">免费</span>' : '<span class="px-1 py-0.5 rounded text-xs bg-orange-100 text-orange-700">付费</span>';
        const tmCh = chMap[tm.model] ? '<span class="text-purple-500 font-mono">[' + esc(chMap[tm.model]) + ']</span>' : '';
        html += '<div class="flex items-center gap-2 py-1 text-sm ' + (isFirst ? 'font-semibold text-blue-700' : 'text-gray-600') + '">'
          + '<span class="w-6 text-right text-xs text-gray-400">' + (j+1) + '</span>'
          + '<span class="font-mono text-xs">' + esc(tm.model) + '</span>'
          + ' ' + tmCh + ' ' + fb
          + '</div>';
      }
      if (item.poolSize > tops.length) {
        html += '<div class="text-xs text-gray-400 py-1 pl-8">...还有 ' + (item.poolSize - tops.length) + ' 个备选模型</div>';
      }
      html += '</div>';
    } else {
      html += '<p class="text-sm text-gray-400">此分类无可用模型</p>';
    }
    html += '</div></div>';
  }
  html += '</div>';

  // full model list with channel prefixes
  const mr = await api('/routing/models');
  const abilities = mr.abilities || [];
  const byModel = {};
  for (const a of abilities) {
    if (!byModel[a.model]) byModel[a.model] = [];
    byModel[a.model].push(a);
  }
  const allModels = Object.keys(byModel).sort();
  html += '<div class="mt-6"><div class="flex justify-between items-center mb-3"><h3 class="text-base font-semibold">全部模型 (' + allModels.length + ')</h3>'
    + '<input id="modelSearch" class="border rounded px-3 py-1.5 text-sm w-64" placeholder="搜索模型..." oninput="filterModels()"></div>';
  html += '<div id="modelList" class="bg-white rounded-lg shadow overflow-hidden max-h-96 overflow-y-auto"><table class="w-full text-xs">'
    + '<thead class="bg-gray-50 sticky top-0"><tr><th class="p-2 text-left">模型名</th><th class="p-2 text-left">渠道别名</th><th class="p-2 text-left">渠道</th></tr></thead><tbody>';
  for (const m of allModels) {
    const channels = byModel[m];
    const aliases = channels.filter(a => a.channel_prefix).map(a => '<span class="inline-block px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-mono mr-1 mb-0.5' + (a.channel_status !== 1 ? ' opacity-50 line-through' : '') + '">' + esc(a.channel_prefix + ':' + m) + '</span>');
    const chNames = channels.map(a => '<span class="' + (a.channel_status !== 1 ? 'text-red-400 line-through' : 'text-gray-600') + '">' + esc(a.channel_name) + '</span>').join(', ');
    html += '<tr class="border-t model-row"><td class="p-2 font-mono">' + esc(m) + '</td><td class="p-2">' + (aliases.length ? aliases.join('') : '-') + '</td><td class="p-2">' + chNames + '</td></tr>';
  }
  html += '</tbody></table></div></div>';
  $('content').innerHTML = html;
}

window.toggleCat = (i) => {
  const el = $('cat_' + i);
  const arrow = $('arrow_' + i);
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    arrow.textContent = '▼';
  } else {
    el.classList.add('hidden');
    arrow.textContent = '▶';
  }
};
window.filterModels = () => {
  const q = ($('modelSearch') || {}).value?.toLowerCase() || '';
  document.querySelectorAll('.model-row').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
};
window.switchStrategy = (s) => { modelsStrategy = s; renderModels(); };
window.syncAllChannels = async () => {
  const btn = $('syncAllBtn');
  btn.textContent = '同步中...'; btn.disabled = true;
  const r = await api('/sync-all', { method: 'POST' });
  btn.textContent = '刷新全部渠道模型'; btn.disabled = false;
  if (r.success) {
    alert('同步完成：成功 ' + r.synced + ' 个，失败 ' + r.failed + ' 个');
    render();
  }
};

window.refreshAllBalances = async () => {
  const btn = $('balRefreshBtn');
  if (btn) { btn.textContent = '刷新中...'; btn.disabled = true; }
  await api('/check-all-balances', { method: 'POST' });
  if (btn) { btn.textContent = '刷新全部'; btn.disabled = false; }
  render();
};
window.checkBalance = async (id) => {
  const r = await api('/channels/' + id + '/check-balance', { method: 'POST' });
  if (r.success) alert(r.balance + ' ' + r.unit);
  else alert(r.error || '查询失败');
};

// ─── Tokens ───
const STRATEGY_MAP = { smart: '智能自动', free: '免费', price: '价格优先', speed: '速度优先', success: '成功率优先' };
let tokenCache = [];
async function renderTokens() {
  const r = await api('/tokens');
  const rows = r.data || [];
  tokenCache = rows;
  let html = '<div class="flex justify-between items-center mb-4"><h2 class="text-lg font-semibold">令牌管理</h2>'
    + '<button onclick="showTokenForm()" class="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">+ 创建令牌</button></div>';
  html += '<div class="bg-white rounded-lg shadow overflow-hidden"><table class="w-full text-sm">'
    + '<thead class="bg-gray-50"><tr><th class="p-3 text-left">ID</th><th class="p-3 text-left">名称</th><th class="p-3 text-left">Key</th><th class="p-3 text-left">策略</th><th class="p-3 text-left">固定模型</th><th class="p-3 text-left">限制渠道</th><th class="p-3 text-left">限制模型</th><th class="p-3 text-left">备注</th><th class="p-3 text-left">状态</th><th class="p-3">操作</th></tr></thead><tbody>';
  for (const t of rows) {
    const keyDisplay = esc(t.key.slice(0, 16) + '...');
    const fullKey = esc(t.key);
    const stLabel = STRATEGY_MAP[t.strategy] || t.strategy || '智能自动';
    const pinned = t.pinned_model ? '<span class="font-mono text-xs text-purple-600">' + esc(t.pinned_model) + '</span>' : '<span class="text-gray-400">-</span>';
    const st = t.status === 1 ? '<span class="text-green-600">启用</span>' : '<span class="text-red-500">停用</span>';
    html += '<tr class="border-t"><td class="p-3">' + t.id + '</td><td class="p-3">' + esc(t.name)
      + '</td><td class="p-3 font-mono text-xs cursor-pointer" title="点击复制" onclick="navigator.clipboard.writeText(\\''+fullKey+'\\');this.textContent=\\'已复制!\\';setTimeout(()=>this.textContent=\\''+keyDisplay+'\\',1000)">' + keyDisplay + '</td>'
      + '<td class="p-3 text-xs">' + esc(stLabel) + '</td>'
      + '<td class="p-3">' + pinned + '</td>'
      + '<td class="p-3 text-xs font-mono text-purple-600">' + (t.channels || '<span class="text-gray-400 font-sans">全部</span>') + '</td>'
      + '<td class="p-3 text-xs">' + (t.models || '<span class="text-gray-400">全部</span>') + '</td>'
      + '<td class="p-3 text-xs text-gray-500 max-w-[200px] truncate" title="' + esc(t.remark || '') + '">' + esc(t.remark || '-') + '</td>'
      + '<td class="p-3">' + st + '</td>'
      + '<td class="p-3 space-x-2">'
      + '<button onclick="editToken(' + t.id + ')" class="text-blue-600 hover:underline text-xs">编辑</button>'
      + '<button onclick="toggleToken(' + t.id + ',' + t.status + ')" class="text-orange-600 hover:underline text-xs">' + (t.status === 1 ? '停用' : '启用') + '</button>'
      + '<button onclick="deleteToken(' + t.id + ')" class="text-red-500 hover:underline text-xs">删除</button>'
      + '</td></tr>';
  }
  html += '</tbody></table></div>';
  $('content').innerHTML = html;
}

function tokenFormHtml(t) {
  const isEdit = !!t;
  const title = isEdit ? '编辑令牌 #' + t.id : '创建令牌';
  const name = t ? t.name : '';
  const models = t ? (t.models || '') : '';
  const strategy = t ? (t.strategy || 'smart') : 'smart';
  const pinned = t ? (t.pinned_model || '') : '';
  const channels = t ? (t.channels || '') : '';
  const remark = t ? (t.remark || '') : '';
  let strategyOpts = '';
  for (const [k, label] of Object.entries(STRATEGY_MAP)) {
    strategyOpts += '<option value="' + k + '"' + (k === strategy ? ' selected' : '') + '>' + label + '</option>';
  }
  return '<h3 class="text-lg font-semibold mb-4">' + title + '</h3>'
    + '<div class="space-y-3">'
    + '<div><label class="block text-sm text-gray-600 mb-1">名称</label><input id="t_name" class="w-full border rounded px-3 py-2" value="' + esc(name) + '" placeholder="用途说明"></div>'
    + '<div><label class="block text-sm text-gray-600 mb-1">路由策略</label><select id="t_strategy" class="w-full border rounded px-3 py-2">' + strategyOpts + '</select></div>'
    + '<div><label class="block text-sm text-gray-600 mb-1">固定模型（留空=按策略自动路由）</label><input id="t_pinned" class="w-full border rounded px-3 py-2 font-mono text-xs" value="' + esc(pinned) + '" placeholder="例如: deepseek-chat"></div>'
    + '<div><label class="block text-sm text-gray-600 mb-1">限制渠道 <span class="text-gray-400 font-normal">（逗号分隔渠道前缀，留空=全部渠道）</span></label><input id="t_channels" class="w-full border rounded px-3 py-2 font-mono text-xs" value="' + esc(channels) + '" placeholder="例如: or,sf（只走 OpenRouter 和 SiliconFlow）"></div>'
    + '<div><label class="block text-sm text-gray-600 mb-1">限制模型（逗号分隔，留空=全部）</label><input id="t_models" class="w-full border rounded px-3 py-2" value="' + esc(models) + '"></div>'
    + '<div><label class="block text-sm text-gray-600 mb-1">备注</label><input id="t_remark" class="w-full border rounded px-3 py-2" value="' + esc(remark) + '" placeholder="用途说明、分配对象等"></div>'
    + '<div class="flex gap-3 pt-2">'
    + '<button onclick="saveToken(' + (isEdit ? t.id : 'null') + ')" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">' + (isEdit ? '保存' : '创建') + '</button>'
    + '<button onclick="closeModal()" class="border px-4 py-2 rounded">取消</button></div></div>';
}

window.showTokenForm = () => showModal(tokenFormHtml());
window.editToken = (id) => {
  const t = tokenCache.find(x => x.id === id);
  if (t) showModal(tokenFormHtml(t));
};
window.saveToken = async (id) => {
  const data = { name: $('t_name').value, models: $('t_models').value, strategy: $('t_strategy').value, pinned_model: $('t_pinned').value, channels: $('t_channels').value.trim(), remark: $('t_remark').value };
  if (id) {
    await api('/tokens/' + id, { method: 'PUT', body: JSON.stringify(data) });
    closeModal(); render();
  } else {
    const r = await api('/tokens', { method: 'POST', body: JSON.stringify(data) });
    if (r.success) {
      showModal('<h3 class="font-semibold mb-2">令牌已创建</h3><p class="text-sm text-gray-600 mb-2">请立即复制，关闭后无法再次查看完整 Key：</p><input class="w-full border rounded px-3 py-2 font-mono text-xs" value="' + esc(r.key) + '" readonly onclick="this.select()">');
      setTimeout(() => { if (currentTab === 'tokens') renderTokens(); }, 300);
    }
  }
};
window.toggleToken = async (id, st) => { await api('/tokens/' + id, { method: 'PUT', body: JSON.stringify({ status: st === 1 ? 2 : 1 }) }); render(); };
window.deleteToken = async (id) => { if (confirm('确认删除令牌 #' + id + '？')) { await api('/tokens/' + id, { method: 'DELETE' }); render(); } };

// ─── Routing Test ───
let rtChannels = [], rtStrategies = {};
async function renderRouting() {
  const [chR, ovR] = await Promise.all([api('/channels'), api('/routing/overview?strategy=smart')]);
  rtChannels = (chR.data || []).filter(c => c.status === 1);
  rtStrategies = ovR.strategies || {};

  let stratOpts = '<option value="">全部策略</option>';
  for (const [k, label] of Object.entries(rtStrategies)) {
    stratOpts += '<option value="' + k + '">' + label + '</option>';
  }
  let chOpts = '';
  for (const ch of rtChannels) {
    chOpts += '<label class="inline-flex items-center gap-1 mr-3 text-sm"><input type="checkbox" class="rt-ch-box" value="' + esc(ch.prefix) + '"><span class="font-mono text-purple-600">[' + esc(ch.prefix) + ']</span> ' + esc(ch.name) + '</label>';
  }

  let html = '<h2 class="text-lg font-semibold mb-4">路由测试</h2>'
    + '<div class="bg-white rounded-lg shadow p-5 space-y-4">'
    + '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">'
    + '<div><label class="block text-sm font-medium text-gray-700 mb-1">路由策略</label><select id="rt_strategy" class="w-full border rounded px-3 py-2">' + stratOpts + '</select></div>'
    + '<div><label class="block text-sm font-medium text-gray-700 mb-1">指定模型 <span class="text-gray-400 font-normal">（留空=自动路由）</span></label><input id="rt_model" class="w-full border rounded px-3 py-2 font-mono text-xs" placeholder="例: deepseek-chat 或 or:google/gemma-3n-e4b-it:free"></div>'
    + '</div>'
    + '<div><label class="block text-sm font-medium text-gray-700 mb-1">限制渠道 <span class="text-gray-400 font-normal">（不勾=不限制）</span></label><div class="flex flex-wrap gap-y-2 mt-1">' + chOpts + '</div></div>'
    + '<div><label class="block text-sm font-medium text-gray-700 mb-1">消息内容 <span class="text-gray-400 font-normal">（自动路由时用于分类）</span></label><textarea id="rt_msg" class="w-full border rounded px-3 py-2 h-24" placeholder="输入测试消息..."></textarea></div>'
    + '<button onclick="testRoute()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm">测试路由</button>'
    + '<div id="rt_result"></div></div>';
  $('content').innerHTML = html;
}

window.testRoute = async () => {
  const msg = $('rt_msg').value;
  const strategy = $('rt_strategy').value || 'smart';
  const model = $('rt_model').value.trim();
  const checkedCh = Array.from(document.querySelectorAll('.rt-ch-box:checked')).map(el => el.value);
  const channels = checkedCh.length ? checkedCh.join(',') : '';

  const payload = { messages: [{ role: 'user', content: msg }], strategy, channels: channels || undefined, model: model || undefined };
  $('rt_result').innerHTML = '<p class="text-gray-400 text-sm">测试中...</p>';
  const r = await api('/routing/test', { method: 'POST', body: JSON.stringify(payload) });
  if (!r.success) { $('rt_result').innerHTML = '<p class="text-red-500 text-sm">测试失败</p>'; return; }

  const catLabel = r.category && r.category !== '-' ? (rtStrategies._cats || {})[r.category] || r.category : '(指定模型)';
  const stLabel = rtStrategies[r.strategy] || r.strategy;
  const freeBadge = r.selectedIsFree
    ? '<span class="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">免费</span>'
    : '<span class="px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700">付费</span>';
  const chInfo = r.channel
    ? '<span class="font-mono text-purple-600">[' + esc(r.channel.prefix) + ']</span> ' + esc(r.channel.name) + ' <span class="text-gray-400">#' + r.channel.id + '</span>'
    : '<span class="text-red-500">无可用渠道</span>';

  let html = '<div class="mt-2 rounded-lg border overflow-hidden">'
    + '<div class="bg-blue-50 p-4 space-y-2">'
    + '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">'
    + '<div><span class="text-gray-500">策略</span><div class="font-medium">' + esc(stLabel) + '</div></div>'
    + '<div><span class="text-gray-500">分类</span><div class="font-medium">' + esc(catLabel) + '</div></div>'
    + '<div><span class="text-gray-500">渠道限制</span><div class="font-medium">' + (r.channels.length ? r.channels.map(c => '<span class="font-mono text-purple-600">' + esc(c) + '</span>').join(', ') : '无') + '</div></div>'
    + '<div><span class="text-gray-500">候选池</span><div class="font-medium">' + r.pool_size + ' 个模型</div></div>'
    + '</div>'
    + '<div class="border-t border-blue-200 pt-3 mt-2">'
    + '<div class="flex items-center gap-2 flex-wrap"><span class="text-gray-500 text-sm">选中:</span><span class="font-mono text-blue-700 font-semibold">' + esc(r.selected || '无') + '</span> ' + (r.selected ? freeBadge : '') + '</div>'
    + '<div class="flex items-center gap-2 flex-wrap mt-1"><span class="text-gray-500 text-sm">渠道:</span>' + chInfo + '</div>'
    + '</div></div>';

  if (r.ranked && r.ranked.length > 0) {
    html += '<div class="p-4"><p class="text-sm font-medium text-gray-700 mb-2">候选排名 (Top ' + r.ranked.length + ')</p>'
      + '<div class="grid gap-1">';
    for (let i = 0; i < r.ranked.length; i++) {
      const m = r.ranked[i];
      const isFirst = i === 0;
      const fb = m.isFree ? '<span class="px-1 py-0.5 rounded text-xs bg-green-100 text-green-700">免费</span>' : '<span class="px-1 py-0.5 rounded text-xs bg-orange-100 text-orange-700">付费</span>';
      html += '<div class="flex items-center gap-2 py-1 text-sm ' + (isFirst ? 'font-semibold text-blue-700' : 'text-gray-600') + '">'
        + '<span class="w-6 text-right text-xs text-gray-400">' + (i+1) + '</span>'
        + '<span class="font-mono text-xs">' + esc(m.model) + '</span> ' + fb
        + '</div>';
    }
    html += '</div></div>';
  }
  html += '</div>';
  $('rt_result').innerHTML = html;
};

// ─── Logs ───
async function renderLogs() {
  const r = await api('/logs?limit=100');
  const rows = r.data || [];
  let html = '<div class="flex justify-between items-center mb-4"><h2 class="text-lg font-semibold">请求日志</h2>'
    + '<button onclick="clearLogs()" class="text-red-500 hover:underline text-sm">清空日志</button></div>';
  html += '<div class="bg-white rounded-lg shadow overflow-x-auto"><table class="w-full text-xs">'
    + '<thead class="bg-gray-50"><tr><th class="p-2 text-left">时间</th><th class="p-2 text-left">令牌</th><th class="p-2 text-left">路径</th><th class="p-2 text-left">请求模型</th><th class="p-2 text-left">实际模型</th><th class="p-2 text-left">渠道</th><th class="p-2 text-left">状态</th><th class="p-2 text-left">延迟</th><th class="p-2 text-left">错误</th></tr></thead><tbody>';
  for (const l of rows) {
    const sc = l.status_code;
    const cls = sc >= 500 ? 'text-red-600' : sc >= 400 ? 'text-orange-500' : 'text-green-600';
    html += '<tr class="border-t"><td class="p-2 whitespace-nowrap">' + ts(l.created_at)
      + '</td><td class="p-2">' + esc(l.token_name || '')
      + '</td><td class="p-2 font-mono">' + esc((l.path || '').replace('/v1/', ''))
      + '</td><td class="p-2 font-mono">' + esc(l.model_asked || 'auto')
      + '</td><td class="p-2 font-mono">' + esc(l.model_used || '')
      + '</td><td class="p-2">' + esc(l.channel_name || '')
      + '</td><td class="p-2 ' + cls + '">' + sc
      + '</td><td class="p-2">' + (l.latency_ms || 0) + 'ms'
      + '</td><td class="p-2 text-red-500 max-w-xs truncate" title="' + esc(l.error || '') + '">' + esc((l.error || '').slice(0, 80))
      + '</td></tr>';
  }
  html += '</tbody></table></div>';
  $('content').innerHTML = html;
}
window.clearLogs = async () => { if (confirm('清空所有日志？')) { await api('/logs', { method: 'DELETE' }); render(); } };

// ─── Dashboard ───
async function renderDashboard() {
  $('content').innerHTML = '<p class="text-gray-400 text-sm">加载中...</p>';
  const r = await api('/dashboard');
  if (!r.success) { $('content').innerHTML = '<p class="text-red-500">加载失败</p>'; return; }
  const s = r.stats;
  const syncInfo = r.lastSync ? '上次同步: ' + (r.lastSync.time || '').replace('T',' ').slice(0,19) + ' (成功 ' + r.lastSync.synced + ' / 失败 ' + r.lastSync.failed + ')' : '尚未同步';

  let html = '<div class="space-y-6">';

  // stat cards
  html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-4">';
  const cards = [
    { label: '活跃渠道', val: s.channels, color: 'blue', icon: '🔗' },
    { label: '可用模型', val: s.models, color: 'purple', icon: '🤖' },
    { label: '活跃令牌', val: s.tokens, color: 'green', icon: '🔑' },
    { label: '总请求', val: s.totalReqs, color: 'gray', icon: '📊' },
    { label: '今日请求', val: s.todayReqs, color: 'blue', icon: '📈' },
    { label: '今日错误', val: s.errorsToday, color: s.errorsToday > 0 ? 'red' : 'green', icon: '⚠️' },
    { label: '平均延迟(24h)', val: s.avgLatency + 'ms', color: 'orange', icon: '⏱️' },
    { label: '冷却中', val: s.cooldowns, color: s.cooldowns > 0 ? 'orange' : 'green', icon: '❄️' },
  ];
  for (const c of cards) {
    html += '<div class="bg-white rounded-lg shadow-sm border p-4">'
      + '<div class="text-xs text-gray-500 mb-1">' + c.icon + ' ' + c.label + '</div>'
      + '<div class="text-2xl font-bold text-' + c.color + '-600">' + c.val + '</div></div>';
  }
  html += '</div>';

  // sync info
  html += '<div class="text-xs text-gray-400">' + esc(syncInfo) + '</div>';

  // channel balances
  const bals = r.balances || {};
  const chList = r.channelList || [];
  const hasBal = chList.some(c => bals[c.id]);
  if (hasBal) {
    html += '<div class="bg-white rounded-lg shadow-sm border p-4">'
      + '<div class="flex justify-between items-center mb-3"><h3 class="text-sm font-semibold text-gray-700">渠道余额</h3>'
      + '<button onclick="refreshAllBalances()" id="balRefreshBtn" class="text-xs text-blue-600 hover:underline">刷新全部</button></div>'
      + '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">';
    for (const ch of chList) {
      const b = bals[ch.id];
      if (!b) continue;
      const val = parseFloat(b.balance);
      const isLow = !isNaN(val) && val < 1;
      const color = isLow ? 'red' : val < 10 ? 'orange' : 'green';
      const timeAgo = b.checked_at ? b.checked_at.replace('T',' ').slice(5,16) : '';
      html += '<div class="p-3 rounded-lg border ' + (isLow ? 'border-red-300 bg-red-50' : 'border-gray-200') + '">'
        + '<div class="text-xs text-gray-500 flex items-center gap-1"><span class="font-mono text-purple-600">[' + esc(ch.prefix) + ']</span> ' + esc(ch.name) + '</div>'
        + '<div class="text-xl font-bold text-' + color + '-600 mt-1">' + esc(b.balance) + ' <span class="text-sm font-normal">' + esc(b.unit) + '</span></div>'
        + (isLow ? '<div class="text-xs text-red-500 mt-0.5">⚠ 余额不足</div>' : '')
        + '<div class="text-xs text-gray-400 mt-0.5">' + timeAgo + '</div>'
        + '</div>';
    }
    html += '</div></div>';
  }

  // 24h hourly chart (simple bar)
  const hourly = r.hourly || [];
  if (hourly.length > 0) {
    const maxCnt = Math.max(...hourly.map(h => h.cnt), 1);
    html += '<div class="bg-white rounded-lg shadow-sm border p-4">'
      + '<h3 class="text-sm font-semibold text-gray-700 mb-3">24小时请求趋势</h3>'
      + '<div class="flex items-end gap-1 h-24">';
    for (let i = 0; i < 24; i++) {
      const item = hourly.find(h => h.h === i);
      const cnt = item ? item.cnt : 0;
      const errs = item ? item.errs : 0;
      const pct = Math.max((cnt / maxCnt) * 100, 2);
      const errPct = cnt > 0 ? Math.max((errs / maxCnt) * 100, 0) : 0;
      const title = (i) + 'h前: ' + cnt + '请求' + (errs ? ', ' + errs + '错误' : '');
      html += '<div class="flex-1 flex flex-col justify-end" title="' + title + '">';
      if (errPct > 0) html += '<div class="bg-red-400 rounded-t" style="height:' + errPct + '%"></div>';
      html += '<div class="bg-blue-400 ' + (errPct > 0 ? '' : 'rounded-t') + ' rounded-b" style="height:' + (pct - errPct) + '%"></div>';
      html += '</div>';
    }
    html += '</div><div class="flex justify-between text-xs text-gray-400 mt-1"><span>24h前</span><span>现在</span></div></div>';
  }

  // two-column layout: top models + channel stats
  html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';

  // top models
  html += '<div class="bg-white rounded-lg shadow-sm border p-4">'
    + '<h3 class="text-sm font-semibold text-gray-700 mb-3">热门模型 (24h)</h3>';
  const tm = r.topModels || [];
  if (tm.length > 0) {
    html += '<div class="space-y-2">';
    for (const m of tm) {
      const rate = m.cnt > 0 ? Math.round(m.ok / m.cnt * 100) : 0;
      const barW = Math.max(Math.round(m.cnt / (tm[0].cnt || 1) * 100), 5);
      html += '<div>'
        + '<div class="flex justify-between text-xs mb-0.5"><span class="font-mono text-gray-700 truncate max-w-[200px]" title="' + esc(m.model) + '">' + esc(m.model) + '</span>'
        + '<span class="text-gray-500 whitespace-nowrap ml-2">' + m.cnt + '次 · ' + Math.round(m.avg_ms) + 'ms · ' + rate + '%</span></div>'
        + '<div class="w-full bg-gray-100 rounded-full h-1.5"><div class="h-1.5 rounded-full ' + (rate >= 90 ? 'bg-blue-500' : rate >= 70 ? 'bg-orange-400' : 'bg-red-400') + '" style="width:' + barW + '%"></div></div></div>';
    }
    html += '</div>';
  } else {
    html += '<p class="text-sm text-gray-400">暂无数据</p>';
  }
  html += '</div>';

  // channel stats
  html += '<div class="bg-white rounded-lg shadow-sm border p-4">'
    + '<h3 class="text-sm font-semibold text-gray-700 mb-3">渠道使用情况 (24h)</h3>';
  const cs = r.channelStats || [];
  if (cs.length > 0) {
    html += '<div class="space-y-2">';
    for (const c of cs) {
      const rate = c.cnt > 0 ? Math.round(c.ok / c.cnt * 100) : 0;
      const barW = Math.max(Math.round(c.cnt / (cs[0].cnt || 1) * 100), 5);
      html += '<div>'
        + '<div class="flex justify-between text-xs mb-0.5"><span class="font-medium text-gray-700">' + esc(c.channel_name) + '</span>'
        + '<span class="text-gray-500">' + c.cnt + '次 · ' + Math.round(c.avg_ms) + 'ms · 成功率 ' + rate + '%</span></div>'
        + '<div class="w-full bg-gray-100 rounded-full h-1.5"><div class="h-1.5 rounded-full ' + (rate >= 90 ? 'bg-green-500' : rate >= 70 ? 'bg-orange-400' : 'bg-red-400') + '" style="width:' + barW + '%"></div></div></div>';
    }
    html += '</div>';
  } else {
    html += '<p class="text-sm text-gray-400">暂无数据</p>';
  }
  html += '</div>';

  html += '</div>'; // end two-column

  // token activity
  const tt = r.topTokens || [];
  if (tt.length > 0) {
    html += '<div class="bg-white rounded-lg shadow-sm border p-4">'
      + '<h3 class="text-sm font-semibold text-gray-700 mb-3">令牌活动 (24h)</h3>'
      + '<div class="grid grid-cols-2 md:grid-cols-5 gap-3">';
    for (const t of tt) {
      const rate = t.cnt > 0 ? Math.round(t.ok / t.cnt * 100) : 0;
      html += '<div class="text-center p-2 rounded border">'
        + '<div class="text-sm font-medium">' + esc(t.token_name) + '</div>'
        + '<div class="text-lg font-bold text-blue-600">' + t.cnt + '</div>'
        + '<div class="text-xs text-gray-500">成功率 ' + rate + '%</div></div>';
    }
    html += '</div></div>';
  }

  // recent activity
  const logs = r.recentLogs || [];
  if (logs.length > 0) {
    html += '<div class="bg-white rounded-lg shadow-sm border p-4">'
      + '<h3 class="text-sm font-semibold text-gray-700 mb-3">最近请求</h3>'
      + '<div class="space-y-1">';
    for (const l of logs) {
      const sc = l.status_code || 0;
      const scCls = sc >= 500 ? 'text-red-600' : sc >= 400 ? 'text-orange-500' : 'text-green-600';
      const time = ts(l.created_at);
      html += '<div class="flex items-center gap-3 text-xs py-1.5 border-b border-gray-50">'
        + '<span class="text-gray-400 w-36 shrink-0">' + time + '</span>'
        + '<span class="font-medium w-16 shrink-0">' + esc(l.token_name || '-') + '</span>'
        + '<span class="font-mono text-blue-700 truncate max-w-[200px]" title="' + esc(l.model_used || '') + '">' + esc(l.model_used || 'auto') + '</span>'
        + '<span class="text-gray-500">→</span>'
        + '<span class="text-purple-600">' + esc(l.channel_name || '-') + '</span>'
        + '<span class="' + scCls + ' font-medium">' + sc + '</span>'
        + '<span class="text-gray-400">' + (l.latency_ms || 0) + 'ms</span>'
        + (l.error ? '<span class="text-red-400 truncate max-w-[150px]" title="' + esc(l.error) + '">' + esc(l.error.slice(0,40)) + '</span>' : '')
        + '</div>';
    }
    html += '</div></div>';
  }

  html += '</div>';
  $('content').innerHTML = html;
}

// ─── Render ───
async function render() {
  loadStats();
  if (currentTab === 'dashboard') renderDashboard();
  else if (currentTab === 'channels') renderChannels();
  else if (currentTab === 'models') renderModels();
  else if (currentTab === 'tokens') renderTokens();
  else if (currentTab === 'routing') renderRouting();
  else if (currentTab === 'logs') renderLogs();
}

render();
</script>
</body>
</html>`;
}
