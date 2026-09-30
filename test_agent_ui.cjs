const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function page() {
  class Element {
    constructor() {
      this.value = '';
      this.children = [];
      this.dataset = {};
      this.listeners = {};
      this.classList = {toggle() {}, add() {}, remove() {}};
    }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    replaceChildren() { this.children = []; }
    appendChild(child) { this.children.push(child); }
    setAttribute(name, value) { this[name] = value; }
    emit(event) { return this.listeners[event]?.({target:this, preventDefault() {}}); }
  }
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const providers = ['bailian', 'deepseek'].map(id => {
    const button = new Element(); button.dataset.agentProvider = id; return button;
  });
  const timers = [];
  const requests = [];
  const confirmations = [];
  const manualSubmissions = [];
  const document = {
    getElementById: get,
    createElement: () => new Element(),
    querySelectorAll: selector => selector === '[data-agent-provider]' ? providers : [],
  };
  const fetch = (url, options) => {
    if (url === '/api/strategy/confirm') {
      confirmations.push(JSON.parse(options.body));
      return Promise.resolve({ok:true, headers:{get:()=>'application/json'}, json:async()=>({mode:'agent', agent:{}, strategy:{}})});
    }
    if (url === '/api/strategy/manual') {
      manualSubmissions.push(JSON.parse(options.body));
      return Promise.resolve({ok:true, headers:{get:()=>'application/json'}, json:async()=>({mode:'manual', agent:{}, strategy:{}})});
    }
    if (url !== '/api/agent/models') return new Promise(() => {});
    requests.push(JSON.parse(options.body));
    return Promise.resolve({ok:true, headers:{get:()=>'application/json'}, json:async()=>({models:[
      {id:'deepseek-chat', name:'DeepSeek Chat', provider:'deepseek'},
      {id:'deepseek-reasoner', name:'DeepSeek Reasoner', provider:'deepseek'},
    ]})});
  };
  const context = vm.createContext({document, fetch, setTimeout:fn=>{timers.push(fn); return timers.length;}, clearTimeout:()=>{}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/app.js'), 'utf8'), context);
  return {get, providers, timers, requests, confirmations, manualSubmissions, context};
}

test('manual strategy saves per-keyword limit without removed platform settings', async () => {
  const ui = page();
  vm.runInContext("state.config={mode:'manual',agent:{},strategy:{}}", ui.context);
  ui.get('manualJobsPerKeyword').value = '17';
  ui.get('manualKeywords').value = 'VLA算法工程师';
  await ui.get('manualForm').emit('submit');
  assert.equal(ui.manualSubmissions[0].jobsPerKeyword, 17);
  for (const field of ['dailyLimit','cities','jobType','minimumSalary','greeting']) {
    assert.equal(Object.hasOwn(ui.manualSubmissions[0], field), false, field);
  }
});

test('manual and agent forms send only the selected delivery mode', async () => {
  const ui = page();
  vm.runInContext("state.config={mode:'manual',agent:{},strategy:{resumeId:'resume-one'}}", ui.context);
  ui.get('manualDeliveryMode').value = 'screen_only';
  ui.get('manualKeywords').value = 'VLA算法工程师';
  await ui.get('manualForm').emit('submit');
  assert.equal(ui.manualSubmissions[0].deliveryMode, 'screen_only');
  assert.equal(ui.manualSubmissions[0].resumeId, 'resume-one');
  assert.equal(Object.hasOwn(ui.manualSubmissions[0], 'resumeDelivery'), false);

  ui.get('agentEditDeliveryMode').value = 'auto';
  ui.get('agentEditJobsPerKeyword').value = '20';
  await ui.get('confirmStrategyButton').emit('click');
  assert.equal(ui.confirmations[0].deliveryMode, 'auto');
  assert.equal(Object.hasOwn(ui.confirmations[0], 'resumeDelivery'), false);
});

test('entering a key loads model choices for the selected provider without selecting one', async () => {
  const ui = page();
  ui.providers[1].emit('click');
  const key = ui.get('agentApiKey'); key.value = 'test-key';
  key.emit('input');
  assert.ok(ui.timers.length, 'typing a key should schedule model discovery');
  ui.timers.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ui.requests, [{provider:'deepseek', apiKey:'test-key'}]);
  assert.deepEqual(ui.get('agentModel').children.map(option => option.value).filter(Boolean), ['deepseek-chat', 'deepseek-reasoner']);
  assert.equal(ui.get('agentModel').value, '', 'the user chooses the model');
});

test('an unconfigured account does not display a default model as selected', () => {
  const ui = page();
  vm.runInContext("state.config = {mode:'manual', agent:{enabled:false, hasApiKey:false, model:'qwen3.8-flash'}, strategy:{}}; renderConfig()", ui.context);
  assert.equal(ui.get('agentModel').value, '');
  assert.equal(ui.get('modelLabel').textContent, '待选择');
});

test('resume analysis displays the proposed search terms alongside the summary', () => {
  const ui = page();
  const output = vm.runInContext(`typeof formatResumeAnalysis === 'function'
    ? formatResumeAnalysis({summary:'机器人项目经历', skills:['LeRobot']}, {searchKeywords:['VLA算法实习生'], preferredSkills:['LeRobot']})
    : ''`, ui.context);
  assert.match(output, /初步岗位搜索词[\s\S]*VLA算法实习生/);
  assert.match(output, /技能匹配词[\s\S]*LeRobot/);
});

test('agent editor shows and confirms weighted positive and soft negative lists', async () => {
  const ui = page();
  const scoring = {
    title_strong_keywords:{'VLA算法':92}, detail_infra_keywords:{'π0':16},
    title_penalty_keywords:{'纯SLAM':35}, detail_negative_keywords:{'传统定位建图':16},
  };
  vm.runInContext(`state.config={mode:'agent', agent:{enabled:true}, strategy:{}}; renderAgentEditor({scoring:${JSON.stringify(scoring)}})`, ui.context);
  assert.equal(ui.get('agentEditTitlePositive').value, 'VLA算法:92');
  assert.equal(ui.get('agentEditTitlePenalty').value, '纯SLAM:35');
  await ui.get('confirmStrategyButton').emit('click');
  assert.equal(ui.confirmations[0].scoring.title_strong_keywords['VLA算法'], 92);
  assert.equal(ui.confirmations[0].scoring.detail_negative_keywords['传统定位建图'], 16);
  assert.equal(ui.confirmations[0].jobsPerKeyword, 20);
  for (const field of ['dailyLimit','cities','jobType','minimumSalary','greeting']) {
    assert.equal(Object.hasOwn(ui.confirmations[0], field), false, field);
  }
});

test('agent mode lets the user select a locally identified direction', () => {
  const ui = page();
  vm.runInContext("renderAgentDirections([{id:'robot_vla',name:'VLA / 具身智能'},{id:'backend',name:'后端开发'}], 'robot_vla')", ui.context);
  assert.deepEqual(ui.get('agentDirectionSelect').children.map(option => option.value), ['robot_vla', 'backend']);
  assert.equal(ui.get('agentDirectionSelect').value, 'robot_vla');
});
