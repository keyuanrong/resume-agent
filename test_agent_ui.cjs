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
    emit(event) { return this.listeners[event]?.({target:this}); }
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
  const document = {
    getElementById: get,
    createElement: () => new Element(),
    querySelectorAll: selector => selector === '[data-agent-provider]' ? providers : [],
  };
  const fetch = (url, options) => {
    if (url !== '/api/agent/models') return new Promise(() => {});
    requests.push(JSON.parse(options.body));
    return Promise.resolve({ok:true, headers:{get:()=>'application/json'}, json:async()=>({models:[
      {id:'deepseek-chat', name:'DeepSeek Chat', provider:'deepseek'},
      {id:'deepseek-reasoner', name:'DeepSeek Reasoner', provider:'deepseek'},
    ]})});
  };
  const context = vm.createContext({document, fetch, setTimeout:fn=>{timers.push(fn); return timers.length;}, clearTimeout:()=>{}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/app.js'), 'utf8'), context);
  return {get, providers, timers, requests, context};
}

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
