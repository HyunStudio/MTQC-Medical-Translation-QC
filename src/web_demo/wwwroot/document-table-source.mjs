// Selectable native text associations only. DATA validation is not source/ink
// authentication; the mounted reviewer owns the current record/canvas/generation.
const errors = new WeakMap();
const fail = code => { const error = new RangeError(code); errors.set(error, code); throw error; };
const reason = error => errors.get(error) || 'source-data-held';
const id = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value);
const whole = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
function own(value, key) { const d = value && Object.getOwnPropertyDescriptor(value, key); if (!d || !Object.hasOwn(d, 'value')) fail('own-data-required'); return d.value; }
function shape(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object-schema'); const names = Reflect.ownKeys(value); if (names.length !== keys.length || names.some(key => !keys.includes(key))) fail('object-fields'); return Object.fromEntries(keys.map(key => [key, own(value, key)])); }
function list(value, maximum) { if (!Array.isArray(value)) fail('array-schema'); const n = own(value, 'length'); if (!whole(n, maximum) || Reflect.ownKeys(value).length !== n + 1) fail('array-bound'); return Array.from({length:n}, (_, i) => own(value, String(i))); }
const contains = (a,b) => b.x >= a.x && b.y >= a.y && b.x+b.width <= a.x+a.width && b.y+b.height <= a.y+a.height;
const intersects = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
const sameBox = (a,b) => ['x','y','width','height'].every(key => Object.is(a[key], b[key]));
function box(value, frame) { const b = shape(value, ['x','y','width','height']); if (!Object.values(b).every(Number.isFinite) || b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || !(b.x+b.width > b.x && b.y+b.height > b.y) || !contains(frame,b)) fail('source-box'); return b; }
function dimensions(width, height) { if (![width,height].every(n => Number.isFinite(n) && n > 0 && n <= 16384)) fail('source-frame'); return {width,height}; }
function budget() { let used = 0; return value => { if (typeof value !== 'string' || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value) || /\[\[(?:MTQC:|CELL:|NOTE:|MATH:|\/MTQC\]\])/.test(value) || (used += value.length) > 65536) fail('source-text-bound'); return value; }; }
function sourceData(raw, text) {
 const s = shape(raw, ['version','frame','regionId','sourceBox','fragmentIds','literal','fragments']);
 if (s.version !== 'native-table-source-v1' || !id(s.regionId)) fail('source-version-or-region');
 const d = shape(s.frame, ['width','height']), frame = dimensions(d.width,d.height), sourceBox = box(s.sourceBox,{x:0,y:0,...frame}), literal = text(s.literal);
 const ids = list(s.fragmentIds,400); if (!ids.length || ids.some(x => typeof x !== 'string' || !/^p[1-9][0-9]*-f(?:0|[1-9][0-9]*)$/.test(x) || x.length > 128) || new Set(ids).size !== ids.length) fail('native-identity');
 const prefix = ids[0].split('-f')[0];
 const fragments = list(s.fragments,400).map((value,i) => { const f = shape(value,['id','sourceIndex','text','box']); if (f.id !== ids[i] || !whole(f.sourceIndex,9999) || f.id !== `${prefix}-f${f.sourceIndex}`) fail('native-identity'); const b = box(f.box,{x:0,y:0,...frame}), str = text(f.text); if (!str.trim() || !contains(sourceBox,b)) fail('native-source-crop'); return {id:f.id,sourceIndex:f.sourceIndex,text:str,box:b}; });
 if (fragments.length !== ids.length) fail('native-inventory');
 return {version:s.version,frame,regionId:s.regionId,sourceBox,fragmentIds:ids,literal,fragments};
}
function tableData(table, text) {
 const rows = own(table,'rowCount'), columns = own(table,'columnCount'); if (![rows,columns].every(n => Number.isInteger(n) && n >= 1 && n <= 20)) fail('table-dimensions');
 const seen = new Set(), raw = list(own(table,'cells'),400); if (!raw.length) fail('empty-cell-inventory');
 const cells = raw.map(c => { const key = own(c,'id'), row = own(c,'row'), column = own(c,'column'), rowSpan = own(c,'rowSpan'), colSpan = own(c,'colSpan'), str = text(own(c,'text')); if (!id(key) || seen.has(key) || !whole(row,19) || !whole(column,19) || !Number.isInteger(rowSpan) || !Number.isInteger(colSpan) || rowSpan < 1 || colSpan < 1 || row+rowSpan > rows || column+colSpan > columns) fail('cell-identity-or-position'); seen.add(key); const role = own(c,'role'), blank = Object.getOwnPropertyDescriptor(c,'blankReason'); if (!str && (role !== 'blank' || !blank || !Object.hasOwn(blank,'value') || typeof blank.value !== 'string' || !blank.value.trim())) fail('empty-cell-source'); return {id:key,row,column,rowSpan,colSpan,text:str}; });
 return {rowCount:rows,columnCount:columns,cellStates:cells};
}
function assignmentData(source, table, values) {
 const input = list(values,400), byCell = new Map(table.cellStates.map(c => [c.id,c])), byId = new Map(source.fragments.map((f,index) => [f.id,{...f,index}])), usedCells = new Set(), usedFragments = new Set();
 const cells = input.map(value => { const a = shape(value,['cellId','fragmentIds','joiner']); if (!id(a.cellId) || !byCell.has(a.cellId) || usedCells.has(a.cellId) || !['',' ','\n'].includes(a.joiner)) fail('cell-assignment'); usedCells.add(a.cellId); const ids = list(a.fragmentIds,400); let previous = -1; for (const key of ids) { const f = byId.get(key); if (!f || usedFragments.has(key) || f.index <= previous) fail('fragment-assignment'); previous = f.index; usedFragments.add(key); } if (ids.map(key => byId.get(key).text).join(a.joiner) !== byCell.get(a.cellId).text || (!ids.length && byCell.get(a.cellId).text)) fail('cell-source-literal'); return {cellId:a.cellId,fragmentIds:ids,joiner:a.joiner}; });
 if (usedCells.size !== byCell.size || usedFragments.size !== byId.size) fail('source-coverage'); return cells;
}
export function captureNativeTableSource(input) {
 const unknown = code => freeze({status:'unknown',reason:code,source:null,counts:null,sourceReviewed:false,visibility:'unverified'});
 try {
  const {record,pageId,region} = shape(input,['record','pageId','region']); if (typeof pageId !== 'string' || !/^p[1-9][0-9]*$/.test(pageId) || own(region,'type') !== 'table' || own(region,'provenance') !== 'pdf-text' || !id(own(region,'id'))) fail('native-table-required');
  const frame = dimensions(own(record,'width'),own(record,'height')), bounds = {x:0,y:0,...frame}, crop = box(own(region,'box'),bounds), ids = list(own(region,'fragmentIds'),400); if (!ids.length || new Set(ids).size !== ids.length) fail('native-identity');
  const selected = new Set(ids), found = new Map(), text = budget(); text(own(region,'text'));
  list(own(record,'fragments'),10000).forEach((raw,index) => { const str = own(raw,'text'); if (typeof str !== 'string') fail('native-text'); if (!str.trim()) return; const b = box(Object.fromEntries(['x','y','width','height'].map(key => [key,own(raw,key)])),bounds), key = `${pageId}-f${index}`; if (selected.has(key)) { if (!contains(crop,b)) fail('native-source-crop'); text(str); found.set(key,{id:key,sourceIndex:index,text:str,box:b}); } else if (intersects(crop,b)) fail('unselected-source-crossing'); });
  if (ids.some(key => !found.has(key))) fail('missing-native-source');
  const source = sourceData({version:'native-table-source-v1',frame,regionId:own(region,'id'),sourceBox:crop,fragmentIds:ids,literal:own(region,'text'),fragments:ids.map(key => found.get(key))},budget());
  return freeze({status:'draft',reason:null,source,counts:{nativeFragments:source.fragments.length},sourceReviewed:false,visibility:'unverified'});
 } catch (error) { return unknown(reason(error)); }
}
export function bindNativeTableCells(rawSource, rawTable, assignments) {
 try { const text = budget(), source = sourceData(rawSource,text), table = tableData(rawTable,text), cells = assignmentData(source,table,assignments); return freeze({ok:true,reason:null,review:{version:'native-table-binding-v1',source,...table,cells}}); } catch (error) { return freeze({ok:false,reason:reason(error),review:null}); }
}
export function validateNativeTableBinding(raw, binding) {
 try {
  const r = shape(raw,['version','source','rowCount','columnCount','cellStates','cells']); if (r.version !== 'native-table-binding-v1') fail('binding-version'); const text = budget(), source = sourceData(r.source,text), {region,table:rawTable} = shape(binding,['region','table']), table = tableData(rawTable,text);
  const ids = list(own(region,'fragmentIds'),400); if (own(region,'id') !== source.regionId || own(region,'type') !== 'table' || own(region,'provenance') !== 'pdf-text' || own(region,'text') !== source.literal || !sameBox(box(own(region,'box'),{x:0,y:0,...source.frame}),source.sourceBox) || ids.length !== source.fragmentIds.length || ids.some((key,i) => key !== source.fragmentIds[i])) fail('changed-region-source');
  const states = list(r.cellStates,400).map(value => shape(value,['id','row','column','rowSpan','colSpan','text'])); if (r.rowCount !== table.rowCount || r.columnCount !== table.columnCount || states.length !== table.cellStates.length || states.some((c,i) => Object.keys(c).some(key => !Object.is(c[key],table.cellStates[i][key])))) fail('changed-cell-source');
  const cells = assignmentData(source,table,r.cells); return freeze({ok:true,reason:null,review:{version:r.version,source,...table,cells}});
 } catch (error) { return freeze({ok:false,reason:reason(error),review:null}); }
}
