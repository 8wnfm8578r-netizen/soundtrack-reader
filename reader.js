'use strict';const $=id=>document.getElementById(id), book=$('book'), holder=$('holder'), keys=['theme','size','leading','measure','volume','ambient','fade','paged','debug'];let lastSettledY=0,lastGesture=0,scrollBurst=null;let savedPage=null;let progressIndex=[], progressTotal=0, progressFrame=0;let virtualHeights=[], virtualGeometry="", library=[], windowStart=-1, windowEnd=-1, layoutToken=0, restoring=false, soundChapter=0, soundAnchor=0, offset=0;let db, chapters=[], cues=[], assets=new Map(), chapter=0, page=0, pages=1, anchor=0, playing=false, ctx, buses={}, voices={}, wanted={}, generation=0, timer, marks=[], identity='', title='', urls=[], busy=false;let prefs={};try{prefs=JSON.parse(localStorage.getItem('sr02prefs')||'{}')}catch{};for(const k of keys)if(k in prefs)$(k).type==='checkbox'?$(k).checked=prefs[k]:$(k).value=prefs[k];
function openDB(){return new Promise((ok,no)=>{let r=indexedDB.open('soundtrack-reader-v02',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}function store(k,v){return new Promise((ok,no)=>{let t=db.transaction('files','readwrite');t.objectStore('files').put(v,k);t.oncomplete=ok;t.onerror=()=>no(t.error);t.onabort=()=>no(t.error)})}function get(k){return new Promise((ok,no)=>{let r=db.transaction('files').objectStore('files').get(k);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}function state(){try{return JSON.parse(localStorage.getItem('sr02:'+identity)||'{}')}catch{return {}}}function save(){if(identity&&!busy)try{localStorage.setItem('sr02:'+identity,JSON.stringify({chapter,anchor,offset,marks,page:$('paged').checked?page:null,pageWidth:holder.clientWidth,pageHeight:holder.clientHeight,typography:[$('size').value,$('leading').value,$('measure').value].join('|')}))}catch{}}function path(base,rel){let p=(base.slice(0,base.lastIndexOf('/')+1)+rel.split('#')[0]).split('/'),a=[];for(let x of p){if(x==='..')a.pop();else if(x&&x!=='.')a.push(x)}return a.join('/')}function xml(s){let d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw Error('Invalid EPUB XML');return d}function els(d,n){return [...d.getElementsByTagNameNS('*',n)]}async function read(z,p){let f=z.file(p);if(!f)throw Error('Missing '+p);return f.async('string')}
async function load(file,persist){if(busy)return;if(!restoring&&chapters.length&&!$('paged').checked)position();save();busy=true;stop();$('status').textContent='Importing…';try{let oldUrls=urls;urls=[];let z=await JSZip.loadAsync(file), manifest=null, ez=z, newAssets=new Map(), newCues=[];if(z.file('book.json')){manifest=JSON.parse(await read(z,'book.json'));if(manifest.version!==1)throw Error('Unsupported package version');let f=z.file(manifest.epub);if(!f)throw Error('Missing EPUB');ez=await JSZip.loadAsync(await f.async('arraybuffer'));newCues=JSON.parse(await read(z,manifest.cues));if(manifest.id==='lantern-demo-v02'&&Array.isArray(newCues))for(const c of newCues)if(c.layer==='music'&&[1,2].includes(c.chapter)&&c.paragraph===2&&c.file===`Music/scene${c.chapter}.wav`)c.paragraph=0;if(!Array.isArray(newCues))throw Error('Invalid cues');for(let c of newCues){if(!Number.isInteger(c.chapter)||!Number.isInteger(c.paragraph)||c.chapter<0||c.paragraph<0||!['music','ambience'].includes(c.layer)||!(c.file===null||typeof c.file==='string'))throw Error('Invalid cue');if(c.file&&!newAssets.has(c.file)){let f=z.file(c.file);if(!f)throw Error('Missing audio: '+c.file);newAssets.set(c.file,f)}}}let root=els(xml(await read(ez,'META-INF/container.xml')),'rootfile')[0].getAttribute('full-path'), opf=xml(await read(ez,root)), items=new Map(els(opf,'item').map(e=>[e.getAttribute('id'),e])), list=[], newTitle=els(opf,'title')[0]?.textContent||file.name;for(let ref of els(opf,'itemref')){let item=items.get(ref.getAttribute('idref'));if(!item)continue;let href=path(root,item.getAttribute('href')), d=new DOMParser().parseFromString(await read(ez,href),'text/html');let body=d.body;body.querySelectorAll('script,style,iframe,object,embed,form,link,meta,base,svg,video,audio,source').forEach(e=>e.remove());for(let e of body.querySelectorAll('*')){for(let a of [...e.attributes])if(!['id','class','alt','title','colspan','rowspan','lang','dir'].includes(a.name)&&!(e.tagName==='IMG'&&a.name==='src'))e.removeAttribute(a.name);if(e.tagName==='IMG'){let f=ez.file(path(href,e.getAttribute('src')||''));if(f&&/\.(png|jpe?g|gif|webp)$/i.test(f.name)){let ext=f.name.split('.').pop().toLowerCase(),u=URL.createObjectURL(new Blob([await f.async('uint8array')],{type:'image/'+(ext==='jpg'?'jpeg':ext)}));urls.push(u);e.src=u;let im=new Image();im.src=u;try{await im.decode();e.setAttribute('width',im.naturalWidth);e.setAttribute('height',im.naturalHeight)}catch{}}else e.remove()}}list.push({html:body.innerHTML,title:body.querySelector('h1,h2,h3')?.textContent||d.title||'Chapter '+(list.length+1)})}if(!list.length)throw Error('No readable EPUB sections');for(let c of newCues){if(!list[c.chapter])throw Error('Cue chapter out of range');let d=new DOMParser().parseFromString(list[c.chapter].html,'text/html');if(c.paragraph>=d.querySelectorAll('p,h1,h2,h3,h4,blockquote,li,pre').length)throw Error('Cue paragraph out of range')}let newId=manifest?.id||newTitle+':'+file.size;let author=els(opf,'creator')[0]?.textContent||'';if(persist){await store('book:'+newId,file);let next=library.filter(x=>x.id!==newId);next.unshift({id:newId,title:newTitle,author,count:list.length});await store('library',next);library=next;}await store('active',newId);for(let u of oldUrls)URL.revokeObjectURL(u);chapters=list;virtualHeights=[];virtualGeometry="";invalidateSearch();buildProgressIndex();assets=newAssets;cues=newCues.sort((a,b)=>a.chapter-b.chapter||a.paragraph-b.paragraph);identity=newId;windowStart=windowEnd=-1;title=newTitle;let s=state();marks=s.marks||[];chapter=Math.min(chapters.length-1,s.chapter||0);anchor=s.anchor||0;offset=s.offset||0;$('title').textContent=title;savedPage=$('paged').checked&&Number.isInteger(s.page)?s:null;render(anchor,offset);$('status').textContent='Ready · '+assets.size+' audio files';temporaryChapterPositions.clear();}catch(e){$('status').textContent='Import failed: '+e.message;throw e}finally{busy=false;save()}}
function blocks(){let root=$('paged').checked?book:book.querySelector(`section[data-chapter="${chapter}"]`);return root?[...root.querySelectorAll('p,h1,h2,h3,h4,blockquote,li,pre')]:[]}
function section(i){let e=document.createElement('section');e.dataset.chapter=i;e.innerHTML=chapters[i].html;e.querySelectorAll('p,h1,h2,h3,h4,blockquote,li,pre').forEach((b,j)=>b.dataset.anchor=j);return e}
// v0.4.92.2.2 experimental: give every chapter a persistent place in the scrollable
// document. Unloaded chapters retain an estimated/measured height instead of
// disappearing and forcing Safari's scrollbar to change length during a drag.
function virtualSignature(){return [holder.clientWidth, $('size').value,$('leading').value,$('measure').value].join('|')}
function estimateChapterHeight(i){
  const d=new DOMParser().parseFromString(chapters[i].html,'text/html');
  const font=Math.max(16,+$('size').value||21),line=Math.max(1.3,+$('leading').value||1.75);
  const width=Math.max(240,Math.min(+( $('measure').value)||660,innerWidth)-44);
  const charsPerLine=Math.max(18,Math.floor(width/(font*.53)));
  let count=0,blocks=d.querySelectorAll('p,h1,h2,h3,h4,blockquote,li,pre');
  for(const b of blocks){const chars=b.textContent.trim().length;count+=Math.max(1,Math.ceil(chars/charsPerLine))*font*line+font*line*.62;}
  for(const im of d.querySelectorAll('img'))count+=Math.min(480,width*.75)+font;
  return Math.max(220,Math.ceil(count+24));
}
function prepareVirtualHeights(force=false){
  const sig=virtualSignature();if(!force&&virtualGeometry===sig&&virtualHeights.length===chapters.length)return;
  virtualGeometry=sig;virtualHeights=chapters.map((_,i)=>estimateChapterHeight(i));
}
function placeholder(i){let e=document.createElement('section');e.dataset.chapter=i;e.dataset.virtual='1';e.style.height=Math.ceil(virtualHeights[i]||240)+'px';e.setAttribute('aria-hidden','true');return e}
function fillWindow(center){
  prepareVirtualHeights();windowStart=Math.max(0,center-2);windowEnd=Math.min(chapters.length-1,center+2);
  const fragment=document.createDocumentFragment();
  for(let i=0;i<chapters.length;i++)fragment.append(i>=windowStart&&i<=windowEnd?section(i):placeholder(i));
  book.replaceChildren(fragment);
}
function findVirtualSection(line){
  const sections=book.children;let selected=null;
  for(let i=0;i<sections.length;i++){let el=sections[i];if(el.getBoundingClientRect().top<=line)selected=el;else break}
  return selected||sections[0]||null;
}
function materializeNearby(center){
  const low=Math.max(0,center-2),high=Math.min(chapters.length-1,center+2);
  // Capture current section's viewport coordinate before any height revisions.
  const original=book.children[center];const before=original?.getBoundingClientRect().top||0;
  for(let i=0;i<chapters.length;i++){
    let el=book.children[i];if(!el)break;
    if(i>=low&&i<=high){if(el.dataset.virtual==='1')el.replaceWith(section(i));}
    else if(el.dataset.virtual!=='1'){
      const measured=el.getBoundingClientRect().height;
      if(measured>0)virtualHeights[i]=measured;
      el.replaceWith(placeholder(i));
    }
  }
  windowStart=low;windowEnd=high;
  const after=book.children[center]?.getBoundingClientRect().top||0;
  const shift=after-before;
  // This runs after scrolling settles, never during touch/scrollbar movement.
  if(Math.abs(shift)>1)scrollBy(0,shift);
}

function render(a=0,o=0){offset=o;soundChapter=chapter;soundAnchor=a;clearTimeout(timer);if($('paged').checked){book.innerHTML=chapters[chapter].html;blocks().forEach((e,i)=>e.dataset.anchor=i);windowStart=windowEnd=-1}else fillWindow(chapter);layout(a,o);update();save()}
function readingLine(){return document.querySelector('header').getBoundingClientRect().bottom+12}
function layout(a=anchor,o=offset){anchor=a;offset=o;let token=++layoutToken;scrollBurst=null;restoring=true;clearTimeout(timer);document.body.classList.toggle('paged',$('paged').checked);holder.id=$('paged').checked?'page':'holder';book.style.transform='';book.style.columnWidth='';if($('paged').checked){let w=holder.clientWidth-44;book.style.columnWidth=w+'px';let stride=w+44;pages=Math.max(1,Math.ceil((book.scrollWidth+44)/stride));let b=blocks()[a];page=b?Math.max(0,Math.floor((b.getBoundingClientRect().left-book.getBoundingClientRect().left+1)/stride)):0;if(savedPage===-1)page=pages-1;else if(savedPage&&savedPage.pageWidth===holder.clientWidth&&savedPage.pageHeight===holder.clientHeight&&savedPage.typography===[$('size').value,$('leading').value,$('measure').value].join('|'))page=savedPage.page;savedPage=null;page=Math.max(0,Math.min(pages-1,page));book.style.transform=`translateX(${-page*stride}px)`;scrollTo(0,0);restoring=false;if(!busy)position();else {let left=holder.getBoundingClientRect().left+22;let i=blocks().findIndex(b=>[...b.getClientRects()].some(r=>r.right>left+2&&r.left<left+holder.clientWidth-44));if(i>=0)anchor=soundAnchor=i;}}else{page=0;pages=1;requestAnimationFrame(()=>{if(token!==layoutToken)return;let b=blocks()[a]||book.querySelector(`section[data-chapter="${chapter}"]`);if(b)scrollTo(0,scrollY+b.getBoundingClientRect().top-readingLine()+o);else scrollTo(0,0);requestAnimationFrame(()=>{if(token===layoutToken){clearTimeout(timer);restoring=false;lastSettledY=scrollY;update();save();sync()}})})}}
function atLine(line){
  let current=findVirtualSection(line);if(!current)return null;
  if(current.dataset.virtual==='1')return {current,chapter:+current.dataset.chapter,anchor:0,offset:0,virtual:true};
  let bs=[...current.querySelectorAll('p,h1,h2,h3,h4,blockquote,li,pre')],i=bs.findIndex(b=>b.getBoundingClientRect().bottom>line);
  if(i<0)i=Math.max(0,bs.length-1);
  return {current,chapter:+current.dataset.chapter,anchor:i,offset:Math.max(0,line-(bs[i]?.getBoundingClientRect().top??line))};
}
function position(){
 if(!chapters.length||busy||restoring)return;
 if($('paged').checked){let bs=blocks(),left=holder.getBoundingClientRect().left+22;let found=bs.findIndex(b=>[...b.getClientRects()].some(r=>r.right>left+2&&r.left<left+holder.clientWidth-44));anchor=found<0?anchor:found;offset=0;soundChapter=chapter;soundAnchor=anchor}
 else{
   let first=atLine(readingLine());if(!first)return;
   // Never remove earlier chapters. Replace only their contents while keeping
   // corresponding placeholder heights. This is called after a scroll settles.
   materializeNearby(first.chapter);
   let p=atLine(readingLine()),q=atLine(Math.max(readingLine(),innerHeight*.42));if(!p)return;
   chapter=p.chapter;anchor=p.anchor;offset=p.offset;soundChapter=q?.chapter??chapter;soundAnchor=q?.anchor??anchor;
 }
 lastSettledY=scrollY;update();save();sync();
}
function go(delta){if(!chapters.length)return;if($('paged').checked&&page+delta>=0&&page+delta<pages){page+=delta;book.style.transform=`translateX(${-page*holder.clientWidth}px)`;position();return}let n=chapter+delta;if(n<0||n>=chapters.length)return;chapter=n;if($('paged').checked&&delta<0)savedPage=-1;render(0);sync()}function update(){if(!chapters.length)return;paintProgress();$('status').textContent=(playing?'Soundtrack playing':'Soundtrack paused')+($('debug').checked?' · paragraph '+anchor:'');$('chapterChoice').disabled=false;$('chapterChoice').textContent=compactSectionLabel(chapters[chapter]?.title,chapter)+' ▾';$('chapterChoice').setAttribute('aria-label','Select section; currently '+compactSectionLabel(chapters[chapter]?.title,chapter));$('play').textContent=playing?'Ⅱ Pause':'▶ Play'}
function apply(){document.body.dataset.theme=$('theme').value;for(let k of ['size','leading','measure'])document.documentElement.style.setProperty('--'+k,$(k).value+(k==='leading'?'':'px'));for(let k of keys)prefs[k]=$(k).type==='checkbox'?$(k).checked:$(k).value;try{localStorage.setItem('sr02prefs',JSON.stringify(prefs))}catch{};if(ctx)for(let [l,k] of [['music','volume'],['ambience','ambient']])buses[l].gain.setTargetAtTime(+$(k).value/100,ctx.currentTime,.08);if(chapters.length){const geometryChanged=virtualGeometry!==virtualSignature();if(!document.body.classList.contains('paged')&&geometryChanged){prepareVirtualHeights(true);fillWindow(chapter)}if(document.body.classList.contains('paged')!==$('paged').checked)render(anchor,offset);else layout(anchor,offset)}}
const retiring=new Set(), workers={};
function stop(){playing=false;generation++;for(let v of [...Object.values(voices),...retiring]){try{v.source.stop()}catch{}}retiring.clear();voices={};wanted={};if(ctx)ctx.suspend();update()}
function cueFor(layer){return cues.filter(c=>c.layer===layer&&(c.chapter<soundChapter||c.chapter===soundChapter&&c.paragraph<=soundAnchor)).at(-1)}
function fade(param,from,to,t,d){param.cancelScheduledValues(t);param.setValueAtTime(from,t);if(d<=0){param.setValueAtTime(to,t);return}let curve=Float32Array.from({length:32},(_,i)=>from+(to-from)*(.5-.5*Math.cos(Math.PI*i/31)));param.setValueCurveAtTime(curve,t,d)}
async function sync(){if(!playing||!ctx)return;for(const layer of ['music','ambience']){let c=cueFor(layer),key=c?.file||null;wanted[layer]={key,c};if(!workers[layer])workers[layer]=runLayer(layer).finally(()=>{delete workers[layer];if(playing&&wanted[layer]&&wanted[layer].key!==(voices[layer]?.key??null)&&!wanted[layer].failed)sync()})}}
async function runLayer(layer){while(playing){let req=wanted[layer];if(!req||req.key===(voices[layer]?.key??null))return;let g=generation, c=req.c, key=req.key;try{let buffer=key?await ctx.decodeAudioData(await assets.get(key).async('arraybuffer')):null;if(g!==generation||!playing)return;if(wanted[layer]?.key!==key)continue;let old=voices[layer],t=ctx.currentTime,d=Math.max(0,Number(c?.fadeOut??$('fade').value));if(old){let gain=old.gain.gain,v=gain.value;fade(gain,v,0,t,d);retiring.add(old);old.source.onended=()=>{retiring.delete(old);old.source.disconnect();old.gain.disconnect()};try{old.source.stop(t+d+.05)}catch{}delete voices[layer]}if(buffer){let source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.loop=c.loop!==false;let ls=Number(c.loopStart??0),le=Number(c.loopEnd??buffer.duration);if(ls>=0&&le>ls&&le<=buffer.duration){source.loopStart=ls;source.loopEnd=le}let target=Math.max(0,Math.min(2,Number(c.gain??1)*Math.pow(10,Number(c.normalizationDb??0)/20)));fade(gain.gain,0,target,t,Math.max(0,Number(c.fadeIn??1)));source.connect(gain).connect(buses[layer]);source.start();voices[layer]={source,gain,key};}return}catch(e){if(g===generation&&wanted[layer]?.key===key){wanted[layer].failed=true;$('status').textContent='Audio error: '+e.message;return}}}}
$('play').onclick=async()=>{if(!chapters.length)return;if(playing){stop();return}try{if(!ctx){ctx=new (window.AudioContext||window.webkitAudioContext)();for(let l of ['music','ambience']){buses[l]=ctx.createGain();buses[l].connect(ctx.destination)}apply()}await ctx.resume();playing=true;update();await sync()}catch(e){$('status').textContent=e.message}};$('file').onchange=async()=>{let f=$('file').files[0];if(f)try{await load(f,true)}catch(e){alert(e.message)}$('file').value=''};$('prev').onclick=()=>go(-1);$('next').onclick=()=>go(1);$('settings').onclick=()=>{$('prefs').showModal();$('prefsHeading').focus({preventScroll:true})};$('close').onclick=()=>{$('prefs').close();sync()};$('closeToc').onclick=()=>$('contents').close();$('bookmark').onclick=()=>{if(!chapters.length)return;marks.push({chapter,anchor});save();$('prefs').close()};$('toc').onclick=()=>{if(!restoring&&!busy&&chapters.length)position();for(let [id,arr] of [['links',chapters.map((c,i)=>({chapter:i,anchor:0,title:c.title}))],['marks',marks.map(m=>({...m,title:chapters[m.chapter]?.title+' · '+(m.anchor+1)}))]]){$(id).replaceChildren();for(let m of arr){let b=document.createElement('button');b.textContent=m.title;if(id==='links'&&m.chapter===chapter){b.classList.add('activeChapter');b.setAttribute('aria-current','location')}b.onclick=()=>{chapter=m.chapter;render(m.anchor);$('contents').close();sync()};$(id).append(b)}}const dialog=$('contents'),sc=$('contentsScroll'),active=$('links').querySelector('.activeChapter'),tail=$('tocTail');tail.style.height='0px';dialog.showModal();$('tocHeading').focus({preventScroll:true});const align=()=>{if(!dialog.open)return;tail.style.height=sc.clientHeight+'px';sc.scrollTop=active?active.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop-sc.clientTop:0};align();requestAnimationFrame(()=>{align();requestAnimationFrame(align)})};for(let k of keys)$(k).onchange=apply;addEventListener('scroll',()=>{if(!$('paged').checked&&!busy&&!restoring){let now=Date.now();if(!scrollBurst)scrollBurst={chapter,y:lastSettledY,manual:now-lastGesture<1800};if(now-lastGesture<1800){scrollBurst.manual=true;lastGesture=now;}if(!progressFrame)progressFrame=requestAnimationFrame(()=>{progressFrame=0;paintProgress()});clearTimeout(timer);timer=setTimeout(finishScroll,220)}},{passive:true});function finishScroll(){let b=scrollBurst;scrollBurst=null;if(!b||busy||restoring||$('paged').checked)return;if(!b.manual&&b.y>8&&scrollY<=2&&chapters.length){chapter=b.chapter;render(0);return;}position()}addEventListener('resize',()=>{if(chapters.length)layout(anchor)});let x;for(const event of ['touchstart','touchmove','touchend','touchcancel','wheel','pointerdown','keydown'])addEventListener(event,()=>{lastGesture=Date.now();if(scrollBurst)scrollBurst.manual=true},{passive:true});holder.addEventListener('touchstart',e=>x=e.changedTouches[0].clientX,{passive:true});holder.addEventListener('touchend',e=>{let d=e.changedTouches[0].clientX-x;if($('paged').checked&&Math.abs(d)>60)go(d<0?1:-1)},{passive:true});apply();(async()=>{try{db=await openDB();library=await get('library')||[];let active=await get('active');if(active){let f=await get('book:'+active);if(f)await load(f,false)}else if(await get('library')===undefined){let f=await get('current');if(f)await load(f,true)}}catch(e){$('status').textContent='Storage: '+e.message}})();if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(console.error);


// Compact labels use EPUB section headings, not zero-based spine positions.
// Keep chapter numbers and structure; omit narrative chapter subtitles.
function compactSectionLabel(raw,index){
 const heading=String(raw||'').replace(/\s+/g,' ').trim();
 if(index===0&&!heading)return 'Cover';
 if(/^Purple Days$/i.test(heading))return 'Title page';
 let arc=heading.match(/^(?:Arc|Ark)\s*(\d+)\s*:\s*[^.]*\.\s*(.+)$/i);
 let prefix='';let name=heading;
 if(arc){prefix='Arc '+arc[1]+' · ';name=arc[2].trim()}
 let chapterMatch=name.match(/^Chapter\s+(\d+)(?:\s*:\s*|\s+)(.*)$/i);
 if(chapterMatch){
  let suffix=chapterMatch[2]||'';
  const part=suffix.match(/(?:,\s*|\s+)(part\s+(?:\d+|one|two|three|four|[ivx]+))\s*$/i);
  return prefix+'Chapter '+Number(chapterMatch[1])+(part?' · '+part[1].replace(/^part/i,'Part'):'');
 }
 if(/^Interlude\s*I\s*:/i.test(name))return prefix+'Interlude I';
 if(/^Interlude\s*:/i.test(name))return prefix+name.replace(/^Interlude\s*:/i,'Interlude:');
 if(/^Epilogue\b/i.test(name))return prefix+'Epilogue';
 if(/^Appendix\s*:/i.test(name))return prefix+name;
 if(/^Soundtrack index$/i.test(name))return 'Soundtrack index';
 if(/^Prologue\b/i.test(name))return prefix+name.replace(/\s*\([^)]*\)\s*$/,'');
 return prefix+(name||'Section '+(index+1));
}
// v0.4.92.2: Short-lived per-chapter position memory, used only by the footer picker.
// No persistence, no new bookmarks, and never applied to ordinary page turns.
const temporaryChapterPositions=new Map(),CHAPTER_RETURN_MS=90000;
function captureTemporaryChapter(){
 if(!chapters.length||busy||restoring)return;
 position();
 temporaryChapterPositions.set(identity+':'+chapter,{
  at:Date.now(),chapter,anchor,offset,page:$('paged').checked?page:null,
  pageWidth:holder.clientWidth,pageHeight:holder.clientHeight,
  typography:[$('size').value,$('leading').value,$('measure').value].join('|')
 });
 for(const [k,v] of temporaryChapterPositions)if(Date.now()-v.at>CHAPTER_RETURN_MS)temporaryChapterPositions.delete(k);
}
function footerChapterJump(target){
 if(busy||restoring||!chapters[target])return;
 if(target===chapter){$('chapterDialog').close();return}
 captureTemporaryChapter();
 const remembered=temporaryChapterPositions.get(identity+':'+target);
 const restore=remembered&&Date.now()-remembered.at<=CHAPTER_RETURN_MS;
 chapter=target;
 savedPage=restore&&$('paged').checked&&Number.isInteger(remembered.page)?remembered:null;
 render(restore?remembered.anchor:0,restore?remembered.offset:0);
 $('chapterDialog').close();sync();
}
$('chapterChoice').onclick=()=>{
 if(!chapters.length||busy)return;
 if(!restoring)position();
 const list=$('chapterList');list.replaceChildren();
 chapters.forEach((c,i)=>{
  let button=document.createElement('button');
  button.type='button';button.textContent=compactSectionLabel(c.title,i)+(i===chapter?'  ✓':'');
  if(i===chapter){button.classList.add('activeChapter');button.setAttribute('aria-current','location')}
  button.title=c.title;button.onclick=()=>footerChapterJump(i);list.append(button);
 });
 const dialog=$('chapterDialog'),sc=$('chapterScroll'),active=list.querySelector('.activeChapter'),tail=$('chapterTail');
 tail.style.height='0px';dialog.showModal();$('chapterHeading').focus({preventScroll:true});
 const align=()=>{if(!dialog.open)return;tail.style.height=sc.clientHeight+'px';sc.scrollTop=active?active.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop:0};
 align();requestAnimationFrame(()=>{align();requestAnimationFrame(align)});
};
$('chapterClose').onclick=()=>$('chapterDialog').close();

function drawLibrary(){let list=$('libraryList');list.replaceChildren();if(!library.length)list.textContent='No imported books yet.';for(let item of [...library].sort((a,b)=>a.title.localeCompare(b.title,undefined,{sensitivity:"base"}))){let b=document.createElement('button'), st={};try{st=JSON.parse(localStorage.getItem('sr02:'+item.id)||'{}')}catch{};b.textContent=item.title+(item.author?' — '+item.author:'')+' · Chapter '+((st.chapter||0)+1)+'/'+item.count+(item.id===identity?' · Open':'');if(item.id===identity){b.classList.add('activeBook');b.setAttribute('aria-current','true')}b.onclick=()=>openLibraryBook(item);let row=document.createElement('div');row.className='libraryRow';b.classList.add('bookChoice');let del=document.createElement('button');del.className='deleteBook';del.textContent='Remove';del.setAttribute('aria-label','Remove from library: '+item.title);del.onclick=()=>deleteBook(item);row.append(b,del);list.append(row)}}$('library').onclick=()=>{drawLibrary();$('libraryDialog').showModal();$('libraryHeading').focus({preventScroll:true})};$('libraryClose').onclick=()=>$('libraryDialog').close();$('libraryImport').onclick=()=>{$('libraryDialog').close();$('file').click()};addEventListener('pagehide',save);document.addEventListener('visibilitychange',()=>{if(document.hidden)save()});


async function openLibraryBook(item){
 if(busy)return;
 if($('libraryDialog').open)$('libraryDialog').close();
 closeBookshelf();
 if(item.id===identity)return;
 try{const f=await get('book:'+item.id);if(!f)throw Error('Book missing');await load(f,false)}catch(e){alert(e.message)}
}
// v0.4.92.21: book actions are shared by touch long-press, right-click, and an accessible menu button.
let shelfActionBook=null;
function closeShelfActions(){
 const d=$('shelfActions');if(d.open)d.close();shelfActionBook=null;
}
function openShelfActions(item){
 if(busy)return;
 shelfActionBook=item;
 $('shelfActionTitle').textContent=item.title;
 $('shelfActions').showModal();
 $('shelfActionsHeading').focus({preventScroll:true});
}
$('shelfActionClose').onclick=closeShelfActions;
$('shelfActionOpen').onclick=()=>{const item=shelfActionBook;closeShelfActions();if(item)openLibraryBook(item)};
$('shelfActionRemove').onclick=()=>{const item=shelfActionBook;closeShelfActions();if(item)deleteBook(item)};
$('shelfActions').addEventListener('close',()=>shelfActionBook=null);
$('shelfActions').addEventListener('click',e=>{if(e.target===$('shelfActions'))closeShelfActions()});
function drawBookshelf(){
 const grid=$('shelfGrid');grid.replaceChildren();
 const sorted=[...library].sort((a,b)=>a.title.localeCompare(b.title,undefined,{sensitivity:'base'}));
 if(!sorted.length){const msg=document.createElement('p');msg.className='shelfEmpty';msg.textContent='Your library is empty. Import an EPUB or soundtrack package to begin.';grid.append(msg)}
 const colors=['#594153','#42536c','#5d624e','#654c43','#3e6160','#655c78','#695342','#45536a'];
 for(const item of sorted){
   const card=document.createElement('article');card.className='shelfItem';
   const button=document.createElement('button');button.type='button';button.className='shelfSelect';button.setAttribute('aria-label','Open '+item.title);
   const cover=document.createElement('div');cover.className='shelfCover';
   let hash=0;for(const ch of item.id)hash=(hash*31+ch.charCodeAt(0))|0;
   cover.style.setProperty('--cover',colors[Math.abs(hash%colors.length)]);
   const name=document.createElement('span');name.className='shelfCoverTitle';name.textContent=item.title;
   const author=document.createElement('span');author.className='shelfCoverAuthor';author.textContent=item.author||'Soundtrack Reader';
   cover.append(name,author);button.append(cover);
   let holdTimer=null,origin=null,suppressUntil=0;
   const clearHold=()=>{if(holdTimer!==null){clearTimeout(holdTimer);holdTimer=null}};
   button.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    clearHold();origin={x:e.clientX,y:e.clientY};
    holdTimer=setTimeout(()=>{
      holdTimer=null;suppressUntil=Date.now()+900;origin=null;
      if(navigator.vibrate)navigator.vibrate(12);
      openShelfActions(item);
    },550);
   });
   button.addEventListener('pointermove',e=>{if(origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>12){clearHold();origin=null}});
   for(const type of ['pointerup','pointercancel','pointerleave'])button.addEventListener(type,()=>{clearHold();origin=null});
   button.addEventListener('contextmenu',e=>{e.preventDefault();clearHold();suppressUntil=Date.now()+900;if(!$('shelfActions').open)openShelfActions(item)});
   button.onclick=e=>{if(Date.now()<suppressUntil){e.preventDefault();return}openLibraryBook(item)};
   const label=document.createElement('div');label.className='shelfLabel';label.textContent=item.title;
   const detail=document.createElement('div');detail.className='shelfDetail';detail.textContent=item.author||'Unknown author';
   const actions=document.createElement('button');actions.type='button';actions.className='shelfMore';actions.textContent='⋯';actions.title='Book actions';actions.setAttribute('aria-label','Actions for '+item.title);actions.onclick=()=>openShelfActions(item);
   const caption=document.createElement('div');caption.className='shelfCaption';caption.append(label,actions);
   card.append(button,caption,detail);
   if(item.id===identity){const now=document.createElement('span');now.className='shelfCurrent';now.textContent='✓ Currently reading';card.append(now)}
   grid.append(card);
 }
}
function openBookshelf(){if(busy)return;drawBookshelf();if($('libraryDialog').open)$('libraryDialog').close();$('bookshelf').hidden=false;document.body.classList.add('shelf-open');$('bookshelf').scrollTop=0;$('shelfHeading').focus({preventScroll:true})}
function closeBookshelf(){if($('bookshelf').hidden)return;$('bookshelf').hidden=true;document.body.classList.remove('shelf-open')}
$('libraryShelfOpen').onclick=openBookshelf;
$('shelfBack').onclick=closeBookshelf;
$('shelfImport').onclick=()=>{closeBookshelf();$('file').click()};
$('shelfLibrary').onclick=()=>{closeBookshelf();drawLibrary();$('libraryDialog').showModal();$('libraryHeading').focus({preventScroll:true})};
async function deleteBook(item){if(busy||!db)return;if(!confirm('Remove “'+item.title+'” from the library? Its imported copy, bookmarks and reading position will be removed. Your original file in Files will remain unchanged.'))return;busy=true;const active=item.id===identity;try{const next=library.filter(x=>x.id!==item.id);await new Promise((ok,no)=>{const t=db.transaction('files','readwrite'),os=t.objectStore('files');os.delete('book:'+item.id);os.delete('current');os.put(next,'library');if(active)os.delete('active');t.oncomplete=ok;t.onerror=()=>no(t.error);t.onabort=()=>no(t.error)});library=next;localStorage.removeItem('sr02:'+item.id);if(active){stop();clearTimeout(timer);layoutToken++;restoring=false;for(const u of urls)URL.revokeObjectURL(u);urls=[];assets.clear();chapters=[];virtualHeights=[];virtualGeometry="";invalidateSearch();cues=[];marks=[];identity='';title='';chapter=anchor=offset=page=soundChapter=soundAnchor=0;pages=1;windowStart=windowEnd=-1;document.body.classList.remove('paged');holder.id='holder';book.style.transform='';book.style.columnWidth='';book.innerHTML='<h1>Your Library</h1><p>Open Library to select or import a book.</p>'; $('title').textContent='SOUNDTRACK READER · 0.4.92.2';$('status').textContent='No book loaded';temporaryChapterPositions.clear();$('chapterChoice').disabled=true;$('chapterChoice').textContent='Chapter —';$('play').textContent='▶ Play';$('progress').value=0;$('percent').textContent='0.0%';$('links').replaceChildren();$('marks').replaceChildren();scrollTo(0,0)}drawLibrary();if(!$('bookshelf').hidden)drawBookshelf()}catch(e){alert('Could not delete book: '+e.message)}finally{busy=false}}

// Weight chapters by readable text, not chapter count. Interpolate within the current block.
function buildProgressIndex(){progressTotal=0;progressIndex=chapters.map(c=>{let d=new DOMParser().parseFromString(c.html,'text/html'),bs=[...d.querySelectorAll('p,h1,h2,h3,h4,blockquote,li,pre')],prefix=[0];for(let b of bs){let n=b.textContent.trim().length;prefix.push(prefix.at(-1)+Math.max(1,n))}let length=Math.max(1,prefix.at(-1)),start=progressTotal;progressTotal+=length;return {start,length,prefix}})}
function paintProgress(){if(!chapters.length||!progressTotal)return;let i=chapter,f=0;if($('paged').checked){f=page/Math.max(1,pages);if(page===pages-1&&i===chapters.length-1)f=1}else{let p=atLine(readingLine());if(!p)return;i=p.chapter;let m=progressIndex[i],b=p.current.querySelectorAll('p,h1,h2,h3,h4,blockquote,li,pre')[p.anchor];let a=Math.min(p.anchor,m.prefix.length-1),fraction=b?Math.min(1,Math.max(0,p.offset/Math.max(1,b.getBoundingClientRect().height))):0;f=p.virtual?Math.min(1,Math.max(0,(readingLine()-p.current.getBoundingClientRect().top)/Math.max(1,p.current.getBoundingClientRect().height))):(m.prefix[a]+fraction*((m.prefix[a+1]??m.length)-m.prefix[a]))/m.length;if(i===chapters.length-1&&scrollY+innerHeight>=document.documentElement.scrollHeight-3)f=1}let m=progressIndex[i];if(!m)return;let percent=Math.max(0,Math.min(100,100*(m.start+m.length*f)/progressTotal));$('progress').value=percent;$('percent').textContent=percent.toFixed(1)+'%';$('progress').setAttribute('aria-valuetext',percent.toFixed(1)+'% of book');}

// Update software only; never clear IndexedDB or localStorage.
$('checkUpdate').onclick=async()=>{const b=$('checkUpdate'),out=$('updateStatus');if(busy){out.textContent='Wait until import finishes.';return}if(!navigator.onLine){out.textContent='Connect to the internet to check.';return}b.disabled=true;out.textContent='Checking…';try{if(!('serviceWorker'in navigator))throw Error('Updates require the hosted reader.');const r=await navigator.serviceWorker.getRegistration();if(!r)throw Error('Offline worker not registered yet. Try again shortly.');const before=r.active;await r.update();let w=r.installing||r.waiting||(r.active!==before?r.active:null);if(!w){out.textContent='No newer software found. Reloading…';}else{out.textContent='Installing update…';await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error('Update timed out; try again.')),30000);const check=()=>{if(w.state==='activated'){clearTimeout(t);ok()}else if(w.state==='redundant'){clearTimeout(t);no(Error('Update installation failed.'))}};w.addEventListener('statechange',check);check();});}if(!restoring&&chapters.length&&!$('paged').checked)position();save();stop();location.replace(new URL('./?refresh='+Date.now(),location.href).href);}catch(e){out.textContent=e.message;b.disabled=false}};

// Dismiss only genuine backdrop taps, not taps inside or drags from the dialog.
for(const id of ['libraryDialog','contents','prefs','searchDialog','chapterDialog']){const d=$(id);let outside=false;const isOutside=e=>{const r=d.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom};d.addEventListener('pointerdown',e=>{outside=e.target===d&&isOutside(e)});d.addEventListener('pointercancel',()=>outside=false);d.addEventListener('click',e=>{if(outside&&e.target===d&&isOutside(e)){d.close();if(id==='prefs')sync()}outside=false});}

$('title').setAttribute('role','button');$('title').tabIndex=0;$('title').title='Go to start of current chapter';function chapterStart(){if(!chapters.length||busy)return;if(!restoring)position();render(0);sync()}$('title').addEventListener('click',chapterStart);$('title').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chapterStart()}});


// v0.4.92.2: Case-insensitive full-book word/phrase search. Index only text, never audio.
// Build on first use, in animation-frame slices to keep the iPhone responsive.
let searchCorpus=null,searchCorpusBook='',searchRun=0,searchOrigin=null,highlightTimer=0,highlightCleanup=0;
function clearSearchHighlight(){clearTimeout(highlightTimer);clearTimeout(highlightCleanup);for(const m of book.querySelectorAll('mark.search-hit')){const p=m.parentNode;m.replaceWith(...m.childNodes);p.normalize()}}
function expireSearchHighlight(){highlightTimer=setTimeout(()=>{for(const m of book.querySelectorAll('mark.search-hit'))m.classList.add('fading');highlightCleanup=setTimeout(clearSearchHighlight,550)},5000)}
function refreshSearchReturn(){$('searchReturn').hidden=!(searchOrigin&&searchOrigin.id===identity&&searchOrigin.visited)}
const SEARCH_MAX=200,SEARCH_BLOCKS='p,h1,h2,h3,h4,blockquote,li,pre';
function invalidateSearch(){searchOrigin=null;clearSearchHighlight();refreshSearchReturn();searchCorpus=null;searchCorpusBook='';searchRun++;$('searchResults').replaceChildren();$('searchStatus').textContent='Enter a word or phrase to find passages.'}
function nextFrame(){return new Promise(resolve=>requestAnimationFrame(resolve))}
async function searchData(token){
  if(searchCorpus&&searchCorpusBook===identity)return searchCorpus;
  const source=[];
  for(let i=0;i<chapters.length;i++){
    if(token!==searchRun)return null;
    const doc=new DOMParser().parseFromString(chapters[i].html,'text/html');
    source.push([...doc.querySelectorAll(SEARCH_BLOCKS)].map(b=>b.textContent||''));
    if(i%5===4)await nextFrame();
  }
  if(token!==searchRun)return null;
  searchCorpus=source;searchCorpusBook=identity;
  return source;
}
function makeExcerpt(text,start,size){
  const from=Math.max(0,start-62),to=Math.min(text.length,start+size+95);
  return {before:(from?'…':'')+text.slice(from,start),match:text.slice(start,start+size),after:text.slice(start+size,to)+(to<text.length?'…':'')};
}
async function findInBook(event){
  if(event)event.preventDefault();
  const query=$('searchText').value.trim(),run=++searchRun,results=$('searchResults'),status=$('searchStatus');
  results.replaceChildren();
  if(!chapters.length){status.textContent='Import a book before searching.';return}
  if(!query){status.textContent='Enter a word or phrase to find passages.';return}
  $('searchSubmit').disabled=true;status.textContent='Searching all chapters…';
  try{
    const corpus=await searchData(run);if(!corpus||run!==searchRun)return;
    const needle=query.toLocaleLowerCase(),hits=[];
    let count=0;
    for(let i=0;i<corpus.length;i++){
      if(run!==searchRun)return;
      for(let j=0;j<corpus[i].length;j++){
        const text=corpus[i][j],lower=text.toLocaleLowerCase();
        for(let at=lower.indexOf(needle);at!==-1;at=lower.indexOf(needle,at+Math.max(1,needle.length))){
          count++;
          if(hits.length<SEARCH_MAX)hits.push({chapter:i,anchor:j,start:at,length:needle.length,excerpt:makeExcerpt(text,at,needle.length)});
        }
      }
      if(i%5===4){status.textContent='Searching… '+(i+1)+'/'+corpus.length+' chapters';await nextFrame()}
    }
    if(run!==searchRun)return;
    // Replace the count-only message with an explicit cap if required.
    status.textContent=count===0?'No matches found.':count+' match'+(count===1?'':'es')+' found'+(count>SEARCH_MAX?'; showing first '+SEARCH_MAX+'.':'.');
    const frag=document.createDocumentFragment();
    for(let n=0;n<hits.length;n++){
      const hit=hits[n],button=document.createElement('button');button.type='button';
      const head=document.createElement('strong');head.textContent=chapters[hit.chapter].title+' · '+(hit.chapter+1)+'/'+chapters.length;
      const preview=document.createElement('span');preview.className='excerpt';
      preview.append(document.createTextNode(hit.excerpt.before.replace(/\s+/g,' ')));
      const mark=document.createElement('mark');mark.textContent=hit.excerpt.match;preview.append(mark);
      preview.append(document.createTextNode(hit.excerpt.after.replace(/\s+/g,' ')));
      button.append(head,preview);button.addEventListener('click',()=>jumpToMatch(hit));frag.append(button);
    }
    results.append(frag);results.scrollTop=0;
  }catch(err){if(run===searchRun)status.textContent='Search error: '+err.message}
  finally{if(run===searchRun)$('searchSubmit').disabled=false}
}
// Resolve the exact character match through mixed inline formatting (<em>, <b>, etc.).
// Use DOM nodes rather than innerHTML so the query cannot inject markup.
function markInBlock(block,start,length){
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
  let node,index=0,parts=[];
  while((node=walker.nextNode())){
    const finish=index+node.nodeValue.length;
    if(finish>start&&index<start+length){
      parts.push({node,from:Math.max(0,start-index),to:Math.min(node.nodeValue.length,start+length-index)});
    }
    index=finish;
    if(index>=start+length)break;
  }
  if(!parts.length)return null;
  const made=[];
  for(let k=parts.length-1;k>=0;k--){
    const {node,from,to}=parts[k];let selected=node;
    if(from)selected=node.splitText(from);
    if(to-from<selected.nodeValue.length)selected.splitText(to-from);
    const mark=document.createElement('mark');mark.className='search-hit';
    selected.parentNode.replaceChild(mark,selected);mark.appendChild(selected);made.unshift(mark);
  }
  return made[0];
}
function jumpToMatch(hit){
  if(busy||!chapters[hit.chapter])return;
  if(searchOrigin)searchOrigin.visited=true;refreshSearchReturn();clearSearchHighlight();
  $('searchDialog').close();searchRun++;
  lastGesture=Date.now();chapter=hit.chapter;
  render(hit.anchor);sync();
  const currentLayout=layoutToken,currentBook=identity;
  // Continuous layout restores scrolling over two animation frames.
  requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(currentLayout!==layoutToken||currentBook!==identity||busy)return;
    const sectionRoot=$('paged').checked?book:book.querySelector('section[data-chapter="'+hit.chapter+'"]');
    const target=sectionRoot?.querySelector('[data-anchor="'+hit.anchor+'"]');
    if(!target)return;
    const mark=markInBlock(target,hit.start,hit.length);
    if(!mark)return;
    expireSearchHighlight();
    if($('paged').checked){
      const rect=mark.getClientRects()[0];
      if(rect){let x=rect.left-book.getBoundingClientRect().left;page=Math.max(0,Math.min(pages-1,Math.floor((x+1)/Math.max(1,holder.clientWidth))));book.style.transform='translateX('+-page*holder.clientWidth+'px)'}
      position();
    }else{
      const rect=mark.getClientRects()[0];
      if(rect)scrollTo(0,Math.max(0,scrollY+rect.top-readingLine()-7));
      lastGesture=Date.now();requestAnimationFrame(()=>position());
    }
    update();save();
  })));
}
$('search').onclick=()=>{
  if(!chapters.length){$('status').textContent='Import a book before searching.';return}
  if(!searchOrigin||searchOrigin.id!==identity||!searchOrigin.visited){if(!restoring&&!busy)position();searchOrigin={id:identity,chapter,anchor,offset,visited:false,page:$('paged').checked?page:null,pageWidth:holder.clientWidth,pageHeight:holder.clientHeight,typography:[$('size').value,$('leading').value,$('measure').value].join('|')}}
  refreshSearchReturn();
  $('searchDialog').showModal();
  // Give the dialog a neutral initial state; the search field remains tappable.
  $('searchHeading').focus({preventScroll:true});
};
$('searchForm').addEventListener('submit',findInBook);
$('searchClose').onclick=()=>$('searchDialog').close();
$('searchDialog').addEventListener('close',()=>{searchRun++;$('searchSubmit').disabled=false});

$('searchReturn').onclick=()=>{const origin=searchOrigin;if(!origin||origin.id!==identity||busy)return;searchOrigin=null;refreshSearchReturn();clearSearchHighlight();$('searchDialog').close();lastGesture=Date.now();chapter=origin.chapter;savedPage=$('paged').checked&&Number.isInteger(origin.page)?origin:null;render(origin.anchor,origin.offset);sync()};
