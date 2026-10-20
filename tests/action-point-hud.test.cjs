const fs=require('fs');const vm=require('vm');const assert=require('node:assert/strict');const test=require('node:test');const html=fs.readFileSync('Battle.html','utf8');
function fn(name){const start=html.indexOf('    function '+name+'(');const end=html.indexOf('\n    function ',start+1);return html.slice(start,end);}
test('AP above three survives server and client normalization and adds one HUD segment per point',()=>{
 const server=vm.createContext({syncConfiguredCombatStats_(){},GAME_RULES:{DEFAULT_MAX_ACTION_POINT:3}});
 vm.runInContext(fs.readFileSync('BattleService.gs','utf8'),server);
 const gauge={innerHTML:'',setAttribute(key,value){this[key]=value;}};
 const client=vm.createContext({document:{getElementById:id=>id==='actionPanelApGauge'?gauge:null},isAnimatingTurn:false,refreshActionPointPreview(){}});
 vm.runInContext(fn('normalizeClientActionPoints')+fn('renderActionPointGauges'),client);
 for(const max of [3,4,5,8]){
  const battle={player:{baseMaxActionPoint:3,actionPointMaxDelta:max-3,effects:[]}};
  server.normalizePlayerActionPoints_(battle,true);
  assert.equal(battle.player.maxActionPoint,max);assert.equal(battle.player.currentActionPoint,max);
  battle.player.currentActionPoint-=1;
  client.normalizeClientActionPoints(battle.player);client.renderActionPointGauges(battle.player);
  assert.equal(battle.player.maxActionPoint,max);
  assert.equal((gauge.innerHTML.match(/data-ap-index=/g)||[]).length,max);
  assert.equal((gauge.innerHTML.match(/ap-pip filled/g)||[]).length,max-1);
  assert.match(gauge.innerHTML,/^<span class="ap-label">행동력<\/span><span class="ap-icons">/);
  assert.doesNotMatch(gauge.innerHTML,/<strong>|\d+ \/ \d+/);
  assert.equal(gauge['aria-label'],'행동력 '+(max-1)+' / '+max);
 }
});
