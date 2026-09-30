const assert = require('node:assert/strict');
const test = require('node:test');

test('Boss tracks each search word separately and stops after all quotas', () => {
  const {createKeywordBudget} = require('./web_script.js');
  const budget = createKeywordBudget(2);
  budget.record('VLA');
  budget.record('VLA');
  assert.equal(budget.remaining('VLA'), 0);
  assert.equal(budget.remaining('具身智能'), 2);
  assert.equal(budget.next(['VLA', '具身智能'], 0), 1);
  budget.record('具身智能');
  budget.record('具身智能');
  assert.equal(budget.next(['VLA', '具身智能'], 1), -1);
});

test('other platform persists separate counts when the page reloads', () => {
  const {keywordRemaining, recordKeywordView} = require('./multi_platform_test.user.js');
  const initial = {keywordIndex: 0, totalProcessed: 0, keywordProcessed: {}};
  const afterVla = recordKeywordView(initial);
  const restored = {...afterVla, keywordIndex: 1};
  assert.equal(keywordRemaining(restored, 2), 2);
  const afterRobot = recordKeywordView(restored);
  assert.equal(keywordRemaining({...afterRobot, keywordIndex: 0}, 2), 1);
  assert.equal(afterRobot.totalProcessed, 2);
});

test('Zhaopin waits briefly for the platform to prefill its greeting', async () => {
  const {waitForPlatformGreeting} = require('./multi_platform_test.user.js');
  const input = {value: ''};
  setTimeout(() => { input.value = '平台默认招呼语'; }, 10);
  assert.equal(await waitForPlatformGreeting(input, 100), '平台默认招呼语');
  assert.equal(await waitForPlatformGreeting({value: ''}, 15), '');
});
