(() => {
 const $=id=>document.getElementById(id); let lastRows=[];
 const percentile=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(p*s.length)-1)]};
 const median=a=>{const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};
 function graph(n){const nodes=new Map(),edges=[];for(let i=0;i<n;i++)nodes.set('n'+i,'up');for(let i=1;i<n;i++)edges.push({id:'e'+(i-1),a:'n'+(i-1),b:'n'+i,status:'up'});for(let i=0;i<n-5;i+=7)edges.push({id:'x'+i,a:'n'+i,b:'n'+(i+5),status:'up'});return {nodes,edges};}
 function analyze(g){const adj=new Map();for(const [id,s] of g.nodes)if(s!=='down')adj.set(id,[]);for(const e of g.edges)if(e.status!=='down'&&adj.has(e.a)&&adj.has(e.b)){adj.get(e.a).push(e.b);adj.get(e.b).push(e.a);}const seen=new Set();let components=0,largest=0;for(const id of adj.keys()){if(seen.has(id))continue;components++;let q=[id],size=0;seen.add(id);for(let i=0;i<q.length;i++){size++;for(const v of adj.get(q[i]))if(!seen.has(v)){seen.add(v);q.push(v);}}largest=Math.max(largest,size);}return {components,largest,reachable:seen.size};}
 function clone(g){return {nodes:new Map(g.nodes),edges:g.edges.map(e=>({...e}))};}
 function makeWork(g,count){const ops=[];for(let i=0;i<count;i++){if(i%2===0){const id='n'+((i*37+11)%g.nodes.size);ops.push({kind:'node',id,status:i%3===0?'down':'up'});}else{const e=g.edges[(i*19+3)%g.edges.length];ops.push({kind:'edge',id:e.id,status:i%3===0?'down':'up'});}}return ops;}
 function apply(g,op){if(op.kind==='node')g.nodes.set(op.id,op.status);else{const e=g.edges.find(x=>x.id===op.id);if(e)e.status=op.status;}}
 function summary(g){const a=analyze(g);return JSON.stringify({nodes:[...g.nodes].sort((a,b)=>a[0].localeCompare(b[0])),edges:g.edges.map(e=>[e.id,e.status]).sort((a,b)=>a[0].localeCompare(b[0])),analysis:a});}
 async function runSize(n,trials,updates,wait){const base=graph(n),ops=makeWork(base,updates),seqTimes=[],batTimes=[];let valid=true,seqSummary='',batSummary='';for(let t=0;t<trials;t++){let s=clone(base),start=performance.now();for(const op of ops){apply(s,op);analyze(s);}seqTimes.push(performance.now()-start);seqSummary=summary(s);let b=clone(base),bt=performance.now();for(const op of ops)apply(b,op);if(wait>0)await new Promise(r=>setTimeout(r,wait));analyze(b);batTimes.push(performance.now()-bt);batSummary=summary(b);if(seqSummary!==batSummary)valid=false;}const sm=median(seqTimes),bm=median(batTimes);return {nodes:n,links:base.edges.length,updates,trials,wait,seqMedian:sm,batMedian:bm,degradation:(bm/sm-1)*100,seqP95:percentile(seqTimes,.95),batP95:percentile(batTimes,.95),valid};}
 $('run').onclick=async()=>{
  const trials=Math.max(30,Math.min(200,Number($('trials').value)||30));
  const updates=Math.max(10,Math.min(500,Number($('updates').value)||40));
  const fixedWait=Math.max(0,Math.min(100,Number($('window').value)||0));
  const mode=$('mode')?.value||'fixed';
  $('run').disabled=true;$('status').textContent='Running benchmark… keep this tab active.';$('results').innerHTML='';lastRows=[];
  for(const n of [100,500,1000]){
   const wait=mode==='adaptive'?(n<=1000?0:1):fixedWait;
   const r=await runSize(n,trials,updates,wait);r.mode=mode;lastRows.push(r);
   const tr=document.createElement('tr');const fmt=x=>x.toFixed(3)+' ms';
   tr.innerHTML=`<td>${r.nodes.toLocaleString()} / ${r.links.toLocaleString()}</td><td>${fmt(r.seqMedian)}</td><td>${fmt(r.batMedian)}</td><td class="${r.degradation<=20?'good':'warn'}">${r.degradation.toFixed(1)}%</td><td>${fmt(r.seqP95)} / ${fmt(r.batP95)}</td><td class="${r.valid?'good':'warn'}">${r.valid?'MATCH':'MISMATCH'}</td>`;
   $('results').appendChild(tr);
  }
  $('raw').textContent=JSON.stringify({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency||'unknown',timestamp:new Date().toISOString(),mode,results:lastRows},null,2);
  $('status').textContent='Complete. Repeat the run at least three times and record the browser/device used.';$('csv').disabled=false;$('run').disabled=false;
 };
 $('csv').onclick=()=>{if(!lastRows.length)return;const cols=Object.keys(lastRows[0]),lines=[cols.join(','),...lastRows.map(r=>cols.map(k=>r[k]).join(','))];const blob=new Blob([lines.join('\n')],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='netflow-benchmark-results.csv';a.click();URL.revokeObjectURL(url);};
})();