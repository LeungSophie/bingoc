/* BingoC v2.3B — original retro soundtrack, TV-only.
   Browser autoplay safety: no sound is played until a user clicks Enable Sound.
   +1 common power SFX has intentionally higher volume than background music. */
(()=>{'use strict';
 if(document.body.dataset.view!=='tv')return;
 const ROOT='assets/audio/';
 const TRACKS={lobby:'lobby_bgm.mp3',playing:'playing_bgm.mp3',awards:'awards_bgm.mp3',ending:'ending_bgm.mp3'};
 const FX={coin:'coin.mp3',join:'join.mp3',boost:'boost.mp3',reveal:'reveal.mp3',award:'award_win.mp3',battle:'battle_start.mp3',explosion:'explosion.mp3',flag:'flag_clear.mp3'};
 const ATTACK_MS=6380;
 const KEY='bingoc_tv_sound_v23b';
 let prefs={bgm:.18,sfx:.88,muted:false};
 try{prefs={...prefs,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{}
 prefs.bgm=Math.max(0,Math.min(1,Number(prefs.bgm)||0));
 prefs.sfx=Math.max(0,Math.min(1,Number(prefs.sfx)||0));
 let enabled=false, currentState=null,stage=null,track=null,attackTimers=[],stageTimer=null,duckTimer=null,ducked=false;
 const music={};
 Object.entries(TRACKS).forEach(([key,filename])=>{
   const a=new Audio(ROOT+filename+'?v=23b');a.preload='auto';a.loop=true;
   music[key]=a;
 });
 const fxPool={};
 Object.entries(FX).forEach(([key,filename])=>{
   const a=new Audio(ROOT+filename+'?v=23b');a.preload='auto';fxPool[key]=a;
 });
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(prefs))}catch{}};
 function volume(){
   for(const a of Object.values(music))a.volume=prefs.muted?0:prefs.bgm*(ducked?.45:1);
   for(const a of Object.values(fxPool))a.volume=prefs.muted?0:prefs.sfx;
 }
 function oneShot(key,delay=0){
   if(!enabled||prefs.muted)return;
   const play=()=>{
     if(!enabled||prefs.muted)return;
     // Fresh Audio instance lets coin sounds overlap if several players score together.
     const base=fxPool[key]; if(!base)return;
     const a=base.cloneNode(true);a.volume=prefs.sfx;
     a.play().catch(()=>{});
     if(key==='coin'){
       ducked=true;volume();
       clearTimeout(duckTimer);duckTimer=setTimeout(()=>{ducked=false;volume()},330);
     }
   };
   if(delay>0)return setTimeout(play,delay);
   play();
 }
 function clearAttack(){attackTimers.forEach(clearTimeout);attackTimers=[];}
 function calcStage(s){
   if(!s)return 'lobby';
   if(s.tvOverride==='ending'&&s.finalAttack)return 'ending';
   if(s.tvOverride==='attack'&&s.finalAttack&&Date.now()-(s.finalAttackAt||0)<ATTACK_MS)return 'attack';
   if(s.phase==='lobby')return 'lobby';
   if(s.phase==='playing')return 'playing';
   if(s.phase==='paused')return 'paused';
   if(s.phase==='awards'||s.phase==='summary')return 'awards';
   return 'lobby';
 }
 function switchScene(){
   if(!enabled)return;
   const next=calcStage(currentState);
   if(stage===next)return;
   clearAttack();clearTimeout(stageTimer);stageTimer=null;
   if(track){track.pause();track=null;}
   const prev=stage;stage=next;
   if(next==='attack'){
     // Schedule cues against the host's freeze timestamp, so reloads do not
     // restart the final attack from the beginning.
     const elapsed=Math.max(0,Date.now()-(currentState.finalAttackAt||Date.now()));
     const cues=[[0,'battle'],[3250,'explosion'],[4900,'flag']];
     cues.forEach(([ms,key])=>{
       if(ms<elapsed-140)return;
       attackTimers.push(setTimeout(()=>oneShot(key),Math.max(0,ms-elapsed)));
     });
     stageTimer=setTimeout(()=>{stage=null;switchScene()},Math.max(50,ATTACK_MS-elapsed+70));
   }else{
     let key=(next==='paused')?null:next;
     if(key && music[key]){
       track=music[key];track.currentTime=0;volume();
       track.play().catch(()=>{});
     }
     if(next==='awards'&&prev==='attack')oneShot('award');
     if(next==='ending'&&prev!=='ending')oneShot('award');
   }
   volume();updateStatus();
 }
 function handleUpdate(next,prev,added){
   currentState=next;
   if(enabled){switchScene();
     if(prev){
       if(next.phase==='playing' && added>0){
         for(let i=0;i<Math.min(added,4);i++)oneShot('coin',i*110);
       }
       const oldEv=prev.event,newEv=next.event;
       const newEvent=newEv&&newEv.at&&(newEv.at!==oldEv?.at||newEv.type!==oldEv?.type||newEv.actor!==oldEv?.actor);
       if(newEvent){
         if(newEv.type==='boost')oneShot('boost');
         else if(newEv.type==='join'&&next.phase==='lobby')oneShot('join');
       }
       if(next.phase==='awards'&&prev.phase==='awards'){
         if(next.awardIndex===prev.awardIndex&&next.awardRevealed>prev.awardRevealed)oneShot('reveal');
         const idx=next.awardIndex;
         const awardNames=['king','pioneer','magnet','diverse','unique'];
         const awardKey=awardNames[idx];
         if(awardKey&&next.awardWinners?.[awardKey]&&prev.awardWinners?.[awardKey]!==next.awardWinners[awardKey]&&next.awardWinners[awardKey]!=='SKIPPED')oneShot('award');
       }
     }
   }
 }
 function updateStatus(){
   const b=document.getElementById('bcAudioEnable');
   const m=document.getElementById('bcAudioMute');
   const s=document.getElementById('bcAudioStatus');
   if(b)b.textContent=enabled?'🔊 Audio ON':'▶ Enable Sound';
   if(m)m.textContent=prefs.muted?'🔇 Unmute':'🔈 Mute';
   if(s)s.textContent=enabled?({'lobby':'LOBBY ♫','playing':'PLAYING ♫','paused':'PAUSED','attack':'FINAL ATTACK','awards':'AWARDS ♫','ending':'HAPPY ENDING ♫'}[stage]||'AUDIO ON'):'Click to start sound';
 }
 function ui(){
   const dock=document.createElement('aside');dock.id='bcAudioDock';
   dock.innerHTML=`<div class="bcAudioHeading"><b>🎵 TV SOUND</b><small id="bcAudioStatus">Click to start sound</small></div>
   <div class="bcAudioActions"><button id="bcAudioEnable" type="button">▶ Enable Sound</button><button id="bcAudioMute" type="button">🔈 Mute</button></div>
   <div class="bcAudioSliders"><label>BGM <input id="bcMusicVolume" type="range" min="0" max="100" value="${Math.round(prefs.bgm*100)}" aria-label="Background music volume"><output id="bcMusicPct">${Math.round(prefs.bgm*100)}%</output></label>
   <label>Coin / SFX <input id="bcSfxVolume" type="range" min="0" max="100" value="${Math.round(prefs.sfx*100)}" aria-label="Sound effect volume"><output id="bcSfxPct">${Math.round(prefs.sfx*100)}%</output></label></div>
   <button class="bcAudioTest" id="bcTestCoin" type="button">▶ Test +1 Coin</button>`;
   document.body.appendChild(dock);
   document.getElementById('bcAudioEnable').addEventListener('click',()=>{
     enabled=true;stage=null;switchScene();updateStatus();
   });
   document.getElementById('bcAudioMute').addEventListener('click',()=>{prefs.muted=!prefs.muted;volume();save();updateStatus()});
   document.getElementById('bcMusicVolume').addEventListener('input',e=>{prefs.bgm=e.target.value/100;document.getElementById('bcMusicPct').textContent=e.target.value+'%';volume();save()});
   document.getElementById('bcSfxVolume').addEventListener('input',e=>{prefs.sfx=e.target.value/100;document.getElementById('bcSfxPct').textContent=e.target.value+'%';volume();save()});
   document.getElementById('bcTestCoin').addEventListener('click',()=>{if(!enabled){enabled=true;stage=null;switchScene()}oneShot('coin');updateStatus()});
   updateStatus();
 }
 ui();
 window.BingoCSound={onState:handleUpdate,onRender:function(s){currentState=s;if(enabled)switchScene()}};
})();
