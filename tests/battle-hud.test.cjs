const fs=require('fs');const vm=require('vm');const assert=require('node:assert/strict');const test=require('node:test');const html=fs.readFileSync('Battle.html','utf8');
function fn(name){const start=html.indexOf('    function '+name+'(');const end=html.indexOf('\n    function ',start+1);return html.slice(start,end);}
function context(cost,current){const pips=Array.from({length:3},(_,i)=>({getAttribute:()=>i,classList:{toggle(k,v){this[k]=!!v;}}}));const label={textContent:''};const gauge={querySelectorAll:()=>pips,querySelector:()=>label,classList:{toggle(k,v){this[k]=!!v;}}};const c={document:{getElementById:()=>gauge},isAnimatingTurn:false,getCurrentActionPoint:()=>current,actionPointPreviewTarget:{isConnected:true,closest:()=>null,getAttribute:()=>cost}};vm.createContext(c);vm.runInContext(fn('refreshActionPointPreview'),c);return {c,pips,label,gauge};}

test('player and monster status icons show one stack badge and keep duration in their tooltip',()=>{
 const row={innerHTML:''};
 const c={document:{getElementById:()=>row},escapeHtml:String,getStatusIcon:()=>'',
   renderStatusSymbol:()=>'<svg></svg>',buildStatusDescription:()=>'',buildStatusStatTooltip:()=>'',
   getDisplayStatusGroups:()=>({buffs:[{name:'힘',remainingTurns:3,stackable:true,stacks:2}],
     debuffs:[{name:'출혈',remainingTurns:2,stackable:true,stacks:1}]})};
 vm.createContext(c);
 for(const name of ['buildStatusTooltip','buildStatusView','renderStatusStack','renderStatusIcons','renderPlayerStatuses'])vm.runInContext(fn(name),c);
 c.renderPlayerStatuses({});
 for(const markup of [row.innerHTML,c.renderStatusIcons({})]){
   assert.equal((markup.match(/class="status-stacks"/g)||[]).length,2);
   assert.doesNotMatch(markup,/status-turns/);
   assert.match(markup,/class="status-stacks">2<\/b>/);
   assert.match(markup,/class="status-stacks">1<\/b>/);
   assert.match(markup,/남은 턴: 3/);assert.match(markup,/남은 턴: 2/);
 }
});
test('cost preview highlights exactly the filled AP segments that will be consumed',()=>{const {c,pips,label}=context(2,3);c.refreshActionPointPreview();assert.deepEqual(pips.map(p=>p.classList['ap-will-spend']),[false,true,true]);assert.equal(label.textContent,'−2');c.actionPointPreviewTarget=null;c.refreshActionPointPreview();assert.ok(pips.every(p=>!p.classList['ap-will-spend']));assert.equal(label.textContent,'');});
test('zero cost and insufficient AP have accurate previews',()=>{let x=context(0,3);x.c.refreshActionPointPreview();assert.equal(x.label.textContent,'소모 없음');assert.ok(x.pips.every(p=>!p.classList['ap-will-spend']));x=context(3,1);x.c.refreshActionPointPreview();assert.equal(x.label.textContent,'−3 · 부족');assert.deepEqual(x.pips.map(p=>p.classList['ap-will-spend']),[true,false,false]);});
test('removed controls and active animations clear AP preview',()=>{for(const state of ['removed','animation']){const x=context(1,3);if(state==='removed')x.c.actionPointPreviewTarget.isConnected=false;else x.c.isAnimatingTurn=true;x.c.refreshActionPointPreview();assert.equal(x.label.textContent,'');assert.ok(x.pips.every(p=>!p.classList['ap-will-spend']));}});
test('action explanations reveal immediately and continue without a manual advance',()=>{let revealed=false;const c={revealBattleLog:()=>{revealed=true;},skippableAutoDelay:ms=>{assert.equal(ms,350);return Promise.resolve();}};vm.createContext(c);vm.runInContext(fn('finishActionDescription'),c);c.finishActionDescription();assert.ok(revealed);const block=html.slice(html.indexOf('    async function playTurnSequence'),html.indexOf('      var monsterEvents',html.indexOf('    async function playTurnSequence')));assert.ok(!block.includes('waitForBattleLogAdvance'));});
for(const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)){new vm.Script(match[1].replace(/<\?[\s\S]*?\?>/g,''));}

test('HP fragments match actual lost segment and disappear independently of HUD rerenders',()=>{
  const fragments=[],timers=[];const body={appendChild(e){e.parentNode=this;fragments.push(e);},removeChild(e){fragments.splice(fragments.indexOf(e),1);}};
  const c={document:{createElement:()=>({style:{},setAttribute(){}}),body},window:{setTimeout:(f,ms)=>timers.push({f,ms})}};
  vm.createContext(c);vm.runInContext(fn('getHpGaugeRect'),c);vm.runInContext(fn('spawnHpDamageFragment'),c);vm.runInContext(fn('flashHpBar'),c);
  const track={style:{},classList:{add(){},remove(){}},getBoundingClientRect:()=>({left:10,top:20,width:200,height:36})};
  c.spawnHpDamageFragment(track,75,25,100);assert.equal(fragments[0].style.left,'110px');assert.equal(fragments[0].style.width,'50px');assert.equal(fragments[0].style.height,'36px');assert.equal(track.style['--hp-shake-distance'],'3.75px');
  assert.ok(Math.abs(parseFloat(fragments[0].style['--hp-flight-x']))<=16);assert.ok(parseFloat(fragments[0].style['--hp-flight-y'])<=-24);assert.ok(parseFloat(fragments[0].style['--hp-flight-y'])>=-42);
  c.spawnHpDamageFragment(track,75,0,100);assert.equal(fragments.length,1);const cleanup=timers.find(timer=>timer.ms===1100);assert.ok(cleanup);cleanup.f();assert.equal(fragments.length,0);
});

test('shield loss flies from shield segment and only full depletion triggers break burst',()=>{
 const calls=[],bursts=[],sounds=[];const c={playBattleSound:key=>sounds.push(key),spawnHpDamageFragment:(...args)=>calls.push(args),document:{createElement:()=>({style:{},setAttribute(){}}),body:{appendChild:e=>bursts.push(e)}},window:{setTimeout(){}}};vm.createContext(c);vm.runInContext(fn('spawnShieldDamageFeedback'),c);
 const track={getBoundingClientRect:()=>({left:0,top:50,width:200})};c.spawnShieldDamageFeedback(track,60,20,10,100);assert.equal(calls[0][1],80);assert.equal(calls[0][2],10);assert.equal(calls[0][4],true);assert.equal(bursts.length,0);assert.equal(sounds.length,0);c.spawnShieldDamageFeedback(track,60,10,0,100);assert.equal(bursts.length,1);
 const sprite={getBoundingClientRect:()=>({left:100,top:200,width:180,height:220})};c.spawnShieldDamageFeedback(track,60,10,0,100,sprite);assert.equal(bursts[1].style.left,'190px');assert.equal(bursts[1].style.top,'310px');assert.deepEqual(sounds,['shieldBreak','shieldBreak']);
 c.spawnShieldDamageFeedback(track,60,0,0,100);c.spawnShieldDamageFeedback(track,60,10,10,100);assert.equal(sounds.length,2);
});

test('monster damage fragments exclude the metal border and flash only the red gauge',()=>{
 const fragments=[],fill={style:{width:'75%'}};
 const c={document:{createElement:()=>({style:{},setAttribute(){}}),body:{appendChild:e=>fragments.push(e)}},window:{setTimeout(){}}};
 vm.createContext(c);for(const name of ['getHpGaugeRect','flashHpBar','spawnHpDamageFragment'])vm.runInContext(fn(name),c);
 const track={style:{},offsetWidth:240,offsetHeight:26,clientLeft:3,clientTop:3,clientWidth:234,clientHeight:20,
  querySelector:()=>fill,classList:{contains:()=>true,add(){},remove(){}},getBoundingClientRect:()=>({left:10,top:20,width:240,height:26})};
 c.spawnHpDamageFragment(track,75,25,100);
 assert.equal(fragments[0].style.left,'130px');assert.equal(fragments[0].style.top,'23px');
 assert.equal(fragments[0].style.width,'58.5px');assert.equal(fragments[0].style.height,'20px');
 assert.equal(track.style['--hp-flash-width'],'75%');
});

test('damage numbers use the midpoint of lost HP and repeated shield impacts keep their newest pulse',()=>{
 const calls=[],timers=[];const fill={style:{width:'25%'}},track={querySelector:()=>fill},slot={querySelector:()=>track};
 const c={currentDamageEfficiency:null,document:{querySelector:()=>track},spawnFloatingText:(...args)=>{calls.push(args);},window:{setTimeout:f=>timers.push(f)}};vm.createContext(c);vm.runInContext(fn('spawnFloatingDamage'),c);vm.runInContext(fn('pulseShieldOutline'),c);
 c.spawnFloatingDamage({closest:()=>slot},20,'damage-white',false);assert.equal(calls[0][4],.25);
 track.damageNumberRatio=.35;c.spawnFloatingDamage({closest:()=>slot},20,'damage-white',false);assert.equal(calls[1][4],.35);
 const element={dataset:{},classList:{add(k){this[k]=true;},remove(k){this[k]=false;}}};
 c.pulseShieldOutline(element,null);c.pulseShieldOutline(element,null);timers[0]();assert.equal(element.classList['shield-impact-pulse'],true);timers[1]();assert.equal(element.classList['shield-impact-pulse'],false);
});

test('recovery fragment covers only the healed portion and cleans up after landing',()=>{
 const fragments=[],timers=[];const c={document:{createElement:()=>({style:{},setAttribute(){}}),body:{appendChild(e){e.parentNode=this;fragments.push(e);},removeChild(e){fragments.splice(fragments.indexOf(e),1);}}},window:{setTimeout:(f,ms)=>timers.push({f,ms})}};
 vm.createContext(c);vm.runInContext(fn('getHpGaugeRect'),c);vm.runInContext(fn('spawnHpRecoveryFragment'),c);const fill={style:{}},track={querySelector:selector=>selector.includes('hp-current')?fill:null,getBoundingClientRect:()=>({left:10,top:20,width:200,height:36})};c.spawnHpRecoveryFragment(track,50,20,100);assert.equal(fragments[0].style.left,'110px');assert.equal(fragments[0].style.width,'40px');assert.equal(fill.style.width,'50%');assert.equal(timers[0].ms,500);timers[0].f();assert.equal(fill.style.width,'70%');assert.equal(timers[1].ms,750);timers[1].f();assert.equal(fragments.length,0);
});

test('HP and shield text count down together without exposing intermediate values to the next hit',()=>{
 let now=0;const frames=[],text={textContent:'100 + 20 / 100'},c={Date:{now:()=>now},window:{requestAnimationFrame:f=>frames.push(f)}};
 vm.createContext(c);for(const name of ['formatHpShieldText','getHpTextMatch','animateHpShieldText'])vm.runInContext(fn(name),c);
 c.animateHpShieldText(text,100,80,20,0,100);assert.equal(c.getHpTextMatch(text)[1],80);assert.equal(c.getHpTextMatch(text)[2],0);assert.match(text.innerHTML,/100/);
 now=180;frames.shift()();assert.notEqual(text.innerHTML,'80 / 100');assert.match(text.innerHTML,/shield-value/);
 now=650;frames.shift()();assert.equal(text.innerHTML,'80 / 100');
});

test('damage typography follows HP loss, efficiency and critical suffixes without CRIT prefix',()=>{
 const elements=[],track={damageHpRatio:.04,querySelector:()=>({style:{width:'50%'}})},slot={querySelector:()=>track};
 const node=()=>({style:{setProperty(k,v){this[k]=v;}},children:[],setAttribute(){},appendChild(e){this.children.push(e);},classList:{toggle(k,v){this[k]=v;}}});
 const c={currentDamageEfficiency:.99,document:{querySelector:()=>track,createElement:node},spawnFloatingText:(anchor,text,tone)=>{const e=Object.assign(node(),{text,tone});elements.push(e);return e;}};
 vm.createContext(c);vm.runInContext(fn('spawnFloatingDamage'),c);const anchor={closest:()=>slot};
 c.spawnFloatingDamage(anchor,10,'damage-white',false);assert.equal(elements[0].text,'-10');assert.equal(elements[0].tone,'damage-low-efficiency');
 c.currentDamageEfficiency=1;c.spawnFloatingDamage(anchor,10,'damage-white',false);assert.equal(elements[1].text,'-10!');assert.equal(elements[1].tone,'damage-efficient');
 track.damageHpRatio=.5;c.spawnFloatingDamage(anchor,50,'damage-white',true);assert.equal(elements[2].text,'-50!!');assert.equal(elements[2].tone,'damage-critical');assert.ok(parseFloat(elements[2].style.fontSize)>parseFloat(elements[0].style.fontSize));
 assert.equal(elements[2].classList['damage-heavy'],true);assert.equal(elements[2].children[0].children.length,8);
 track.damageHpRatio=.499;c.spawnFloatingDamage({closest:()=>null},49,'damage-red',false);assert.equal(elements[3].classList['damage-heavy'],false);assert.equal(elements[3].children.length,0);
 track.damageHpRatio=.5;c.spawnFloatingDamage({closest:()=>null},50,'damage-red',true);assert.equal(elements[4].classList['damage-heavy'],true);assert.equal(elements[4].children.length,1);
 c.spawnFloatingDamage(anchor,0,'damage-white',true);assert.equal(elements[5].classList['damage-heavy'],false);assert.equal(elements[5].children.length,0);
});

test('first score confirmation cancels counting and displays every final value; second proceeds',()=>{
 const classes=()=>({add(){},remove(){}}),row={classList:classes(),getAttribute:()=>120,value:{},querySelector(){return this.value;}};
 const elements={scoreDeltaText:{closest:()=>({classList:classes()})},scoreTotalText:{closest:()=>({classList:classes()})}};
 const response={scoreSummary:{scoreDelta:120,totalScore:620}};let clears=0,closed=0,next=0;
 const c={pendingBossItemChoice:null,scoreAnimationDone:false,pendingScoreModalResponse:response,currentScoreModalSummary:response.scoreSummary,scoreModalAwaitingFinalResponse:false,
 document:{querySelectorAll:()=>[row],getElementById:id=>elements[id]},clearScoreAnimation:()=>clears++,formatScore:n=>n+'점',updateScoreModalConfirmButton(){},closeScoreModal:()=>closed++,handleRewardSelectionResponse:r=>{assert.equal(r,response);next++;}};
 vm.createContext(c);vm.runInContext(fn('finishScoreAnimationNow'),c);vm.runInContext(fn('confirmScoreModal'),c);
 c.confirmScoreModal();assert.equal(row.value.textContent,'+120점');assert.equal(elements.scoreDeltaText.textContent,'+120점');assert.equal(elements.scoreTotalText.textContent,'620점');assert.equal(c.pendingScoreModalResponse,response);assert.equal(closed,0);assert.equal(next,0);assert.equal(clears,1);
 c.confirmScoreModal();assert.equal(closed,1);assert.equal(next,1);
});

test('repeated HP hits restart white flash without an earlier cleanup cancelling the latest flash',()=>{
 const timers=[],track={classList:{add(k){this[k]=true;},remove(k){this[k]=false;}}};
 const c={window:{setTimeout:f=>timers.push(f)}};vm.createContext(c);vm.runInContext(fn('flashHpBar'),c);
 c.flashHpBar(track);c.flashHpBar(track);timers[0]();assert.equal(track.classList['hp-hit-flash'],true);timers[1]();assert.equal(track.classList['hp-hit-flash'],false);
});


test('rest waits 2.5 seconds from click, blocks repeated clicks and cancels on expiry',()=>{
  let now=1000,preview=0,selections=0;const timers=[];
  const c={Date:{now:()=>now},currentView:{},stageIntroPlaying:false,rewardSelectionApplying:false,workbookDeadlineExpired:false,floorIntermissionActionPending:false,FLOOR_REST_TRANSITION_DELAY_MS:2500,
    isFloorIntermissionView:()=>true,isBattleResultLoading:()=>false,pushLog(){},setBattleInputLocked(){},setPlayerTurn(){},
    loadFloorIntermissionRewardView:success=>{now+=100;success({choices:[{rewardId:'rest'}]});},
    getFloorIntermissionChoice:()=>({rewardId:'rest'}),playFloorRestEffect:()=>preview++,selectRewardChoice:()=>selections++,window:{setTimeout:(f,ms)=>timers.push({f,ms})}};
  vm.createContext(c);vm.runInContext(fn('chooseFloorIntermissionAction'),c);
  c.chooseFloorIntermissionAction('rest');c.chooseFloorIntermissionAction('rest');
  assert.equal(preview,1);assert.equal(timers.length,1);assert.equal(timers[0].ms,2400);
  timers.shift().f();assert.equal(selections,1);assert.equal(c.floorIntermissionActionPending,false);
  c.chooseFloorIntermissionAction('rest');c.workbookDeadlineExpired=true;timers.shift().f();assert.equal(selections,1);
});

test('failed rest choice loading releases the pending click lock',()=>{
  const c={currentView:{},stageIntroPlaying:false,rewardSelectionApplying:false,workbookDeadlineExpired:false,floorIntermissionActionPending:false,
    isFloorIntermissionView:()=>true,isBattleResultLoading:()=>false,pushLog(){},setBattleInputLocked(){},setPlayerTurn(){},
    loadFloorIntermissionRewardView:(success,failure)=>failure({message:'network'})};
  vm.createContext(c);vm.runInContext(fn('chooseFloorIntermissionAction'),c);c.chooseFloorIntermissionAction('rest');assert.equal(c.floorIntermissionActionPending,false);
});


test('shield break audio lowers pitch by 20 percent and layers over active attack sounds',()=>{
 const attack={};let played=0;
 const makeAudio=()=>({playbackRate:1,preservesPitch:true,mozPreservesPitch:true,webkitPreservesPitch:true,addEventListener(){},play(){played++;return Promise.resolve();}});
 const c={activeBattleSounds:[attack],isSoundEnabled:()=>true,removeActiveBattleSound(){},queuePendingBattleSound(){}};
 vm.createContext(c);vm.runInContext(fn('playResolvedBattleSound'),c);
 const shield=makeAudio();c.playResolvedBattleSound('shieldBreak',{cloneNode:()=>shield});
 assert.equal(shield.playbackRate,.8);assert.equal(shield.preservesPitch,false);assert.equal(shield.mozPreservesPitch,false);assert.equal(shield.webkitPreservesPitch,false);
 assert.equal(c.activeBattleSounds[0],attack);assert.equal(c.activeBattleSounds[1],shield);
 const hit=makeAudio();c.playResolvedBattleSound('hitDefault',{cloneNode:()=>hit});assert.equal(hit.playbackRate,1);assert.equal(hit.preservesPitch,true);assert.equal(played,2);
 const urls={ASSET_BASE_URL:'https://assets.test',BATTLE_SOUND_FILES:{shieldBreak:'Resources/Sounds/Shield_Break.mp3'},BATTLE_SOUND_EXTENSIONS:['wav','mp3','ogg']};
 vm.createContext(urls);vm.runInContext(fn('getBattleSoundUrls'),urls);
 assert.deepEqual(Array.from(urls.getBattleSoundUrls('shieldBreak')),['https://assets.test/Resources/Sounds/Shield_Break.mp3']);
});


test('big damage sound requires at least 100 percent question efficiency',()=>{
 const sounds=[],c={playBattleSound:key=>sounds.push(key)};vm.createContext(c);vm.runInContext(fn('playEfficientAttackSound'),c);
 for(const value of [undefined,null,0,.5,.999,NaN,Infinity])c.playEfficientAttackSound(value);
 assert.equal(sounds.length,0);
 for(const value of [1,1.2,2])c.playEfficientAttackSound(value);
 assert.deepEqual(sounds,['bigDamage','bigDamage','bigDamage']);
 const sequence=html.slice(html.indexOf('    async function playTurnSequence'),html.indexOf('    function collectSimultaneousEvents'));
 assert.match(sequence,/animateMonsterHit\(event.targetMonsterId, event.damage, event.hpDamage, event.shieldDamage, event.isCritical, currentDamageEfficiency, event.displayDamage\)/);
 const effect=sequence.slice(sequence.indexOf("if (event.actor === 'effect')"),sequence.indexOf("if (event.actor === 'player')"));
 assert.doesNotMatch(effect,/animateMonsterHit\([^\n]*currentDamageEfficiency/);
 assert.doesNotMatch(fn('animatePlayerHit'),/playEfficientAttackSound/);
});

test('monster and player floating numbers show attack damage while HUD applies only HP and shield deltas',async()=>{
 const floats=[],deltas=[];
 const classes={add(){},remove(){},contains:()=>true};
 const target={classList:classes,dataset:{},closest:()=>({querySelector:()=>target})};
 const c={document:{querySelector:()=>target,getElementById:()=>target},cssEscape:String,
  applyMonsterDamageDelta:(...args)=>deltas.push(args),applyPlayerDamageDelta:(...args)=>deltas.push(args),
  spawnFloatingDamage:(anchor,damage)=>floats.push(damage),playEfficientAttackSound(){},playBattleSound(){},playBattleHitSound(){},
  spawnShieldBlockIcon(){},setMonsterSpriteState(){},isMonsterDefeatedInDom:()=>false,resetMonsterSpriteState(){},
  restartScreenFlash(){},spawnPlayerScreenImpact(){},animatePlayerShieldBlock(){},
  skippableAutoDelay:()=>Promise.resolve(),window:{setTimeout:f=>f()},HIT_STATE_HOLD_MS:0,ATTACK_EFFECT_DELAY_MS:0};
 vm.createContext(c);vm.runInContext(fn('animateMonsterHit'),c);vm.runInContext(fn('animatePlayerHit'),c);
 await c.animateMonsterHit('m',15,5,10,false,1,100);
 await c.animateMonsterHit('m',10,0,10,false,1,100);
 c.animatePlayerHit(100,80,20,false);
 c.animatePlayerHit(100,0,100,false);
 assert.deepEqual(floats,[100,100,100,100]);
 assert.deepEqual(deltas,[['m',5,10],['m',0,10],[80,20],[0,100]]);
});

test('efficient attack sound also accompanies shield hits, but skips zero damage',async()=>{
 const sounds=[],target={closest:()=>null,classList:{contains:()=>false}};
 const c={document:{querySelector:()=>target},cssEscape:x=>x,applyMonsterDamageDelta(){},
   playEfficientAttackSound:eff=>{if(eff>=1)sounds.push('bigDamage');},playBattleSound:key=>sounds.push(key),
   spawnFloatingDamage(){},skippableAutoDelay:()=>Promise.resolve(),ATTACK_EFFECT_DELAY_MS:0};
 vm.createContext(c);vm.runInContext(fn('animateMonsterHit'),c);
 await c.animateMonsterHit('m',0,0,10,false,1);assert.deepEqual(sounds,['bigDamage','blockSuccess']);
 sounds.length=0;await c.animateMonsterHit('m',0,0,0,false,1);assert.equal(sounds.length,0);
 await c.animateMonsterHit('m',0,0,10,false,.99);assert.deepEqual(sounds,['blockSuccess']);
});
