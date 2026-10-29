// Conservative proposals from selectable PDF geometry. No source comparison or
// review flag is inferred, and ambiguous grids are left to the existing editor.
const numeric = text => /^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(text.trim());
export const isTableReferenceText = text => /^\s*TABLE\s+\d+\s+(?:shows|presents|summari[sz]es|lists|provides|describes|reports|compares|displays|demonstrates|outlines|illustrates)\b/i.test(text);

export function proposeNativeTableGrid(lines, fragments, width, height, pageId) {
  if (!lines.some(line => line.column === 'table') || ![width, height].every(n => Number.isFinite(n) && n > 0)) return null;
  const ids = lines.flatMap(line => line.fragmentIds);
  if (new Set(ids).size !== ids.length) return null;
  const visible=fragments.map((p,id)=>({...p,id})).filter(p=>p.text?.trim());
  if (visible.some(p=>![p.x,p.y,p.width,p.height].every(Number.isFinite) || p.width<=0 || p.height<=0 ||
      p.x<0 || p.y<0 || p.x+p.width>width || p.y+p.height>height)) return null;
  const cellRows = [];
  for (const line of lines) {
    if (/^\s*TABLE\s+\d+\b/i.test(line.text)) {
      if (cellRows.length || isTableReferenceText(line.text)) return null;
      continue;
    }
    const parts = line.fragmentIds.map(id => ({ ...fragments[id], id }));
    if (!parts.length || parts.some(p => !Number.isInteger(p.id) || typeof p.text !== 'string' ||
        ![p.x,p.y,p.width,p.height].every(Number.isFinite) || p.width <= 0 || p.height <= 0 ||
        p.x < 0 || p.y < 0 || p.x + p.width > width || p.y + p.height > height)) return null;
    parts.sort((a,b) => a.x - b.x);
    const cells = [];
    for (const part of parts) {
      const previous = cells.at(-1), last = previous?.parts.at(-1);
      const gap = last ? part.x - last.x - last.width : Infinity;
      if (last && gap < -.5) return null;
      if (!last || gap > Math.max(6, Math.min(last.height,part.height) * .8)) cells.push({parts:[part]});
      else previous.parts.push(part);
    }
    for (const cell of cells) {
      const ps=cell.parts;
      cell.x=ps[0].x; cell.end=ps.at(-1).x+ps.at(-1).width;
      cell.text=ps.reduce((text,p,i) => {
        const last=ps[i-1],gap=last?p.x-last.x-last.width:0;
        return text+(i && gap>Math.max(1,p.height*.12) && !/\s$/.test(text) && !/^\s/.test(p.text)?' ':'')+p.text;
      },'').trim();
    }
    cellRows.push(cells);
  }
  const headers=cellRows[0], columns=headers?.length;
  if (cellRows.length < 3 || cellRows.length > 20 || columns < 3 || columns > 20 ||
      !headers.every(c => /\p{L}/u.test(c.text) && c.end-c.x < width*.25)) return null;
  const tolerance=headers.reduce((maximum,c)=>c.parts.reduce((n,p)=>Math.max(n,p.height*.75),maximum),3);
  for (const [row,cells] of cellRows.entries()) {
    if (row && Math.min(...cells.flatMap(c=>c.parts.map(p=>p.y))) <
        Math.max(...cellRows[row-1].flatMap(c=>c.parts.map(p=>p.y+p.height))) - .5) return null;
    if (cells.length !== columns || cells.some((c,col) => !c.text ||
        Math.abs(c.x-headers[col].x)>tolerance || c.end-c.x >= width*.25 ||
        (col<columns-1 && c.end>=headers[col+1].x-tolerance))) return null;
    if (row && cells.filter(c=>numeric(c.text)).length < 2) return null;
  }
  // The band heuristic may stop before a damaged/merged final row. A clean
  // prefix is insufficient evidence: require a clear trailing boundary too.
  // Nearby prose also makes that boundary ambiguous, so do not guess a grid.
  const rowY=cellRows.map(row=>Math.min(...row.flatMap(c=>c.parts.map(p=>p.y))));
  const gaps=rowY.slice(1).map((y,index)=>y-rowY[index]).sort((a,b)=>a-b);
  const lastY=rowY.at(-1),nextLimit=lastY+gaps[Math.floor(gaps.length/2)]*1.5;
  const owned=new Set(ids);
  if (visible.some(p=>!owned.has(p.id) && p.y>lastY && p.y<=nextLimit)) return null;
  const cells=cellRows.flatMap((row,r)=>row.map((cell,c)=>{
    const rowHeader=r>0 && /\p{L}/u.test(row[0].text);
    const role=r===0 || (c===0 && rowHeader)?'header':'value';
    return {id:`c${r+1}-${c+1}`,row:r,column:c,rowSpan:1,colSpan:1,text:cell.text,role,
      headerCellIds:r===0?[]:[`c1-${c+1}`,...(c>0 && rowHeader?[`c${r+1}-1`]:[])],
      sourceFragmentIds:cell.parts.map(p=>`${pageId}-f${p.id}`)};
  }));
  return {rowCount:cellRows.length,columnCount:columns,cells,reviewed:false};
}

export function retainTableCellSources(previous, next) {
  const table=structuredClone(next);
  delete table.sourceReview; delete table.sourceReviewChecked;
  if (!Array.isArray(table?.cells)) return table;
  for (const cell of table.cells) {
    delete cell.sourceFragmentIds;
    const source=previous?.cells?.find(old=>old.id===cell.id);
    if (source && ['text','row','column','rowSpan','colSpan'].every(key=>source[key]===cell[key]) &&
        Array.isArray(source.sourceFragmentIds)) cell.sourceFragmentIds=[...source.sourceFragmentIds];
  }
  return table;
}
