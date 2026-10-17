
(()=>{'use strict';
const ATTACK_GIF='assets/final_attack.gif?v=2_3a';
const FINAL_ATTACK_DURATION_MS=6380;
const ENDING_GIF='assets/happy_ending.gif';
const ROOM=(new URLSearchParams(location.search).get('room')||'AACC').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,32)||'AACC';
const KEY='bingoc_demo_room_'+ROOM;
const LIVE=!!(window.BINGOC_CONFIG?.firebase?.apiKey && !window.BINGOC_CONFIG.firebase.apiKey.startsWith('PASTE_'));
let dbRef=null,auth=null,fb=null,authenticated=false,hostValidated=false,serverStateReady=false;
// Keep the locally-created TV event separate from Firebase's incoming state.
let pendingEvent=null;
let tvVisualEvent=null; // TV-only feedback inferred from the actual newly stored match
let previousRemote=null;
const HOST_FIELDS=['phase','target','boost','startAt','pausedAt','pausedMs','finished','awardIndex','awardView','awarded','awardRevealed','awardWinners','finalAttack','finalAttackAt','tvOverride','summaryPage','summaryKey','version'];
const USER_KEY='bingoc_demo_current_'+ROOM;
const categories=['最不喜歡的家居雜務','喜歡的聖經書卷','最想旅行的國家','小時候夢想職業','最喜歡的飲品','最喜歡的休閒活動','最想學習的技能','最欣賞的聖經人物','最想親眼見證的聖經事件'];
const short=['家居雜務','聖經書卷','旅行國家','夢想職業','喜歡的飲品','休閒活動','學習技能','聖經人物','聖經事件'];
const LINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const defaults=()=>({players:[],entries:{},phase:'lobby',target:0,boost:0,startAt:null,pausedAt:null,pausedMs:0,finished:null,awardIndex:0,awardView:'ranking',awarded:[],awardRevealed:0,awardWinners:{},finalAttack:false,finalAttackAt:null,tvOverride:'auto',summaryPage:0,summaryKey:'all',event:null,version:4});
let state;try{state={...defaults(),...JSON.parse(localStorage.getItem(KEY))}}catch{state=defaults()}
let view=document.body.dataset.view||'phone',currentId=localStorage.getItem(USER_KEY),edit=-1,search='',inputName='',warning='',sound=false,ctx=null;
const root=document.getElementById('root');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const display=id=>(state.players.find(p=>p.id===id)||{}).name||'—';
const playerByName=name=>state.players.find(p=>p.name.toLocaleLowerCase()===String(name).trim().toLocaleLowerCase());
const activeEntries=id=>state.entries[id]||Array.from({length:9},()=>[]);
const personMetrics=id=>{const cells=activeEntries(id),counts=cells.map(a=>a.length),normal=LINES.filter(l=>l.every(i=>counts[i]>=1)).length,double=LINES.filter(l=>l.every(i=>counts[i]>=2)).length,records=counts.reduce((a,b)=>a+b,0);return {cells,counts,normal,double,records,score:records*10+normal*30+double*40+(counts.every(n=>n>=1)?30:0)};};
const globalMetrics=()=>{const m=state.players.map(p=>({id:p.id,...personMetrics(p.id)}));const entries=m.reduce((a,x)=>a+x.records,0),first=m.filter(x=>x.normal>0).length;return {records:entries,bingoPeople:first,playerPower:entries+first*3,totalPower:entries+first*3+state.boost,target:state.target||Math.max(1,state.players.length*5)};};
async function SAVE(){
 // A Realtime Database listener can run during any await below and replace state.
 // Capture the outgoing event first; never re-send a remote/stale state.event.
 const eventToPublish=pendingEvent;
 pendingEvent=null;
 if(!LIVE){localStorage.setItem(KEY,JSON.stringify(state));render();return}
 try{
  const updates={};
  if(view==='host'){
   if(!hostValidated)throw new Error('請先登入主持帳戶');
   for(const k of HOST_FIELDS)updates['host/'+k]=state[k]??null;
  }else if(view==='phone'){
   if(!authenticated||currentId!==auth.currentUser?.uid)throw new Error('玩家登入資料未準備好');
   updates['entries/'+currentId]=state.entries[currentId]||Array.from({length:9},()=>[]);
  }
  if(eventToPublish){
   updates.event={
    text:String(eventToPublish.text||'').slice(0,100),
    type:eventToPublish.type,
    at:firebase.database.ServerValue.TIMESTAMP,
    actor:auth.currentUser.uid
   };
  }
  // Make matching updates and TV events ONE atomic Firebase operation.
  // TV will see both at the same time, rather than lose the event to a listener callback.
  if(Object.keys(updates).length)await dbRef.update(updates);
  if(view==='phone'){
   const p=state.players.find(x=>x.id===currentId);
   if(p?.firstBingoAt){
    await dbRef.child('players').child(currentId).child('firstBingoAt')
      .transaction(x=>x||firebase.database.ServerValue.TIMESTAMP);
   }
  }
 }catch(e){
  if(eventToPublish&&!pendingEvent)pendingEvent=eventToPublish;
  warning='同步失敗：'+e.message;
  console.error(e);
 }
 render();
}

function normaliseRemote(d){
 const host=d.host||{};
 const players=Object.entries(d.players||{}).map(([id,v])=>({id,...v}));
 const entries={};for(const [id,v] of Object.entries(d.entries||{})){
  entries[id]=Array.from({length:9},(_,i)=>Array.isArray(v)?(v[i]||[]):(v[i]||[]));
 }
 return {...defaults(),...host,players,entries,event:d.event||null};
}
async function setup(){
 document.querySelector('.version').textContent=LIVE?'Firebase Multiplayer v2.3A':'本地示範模式（未填 Firebase 設定）';
 if(!LIVE){serverStateReady=true;render();return;}
 try{
  fb=firebase.initializeApp(window.BINGOC_CONFIG.firebase,'bingoc-'+view);
  auth=fb.auth();dbRef=fb.database().ref('bingocRooms/'+ROOM);
  if(view==='host'){
   auth.onAuthStateChanged(async u=>{
    authenticated=!!u;hostValidated=!!u&&u.uid===window.BINGOC_CONFIG.hostUid;
    if(hostValidated){
     const snap=await dbRef.child('host').once('value');
     if(!snap.exists())await dbRef.child('host').set(Object.fromEntries(HOST_FIELDS.map(k=>[k,defaults()[k]??null])));
     subscribeRemote();
    }else{serverStateReady=false;render()}
   });
  }else{
   await auth.signInAnonymously();authenticated=true;
   if(view==='phone')currentId=auth.currentUser.uid;
   subscribeRemote();
  }
 }catch(e){warning='Firebase 連線失敗：'+e.message;console.error(e);render()}
}
let subscribed=false;
function subscribeRemote(){
 if(subscribed)return;subscribed=true;
 dbRef.on('value',snap=>{
  const next=normaliseRemote(snap.val()||{});
  if(view==='tv' && previousRemote && next.phase==='playing'){
   // Use the ACTUAL entries difference as a fallback source for TV effects.
   // That prevents a stale JOIN event (WELCOME SOPHIE) from masking a new match.
   const added=[];
   for(const p of next.players){
    const before=previousRemote.entries[p.id]||Array.from({length:9},()=>[]);
    const after=next.entries[p.id]||Array.from({length:9},()=>[]);
    for(let i=0;i<9;i++){
     const oldSet=new Set(before[i]||[]);
     for(const friendId of (after[i]||[])){
      if(!oldSet.has(friendId))added.push({id:p.id,name:p.name});
     }
    }
   }
   if(added.length){
    const p=added[added.length-1];
    const kind=next.event?.type==='bingo'?'bingo':'match';
    tvVisualEvent={text:`${p.name.toUpperCase()} +1 COMMON POWER`,type:kind,actor:p.id,at:Date.now()};
   }
  }
  previousRemote=next;
  state=next;serverStateReady=true;
  if(view==='phone'&&authenticated)currentId=auth.currentUser.uid;
  render();
 },e=>{warning='Firebase 讀取失敗：'+e.message;render()});
}
const nowEvent=(text,type='normal')=>{pendingEvent={text,type,at:Date.now()};state.event=pendingEvent;};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
async function join(name){
 name=name.trim();warning='';
 if(!name||name.length>35){warning='請輸入1–35字的名字';return render()}
 if(state.phase!=='lobby'){warning='遊戲已開始，請主持處理遲到玩家';return render()}
 if(playerByName(name)){warning='此名字已經登記，請使用其他顯示名稱';return render()}
 const id=LIVE?auth?.currentUser?.uid:uid();
 if(!id){warning='連線準備中，請稍候再試';return render()}
 const p={id,name,joinedAt:Date.now(),firstBingoAt:null};
 if(LIVE){
  // Reserve unique names atomically to avoid duplicate entries from simultaneous joins.
  const slug=encodeURIComponent(name.toLocaleLowerCase()).replace(/[.#$\[\]\/]/g,'_');
  try{
   const result=await dbRef.child('nameIndex').child(slug).transaction(x=>x===null||x===id?id:undefined);
   if(!result.committed){warning='已有同名玩家，請使用另一個名字';return render()}
   await dbRef.child('players').child(id).set({name,joinedAt:firebase.database.ServerValue.TIMESTAMP,firstBingoAt:null});
   await dbRef.child('entries').child(id).set(Array.from({length:9},()=>[]));
   await dbRef.child('event').set({text:`WELCOME, ${name.toUpperCase()}!`,type:'join',at:firebase.database.ServerValue.TIMESTAMP,actor:id});
   currentId=id;inputName='';warning='';return render();
  }catch(e){warning='加入失敗：'+e.message;return render()}
 }
 state.players.push(p);state.entries[p.id]=Array.from({length:9},()=>[]);
 currentId=p.id;localStorage.setItem(USER_KEY,currentId);inputName='';warning='';
 nowEvent(`WELCOME, ${name.toUpperCase()}!`,'join');SAVE()
}
function addMatch(id,index,otherId){warning='';if(state.phase!=='playing'){warning='遊戲尚未開始，或結果已凍結';return render()}if(id===otherId){warning='不能選擇自己';return render()}if(!state.players.some(p=>p.id===otherId)){warning='找不到該玩家';return render()}const cards=activeEntries(id),cell=cards[index];if(cell.includes(otherId)){warning='同一格不可重複名字';return render()}if(cell.length>=2){warning='每格最多記錄兩位朋友';return render()}if(cards.filter((c,i)=>i!==index&&c.includes(otherId)).length>=2){warning='同一位朋友最多出現於兩個類別';return render()}const before=personMetrics(id).normal;const newCards=cards.map(c=>[...c]);newCards[index].push(otherId);state.entries[id]=newCards;const after=personMetrics(id).normal;const p=state.players.find(x=>x.id===id);if(before===0&&after>0)p.firstBingoAt=Date.now();nowEvent(`${p.name.toUpperCase()} +1 COMMON POWER`,after>before?'bingo':'match');search='';SAVE()}
function removeMatch(id,index,otherId){if(state.phase!=='playing'){warning='遊戲已凍結，不能修改';return render()}const cards=activeEntries(id).map(c=>[...c]);cards[index]=cards[index].filter(x=>x!==otherId);state.entries[id]=cards;if(personMetrics(id).normal===0)state.players.find(p=>p.id===id).firstBingoAt=null;nowEvent('配對紀錄已更新','edit');SAVE()}
function incoming(){const o={};for(const p of state.players)o[p.id]={senders:new Set(),cats:new Set(),records:0};for(const a of state.players){activeEntries(a.id).forEach((arr,i)=>{for(const b of arr){if(o[b]){o[b].senders.add(a.id);o[b].cats.add(i);o[b].records++}}})}return o}
const awardDefs=[{key:'king',name:'🏆 Bingo 王者',title:'BINGO CHAMPION',desc:'總分最高'},{key:'pioneer',name:'⚡ Bingo 先鋒',title:'BINGO PIONEER',desc:'最早完成第一條 Bingo'},{key:'magnet',name:'💛 人氣磁石',title:'PEOPLE MAGNET',desc:'被最多不同人記錄'},{key:'diverse',name:'🌈 多元興趣達人',title:'COMMON IN MANY WAYS',desc:'被記錄的不同類別最多'},{key:'unique',name:'✨ 最獨特靈魂',title:'UNIQUE SOUL',desc:'被記錄的類別最少（趣味統計）'}];
function awardTables(){
 const ins=incoming(),old=state.finished?.tieOrder||{},pm=Object.fromEntries(state.players.map(p=>[p.id,personMetrics(p.id)]));
 const people=state.players.map(p=>({...p,sc:pm[p.id].score,normal:pm[p.id].normal,double:pm[p.id].double,lines:pm[p.id].normal+pm[p.id].double,n:pm[p.id].records,rec:ins[p.id]?.records||0,inCats:ins[p.id]?.cats.size||0,inPeople:ins[p.id]?.senders.size||0}));
 const ti=(a,b)=>(old[a.id]??state.players.indexOf(a))-(old[b.id]??state.players.indexOf(b));
 const specs={
 king:{value:p=>p.sc,sort:(a,b)=>b.sc-a.sc||b.lines-a.lines||b.n-a.n||ti(a,b)},
 pioneer:{value:p=>p.firstBingoAt,sort:(a,b)=>(a.firstBingoAt??Infinity)-(b.firstBingoAt??Infinity)||ti(a,b)},
 magnet:{value:p=>p.inPeople,sort:(a,b)=>b.inPeople-a.inPeople||b.rec-a.rec||ti(a,b)},
 diverse:{value:p=>p.inCats,sort:(a,b)=>b.inCats-a.inCats||b.inPeople-a.inPeople||ti(a,b)},
 unique:{value:p=>p.inCats,sort:(a,b)=>a.inCats-b.inCats||a.rec-b.rec||ti(a,b)}
 };
 const by={};
 for(const [key,s] of Object.entries(specs)){
   const arr=(key==='pioneer'?people.filter(p=>p.firstBingoAt!=null):people).map(p=>({...p})).sort(s.sort);
   // Ranking number is based on PRIMARY metric alone: ties remain #1, #1, #3.
   // Secondary metrics only order shared-rank rows / determine who is highlighted.
   arr.forEach((p,i)=>{p.rank=(i&&s.value(p)===s.value(arr[i-1]))?arr[i-1].rank:i+1});
   by[key]=arr;
 }
 const val=(key,p)=>({king:`${p.sc} 分`,pioneer:p.firstBingoAt==null?'未達成':new Date(p.firstBingoAt).toLocaleTimeString('zh-HK',{hour12:false}),magnet:`${p.inPeople} 人`,diverse:`${p.inCats} 類`,unique:`${p.inCats} 類`})[key];
 return {by,val};
}
function candidate(awardIndex){const a=awardDefs[awardIndex],table=awardTables().by[a.key]||[];const already=state.awardWinners?.[a.key];if(already)return table.find(p=>p.id===already)||null;return table.find(p=>!state.awarded.includes(p.id))||null}
function freeze(){
 if(!['playing','paused'].includes(state.phase))return;
 const ids=state.players.map(p=>p.id);
 for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]]}
 const tieOrder=Object.fromEntries(ids.map((id,i)=>[id,i]));
 state.finished={at:Date.now(),tieOrder};
 state.phase='awards';
 state.awardIndex=0;state.awardView='ranking';state.awarded=[];state.awardWinners={};state.awardRevealed=0;
 state.finalAttack=true;state.finalAttackAt=Date.now();state.tvOverride='attack';
 nowEvent('FI & MAG — FINAL ATTACK!','win');
 SAVE();
}
const b=(label,action,cl='soft',disabled=false)=>`<button class="btn ${cl}" data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;
const intro=`<div class="hint">規則：每格最多2位朋友；同一個名字在整張卡最多出現2個類別。每次有效配對 +10分；每條普通 Bingo +30；雙人 Bingo 再 +40；九格都有名字 +30。</div>`;
function bingoLines(m){const result=[];const geometry=[[16.67,16.67,83.33,16.67],[16.67,50,83.33,50],[16.67,83.33,83.33,83.33],[16.67,16.67,16.67,83.33],[50,16.67,50,83.33],[83.33,16.67,83.33,83.33],[16.67,16.67,83.33,83.33],[83.33,16.67,16.67,83.33]];for(let i=0;i<LINES.length;i++){let l=LINES[i],base=l.every(idx=>m.counts[idx]>=1),dbl=l.every(idx=>m.counts[idx]>=2);if(base){const [x1,y1,x2,y2]=geometry[i];result.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${dbl?'#853BE3':'#1979F2'}" stroke-width="${dbl?3.0:2.2}" opacity=".87"/>`)}}return `<svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none">${result.join('')}</svg>`}
function phone(){if(!currentId||!state.players.some(x=>x.id===currentId)){const joined=state.players.length;return `<div class="panel"><h2>WELCOME TO BingoC</h2><p class="sub">先輸入姓名，加入 Super AACC Sis. 的冒險</p><p><b>${joined}</b> players joined</p><label class="label">你的名字</label><input id="joinName" class="input" placeholder="例如 Sophie" value="${esc(inputName)}" autocomplete="off"/><p>${b('JOIN GAME!','join','orange',state.phase!=='lobby')}</p>${warning?`<p class="error">${esc(warning)}</p>`:''}${!LIVE&&state.players.length?`<div class="divider"></div><label class="label">單機測試：切換已加入玩家</label><select class="input" id="switchPlayer"><option value="">選擇玩家</option>${state.players.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>`:''}</div>`}
const p=state.players.find(x=>x.id===currentId),m=personMetrics(currentId),gm=globalMetrics();let top=`<div class="panel"><div class="row space"><div><h2>⭐ BingoC</h2><div class="sub">PLAYER: <b>${esc(p.name)}</b></div></div>${!LIVE?b('切換玩家','leave','outline'):''}</div>`;
if(state.phase==='lobby')return top+`<div class="meta" style="margin-top:15px"><h3>WAITING FOR HOST...</h3><p>已加入 ${state.players.length} 位玩家。等主持 Start Game。</p></div></div>`;
if(state.phase==='paused')top+=`<div class="hint">遊戲已暫停，請等主持恢復。</div>`;
const cards=categories.map((cat,i)=>{const n=m.cells[i].length;return `<button class="cell ${n===1?'l1':n===2?'l2':''}" data-cell="${i}" ${state.phase!=='playing'?'disabled':''}><span class="cellTitle">${esc(short[i])}</span><span class="cellNames">${n?m.cells[i].map(display).map(esc).join('<br>'):'＋'}</span></button>`}).join('');
top+=`<div class="stats" style="margin:15px 0"><div><div class="metric">${m.score}</div><small>POINTS</small></div><div><div class="metric">${m.normal}</div><small>BINGO</small></div><div><div class="metric">${m.double}</div><small>DOUBLE</small></div></div><div class="gridHolder"><div class="bingo">${cards}</div>${bingoLines(m)}</div><div class="row space" style="margin-top:15px"><b>COMMON POWER</b><b>${gm.totalPower} / ${gm.target}</b></div><div class="progress" style="margin-top:8px"><div style="width:${Math.min(100,gm.totalPower/gm.target*100)}%"></div></div><p class="sub" style="margin-top:10px">點選格子 → 搜尋朋友名字 → 確認；灰色0人／黃色1人／橙色2人。</p>${warning?`<p class="error">${esc(warning)}</p>`:''}</div>`;if(edit!==-1)top+=editModal();return top}
function editModal(){const cell=activeEntries(currentId)[edit];const used=activeEntries(currentId);const opts=state.players.filter(p=>p.id!==currentId&&!cell.includes(p.id)&&used.filter((arr,i)=>i!==edit&&arr.includes(p.id)).length<2&&p.name.toLowerCase().includes(search.toLowerCase()));return `<div class="floating" id="overlay"><div class="modal"><div class="row space"><h2>${esc(categories[edit])}</h2><button data-action="close" class="btn tiny outline">✕</button></div><p class="sub">已選 ${cell.length}/2 人</p><div class="pills" style="margin:12px 0">${cell.length?cell.map(id=>`<span class="tag">${esc(display(id))}<button data-remove="${id}" title="移除此人">×</button></span>`).join(''):'<small>尚未記錄朋友</small>'}</div>${cell.length<2?`<label class="label">搜尋姓名</label><input id="nameSearch" class="input" placeholder="例如輸入 s" value="${esc(search)}" autocomplete="off"/><div class="choices">${opts.length?opts.slice(0,9).map(p=>`<button data-select="${p.id}">＋ ${esc(p.name)}</button>`).join(''):'<p class="sub" style="padding:10px">無合適的玩家</p>'}</div>`:'<div class="hint">本格已有兩位朋友，請先移除錯誤姓名才可重新選擇。</div>'}${warning?`<p class="error">${esc(warning)}</p>`:''}<p style="text-align:right;margin-top:16px">${b('完成','close','orange')}</p></div></div>`}
const questionsByAward={
 king:'今日你最意外發現哪位新朋友跟你有共同點？',
 pioneer:'你如何那麼快完成第一條 Bingo？有沒有特別驚喜？',
 magnet:'原來這麼多人跟你有共同點！哪一個最意想不到？',
 diverse:'別人在哪些不同方面和你相似？你還有甚麼冷門興趣？',
 unique:'有沒有一個特別興趣或人生經驗，平時很少機會與人分享？'
};
function incomingBreakdown(id){
 const x=Array.from({length:9},()=>({names:[],records:0}));
 for(const p of state.players){for(let i=0;i<9;i++)if(activeEntries(p.id)[i]?.includes(id)){x[i].names.push(p.name);x[i].records++}}
 return x;
}
function host(){
 if(LIVE&&!hostValidated){
   return `<div class="authPanel"><h2>🔐 BingoC HOST LOGIN</h2><p>請使用 Firebase Email/Password 主持帳戶登入。只有指定 Host UID 可以控制遊戲。</p><label>Email</label><input class="input" id="hostEmail" type="email" autocomplete="username" placeholder="Email"/><label>Password</label><input class="input" id="hostPassword" type="password" autocomplete="current-password" placeholder="Password"/><p>${b('SIGN IN','hostLogin','orange')}</p>${warning?`<p class="error">${esc(warning)}</p>`:''}</div>`;
 }
 const gm=globalMetrics(),tables=awardTables(),phaseText={lobby:'WAITING',playing:'PLAYING',paused:'PAUSED',awards:'AWARDS',summary:'FINAL RESULTS'};
 let str=`<div class="panel"><div class="row space"><h2>🎛 HOST CONTROL</h2><span class="pill">${phaseText[state.phase]||state.phase}</span></div>
 <div class="stats" style="margin:14px 0"><div><div class="metric">${state.players.length}</div><small>PLAYERS</small></div><div><div class="metric">${gm.totalPower}/${gm.target}</div><small>POWER</small></div><div><div class="metric">${gm.bingoPeople}</div><small>PLAYERS WITH BINGO</small></div></div>
 <div class="row" style="margin-bottom:10px">${b('▶ START GAME','start','green',state.phase!=='lobby'||state.players.length<2)}${b('⏸ PAUSE','pause','soft',state.phase!=='playing')}${b('⏵ RESUME','resume','soft',state.phase!=='paused')}${b('🔒 FREEZE RESULTS & FINAL ATTACK → TV','freeze','orange',!['playing','paused'].includes(state.phase))}</div>
 <div class="divider"></div><h3>⚡ Friendship Boost</h3><p class="sub">只增加合作 Common Power，並在 TV 顯示 FRIENDSHIP BOOST +10！不影響任何個人排名。</p>
 <div class="row">${[5,10,15].map(n=>b('⚡ +'+n+' POWER','boost'+n,'orange',!['playing','paused'].includes(state.phase))).join('')}</div>
 <p class="sub">玩家紀錄 ${gm.records} · 首次 Bingo 力量 ${gm.bingoPeople*3} · 主持 Boost +${state.boost}</p>
 <p class="sub">${state.finalAttack?'✅ 打敗陌生怪及拉旗後進入頒獎。五個獎項完成後可隨時切換排行榜／Happy Ending（救出王子）。':'按 Freeze Results 後，TV 播放怪物放大、爆炸、Fi & Mag 拉旗的 Final Attack（無王子），之後自動進入 Awards。'}</p>
 <div class="divider"></div><h3>Players & Scores</h3><div class="pills" style="margin:10px 0">${state.players.map(p=>`<span class="pill">${esc(p.name)} · ${personMetrics(p.id).score}分</span>`).join('')||'<small>尚未有人加入</small>'}</div>
 <div class="row">${b('載入12名示範玩家','seed','outline',LIVE||state.phase!=='lobby')}${b('全部清除（重設）','reset','red')}</div></div>`;
 str+=`<div class="panel"><h2>🏆 AWARDS — 五獎依次揭曉</h2><p class="sub">榜上是真實排名（同分會並列）；亮框只標出未得過獎的最高順位受訪者。</p>
 <div class="hostAwards" style="margin:13px 0">${awardDefs.map((a,i)=>`<button class="awardcard ${state.awardIndex===i?'selected':''}" data-award="${i}" ${state.phase!=='awards'?'disabled':''} style="text-align:left;border:0;cursor:pointer"><b>${a.name}</b><div class="sub">${a.desc}</div></button>`).join('')}</div>`;
 if(state.phase==='awards'){
  const a=awardDefs[state.awardIndex],table=tables.by[a.key],w=candidate(state.awardIndex),visible=table.slice(0,Math.max(3,table.indexOf(w)+1)),limit=Math.min(3,table.length);
  str+=`<h3>${a.name} — 預覽真實排名</h3><div class="top3" style="margin-top:10px">${visible.map((p,i)=>`<div class="ranking ${w?.id===p.id?'highlight':''} ${state.awarded.includes(p.id)?'won':''}"><div><b>#${p.rank} ${esc(p.name)}</b><div class="sub">${tables.val(a.key,p)} ${state.awarded.includes(p.id)?'· 已獲其他獎':''}</div></div>${w?.id===p.id?`<b>★ ${state.awardWinners[a.key]?'得獎者':'預定得獎者'}</b>`:''}</div>`).join('')||'<div class="hint">沒有完成 Bingo 的候選人</div>'}</div>`;
  const nextPosition=limit-state.awardRevealed;
  if(state.awardView==='interview'){
    str+=`<div class="hint" style="margin-top:12px">${state.awardWinners[a.key]==='SKIPPED'?'本獎沒有合資格玩家，已跳過。':`✅ 已確認 ${esc(display(state.awardWinners[a.key]))} 為本獎得主，TV 現在顯示他／她的 Bingo 卡及其他人如何與他／她配對。`}</div><div class="row" style="margin-top:12px">${b('◀ 返回排名','backRanking','soft')}${b(state.awardIndex===4?'🏁 FINAL OPTIONS →':'NEXT AWARD →',state.awardIndex===4?'summary':'next','green')}</div>`;
  }else{
    str+=`<div class="row" style="margin-top:12px">${b(nextPosition>0?`🎁 揭曉下一位：第 ${nextPosition} 位`:'✅ 全部名次已揭曉','reveal','orange',state.awardRevealed>=limit)}${b('★ CONFIRM & SHOW BINGO CARD','award','green',!w||state.awardRevealed<limit||!!state.awardWinners[a.key])}${!w?b('SKIP — NO QUALIFIED PLAYER','skip','outline'):''}${state.awardWinners[a.key]?b('訪問畫面 →','interview','soft'):''}</div><p class="sub">順序：第3位 → 第2位 → 第1位。若分數相同會顯示並列名次，如 #1、#1、#3。</p>`;
  }
 }
 if(state.phase==='summary'){
  str+=`<div class="hint">五個獎項已頒完，主持可以隨時交替切換兩個 TV 畫面，不會重播 Final Attack。${state.tvOverride==='ending'?'目前 TV：👑 Happy Ending（王子得救）':'目前 TV：📊 排行榜'}</div><div class="row" style="margin:12px 0">${b('📊 FULL LEADERBOARD → TV','boardAll','orange')}${b('👑 HAPPY ENDING → TV','showEnding','green',!state.finalAttack)}</div><div class="row">${awardDefs.map(a=>b(a.name,'board_'+a.key,'soft')).join('')}</div><div class="row" style="margin-top:12px">${b('◀ 上一頁','pagePrev','soft',state.summaryPage<=0||state.tvOverride==='ending')}${b('下一頁 ▶','pageNext','soft',state.tvOverride==='ending')}</div>`;
 }
 str+='</div>';return str;
}

function personGrid(id,opts={}){
 const m=personMetrics(id),incomingC=incomingBreakdown(id),recv=opts.received;
 const cells=categories.map((x,i)=>{
  const n=recv?incomingC[i].records:m.counts[i],names=recv?incomingC[i].names:m.cells[i].map(display);
  const c=n===0?'#E0E6EE':n===1?'#FFE77A':'#FFA94D';
  return `<div class="tvBingoCell" style="background:${c}"><b>${esc(short[i])}</b><span>${n?esc(names.slice(0,2).join(' · ')):'—'}</span><small>${recv?`被 ${n} 人選中`:`${n} / 2`}</small></div>`
 }).join('');
 return `<div class="tvBingoGrid">${cells}</div>${!recv?bingoLines(m).replace('class="lines"','class="lines"'):''}`;
}
function tvInterview(a,w){
 if(!w)return '<div class="tvMessage">NO PLAYER AVAILABLE</div>';
 const met=personMetrics(w.id),ins=incoming()[w.id],v=awardTables().val(a.key,w);
 return `<div class="tvInterview"><h2 class="pixel">★ ${a.name} ★</h2><div class="starWinner"><span class="big">⭐</span><span>SUPER STAR WINNER</span><span class="big">😊</span></div><div class="tvInterviewName">${esc(w.name)} <span class="tvInterviewStat">${esc(v)}</span></div><div class="tvTwinCards">
 <div class="tvBingoPanel"><h3>我的 BINGO 卡 · ${met.score} 分</h3><div class="tvGridHolder">${personGrid(w.id)}</div><p>普通線 ${met.normal} 條 · 雙人線 ${met.double} 條</p></div>
 <div class="tvBingoPanel"><h3>其他人與我配對的主題</h3><div class="tvGridHolder">${personGrid(w.id,{received:true})}</div><p>被 ${ins.senders.size} 位不同朋友記錄 · ${ins.cats.size} 個類別</p></div></div>
 <div class="tvInterviewQ">🎤 主持提問：${esc(questionsByAward[a.key])}</div></div>`;
}

function tvFullLeaderboard(){
 const tables=awardTables(),list=tables.by.king,pageSize=8,pg=Math.max(0,Math.min(state.summaryPage||0,Math.max(0,Math.ceil(list.length/pageSize)-1)));
 const overview=(state.summaryKey||'all')==='all';
 const key=state.summaryKey||'all';
 const selected=overview?list:tables.by[key];
 const page=selected.slice(pg*pageSize,(pg+1)*pageSize);
 const totalPages=Math.max(1,Math.ceil(selected.length/pageSize));
 if(!overview){const a=awardDefs.find(x=>x.key===key);return `<div class="tvSummary"><h2 class="pixel">${a.name} — FULL LEADERBOARD</h2><div class="tvLeaderboard">${page.map(p=>`<div class="tvBoardRow"><b>#${p.rank} ${esc(p.name)}</b><span>${esc(tables.val(key,p))}</span><span>${state.awardWinners[key]===p.id?'★ 獲獎':''}</span></div>`).join('')}</div><p class="tvPage">PAGE ${pg+1} / ${totalPages} · 同分並列名次</p></div>`}
 const ranks=Object.fromEntries(awardDefs.map(a=>[a.key,Object.fromEntries(tables.by[a.key].map(p=>[p.id,p]))]));
 return `<div class="tvSummary"><h2 class="pixel">🏆 ALL FIVE AWARDS — LEADERBOARD</h2><table class="tvOverall"><thead><tr><th>PLAYER</th><th>BINGO 王</th><th>先鋒</th><th>人氣</th><th>多元</th><th>獨特</th></tr></thead><tbody>${page.map(p=>`<tr><th>${esc(p.name)}</th>${awardDefs.map(a=>{const t=ranks[a.key][p.id];return `<td>${t?'#'+t.rank:'—'}${state.awardWinners[a.key]===p.id?' ★':''}<small>${t?esc(tables.val(a.key,t)):'未完成'}</small></td>`}).join('')}</tr>`).join('')}</tbody></table><p class="tvPage">PAGE ${pg+1} / ${totalPages} · 所有已登記玩家 · #1、#1、#3 表示同分</p></div>`;
}

function tv(){
 const gm=globalMetrics(),pct=Math.min(100,gm.totalPower/gm.target*100),lobby=state.phase==='lobby',ready=gm.totalPower>=gm.target;
 const localFresh=tvVisualEvent && Date.now()-tvVisualEvent.at<2300;
 const remoteFresh=state.event && Date.now()-state.event.at<2200;
 // A registration greeting is for the lobby only. Match messages come from newly
 // recorded Bingo entries, not an earlier WELCOME event still in the database.
 const fx=localFresh?tvVisualEvent:(remoteFresh && (state.event.type!=='join'||lobby)?state.event:null);
 const has=!!fx, attacking=has&&['match','bingo'].includes(fx.type), bingoAttack=has&&fx.type==='bingo';
 const actorHash=String(fx?.actor||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0);
 const firingFi=actorHash%2===0;
 const projectileSvg='<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" shape-rendering="crispEdges"><path fill="#3a241d" d="M12 2h8v3h5v4h4v11h-5v3H8v-3H3V9h4V5h5z"/><path fill="#ef4c3f" d="M12 5h8v3h5v4h2v6H5v-6h2V8h5z"/><path fill="#fff8cd" d="M11 9h5v6h-5zM21 12h4v6h-4z"/><path fill="#fff1d3" d="M10 19h12v8H10z"/><path fill="#332c26" d="M13 21h2v4h-2zM18 21h2v4h-2z"/></svg>';
 let s=`<div class="tv"><div class="row space tvHeader"><div class="pixel" style="color:#ffe477">SUPER AACC SIS. ★ BINGOC</div><b class="pixel">${state.players.length} PLAYERS</b></div>`;
 if(state.tvOverride==='attack'&&state.finalAttack&&Date.now()-(state.finalAttackAt||0)<FINAL_ATTACK_DURATION_MS){
  const elapsed=Date.now()-(state.finalAttackAt||0);
  s+=`<div class="victoryScreen"><h2 class="pixel">FINAL ATTACK! — AWKWARDNESS MONSTER</h2><img class="pixelGif" src="${ATTACK_GIF}" alt="The monster grows to fill the screen and explodes; Fi and Mag leap and pull down the castle flag. The prince does not appear." /><h2 class="pixel" style="color:#ffdc73">MONSTER DEFEATED! · FLAG DOWN!</h2><p class="victorySub">Fi & Mag 成功擊敗陌生怪，合力拉下城堡旗幟！</p><p class="tvPage">Final Attack 結束後將自動進入頒獎。王子只在 Happy Ending 出現。</p></div>`;
  // Display is derived from the freeze timestamp. Never write a TV-only override
  // back to Firebase: this keeps awards available on refresh and on other TVs.
  setTimeout(()=>{if(view==='tv'&&state.tvOverride==='attack')render()}, Math.max(120,FINAL_ATTACK_DURATION_MS-elapsed+120));
 }else if(state.tvOverride==='ending'&&state.finalAttack){
  s+=`<div class="victoryScreen"><h2 class="pixel">HAPPY ENDING!</h2><img class="pixelGif" src="${ENDING_GIF}" alt="The prince is rescued in the happy ending" /><h2 class="pixel" style="color:#ffdc73">THE PRINCE IS SAVED! 🎉</h2><p class="victorySub">最終結局：兩姊妹成功拯救王子，慶祝大團圓！</p><p class="tvPage">主持可隨時切換回完整排行榜。</p></div>`;
 }else if(lobby){
  s+=`<div style="text-align:center;margin-top:10px"><div class="retroTitle"><div class="retroWord main">AACC SIS.</div><div class="retroWord sub">BingoC!</div><div class="retroMini">Super AACC Sis. · Common Connections Adventure</div></div><p style="margin-top:12px">請掃描活動 QR Code 開啟玩家頁，輸入姓名加入</p><div class="qrbox"><div id="actualQr"></div><div style="font-size:.67rem">ROOM: ${esc(ROOM)}</div></div><div class="tvLink">${esc(new URL('phone.html?room='+ROOM,location.href).href)}</div><h3>PLAYERS JOINED: ${state.players.length}</h3><div class="tvnames">${state.players.map(p=>`<span class="tvname">${esc(p.name)}</span>`).join('')}</div></div>`;
 }else if(state.phase==='awards'){
  const a=awardDefs[state.awardIndex],arr=awardTables().by[a.key],w=candidate(state.awardIndex),limit=Math.min(3,arr.length);
  if(state.awardView==='interview'&&state.awardWinners[a.key])s+=w?tvInterview(a,w):'<div class="tvMessage" style="text-align:center;margin:100px 0"><h2>本獎沒有合資格玩家</h2><p>例如：未有人完成第一條 Bingo 線</p></div>';
  else{
   const rows=arr.slice(0,Math.max(3,arr.indexOf(w)+1));
   s+=`<div class="tvAwardHeading"><div class="pixel">BINGOC AWARDS · ${state.awardIndex+1}/5</div><h2>${a.name}</h2><p>${a.title}</p></div><div class="top3 tvAwardList">${rows.map((p,i)=>{const revealed=i>=3?state.awardRevealed>=limit:i>=limit-state.awardRevealed;const highlight=w?.id===p.id&&revealed;return `<div class="tvAwardRow ${highlight?'tvWinner':''}"><b>#${p.rank} ${revealed?esc(p.name):'???????'}</b><b>${revealed?esc(awardTables().val(a.key,p)):'🔒'} ${highlight?'★':''}</b>${revealed&&state.awarded.includes(p.id)&&!highlight?'<small>已得其他獎</small>':''}</div>`}).join('')}</div><p class="tvPage">${state.awardRevealed===limit?'排名已揭曉，等待主持確認訪問嘉賓':'由第三位開始揭曉，最後才揭曉第一位'}</p>`;
  }
 }else if(state.phase==='summary')s+=tvFullLeaderboard();
 else{
  s+=`<div style="text-align:center;margin:10px 0"><h2 class="pixel" style="color:#ffde73;font-size:1.55rem">FI & MAG — BEAT THE AWKWARDNESS MONSTER!</h2><p style="font-size:.88rem;color:#cbd5f4">Find common interests, make new friends, and rescue the prince!</p></div><div class="tvsky ${attacking?'attackAction':''} ${bingoAttack?'powerBingo':''}"><span class="fi ${attacking&&firingFi?'heroAttack':''}">👧🏻</span><span class="mag ${attacking&&!firingFi?'heroAttack':''}">👩🏽</span><span class="boss ${attacking?'bossHit':''}">👾</span><div class="tvground"></div>${attacking?`<span class="attackShot ${firingFi?'fromFi':'fromMag'}" aria-hidden="true">${projectileSvg}</span><span class="impactBurst" aria-hidden="true">✹</span>`:''}${has&&fx.type!=='edit'?`<div class="tvbanner pixel">${esc(fx.text)}</div>`:''}</div><div class="row space" style="margin:17px 0 7px"><b class="pixel">COMMON POWER</b><b>${gm.totalPower} / ${gm.target}</b></div><div class="progress"><div style="width:${pct}%"></div></div><div class="row space" style="margin-top:13px"><b>🎉 BINGO PLAYERS: ${gm.bingoPeople}</b><b>${ready?'FINAL ATTACK READY!':'KEEP CONNECTING!'}</b></div>${state.phase==='paused'?'<div class="tvbanner pixel">GAME PAUSED</div>':''}`;
 }
 s+='</div><p class="sub" style="margin-top:10px">BingoC Firebase Multiplayer v2.3A · Final Attack / Awards / Happy Ending。</p>';return s;
}

let tvBannerTimer=null;
function render(){
 if(tvBannerTimer){clearTimeout(tvBannerTimer);tvBannerTimer=null;}
 document.body.classList.toggle('mode-phone',view==='phone');
 document.body.classList.toggle('mode-tv',view==='tv');
 document.body.classList.toggle('mode-host',view==='host');
 root.className='view-'+view;
 if(LIVE&&!serverStateReady&&!(view==='host'&&!hostValidated)){
  root.innerHTML=`<div class="panel">正在連接 Firebase... ${esc(warning)}</div>`;return;
 }
 root.innerHTML=({phone,host,tv})[view]();
 if(view==='tv'&&state.phase==='lobby'&&document.getElementById('actualQr')&&window.QRCode){
  new QRCode(document.getElementById('actualQr'),{text:new URL('phone.html?room='+ROOM,location.href).href,width:154,height:154});
 }
 if(view==='tv'){
  const now=Date.now();
  const tvTime=tvVisualEvent?.at && 2300-(now-tvVisualEvent.at);
  const remoteTime=state.event?.at && 2200-(now-state.event.at);
  const remaining=tvTime>0?tvTime:remoteTime>0?remoteTime:0;
  if(remaining)tvBannerTimer=setTimeout(()=>render(),remaining+50);
 }
}
function mockSeed(){if(state.phase!=='lobby')return;if(!confirm('載入示範玩家將覆蓋目前資料，確定嗎？'))return;state=defaults();const names=['Sophie','Mary','Peter','Helen','Simon','Jenny','David','Susan','Alex','Grace','Fi','Mag'];state.players=names.map((name,i)=>({id:'demo'+i,name,joinedAt:Date.now()+i,firstBingoAt:null}));for(const p of state.players)state.entries[p.id]=Array.from({length:9},()=>[]);names.forEach((name,i)=>{for(let j=0;j<5;j++){let cat=(i+j*2)%9,other=(i+j+1)%names.length;let row=state.entries['demo'+i][cat];if(row.length<2&&!row.includes('demo'+other)&&state.entries['demo'+i].filter(x=>x.includes('demo'+other)).length<2)row.push('demo'+other)}});for(let i=0;i<state.players.length;i++){if(personMetrics(state.players[i].id).normal>0)state.players[i].firstBingoAt=Date.now()+i*1000;}currentId=state.players[0].id;localStorage.setItem(USER_KEY,currentId);warning='';nowEvent('12 DEMO PLAYERS READY','join');SAVE()}
function startGame(){state.phase='playing';state.target=Math.max(1,state.players.length*5);state.startAt=Date.now();state.boost=0;nowEvent('READY? GO!','start');SAVE()}
async function resetAll(){if(!confirm('確定清除所有玩家、分數及得獎紀錄？此操作不可還原。'))return;
 if(LIVE){if(!hostValidated)return;await dbRef.set({host:Object.fromEntries(HOST_FIELDS.map(k=>[k,defaults()[k]??null]))});return}
 state=defaults();currentId=null;localStorage.removeItem(USER_KEY);edit=-1;search='';warning='';SAVE()}
async function doAction(a){
 if(a==='hostLogin'){
  try{await auth.signInWithEmailAndPassword(document.getElementById('hostEmail').value,document.getElementById('hostPassword').value)}
  catch(e){warning='登入失敗：'+e.message;render()};return;
 }
 if(LIVE&&view==='host'&&!hostValidated)return;
 if(a==='join')return join(document.getElementById('joinName')?.value||inputName);
 if(a==='leave'){currentId=null;localStorage.removeItem(USER_KEY);warning='';edit=-1;return render()}
 if(a==='close'){edit=-1;warning='';search='';return render()}
 if(a==='start')return startGame();
 if(a==='pause'){state.phase='paused';state.pausedAt=Date.now();return SAVE()}
 if(a==='resume'){state.phase='playing';state.pausedMs+=Date.now()-(state.pausedAt||Date.now());state.pausedAt=null;return SAVE()}
 if(a==='freeze')return freeze();if(a==='seed')return mockSeed();if(a==='reset')return resetAll();
 if(a.startsWith('boost')){if(!['playing','paused'].includes(state.phase))return;let n=Number(a.slice(5));state.boost+=n;nowEvent(`FRIENDSHIP BOOST +${n}!`,'boost');return SAVE()}
 if(a==='showEnding'){
   if(!state.finalAttack)return;
   state.tvOverride='ending';return SAVE();
 }
 if(a==='reveal'){const lim=Math.min(3,awardTables().by[awardDefs[state.awardIndex].key].length);state.awardRevealed=Math.min(lim,state.awardRevealed+1);return SAVE()}
 if(a==='award'){
   let p=candidate(state.awardIndex),aw=awardDefs[state.awardIndex],lim=Math.min(3,awardTables().by[aw.key].length);
   if(p&&!state.awardWinners?.[aw.key]&&state.awardRevealed>=lim&&!state.awarded.includes(p.id)){
     state.awarded.push(p.id);state.awardWinners[aw.key]=p.id;
     state.awardView='interview';state.tvOverride='auto';
     nowEvent(`${p.name} — AWARD WINNER!`,'award');return SAVE()
   }
 }
 if(a==='skip'){const aw=awardDefs[state.awardIndex];if(candidate(state.awardIndex))return;state.awardWinners[aw.key]='SKIPPED';state.awardView='interview';state.tvOverride='auto';return SAVE()}
 if(a==='interview'){state.awardView='interview';state.tvOverride='auto';return SAVE()}
 if(a==='backRanking'){state.awardView='ranking';state.tvOverride='auto';return SAVE()}
 if(a==='next'){if(!state.awardWinners[awardDefs[state.awardIndex].key])return;state.awardIndex=Math.min(4,state.awardIndex+1);state.awardView='ranking';state.awardRevealed=0;state.tvOverride='auto';return SAVE()}
 if(a==='summary'){if(!state.awardWinners[awardDefs[4].key])return;state.phase='summary';state.summaryPage=0;state.summaryKey='all';state.tvOverride='auto';return SAVE()}
 if(a==='boardAll'){state.summaryKey='all';state.summaryPage=0;state.tvOverride='auto';return SAVE()}
 if(a.startsWith('board_')){state.summaryKey=a.slice(6);state.summaryPage=0;state.tvOverride='auto';return SAVE()}
 if(a==='pageNext'||a==='pagePrev'){
   const per=8,t=awardTables().by[state.summaryKey==='all'?'king':state.summaryKey]||[];
   const end=Math.max(0,Math.ceil(t.length/per)-1);
   state.summaryPage=Math.max(0,Math.min(end,(state.summaryPage||0)+(a==='pageNext'?1:-1)));
   state.tvOverride='auto';return SAVE()
 }
}
root.addEventListener('click',e=>{const a=e.target.closest('[data-action]');if(a)return doAction(a.dataset.action);const cell=e.target.closest('[data-cell]');if(cell){edit=Number(cell.dataset.cell);warning='';search='';return render()}const add=e.target.closest('[data-select]');if(add){addMatch(currentId,edit,add.dataset.select);return}const rm=e.target.closest('[data-remove]');if(rm){removeMatch(currentId,edit,rm.dataset.remove);return}const award=e.target.closest('[data-award]');if(award){const idx=Number(award.dataset.award);if(idx>0&&!state.awardWinners[awardDefs[idx-1].key])return;state.awardIndex=idx;state.awardView=state.awardWinners[awardDefs[idx].key]?'interview':'ranking';state.awardRevealed=state.awardWinners[awardDefs[idx].key]?3:0;state.tvOverride='auto';return SAVE()}});
root.addEventListener('input',e=>{if(e.target.id==='joinName')inputName=e.target.value;if(e.target.id==='nameSearch'){search=e.target.value;const pos=e.target.selectionStart;render();const n=document.getElementById('nameSearch');if(n){n.focus();n.setSelectionRange(pos,pos)}}});
root.addEventListener('change',e=>{if(e.target.id==='switchPlayer'){currentId=e.target.value;if(currentId)localStorage.setItem(USER_KEY,currentId);warning='';return render()}});
root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='joinName')join(e.target.value)});
document.getElementById('nav')?.addEventListener('click',e=>{const a=e.target.closest('[data-view]');if(!a)return;view=a.dataset.view;warning='';edit=-1;render()});
window.addEventListener('storage',e=>{if(LIVE||e.key!==KEY)return;try{state={...defaults(),...JSON.parse(e.newValue)};render()}catch{}});
render();setup();
})();
