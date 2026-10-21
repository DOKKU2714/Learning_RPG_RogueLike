const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('Battle.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const c=vm.createContext({escapeHtml:String,getStatusIcon:()=>'',buildStatusTooltip:s=>({main:s.name || s.effectId,stat:''}),
 getDisplayStatusGroups:t=>({buffs:t.buffs || [],debuffs:t.debuffs || []})});
for(const name of ['getDamageVisualType','getPixelFlameSvg','getPixelConceptSvg','buildStatusView','renderStatusSymbol','renderStatusStack','renderStatusIcons'])vm.runInContext(extract(name),c);

test('canonical and legacy concept statuses share a stepped icon with readable stack labels',()=>{
 for(const type of ['burn','bleed','poison','chill','freeze','shock','stun']){
  for(const id of ['debuff_'+type,'effect_v2_'+type]){
   const html=c.renderStatusIcons({debuffs:[{effectId:id,stacks:4,stackable:true}]});
   assert.match(html,new RegExp('status-concept-'+type));
   assert.match(html,/shape-rendering="crispEdges"/);
   assert.match(html,/class="status-stacks">4<\/b>/);
   assert.doesNotMatch(html,/[CQSA][0-9 .,-]/);
  }
 }
});

test('ordinary buffs and debuffs retain their category and keyboard tooltip',()=>{
 const html=c.renderStatusIcons({buffs:[{effectId:'buff_power',name:'힘'}],debuffs:[{effectId:'debuff_weak',name:'약화'}]});
 assert.match(html,/status-icon buff/);assert.match(html,/status-icon debuff/);
 assert.doesNotMatch(html,/status-concept-/);
 assert.equal((html.match(/tabindex="0"/g)||[]).length,2);
 assert.match(html,/aria-label="힘"/);
});

test('poison particles use pixel skulls while the status icon remains a vial',()=>{
 assert.notEqual(c.getPixelConceptSvg('poison',1),c.getPixelConceptSvg('poison',0));
 assert.match(c.getPixelConceptSvg('poison',1),/shape-rendering="crispEdges"/);
 assert.doesNotMatch(c.getPixelConceptSvg('poison',1),/[CQSA][0-9 .,-]/);
});
