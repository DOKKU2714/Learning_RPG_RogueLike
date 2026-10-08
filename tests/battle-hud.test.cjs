const fs=require('fs');const vm=require('vm');const assert=require('node:assert/strict');const test=require('node:test');const html=fs.readFileSync('Battle.html','utf8');
function fn(name){const start=html.indexOf('    function '+name+'(');const end=html.indexOf('\n    function ',start+1);return html.slice(start,end);}
function context(cost,current){const pips=Array.from({length:3},(_,i)=>({getAttribute:()=>i,classList:{toggle(k,v){this[k]=!!v;}}}));const label={textContent:''};const gauge={querySelectorAll:()=>pips,querySelector:()=>label,classList:{toggle(k,v){this[k]=!!v;}}};const c={document:{getElementById:()=>gauge},isAnimatingTurn:false,getCurrentActionPoint:()=>current,actionPointPreviewTarget:{isConnected:true,closest:()=>null,getAttribute:()=>cost}};vm.createContext(c);vm.runInContext(fn('refreshActionPointPreview'),c);return {c,pips,label,gauge};}
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
 const calls=[],bursts=[];const c={spawnHpDamageFragment:(...args)=>calls.push(args),document:{createElement:()=>({style:{},setAttribute(){}}),body:{appendChild:e=>bursts.push(e)}},window:{setTimeout(){}}};vm.createContext(c);vm.runInContext(fn('spawnShieldDamageFeedback'),c);
 const track={getBoundingClientRect:()=>({left:0,top:50,width:200})};c.spawnShieldDamageFeedback(track,60,20,10,100);assert.equal(calls[0][1],80);assert.equal(calls[0][2],10);assert.equal(calls[0][4],true);assert.equal(bursts.length,0);c.spawnShieldDamageFeedback(track,60,10,0,100);assert.equal(bursts.length,1);
 const sprite={getBoundingClientRect:()=>({left:100,top:200,width:180,height:220})};c.spawnShieldDamageFeedback(track,60,10,0,100,sprite);assert.equal(bursts[1].style.left,'190px');assert.equal(bursts[1].style.top,'310px');
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
 const c={currentDamageEfficiency:.99,document:{querySelector:()=>track},spawnFloatingText:(anchor,text,tone)=>{const e={text,tone,style:{}};elements.push(e);return e;}};
 vm.createContext(c);vm.runInContext(fn('spawnFloatingDamage'),c);const anchor={closest:()=>slot};
 c.spawnFloatingDamage(anchor,10,'damage-white',false);assert.equal(elements[0].text,'-10');assert.equal(elements[0].tone,'damage-low-efficiency');
 c.currentDamageEfficiency=1;c.spawnFloatingDamage(anchor,10,'damage-white',false);assert.equal(elements[1].text,'-10!');assert.equal(elements[1].tone,'damage-efficient');
 track.damageHpRatio=.5;c.spawnFloatingDamage(anchor,50,'damage-white',true);assert.equal(elements[2].text,'-50!!');assert.equal(elements[2].tone,'damage-critical');assert.ok(parseFloat(elements[2].style.fontSize)>parseFloat(elements[0].style.fontSize));
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
