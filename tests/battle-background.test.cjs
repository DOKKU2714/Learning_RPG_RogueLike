const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const source=fs.readFileSync('Battle.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
function setup(){
 const images=[],element={dataset:{},style:{backgroundImage:'old-scene'},classList:{add(){}}};
 const c=vm.createContext({ASSET_BASE_URL:'https://assets.test',document:{querySelector:()=>element},
  Image:function(){images.push(this)},cssUrlEscape:String});
 vm.runInContext(['renderBattleBackground','getBattleBackgroundUrlCandidates','getDisplayFloorNumberForAsset','uniqueClientValues'].map(extract).join('\n'),c);
 return {c,images,element};
}
test('every floor and stage has an existing same-floor fallback, including the missing 3-3 image',()=>{
 const {c}=setup();
 for(let floor=1;floor<=5;floor++)for(let stage=1;stage<=6;stage++){
  const urls=c.getBattleBackgroundUrlCandidates({floor,stage});
  assert.ok(urls.some(url=>url.includes('/Battle/'+floor+'-')&&fs.existsSync('../Learning_RPG_LogueLike_Assets'+url.replace('https://assets.test',''))),floor+'-'+stage);
 }
 const urls=c.getBattleBackgroundUrlCandidates({floor:3,stage:3});
 assert.ok(urls.includes('https://assets.test/Resources/Background/Battle/3-1.png'));
});
test('render keeps the existing image while loading, skips repeated renders, and ignores older stage callbacks',()=>{
 const {c,images,element}=setup();
 c.renderBattleBackground({floor:3,stage:3});
 assert.equal(element.style.backgroundImage,'old-scene');
 c.renderBattleBackground({floor:3,stage:3});assert.equal(images.length,1);
 c.renderBattleBackground({floor:3,stage:5});assert.equal(images.length,2);
 images[0].onload();assert.equal(element.style.backgroundImage,'old-scene');
 images[0].onerror();assert.equal(images[0].src,'https://assets.test/Resources/Background/Battle/3-3.png');
 images[1].onload();assert.equal(element.style.backgroundImage,'url("https://assets.test/Resources/Background/Battle/3-5.png")');
});
test('failed candidates fall back to 3-1 instead of clearing the background',()=>{
 const {c,images,element}=setup();c.renderBattleBackground({floor:3,stage:4});
 const image=images[0];
 while(!image.src.endsWith('/Battle/3-1.png'))image.onerror();
 image.onload();assert.equal(element.style.backgroundImage,'url("https://assets.test/Resources/Background/Battle/3-1.png")');
});
