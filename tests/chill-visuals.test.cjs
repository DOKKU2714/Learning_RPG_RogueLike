const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('Battle.html','utf8');
const extract=name=>source.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
const values={},classes=new Set(),particles=[];let overlay=null,bursts=0;
const style={setProperty:(key,value)=>values[key]=value};
function makeParticle(){return {style:{setProperty(){}},remove(){particles.splice(particles.indexOf(this),1);}};}
const c={document:{querySelector:()=>({querySelector:()=>overlay}),createElement:makeParticle},cssEscape:s=>s,
playDamageTypeEffect:()=>{bursts++;overlay={dataset:{},classList:{add:name=>classes.add(name)},style,querySelectorAll:()=>particles.slice(),appendChild:p=>particles.push(p),remove:()=>overlay=null};}};
vm.createContext(c);vm.runInContext(['getMonsterChillStacks','syncMonsterChillVisual'].map(extract).join('\n'),c);
const monster=n=>({effects:[{effectId:'effect_v2_chill',stacks:n}]});
c.syncMonsterChillVisual('m',monster(1));assert.ok(classes.has('chill-persistent'));assert.equal(particles.length,8);const weak=Number(values['--chill-opacity']);
c.syncMonsterChillVisual('m',monster(8));assert.equal(particles.length,22);assert.ok(Number(values['--chill-opacity'])>weak);assert.equal(bursts,1);
c.syncMonsterChillVisual('m',monster(8));assert.equal(particles.length,22);assert.equal(bursts,1);
c.syncMonsterChillVisual('m',monster(10000));assert.equal(particles.length,30);
c.syncMonsterChillVisual('m',monster(2));assert.equal(particles.length,10);
c.syncMonsterChillVisual('m',monster(0));assert.equal(overlay,null);
assert.equal(c.getMonsterChillStacks({effects:[],debuffs:[{effectId:'effect_v2_chill',stacks:5}]}),0);
assert.ok(extract('playDamageTypeEffect').includes("overlay.classList.contains('chill-persistent')"));
console.log('Chill visuals passed: retained overlay, stack scaling up/down, bounded particles, no duplicates and cleanup at zero.');
