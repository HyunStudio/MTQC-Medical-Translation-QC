const kinds = new Set(['update-region','replace-text-regions','reorder','set-cells','set-equation',
  'set-figure-labels','set-caption-link','set-footnote-review','update-edge','set-page-inventory',
  'assess-page-concern','add-region','verify-reading-order','verify-footnote-links']);
const origins = new Set(['review-ui','programmatic-order-preview']);

function packet(value) {
  if (!value || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new TypeError('Plain action required');
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  if(keys.length!==3 || !['kind','origin','pageIds'].every(key=>fields[key]?.enumerable && Object.hasOwn(fields[key],'value')))
    throw new TypeError('Action fields must be exact data');
  const kind=fields.kind.value,origin=fields.origin.value,pages=fields.pageIds.value;
  if(!kinds.has(kind) || !origins.has(origin) || !Array.isArray(pages)) throw new TypeError('Unknown structural action');
  const descriptors=Object.getOwnPropertyDescriptors(pages),length=descriptors.length.value;
  if(length<1 || length>2 || Reflect.ownKeys(descriptors).length!==length+1) throw new TypeError('Action page limit');
  const pageIds=[];
  for(let n=0;n<length;n++){
    const field=descriptors[String(n)];
    if(!field?.enumerable || !Object.hasOwn(field,'value') || !['p1','p2'].includes(field.value))
      throw new TypeError('Local page data required');
    pageIds.push(field.value);
  }
  if(new Set(pageIds).size!==length) throw new TypeError('Duplicate action page');
  return {kind,origin,pageIds};
}

/** Bounded observed controller trace, not authenticated human work/time. */
export function createPrivateInteractionJournal({now=()=>performance.now()}={}) {
  let generation=null,events=[],dropped=0,start=null,last=null,incomplete=false;
  function clock(){const value=now();if(!Number.isFinite(value)||value<0)throw new TypeError('Invalid clock');return value;}
  function missed(){incomplete=true;dropped=Math.min(Number.MAX_SAFE_INTEGER,dropped+1);}
  return {
    reset(sourceGeneration){
      if(sourceGeneration!==null && (!Number.isSafeInteger(sourceGeneration)||sourceGeneration<1))
        throw new TypeError('Positive controller generation required');
      generation=sourceGeneration;events=[];dropped=0;start=null;last=null;incomplete=false;
      if(generation!==null){try{start=last=clock();}catch{incomplete=true;}}
    },
    record(action){
      if(generation===null)return;
      try{
        const captured=packet(action),time=clock();
        if(start===null || time<last)throw new TypeError('Clock reversed or unavailable');
        const entry={sequence:events.length+1,...captured,offsetMs:time-start};
        if(events.length>=256 || JSON.stringify([...events,entry]).length>65000)throw new RangeError('Trace limit');
        events.push(entry);last=time;
      }catch{missed();}
    },
    snapshot(){return structuredClone({schemaVersion:1,sourceGeneration:generation,
      actorAuthentication:'unavailable',timestampMeaning:'controller-monotonic-offset-ms',
      captureStatus:generation===null?'inactive':incomplete?'incomplete':'complete',
      recordedStructuralActionCount:events.length,droppedStructuralActionCount:dropped,events});}
  };
}
