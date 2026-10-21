const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('Battle.html','utf8'),c=vm.createContext({});
vm.runInContext(source.match(/    function formatQuestionActionEvents\([^]*?\n    \}/)[0],c);
test('question action text totals multi-hits, keeps damage and enemy debuff stacks separate, and reports a capped zero',()=>{
 const hit=(target,damage)=>({actor:'player',type:'skill',targetMonsterId:target,damage});
 const stacks=(target,n)=>({actor:'player',type:'debuff',targetMonsterId:target,effectName:'감전',appliedStacks:n});
 assert.equal(c.formatQuestionActionEvents([hit('a',5),hit('a',3),stacks('a',2),stacks('a',1)]),'피해량 : 8, 감전 중첩 : 3');
 assert.equal(c.formatQuestionActionEvents([hit('a',5),hit('b',5),stacks('a',3),stacks('b',3)]),'피해량 : 각 5, 감전 중첩 : 각 3');
 assert.equal(c.formatQuestionActionEvents([hit('a',5),hit('b',3)]),'피해량 : 총 8');
 assert.equal(c.formatQuestionActionEvents([{...hit('a',1),displayDamage:25},stacks('a',3)]),'피해량 : 25, 감전 중첩 : 3');
 assert.equal(c.formatQuestionActionEvents([stacks('a',0)]),'감전 중첩 : 0');
 assert.equal(c.formatQuestionActionEvents([stacks('a',2),{...stacks('a',3),effectName:'발화'}]),'감전 중첩 : 2, 발화 중첩 : 3');
 assert.equal(c.formatQuestionActionEvents([{actor:'player',type:'guard',shield:8},{actor:'player',type:'heal',heal:3}]),'방어막 : 8, 회복량 : 3');
 assert.equal(c.formatQuestionActionEvents([{actor:'effect',target:'player',damage:12}]),'발동 없음');
});
