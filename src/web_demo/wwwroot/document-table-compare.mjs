// Explicit-reference software comparison only. Neither the reference argument
// nor a matching prediction is certified as original, visible or clinically true.
const LIMIT=10000;
const REFERENCE_LIMIT=40000;
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const key=c=>`${c.row}:${c.column}`;
const string=v=>typeof v==='string'&&v.trim().length>0;
const sameSet=(a,b)=>{
  if(a.length!==b.length)return false;
  const left=[...a].sort(),right=[...b].sort();
  return left.every((v,i)=>v===right[i]);
};
const issue=(side,code,anchor)=>({side,code,...(anchor!==undefined?{anchor}:{})});

function inventory(input,issues) {
  const ids=new Set();
  if(!Array.isArray(input)||input.length>LIMIT) {issues.push(issue('source','invalid-inventory'));return ids;}
  for(const f of input) {
    if(!record(f)||!string(f.id)||!string(f.text)||ids.has(f.id))issues.push(issue('source','invalid-inventory'));
    else ids.add(f.id);
  }
  return ids;
}

function validate(table,sourceIds,side,issues) {
  const start=issues.length,byId=new Map(),byAnchor=new Map(),occupied=new Set(),owned=new Set();
  const validDimensions=record(table)&&Number.isSafeInteger(table.rowCount)&&Number.isSafeInteger(table.columnCount)&&
    table.rowCount>0&&table.columnCount>0&&table.rowCount*table.columnCount<=LIMIT;
  if(!validDimensions||!Array.isArray(table.cells)||!table.cells.length||table.cells.length>LIMIT) {
    issues.push(issue(side,'invalid-grid'));return null;
  }
  // Bound collection lengths and aggregate work BEFORE enumerating references,
  // building a graph, or producing one issue per invalid entry.
  let references=0,sourceReferences=0,claimedSlots=0;
  for(const c of table.cells) {
    if(!record(c)) {issues.push(issue(side,'invalid-cell'));return null;}
    if(![c.row,c.column,c.rowSpan,c.colSpan].every(Number.isSafeInteger)||c.row<0||c.column<0||c.rowSpan<=0||c.colSpan<=0||
      c.row+c.rowSpan>table.rowCount||c.column+c.colSpan>table.columnCount) {issues.push(issue(side,'invalid-cell'));return null;}
    claimedSlots+=c.rowSpan*c.colSpan;
    if(claimedSlots>table.rowCount*table.columnCount) {issues.push(issue(side,'coverage-limit'));return null;}
    if(!Array.isArray(c.sourceFragmentIds)||c.sourceFragmentIds.length>sourceIds.size||
      !Array.isArray(c.headerCellIds)||c.headerCellIds.length>table.cells.length) {
      issues.push(issue(side,'invalid-reference-list'));return null;
    }
    references+=c.headerCellIds.length;
    sourceReferences+=c.sourceFragmentIds.length;
    if(sourceReferences>sourceIds.size) {issues.push(issue(side,'source-reference-limit'));return null;}
    if(references>REFERENCE_LIMIT) {issues.push(issue(side,'reference-limit'));return null;}
  }
  for(const c of table.cells) {
    const shape=c&&string(c.id)&&[c.row,c.column,c.rowSpan,c.colSpan].every(Number.isSafeInteger)&&
      c.row>=0&&c.column>=0&&c.rowSpan>0&&c.colSpan>0&&c.row+c.rowSpan<=table.rowCount&&c.column+c.colSpan<=table.columnCount;
    if(!shape) {issues.push(issue(side,'invalid-cell'));continue;}
    const anchor=key(c);
    if(byId.has(c.id)||byAnchor.has(anchor))issues.push(issue(side,'duplicate-cell',anchor));
    byId.set(c.id,c);byAnchor.set(anchor,c);
    if(!['header','value','blank'].includes(c.role)||typeof c.text!=='string')issues.push(issue(side,'invalid-role-or-text',anchor));
    if(c.role==='blank') {
      if(c.text!==''||!string(c.blankReason)||!Array.isArray(c.sourceFragmentIds)||c.sourceFragmentIds.length!==0)
        issues.push(issue(side,'invalid-blank',anchor));
    } else if(!string(c.text)||!Array.isArray(c.sourceFragmentIds)||!c.sourceFragmentIds.length)
      issues.push(issue(side,'missing-source-or-text',anchor));
    if(!Array.isArray(c.sourceFragmentIds)||c.sourceFragmentIds.length>sourceIds.size)issues.push(issue(side,'invalid-source-list',anchor));
    else for(const id of c.sourceFragmentIds) {
      if(!sourceIds.has(id)||owned.has(id))issues.push(issue(side,'invalid-source-owner',anchor));
      owned.add(id);
    }
    if(!Array.isArray(c.headerCellIds)||c.headerCellIds.length>table.cells.length||new Set(c.headerCellIds).size!==c.headerCellIds.length)
      issues.push(issue(side,'invalid-header-list',anchor));
    for(let r=c.row;r<c.row+c.rowSpan;r++)for(let col=c.column;col<c.column+c.colSpan;col++) {
      const slot=`${r}:${col}`;
      if(occupied.has(slot))issues.push(issue(side,'overlapping-cell',anchor));
      occupied.add(slot);
    }
  }
  if(occupied.size!==table.rowCount*table.columnCount)issues.push(issue(side,'missing-slot'));
  if(owned.size!==sourceIds.size||[...sourceIds].some(id=>!owned.has(id)))issues.push(issue(side,'unowned-source'));
  // Build a bounded directed graph for parent-header links. Iterative Kahn
  // traversal avoids recursion failures on long but otherwise valid hierarchies.
  const incoming=new Map([...byId.keys()].map(id=>[id,0])),children=new Map([...byId.keys()].map(id=>[id,[]]));
  for(const c of byId.values()) {
    if(!Array.isArray(c.headerCellIds))continue;
    for(const id of c.headerCellIds) {
      if(id===c.id||byId.get(id)?.role!=='header')issues.push(issue(side,'invalid-header-target',key(c)));
      else {incoming.set(c.id,incoming.get(c.id)+1);children.get(id).push(c.id);}
    }
  }
  const queue=[...incoming].filter(([,n])=>n===0).map(([id])=>id);let seen=0;
  for(let index=0;index<queue.length;index++) {
    const id=queue[index];seen++;
    for(const child of children.get(id)) {const count=incoming.get(child)-1;incoming.set(child,count);if(count===0)queue.push(child);}
  }
  if(seen!==byId.size)issues.push(issue(side,'cyclic-header-links'));
  return issues.length===start?{byId,byAnchor}:null;
}

/** No source inference, verification mutation, clinical or visibility claim. */
export function compareTableGrid(input) {
  const issues=[],value=record(input)?input:{};
  const count=t=>Array.isArray(t?.cells)?t.cells.length:0;
  const counts={expectedCells:count(value.expected),actualCells:count(value.actual),matchingCells:0,comparedAnchors:0};
  const failed=()=>({pass:false,comparisonPerformed:false,counts,issues});
  const ids=inventory(value.sourceFragments,issues);
  const expected=validate(value.expected,ids,'expected',issues),actual=validate(value.actual,ids,'actual',issues);
  if(issues.length||!expected||!actual)return failed();
  if(value.actual.rowCount!==value.expected.rowCount||value.actual.columnCount!==value.expected.columnCount)
    issues.push(issue('comparison','dimensions-mismatch'));
  for(const [anchor,e] of expected.byAnchor) {
    const a=actual.byAnchor.get(anchor);
    if(!a) {issues.push(issue('comparison','missing-anchor',anchor));continue;}
    counts.comparedAnchors++;
    const before=issues.length;
    if(a.rowSpan!==e.rowSpan||a.colSpan!==e.colSpan)issues.push(issue('comparison','span-mismatch',anchor));
    if(a.text!==e.text)issues.push(issue('comparison','text-mismatch',anchor));
    if(a.role!==e.role)issues.push(issue('comparison','role-mismatch',anchor));
    if((a.role==='blank'?a.blankReason:'')!==(e.role==='blank'?e.blankReason:''))issues.push(issue('comparison','blank-reason-mismatch',anchor));
    if(!sameSet(a.sourceFragmentIds,e.sourceFragmentIds))issues.push(issue('comparison','source-mismatch',anchor));
    if(!sameSet(a.headerCellIds.map(id=>key(actual.byId.get(id))),e.headerCellIds.map(id=>key(expected.byId.get(id)))))
      issues.push(issue('comparison','header-mismatch',anchor));
    if(before===issues.length)counts.matchingCells++;
  }
  for(const anchor of actual.byAnchor.keys())if(!expected.byAnchor.has(anchor))issues.push(issue('comparison','extra-anchor',anchor));
  return {pass:issues.length===0,comparisonPerformed:true,counts,issues};
}
