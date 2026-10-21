const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('Battle.html', 'utf8');
const context = vm.createContext({});
for (const name of ['formatSkillDescriptionMarkup', 'renderSkillDescriptionTemplate', 'highlightSkillStatusNames', 'buildSkillFlavorDescription', 'buildSkillDetailDescription']) {
  vm.runInContext(source.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0], context);
}
context.escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
context.getSkillDescriptionTemplateValues = () => ({damage: 12});
context.replaceSkillDescriptionTokens = (text, keys, value) => keys.includes('damage') ? text.replace('{damage}', '<strong class="skill-damage-number">' + value + '</strong>') : text;
test('sheet markup supports nested formatting, hex colors, tokens and flavor text', () => {
  const result = context.renderSkillDescriptionTemplate({}, '[b][i]강타[/i][/b] [u]밑줄[/u] [s]취소[/s][br][color=#ffcc00]{damage} 발화[/color]');
  assert.match(result, /<b><i>강타<\/i><\/b>/);
  assert.match(result, /<u>밑줄<\/u> <s>취소<\/s><br>/);
  assert.match(result, /color:#ffcc00/);
  assert.match(result, /skill-damage-number">12/);
  assert.match(result, /skill-status-burn/);
  assert.match(context.buildSkillFlavorDescription({description:'"[b]인용[/b]"'}), /<b>인용<\/b>/);
});
test('untrusted HTML and invalid styles stay inert; unclosed tags cannot leak', () => {
  const result = context.renderSkillDescriptionTemplate({}, '<img src=x onerror=alert(1)>[color=red;position:fixed]실패[/color][b]끝');
  assert.match(result, /&lt;img/);
  assert.doesNotMatch(result, /<img|style=/);
  assert.match(result, /\[color=red;position:fixed\]/);
  assert.ok(result.endsWith('<b>끝</b>'));
  assert.equal(context.formatSkillDescriptionMarkup('[b][i]내용[/b][/i]'), '<b><i>내용[/b]</i></b>');
  assert.equal(context.formatSkillDescriptionMarkup('[color=#abc]짧은 색[/color]'), '<span class="skill-description-color" style="--skill-description-color:#abc;color:#abc">짧은 색</span>');
});

test('sheet descriptions take priority over legacy frost fallback', () => {
  assert.equal(context.buildSkillDetailDescription({skillId:'skill_v2_frost_13',description:'[b]시트 설명[/b]'}), '<b>시트 설명</b>');
});
