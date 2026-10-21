const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('Battle.html', 'utf8');
const extract = name => html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];

function setup() {
  const tasks = new Map(), label = {}, elements = {};
  let nextId = 0, starts = 0;
  const element = id => elements[id] ||= {classList:{add(){},remove(){}},replaceChildren(){},focus(){},querySelector:()=>label};
  const c = vm.createContext({questionPresentationTimer:null,questionTimerId:null,workbookDeadlineExpired:false,
    currentQuestionView:{actionType:'attack',question:{}},document:{getElementById:element,querySelector:()=>element('actions'),body:element('body')},
    window:{setTimeout(fn,ms){tasks.set(++nextId,{fn,ms});return nextId;},addEventListener(){}},
    clearTimeout:id=>tasks.delete(id),clearInterval(){},setInterval:()=>1,Date,
    syncQuestionEfficiencyDock(){},getQuestionMaxAnswerEfficiency:()=>1.25,updateQuestionEfficiencyMeter(){},
    renderAnswerArea(){starts++;},tickQuestionTimer(){}});
  vm.runInContext(extract('prepareQuestionPresentation')+'\n'+extract('startQuestionSolving'),c);
  const tick = () => {const [id,task] = tasks.entries().next().value;tasks.delete(id);task.fn();return task.ms;};
  c.prepareQuestionPresentation(c.currentQuestionView);
  return {c,tick,label,tasks,starts:()=>starts};
}

test('counts 3, 2, 1 before starting the solving timer once',()=>{
  const x=setup();
  assert.equal(x.tick(),0);
  for(const n of [3,2,1]) {
    assert.equal(x.label.textContent,`풀이 시작 (${n})`);
    assert.equal(x.starts(),0);
    assert.equal(x.tick(),1000);
  }
  assert.equal(x.starts(),1);
  assert.equal(x.c.currentQuestionView.solveStarted,true);
  assert.ok(x.c.questionStartedAt>0);
});

test('manual start cancels countdown and cannot start twice',()=>{
  const x=setup();x.tick();x.c.startQuestionSolving();x.c.startQuestionSolving();
  assert.equal(x.starts(),1);assert.equal(x.tasks.size,0);
});

test('stale questions and expired deadlines cannot auto start',()=>{
  for(const stop of [c=>c.currentQuestionView=null,c=>c.workbookDeadlineExpired=true]) {
    const x=setup();x.tick();stop(x.c);x.tick();
    assert.equal(x.starts(),0);assert.equal(x.tasks.size,0);
  }
});
