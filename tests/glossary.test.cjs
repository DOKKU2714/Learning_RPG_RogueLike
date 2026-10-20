const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('BattleService.gs','utf8');
const {context,start,copy}=require('./run-session.test.cjs');
test('glossary client config uses editable sheet rows and excludes incomplete definitions',()=>{
  let read;
  const c=vm.createContext({DB_SHEETS:{GLOSSARY:'Glossary'},readTableCached_:(sheet,ttl)=>{
    read={sheet,ttl};return [{keyword:' 기절 ',description:' 턴을 건너뜁니다. '},{keyword:'',description:'empty'},
      {keyword:'미완성',description:''},{keyword:123,description:'invalid'}];
  }});
  vm.runInContext(source.match(/function getBattleGlossary_\([^]*?\n\}/)[0],c);
  assert.deepEqual(JSON.parse(JSON.stringify(c.getBattleGlossary_())),[{keyword:'기절',description:'턴을 건너뜁니다.'}]);
  assert.deepEqual(read,{sheet:'Glossary',ttl:600});
  assert.match(source,/glossary: getBattleGlossary_\(\)/);
});
test('glossary definitions travel through the signed run snapshot to browser and restored views',()=>{
  const x=context(),terms=[{keyword:'기절',description:'대상의 행동을 건너뜁니다.'}];
  x.seed(x.c.DB_SHEETS.GLOSSARY,terms);
  const view=start(x);
  assert.deepEqual(copy(view.clientConfig.glossary),terms);
  assert.deepEqual(copy(view.gameDataSnapshot.clientConfig.glossary),terms);
  x.seed(x.c.DB_SHEETS.GLOSSARY,[{keyword:'새 단어',description:'새 설명'}]);
  x.cache.clear();
  const restored=x.c.withRunSession_(view.runId,view.runSessionToken,'auth',()=>{
    const run=x.c.requireRun_(view.runId);
    return x.c.buildBattleStateView_(run,x.c.getStageState_(run));
  });
  assert.deepEqual(copy(restored.clientConfig.glossary),terms);
});
