const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {context,copy}=require('./run-session.test.cjs');
function fixture(){
 const {c}=context(),question={questionId:'q',workbookId:'w',type:'multipleChoice',answer:'1',choice1:'A',choice2:'B'};
 const record={question,signature:c.signLocalQuestionSnapshot_(question),answer:{selectedAnswer:'1',selectedChoiceIndex:'1',selectedAnswerText:'A',giveUp:false}};
 const progress={level:3,skillRewards:[],skillRewardRerolls:{3:record}};
 return {c,progress,run:{workbookId:'w',skillsJson:'[]',statsJson:JSON.stringify({levelProgress:progress})}};
}
test('reroll records: reordering nested keys does not change a valid record',()=>{
 const {c,run,progress}=fixture();
 function reverse(v){return Array.isArray(v)?v.map(reverse):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reverse(v[k])])):v;}
 assert.doesNotThrow(()=>c.validateLevelSkillUpgrades_(run,reverse(progress)));
});
test('reroll records: changed answers, signatures and missing records are rejected',()=>{
 for(const mutate of [p=>p.skillRewardRerolls[3].answer.giveUp=true,p=>p.skillRewardRerolls[3].signature='changed',p=>delete p.skillRewardRerolls[3]]){
  const {c,run,progress}=fixture();const changed=copy(progress);mutate(changed);assert.throws(()=>c.validateLevelSkillUpgrades_(run,changed),/새로고침 기록/);
 }
});
test('status descriptions: sheet formulas use the originating skill level and current stats',()=>{
 const html=fs.readFileSync('Battle.html','utf8'),extract=n=>html.match(new RegExp('    function '+n+'\\([^]*?\\n    \\}'))[0];
 const c=vm.createContext({getStatusTotalValue:s=>s.value||0,getStatLabel:()=>'',getSkillDescriptionTemplateValues:s=>({formulaContext:{level:s.level,attack:20}})});
 for(const name of ['renderStatusDescriptionTemplate','getSkillDescriptionFormulaValue','evaluateSkillDisplayFormula','escapeRegExpClient'])vm.runInContext(extract(name),c);
 const value=c.renderStatusDescriptionTemplate({remainingTurns:2,assassinState:{sourceSkill:{skillId:'counter',level:3}}},'회피율 {calc:15+5*level}%p\n반격 피해 {calc:0.5*attack+0.2*level+3+level} / {turns}턴');
 assert.equal(value,'회피율 30%p\n반격 피해 17 / 2턴');
 assert.equal(c.renderStatusDescriptionTemplate({value:4,stacks:2,remainingTurns:1},'{value} / {stacks} / {turns}'),'4 / 2 / 1');
});
