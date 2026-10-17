const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('Battle.html','utf8');
const extract=name=>source.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
const calls=[],rect={left:20,top:40,width:80,height:90};
const state={events:[{type:'experience',monsterId:'m',amount:10}],drops:{m:{monsterId:'m',status:'pending',reward:{itemDetail:{rarity:'unique'}}}},started:{},flights:[]};
const c={deathRewardPresentation:state,animateExperienceRewards:r=>{calls.push(['xp',r]);return Promise.resolve();},animateMonsterItemPickup:(d,r)=>{calls.push(['item',r]);return Promise.resolve();}};
vm.createContext(c);vm.runInContext(extract('startMonsterDeathRewards'),c);c.startMonsterDeathRewards('m',rect);c.startMonsterDeathRewards('m',rect);
assert.equal(calls.length,2);assert.equal(state.events[0].sourceRect,rect);assert.equal(state.flights.length,2);
const death=extract('animateMonsterDeath');assert.ok(death.indexOf('startMonsterDeathRewards')<death.indexOf("setMonsterSpriteState"));
for(const match of source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)){new vm.Script(match[1].replace(/<\?[\s\S]*?\?>/g,'null'));}
console.log('Death rewards: immediate source capture, simultaneous XP/item launch, deduplication and client syntax passed.');
