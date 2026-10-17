const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const client=fs.readFileSync('Battle.html','utf8');

test('raising min and max efficiency shifts the curve without slowing its decay',()=>{
  for(const baseMax of [1,1.25]) {
    const server=vm.createContext({});
    vm.runInContext(fs.readFileSync('BattleService.gs','utf8'),server);
    server.getAnswerEfficiencyRules_=()=>({minAnswerEfficiency:.5,maxAnswerEfficiency:baseMax,extraWrongEfficiencyPenalty:.1});
    server.getQuestionCorrectEfficiencyBonusPercent_=()=>0;
    server.roundTo_=(n,p)=>Number(n.toFixed(p));
    const ui=vm.createContext({MIN_ANSWER_EFFICIENCY:.5,MAX_ANSWER_EFFICIENCY:baseMax,currentQuestionView:null});
    for(const name of ['calculateTimedEfficiency','getQuestionMinAnswerEfficiency','getQuestionMaxAnswerEfficiency'])
      vm.runInContext(client.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],ui);
    const draw=(remaining,bonus)=>{
      const mods={questionMinEfficiencyPercent:bonus,questionMaxEfficiencyFlatPercent:bonus};
      ui.currentQuestionView={maxAnswerEfficiency:baseMax+bonus/100,questionModifiers:mods};
      const local=ui.calculateTimedEfficiency(remaining,10000);
      const remote=server.calculateEfficiency(true,remaining,10000,0,mods,{});
      assert.ok(Math.abs(local-remote)<=.00051);
      return local;
    };
    for(const bonus of [2,6,50,100]) for(const remaining of [0,1000,2500,5000,7500,10000])
      assert.ok(Math.abs(draw(remaining,bonus)-draw(remaining,0)-bonus/100)<1e-9,
        `base max ${baseMax}, bonus ${bonus}, remaining ${remaining}`);
  }
});
