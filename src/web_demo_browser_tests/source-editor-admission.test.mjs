import test from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../web_demo/wwwroot/document-structure-review.mjs';

const region={id:'p1-r66',type:'heading',text:'4 Concluding remarks',box:{x:380.25,y:900.2,width:300.2,height:17.8}};
const current=()=>({text:region.text,type:region.type,box:'380.25, 900.2, 300.2, 17.8'});
function matches(value,source=region){
  assert.equal(typeof review.sourceRegionEditorMatches,'function','Main editor admission must compare visible edits with saved source');
  return review.sourceRegionEditorMatches(source,value);
}
test('unchanged editor matches actual full-precision main source-box serialization',()=>assert.equal(matches(current()),true));
test('unsaved actual-paper transcription cannot retain saved-source admission',()=>assert.equal(matches({...current(),text:'4 Concluding remarks — edited but not saved'}),false));
test('unsaved source type change holds even when text is identical',()=>assert.equal(matches({...current(),type:'equation'}),false));
test('unsaved source box change holds without changing geometric tolerance',()=>assert.equal(matches({...current(),box:'380.25, 900.2, 301.2, 17.8'}),false));
test('empty or missing editor values cannot impersonate saved content',()=>{for(const value of [null,{}, {...current(),text:''}])assert.equal(matches(value),false);});
test('browser CRLF normalization retains identical saved transcription',()=>assert.equal(matches({...current(),text:'First\nSecond\nThird'},{...region,text:'First\r\nSecond\rThird'}),true));
test('returning to saved values is identifiable without mutating the region',()=>{const original=structuredClone(region);assert.equal(matches({...current(),text:'changed'}),false);assert.equal(matches(current()),true);assert.deepEqual(region,original);});
