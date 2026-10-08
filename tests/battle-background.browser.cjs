const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const helpers=['renderBattleBackground','getBattleBackgroundUrlCandidates','getDisplayFloorNumberForAsset','uniqueClientValues','cssUrlEscape'];
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://assets.test/**',route=>{
   const file=path.resolve('../Learning_RPG_LogueLike_Assets','.'+new URL(route.request().url()).pathname);
   return fs.existsSync(file)?route.fulfill({contentType:'image/png',body:fs.readFileSync(file)}):route.fulfill({status:404,body:''});
  });
  await page.setContent('<!doctype html>'+styles+'<div class="battle-scene"><div class="battle-background-fallback"></div></div><script>var ASSET_BASE_URL="https://assets.test";'+helpers.map(extract).join('\n')+'</script>');
  for(let floor=1;floor<=5;floor++)for(let stage=1;stage<=6;stage++){
   await page.evaluate(({floor,stage})=>renderBattleBackground({floor,stage}),{floor,stage});
   await page.waitForFunction(({floor,stage})=>{
    const e=document.querySelector('.battle-background-fallback'),key=getBattleBackgroundUrlCandidates({floor,stage}).join('|');
    return e.dataset.battleBackgroundKey===key&&e.style.backgroundImage.includes('/Battle/'+floor+'-')&&e.classList.contains('has-battle-image');
   },{floor,stage});
   // Wait for the image selected for this stage, not the retained previous scene.
   const expected=await page.evaluate(({floor,stage})=>getBattleBackgroundUrlCandidates({floor,stage}),{floor,stage});
   const url=expected.find(url=>fs.existsSync(path.resolve('../Learning_RPG_LogueLike_Assets','.'+new URL(url).pathname)));
   await page.waitForFunction(url=>document.querySelector('.battle-background-fallback').style.backgroundImage.includes(url),url);
   const image=await page.evaluate(()=>document.querySelector('.battle-background-fallback').style.backgroundImage);
   assert.ok(image.includes('/Battle/'+floor+'-'),floor+'-'+stage);
  }
  assert.deepEqual(errors,[]);console.log('All 30 stage backgrounds load, including missing-image fallbacks.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
