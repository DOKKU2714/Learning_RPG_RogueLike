const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('RewardService.gs','utf8');
const c=vm.createContext({});
vm.runInContext(source.match(/function pickOwnedSkillUpgradeCandidates_\([^]*?\n\}/)[0],c);
test('upgrade candidates are three distinct owned skills and stable across reopen and server/local ordering',()=>{
 const pool=Array.from({length:12},(_,i)=>({skillId:'s'+i}));
 const pick=(list,run,floor)=>Array.from(c.pickOwnedSkillUpgradeCandidates_(list,run,floor),r=>r.skillId);
 const a=pick(pool,'run',1);
 assert.equal(a.length,3);assert.equal(new Set(a).size,3);
 assert.ok(a.every(id=>pool.some(s=>s.skillId===id)));
 assert.deepEqual(a,pick(pool.slice().reverse(),'run',1));
 assert.ok(Array.from({length:8},(_,i)=>pick(pool,'run',i+2).join()).some(ids=>ids!==a.join()));
 assert.equal(pick(pool.slice(0,2),'run',1).length,2);
 assert.equal(pick([],'run',1).length,0);
});
