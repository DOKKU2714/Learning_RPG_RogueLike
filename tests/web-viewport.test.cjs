const test = require('node:test');
const assert = require('node:assert/strict');
const { renderOutput } = require('./helpers/web-output.cjs');

test('every Apps Script route registers device-width viewport on HtmlOutput', () => {
  for (const page of ['index','battle','question','questionmanagement','workbookmanagement','mypage','leaderboard','admin']) {
    const { output } = renderOutput(page);
    const tags = output.metaTags.filter(tag => tag.name === 'viewport');
    assert.equal(tags.length, 1, page);
    assert.match(tags[0].content, /width=device-width/);
    assert.match(tags[0].content, /initial-scale=1(?:,|$)/);
    assert.match(tags[0].content, /viewport-fit=cover/);
    assert.doesNotMatch(tags[0].content, /user-scalable=no|maximum-scale=1/);
  }
});

test('viewport fix preserves routing, title and Index boot scripts', () => {
  const index = renderOutput('index');
  assert.equal(index.templateFile, 'Index');
  assert.deepEqual(index.output.appended, ['PlayPermissionFix','QuestionManagementBoot']);
  assert.equal(index.output.title, 'Learning Roguelike');
  const battle = renderOutput('battle');
  assert.equal(battle.templateFile, 'Battle');
  assert.deepEqual(battle.output.appended, []);
});
