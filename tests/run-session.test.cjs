const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

function context() {
  const cache = new Map(), sheets = new Map(), reads = [], writes = [];
  let clock = Date.parse('2026-10-06T05:00:00Z'), uuid = 0;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const blob = (value, contentType = null, name = null) => {
    const bytes = Buffer.isBuffer(value) ? value : Array.isArray(value) ? Buffer.from(value.map(x => x & 255)) : Buffer.from(String(value));
    return { getBytes: () => [...bytes], getDataAsString: () => bytes.toString('utf8'), getContentType: () => contentType, getName: () => name };
  };
  const requireBlobContentType = value => {
    if (!value.getContentType()) throw new Error('Exception: 이 작업에서 Blob 개체에 널(null)이 아닌 콘텐츠 유형이 있어야 합니다.');
  };
  function sheet(name, headers = [], objects = []) {
    const result = {
      rows: [Array.from(headers), ...objects.map(o => headers.map(k => o[k] === undefined ? '' : o[k]))],
      getLastRow() { return this.rows.length; },
      getLastColumn() { return Math.max(...this.rows.map(r => r.length), 0); },
      getMaxColumns() { return Math.max(this.getLastColumn(), 100); },
      insertColumnsAfter() {}, setFrozenRows() {},
      appendRow(row) { writes.push(name); this.rows.push(Array.from(row)); },
      getRange(row, col, height = 1, width = 1) {
        return {
          getValues: () => { reads.push(name); return Array.from({length: height}, (_, i) => Array.from({length: width}, (_, j) => result.rows[row - 1 + i]?.[col - 1 + j] ?? '')); },
          getValue() { return this.getValues()[0][0]; },
          setValues(values) { writes.push(name); values.forEach((r,i) => r.forEach((v,j) => { result.rows[row-1+i] ||= []; result.rows[row-1+i][col-1+j] = v; })); return this; },
          setValue(v) { return this.setValues([[v]]); },
          clearContent() { return this.setValues(Array.from({length: height}, () => Array(width).fill(''))); },
        };
      },
    };
    sheets.set(name, result); return result;
  }
  const spreadsheet = { getSheetByName: name => sheets.get(name) || null, insertSheet: name => sheet(name) };
  const c = vm.createContext({ console, Date: ClockDate, Math: Object.assign(Object.create(Math), { random: () => .4 }),
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key) ?? null, put: (key,value) => cache.set(key,value), remove: key => cache.delete(key) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock: () => true }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-signing-key', setProperty() {} }) },
    SpreadsheetApp: { openById: () => spreadsheet, getActiveSpreadsheet: () => spreadsheet },
    Utilities: {
      Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
      getUuid: () => (++uuid).toString(16).padStart(32, '0'), get uuid() {return uuid;},
      base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'),
      base64DecodeWebSafe: value => [...Buffer.from(value,'base64url')],
      computeDigest: (alg,value) => [...crypto.createHash(alg).update(value).digest()],
      computeHmacSha256Signature: (value,key) => [...crypto.createHmac('sha256',key).update(value).digest()],
      newBlob: blob,
      gzip: (value, name) => { requireBlobContentType(value); return blob(zlib.gzipSync(Buffer.from(value.getBytes())), 'application/gzip', name); },
      ungzip: value => { requireBlobContentType(value); return blob(zlib.gunzipSync(Buffer.from(value.getBytes())), 'application/json'); },
      formatDate: value => new Date(value).toISOString(),
    },
  });
  for (const name of ['Config.gs','Constants.gs','MonsterAiMaster.gs','Serialization.gs','Database.gs','UserService.gs','WorkbookService.gs','StatsService.gs','ItemService.gs','SkillService.gs','SharedRuleEngine.gs','QuestionService.gs','BattleService.gs','RewardService.gs','RunSessionService.gs','LocalRunEngine.gs']) vm.runInContext(read(name), c, {filename:name});
  for (const schema of c.DB_SCHEMA) sheet(schema.sheetName, schema.headers);
  const seed = (name, rows) => { const s=sheets.get(name); s.rows=[s.rows[0], ...rows.map(o=>s.rows[0].map(k=>o[k] ?? ''))]; };
  seed(c.DB_SHEETS.SETTINGS, c.MASTER_SETTINGS);
  seed(c.DB_SHEETS.MONSTERS, c.MASTER_MONSTERS);
  seed(c.DB_SHEETS.MONSTER_GROUPS, c.MASTER_MONSTER_GROUPS);
  seed(c.DB_SHEETS.STAGES, c.buildStageSeedData_());
  seed(c.DB_SHEETS.MONSTER_AI, [...c.MASTER_MONSTER_AI, ...c.EXTRA_MONSTER_AI]);
  seed(c.DB_SHEETS.SKILLS, c.MASTER_SKILLS);
  seed(c.DB_SHEETS.ITEMS, c.MASTER_ITEMS);
  seed(c.DB_SHEETS.EFFECTS, c.MASTER_EFFECTS);
  seed(c.DB_SHEETS.REWARDS, c.MASTER_REWARDS);
  seed(c.DB_SHEETS.PLAYERS, [{playerId:'p', displayName:'Tester', isActive:true}]);
  seed(c.DB_SHEETS.PLAYER_DATA, [c.buildInitialBattleStatsPlayerData_('p')]);
  seed(c.DB_SHEETS.WORKBOOK_PLAYER_DATA, [c.buildInitialWorkbookPlayerData_('w','p')]);
  seed(c.DB_SHEETS.WORKBOOKS, [{workbookId:'w', workbookName:'Test', status:'active', playEnabled:true, playEndsAt:'', playTimeLimitEnabled:false}]);
  c.getCurrentPlayer_ = token => ({playerId:token === 'other' ? 'other' : 'p'});
  c.canStartGame_ = () => ({canStart:true, activeRuns:[], workbook:c.findRowByKey_(c.DB_SHEETS.WORKBOOKS,'workbookId','w'), questionManifest:{startingScore:100, approvedQuestionCreatorIds:['p','other']}});
  return { c, cache, reads, writes, sheets, seed, tick:ms=>{clock+=ms;} };
}
function start(x) { return x.c.startRun('p','auth','w',{}); }
function prepareVictory(x, view) {
  const session=x.c.decodeRunSession_(view.runSessionToken);
  const run=session.run;
  const state=JSON.parse(run.stageStateJson);
  let battle=state.battle ? copy(state.battle) : {battleId:'rest-'+run.currentFloor, stage:{stageId:state.stageId,floor:run.currentFloor,stage:run.currentStage}, player:{hp:run.currentHp, shield:0, stats:JSON.parse(run.statsJson),baseStats:JSON.parse(run.statsJson)},monsters:[]};
  battle.status='victory';
  battle.monsters.forEach(m=>{m.currentHp=0;});
  battle.monsterScoreState={battleId:battle.battleId,monsterScore: battle.monsters.length ? 100 : 0,byMonsterId:{},scoreAwardedToRun:0};
  const payload={runId:run.runId,runSessionToken:view.runSessionToken,battle,answerLogs:[],stageState:{scoreState:state.scoreState,usedQuestionIds:[],fallbackEvents:[],reward:state.reward||null}};
  const reward=view.rewardView || x.c.previewRewardChoicesForStageResult(payload,'auth');
  payload.stageState.reward=copy(reward);
  return {payload,reward};
}
function advance(x, view, rewardType='stat') {
  const prepared=prepareVictory(x,view);
  const chosen=prepared.reward.choices.find(r=>r.type===rewardType)||prepared.reward.choices[0];
  return { ...prepared, chosen, response:x.c.advanceRunStage(prepared.payload,chosen.rewardId,'auth',prepared.reward) };
}
const progressSheets=['Runs','PlayerData','WorkbookPlayerData','BattleLogs','AnswerLogs','BattleAnswerLogQueue','RunSettlements'];


test('signed checkpoints explicitly type JSON and gzip blobs and round-trip Korean text',()=>{
  const x=context(), session={version:1,revision:3,run:{runId:'mime-check',playerId:'p',displayName:'학교에서 탈출하기',score:1255},answerBatches:[],battleLogs:[]};
  const calls=[], original=x.c.Utilities.newBlob;
  x.c.Utilities.newBlob=(data,type,name)=>{calls.push({type,name});return original(data,type,name);};
  const token=x.c.encodeRunSession_(session);
  assert.deepEqual(copy(x.c.decodeRunSession_(token)),session);
  assert.deepEqual(calls,[{type:'application/json',name:'run-session.json'},{type:'application/gzip',name:'run-session.json.gz'}]);
  assert.throws(()=>x.c.Utilities.gzip(original('{}')),/콘텐츠 유형/);
  assert.throws(()=>x.c.Utilities.ungzip(original([...zlib.gzipSync(Buffer.from('{}'))])),/콘텐츠 유형/);
});

test('initial definitions are reused across stages, intermediate progress never reaches sheets',()=>{
  const x=context(), first=start(x);
  assert.ok(first.gameDataSnapshot && first.runSessionToken);
  const initial=copy(x.c.findRowByKeyUncached_('Runs','runId',first.runId));
  x.reads.length=0; x.writes.length=0;
  const result=advance(x,first);
  assert.ok(result.response.battle); assert.equal(result.response.nextBattlePending,false);
  assert.equal(result.response.battle.stage.stage,2);
  assert.ok(result.response.score>100);
  assert.deepEqual(copy(x.c.findRowByKeyUncached_('Runs','runId',first.runId)),initial);
  assert.equal(x.writes.filter(n=>progressSheets.includes(n)).length,0);
  assert.equal(x.reads.filter(n=>x.c.isFreshGameDataSheet_(n)).length,0);
  const duplicate=x.c.advanceRunStage(result.payload,result.chosen.rewardId,'auth',result.reward);
  assert.equal(duplicate.battle.battleId,result.response.battle.battleId);
  assert.equal(duplicate.score,result.response.score);
});

test('cache eviction restores signed progress and the original definitions, without new master reads',()=>{
  const x=context(); let view=start(x);
  view=advance(x,view).response;
  x.cache.clear(); x.reads.length=0; x.writes.length=0;
  const result=advance(x,view);
  assert.equal(result.response.battle.stage.stage,3);
  assert.ok(result.response.score>view.score);
  assert.equal(x.reads.filter(n=>x.c.isFreshGameDataSheet_(n)).length,0);
  assert.equal(x.writes.filter(n=>progressSheets.includes(n)).length,0);
});

test('normal defeat saves accumulated rewards, currency, score and progress once',()=>{
  const x=context(); let view=start(x);
  view=advance(x,view).response; view=advance(x,view).response;
  const session=x.c.decodeRunSession_(view.runSessionToken), battle=copy(view.battle);
  battle.status='defeat'; battle.player.hp=0;
  const payload={runId:view.runId,runSessionToken:view.runSessionToken,battle,answerLogs:[],stageState:copy(view.stageState)};
  const saved=x.c.commitStageResult(payload,'auth');
  const row=x.c.findRowByKeyUncached_('Runs','runId',view.runId);
  assert.equal(row.status,'failed'); assert.equal(row.sessionSettled,true);
  assert.equal(row.currentStage,3); assert.equal(row.score,view.score);
  assert.equal(row.statsJson,session.run.statsJson); assert.equal(row.currency,session.run.currency);
  const player=x.c.findRowByKeyUncached_('PlayerData','playerId','p');
  assert.equal(player.bestScore,row.score); assert.equal(player.maxStage,3); assert.equal(player.currency,row.currency);
  assert.equal(x.c.getWorkbookPlayerData_('w','p').currency,row.currency);
  const writes=x.writes.length;
  assert.equal(x.c.commitStageResult(payload,'auth').score,saved.score);
  assert.equal(x.writes.length,writes);
});

test('all floors, rest choices and final victory retain existing rules and settle only once',()=>{
  const x=context(); let view=start(x), previousScore=100, count=0;
  const started=x.c.decodeRunSession_(view.runSessionToken).run.startedAt;
  while (!view.cleared) {
    x.tick(5000); x.writes.length=0;
    const next=advance(x,view,view.showReward?'rest':['stat','skill','skillUpgrade','item'][count%4]);
    view=next.response; count++;
    const session=x.c.decodeRunSession_(view.runSessionToken);
    assert.ok(Number(session.run.score)>=previousScore); previousScore=Number(session.run.score);
    assert.equal(session.run.startedAt,started);
    if (!view.cleared) assert.equal(x.writes.filter(n=>progressSheets.includes(n)).length,0);
    assert.ok(count<=30);
  }
  assert.equal(count,29);
  const run=x.c.findRowByKeyUncached_('Runs','runId',view.run.runId);
  assert.equal(run.status,'cleared'); assert.equal(run.sessionSettled,true);
  assert.equal(run.clearTimeMs,29*5000);
  assert.equal(x.c.findRowByKeyUncached_('PlayerData','playerId','p').bestScore,run.score);
  assert.equal(x.c.getWorkbookPlayerData_('w','p').maxFloor,5);
});

test('time expiry settles the current progress as defeat, including cumulative stage scores',()=>{
  const x=context(); let view=start(x); view=advance(x,view).response;
  x.c.updateRowByKey_('Workbooks','workbookId','w',{playTimeLimitEnabled:true,playEndsAt:new Date('2026-10-06T05:00:00Z')});
  const payload={runId:view.runId,runSessionToken:view.runSessionToken,battle:copy(view.battle),answerLogs:[],stageState:copy(view.stageState)};
  const saved=x.c.commitStageResult(payload,'auth');
  assert.equal(saved.battle.status,'defeat'); assert.equal(saved.score,view.score);
  assert.equal(x.c.findRowByKeyUncached_('Runs','runId',view.runId).sessionSettled,true);
});

test('signed progress rejects tampering and a different authenticated owner',()=>{
  const x=context(), view=start(x), state=x.c.decodeRunSession_(view.runSessionToken);
  const token=view.runSessionToken;
  assert.throws(()=>x.c.decodeRunSession_(token.slice(0,-1)+(token.endsWith('a')?'b':'a')),/검증/);
  assert.throws(()=>x.c.withRunSession_(view.runId,token,'other',()=>({})),/플레이어/);
  state.run.score+=100000;
  const payload=Buffer.from(zlib.gzipSync(Buffer.from(JSON.stringify(state)))).toString('base64url');
  assert.throws(()=>x.c.decodeRunSession_(payload+'.'+token.split('.')[1]),/검증/);
});

test('client avoids a victory-save RPC and uses a single reward/next-battle request',()=>{
  const html=read('Battle.html');
  const extract=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
  const c=vm.createContext({runSessionToken:'signed',currentView:{battle:{status:'victory'}},called:0});
  vm.runInContext(extract('commitStageResultIfNeeded'),c);
  c.commitStageResultIfNeeded(()=>c.called++);
  assert.equal(c.called,1);
  assert.match(extract('selectRewardChoice'),/\.advanceRunStage\(/);
  assert.doesNotMatch(extract('selectRewardChoice'),/\.selectReward\(|\.prepareNextBattleAfterReward\(/);
  assert.doesNotMatch(extract('preloadFollowingStageStatic'),/google\.script/);
  assert.doesNotMatch(extract('ensureNextFloorGameDataRefresh'),/requestGameDataSnapshot/);
  assert.match(extract('ensureNextFloorQuestionRefresh'),/refreshBattleQuestionSnapshot/);
});


test('answer and battle logs stay buffered until defeat and survive cache loss',()=>{
  const x=context(), first=start(x), prepared=prepareVictory(x,first);
  const question={questionId:'q',workbookId:'w',creatorId:'p',type:'shortAnswer',prompt:'One?',answer:'1',difficulty:1,answerAliases:'[]'};
  prepared.payload.answerLogs=[{questionId:'q',questionSnapshot:question,questionSignature:x.c.signLocalQuestionSnapshot_(question),selectedAnswer:'1',elapsedMs:1000,maxTimeMs:10000,actionType:'attack',finalDifficulty:1}];
  const chosen=prepared.reward.choices[0];
  const view=x.c.advanceRunStage(prepared.payload,chosen.rewardId,'auth',prepared.reward);
  assert.equal(x.sheets.get('BattleAnswerLogQueue').rows.length,1);
  assert.equal(x.sheets.get('BattleLogs').rows.length,1);
  const signed=x.c.decodeRunSession_(view.runSessionToken);
  assert.equal(signed.answerBatches.length,1); assert.equal(signed.answerBatches[0].logs[0].isCorrect,true);
  x.cache.clear();
  const battle=copy(view.battle); battle.status='defeat';battle.player.hp=0;
  const payload={runId:view.runId,runSessionToken:view.runSessionToken,battle,stageState:copy(view.stageState),answerLogs:[]};
  x.c.commitStageResult(payload,'auth');
  assert.equal(x.sheets.get('BattleAnswerLogQueue').rows.length,2);
  const batch=x.c.findRowByKey_('BattleAnswerLogQueue','runId',view.runId);
  assert.equal(JSON.parse(batch.logsJson)[0].questionId,'q');
  assert.equal(x.sheets.get('BattleLogs').rows.length,2);
});

test('a partially completed final save is retryable after cache eviction without duplicate currency',()=>{
  const x=context();let view=start(x);view=advance(x,view).response;
  const battle=copy(view.battle);battle.status='defeat';battle.player.hp=0;
  const payload={runId:view.runId,runSessionToken:view.runSessionToken,battle,stageState:copy(view.stageState),answerLogs:[]};
  const update=x.c.updateWorkbookPlayerProgressFromRun_;
  let failed=false;
  x.c.updateWorkbookPlayerProgressFromRun_=(...args)=>{if(!failed){failed=true;throw Error('transient workbook write failure');}return update(...args);};
  assert.throws(()=>x.c.commitStageResult(payload,'auth'),/transient/);
  const currency=x.c.findRowByKeyUncached_('PlayerData','playerId','p').currency;
  assert.ok(currency>0); x.cache.clear();
  x.c.commitStageResult(payload,'auth');
  assert.equal(x.c.findRowByKeyUncached_('PlayerData','playerId','p').currency,currency);
  assert.equal(x.c.getWorkbookPlayerData_('w','p').currency,currency);
  assert.equal(x.c.findRowByKeyUncached_('Runs','runId',view.runId).sessionSettled,true);
  assert.equal(x.sheets.get('BattleLogs').rows.length,2);
});

test('stat, skill, skill upgrade, item and rest rewards produce the same results as the existing flow',()=>{
  for (const type of ['stat','skill','skillUpgrade','item','rest']) {
    const x=context(), y=context();let vx=start(x),vy=start(y);
    if (type==='rest') {
      for(const [ctx,v] of [[x,vx],[y,vy]]){
        const run=ctx.c.requireRun_(v.runId),state=JSON.parse(run.stageStateJson);
        state.stageId=ctx.c.buildStageId_(1,6);state.battle.stage.stage=6;state.battle.stage.stageId=state.stageId;
        ctx.c.updateRowByKey_('Runs','runId',run.runId,{currentStage:6,stageStateJson:JSON.stringify(state)});
        v.runSessionToken=ctx.c.beginRunSession_(ctx.c.requireRun_(run.runId));
      }
    }
    const a=prepareVictory(x,vx),b=prepareVictory(y,vy);
    const reward={rewardId:'test-'+type,type,targetId:type==='stat'?'hp':type==='item'?x.c.MASTER_ITEMS[0].itemId:x.c.MASTER_SKILLS[0].skillId,value:type==='rest'?30:type==='stat'?10:1};
    for(const p of [a,b]){p.reward.choices=[copy(reward)];p.reward.currencyAmount=10;p.payload.stageState.reward=copy(p.reward);}
    const current=x.c.advanceRunStage(a.payload,reward.rewardId,'auth',a.reward);
    y.c.commitStageResultUnlocked_(b.payload,'auth');
    const old=y.c.selectRewardUnlocked_(vy.runId,reward.rewardId,'auth',b.reward);
    const legacy=old.nextBattlePending?y.c.prepareNextBattleAfterReward_(vy.runId,'auth'):old;
    assert.equal(current.score,legacy.score,type+' score');
    assert.deepEqual(copy(current.battle.player),copy(legacy.battle.player),type+' player');
    assert.deepEqual(copy(current.battle.monsters),copy(legacy.battle.monsters),type+' monsters');
    const run=x.c.decodeRunSession_(current.runSessionToken).run, oldRun=y.c.requireRun_(vy.runId);
    for(const k of ['score','currency','statsJson','skillsJson','itemsJson','currentHp','currentFloor','currentStage']) assert.equal(run[k],oldRun[k],type+' '+k);
  }
});

test('a reaction keeps its existing effect while its run score is deferred until defeat',()=>{
  const x=context(),view=start(x);
  let question={questionId:'q',workbookId:'w',creatorId:'p',reactionJson:'{}',likeCount:0,dislikeCount:0};
  x.c.findRunQuestionById_=()=>question;
  x.c.updateWorkbookQuestionById_=(w,id,patch)=>(question={...question,...patch});
  x.c.clearWorkbookQuestionCache_=()=>{};
  x.writes.length=0;
  const result=x.c.setQuestionReaction('q','like','auth',view.runId,view.runSessionToken);
  assert.equal(result.likeCount,1);assert.equal(result.scoreDelta,10);assert.equal(result.totalScore,110);
  assert.equal(x.writes.filter(n=>progressSheets.includes(n)).length,0);
  const duplicate=x.c.setQuestionReaction('q','like','auth',view.runId,result.runSessionToken);
  assert.equal(duplicate.totalScore,110);assert.equal(duplicate.scoreDelta,0);
  const battle=copy(view.battle);battle.status='defeat';battle.player.hp=0;
  const saved=x.c.commitStageResult({runId:view.runId,runSessionToken:duplicate.runSessionToken,battle,stageState:copy(view.stageState),answerLogs:[]},'auth');
  assert.equal(saved.score,110);
});


test('waiting to select a reward does not change the existing floor speed bonus',()=>{
  const x=context(),y=context();let vx=start(x),vy=start(y);
  for(let i=0;i<4;i++) {x.tick(5000);y.tick(5000);vx=advance(x,vx).response;vy=advance(y,vy).response;}
  x.tick(5000);y.tick(5000);
  const a=prepareVictory(x,vx),b=prepareVictory(y,vy);
  y.c.updateRowByKey_('Runs','runId',vy.runId,y.c.decodeRunSession_(vy.runSessionToken).run);
  y.c.commitStageResultUnlocked_(b.payload,'auth');
  x.tick(300000);y.tick(300000);
  const reward=a.reward.choices[0];
  const actual=x.c.advanceRunStage(a.payload,reward.rewardId,'auth',a.reward);
  const legacy=y.c.selectRewardUnlocked_(vy.runId,b.reward.choices[0].rewardId,'auth',b.reward);
  assert.equal(actual.scoreSummary.floorClearTimeMs,legacy.scoreSummary.floorClearTimeMs);
  assert.equal(actual.scoreSummary.floorSpeedScore,legacy.scoreSummary.floorSpeedScore);
  assert.equal(actual.scoreSummary.totalScore,legacy.scoreSummary.totalScore);
  const forged=copy(a.payload.stageState.reward.battleCompletionReceipt);forged.completedAtMs-=1000;
  assert.throws(()=>x.c.getVerifiedBattleCompletionMs_(forged,x.c.decodeRunSession_(vx.runSessionToken).run,a.payload.battle.battleId),/검증/);
});

module.exports = {context,start,prepareVictory,advance,copy};
