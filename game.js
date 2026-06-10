import RAPIER from '@dimforge/rapier2d-compat';
await RAPIER.init();
document.getElementById('boot').style.display = 'none';

// ================= setup / layout =================
const app = document.getElementById('app');
const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');
const PPM = 100;
const TOP_MARGIN_PX = 74;      // stones spawn from here (just under the score)
const CEILING_PX = 260;        // tower tops out here — kept well below the spawn line so there's room to slide a stone over
const BTN_PX = 118, WATER_PX = 64;
const DESCENT = 1.6;           // constant descent speed (kinematic — velocity is zeroed on release)
const SETTLE_VEL = 0.04, SETTLE_HOLD = 0.35, SETTLE_MAX = 3.0;

let W, H, DPR, floorYpx, floorYm, worldW;
function sizeCanvas(){
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = app.clientWidth; H = app.clientHeight;
  cvs.width = Math.round(W*DPR); cvs.height = Math.round(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
sizeCanvas();
worldW = W/PPM; floorYpx = H - BTN_PX - WATER_PX; floorYm = floorYpx/PPM;
const M2P = m => m*PPM;

// ================= small math / noise =================
const rnd = (a,b)=>a+Math.random()*(b-a);
const lerp=(a,b,t)=>a+(b-a)*t;
const clampn=(v,a,b)=>Math.max(a,Math.min(b,v));
const smoothstep=t=>{t=clampn(t,0,1);return t*t*(3-2*t);};
const mix=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
const rgb=(c,a=1)=>`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function hash(n){n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return((n^(n>>>16))>>>0)/4294967295;}
function noise1(x,s){const i=Math.floor(x),f=x-i;return lerp(hash(i+s*1013),hash(i+1+s*1013),smoothstep(f))*2-1;}

// ================= rock geometry =================
function convexHull(pts){const p=pts.slice().sort((a,b)=>a.x-b.x||a.y-b.y);const cr=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);const lo=[],hi=[];for(const q of p){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q);}for(let i=p.length-1;i>=0;i--){const q=p[i];while(hi.length>=2&&cr(hi[hi.length-2],hi[hi.length-1],q)<=0)hi.pop();hi.push(q);}lo.pop();hi.pop();return lo.concat(hi);}
function chaikin(poly,it){let p=poly;for(let k=0;k<it;k++){const o=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];o.push({x:a.x*0.75+b.x*0.25,y:a.y*0.75+b.y*0.25});o.push({x:a.x*0.25+b.x*0.75,y:a.y*0.25+b.y*0.75});}p=o;}return p;}
function pac(poly){let A=0,cx=0,cy=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];const c=p.x*q.y-q.x*p.y;A+=c;cx+=(p.x+q.x)*c;cy+=(p.y+q.y)*c;}A*=0.5;return{area:Math.abs(A),cx:cx/(6*A),cy:cy/(6*A)};}
function makeShape(){
  const baseR = rnd(0.44,0.70);
  const prog = Math.min(1, state.used/30);
  const round = Math.max(0, Math.min(0.85, prog*0.7 + rnd(-0.42,0.42)));
  const flat  = lerp(0.46,0.82,round) * rnd(0.94,1.06);
  const elong = lerp(1.5,1.14,round) * rnd(0.94,1.06);
  const n = 6 + Math.floor(rnd(0,4));
  const raw=[];
  for(let i=0;i<n;i++){ const a=i/n*Math.PI*2+rnd(-0.16,0.16); const rr=baseR*rnd(0.86,1.12); raw.push({x:Math.cos(a)*rr*elong, y:Math.sin(a)*rr*flat}); }
  let maxY=-1e9,minY=1e9; for(const p of raw){ maxY=Math.max(maxY,p.y); minY=Math.min(minY,p.y); }
  const cutY=lerp(minY,maxY,rnd(0.60,0.76));
  for(const p of raw){ if(p.y>cutY) p.y=cutY; }
  const rot=lerp(rnd(-0.3,0.3), rnd(0,Math.PI), round), cr=Math.cos(rot),sr=Math.sin(rot);
  for(const p of raw){ const x=p.x*cr-p.y*sr,y=p.x*sr+p.y*cr; p.x=x; p.y=y; }
  let poly=chaikin(convexHull(raw), 3);
  const c=pac(poly); poly=poly.map(p=>({x:p.x-c.cx,y:p.y-c.cy}));
  const area=pac(poly).area;
  const f=new Float32Array(poly.length*2); poly.forEach((p,i)=>{f[i*2]=p.x;f[i*2+1]=p.y;});
  return { verts:poly, flat32:f, area };
}

// ================= stone texture (pre-rendered once per stone) =================
const PALETTES=[
  [[143,137,121],[222,212,190],[92,90,79]],
  [[156,147,124],[228,216,191],[103,95,79]],
  [[120,124,109],[197,193,174],[76,82,71]],
  [[133,128,114],[209,202,182],[85,85,74]],
  [[176,162,134],[233,221,196],[114,101,80]],
  [[150,142,127],[224,214,193],[97,92,80]]
];
function buildStoneTexture(rock){
  const pad=7, P=PPM;
  const vpx=rock.verts.map(v=>({x:v.x*P,y:v.y*P}));
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  for(const p of vpx){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
  const sw=maxX-minX, sh=maxY-minY, ox=-minX+pad, oy=-minY+pad;
  const cv=document.createElement('canvas'); cv.width=Math.ceil(sw+pad*2); cv.height=Math.ceil(sh+pad*2);
  const t=cv.getContext('2d'); t.translate(ox,oy);
  t.beginPath(); vpx.forEach((p,i)=> i?t.lineTo(p.x,p.y):t.moveTo(p.x,p.y)); t.closePath();
  t.save(); t.clip();
  shadeStone(t, sw, sh, rock.seed, rock.pal);
  t.restore();
  t.beginPath(); vpx.forEach((p,i)=> i?t.lineTo(p.x,p.y):t.moveTo(p.x,p.y)); t.closePath();
  t.lineWidth=1.1; t.strokeStyle='rgba(70,62,46,0.16)'; t.stroke();
  rock.tex=cv; rock.texOX=ox; rock.texOY=oy;
}
function shadeStone(t, w, h, seed, pal){
  const W2=w, H2=h, fill=()=>t.fillRect(-W2,-H2,W2*2,H2*2);
  t.fillStyle=rgb(pal[0]); fill();
  t.save(); t.globalCompositeOperation='screen';
  let g=t.createRadialGradient(-W2*0.22,-H2*0.32,0,-W2*0.16,-H2*0.22,W2*0.5);
  g.addColorStop(0,'rgba(255,250,236,0.42)'); g.addColorStop(0.45,'rgba(255,250,236,0.15)'); g.addColorStop(1,'rgba(255,250,236,0)');
  t.fillStyle=g; fill(); t.restore();
  t.save(); t.globalCompositeOperation='multiply';
  g=t.createLinearGradient(-W2*0.35,-H2*0.40,W2*0.42,H2*0.35);
  g.addColorStop(0,'rgba(40,34,26,0)'); g.addColorStop(0.5,'rgba(55,45,32,0.06)'); g.addColorStop(0.78,'rgba(55,45,32,0.14)'); g.addColorStop(1,'rgba(40,34,26,0.24)');
  t.fillStyle=g; fill(); t.restore();
  t.save(); t.globalCompositeOperation='multiply';
  g=t.createRadialGradient(W2*0.18,H2*0.12,0,W2*0.18,H2*0.12,W2*0.46);
  g.addColorStop(0,'rgba(50,40,28,0.18)'); g.addColorStop(0.55,'rgba(50,40,28,0.07)'); g.addColorStop(1,'rgba(50,40,28,0)');
  t.fillStyle=g; fill(); t.restore();
  t.save(); t.globalCompositeOperation='multiply';
  g=t.createLinearGradient(0,-H2*0.05,0,H2*0.52);
  g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(0.7,'rgba(55,45,32,0.05)'); g.addColorStop(1,'rgba(55,45,32,0.17)');
  t.fillStyle=g; fill(); t.restore();
  let rand=mulberry32(seed+100); t.save(); t.globalCompositeOperation='multiply';
  for(let i=0;i<240;i++){ const x=lerp(-W2*0.48,W2*0.48,rand()),y=lerp(-H2*0.45,H2*0.45,rand());
    if((x*x)/((W2*0.5)**2)+(y*y)/((H2*0.46)**2)>1) continue;
    const r=lerp(5,20,rand()),a=lerp(0.006,0.022,rand()),c=rand()>0.5?pal[2]:mix(pal[0],pal[2],0.35);
    g=t.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,rgb(c,a)); g.addColorStop(1,rgb(c,0));
    t.fillStyle=g; t.beginPath(); t.arc(x,y,r,0,7); t.fill(); } t.restore();
  rand=mulberry32(seed+200); t.save(); t.globalCompositeOperation='multiply';
  for(let i=0;i<620;i++){ const x=lerp(-W2*0.5,W2*0.5,rand()),y=lerp(-H2*0.46,H2*0.46,rand());
    if((x*x)/((W2*0.51)**2)+(y*y)/((H2*0.47)**2)>1) continue;
    t.fillStyle=`rgba(42,38,30,${lerp(0.01,0.028,rand())})`; t.beginPath();
    t.ellipse(x,y,lerp(0.3,1.1,rand()),lerp(0.3,0.9,rand()),rand()*Math.PI,0,7); t.fill(); } t.restore();
  rand=mulberry32(seed+300); const sc=Math.floor(lerp(8,16,rand()));
  for(let i=0;i<sc;i++){ const y=lerp(-H2*0.28,H2*0.28,rand()),x=lerp(-W2*0.36,W2*0.26,rand());
    const len=lerp(W2*0.06,W2*0.20,rand()),ang=lerp(-0.42,0.30,rand()),a=lerp(0.03,0.10,rand());
    t.save(); t.translate(x,y); t.rotate(ang); t.beginPath(); t.moveTo(0,0);
    for(let j=1;j<=4;j++){ t.lineTo(len*j/4, noise1(j*0.9+i, seed+777)*2); }
    t.lineWidth=lerp(0.4,0.9,rand()); t.lineCap='round';
    t.strokeStyle=rand()>0.25?`rgba(255,250,232,${a})`:`rgba(45,40,32,${a*0.6})`; t.stroke(); t.restore(); }
}

// ================= rocks =================
let rocks = [];
const colToRock = new Map();
function addRock(x,y,ang,shape,dynamic){
  const bd=(dynamic?RAPIER.RigidBodyDesc.dynamic():RAPIER.RigidBodyDesc.kinematicPositionBased())
    .setTranslation(x,y).setRotation(ang).setCcdEnabled(true).setLinearDamping(0.7).setAngularDamping(1.6);
  const body=world.createRigidBody(bd);
  const col=world.createCollider(RAPIER.ColliderDesc.convexHull(shape.flat32).setFriction(1.8).setRestitution(0.0).setDensity(1.0), body);
  const rock={ body, col, verts:shape.verts, area:shape.area, seed:(Math.random()*1e9)|0, pal:PALETTES[(Math.random()*PALETTES.length)|0] };
  buildStoneTexture(rock);
  colToRock.set(col.handle, rock); rocks.push(rock);
  return rock;
}
function worldVerts(r){ const t=r.body.translation(),a=r.body.rotation(),c=Math.cos(a),s=Math.sin(a);
  return r.verts.map(v=>({x:t.x+v.x*c-v.y*s, y:t.y+v.x*s+v.y*c})); }
function maxVel(){ let m=0; for(const r of rocks){ if(r.body.bodyType()!==RAPIER.RigidBodyType.Dynamic) continue;
  const v=r.body.linvel(); m=Math.max(m, Math.hypot(v.x,v.y)+Math.abs(r.body.angvel())*0.3); } return m; }

// ============ stability (contact graph) ============
const tx=(p,t,r)=>{const c=Math.cos(r),s=Math.sin(r);return {x:t.x+p.x*c-p.y*s, y:t.y+p.x*s+p.y*c};};
function contactInfo(){
  const info=new Map();
  for(const r of rocks) info.set(r,{groundXs:[]});
  for(const r of rocks){ const rY=r.body.translation().y;
    world.contactPairsWith(r.col,(other)=>{ world.contactPair(r.col,other,(m,flipped)=>{
      if(!m||m.numContacts()===0) return;
      const isGround=other.handle===groundCol.handle; const otherRock=colToRock.get(other.handle);
      const otherY=otherRock?otherRock.body.translation().y:(isGround?Infinity:-Infinity);
      if(!(isGround||(otherRock&&otherY>rY+0.004))) return;
      const c1=flipped?other:r.col;
      for(let i=0;i<m.numContacts();i++){ const p=tx(m.localContactPoint1(i),c1.translation(),c1.rotation());
        if(isGround) info.get(r).groundXs.push(p.x); }
    }); }); }
  return info;
}
function stackBalance(info){
  let A=0,mx=0,fxs=[];
  for(const r of rocks){ if(state.active && r===state.active.rock) continue;
    const t=r.body.translation(); A+=r.area; mx+=t.x*r.area; for(const x of info.get(r).groundXs) fxs.push(x); }
  if(A===0||fxs.length===0) return null;
  const comX=mx/A, lo=Math.min(...fxs), hi=Math.max(...fxs), mid=(lo+hi)/2;
  const half=Math.max((hi-lo)/2, 0.22);
  const off=clampn((comX-mid)/half,-1,1);
  return { comX, lo, hi, mid, off, norm:1-Math.abs(off) };
}

// ================= state =================
const state = { phase:'aim', active:null, used:0, height:0, score:0, settleT:0, simT:0 };
const keys = new Set();
let dropQueued=false, moveHold=0, moveDir=0, rotHold=0, rotDir=0;
let best = parseInt(localStorage.getItem('balance_best_score')||'0',10) || null;
let branches=null, grass=null, treeGrowTime=0, lastBranch=0;
let sun={x:0,y:0,vx:0,vy:0,r:200};

function clearBoard(){ for(const r of rocks) world.removeRigidBody(r.body); rocks=[]; colToRock.clear(); ripples.length=0; }

function spawnRock(){
  const shape=makeShape();
  let topY=floorYm; for(const r of rocks) for(const v of worldVerts(r)) topY=Math.min(topY,v.y);
  let hw=0,hh=0; for(const v of shape.verts){ hw=Math.max(hw,Math.abs(v.x)); hh=Math.max(hh,Math.abs(v.y)); }
  const x=worldW/2, y=Math.min(topY-hh-0.15, TOP_MARGIN_PX/PPM+hh);
  const SLOW = 0.85;
  state.descentV = SLOW + (DESCENT - SLOW) * Math.min(1, state.used / 9);
  const rock=addRock(x,y,rnd(-0.3,0.3),shape,false);
  state.active={ rock, x, y, angle:rock.body.rotation(), hw, hh, shape };
  moveHold=0; moveDir=0; rotHold=0; rotDir=0; state.phase='aim';
}
function clampVel(){ for(const r of rocks){ if(r.body.bodyType()!==RAPIER.RigidBodyType.Dynamic) continue;
  const v=r.body.linvel(), sp=Math.hypot(v.x,v.y); if(sp>6){ const k=6/sp; r.body.setLinvel({x:v.x*k,y:v.y*k},true); }
  const w=r.body.angvel(); if(Math.abs(w)>14) r.body.setAngvel(Math.sign(w)*14,true); } }
function activeWorldVerts(a){ const c=Math.cos(a.angle),s=Math.sin(a.angle);
  return a.shape.verts.map(v=>({x:a.x+v.x*c-v.y*s, y:a.y+v.x*s+v.y*c})); }
function obstacleTopUnder(a){
  const av=activeWorldVerts(a); let minx=1e9,maxx=-1e9; for(const v of av){ minx=Math.min(minx,v.x); maxx=Math.max(maxx,v.x); }
  let top=floorYm;
  for(const r of rocks){ if(r===a.rock) continue; const rv=worldVerts(r); let rminx=1e9,rmaxx=-1e9,rtop=1e9;
    for(const v of rv){ rminx=Math.min(rminx,v.x); rmaxx=Math.max(rmaxx,v.x); rtop=Math.min(rtop,v.y); }
    if(rmaxx>minx&&rminx<maxx) top=Math.min(top,rtop); }
  return top;
}
function release(){ const a=state.active; a.rock.body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);
  a.rock.body.setLinvel({x:0,y:0},true); a.rock.body.setAngvel(0,true);
  state.active=null; state.used++; state.settleT=0; state.simT=0; state.phase='sim';
  treeGrowTime=performance.now(); lastBranch=(state.used%2===1)?0:1; }

// ================= main loop =================
let started=false;
let lastT=performance.now();
function frame(now){
  const dt=Math.min(0.033,(now-lastT)/1000); lastT=now;
  if(started){
   if(state.phase==='aim' && state.active){
      const a=state.active;
      const md=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0);
      if(md!==0){ if(md!==moveDir){moveDir=md;moveHold=0;} moveHold+=dt; a.x+=md*(0.45+Math.min(moveHold,0.75)/0.75*2.6)*dt; } else moveDir=0;
      const rd=(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0);
      if(rd!==0){ if(rd!==rotDir){rotDir=rd;rotHold=0;} rotHold+=dt; a.angle+=rd*(0.6+Math.min(rotHold,0.75)/0.75*2.0)*dt; } else rotDir=0;
      a.x=Math.max(a.hw+0.05,Math.min(worldW-a.hw-0.05,a.x));
      const av=activeWorldVerts(a); let low=-1e9; for(const v of av) low=Math.max(low,v.y);
      const gap=obstacleTopUnder(a)-low;
      if(dropQueued||gap<=0.03){ a.rock.body.setNextKinematicTranslation({x:a.x,y:a.y}); a.rock.body.setNextKinematicRotation(a.angle); world.step(); release(); }
      else { a.y+=Math.min(state.descentV*dt,gap-0.025); a.rock.body.setNextKinematicTranslation({x:a.x,y:a.y}); a.rock.body.setNextKinematicRotation(a.angle); world.step(); }
      dropQueued=false;
    } else {
      world.step(); clampVel();
      if(state.phase==='sim'){ state.simT+=dt; const v=maxVel();
        if(v<SETTLE_VEL){ state.settleT+=dt; } else { state.settleT=0; }
        if(state.settleT>SETTLE_HOLD || (state.simT>SETTLE_MAX && v<0.4)) finalizePlacement(); }
    }
   removeFallen();
  }
  updateWater(dt); updateSun(dt);
  if(started && state.phase!=='over'){
    state.score = computeScore();
    document.getElementById('sVal').textContent = state.score;
  }
  render();
  requestAnimationFrame(frame);
}

function finalizePlacement(){
  let topY=floorYm; for(const r of rocks) for(const v of worldVerts(r)) topY=Math.min(topY,v.y);
  spawnRipplesAtWater();
  if(rocks.length>0 && topY*PPM <= CEILING_PX) return reachedTop();
  spawnRock();
}
function computeScore(){
  const settled=rocks.filter(r=>!(state.active&&r===state.active.rock));
  if(settled.length===0){ state.height=0; return 0; }
  let topY=floorYm, ground=0;
  for(const r of settled){ let low=-1e9; for(const v of worldVerts(r)){ topY=Math.min(topY,v.y); low=Math.max(low,v.y); } if(low>=floorYm-0.05) ground++; }
  state.height=Math.max(0,Math.round((floorYm-topY)*100));
  if(state.height<=0) return 0;
  return Math.round( Math.pow(state.height,1.3) / Math.sqrt(settled.length) / Math.max(1,ground) * 0.5 );
}
function reachedTop(){
  state.phase='over';
  document.getElementById('ovStones').textContent=state.used;
  document.getElementById('over').classList.add('show');
}
function syncHud(){ document.getElementById('sVal').textContent=state.score; }

// ================= water (procedural) =================
let ripples=[]; let waterT=0;
function waterContactXs(){ const xs=[];
  for(const r of rocks){ let low=-1e9; for(const v of worldVerts(r)) low=Math.max(low,v.y);
    if(low >= floorYm-0.05) xs.push(r.body.translation().x*PPM); }
  return xs;
}
function spawnRipplesAtWater(){ for(const x of waterContactXs()) ripples.push({x, r:8, life:1}); }
function updateWater(dt){ waterT+=dt; if(waterT>2.1){ waterT=0; spawnRipplesAtWater(); }
  for(const rp of ripples){ rp.r+=34*dt; rp.life-=dt/5.5; } ripples=ripples.filter(rp=>rp.life>0); }

// ================= procedural background (built once) =================
let bgCanvas=null;
function buildBackground(){
  bgCanvas=document.createElement('canvas'); bgCanvas.width=Math.round(W*DPR); bgCanvas.height=Math.round(H*DPR);
  const b=bgCanvas.getContext('2d'); b.setTransform(DPR,0,0,DPR,0,0);
  let g=b.createRadialGradient(W*0.42,H*0.30,0,W*0.5,H*0.48,Math.max(W,H)*0.9);
  g.addColorStop(0,'#fbf6ea'); g.addColorStop(0.5,'#f2ebdb'); g.addColorStop(1,'#e7dcc7');
  b.fillStyle=g; b.fillRect(0,0,W,H);
  g=b.createRadialGradient(W*0.85,H*0.55,0,W*0.85,H*0.55,W*0.5);
  g.addColorStop(0,'rgba(255,253,247,0.5)'); g.addColorStop(1,'rgba(255,253,247,0)');
  b.fillStyle=g; b.fillRect(0,0,W,H);
  const rand=mulberry32(7); b.globalAlpha=0.025; b.fillStyle='#6f6a5c';
  for(let i=0;i<2600;i++) b.fillRect(rand()*W,rand()*H,1,1); b.globalAlpha=1;
}

// ---- drifting sun ----
function initSun(){
  sun.r=W*0.27; sun.x=rnd(W*0.18,W*0.82); sun.y=rnd(H*0.16,H*0.40);
  const ang=rnd(0,Math.PI*2), sp=rnd(2.4,4.2);
  sun.vx=Math.cos(ang)*sp; sun.vy=Math.sin(ang)*sp*0.4;
}
function updateSun(dt){
  sun.x+=sun.vx*dt; sun.y+=sun.vy*dt; const R=sun.r;
  if(sun.x<-R) sun.x=W+R; if(sun.x>W+R) sun.x=-R;
  if(sun.y<H*0.08){ sun.y=H*0.08; sun.vy=Math.abs(sun.vy); }
  if(sun.y>H*0.50){ sun.y=H*0.50; sun.vy=-Math.abs(sun.vy); }
}
function drawSun(){
  const g=ctx.createRadialGradient(sun.x,sun.y,0,sun.x,sun.y,sun.r);
  g.addColorStop(0,'rgba(255,250,238,0.72)'); g.addColorStop(0.42,'rgba(250,242,224,0.30)');
  g.addColorStop(0.8,'rgba(224,210,180,0.13)'); g.addColorStop(1,'rgba(224,210,180,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sun.x,sun.y,sun.r,0,7); ctx.fill();
}

// ---- procedural foliage ----
function leafShape(g,x,y,ang,len,wd,col){
  const c=Math.cos(ang),s=Math.sin(ang),ex=x+c*len,ey=y+s*len,px=-s,py=c;
  g.beginPath(); g.moveTo(x,y);
  g.quadraticCurveTo(x+c*len*0.5+px*wd, y+s*len*0.5+py*wd, ex,ey);
  g.quadraticCurveTo(x+c*len*0.5-px*wd, y+s*len*0.5-py*wd, x,y);
  g.fillStyle=col; g.fill();
}
function generateBranches(){
  const ay = TOP_MARGIN_PX + (floorYpx-TOP_MARGIN_PX)*0.34;
  branches = { left: makeBranch(-6, ay+rnd(-18,18), 1), right: makeBranch(W+6, ay+rnd(-18,18), -1) };
}
function makeBranch(baseX, baseY, dir){
  const rand=mulberry32((Math.random()*1e9)|0), segW=(W*0.42)/14, out=[];
  function grow(x,y,ang,steps,width){
    for(let i=0;i<steps;i++){
      ang += (rand()-0.5)*0.32;
      let dx=Math.cos(ang), dy=Math.sin(ang)-0.05;
      const L=Math.hypot(dx,dy); dx/=L; dy/=L; ang=Math.atan2(dy,dx);
      const seg=segW*lerp(0.8,1.15,rand());
      const nx=x+dx*seg, ny=y+dy*seg;
      const cx=x+dx*seg*0.5+(rand()-0.5)*7, cy=y+dy*seg*0.5+(rand()-0.5)*7;
      const side=(i%2===0)?1:-1, la=ang+side*lerp(0.7,1.05,rand()), ll=seg*lerp(1.4,2.2,rand());
      const lc=`rgba(${118+rand()*22|0},${134+rand()*16|0},${102+rand()*14|0},0.6)`;
      out.push({ x0:x,y0:y,cx,cy,x1:nx,y1:ny, w:Math.max(1,width), leaf:{x:nx,y:ny,ang:la,len:ll,wd:ll*0.28,col:lc} });
      x=nx; y=ny; width=Math.max(1,width-0.18);
      if(width>1.7 && i>=2 && i<steps-2 && rand()<0.36){
        grow(x, y, ang+(rand()>0.5?1:-1)*lerp(0.55,0.95,rand()), 3+Math.floor(rand()*3), width*0.72);
      }
    }
  }
  grow(baseX, baseY, dir>0 ? -0.18 : (Math.PI+0.18), 12, 3.0);
  return out;
}
function drawOneBranch(steps, n, animLast, growT){
  if(n<=0) return; ctx.save(); ctx.lineCap='round'; ctx.strokeStyle='rgba(108,122,96,0.5)';
  for(let i=0;i<n;i++){ const s=steps[i], t=(i===n-1&&animLast)?growT:1;
    ctx.beginPath(); ctx.moveTo(s.x0,s.y0);
    ctx.quadraticCurveTo(lerp(s.x0,s.cx,t),lerp(s.y0,s.cy,t),lerp(s.x0,s.x1,t),lerp(s.y0,s.y1,t));
    ctx.lineWidth=s.w; ctx.stroke(); }
  for(let i=0;i<n;i++){ const lf=steps[i].leaf, t=(i===n-1&&animLast)?growT:1; if(t<0.02) continue;
    leafShape(ctx, lf.x, lf.y, lf.ang, lf.len*t, lf.wd*t, lf.col); }
  ctx.restore();
}
function drawBranches(now){
  if(!branches) return;
  const leftN=Math.min(Math.ceil(state.used/2), branches.left.length);
  const rightN=Math.min(Math.floor(state.used/2), branches.right.length);
  const growT=smoothstep((now-treeGrowTime)/600);
  drawOneBranch(branches.left, leftN, lastBranch===0, growT);
  drawOneBranch(branches.right, rightN, lastBranch===1, growT);
}
// ---- tall grass in the bottom corners ----
function blade(g,bx,by,h,lean,w,col){
  const tx=bx+lean, ty=by-h, cx=bx+lean*0.4, cy=by-h*0.5;
  g.beginPath(); g.moveTo(bx-w,by);
  g.quadraticCurveTo(cx-w*0.3,cy,tx,ty);
  g.quadraticCurveTo(cx+w*0.3,cy,bx+w,by);
  g.closePath(); g.fillStyle=col; g.fill();
}
function generateGrass(){
  grass=[]; const rand=mulberry32((Math.random()*1e9)|0);
  for(const corner of [{x:W*0.06,dir:1},{x:W*0.94,dir:-1}]){
    const n=Math.floor(lerp(12,18,rand())), baseY=H-BTN_PX+8;
    for(let i=0;i<n;i++){
      const bx=corner.x+(rand()-0.5)*W*0.15, h=lerp(90,210,rand());
      const lean=corner.dir*lerp(6,42,rand())+(rand()-0.5)*26, w=lerp(2.2,4.8,rand());
      const col=`rgba(${104+rand()*30|0},${120+rand()*22|0},${86+rand()*22|0},${lerp(0.42,0.62,rand()).toFixed(2)})`;
      grass.push({ bx, by:baseY+(rand())*10, h, lean, w, col, phase:rand()*7, sway:lerp(2,6,rand()) });
    }
  }
}
function drawGrass(now){
  if(!grass) return;
  for(const bl of grass){ const s=Math.sin(now*0.0009+bl.phase)*bl.sway; blade(ctx, bl.bx, bl.by, bl.h, bl.lean+s, bl.w, bl.col); }
}

// ================= render =================
function render(){
  if(bgCanvas) ctx.drawImage(bgCanvas,0,0,W,H);
  drawSun();
  let wg=ctx.createLinearGradient(0,floorYpx-6,0,H);
  wg.addColorStop(0,'rgba(232,224,206,0)'); wg.addColorStop(0.10,'rgba(228,221,205,0.5)');
  wg.addColorStop(0.5,'rgba(216,208,190,0.62)'); wg.addColorStop(1,'rgba(206,197,177,0.72)');
  ctx.fillStyle=wg; ctx.fillRect(0,floorYpx-6,W,H-floorYpx+6);
  ctx.save(); ctx.beginPath(); ctx.rect(0,floorYpx,W,H-floorYpx); ctx.clip(); ctx.globalAlpha=0.16;
  for(const r of rocks) blitStone(r, true);
  if(state.active) blitStone(state.active.rock, true, state.active);
  ctx.globalAlpha=1; ctx.restore();
  ctx.save();
  for(const rp of ripples){ const a=rp.life*Math.min(1,rp.r/20);
    ctx.lineWidth=1.7; ctx.strokeStyle=`rgba(255,255,255,${a*0.95})`;
    ctx.beginPath(); ctx.ellipse(rp.x,floorYpx+2,rp.r,rp.r*0.24,0,0,7); ctx.stroke();
    ctx.lineWidth=1.3; ctx.strokeStyle=`rgba(138,130,106,${a*0.6})`;
    ctx.beginPath(); ctx.ellipse(rp.x,floorYpx+5,rp.r*0.9,rp.r*0.22,0,0,7); ctx.stroke(); }
  ctx.restore();
  for(const r of rocks) drawStone(r);
  if(state.active) drawStone(state.active.rock, state.active);
  const now=performance.now();
  drawGrass(now);
  drawBranches(now);
}
function blitStone(r, reflect, active){
  const t=active? {x:active.x,y:active.y} : r.body.translation();
  const ang=active? active.angle : r.body.rotation();
  const sx=M2P(t.x), sy=M2P(t.y);
  ctx.save();
  if(reflect){ ctx.translate(sx, 2*floorYpx - sy); ctx.scale(1,-1); ctx.rotate(ang); }
  else { ctx.translate(sx,sy); ctx.rotate(ang); }
  ctx.drawImage(r.tex, -r.texOX, -r.texOY);
  ctx.restore();
}
function drawStone(r, active){ blitStone(r, false, active); }

// ================= input =================
window.addEventListener('keydown', e=>{
  if(!started){ if(e.key===' '||e.key==='Enter'){ beginGame(); e.preventDefault(); } return; }
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
  if(e.key===' ') dropQueued=true;
  if(e.key==='r'||e.key==='R') reset();
  keys.add(e.key);
});
window.addEventListener('keyup', e=>keys.delete(e.key));

function holdBtn(id, key){ const el=document.getElementById(id);
  const down=e=>{ e.preventDefault(); keys.add(key); };
  const up=e=>{ keys.delete(key); };
  el.addEventListener('pointerdown',down); el.addEventListener('pointerup',up);
  el.addEventListener('pointerleave',up); el.addEventListener('pointercancel',up);
}
holdBtn('btnLeft','ArrowLeft'); holdBtn('btnRight','ArrowRight');
holdBtn('btnRotL','ArrowUp'); holdBtn('btnRotR','ArrowDown');
document.getElementById('btnDrop').addEventListener('pointerdown', e=>{ e.preventDefault(); dropQueued=true; });
window.addEventListener('pointerup', ()=>{ keys.delete('ArrowLeft'); keys.delete('ArrowRight'); keys.delete('ArrowUp'); keys.delete('ArrowDown'); });

document.getElementById('ovBtn').addEventListener('click', reset);

const introEl=document.getElementById('intro');
function beginGame(){ if(started) return; started=true; dropQueued=false; lastT=performance.now(); introEl.classList.remove('show'); }
document.getElementById('introBtn').addEventListener('click', beginGame);
introEl.addEventListener('pointerdown', e=>{ if(e.target===introEl) beginGame(); });

// ================= world / lifecycle =================
let world, groundCol;
function buildWorld(){
  world=new RAPIER.World({x:0,y:5.0});
  const g=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(worldW/2, floorYm+0.5));
  groundCol=world.createCollider(RAPIER.ColliderDesc.cuboid(worldW/2,0.5).setFriction(1.8), g);
}
function removeFallen(){
  for(let i=rocks.length-1;i>=0;i--){ const r=rocks[i];
    if(state.active && r===state.active.rock) continue;
    const t=r.body.translation();
    if(t.y > floorYm+1.0 || t.x < -1.0 || t.x > worldW+1.0){
      world.removeRigidBody(r.body); colToRock.delete(r.col.handle); rocks.splice(i,1);
    }
  }
}
function reset(){
  buildWorld();
  rocks=[]; colToRock.clear(); ripples.length=0;
  state.phase='aim'; state.active=null; state.used=0; state.height=0; state.score=0; state.settleT=0; state.simT=0;
  dropQueued=false; treeGrowTime=0; lastBranch=0;
  generateBranches(); generateGrass(); initSun();
  document.getElementById('over').classList.remove('show');
  syncHud(); spawnRock();
}

window.addEventListener('resize', ()=>{ sizeCanvas(); buildBackground(); });

buildBackground();
reset();
requestAnimationFrame(frame);
