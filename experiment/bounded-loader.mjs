// Isolated experimental prototype; not production code.
export const defaults = { bytes: 32*1024*1024, line: 256*1024, v1Bytes: 2*1024*1024, events:100000, markers:1000, depth:16, tokens:500000, lineTokens:20000, dimension:1000 };
export function complexity(text, {depth,tokens}) {
 let quoted=false, escaped=false, nesting=0, count=0, primitive=false;
 for(let i=0;i<text.length;i++) {
  const c=text[i];
  if(quoted) { if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false; continue; }
  if(c==='"') { quoted=true; primitive=false; if(++count>tokens) throw Error('complexity'); }
  else if(c==='['||c==='{') { primitive=false; if(++nesting>depth) throw Error('depth'); if(++count>tokens) throw Error('complexity'); }
  else if(c===']'||c==='}') { primitive=false; if(--nesting<0) throw Error('invalid'); }
  else if(c===','||c===':'||/\s/.test(c)) primitive=false;
  else if(!primitive) { primitive=true; if(++count>tokens) throw Error('complexity'); }
 }
 if(quoted||nesting!==0) throw Error('invalid');
 return count;
}
export async function loadBounded(response, limits={}, metrics={}) {
 const l={...defaults,...limits}; Object.assign(metrics,{bytes:0,lines:0,events:0,markers:0,parsed:0,canceled:false});
 if(!response.ok||!response.body?.getReader) throw Error('response');
 const reader=response.body.getReader(); const decoder=new TextDecoder('utf-8',{fatal:true});
 const deadline=performance.now()+(l.totalTimeoutMs??30000);
 async function read(){let timer;try{return await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),Math.max(0,Math.min(l.readTimeoutMs??5000,deadline-performance.now())));})]);}finally{clearTimeout(timer);}}
 let pending='', lineBytes=0, first=true, mode, header, events=[], v1=[],time=0;
 const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&Number.isFinite(x*1000);
 const dim=x=>Number.isInteger(x)&&x>0&&x<=l.dimension;
 const parse=s=>{complexity(s,{depth:l.depth,tokens:l.lineTokens});metrics.parsed++; return JSON.parse(s);};
 function checkHeader(h){ if(!h||![1,2,3].includes(h.version))throw Error('header'); const t=h.version===3?h.term:h;if(!t||!dim(h.version===3?t.cols:t.width)||!dim(h.version===3?t.rows:t.height))throw Error('dimensions'); if(l.cells && (h.version===3?t.cols:t.width)*(h.version===3?t.rows:t.height)>l.cells)throw Error('cells'); for(const k of ['duration','idle_time_limit'])if(k in h&&!finite(h[k]))throw Error('time'); }
 function line(s){
  metrics.lines++;
  if(first){first=false;try{header=parse(s);}catch{mode='v1';v1.push(s+'\n');return;}checkHeader(header);if(header.version===1)throw Error('compact-v1');mode='jsonl';return;}
  if(mode==='v1'){v1.push(s+'\n');return;}
  if(++metrics.events>l.events)throw Error('events');
  if(header.version===3&&s[0]==='#')return;
  if(s[0]!=='[')throw Error('event'); const e=parse(s);
  if(!Array.isArray(e)||e.length!==3||!finite(e[0])||typeof e[1]!=='string'||!e[1]||typeof e[2]!=='string')throw Error('event');
  if(header.version===2&&e[0]<time)throw Error('time');time=header.version===2?e[0]:time+e[0];if(!finite(time))throw Error('time');
  if(e[1]==='r'){const m=/^([1-9][0-9]{0,3})x([1-9][0-9]{0,3})$/.exec(e[2]);if(!m||!dim(+m[1])||!dim(+m[2]))throw Error('dimensions');if(l.cells&&(+m[1])*(+m[2])>l.cells)throw Error('cells');}
  if(e[1]==='m'&&++metrics.markers>l.markers)throw Error('markers'); events.push(e);
 }
 try {
  while(true){const {value,done}=await read();if(done)break;
   metrics.bytes+=value.byteLength;if(metrics.bytes>l.bytes||(mode==='v1'&&metrics.bytes>l.v1Bytes))throw Error('bytes');
   let start=0;
   for(let i=0;i<=value.length;i++)if(i===value.length||value[i]===10){const part=value.subarray(start,i);lineBytes+=part.length;if(mode!=='v1'&&lineBytes>l.line)throw Error('line');pending+=decoder.decode(part,{stream:true});if(i<value.length){line(pending);pending='';lineBytes=0;start=i+1;}}
  }
  pending+=decoder.decode();if(pending)line(pending);
  if(mode==='v1'){if(metrics.bytes>l.v1Bytes)throw Error('bytes');const text=v1.join('');complexity(text,{depth:l.depth,tokens:l.tokens});metrics.parsed++;const h=JSON.parse(text);checkHeader(h);if(h.version!==1||!Array.isArray(h.stdout)||h.stdout.length>l.events)throw Error('v1');for(const e of h.stdout){if(!Array.isArray(e)||e.length!==2||!finite(e[0])||typeof e[1]!=='string')throw Error('v1');time+=e[0];if(!finite(time))throw Error('time');}metrics.events=h.stdout.length;return h;}
  if(!header||!events.length)throw Error('empty');return [header,...events];
 }catch(e){metrics.canceled=true;await reader.cancel(e.message).catch(()=>{});throw e;}finally{reader.releaseLock();}
}
