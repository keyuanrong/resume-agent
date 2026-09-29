const state = { config: null, resumes: [], questions: [], strategy: null, localDirections: [], uploadQueue: [], uploading: false, activeResumeId: null, agentProvider: 'bailian' };
const $ = (id) => document.getElementById(id);
const agentProviderNames = {bailian:'阿里云百炼', deepseek:'DeepSeek'};
let agentModelTimer;
let agentModelRequest = 0;

function showModelOptions(models, selected = '') {
  const list = $('agentModel'); list.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = '请选择模型'; list.appendChild(placeholder);
  models.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name || item.id; list.appendChild(option); });
  list.value = models.some(item => item.id === selected) ? selected : '';
  list.disabled = models.length === 0;
}

function selectAgentProvider(provider) {
  clearTimeout(agentModelTimer);
  agentModelRequest += 1;
  state.agentProvider = provider;
  document.querySelectorAll('[data-agent-provider]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.agentProvider === provider));
  });
  $('agentApiKey').value = '';
  showModelOptions([]);
  $('agentModelHint').textContent = `当前服务商：${agentProviderNames[provider]}。输入 API Key 后会自动查询模型。`;
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body?.detail || body || `请求失败：${response.status}`);
  return body;
}

function toast(message, error = false) {
  const el = $('toast'); el.textContent = message; el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function lines(value) { return Array.isArray(value) ? value.join('\n') : (value || ''); }
function weightedLines(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value).map(([keyword, score]) => `${keyword}:${score}`).join('\n');
}
function parseWeightedLines(value) {
  const result = {};
  String(value || '').split(/\n|,|，/).map(item => item.trim()).filter(Boolean).forEach(item => {
    const match = item.match(/^(.*?)[：:]\s*(\d{1,3})$/);
    if (!match) return;
    const keyword = match[1].trim(); const score = Math.max(0, Math.min(100, Number(match[2])));
    if (keyword) result[keyword] = score;
  });
  return result;
}
function strategySummary(s) {
  if (!s) return '尚未生成策略';
  return [
    `搜索关键词：${(s.searchKeywords || []).join('、') || '未设置'}`,
    `目标岗位：${(s.targetRoles || []).join('、') || '未设置'}`,
    `优先技能：${(s.preferredSkills || []).join('、') || '未设置'}`,
    `标题词库：${Object.keys(s.scoring?.title_strong_keywords || {}).length} 个`,
    `JD词库：${Object.keys(s.scoring?.detail_infra_keywords || {}).length} 个`,
    `自动排除：${(s.excludedKeywords || []).join('、') || '无'}`,
    `城市：${(s.cities || []).join('、') || '不限'}`,
    `匹配阈值：${s.threshold ?? 80}`,
    `投递方式：${{screen_only:'只筛选',review:'审核后发送',auto:'自动发送'}[s.deliveryMode] || '审核后发送'}`,
    `简历方式：${{platform_resume:'平台已有简历',after_reply:'回复后发送',pdf:'优先 PDF',image:'优先图片'}[s.resumeDelivery] || '平台已有简历'}`,
    `招呼语：${s.greeting || '未设置'}`,
  ].join('\n');
}

function renderAgentEditor(s) {
  if (!s) return;
  $('agentEditKeywords').value = lines(s.searchKeywords);
  $('agentEditExcluded').value = lines(s.excludedKeywords);
  $('agentEditCompanies').value = lines(s.companyBlockKeywords);
  $('agentEditThreshold').value = s.threshold ?? 80;
  $('agentEditDailyLimit').value = s.dailyLimit || 30;
  $('agentEditGreeting').value = s.greeting || '';
  $('agentEditDeliveryMode').value = s.deliveryMode || 'review';
  $('agentEditResumeDelivery').value = s.resumeDelivery || 'platform_resume';
}

function renderMode() {
  const enabled = $('agentToggle').checked;
  $('manualForm').classList.toggle('hidden', enabled);
  $('agentPanel').classList.toggle('hidden', !enabled);
  $('agentIdentity').classList.toggle('hidden', !enabled);
  $('strategyTitle').textContent = enabled ? 'Agent 辅助模式' : '手动规则模式';
  $('modeDescription').textContent = enabled
    ? 'Agent 负责分析简历、生成策略和判断边界岗位；硬规则仍然拥有最高优先级。'
    : '完全使用本地规则，不调用模型，也不会把简历发送给第三方。';
}

function renderConfig() {
  const c = state.config; const s = c.strategy || {}; const a = c.agent || {};
  selectAgentProvider(a.provider === 'deepseek' ? 'deepseek' : 'bailian');
  $('agentToggle').checked = c.mode === 'agent' && !!a.enabled;
  $('executionMode').value = c.executionMode || 'test';
  $('executionModeHint').textContent = (c.executionMode || 'test') === 'test'
    ? '测试模式会运行完整流程，但在发送前强制停止。'
    : '正式模式允许已完成适配的平台执行真实动作，请谨慎使用。';
  if (a.hasApiKey && a.model) showModelOptions([{id:a.model, name:a.model}], a.model);
  $('providerLabel').textContent = a.providerName || '阿里云百炼';
  $('modelLabel').textContent = a.hasApiKey && a.model ? a.model : '待选择';
  $('keyLabel').textContent = a.hasApiKey ? '已配置' : '未配置';
  $('manualKeywords').value = lines(s.searchKeywords);
  $('manualExcluded').value = lines(s.excludedKeywords);
  $('manualSkills').value = lines(s.preferredSkills);
  $('manualTitlePositive').value = weightedLines(s.scoring?.title_strong_keywords);
  $('manualDetailPositive').value = weightedLines(s.scoring?.detail_infra_keywords);
  $('manualTitlePenalty').value = weightedLines(s.scoring?.title_penalty_keywords);
  $('manualDetailNegative').value = weightedLines(s.scoring?.detail_negative_keywords);
  $('manualCompanies').value = lines(s.companyBlockKeywords);
  $('manualGreeting').value = s.greeting || '';
  $('manualThreshold').value = s.threshold ?? 80; $('thresholdOutput').textContent = s.threshold ?? 80;
  $('manualDailyLimit').value = s.dailyLimit || 30;
  $('manualCities').value = lines(s.cities);
  $('manualJobType').value = s.jobType || '';
  $('manualMinimumSalary').value = s.minimumSalary || '';
  $('manualDeliveryMode').value = s.deliveryMode || 'review';
  $('manualResumeDelivery').value = s.resumeDelivery || 'platform_resume';
  $('strategyStatus').textContent = s.confirmed ? '已确认' : '未确认';
  $('strategyStatus').className = `pill ${s.confirmed ? 'success' : 'warning'}`;
  renderMode();
}

async function loadDashboard() {
  const d = await api('/api/dashboard');
  ['Scanned','Recommended','Greeted','Review','Blocked','Failed'].forEach(key => {
    $(`metric${key}`).textContent = d[key.toLowerCase()] || 0;
  });
}

async function loadPlatforms() {
  const platforms = await api('/api/platforms'); const box = $('platformList'); box.innerHTML = '';
  platforms.forEach(p => {
    const item = document.createElement('div'); item.className = 'platform-item';
    const head = document.createElement('div'); head.className = 'platform-head';
    const name = document.createElement('strong'); name.textContent = p.name;
    const status = document.createElement('span'); status.className = `pill ${p.implemented ? 'success' : 'muted'}`;
    status.innerHTML = `<i class="status-dot ${p.status}"></i>${p.implemented ? '已接入' : '待校准'}`;
    const control = document.createElement('label'); control.className = 'platform-enable';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !!p.enabled;
    const controlText = document.createElement('span'); controlText.textContent = p.enabled ? '已启用' : '未启用';
    control.append(checkbox, controlText); head.append(name, status, control);
    const note = document.createElement('p'); note.textContent = p.note;
    item.append(head, note);
    checkbox.addEventListener('change', async () => {
      const enabled = checkbox.checked;
      checkbox.disabled = true;
      try {
        state.config = await api('/api/product-config', {
          method:'PUT', body:JSON.stringify({platforms:{[p.id]:{enabled}}}),
        });
        controlText.textContent = enabled ? '已启用' : '未启用';
        toast(`${p.name}已${enabled ? '启用' : '关闭'}`);
      } catch (error) {
        checkbox.checked = !enabled;
        toast(error.message || '平台设置保存失败');
      } finally {
        checkbox.disabled = false;
      }
    });
    box.appendChild(item);
  });
}

function renderResumes() {
  const list = $('resumeList'); const select = $('resumeSelect'); const manualSelect = $('manualResumeSelect'); const localSelect = $('localResumeSelect');
  list.innerHTML = ''; select.innerHTML = '<option value="">请选择简历</option>'; manualSelect.innerHTML = '<option value="">暂不指定</option>'; localSelect.innerHTML = '<option value="">请选择已上传简历</option>';
  if (!state.resumes.length) list.innerHTML = '<p class="empty">还没有上传简历</p>';
  state.resumes.forEach(r => {
    const item = document.createElement('div'); item.className = `resume-item${state.activeResumeId === r.id ? ' selected' : ''}`; item.dataset.resumeId = r.id;
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'activeResume'; radio.className = 'resume-select-dot'; radio.checked = state.activeResumeId === r.id;
    const meta = document.createElement('div'); meta.className = 'resume-meta';
    const name = document.createElement('strong'); name.textContent = r.name;
    const detail = document.createElement('p'); detail.textContent = `${(r.size / 1024).toFixed(1)} KB · ${r.createdAt}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'resume-remove'; remove.textContent = '移除'; remove.setAttribute('aria-label', `移除 ${r.name}`);
    meta.append(name, detail); item.append(radio, meta, remove); list.appendChild(item);
    const choose = () => selectResume(r.id);
    item.addEventListener('click', event => { if (!event.target.closest('.resume-remove')) choose(); });
    remove.addEventListener('click', async event => { event.stopPropagation(); await removeResume(r); });
    const option = document.createElement('option'); option.value = r.id; option.textContent = r.name; select.appendChild(option);
    manualSelect.appendChild(option.cloneNode(true));
    localSelect.appendChild(option.cloneNode(true));
  });
  const selected = state.activeResumeId || state.config?.strategy?.resumeId;
  if (selected) { select.value = selected; manualSelect.value = selected; localSelect.value = selected; }
}

function selectResume(resumeId) {
  state.activeResumeId = resumeId;
  ['resumeSelect','manualResumeSelect','localResumeSelect'].forEach(id => { if ($(id)) $(id).value = resumeId || ''; });
  document.querySelectorAll('.resume-item').forEach(item => {
    const selected = item.dataset.resumeId === resumeId; item.classList.toggle('selected', selected);
    const radio = item.querySelector('.resume-select-dot'); if (radio) radio.checked = selected;
  });
  const strategyResumeId = state.config?.strategy?.resumeId;
  if (resumeId && strategyResumeId && resumeId !== strategyResumeId) {
    const current = state.resumes.find(item => item.id === resumeId);
    const box = $('localStrategyResult'); box.classList.remove('hidden');
    box.textContent = `已选择“${current?.name || '新简历'}”。当前页面中的策略来自另一份简历，请先点击“本地分析并生成”，选择目标方向后再保存。`;
    $('localDirectionControls').classList.add('hidden');
  }
}

async function removeResume(record) {
  if (!window.confirm(`确定移除“${record.name}”吗？`)) return;
  try {
    await api(`/api/resumes/${encodeURIComponent(record.id)}`, {method:'DELETE'});
    if (state.activeResumeId === record.id) state.activeResumeId = null;
    [state.config, state.resumes] = await Promise.all([api('/api/product-config'), api('/api/resumes')]);
    renderConfig(); renderResumes(); toast('已移除这份简历');
  } catch (e) { toast(e.message, true); }
}

async function loadAll() {
  [state.config, state.resumes] = await Promise.all([api('/api/product-config'), api('/api/resumes')]);
  state.activeResumeId = state.config?.strategy?.resumeId || state.resumes.at(-1)?.id || null;
  renderConfig(); renderResumes(); await Promise.all([loadDashboard(), loadPlatforms()]);
}

async function applyLocalGenerationResult(result) {
  state.localDirections = result.candidateDirections || [];
  if (result.draftStrategy) {
    state.config = await api('/api/product-config');
    renderConfig(); renderResumes();
  }
  const directionControls = $('localDirectionControls'); const directionSelect = $('localDirectionSelect');
  directionSelect.innerHTML = '';
  state.localDirections.forEach(direction => {
    const option = document.createElement('option'); option.value = direction.id;
    option.textContent = `${direction.name}（依据：${(direction.evidence || []).slice(0, 4).join('、') || '模板匹配'}）`;
    directionSelect.appendChild(option);
  });
  if (result.selectedDirectionId || result.recommendedDirectionId) directionSelect.value = result.selectedDirectionId || result.recommendedDirectionId;
  directionControls.classList.toggle('hidden', !state.localDirections.length);
  const box = $('localStrategyResult'); box.classList.remove('hidden');
  const candidates = state.localDirections.map(direction => `• ${direction.name}：${(direction.evidence || []).join('、') || '模板匹配'}`).join('\n');
  const strategyText = result.draftStrategy ? `\n\n${strategySummary(result.draftStrategy)}` : '';
  box.textContent = `${result.profile?.summary || '本地分析完成'}\n\n${candidates}${strategyText}\n\n${(result.warnings || []).join('\n')}`;
}

$('thresholdOutput').textContent = $('manualThreshold').value;
$('manualThreshold').addEventListener('input', e => $('thresholdOutput').textContent = e.target.value);
$('agentToggle').addEventListener('change', async () => {
  const enabled = $('agentToggle').checked;
  state.config = await api('/api/product-config', { method:'PUT', body:JSON.stringify({ mode:enabled?'agent':'manual', agent:{enabled} }) });
  renderConfig(); toast(enabled ? 'Agent 模式已开启，请配置密钥并分析简历' : '已切换到手动规则模式');
});

$('executionMode').addEventListener('change', async () => {
  const executionMode = $('executionMode').value;
  state.config = await api('/api/product-config', {method:'PUT', body:JSON.stringify({executionMode})});
  renderConfig(); toast(executionMode === 'test' ? '已切换到测试模式，所有发送动作都会被拦截' : '已切换到正式模式');
});

$('manualForm').addEventListener('submit', async e => {
  e.preventDefault();
  const chosenResumeId = $('manualResumeSelect').value || null;
  const strategyResumeId = state.config?.strategy?.resumeId || null;
  if (chosenResumeId && strategyResumeId && chosenResumeId !== strategyResumeId) {
    return toast('这份简历还没有生成对应词库，请先完成本地分析并选择目标方向', true);
  }
  const currentScoring = state.config?.strategy?.scoring || {};
  const payload = {
    searchKeywords:$('manualKeywords').value, excludedKeywords:$('manualExcluded').value,
    companyBlockKeywords:$('manualCompanies').value, greeting:$('manualGreeting').value,
    threshold:Number($('manualThreshold').value), dailyLimit:Number($('manualDailyLimit').value),
    cities:$('manualCities').value, jobType:$('manualJobType').value, minimumSalary:$('manualMinimumSalary').value,
    deliveryMode:$('manualDeliveryMode').value, resumeDelivery:$('manualResumeDelivery').value,
    resumeId:chosenResumeId,
    targetRoles:$('manualKeywords').value, preferredSkills:$('manualSkills').value,
    scoring:{
      ...currentScoring,
      title_strong_keywords:parseWeightedLines($('manualTitlePositive').value),
      detail_infra_keywords:parseWeightedLines($('manualDetailPositive').value),
      title_penalty_keywords:parseWeightedLines($('manualTitlePenalty').value),
      detail_negative_keywords:parseWeightedLines($('manualDetailNegative').value),
    },
  };
  state.config = await api('/api/strategy/manual', {method:'POST', body:JSON.stringify(payload)});
  renderConfig(); toast('手动策略已保存并启用');
});

$('buildLocalStrategyButton').addEventListener('click', async () => {
  const resumeId = $('localResumeSelect').value;
  if (!resumeId) return toast('请先选择一份已上传简历', true);
  const button = $('buildLocalStrategyButton'); button.disabled = true; button.textContent = '本地分析中…';
  try {
    const result = await api('/api/local/analyze-resume', {method:'POST', body:JSON.stringify({resumeId})});
    await applyLocalGenerationResult(result);
    toast('已识别候选方向，请确认方向后检查词库');
  } catch (e) { toast(e.message, true); }
  finally { button.disabled = false; button.textContent = '分析这份简历'; }
});

$('rebuildLocalStrategyButton').addEventListener('click', async () => {
  const resumeId = $('localResumeSelect').value; const directionId = $('localDirectionSelect').value;
  if (!resumeId || !directionId) return toast('请先选择简历和目标方向', true);
  const button = $('rebuildLocalStrategyButton'); button.disabled = true; button.textContent = '正在重建…';
  try {
    const result = await api('/api/local/build-strategy', {method:'POST', body:JSON.stringify({
      resumeId, directionId, excludedKeywords:$('manualExcluded').value,
    })});
    await applyLocalGenerationResult(result);
    toast('已按你选择的方向重建专用词库');
  } catch (e) { toast(e.message, true); }
  finally { button.disabled = false; button.textContent = '按这个方向重建词库'; }
});

document.querySelectorAll('[data-agent-provider]').forEach(button => button.addEventListener('click', () => selectAgentProvider(button.dataset.agentProvider)));

async function loadAgentModels() {
  const button = $('loadAgentModelsButton'); button.disabled = true;
  const provider = state.agentProvider;
  const apiKey = $('agentApiKey').value.trim();
  const requestId = ++agentModelRequest;
  const selected = $('agentModel').value;
  $('agentModelHint').textContent = '正在查询可用模型…';
  try {
    const result = await api('/api/agent/models', {method:'POST', body:JSON.stringify({provider, apiKey})});
    if (requestId !== agentModelRequest) return;
    showModelOptions(result.models, selected);
    $('agentModelHint').textContent = `已查到 ${result.models.length} 个模型，请从上方选择一个。`;
  } catch (e) {
    if (requestId === agentModelRequest) {
      $('agentModelHint').textContent = `查询失败：${e.message}`;
      toast(e.message, true);
    }
  } finally { button.disabled = false; }
}

$('agentApiKey').addEventListener('input', () => {
  clearTimeout(agentModelTimer);
  agentModelRequest += 1;
  showModelOptions([]);
  if (!$('agentApiKey').value.trim()) {
    $('agentModelHint').textContent = '输入 API Key 后会自动查询模型。';
    return;
  }
  agentModelTimer = setTimeout(loadAgentModels, 650);
});

$('loadAgentModelsButton').addEventListener('click', loadAgentModels);

$('saveAgentButton').addEventListener('click', async () => {
  const apiKey = $('agentApiKey').value.trim();
  const model = $('agentModel').value.trim();
  if (!model) return toast('请先从模型列表选择一个模型', true);
  const agent = {enabled:true, provider:state.agentProvider, model};
  if (apiKey) agent.apiKey = apiKey;
  try {
    state.config = await api('/api/product-config', {method:'PUT', body:JSON.stringify({mode:'agent', agent})});
    $('agentApiKey').value = ''; renderConfig(); toast('Agent 设置已保存到系统密钥库');
  } catch (e) { toast(e.message, true); }
});

function renderUploadQueue() {
  const box = $('uploadQueue'); box.innerHTML = ''; box.classList.toggle('hidden', !state.uploadQueue.length);
  state.uploadQueue.forEach(item => {
    const row = document.createElement('div'); row.className = `upload-item${item.status === 'error' ? ' error' : ''}`;
    const head = document.createElement('div'); head.className = 'upload-item-head';
    const text = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = item.file.name;
    const status = document.createElement('span');
    const statusText = {queued:'等待上传',reading:'正在读取',uploading:'正在上传',done:'上传完成',cancelled:'已取消',error:'上传失败'}[item.status] || item.status;
    status.textContent = `${statusText} · ${Math.round(item.progress || 0)}%`;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'upload-cancel';
    cancel.textContent = ['done','cancelled','error'].includes(item.status) ? '关闭' : '取消';
    cancel.addEventListener('click', () => cancelUpload(item.id));
    const track = document.createElement('div'); track.className = 'progress-track';
    const bar = document.createElement('div'); bar.className = 'progress-bar'; bar.style.width = `${item.progress || 0}%`;
    text.append(name, status); head.append(text, cancel); track.appendChild(bar); row.append(head, track); box.appendChild(row);
  });
}

function dismissUploadItem(itemId, delay = 1000) {
  window.setTimeout(() => {
    state.uploadQueue = state.uploadQueue.filter(entry => entry.id !== itemId);
    renderUploadQueue();
  }, delay);
}

function cancelUpload(itemId) {
  const item = state.uploadQueue.find(entry => entry.id === itemId); if (!item) return;
  if (['done','cancelled','error'].includes(item.status)) {
    state.uploadQueue = state.uploadQueue.filter(entry => entry.id !== itemId); renderUploadQueue(); return;
  }
  item.cancelled = true; item.status = 'cancelled';
  if (item.reader?.readyState === FileReader.LOADING) item.reader.abort();
  if (item.xhr) item.xhr.abort();
  renderUploadQueue(); dismissUploadItem(item.id, 700);
}

function uploadQueuedFile(item) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); item.reader = reader; item.status = 'reading'; renderUploadQueue();
    reader.onprogress = event => { if (event.lengthComputable) { item.progress = Math.round(event.loaded / event.total * 20); renderUploadQueue(); } };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onabort = () => reject(new Error('上传已取消'));
    reader.onload = () => {
      if (item.cancelled) return reject(new Error('上传已取消'));
      const dataBase64 = String(reader.result || '').split(',')[1];
      const xhr = new XMLHttpRequest(); item.xhr = xhr; item.status = 'uploading'; item.progress = 20; renderUploadQueue();
      xhr.open('POST', '/api/resumes'); xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.upload.onprogress = event => { if (event.lengthComputable) { item.progress = 20 + Math.round(event.loaded / event.total * 75); renderUploadQueue(); } };
      xhr.onerror = () => reject(new Error('上传请求失败'));
      xhr.onabort = () => reject(new Error('上传已取消'));
      xhr.onload = () => {
        let body = {}; try { body = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(body.detail || `上传失败：${xhr.status}`));
        item.progress = 100; item.status = 'done'; renderUploadQueue(); resolve(body);
      };
      xhr.send(JSON.stringify({name:item.file.name, mimeType:item.file.type, dataBase64}));
    };
    reader.readAsDataURL(item.file);
  });
}

async function processUploadQueue() {
  if (state.uploading) return; state.uploading = true;
  try {
    let item;
    while ((item = state.uploadQueue.find(entry => entry.status === 'queued'))) {
      try {
        const record = await uploadQueuedFile(item);
        state.resumes = await api('/api/resumes'); state.activeResumeId = record.id; renderResumes(); selectResume(record.id);
        toast(`“${record.name}”已保存到本机`);
        dismissUploadItem(item.id, 900);
      } catch (e) {
        if (!item.cancelled) { item.status = 'error'; item.error = e.message; toast(`${item.file.name}：${e.message}`, true); dismissUploadItem(item.id, 2400); }
        renderUploadQueue();
      }
    }
  } finally { state.uploading = false; }
}

function queueResumeFiles(fileList) {
  const allowed = /\.(pdf|docx|txt|md|png|jpe?g|webp)$/i;
  Array.from(fileList || []).forEach(file => {
    if (!allowed.test(file.name)) { toast(`${file.name}：文件格式不支持`, true); return; }
    if (file.size > 12 * 1024 * 1024) { toast(`${file.name}：不能超过 12MB`, true); return; }
    state.uploadQueue.push({id:`upload-${Date.now()}-${Math.random().toString(16).slice(2)}`, file, status:'queued', progress:0, cancelled:false});
  });
  renderUploadQueue(); processUploadQueue();
}

const dropzone = $('resumeDropzone'); const resumeFile = $('resumeFile');
dropzone.addEventListener('click', () => resumeFile.click());
dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); resumeFile.click(); } });
resumeFile.addEventListener('change', () => { queueResumeFiles(resumeFile.files); resumeFile.value = ''; });
['dragenter','dragover'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave','drop'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', event => queueResumeFiles(event.dataTransfer.files));

$('analyzeResumeButton').addEventListener('click', async () => {
  const resumeId = $('resumeSelect').value; if (!resumeId) return toast('请先选择一份简历', true);
  $('analyzeResumeButton').disabled = true; $('analyzeResumeButton').textContent = 'Agent 分析中…';
  try {
    const result = await api('/api/agent/analyze-resume', {method:'POST', body:JSON.stringify({resumeId})});
    state.questions = result.questions || []; state.strategy = result.draftStrategy;
    $('profileResult').classList.remove('hidden'); $('profileResult').textContent = JSON.stringify(result.profile, null, 2);
    const list = $('questionsList'); list.innerHTML = '';
    state.questions.forEach((q,i) => {
      const row=document.createElement('label'); row.className='question';
      const label=document.createElement('span'); const input=document.createElement('input');
      const questionText=typeof q==='string'?q:(q.question||q.text||`问题 ${i+1}`);
      label.textContent=`${i+1}. ${questionText}`; input.dataset.question=String(i); input.placeholder='请输入你的回答';
      row.append(label,input); list.appendChild(row);
    });
    $('questionsBlock').classList.remove('hidden'); $('agentStrategyBlock').classList.add('hidden'); toast('简历分析完成');
  } catch (e) { toast(e.message, true); }
  finally { $('analyzeResumeButton').disabled=false; $('analyzeResumeButton').textContent='开始分析'; }
});

$('buildStrategyButton').addEventListener('click', async () => {
  const answers = {}; document.querySelectorAll('[data-question]').forEach((input,i)=>{ const q=state.questions[i]; const key=typeof q==='string'?q:(q.id||q.question||`q${i+1}`); answers[key]=input.value; });
  $('buildStrategyButton').disabled=true; $('buildStrategyButton').textContent='生成中…';
  try { state.strategy=await api('/api/agent/build-strategy',{method:'POST',body:JSON.stringify({answers})}); $('agentStrategyResult').textContent=strategySummary(state.strategy); renderAgentEditor(state.strategy); $('agentStrategyBlock').classList.remove('hidden'); toast('最终策略已生成，请确认或修改'); }
  catch(e){ toast(e.message,true); }
  finally { $('buildStrategyButton').disabled=false; $('buildStrategyButton').textContent='生成最终策略'; }
});

$('confirmStrategyButton').addEventListener('click', async () => {
  const edits = {
    searchKeywords:$('agentEditKeywords').value, excludedKeywords:$('agentEditExcluded').value,
    companyBlockKeywords:$('agentEditCompanies').value, threshold:Number($('agentEditThreshold').value),
    dailyLimit:Number($('agentEditDailyLimit').value), greeting:$('agentEditGreeting').value,
    deliveryMode:$('agentEditDeliveryMode').value, resumeDelivery:$('agentEditResumeDelivery').value,
  };
  state.config=await api('/api/strategy/confirm',{method:'POST',body:JSON.stringify(edits)}); renderConfig(); toast('Agent 策略已确认并启用');
});

loadAll().catch(e => toast(e.message, true));
