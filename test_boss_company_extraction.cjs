const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'web_script.js'), 'utf8');

function extractDetailInfo(nodes, recruiterText = '赵倩', recruiterAttrText = '') {
  const sent = [];
  const recruiter = {
    innerText: recruiterText,
    textContent: recruiterText,
    querySelector: selector => selector === '.boss-info-attr' && recruiterAttrText
      ? {innerText: recruiterAttrText, textContent: recruiterAttrText}
      : null,
    querySelectorAll: selector => selector.includes('.boss-info-attr > *')
      ? [{innerText: recruiterText, textContent: recruiterText}]
      : [],
  };
  const document = {
    querySelector(selector) {
      if (selector === '.job-boss-info') return recruiter;
      if (selector === '.name') return {querySelector: field => ({innerText: field === 'h1' ? 'VLA 工程师' : '10K'})};
      if (selector === '.job-sec-text') return {innerText: '机器人岗位描述'};
      if (selector === '.btn-startchat') return {
        innerText: '立即沟通', dataset: {url: '/add'}, getAttribute: () => '/chat',
      };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return [];
      const choices = selector.split(',').map(item => item.trim());
      return nodes.filter(node => choices.some(choice => node.selectors.includes(choice)));
    },
  };
  class BroadcastChannel {
    addEventListener() {}
    postMessage(message) { sent.push(message); }
  }
  const now = Date.now();
  const context = vm.createContext({
    document, BroadcastChannel, console, URL, Date,
    window: {name: '__zhipin_detail', addEventListener() {}},
    localStorage: {getItem: key => key === '__zhipin_detail' ? String(now) : null},
  });
  const runnable = source.replace('const goodjobs = new Zhipin().run();', 'new Zhipin().__detail();');
  vm.runInContext(runnable, context);
  return sent.find(message => message.type === 'get-job-info')?.data;
}

const extractDetailCompany = (nodes, recruiterText) => extractDetailInfo(nodes, recruiterText)?.company;

test('recruiter name is not accepted when no company source exists', () => {
  const company = extractDetailCompany([
    {selectors: ['.job-boss-info .boss-info-attr > :first-child'], innerText: '赵倩'},
  ]);
  assert.equal(company, '');
});

test('company-specific source wins even when recruiter appears earlier', () => {
  const company = extractDetailCompany([
    {selectors: ['.job-boss-info .boss-info-attr > :first-child'], innerText: '李云辉'},
    {selectors: ['.job-detail-company .company-name'], innerText: '阿童木机器人'},
  ], '李云辉');
  assert.equal(company, '阿童木机器人');
});

test('list card ignores recruiter name and accepts only company source', () => {
  const context = vm.createContext({console, URL});
  const runnable = source.replace(
    'const goodjobs = new Zhipin().run();',
    'globalThis.extractCardCompany = extractBossCardCompany;'
  );
  vm.runInContext(runnable, context);
  const card = {
    querySelectorAll(selector) {
      const choices = selector.split(',').map(item => item.trim());
      return [
        {selectors: ['.boss-name'], innerText: '赵倩'},
        {selectors: ['.company-name'], innerText: '成都长数机器人'},
      ].filter(node => choices.some(choice => node.selectors.includes(choice)));
    },
  };
  assert.equal(context.extractCardCompany(card), '成都长数机器人');
});

test('headhunter role keeps the recruiting organization and remains scoreable', () => {
  const info = extractDetailInfo([], '卢智泓\n聚猎 · 猎头顾问', '聚猎 · 猎头顾问');
  assert.equal(info.company, '聚猎');
  assert.equal(info.companyType, 'recruiter_agency');
  assert.equal(info.skip, false);
});

test('ordinary in-house HR card is not classified as a headhunter', () => {
  const info = extractDetailInfo([], '王女士\n阿童木机器人 · HR');
  assert.equal(info.skip, false);
});

test('company and role line identifies an in-house company without using the recruiter name', () => {
  const info = extractDetailInfo([], '王女士\n阿童木机器人 · HR', '阿童木机器人 · HR');
  assert.equal(info.company, '阿童木机器人');
  assert.equal(info.skip, false);
});

test('headhunter organization is kept separate from the hiring company', () => {
  const info = extractDetailInfo([], '卢智泓\n聚猎 · 猎头顾问', '聚猎 · 猎头顾问');
  assert.equal(info.recruiterCompany, '聚猎');
  assert.equal(info.company, '聚猎');
  assert.equal(info.companyType, 'recruiter_agency');
  assert.equal(info.skip, false);
});

test('a recruiter name without a company and role line stays unknown', () => {
  const info = extractDetailInfo([], '赵倩', '赵倩');
  assert.equal(info.company, '');
});
