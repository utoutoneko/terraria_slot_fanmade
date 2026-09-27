const AUD = {};
Object.entries(AUDIO_SRC).forEach(([k,src])=>{ const a=new Audio(src); a.preload="auto"; AUD[k]=a; });
let audioUnlocked=false;
function unlockAudio(){
  if(audioUnlocked) return; audioUnlocked=true;
  // Play-and-immediately-pause every sample once, synchronously inside the user gesture,
  // so later play() calls from setTimeout callbacks are not blocked by autoplay policy.
  Object.values(AUD).forEach(a=>{ a.volume=0; const p=a.play(); if(p&&p.catch) p.then(()=>{a.pause();a.currentTime=0;a.volume=0.7;}).catch(()=>{}); });
  try{ ac(); if(actx && actx.state==="suspended") actx.resume(); }catch(e){}
  document.removeEventListener("pointerdown", unlockAudio);
}
document.addEventListener("pointerdown", unlockAudio, {once:true});
function playReal(key, vol){
  if(!state.sound) return;
  const base = AUD[key]; if(!base) return;
  const a = base.cloneNode(); a.volume = vol!=null?vol:0.7;
  a.play().catch(()=>{});
}
let actx=null;
function ac(){ if(!actx) actx=new (window.AudioContext||window.webkitAudioContext)(); return actx; }
function beep(freq,dur,type,vol,delay){ if(!state.sound) return; const ctx=ac(); const t0=ctx.currentTime+(delay||0);
  const osc=ctx.createOscillator(); const gain=ctx.createGain(); osc.type=type||"square"; osc.frequency.setValueAtTime(freq,t0);
  gain.gain.setValueAtTime(0.0001,t0); gain.gain.exponentialRampToValueAtTime(vol||0.15,t0+0.015); gain.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
  osc.connect(gain); gain.connect(ctx.destination); osc.start(t0); osc.stop(t0+dur+0.02); }
function sfxTick(){ playReal("hit", 0.12); }
function sfxStop(){ playReal("hit",0.5); }
function sfxCoin(pitchMul){ const key=["coin0","coin1","coin2"][Math.floor(Math.random()*3)]; playReal(key, 0.55*(pitchMul||1)); }
function sfxPop(){ playReal("unlock",0.55); }
function sfxChestCreak(){ playReal("doorOpen",0.6); }
function sfxGrab(){ playReal("grab",0.6); }
function sfxBigReveal(){ playReal("reveal",0.7); setTimeout(()=>playReal("doorOpen",0.5),80); }
function sfxJackpot(){ playReal("reveal",0.8); setTimeout(()=>playReal("doorOpen",0.6),100); [0,1,2,3].forEach((i)=>beep(660+i*140,0.16,"square",0.1,0.2+i*0.09)); }
function sfxDig(){ playReal("dig",0.6); }

/* ================= rendering ================= */
const JACKPOT_FEED_RATE = 0.03;      // 3% of every paid bet feeds the mystery pot
const JACKPOT_TRIGGER_CHANCE = 0.0009; // flat chance per paid spin to pop the mystery pot
const JACKPOT_SEED = 5000;             // reseed value (50 silver) after it pops
const SCATTER_ID = "present";
const SCATTER_MIN = 3;
const FREE_SPINS_AWARD = 5;
const FREE_SPINS_MULT = 2;

const KAKU_SPINS = 5;      // bonus mode length (spins)
const KAKU_MULT = 1.5;     // payout multiplier during bonus mode
const PITY_LIMIT = 100;    // paid spins without bonus mode before it is forced ("tenjou")
const KAKU_STREAK_TRIGGER = 3;

let freeSpinsRemaining = 0;
let bottleBuffRemaining = 0;
let kakuhenRemaining = 0;
function updateKakuUI(){
  const on = kakuhenRemaining>0;
  kakuBadge.classList.toggle("show", on);
  kakuLeft.textContent = kakuhenRemaining; kakuLeftEn.textContent = kakuhenRemaining;
  document.getElementById("kakuMult").textContent = KAKU_MULT; document.getElementById("kakuMultEn").textContent = KAKU_MULT;
  document.getElementById("spinIcon").src = on ? SPR.cursor : SPR.icon_sword;
  const left = Math.max(0, PITY_LIMIT-(state.pityCount||0));
  pitylineEl.textContent = on ? "" : (state.lang==="en" ? `Bonus guaranteed in ${left} spins` : `確変まで あと${left}回転(天井)`);
}
function startKakuhen(reasonJa, reasonEn){
  kakuhenRemaining = KAKU_SPINS; state.pityCount = 0; state.kakuhenTriggers=(state.kakuhenTriggers||0)+1;
  updateKakuUI();
  showBanner(state.lang==="en" ? "BONUS MODE!" : "確変突入!!", 1800);
  showToast(state.lang==="en" ? reasonEn : reasonJa);
  spawnParticles("rainbow",12); sfxBigReveal();
}
function renderBottleUI(){
  bottleCountEl.textContent = state.bottles||0;
  useBottleBtn.disabled = !(state.bottles>0) || bottleBuffRemaining>0;
}
function updateBottleBuffBadge(){
  if(bottleBuffRemaining>0){ bottleBuffBadge.classList.add("show"); bbLeft.textContent=bottleBuffRemaining; bbLeftEn.textContent=bottleBuffRemaining; }
  else { bottleBuffBadge.classList.remove("show"); }
  updateHudStrip();
}
let lastRealBet = BET_STEPS[betIndex]*SILVER;

let displayedJackpot = state.jackpotPool;
let jackpotAnimGen=0;
function renderJackpot(instant){
  const target = state.jackpotPool;
  jackpotAnimGen++;
  const myGen=jackpotAnimGen;
  if(instant){ displayedJackpot=target; jpVal.textContent=formatCoins(target); return; }
  const start=displayedJackpot, diff=target-start;
  if(diff===0){ jpVal.textContent=formatCoins(target); displayedJackpot=target; return; }
  const dur=500, t0=performance.now();
  function step(t){
    if(myGen!==jackpotAnimGen) return;
    const p=Math.min(1,(t-t0)/dur); jpVal.textContent=formatCoins(start+diff*p);
    if(p<1) requestAnimationFrame(step); else { displayedJackpot=target; jpVal.classList.add("bump"); setTimeout(()=>jpVal.classList.remove("bump"),320); }
  }
  requestAnimationFrame(step);
}
function updateFreeSpinBadge(){
  if(freeSpinsRemaining>0){
    freespinBadge.classList.add("show");
    fsLeft.textContent=freeSpinsRemaining; fsLeftEn.textContent=freeSpinsRemaining;
  } else {
    freespinBadge.classList.remove("show");
  }
  updateHudStrip();
}
function updateStreakLine(){
  if(state.streak>=2){
    const bonusPct = Math.min(state.streak-1,10)*10;
    streaklineEl.innerHTML = state.lang==="en"
      ? `🔥 ${state.streak} win streak (+${bonusPct}%)`
      : `🔥 ${state.streak}連勝中 (配当+${bonusPct}%)`;
  } else {
    streaklineEl.textContent = "";
  }
  updateHudStrip();
}
function updateHudStrip(){
  const heartImgs = heartsRowEl.querySelectorAll("img");
  const filled = Math.min(state.streak||0, heartImgs.length);
  heartImgs.forEach((im,i)=>im.classList.toggle("empty", i>=filled));
  // stars now represent MANA (collected from falling stars at night)
  const starImgs = starsRowEl.querySelectorAll("img");
  const manaFilled = Math.min(state.mana||0, starImgs.length);
  starImgs.forEach((im,i)=>{ im.classList.toggle("empty", i>=manaFilled); im.classList.toggle("active", i<manaFilled); });
  starsRowEl.style.cursor = (state.mana>0) ? "pointer" : "default";
}

let displayedBalance=state.balance;
let balanceAnimGen=0;
function renderBalance(instant){
  const target=state.balance;
  balanceAnimGen++;
  const myGen=balanceAnimGen;
  if(instant){ displayedBalance=target; paintBalance(target); return; }
  const start=displayedBalance, diff=target-start;
  if(diff===0){ paintBalance(target); displayedBalance=target; return; }
  const dur=650, t0=performance.now();
  function step(t){
    if(myGen!==balanceAnimGen) return; // a newer render call has superseded this one
    const p=Math.min(1,(t-t0)/dur); const eased=1-Math.pow(1-p,3); paintBalance(Math.round(start+diff*eased));
    if(p<1) requestAnimationFrame(step); else { displayedBalance=target; }
  }
  requestAnimationFrame(step);
}
let lastCoins={p:-1,g:-1,s:-1,c:-1};
function paintBalance(v){
  const {p,g,s,c}=toCoins(Math.max(0,v));
  balanceBar.innerHTML = `
    <div class="coin" id="coinP"><img class="spr" src="${SPR.coin_platinum}" style="width:17px;height:20px">${p}</div>
    <div class="coin" id="coinG"><img class="spr" src="${SPR.coin_gold}" style="width:15px;height:20px">${g}</div>
    <div class="coin" id="coinS"><img class="spr" src="${SPR.coin_silver}" style="width:15px;height:17px">${s}</div>
    <div class="coin" id="coinC"><img class="spr" src="${SPR.coin_copper}" style="width:15px;height:15px">${c}</div>`;
  if(p>lastCoins.p) document.getElementById("coinP").classList.add("bump");
  if(g>lastCoins.g) document.getElementById("coinG").classList.add("bump");
  if(s>lastCoins.s) document.getElementById("coinS").classList.add("bump");
  lastCoins={p,g,s,c};
}
function renderBet(){ const {p,g,s,c}=toCoins(currentBet()); let parts=[]; if(p) parts.push(p+"P"); if(g) parts.push(g+"G"); if(s) parts.push(s+"S"); if(c) parts.push(c+"C"); betAmt.textContent=parts.join(" ")||"0"; }
function applyLang(){ document.body.classList.toggle("lang-en", state.lang==="en"); document.getElementById("langBtn").textContent = state.lang==="en"?"JA":"EN"; }
let chatLog = [];
function setMsg(ja,en,comboJa,comboEn){
  msgline.innerHTML = `<span class="hidden-ja">${ja}</span><span class="hidden-en">${en}</span>` + (comboJa? `<span class="combo hidden-ja">${comboJa}</span><span class="combo hidden-en">${comboEn}</span>`:"");
  const line = state.lang==="en" ? en : ja;
  chatLog.push(line);
  if(chatLog.length>30) chatLog.shift();
  if(chatPanel && chatPanel.classList.contains("show")) renderChatLog();
}
function renderChatLog(){
  chatPanel.innerHTML = chatLog.slice().reverse().map(l=>`<div class="chatline">${l}</div>`).join("");
}
function renderPaytable(){
  const rtp=(computeRTP()*100).toFixed(1);
  paytable.innerHTML = SYMBOLS.slice().reverse().map(s=>{ const img=SPR[s.revealVariants[0]];
    return `<div class="paytable-row"><img src="${img}" class="spr"><div class="name"><span class="hidden-ja">${s.nameJa}</span><span class="hidden-en">${s.nameEn}</span> ×3</div><div class="mult">×${s.mult}</div></div>`;
  }).join("") + `<div class="rtpnote"><span class="hidden-ja">理論上の還元率(RTP)約${rtp}%(8ライン合算)</span><span class="hidden-en">Theoretical RTP ≈ ${rtp}% (8 lines combined)</span></div>`
  + `<div class="streaknote"><span class="hidden-ja">🔥 連勝ボーナス:2連勝目から配当+10%、以降1連勝ごとに+10%(最大+100%)</span><span class="hidden-en">🔥 Win streak bonus: +10% payout from your 2nd consecutive win, +10% per further win (up to +100%)</span></div>`;
}
function updateSoundBtn(){ document.getElementById("soundBtn").classList.toggle("active", state.sound); }
renderBalance(true); renderBet(); applyLang(); renderPaytable(); updateSoundBtn(); renderJackpot(true); updateFreeSpinBadge(); updateStreakLine(); renderBottleUI(); updateBottleBuffBadge(); updateHudStrip(); updateKakuUI();
function syncSkyHeight(){
  cabinet.style.marginTop = '34px';
  const top = cabinet.getBoundingClientRect().top;
  document.documentElement.style.setProperty('--skyh', Math.max(60, top - 4)+'px');
}
syncSkyHeight();
window.addEventListener('resize', syncSkyHeight);
setTimeout(syncSkyHeight, 200);

const DAYNIGHT_CYCLE_MS = 120000; // full day+night loop every 2 minutes
function updateDayNight(){
  const skyEl = document.querySelector('.worldbg .sky');
  const skyH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--skyh')) || 200;
  const phase = (Date.now() % DAYNIGHT_CYCLE_MS) / DAYNIGHT_CYCLE_MS; // 0..1
  const isDay = phase < 0.5;
  const arcT = isDay ? (phase/0.5) : ((phase-0.5)/0.5); // 0..1 within day or night half: 0=rise at horizon, 0.5=peak, 1=set at horizon
  const arcX = 6 + arcT*88; // percent across sky width, horizon to horizon
  const riseSet = skyH + 24; // below the horizon (hidden behind dirt band)
  const peakY = skyH * 0.08; // near top of sky at zenith
  const arcY = riseSet - Math.sin(arcT*Math.PI) * (riseSet - peakY);
  const bodyEl = isDay ? skySun : skyMoon;
  const otherEl = isDay ? skyMoon : skySun;
  otherEl.style.opacity = '0';
  bodyEl.style.opacity = arcT<0.03 ? String(arcT/0.03) : (arcT>0.97 ? String((1-arcT)/0.03) : '1');
  bodyEl.style.left = `calc(${arcX}% - 20px)`;
  bodyEl.style.top = arcY + 'px';
  // subtle night tint
  if(skyEl) skyEl.style.filter = isDay ? 'none' : 'brightness(.45) saturate(.7)';
}
updateDayNight();
setInterval(updateDayNight, 1000);

// ---- Falling star -> mana system ----
let manaPurifyNextSpin = false;
function isCurrentlyNight(){
  const phase = (Date.now() % DAYNIGHT_CYCLE_MS) / DAYNIGHT_CYCLE_MS;
  return phase >= 0.5;
}
function spawnFallingStar(){
  if(!isCurrentlyNight()) return;
  if(document.querySelectorAll('.fallingstar').length >= 2) return; // don't overcrowd
  const star = document.createElement('img');
  star.src = SPR.deco_star;
  star.className = 'fallingstar';
  const vw = window.innerWidth;
  const startX = 20 + Math.random()*(vw-40);
  const skyH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--skyh')) || 200;
  star.style.left = startX+'px';
  star.style.top = '-20px';
  document.body.appendChild(star);
  const fallMs = 900 + Math.random()*400;
  const landY = skyH - 6;
  star.animate([{top:'-20px'},{top:landY+'px'}], {duration:fallMs, easing:'ease-in'});
  setTimeout(()=>{
    if(!star.isConnected) return;
    star.style.top = landY+'px';
    star.classList.add('landed');
    star.onclick = ()=>{
      state.starFragments = (state.starFragments||0)+1;
      if(state.starFragments>=5){ state.starFragments-=5; state.mana=(state.mana||0)+1; updateHudStrip(); showToast(state.lang==="en"?"+1 Mana!":"マナ+1!"); }
      saveState();
      playReal("starPickup", 0.6);
      star.remove();
    };
    // despawn if not collected within a while
    setTimeout(()=>{ if(star.isConnected) star.remove(); }, 15000);
  }, fallMs);
}
setInterval(()=>{ if(Math.random()<0.35) spawnFallingStar(); }, 8000);

starsRowEl.onclick = ()=>{
  if(!(state.mana>0)) return;
  state.mana -= 1; manaPurifyNextSpin = true; state.manaUsed=(state.manaUsed||0)+1; updateHudStrip(); saveState();
  showToast(state.lang==="en" ? "Mana used — next spin excludes common Mimics!" : "マナ使用!次のスピンは低ランクのミミックが出にくくなる");
};

setInterval(()=>{
  const rect=cabinet.getBoundingClientRect();
  const d=document.createElement("div"); const size=2+Math.random()*3;
  d.className="dust"; d.style.width=d.style.height=size+"px";
  d.style.left=(rect.left+Math.random()*rect.width)+"px";
  d.style.top=(rect.top+rect.height*0.6+Math.random()*rect.height*0.3)+"px";
  d.style.opacity=.15+Math.random()*.35;
  fxlayer.appendChild(d);
  const dur=3000+Math.random()*2000;
  d.animate([{transform:"translateY(0)",opacity:d.style.opacity},{transform:`translateY(-${80+Math.random()*60}px)`,opacity:0}],{duration:dur,easing:"linear",fill:"forwards"});
  setTimeout(()=>d.remove(), dur+50);
}, 500);

document.getElementById("betUp").onclick=()=>{ betIndex=Math.min(BET_STEPS.length-1,betIndex+1); renderBet(); sfxTick(); };
document.getElementById("betDown").onclick=()=>{ betIndex=Math.max(0,betIndex-1); renderBet(); sfxTick(); };
document.getElementById("langBtn").onclick=()=>{ state.lang=state.lang==="en"?"ja":"en"; applyLang(); saveState(); renderPaytable(); updateKakuUI(); };
document.getElementById("soundBtn").onclick=()=>{ state.sound=!state.sound; updateSoundBtn(); saveState(); if(state.sound) sfxTick(); };
document.getElementById("resetBtn2").onclick=()=>{
  const ok=confirm(state.lang==="en" ? "Reset your save data and balance? This cannot be undone." : "セーブデータと所持金をリセットします。よろしいですか?(元に戻せません)");
  if(!ok) return;
  state={...DEFAULT_STATE, lang:state.lang, sound:state.sound};
  betIndex=3; localStorage.removeItem(SAVE_KEY);
  renderBalance(true); renderBet(); setMsg("リセットしました","Reset complete");
};
document.getElementById("torchGameBtn").onclick=()=>{
  showToast(state.lang==="en" ? "Ghost Hunt minigame coming soon!" : "幽霊退治ミニゲーム、近日公開!");
};
useBottleBtn.onclick=()=>{
  if(!(state.bottles>0) || bottleBuffRemaining>0) return;
  state.bottles -= 1; bottleBuffRemaining = 5;
  renderBottleUI(); updateBottleBuffBadge(); saveState(); sfxGrab();
  if(!state.achievements) state.achievements={};
  if(!state.achievements.bottleUsed){ state.achievements.bottleUsed=true; saveState();
    showToast(state.lang==="en"?"Achievement: Lucky Drinker!":"実績解除:ラッキードリンカー!");
  } else {
    showToast(state.lang==="en"?"Lucky Potion active! 2x payouts for 5 spins":"ラッキーポーション発動!5スピン配当2倍");
  }
};
document.getElementById("coinPile").onclick=()=>{ document.getElementById("payModal").classList.add("show"); };
document.getElementById("payClose").onclick=()=>{ document.getElementById("payModal").classList.remove("show"); };
document.getElementById("payModal").onclick=(e)=>{ if(e.target.id==="payModal") e.currentTarget.classList.remove("show"); };
document.getElementById("digToggle").onclick=()=>{ document.getElementById("digModal").classList.add("show"); renderDig(); };
document.getElementById("digClose").onclick=()=>{ document.getElementById("digModal").classList.remove("show"); };
document.getElementById("digModal").onclick=(e)=>{ if(e.target.id==="digModal") e.currentTarget.classList.remove("show"); };
const ACHIEVEMENT_DEFS = [
  {key:"firstWin", ja:"はじめてのミミック捕獲", en:"First Catch"},
  {key:"jackpot", ja:"プレゼントを見つけた", en:"Jackpot Hunter"},
  {key:"multiline", ja:"マルチライン職人", en:"Multi-Line Master"},
  {key:"richPlayer", ja:"白金貨の袋", en:"Platinum Pouch"},
  {key:"jungle", ja:"ジャングルの奥へ", en:"Into the Jungle"},
  {key:"allSymbols", ja:"ミミック図鑑コンプリート", en:"Mimic Compendium"},
  {key:"spins100", ja:"百戦錬磨", en:"Seasoned Spinner"},
  {key:"streak5", ja:"不屈の連勝", en:"Unstoppable Streak"},
  {key:"megaWin", ja:"メガウィン達成", en:"Mega Winner"},
  {key:"bottleUsed", ja:"ラッキードリンカー", en:"Lucky Drinker"},
  {key:"digMaster", ja:"発掘マスター", en:"Dig Master"},
  {key:"bonusHunter", ja:"ボーナスハンター", en:"Bonus Hunter"},
  {key:"mysteryRich", ja:"ミステリー成金", en:"Mystery Fortune"},
  {key:"starMage", ja:"星屑の魔術師", en:"Star Mage"},
  {key:"megaRich", ja:"大富豪", en:"Tycoon"},
  {key:"hallowFound", ja:"聖なる輝き", en:"Blessed Find"},
  {key:"evilTwins", ja:"邪悪な双子", en:"Evil Twins"},
  {key:"spins500", ja:"スロット古参兵", en:"Slot Veteran"},
  {key:"doubleTrouble", ja:"ダブルトラブル", en:"Double Trouble"},
];
function renderAchBubble(){
  const ach = state.achievements||{};
  const unlockedCount = ACHIEVEMENT_DEFS.filter(d=>ach[d.key]).length;
  let html = `<span class="ach-title">${state.lang==="en"?`Achievements (${unlockedCount}/${ACHIEVEMENT_DEFS.length})`:`実績 (${unlockedCount}/${ACHIEVEMENT_DEFS.length})`}</span>`;
  ACHIEVEMENT_DEFS.forEach(d=>{
    const got = !!ach[d.key];
    html += `<div class="${got?"":"ach-locked"}">${got?"★":"☆"} ${state.lang==="en"?d.en:d.ja}</div>`;
  });
  achBubble.innerHTML = html;
}
document.getElementById("grassTable").onclick=(e)=>{
  renderChatLog();
  const rect = e.currentTarget.getBoundingClientRect();
  chatPanel.style.top = (rect.bottom+6)+"px";
  chatPanel.style.left = Math.max(8, Math.min(window.innerWidth-190, rect.left-60))+"px";
  chatPanel.classList.toggle("show");
  achBubble.classList.remove("show");
};
document.getElementById("standSign").onclick=(e)=>{
  renderAchBubble();
  const rect = e.currentTarget.getBoundingClientRect();
  achBubble.style.top = (rect.bottom+6)+"px";
  achBubble.style.left = Math.max(8, rect.left-80)+"px";
  achBubble.classList.toggle("show");
};
document.addEventListener("click",(e)=>{
  if(achBubble.classList.contains("show") && e.target.id!=="standSign" && !achBubble.contains(e.target)){
    achBubble.classList.remove("show");
  }
  if(chatPanel.classList.contains("show") && e.target.id!=="grassTable" && !chatPanel.contains(e.target)){
    chatPanel.classList.remove("show");
  }
});
document.getElementById("infoBtn").onclick=()=>{ document.getElementById("infoModal").classList.add("show"); };
document.getElementById("infoClose").onclick=()=>{ document.getElementById("infoModal").classList.remove("show"); };
document.getElementById("infoModal").onclick=(e)=>{ if(e.target.id==="infoModal") e.currentTarget.classList.remove("show"); };

let digState={tiles:null};
function renderDig(){
  const now=Date.now();
  if(now < state.digCooldownUntil){ digRow.innerHTML=""; startDigCountdown(); return; }
  // Start the cooldown the moment a fresh round is opened (not on completion) so closing
  // the modal early can never be used to repeat-farm free digs.
  state.digCooldownUntil = now + 25000; saveState();
  digState.tiles = Array.from({length:6}, ()=>({done:false}));
  digRow.innerHTML=""; digCd.textContent="";
  digState.tiles.forEach((t,idx)=>{ const el=document.createElement("div"); el.className="digtile";
    const pk=document.createElement("img"); pk.className="spr"; pk.src=SPR.icon_pickaxe; pk.style.width="70%"; pk.style.height="70%";
    el.appendChild(pk); el.onclick=()=>digOne(idx,el); digRow.appendChild(el); });
}
function digOne(idx,el){
  if(digState.tiles[idx].done) return;
  digState.tiles[idx].done=true; el.classList.add("done"); sfxDig();
  state.totalDigs=(state.totalDigs||0)+1;
  const roll=Math.random(); let gain=0,iconKey="",foundBottle=false;
  if(roll<0.10){ gain=0; iconKey="icon_dirt"; }
  else if(roll<0.15){ foundBottle=true; iconKey="deco_bottle"; }
  else if(roll<0.68){ gain=5+Math.floor(Math.random()*36); iconKey="coin_copper"; }
  else if(roll<0.93){ gain=SILVER*(1+Math.floor(Math.random()*6)); iconKey="coin_silver"; }
  else { gain=SILVER*(5+Math.floor(Math.random()*11)); iconKey="coin_gold"; }
  const rev=document.createElement("img"); rev.className="spr rev"; rev.src=SPR[iconKey]; rev.style.width=foundBottle?"55%":"65%"; rev.style.height=foundBottle?"70%":"65%";
  el.innerHTML=""; el.appendChild(rev);
  if(foundBottle){ state.bottles=(state.bottles||0)+1; renderBottleUI(); saveState(); sfxGrab(); showToast(state.lang==="en"?"Found a Lucky Bottle!":"ラッキーな瓶を発見!"); }
  else if(gain>0){ state.balance+=gain; renderBalance(); saveState(); if(gain>=SILVER) sfxGrab(); else sfxCoin(0.8); }
  if(digState.tiles.every(t=>t.done)){ setTimeout(startDigCountdown,600); }
}
let digTimerId=null;
function startDigCountdown(){
  clearInterval(digTimerId);
  digTimerId=setInterval(()=>{ const remain=state.digCooldownUntil-Date.now();
    if(remain<=0){ clearInterval(digTimerId); digCd.textContent=""; renderDig(); return; }
    digCd.innerHTML = state.lang==="en" ? `Next dig in ${Math.ceil(remain/1000)}s` : `次の発掘まで ${Math.ceil(remain/1000)}秒`;
  }, 250);
}

function screenFlash(color,ms){
  // gentle edge vignette pulse instead of a full bright screen wash - kinder on the eyes
  flashlayer.style.background = `radial-gradient(ellipse 60% 55% at 50% 50%, transparent 45%, ${color} 140%)`;
  flashlayer.style.transition="none"; flashlayer.style.opacity="0.38";
  requestAnimationFrame(()=>{ flashlayer.style.transition=`opacity ${Math.max(ms,500)}ms ease-out`; flashlayer.style.opacity="0"; });
}
function shakeCabinet(size){ cabinet.classList.remove("shake-sm","shake-md","shake-lg"); void cabinet.offsetWidth; cabinet.classList.add(size); setTimeout(()=>cabinet.classList.remove(size),650); }
function spawnParticles(kind,count){
  const cabRect=cabinet.getBoundingClientRect();
  for(let i=0;i<count;i++){
    const p=document.createElement("div"); p.className="particle";
    const startX=cabRect.left+Math.random()*cabRect.width;
    const dur=1.2+Math.random()*1.4, delay=Math.random()*0.5;
    if(kind==="snow"){ p.style.cssText=`left:${startX}px;top:${cabRect.top-10}px;width:6px;height:6px;border-radius:50%;background:#fff;opacity:.95;box-shadow:0 0 4px #fff;`;
      p.animate([{transform:`translate(0,0)`},{transform:`translate(${(Math.random()-0.5)*100}px, ${cabRect.height+40}px)`}],{duration:dur*1000,delay:delay*1000,easing:"linear",fill:"forwards"});
    } else if(kind==="leaf"){ p.style.cssText=`left:${startX}px;top:${cabRect.top-10}px;width:11px;height:7px;border-radius:0 60% 0 60%;background:#5fa63d;opacity:.95;`;
      p.animate([{transform:`translate(0,0) rotate(0deg)`},{transform:`translate(${(Math.random()-0.5)*160}px, ${cabRect.height+40}px) rotate(${360*(Math.random()>.5?1:-1)}deg)`}],{duration:dur*1000,delay:delay*1000,easing:"ease-in",fill:"forwards"});
    } else if(kind==="spore"){ p.style.cssText=`left:${startX}px;top:${cabRect.top+cabRect.height*0.3}px;width:6px;height:6px;border-radius:50%;background:#b06bd6;box-shadow:0 0 8px #b06bd6;opacity:.95;`;
      p.animate([{transform:`translate(0,0)`,opacity:1},{transform:`translate(${(Math.random()-0.5)*140}px, ${(Math.random()-0.5)*200}px)`,opacity:0}],{duration:dur*1000,delay:delay*1000,easing:"ease-out",fill:"forwards"});
    } else if(kind==="blood"){ p.style.cssText=`left:${startX}px;top:${cabRect.top-10}px;width:5px;height:11px;border-radius:50% 50% 50% 50% / 60% 60% 40% 40%;background:#c81f3a;opacity:.95;box-shadow:0 0 5px #c81f3a;`;
      p.animate([{transform:`translate(0,0)`},{transform:`translate(${(Math.random()-0.5)*40}px, ${cabRect.height+40}px)`}],{duration:(dur*0.7)*1000,delay:delay*1000,easing:"cubic-bezier(.5,0,1,1)",fill:"forwards"});
    } else if(kind==="spark"){ const col=["#ffb3e6","#b3e6ff","#c8ffb3","#fff2b3"][i%4];
      p.style.cssText=`left:${startX}px;top:${cabRect.top+cabRect.height*0.35}px;width:5px;height:5px;border-radius:50%;background:${col};box-shadow:0 0 8px ${col};opacity:1;`;
      p.animate([{transform:`translate(0,0) scale(1)`,opacity:1},{transform:`translate(${(Math.random()-0.5)*220}px, ${(Math.random()-0.5)*220}px) scale(.2)`,opacity:0}],{duration:dur*1000,delay:delay*1000,easing:"ease-out",fill:"forwards"});
    } else if(kind==="coin"){ p.style.cssText=`left:${startX}px;top:${cabRect.top+cabRect.height*0.4}px;width:9px;height:9px;border-radius:50%;background:#e8c14a;box-shadow:inset -1px -1px 0 rgba(0,0,0,.4);opacity:1;`;
      p.animate([{transform:`translate(0,0) rotateY(0deg)`,opacity:1},{transform:`translate(${(Math.random()-0.5)*80}px, ${cabRect.height+40}px) rotateY(900deg)`,opacity:.9}],{duration:dur*1000,delay:delay*1000,easing:"cubic-bezier(.4,0,.8,1)",fill:"forwards"});
    } else if(kind==="confetti"){ const col=["#ff5a6e","#ffd85a","#5affa0","#5ac8ff","#c85aff"][i%5];
      p.style.cssText=`left:${startX}px;top:${cabRect.top-10}px;width:7px;height:10px;background:${col};opacity:1;`;
      p.animate([{transform:`translate(0,0) rotate(0deg)`,opacity:1},{transform:`translate(${(Math.random()-0.5)*160}px, ${cabRect.height+40}px) rotate(${720*(Math.random()>.5?1:-1)}deg)`,opacity:.9}],{duration:dur*1000,delay:delay*1000,easing:"ease-in",fill:"forwards"});
    } else if(kind==="fragment"){
      const keys=["mimic_gold","mimic_wood","mimic_shadow","present_chest","present_reveal"];
      const cx=cabRect.left+cabRect.width/2, cy=cabRect.top+cabRect.height/2;
      p.style.cssText=`left:${cx}px;top:${cy}px;width:22px;height:22px;`;
      const im=document.createElement("img"); im.src=SPR[keys[i%keys.length]]; im.className="spr"; im.style.width="100%"; im.style.height="100%"; p.appendChild(im);
      const ang=Math.random()*Math.PI*2, dist=80+Math.random()*160;
      p.animate([{transform:`translate(-50%,-50%) rotate(0deg) scale(1)`,opacity:1},{transform:`translate(${Math.cos(ang)*dist-50}%, ${Math.sin(ang)*dist-50}%) rotate(${(Math.random()>.5?1:-1)*540}deg) scale(.6)`,opacity:0}],{duration:(dur*1.1)*1000,delay:delay*1000,easing:"cubic-bezier(.2,.7,.3,1)",fill:"forwards"});
    } else if(kind==="tree"){
      const sx = Math.random()*window.innerWidth;
      p.style.cssText=`left:${sx}px;top:-80px;width:34px;height:70px;`;
      const im=document.createElement("img"); im.src=SPR.deco_tree; im.className="spr"; im.style.width="100%"; im.style.height="100%"; im.style.objectFit="contain"; p.appendChild(im);
      const dur2=1.1+Math.random()*0.6;
      p.animate([{transform:`translateY(0) rotate(${(Math.random()-0.5)*30}deg)`,opacity:1},{transform:`translateY(${window.innerHeight+120}px) rotate(${(Math.random()-0.5)*60}deg)`,opacity:.9}],{duration:dur2*1000,delay:(Math.random()*0.4)*1000,easing:"cubic-bezier(.5,0,.9,1)",fill:"forwards"});
    } else if(kind==="rainbow"){
      p.className="rainbowp"; p.style.left=startX+"px"; p.style.top=(cabRect.top+cabRect.height*0.4)+"px";
      const img=document.createElement("img"); img.src=SPR.cursor; img.className="spr"; img.style.width="100%"; img.style.height="100%"; p.appendChild(img);
      const ang=Math.random()*Math.PI*2, dist=60+Math.random()*120;
      p.animate([{transform:`translate(0,0) rotate(0deg) scale(0.5)`,opacity:1},{transform:`translate(${Math.cos(ang)*dist}px, ${Math.sin(ang)*dist}px) rotate(${360*(Math.random()>.5?1:-1)}deg) scale(1.1)`,opacity:0}],{duration:dur*1000,delay:delay*1000,easing:"ease-out",fill:"forwards"});
    }
    fxlayer.appendChild(p); setTimeout(()=>p.remove(), (dur+delay+0.3)*1000);
  }
}
let bannerQueue=[]; let bannerBusy=false;
function showBanner(text,ms){
  bannerQueue.push({text,ms});
  if(!bannerBusy) processBannerQueue();
}
function processBannerQueue(){
  if(bannerQueue.length===0){ bannerBusy=false; return; }
  bannerBusy=true;
  const {text,ms} = bannerQueue.shift();
  banner.textContent=text; banner.classList.remove("show"); void banner.offsetWidth; banner.classList.add("show");
  setTimeout(()=>{ banner.classList.remove("show"); setTimeout(processBannerQueue, 150); }, ms);
}
function drawLines(lineObjs){ lineSvg.innerHTML=""; lineObjs.forEach(line=>{ const pts=line.cells.map(([r,c])=>[(c+0.5)/3*100,(r+0.5)/3*100]);
  const d=`M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]} L${pts[2][0]},${pts[2][1]}`;
  const path=document.createElementNS("http://www.w3.org/2000/svg","path"); path.setAttribute("d",d); path.setAttribute("stroke",line.color); path.style.color=line.color; lineSvg.appendChild(path); }); }
function clearLines(){ lineSvg.innerHTML=""; }
function showBiome(id, ms){ const el=document.getElementById(id); el.classList.add("show"); setTimeout(()=>el.classList.remove("show"), ms); }

function showFloatingPayout(amount){
  const rect = reelwindowEl.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "floatpay rise";
  el.textContent = "+"+formatCoins(amount);
  el.style.left = (rect.left+rect.width/2)+"px";
  el.style.top = (rect.top+rect.height/2)+"px";
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 1450);
}
let toastTimer=null;
function showToast(text){
  toastText.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toast.classList.remove("show"), 3200);
}
function checkAchievements(wins, totalPayout, payoutRatio){
  if(!state.achievements) state.achievements = {};
  if(!state.symbolsWon) state.symbolsWon = {};
  const ach = state.achievements;
  let unlocked = null;
  wins.forEach(w=>{ state.symbolsWon[w.sym.id]=true; });
  if(!ach.firstWin){ ach.firstWin=true; unlocked = state.lang==="en"?"Achievement: First Catch!":"実績解除:はじめてのミミック捕獲!"; }
  if(wins.some(w=>w.sym.id==="present") && !ach.jackpot){ ach.jackpot=true; unlocked = state.lang==="en"?"Achievement: Jackpot Hunter!":"実績解除:プレゼントを見つけた!"; }
  if(wins.length>=3 && !ach.multiline){ ach.multiline=true; unlocked = state.lang==="en"?"Achievement: Multi-Line Master!":"実績解除:マルチライン職人!"; }
  if(state.balance>=PLATINUM && !ach.richPlayer){ ach.richPlayer=true; unlocked = state.lang==="en"?"Achievement: Platinum Pouch!":"実績解除:白金貨の袋!"; }
  if(wins.some(w=>w.sym.id==="jungle") && !ach.jungle){ ach.jungle=true; unlocked = state.lang==="en"?"Achievement: Into the Jungle!":"実績解除:ジャングルの奥へ!"; }
  if(SYMBOLS.every(s=>state.symbolsWon[s.id]) && !ach.allSymbols){ ach.allSymbols=true; unlocked = state.lang==="en"?"Achievement: Mimic Compendium Complete!":"実績解除:ミミック図鑑コンプリート!"; }
  if((state.totalSpins||0)>=100 && !ach.spins100){ ach.spins100=true; unlocked = state.lang==="en"?"Achievement: Seasoned Spinner!":"実績解除:百戦錬磨!"; }
  if(state.streak>=5 && !ach.streak5){ ach.streak5=true; unlocked = state.lang==="en"?"Achievement: Unstoppable Streak!":"実績解除:不屈の連勝!"; }
  if(payoutRatio>=100 && !ach.megaWin){ ach.megaWin=true; unlocked = state.lang==="en"?"Achievement: Mega Winner!":"実績解除:メガウィン達成!"; }
  if((state.totalDigs||0)>=50 && !ach.digMaster){ ach.digMaster=true; unlocked = state.lang==="en"?"Achievement: Dig Master!":"実績解除:発掘マスター!"; }
  if((state.freeSpinTriggers||0)>=5 && !ach.bonusHunter){ ach.bonusHunter=true; unlocked = state.lang==="en"?"Achievement: Bonus Hunter!":"実績解除:ボーナスハンター!"; }
  if((state.jackpotWins||0)>=1 && !ach.mysteryRich){ ach.mysteryRich=true; unlocked = state.lang==="en"?"Achievement: Mystery Fortune!":"実績解除:ミステリー成金!"; }
  if((state.manaUsed||0)>=1 && !ach.starMage){ ach.starMage=true; unlocked = state.lang==="en"?"Achievement: Star Mage!":"実績解除:星屑の魔術師!"; }
  if(state.balance>=10*PLATINUM && !ach.megaRich){ ach.megaRich=true; unlocked = state.lang==="en"?"Achievement: Tycoon!":"実績解除:大富豪!"; }
  if(wins.some(w=>w.sym.id==="hallowed") && !ach.hallowFound){ ach.hallowFound=true; unlocked = state.lang==="en"?"Achievement: Blessed Find!":"実績解除:聖なる輝き!"; }
  if(wins.some(w=>w.sym.id==="corrupt") && wins.some(w=>w.sym.id==="crimson") && !ach.evilTwins){ ach.evilTwins=true; unlocked = state.lang==="en"?"Achievement: Evil Twins!":"実績解除:邪悪な双子!"; }
  if((state.totalSpins||0)>=500 && !ach.spins500){ ach.spins500=true; unlocked = state.lang==="en"?"Achievement: Slot Veteran!":"実績解除:スロット古参兵!"; }
  if(wins.length===2 && !ach.doubleTrouble){ ach.doubleTrouble=true; unlocked = state.lang==="en"?"Achievement: Double Trouble!":"実績解除:ダブルトラブル!"; }
  if(unlocked){ showToast(unlocked); saveState(); }
}
let spinning=false;
function weightedFinalGrid(boost){
  const pool = manaPurifyNextSpin ? SYMBOLS.filter(s=>s.id!=="mimic") : SYMBOLS;
  const result=[]; for(let c=0;c<3;c++){ const col=[]; for(let r=0;r<3;r++){ const sym=pickSymbol(pool, boost); col.push({sym,variant:pickVariantIndex(sym)}); } result.push(col); } return result;
}
async function spin(){
  if(spinning) return;
  state.totalSpins=(state.totalSpins||0)+1;
  const isFree = freeSpinsRemaining>0;
  let bet;
  if(isFree){
    bet = lastRealBet;
  } else {
    bet = currentBet();
    if(state.balance<bet){ setMsg("所持金が足りません。下の「発掘」でコインを稼ごう","Not enough coins — try digging below!"); return; }
  }
  spinning=true; spinBtn.disabled=true; clearLines();
  const kakuActive = kakuhenRemaining>0;
  if(!isFree && !kakuActive){ state.pityCount=(state.pityCount||0)+1; }
  if(isFree){
    freeSpinsRemaining -= 1; updateFreeSpinBadge();
  } else {
    state.balance-=bet; renderBalance(); lastRealBet=bet;
    state.jackpotPool += Math.max(1, Math.floor(bet*JACKPOT_FEED_RATE)); renderJackpot();
  }
  setMsg(isFree?"フリースピン中…":"回転中…", isFree?"Free spin...":"Spinning...");
  cells.forEach(c=>c.el.classList.add("spinning"));
  const flickers=cells.map(cell=>setInterval(()=>{ const sym=pickSymbol(); cell.img.src=SPR[sym.chestVariants[pickVariantIndex(sym)]]; if(Math.random()<0.25) sfxTick(); },65));
  const finalGrid=weightedFinalGrid(kakuActive);
  if(manaPurifyNextSpin){ manaPurifyNextSpin=false; }
  const stopTimes=[700,1100,1600];
  // cells[] is built row-major (index = row*3 + col), so column c's three cells are at indices c, 3+c, 6+c — NOT c*3..c*3+2.
  await Promise.all([0,1,2].map(c=>new Promise(res=>{
    setTimeout(()=>{
      clearInterval(flickers[c]); clearInterval(flickers[3+c]); clearInterval(flickers[6+c]);
      for(let r=0;r<3;r++){ const cell=cellAt(r,c); cell.el.classList.remove("spinning");
        const {sym,variant}=finalGrid[c][r]; setCellChest(cell,sym,variant);
        cell.el.classList.add("shake"); setTimeout(()=>cell.el.classList.remove("shake"),350); }
      shakeCabinet("shake-sm"); sfxStop(); res();
    }, stopTimes[c]);
  })));
  await new Promise(r=>setTimeout(r,220));
  const wins = LINES.map(line=>{ const syms=line.cells.map(([r,c])=>finalGrid[c][r].sym.id);
    if(syms[0]===syms[1] && syms[1]===syms[2]){ const sym=finalGrid[line.cells[0][1]][line.cells[0][0]].sym; return {line,sym,payout:bet*sym.mult}; }
    return null; }).filter(Boolean);

  let scatterCount=0;
  for(let c=0;c<3;c++) for(let r=0;r<3;r++) if(finalGrid[c][r].sym.id===SCATTER_ID) scatterCount++;

  let jackpotWin=0;
  if(!isFree && Math.random()<JACKPOT_TRIGGER_CHANCE){ jackpotWin=state.jackpotPool; state.jackpotPool=JACKPOT_SEED; renderJackpot(); state.jackpotWins=(state.jackpotWins||0)+1; }

  let triggeredFreeSpins=false;
  if(scatterCount>=SCATTER_MIN){ freeSpinsRemaining+=FREE_SPINS_AWARD; triggeredFreeSpins=true; updateFreeSpinBadge(); state.freeSpinTriggers=(state.freeSpinTriggers||0)+1; }

  const bottleMultAtSpinTime = bottleBuffRemaining>0 ? 2 : 1;
  if(bottleBuffRemaining>0){ bottleBuffRemaining--; updateBottleBuffBadge(); renderBottleUI(); }

  const kakuMultAtSpinTime = kakuActive ? KAKU_MULT : 1;
  if(kakuActive){ kakuhenRemaining--; }

  if(wins.length || jackpotWin>0 || triggeredFreeSpins){
    await playWin(wins, {isFree, jackpotWin, triggeredFreeSpins, bet, bottleMultAtSpinTime, kakuMultAtSpinTime});
  } else {
    setMsg("擬態を見破れ…!","Spot the mimics...!");
    state.streak=0; updateStreakLine();
  }
  // bonus mode: never re-triggers while active; ends quietly after its last spin
  if(!kakuActive){
    if(wins.length>0 && state.streak===KAKU_STREAK_TRIGGER) startKakuhen(`${KAKU_STREAK_TRIGGER}連勝!確変突入`, `${KAKU_STREAK_TRIGGER}-win streak! Bonus mode`);
    else if((state.pityCount||0)>=PITY_LIMIT) startKakuhen("天井到達!確変突入","Pity reached! Bonus mode");
  } else if(kakuhenRemaining===0){
    showToast(state.lang==="en" ? "Bonus mode ended" : "確変終了");
  }
  updateKakuUI();
  spinBtn.disabled=false; spinning=false; saveState();
}

async function playWin(wins, extra){
  extra = extra||{};
  const isFree=!!extra.isFree, jackpotWin=extra.jackpotWin||0, triggeredFreeSpins=!!extra.triggeredFreeSpins;

  if(wins.length){
    reelwindowEl.classList.add("winpunch"); setTimeout(()=>reelwindowEl.classList.remove("winpunch"),380);
    // line-drawing overlay removed per user preference; wins are still shown via cell pop/flash/reveal
    const revealSet=new Map();
    wins.forEach(w=>w.line.cells.forEach(([r,c])=>revealSet.set(r+"_"+c,[r,c])));
    revealSet.forEach(([r,c])=>{ const cell=cellAt(r,c); cell.el.classList.add("popflash");
      cell.img.src=SPR[cell.sym.revealVariants[cell.variantIdx % cell.sym.revealVariants.length]];
      cell.el.classList.add("pop"); setTimeout(()=>{ cell.el.classList.remove("pop"); cell.el.classList.remove("popflash"); },650); });
    sfxPop();
    state.streak += 1;
  } else {
    state.streak = 0;
  }
  updateStreakLine();
  const streakMult = state.streak>=2 ? (1+Math.min(state.streak-1,10)*0.10) : 1;
  const freeMult = isFree ? FREE_SPINS_MULT : 1;
  const bottleMult = extra.bottleMultAtSpinTime || 1;
  const kakuMult = extra.kakuMultAtSpinTime || 1;
  let linePayout = Math.round(wins.reduce((s,w)=>s+w.payout,0) * streakMult * freeMult * bottleMult * kakuMult);
  const totalPayout = linePayout + jackpotWin;

  if(totalPayout>0) showFloatingPayout(totalPayout);
  let maxWait=700;
  const refBet = extra.bet || lastRealBet || 1;
  const payoutRatio = refBet>0 ? totalPayout/refBet : 0;
  let winTierBanner=null;
  if(payoutRatio>=100) winTierBanner = state.lang==="en"?"MEGA WIN!!!":"メガウィン!!!";
  else if(payoutRatio>=40) winTierBanner = state.lang==="en"?"HUGE WIN!!":"ヒュージウィン!!";
  else if(payoutRatio>=15) winTierBanner = state.lang==="en"?"BIG WIN!":"ビッグウィン!";
  else if(payoutRatio>=5) winTierBanner = state.lang==="en"?"NICE WIN!":"ナイスウィン!";
  if(winTierBanner){ showBanner(winTierBanner, payoutRatio>=40?2000:1300); maxWait = Math.max(maxWait, (payoutRatio>=40?2000:1300)+400); }
  if(wins.length){
    const uniqueSymbols=[...new Map(wins.map(w=>[w.sym.id,w.sym])).values()];
    const topSym=uniqueSymbols.reduce((a,b)=>a.tier>=b.tier?a:b);
    const flashColors={coin:"rgba(255,225,150,.6)",frost:"rgba(150,220,255,.6)",corrupt:"rgba(160,90,230,.6)",crimson:"rgba(230,60,80,.6)",hallow:"rgba(255,180,245,.6)",jungle:"rgba(100,210,80,.6)",jackpot:"rgba(255,225,140,.7)"};
    screenFlash(flashColors[topSym.fx]||"rgba(255,255,255,.4)", topSym.tier>=4?700:400);
    if(topSym.tier>=3) sfxBigReveal();

    const comboJa=wins.length>1?`${wins.length}ライン同時ヒット!`:"";
    const comboEn=wins.length>1?`${wins.length}-LINE COMBO!`:"";
    setMsg(uniqueSymbols.map(s=>s.nameJa).join("+")+` そろい! 合計+${formatCoins(totalPayout)}`, uniqueSymbols.map(s=>s.nameEn).join("+")+` match! Total +${formatCoins(totalPayout)}`, comboJa, comboEn);

    uniqueSymbols.forEach(sym=>{
      if(sym.fx==="coin"){ shakeCabinet("shake-sm"); spawnParticles("coin",14); sfxCoin(1); maxWait=Math.max(maxWait,700); }
      else if(sym.fx==="frost"){ shakeCabinet("shake-sm"); spawnParticles("snow",22); sfxCoin(1.3); maxWait=Math.max(maxWait,900); }
      else if(sym.fx==="corrupt"){ shakeCabinet("shake-md"); spawnParticles("spore",26); showBiome("bioCorrupt",1300); maxWait=Math.max(maxWait,1300); }
      else if(sym.fx==="crimson"){ shakeCabinet("shake-md"); spawnParticles("blood",26); showBiome("bioCrimson",1300); maxWait=Math.max(maxWait,1300); }
      else if(sym.fx==="hallow"){ shakeCabinet("shake-md"); spawnParticles("spark",30); showBiome("bioHallow",1300); maxWait=Math.max(maxWait,1300); }
      else if(sym.fx==="jungle"){ shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400);
        spawnParticles("tree",26); showBanner("JUNGLE MIMIC!!",1500);
        maxWait=Math.max(maxWait,1700); }
      else if(sym.fx==="jackpot"){ shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400);
        borderLights.classList.add("on");
        spawnParticles("confetti",40); spawnParticles("snow",24); spawnParticles("coin",24); spawnParticles("rainbow",8); spawnParticles("fragment",10);
        showBanner("★ JACKPOT ★",2400); sfxJackpot();
        setTimeout(()=>{ shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400); },260);
        setTimeout(()=>borderLights.classList.remove("on"),2600); maxWait=Math.max(maxWait,2600); }
    });
    if(wins.length>1) showBanner((state.lang==="en"?wins.length+"-LINE COMBO!":wins.length+"ライン コンボ!"), 1400);
  } else if(jackpotWin>0 || triggeredFreeSpins){
    setMsg(state.lang==="en"?"Bonus triggered!":"ボーナス発生!", state.lang==="en"?"Bonus triggered!":"ボーナス発生!");
  }

  if(jackpotWin>0){
    shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400);
    borderLights.classList.add("on");
    spawnParticles("confetti",50); spawnParticles("coin",40); spawnParticles("rainbow",10);
    showBanner(state.lang==="en"?"MYSTERY JACKPOT!!":"ミステリージャックポット!!",2600);
    sfxJackpot();
    setTimeout(()=>borderLights.classList.remove("on"),2800);
    maxWait=Math.max(maxWait,2800);
  }
  if(triggeredFreeSpins){
    setTimeout(()=>showBanner(state.lang==="en"?"FREE SPINS +5!":"フリースピン+5回!",1800), jackpotWin>0?900:0);
    showToast(state.lang==="en"?"Bonus! 5 Free Spins (x2) unlocked":"ボーナス!フリースピン5回(x2)獲得");
    maxWait=Math.max(maxWait, (jackpotWin>0?900:0)+1800);
  }

  state.balance += totalPayout; renderBalance();
  checkAchievements(wins, totalPayout, payoutRatio);
  await new Promise(r=>setTimeout(r, maxWait));
  clearLines();
}

spinBtn.onclick = spin;
