const fs=require('fs'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict');
function ctx(){const c={readTableCached_:()=>[],safeJsonParse_:(s,f)=>{try{return JSON.parse(s);}catch{return f;}},safeJsonStringify_:JSON.stringify};vm.createContext(c);for(const file of ['Constants.gs','ItemService.gs','SharedRuleEngine.gs'])vm.runInContext(fs.readFileSync(file,'utf8'),c);vm.runInContext(c.getSharedRuleEngineSource_(),c);return c;}
const ids=['item_honor_fist','item_miracle_eraser','item_honor_badge','item_vampire_pen'];
test('four items parse from master definitions and existing spreadsheet DSL with their requested rarities',()=>{const c=ctx();for(const id of ids)assert.ok(c.getItemById_(id));assert.equal(c.getItemById_(ids[0]).rarity,'epic');assert.equal(c.getItemById_(ids[1]).rarity,'legendary');const row=c.normalizeItemRow_({'아이템명':'우등생의 주먹','등급':'영웅','효과 1':'type=perfectAnswerEffect; effectId=buff_power; stacks=1; label=효율 100% 이상이면 힘 1중첩'});assert.equal(row.itemId,ids[0]);assert.equal(JSON.parse(row.effectJson)[0].effectId,'buff_power');});
function battle(c){return {turn:1,player:{hp:10,maxHp:30,effects:[],itemModifiers:c.buildItemModifiers_(ids.map(itemId=>({itemId,count:1})))}};}
test('100% and higher grant one strength and toughness stack per solved question; lower efficiency and give-up do not',()=>{const c=ctx(),b=battle(c);assert.equal(b.player.itemModifiers.perfectAnswerEffects.length,2);c.RULE_ENGINE_SHARED.applyPerfectAnswerItems(b,.999,false);assert.equal(b.player.effects.length,0);c.RULE_ENGINE_SHARED.applyPerfectAnswerItems(b,1,true);assert.equal(b.player.effects.length,0);c.RULE_ENGINE_SHARED.applyPerfectAnswerItems(b,1,false);assert.deepEqual(Array.from(b.player.effects,e=>e.stacks),[1,1]);c.RULE_ENGINE_SHARED.applyPerfectAnswerItems(b,1.5,false);assert.deepEqual(Array.from(b.player.effects,e=>e.stacks),[2,2]);assert.ok(b.player.effects.every(e=>e.durationType==='stage'));});
test('wrong protection is once per stage and survives serialization while a new stage resets it',()=>{const c=ctx(),b=battle(c);assert.equal(c.RULE_ENGINE_SHARED.consumeWrongProtection(b,0),0);assert.equal(c.RULE_ENGINE_SHARED.consumeWrongProtection(b,1),1);assert.equal(c.RULE_ENGINE_SHARED.consumeWrongProtection(JSON.parse(JSON.stringify(b)),2),0);assert.equal(c.RULE_ENGINE_SHARED.consumeWrongProtection(battle(c),1),1);assert.equal(c.RULE_ENGINE_SHARED.consumeWrongProtection({player:{itemModifiers:{}}},1),0);});
test('critical healing is 10% of damage, rounded like other heals, capped at max HP and absent on normal or missed attacks',()=>{const c=ctx(),b=battle(c),e=c.RULE_ENGINE_SHARED;assert.equal(e.applyCriticalItemHealing(b,false,100),0);assert.equal(e.applyCriticalItemHealing(b,true,0),0);assert.equal(e.applyCriticalItemHealing(b,true,25),3);assert.equal(b.player.hp,13);assert.equal(e.applyCriticalItemHealing(b,true,1000),17);assert.equal(b.player.hp,30);});

const newIds=['item_perfect_crown','item_steady_bookmark','item_steel_ruler','item_burning_timetable','item_heavy_textbook','item_crack_chalk','item_hearty_lunchbox','item_shard_pouch','item_sharp_pencil','item_lucky_protractor'];
test('ten items preserve requested rarities and round-trip their spreadsheet effects',()=>{
  const c=ctx(),rarities=['unique','unique','epic','legendary','rare','rare','uncommon','uncommon','common','epic'];
  newIds.forEach((id,i)=>{
    const item=c.getItemById_(id);assert.equal(item.rarity,rarities[i]);
    c.getItemEffects_(item).forEach(effect=>{
      const parsed=c.parseItemEffectText_(c.formatItemEffectForSheet_(effect));
      assert.equal(parsed.type,effect.type);assert.equal(parsed.value,effect.value);
      if(effect.statKey)assert.equal(parsed.statKey,effect.statKey);
    });
  });
});

test('maximum and minimum efficiency add percentage points identically in server and browser',()=>{
  const c=ctx();vm.runInContext(fs.readFileSync('BattleService.gs','utf8'),c);
  c.getAnswerEfficiencyRules_=()=>({minAnswerEfficiency:.5,maxAnswerEfficiency:1.25,extraWrongEfficiencyPenalty:.1});
  c.roundTo_=(value,places)=>Number(value.toFixed(places));
  const mods={questionMaxEfficiencyFlatPercent:25,questionMinEfficiencyPercent:15};
  assert.equal(c.calculateEfficiency(true,1000,1000,0,mods),1.5);
  assert.equal(c.calculateEfficiency(true,0,1000,0,mods),.65);
  assert.equal(c.calculateEfficiency(false,0,1000,1,mods),.65);
  assert.equal(c.calculateEfficiency(false,0,1000,2,mods),.55);
  // Older multiplicative items keep their original behavior alongside the new additive item.
  assert.equal(c.calculateMaxAnswerEfficiency_({...mods,questionMaxEfficiencyPercent:20}),1.75);
  const html=fs.readFileSync('Battle.html','utf8');
  const client=vm.createContext({MIN_ANSWER_EFFICIENCY:.5,MAX_ANSWER_EFFICIENCY:1.25,EXTRA_WRONG_EFFICIENCY_PENALTY:.1,currentQuestionView:{maxAnswerEfficiency:1.5,questionModifiers:mods}});
  for(const name of ['calculateTimedEfficiency','getQuestionMinAnswerEfficiency','getQuestionMaxAnswerEfficiency','calculateWrongEfficiency'])vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],client);
  for(const remaining of [0,250,500,750,1000])assert.ok(Math.abs(client.calculateTimedEfficiency(remaining,1000)-c.calculateEfficiency(true,remaining,1000,0,mods))<.001);
  assert.equal(client.calculateWrongEfficiency(2),.55);
});
test('new item modifiers add, HP percentages combine, and critical stats use percentage points',()=>{
  const c=ctx();c.getConfiguredBasePlayerStats_=()=>({hp:100,attack:10,defense:5,criticalRate:10,criticalDamage:150,accuracy:100});
  const owned=newIds.map(itemId=>({itemId,count:1}));
  const m=c.buildItemModifiers_(owned),s=c.calculateStatsWithItemEffects_({},owned);
  assert.equal(m.questionMaxEfficiencyFlatPercent,25);assert.equal(m.questionMinEfficiencyPercent,15);
  assert.equal(m.actionPoint,0);assert.equal(m.basicAttackDamagePercent,20);assert.equal(m.damageDealtPercent,33);
  assert.equal(s.hp,90);assert.equal(s.attack,12);assert.equal(s.defense,4);assert.equal(s.criticalRate,15);assert.equal(s.criticalDamage,165);
});
test('shield bonus affects only shields and breaking a shield grants five exactly once per break',()=>{
  const c=ctx(),e=c.RULE_ENGINE_SHARED;
  const b={player:{shield:0,itemModifiers:c.buildItemModifiers_(['item_crack_chalk','item_shard_pouch'])}};
  const m={shield:10,currentHp:100};
  const hit=e.dealDamageToMonster(m,8,b);
  assert.equal(hit.shieldDamage,10);assert.equal(hit.hpDamage,0);assert.equal(b.player.shield,5);
  e.dealDamageToMonster(m,8,b);assert.equal(m.currentHp,92);assert.equal(b.player.shield,5);
  m.shield=10;const spill=e.dealDamageToMonster(m,12,b);
  assert.equal(spill.shieldDamage,10);assert.equal(spill.hpDamage,2);assert.equal(b.player.shield,10);
  m.shield=10;e.dealDamageToMonster(m,0,b);assert.equal(b.player.shield,10);assert.equal(m.shield,10);
});
