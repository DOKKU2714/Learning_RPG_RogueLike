const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const server = fs.readFileSync('BattleService.gs', 'utf8');
const client = fs.readFileSync('Battle.html', 'utf8');
const extract = (source, name) => {
  const indent = source === client ? '    ' : '';
  return source.match(new RegExp('^' + indent + 'function ' + name + '\\([^]*?^' + indent + '\\}', 'm'))[0];
};

test('server and local intents select monster basic effects and skill effects, ignoring legacy AI effects', () => {
  let skill = {skillId:'fireball', type:'damage', attackEffect:'fire'};
  const context = vm.createContext({
    ACTION_TYPES:{ATTACK:'attack',SKILL:'skill',GUARD:'guard'}, DB_SHEETS:{SKILLS:'Skills'},
    safeJsonParse_:JSON.parse, getHpPercent_:()=>100, isMonsterAiSkillAllowed_:()=>true,
    normalizeMonsterAiActionType_:(type)=>type, pickWeightedAiRow_:rows=>rows[0],
    findCachedRowByKey_:()=>skill, calculateMonsterSkillHitCount_:()=>1,
    calculateMonsterIntentValue_:()=>10, buildIntentText:()=>'',
    isClientMonsterAiRuleAllowed:()=>true, pickWeightedClientAiRule:rows=>rows[0],
    normalizeClientMonsterActionType:type=>type, calculateClientMonsterIntentValue:()=>10,
    calculateClientMonsterSkillHitCount:()=>1, buildClientMonsterIntentText:()=>'',
  });
  for (const name of ['selectMonsterAction','refreshMonsterSkillIntent_']) vm.runInContext(extract(server,name),context);
  vm.runInContext(extract(client,'buildClientMonsterIntent'),context);
  const monster = {aiId:'a', attackEffect:'blunt'};
  const basic = {aiId:'a',actionType:'attack',attackEffect:'slash',conditionJson:'{}'};
  assert.equal(context.selectMonsterAction(monster,[basic],{}).attackEffect,'blunt');
  assert.equal(context.buildClientMonsterIntent(monster,{},[basic]).attackEffect,'blunt');
  assert.equal(context.selectMonsterAction(monster,[],{}).attackEffect,'blunt');
  for (const [type,value,expected] of [['damage','fire','fire'],['damage','none','none'],['damage','','slash'],['buff','','none'],['heal','fire','fire']]) {
    skill = {skillId:'s',type,attackEffect:value};
    const rule = {aiId:'a',actionType:'skill',skillId:'s',conditionJson:'{}',skillType:type,skillAttackEffect:expected};
    assert.equal(context.selectMonsterAction(monster,[{...rule,skillAttackEffect:'thrust'}],{}).attackEffect,expected);
    assert.equal(context.buildClientMonsterIntent(monster,{},[rule]).attackEffect,expected);
    monster.intent={actionType:'skill',skillId:'s',skillAttackEffect:'thrust'};
    assert.equal(context.refreshMonsterSkillIntent_({},monster).attackEffect,expected);
  }
});

test('migration preserves configured cells and reports conflicting legacy values', () => {
  const tables = {
    Monsters:[{monsterId:'m',aiId:'a'},{monsterId:'kept',aiId:'a',attackEffect:'none'},{monsterId:'punch',aiId:'legacy'}],
    Skills:[{skillId:'s'},{skillId:'conflict'},{skillId:'kept',attackEffect:'fire'},{skillId:'singleColumn'}],
    MonsterAI:[{aiId:'a',actionType:'attack',attackEffect:'blunt'},
      {actionType:'skill',skillId:'s',skillAttackEffect:'fire'},
      {actionType:'skill',skillId:'conflict',skillAttackEffect:'slash'},
      {actionType:'skill',skillId:'conflict',skillAttackEffect:'thrust'},
      {aiId:'legacy',actionType:'attack',attackEffect:'punch'},
      {actionType:'skill',skillId:'singleColumn',attackEffect:'thurst'}],
  };
  const writes=[];
  const c=vm.createContext({DB_SHEETS:{MONSTERS:'Monsters',SKILLS:'Skills',MONSTER_AI:'MonsterAI'},
    DB_COLUMNS:{MONSTERS:[],SKILLS:[]},ACTION_TYPES:{ATTACK:'attack'},
    ensureTableColumns_:()=>{},readTable_:name=>tables[name],
    normalizeMonsterAiActionType_:type=>type,
    updateRowByKey_:(table,key,id,value)=>{Object.assign(tables[table].find(row=>row[key]===id),value);writes.push(id);},
    clearMasterTableCaches_:()=>{},Logger:{log:()=>{}}});
  vm.runInContext(extract(fs.readFileSync('Database.gs','utf8'),'migrateMonsterAttackEffects'),c);
  const report=c.migrateMonsterAttackEffects();
  assert.deepEqual(writes,['m','punch','s','singleColumn']);
  assert.equal(tables.Monsters.find(row=>row.monsterId==='punch').attackEffect,'blunt');
  assert.equal(tables.Skills.find(row=>row.skillId==='singleColumn').attackEffect,'thrust');
  assert.equal(report.conflicts.length,1);
  assert.equal(report.conflicts[0].id,'conflict');
  c.migrateMonsterAttackEffects();
  assert.deepEqual(writes,['m','punch','s','singleColumn'],'repeated runs do not overwrite migrated values');
});

test('database setup does not recreate retired MonsterAI effect columns',()=>{
  const headersBySheet=new Map();
  const c=vm.createContext({ensureSheet_:(sheet,headers)=>headersBySheet.set(sheet,Array.from(headers))});
  vm.runInContext(fs.readFileSync('Constants.gs','utf8'),c);
  vm.runInContext(extract(fs.readFileSync('Database.gs','utf8'),'setupDatabase'),c);
  c.setupDatabase();
  assert.deepEqual(headersBySheet.get('MonsterAI'),['aiId','patternName','actionType','conditionJson','probability','skillId','intentIcon','intentTextTemplate']);
  assert.ok(headersBySheet.get('Monsters').includes('attackEffect'));
  assert.ok(headersBySheet.get('Skills').includes('attackEffect'));
});
