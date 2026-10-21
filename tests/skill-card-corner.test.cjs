const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('Battle.html','utf8');
const c=vm.createContext({MAX_QUESTION_DIFFICULTY:5,escapeHtml:String,
 getSkillCooldownDisplayText:s=>s.cooldownText || '쿨타임 없음',getSkillUseLimitText:s=>s.useLimitText || ''});
for(const name of ['renderDifficultyStars','renderSkillCardCornerMeta'])vm.runInContext(source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],c);
test('card corner shows difficulty stars, cooldown and remaining uses in order',()=>{
 const html=c.renderSkillCardCornerMeta({difficultyBonus:2,cooldownText:'쿨타임 3턴',useLimitText:'사용 가능 횟수: 전투 1/4회'});
 assert.equal((html.match(/class="difficulty-star"/g)||[]).length,2);
 assert.equal((c.renderSkillCardCornerMeta({difficultyBonus:7}).match(/class="difficulty-star"/g)||[]).length,7);
 assert.match(html,/sign" aria-hidden="true">\+/);
 assert.ok(html.indexOf('difficulty-star')<html.indexOf('쿨타임 3턴'));
 assert.ok(html.indexOf('쿨타임 3턴')<html.indexOf('1회 사용가능'));
 assert.doesNotMatch(html,/>난이도/);
 assert.match(c.renderSkillCardCornerMeta({}),/쿨타임 0턴.*사용 횟수 제한 없음/);
 assert.match(c.renderSkillCardCornerMeta({useLimitText:'전투 0/3회'}),/0회 사용가능/);
 assert.match(c.renderSkillCardCornerMeta({difficultyBonus:-1}),/sign" aria-hidden="true">−/);
});
