const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const styles=fs.readFileSync('UiStyles.html','utf8');
const oldStyles=styles.replace(/  @media \(min-width: 901px\) \{[\s\S]*?\n  \}\n/,'');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'monster-size-'));
function html(css,count,boss){return '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+css+'<body class="battle-page-body"><main class="battle-shell battle-video-shell"><section class="battle-scene" style="background:url(https://assets.test/Resources/Background/Battle/3-1.png) center/cover"><div class="monster-layer">'+Array.from({length:count},(_,i)=>'<article class="monster-slot monster-count-'+count+(boss?' boss-hp-slot':'')+'"><div class="monster-hp-bar"><span class="hp-current" style="width:100%"></span><div class="monster-hp-text">100 / 100</div></div><div class="compact-monster monster-image-sprite'+(boss?' boss-monster':'')+'"><div class="monster-contrast-backdrop"></div><img class="monster-art" src="https://assets.test/Resources/Monsters/monster_Write/Idle.png"></div><div class="monster-display-name">'+(boss?'보스 몬스터':'떠도는 필기 '+(i+1))+'</div></article>').join('')+'</div></section></main>'}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const viewport of [{width:1280,height:800},{width:1920,height:1080},{width:390,height:844}]){
   const page=await browser.newPage({viewport});
   await page.route('https://assets.test/**',route=>route.fulfill({contentType:'image/png',body:fs.readFileSync(path.resolve('../Learning_RPG_LogueLike_Assets','.'+new URL(route.request().url()).pathname))}));
   for(const [count,boss] of [[1,false],[3,false],[1,true]]){
    await page.setContent(html(oldStyles,count,boss));
    const before=await page.locator('.monster-art').first().boundingBox();
    await page.setContent(html(styles,count,boss));
    await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0));
    const after=await page.locator('.monster-art').first().boundingBox();
    if(viewport.width>900)assert.ok(after.width>before.width*1.08,JSON.stringify({viewport,count,boss,before,after}));
    else assert.equal(after.width,before.width);
    for(const art of await page.locator('.monster-art').all()){
     const box=await art.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width&&box.y>=0&&box.y+box.height<=viewport.height);
    }
    if(boss){const hp=await page.locator('.monster-hp-bar').boundingBox();assert.ok(hp.y+hp.height<after.y,'boss art must leave the HP bar visible');}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,viewport.width+'-'+count+(boss?'-boss':'')+'.png')});
   }
   console.log('Larger desktop monsters and unchanged mobile sizing OK:',viewport.width,viewport.height);await page.close();
  }
  console.log('Screenshots:',output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
