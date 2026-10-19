const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const server=fs.readFileSync('BattleService.gs','utf8'),client=fs.readFileSync('Battle.html','utf8');
const extract=(source,name)=>source.match(new RegExp('(?:    )?function '+name+'\\([^]*?\\n'+(source===client?'    ':'')+'\\}'))[0];
test('concept keywords: sheet JSON controls words, rejects unsupported groups and bounds entries',()=>{
  const c=vm.createContext({safeJsonParse_:(s,f)=>{try{return JSON.parse(s);}catch{return f;}}});
  vm.runInContext(extract(server,'getSkillConceptKeywords_'),c);
  const config=c.getSkillConceptKeywords_({skillConceptKeywordsJson:JSON.stringify({burn:['불씨',' 화염 ',5,'x'.repeat(41)],shock:[],unknown:['공격']})});
  assert.deepEqual(Array.from(config.burn),['불씨','화염']);assert.deepEqual(Array.from(config.shock),[]);assert.equal(config.unknown,undefined);
  assert.deepEqual(Array.from(c.getSkillConceptKeywords_({skillConceptKeywordsJson:'bad json'}).burn),['발화']);
});
test('concept keywords: longest literal word wins and HTML attributes remain untouched',()=>{
  const c=vm.createContext({currentView:{clientConfig:{skillConceptKeywords:{burn:['발화','발화 폭발','a+b'],shock:['전류']}}}});
  vm.runInContext(extract(client,'highlightSkillStatusNames'),c);
  const result=c.highlightSkillStatusNames('<span title="발화 전류">발화 폭발 a+b 전류</span>');
  assert.match(result,/title="발화 전류"/);assert.match(result,/skill-status-burn">발화 폭발<\/strong>/);
  assert.match(result,/skill-status-burn">a\+b<\/strong>/);assert.match(result,/skill-status-shock">전류<\/strong>/);
  assert.equal((result.match(/skill-status-name/g)||[]).length,3);
});
