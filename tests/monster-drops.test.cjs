const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {context,start,copy}=require('./run-session.test.cjs');

function game(){
  const x=context(),view=start(x),c=x.c;
  const engine=vm.runInNewContext(c.getLocalRunEngineSource_(),{Date:c.Date,Math:c.Math});
  return {x,c,view,engine,battle:copy(view.battle),snapshot:view.gameDataSnapshot};
}

test('monster drops: normal chance is 10%, boss and final boss always drop',()=>{
  const {c}=game();let count=0;
  for(let i=0;i<10000;i++)if(c.monsterDropRandom_('battle-'+i,'m','chance')<0.1)count++;
  assert.ok(count>900 && count<1100,'distribution: '+count);
  for(const type of ['boss','finalBoss']){
    for(let i=0;i<20;i++){
      const battle={battleId:'boss-'+i,stage:{},player:{items:[]}};
      const drop=c.rollMonsterItemDrop_(battle,{instanceId:'m',currentHp:0,type});
      assert.equal(drop.status,'pending');assert.ok(drop.reward.itemDetail.name);
    }
  }
  const full={battleId:'all-owned',stage:{},player:{hp:30,maxHp:30,stats:{hp:30},baseStats:{hp:30},items:c.getItemRows_().map(item=>({itemId:item.itemId,count:1}))}};
  const guaranteed=c.rollMonsterItemDrop_(full,{instanceId:'boss',currentHp:0,type:'boss'});
  assert.equal(guaranteed.status,'pending');
  c.decideMonsterItemDrop_(full,guaranteed.dropId,true);
  assert.equal(full.player.items.find(item=>item.itemId===guaranteed.reward.targetId).count,2);
});

test('monster drops: browser/server rolls match and repeat calls never reroll',()=>{
  const g=game(),server=copy(g.battle),browser=copy(g.battle);
  for(const b of [server,browser])b.monsters.forEach(m=>{m.currentHp=0;m.type='boss';});
  const expected=g.c.settleMonsterItemDrops_(server);
  const actual=g.engine.itemDrops(g.snapshot,browser);
  assert.deepEqual(copy(actual),copy(expected));
  const before=copy(actual);
  for(let i=0;i<10;i++)g.engine.itemDrops(g.snapshot,browser);
  assert.deepEqual(copy(browser.monsterItemDrops),before);
  const ids=Object.values(actual).map(d=>d.reward.targetId);
  assert.equal(new Set(ids).size,ids.length);
  const kill=copy(g.battle);kill.suppressMonsterScoreBookkeeping=true;
  kill.monsters[0].currentHp=1;kill.monsters[0].type='boss';kill.monsters[0].effects=[];kill.monsters[0].skillIds=[];
  g.engine.damage(g.snapshot,kill,kill.monsters[0].instanceId,100000,{damageKind:'direct'});
  assert.equal(kill.monsterItemDrops[kill.monsters[0].instanceId].status,'pending');
});

test('monster drops: claim applies inventory and stats once; ignore permanently grants nothing',()=>{
  const g=game();g.battle.monsters[0].type='boss';g.battle.monsters[0].currentHp=0;
  const drops=g.engine.itemDrops(g.snapshot,g.battle),drop=Object.values(drops)[0];
  assert.equal(g.battle.player.items.length,0);
  g.engine.decideDrop(g.snapshot,g.battle,drop.dropId,true);
  assert.equal(g.battle.player.items.length,1);
  assert.equal(g.battle.player.items[0].itemId,drop.reward.targetId);
  assert.equal(g.battle.player.items[0].count,1);
  assert.deepEqual(copy(g.battle.player.stats),copy(g.c.calculateStatsWithItemEffects_(g.battle.player.baseStats,g.battle.player.items)));
  g.engine.decideDrop(g.snapshot,g.battle,drop.dropId,true);
  assert.equal(g.battle.player.items[0].count,1);
  const other=copy(g.battle);other.battleId='other';other.monsterItemDrops={};
  const ignored=g.engine.itemDrops(g.snapshot,other)[other.monsters[0].instanceId];
  const before=copy(other.player.items);
  g.engine.decideDrop(g.snapshot,other,ignored.dropId,false);
  g.engine.decideDrop(g.snapshot,other,ignored.dropId,true);
  assert.equal(ignored.status,'ignored');assert.deepEqual(copy(other.player.items),before);
});

test('monster drops: claims survive UI payload serialization and signed next-stage replay without a second boss gift',()=>{
  const g=game();
  g.view=g.c.withRunSession_(g.view.runId,g.view.runSessionToken,'auth',()=>{
    const run=g.c.requireRun_(g.view.runId),state=g.c.getStageState_(run);
    state.battle.monsters[0].type='boss';
    const saved=g.c.saveStageState_(run.runId,state,state.battle);
    return g.c.buildBattleStateView_(saved,state);
  });
  g.view.localRunState=g.view.localRunState || g.c.decodeRunSession_(g.view.runSessionToken).run;
  g.battle=copy(g.view.battle);g.battle.status='victory';g.battle.monsters.forEach(m=>{m.currentHp=0;});
  const drops=g.engine.itemDrops(g.snapshot,g.battle),pending=Object.values(drops).filter(d=>d.status==='pending');
  for(let i=0;i<pending.length;i++)g.engine.decideDrop(g.snapshot,g.battle,pending[i].dropId,i===0);
  const html=fs.readFileSync('Battle.html','utf8');
  const ui=vm.createContext({copyStageResultValue:(v,f)=>copy(v===undefined?f:v),getBattleStatStartingStats:p=>p.startingStats || {}});
  vm.runInContext(html.match(/    function buildStageResultBattlePayload\([^]*?\n    \}/)[0],ui);
  const p={runId:g.view.runId,runSessionToken:g.view.runSessionToken,localAdvanceEnabled:true,localTransitions:[],
    battle:ui.buildStageResultBattlePayload(g.battle),stageState:copy(g.view.stageState),answerLogs:[]};
  g.x.tick(5000);
  const reward=g.c.previewRewardChoicesForStageResult(copy(p),'auth');
  assert.ok(!reward.bossItemRewards);
  p.runSessionToken=reward.runSessionToken;p.stageState.reward=copy(reward);
  const choice=reward.choices[0],selectedAtMs=g.c.Date.now();
  const local=g.engine.advance(g.view.localRunState,g.snapshot,p,choice.rewardId,reward,{selectedAtMs});
  const checked=g.c.previewRewardChoicesForStageResult({...p,localTransitions:[{payload:copy(p),rewardId:choice.rewardId,
    rewardToken:reward.localTransitionToken,selectedAtMs}]},'auth');
  assert.equal(local.bonusItemReward,null);
  assert.equal(local.battle.player.items.length,1);
  assert.equal(local.localRunState.itemsJson,checked.localRunState.itemsJson);
  assert.equal(local.battle.player.items[0].itemId,pending[0].reward.targetId);
});

test('monster drops: forged items and altered ignored decisions are rejected',()=>{
  const g=game(),battle=copy(g.battle),run=g.view.localRunState;
  battle.player.items=[{itemId:'fake',count:1}];
  assert.throws(()=>g.c.validateMonsterDropsForCommit_(run,g.battle,battle),/보유 아이템/);
  const original=copy(g.battle);original.monsters[0].type='boss';original.monsters[0].currentHp=0;
  const drop=g.c.rollMonsterItemDrop_(original,original.monsters[0]);
  g.c.decideMonsterItemDrop_(original,drop.dropId,false);
  const forged=copy(original);forged.monsterItemDrops[original.monsters[0].instanceId].status='claimed';
  assert.throws(()=>g.c.validateMonsterDropsForCommit_(run,original,forged),/이미 결정/);
});
