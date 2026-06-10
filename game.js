import RAPIER from '@dimforge/rapier2d-compat';
await RAPIER.init();
document.getElementById('boot').style.display = 'none';

// ================= setup / layout =================
const app = document.getElementById('app');
const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');
const PPM = 100;
const CEILING_PX = 300;
const BTN_PX = 90, FLOOR_GAP = 0;
const DESCENT = 1.6;
const SETTLE_VEL = 0.04, SETTLE_HOLD = 0.35, SETTLE_MAX = 3.0;

let W, H, DPR, floorYpx, floorYm, worldW;
function sizeCanvas(){
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = app.clientWidth; H = app.clientHeight;
  cvs.width = Math.round(W*DPR); cvs.height = Math.round(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
sizeCanvas();
worldW = W/PPM; floorYpx = H - BTN_PX - FLOOR_GAP; floorYm = floorYpx/PPM;
const M2P = m => m*PPM;

// ================= math =================
const rnd = (a,b)=>a+Math.random()*(b-a);
const lerp=(a,b,t)=>a+(b-a)*t;
const clampn=(v,a,b)=>Math.max(a,Math.min(b,v));
const smoothstep=t=>{t=clampn(t,0,1);return t*t*(3-2*t);};
const rgb=(c,a=1)=>`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function hash(n){n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return((n^(n>>>16))>>>0)/4294967295;}
function noise1(x,s){const i=Math.floor(x),f=x-i;return lerp(hash(i+s*1013),hash(i+1+s*1013),smoothstep(f))*2-1;}

// ================= perlin noise =================
function makePermutation(sv){
  const r=mulberry32(sv|0),p=Array.from({length:256},(_,i)=>i);
  for(let i=255;i>0;i--){const j=Math.floor(r()*(i+1));[p[i],p[j]]=[p[j],p[i]];}
  return p.concat(p);
}
function pFade(t){return t*t*t*(t*(t*6-15)+10);}
function pGrad(h,x,y){const u=h<2?x:y,v=h<2?y:x;return((h&1)?-u:u)+((h&2)?-2*v:2*v);}
function perlin2(x,y,pm){
  const xi=Math.floor(x)&255,yi=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y);
  const u=pFade(xf),v=pFade(yf);
  const aa=pm[pm[xi]+yi],ab=pm[pm[xi]+yi+1],ba=pm[pm[xi+1]+yi],bb=pm[pm[xi+1]+yi+1];
  return lerp(lerp(pGrad(aa,xf,yf),pGrad(ba,xf-1,yf),u),lerp(pGrad(ab,xf,yf-1),pGrad(bb,xf-1,yf-1),u),v);
}
function fbm2(x,y,pm,oct){
  let v=0,a=0.5,f=1,m=0;
  for(let i=0;i<oct;i++){v+=a*perlin2(x*f,y*f,pm);m+=a;a*=0.5;f*=2;}
  return v/m;
}
let bgPerm=makePermutation(42);

// ================= block geometry: irregular convex polygons =================
// Andrew's monotone chain convex hull. In/out are {x,y} arrays; output is CCW.
function convexHull(pts){
  pts = pts.slice().sort((a,b)=> a.x-b.x || a.y-b.y);
  const n=pts.length; if(n<3) return pts;
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower=[];
  for(const p of pts){ while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],p)<=0) lower.pop(); lower.push(p); }
  const upper=[];
  for(let i=n-1;i>=0;i--){ const p=pts[i]; while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],p)<=0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}
// Finish a block from a raw point set: jitter, hull (guaranteed convex), recentre on
// centroid, compute area. The same vertices drive both rendering and the physics
// collider, so what you see is exactly what collides.
function hullShape(pts){
  let bx0=1e9,bx1=-1e9,by0=1e9,by1=-1e9;
  for(const p of pts){ bx0=Math.min(bx0,p.x); bx1=Math.max(bx1,p.x); by0=Math.min(by0,p.y); by1=Math.max(by1,p.y); }
  const j=Math.min(bx1-bx0,by1-by0)*0.06;
  for(const p of pts){ p.x+=rnd(-j,j); p.y+=rnd(-j,j); }
  const hull=convexHull(pts);
  let cx=0,cy=0; for(const p of hull){ cx+=p.x; cy+=p.y; } cx/=hull.length; cy/=hull.length;
  const outline=hull.map(p=>({x:p.x-cx, y:p.y-cy}));
  let area=0; for(let i=0;i<outline.length;i++){ const a=outline[i],b=outline[(i+1)%outline.length]; area+=a.x*b.y-b.x*a.y; }
  area=Math.abs(area)*0.5;
  const flat=new Float32Array(outline.length*2);
  for(let i=0;i<outline.length;i++){ flat[i*2]=outline[i].x; flat[i*2+1]=outline[i].y; }
  return {outline, hull:flat, area};
}
// Rectangle (w×h) with up to `maxChamfer` corners cut back → 4–6 sides.
function rectPts(w,h,maxChamfer){
  const hw=w/2, hh=h/2;
  const corners=[{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}];
  const nCh=(Math.random()*(maxChamfer+1))|0;
  const chosen=[0,1,2,3].sort(()=>Math.random()-0.5).slice(0,nCh);
  const minDim=Math.min(hw,hh), pts=[];
  for(let i=0;i<4;i++){
    const c=corners[i];
    if(chosen.includes(i)){
      const prev=corners[(i+3)%4], next=corners[(i+1)%4];
      const cut=minDim*rnd(0.30,0.55);
      const tp={x:prev.x-c.x,y:prev.y-c.y}, tn={x:next.x-c.x,y:next.y-c.y};
      const lp=Math.hypot(tp.x,tp.y), ln=Math.hypot(tn.x,tn.y);
      pts.push({x:c.x+tp.x/lp*cut, y:c.y+tp.y/lp*cut});
      pts.push({x:c.x+tn.x/ln*cut, y:c.y+tn.y/ln*cut});
    } else pts.push({x:c.x,y:c.y});
  }
  return pts;
}
// Wedge: a 4-sided trapezoid — wide base, narrower offset top with a blunted corner.
function wedgePts(w,h){
  const hw=w/2, hh=h/2;
  const topW=hw*rnd(0.32,0.60), off=hw*rnd(-0.38,0.38);
  return [{x:-hw,y:hh},{x:hw,y:hh},{x:off+topW,y:-hh},{x:off-topW,y:-hh}];
}
// Right-angle ramp, blunted to a 4-sided right trapezoid: full base, vertical right
// side, slanted left side, and a short top edge (the blunted apex).
function rampPts(w,h){
  const hw=w/2, hh=h/2;
  const topL = -hw + w*rnd(0.42,0.72);   // top-left x — leaves a slanted left side
  return [{x:-hw,y:hh},{x:hw,y:hh},{x:hw,y:-hh},{x:topL,y:-hh}];
}
const flipY = p=>({x:p.x,y:-p.y}), flipX = p=>({x:-p.x,y:p.y});
function makeShape(){
  // first piece: large, flat, stable base (square corners)
  if(state.used===0) return hullShape(rectPts(rnd(1.6,1.9), rnd(0.40,0.48), 0));
  const r=Math.random();
  let pts;
  if(r<0.26){                       // slab — long & thin (random horizontal/vertical)
    let w=rnd(0.70,1.15), h=w*rnd(0.16,0.28);
    if(Math.random()<0.4){ const t=w; w=h; h=t; }
    pts=rectPts(w,h,1);
  } else if(r<0.46){                // brick — moderate oblong
    let w=rnd(0.52,0.82), h=w*rnd(0.45,0.7);
    if(Math.random()<0.5){ const t=w; w=h; h=t; }
    pts=rectPts(w,h,2);
  } else if(r<0.62){                // chunky — near-square, often 5–6 sides
    const s=rnd(0.36,0.56);
    pts=rectPts(s, s*rnd(0.85,1.0), 2);
  } else if(r<0.84){                // wedge / trapezoid
    pts=wedgePts(rnd(0.48,0.85), rnd(0.34,0.62));
    if(Math.random()<0.5) pts=pts.map(flipY);
  } else {                          // ramp — right trapezoid
    pts=rampPts(rnd(0.48,0.78), rnd(0.34,0.60));
    if(Math.random()<0.5) pts=pts.map(flipX);
    if(Math.random()<0.5) pts=pts.map(flipY);
  }
  // global size multiplier — wide range so block areas vary a lot (~10× spread)
  const s=rnd(0.50,1.55);
  pts=pts.map(p=>({x:p.x*s, y:p.y*s}));
  return hullShape(pts);
}

// ================= block texture =================
function buildBlockTexture(rock){
  const P=PPM, pad=6;
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  for(const v of rock.outline){minX=Math.min(minX,v.x*P);maxX=Math.max(maxX,v.x*P);minY=Math.min(minY,v.y*P);maxY=Math.max(maxY,v.y*P);}
  const sw=Math.ceil(maxX-minX)+pad*2, sh=Math.ceil(maxY-minY)+pad*2;
  const ox=pad-minX, oy=pad-minY;
  const cv=document.createElement('canvas'); cv.width=sw; cv.height=sh;
  const t=cv.getContext('2d');
  const img=t.createImageData(sw,sh); const data=img.data;
  const pm=makePermutation(Math.random()*1e6|0);
  const base=125+Math.random()*40;  // 125–165, darker than background
  for(let py=0;py<sh;py++){
    for(let px=0;px<sw;px++){
      const wx=(px-ox)/P, wy=(py-oy)/P;  // world coords (meters)
      const fn=fbm2(wx*8.0+50,   wy*8.0+50,   pm, 4);
      const gr=fbm2(wx*28.0+200, wy*28.0+200, pm, 3);
      const hi=fbm2(wx*70.0+600, wy*70.0+600, pm, 2);
      let v=base + fn*14 + gr*8 + hi*4;
      const i=(py*sw+px)*4;
      data[i]  =Math.max(0,Math.min(255,v+1));
      data[i+1]=Math.max(0,Math.min(255,v+1));
      data[i+2]=Math.max(0,Math.min(255,v-1));
      data[i+3]=255;
    }
  }
  t.putImageData(img,0,0);
  rock.tex=cv; rock.texOX=ox; rock.texOY=oy;
}

// ================= blocks =================
let rocks = [];
const colToRock = new Map();
function addRock(x,y,ang,shape,dynamic){
  const bd=(dynamic?RAPIER.RigidBodyDesc.dynamic():RAPIER.RigidBodyDesc.kinematicPositionBased())
    .setTranslation(x,y).setRotation(ang).setCcdEnabled(true).setLinearDamping(0.9).setAngularDamping(1.8);
  const body=world.createRigidBody(bd);
  const desc=(RAPIER.ColliderDesc.convexHull(shape.hull) || RAPIER.ColliderDesc.ball(0.2))
    .setFriction(1.8).setRestitution(0.0).setDensity(1.0);
  const col=world.createCollider(desc,body);
  // Cached shapes for descent/overlap queries (full + slightly shrunk so merely
  // touching a neighbour isn't treated as overlap). Built once, reused each frame.
  const shrunk=new Float32Array(shape.hull.length);
  for(let i=0;i<shrunk.length;i++) shrunk[i]=shape.hull[i]*0.90;
  const physShape=new RAPIER.ConvexPolygon(shape.hull, false);
  const queryShape=new RAPIER.ConvexPolygon(shrunk, false);
  const rock={body,col,outline:shape.outline,hull:shape.hull,area:shape.area,physShape,queryShape};
  colToRock.set(col.handle,rock);
  buildBlockTexture(rock);
  rocks.push(rock);
  return rock;
}
function worldVerts(r){
  const t=r.body.translation(),a=r.body.rotation(),bc=Math.cos(a),bs=Math.sin(a),out=[];
  for(const v of r.outline){ out.push({x:t.x+v.x*bc-v.y*bs, y:t.y+v.x*bs+v.y*bc}); }
  return out;
}
function maxVel(){ let m=0; for(const r of rocks){ if(r.body.bodyType()!==RAPIER.RigidBodyType.Dynamic) continue;
  const v=r.body.linvel(); m=Math.max(m, Math.hypot(v.x,v.y)+Math.abs(r.body.angvel())*0.3); } return m; }

// ================= state =================
const state = { phase:'aim', active:null, used:0, settleT:0, simT:0 };
const keys = new Set();
let dropQueued=false, moveHold=0, moveDir=0, rotHold=0, rotDir=0;
let cameraY=0, targetCameraY=0, baseRock=null;

function spawnRock(){
  const shape=makeShape();
  let topY=floorYm; for(const r of rocks) for(const v of worldVerts(r)) topY=Math.min(topY,v.y);
  let hw=0,hh=0; for(const v of shape.outline){ hw=Math.max(hw,Math.abs(v.x)); hh=Math.max(hh,Math.abs(v.y)); }
  // spawn above the visible top edge (screen top = worldY cameraY) so it falls into view
  const x=worldW/2, y=Math.min(topY-hh-0.15, cameraY-hh-0.25);
  const SLOW=0.85;
  state.descentV = SLOW + (DESCENT-SLOW)*Math.min(1, state.used/9);
  const rock=addRock(x,y,state.used===0?0:rnd(-0.175,0.175),shape,false);
  state.active={ rock, x, y, angle:rock.body.rotation(), hw, hh, shape };
  moveHold=0; moveDir=0; rotHold=0; rotDir=0; state.phase='aim';
}
function clampVel(){ for(const r of rocks){ if(r.body.bodyType()!==RAPIER.RigidBodyType.Dynamic) continue;
  const v=r.body.linvel(), sp=Math.hypot(v.x,v.y); if(sp>5){ const k=5/sp; r.body.setLinvel({x:v.x*k,y:v.y*k},true); }
  const w=r.body.angvel(); if(Math.abs(w)>7) r.body.setAngvel(Math.sign(w)*7,true); } }
// Fixed-timestep substepping. Stepping at the (variable, up to 1/30s) frame dt lets
// fast-rotating pieces tunnel through each other; a small fixed dt catches the contact.
const FIXED_DT = 1/120;
let physAccum = 0;
function stepWorld(dt){
  physAccum += dt;
  let n=0;
  while(physAccum >= FIXED_DT && n < 8){ world.step(); clampVel(); physAccum -= FIXED_DT; n++; }
  if(physAccum > FIXED_DT) physAccum = 0;   // drop backlog, avoid spiral of death
}
// True vertical clearance below the active piece, using Rapier's own geometry.
// The piece's convex hull is cast straight down (vel = +Y) against every other
// collider (obstacles AND the floor). With |vel|=1 the time_of_impact equals the
// distance in metres — an exact gap at the real contact, no shadow heuristic.
const DOWN={x:0,y:1};
function descentGap(a){
  const hit=world.castShape({x:a.x,y:a.y}, a.angle, DOWN, a.rock.physShape, 0, 50, true,
    undefined, undefined, undefined, a.rock.body);
  return hit ? hit.time_of_impact : 50;
}
// Would the active piece, at this candidate pose, overlap any settled collider?
// Used to veto lateral/rotation input that would drive a piece into a neighbour.
// Uses the slightly-shrunk hull so merely *touching* a neighbour isn't a veto.
function poseOverlaps(a, x, y, angle){
  let hit=false;
  world.intersectionsWithShape({x,y}, angle, a.rock.queryShape,
    ()=>{ hit=true; return false; },
    undefined, undefined, undefined, a.rock.body);
  return hit;
}
function release(){ const a=state.active; a.rock.body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);
  a.rock.body.setLinvel({x:0,y:0},true); a.rock.body.setAngvel(0,true);
  if(!baseRock) baseRock=a.rock;
  state.active=null; state.used++; state.settleT=0; state.simT=0; state.phase='sim'; }

// ================= main loop =================
let lastT=performance.now();
function frame(now){
  const dt=Math.min(0.033,(now-lastT)/1000); lastT=now;
  // smooth camera pan toward target
  cameraY+=(targetCameraY-cameraY)*Math.min(1,5.0*dt);
  if(state.phase!=='over'){
    if(state.phase==='aim' && state.active){
      const a=state.active;
      // Horizontal move — veto if it would push the piece into a settled neighbour.
      const md=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0);
      if(md!==0){ if(md!==moveDir){moveDir=md;moveHold=0;} moveHold+=dt;
        const nx=clampn(a.x+md*(0.45+Math.min(moveHold,0.75)/0.75*2.6)*dt, a.hw+0.05, worldW-a.hw-0.05);
        if(!poseOverlaps(a, nx, a.y, a.angle)) a.x=nx;
      } else moveDir=0;
      // Rotate — veto if it would intersect a settled neighbour.
      const rd=(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0);
      if(rd!==0){ if(rd!==rotDir){rotDir=rd;rotHold=0;} rotHold+=dt;
        const na=a.angle+rd*(0.6+Math.min(rotHold,0.75)/0.75*2.0)*dt;
        if(!poseOverlaps(a, a.x, a.y, na)) a.angle=na;
      } else rotDir=0;
      a.x=Math.max(a.hw+0.05,Math.min(worldW-a.hw-0.05,a.x));
      // Real geometry clearance below the piece (shape-cast against all colliders).
      const gap=descentGap(a);
      if(dropQueued||gap<=0.04){ a.rock.body.setNextKinematicTranslation({x:a.x,y:a.y}); a.rock.body.setNextKinematicRotation(a.angle); stepWorld(dt); release(); }
      else { a.y+=Math.min(state.descentV*dt, Math.max(0,gap-0.04)); a.rock.body.setNextKinematicTranslation({x:a.x,y:a.y}); a.rock.body.setNextKinematicRotation(a.angle); stepWorld(dt); }
      dropQueued=false;
    } else {
      stepWorld(dt);
      if(state.phase==='sim'){ state.simT+=dt; const v=maxVel();
        if(v<SETTLE_VEL){ state.settleT+=dt; } else { state.settleT=0; }
        if(state.settleT>SETTLE_HOLD || (state.simT>SETTLE_MAX && v<0.4)) finalizePlacement(); }
    }
    checkTopple();
    removeFallen();
  }
  render();
  requestAnimationFrame(frame);
}

function finalizePlacement(){
  // Lock the base piece in place so it can't be displaced by subsequent pieces landing on it
  if(baseRock && baseRock.body.bodyType()===RAPIER.RigidBodyType.Dynamic){
    baseRock.body.setBodyType(RAPIER.RigidBodyType.Fixed,false);
  }
  maybePanCamera();
  spawnRock();
}
function maybePanCamera(){
  let topY=floorYm; for(const r of rocks) for(const v of worldVerts(r)) topY=Math.min(topY,v.y);
  const screenTopY=(topY-cameraY)*PPM;
  if(screenTopY<CEILING_PX){
    const t=topY-H*0.25/PPM;
    if(t<targetCameraY) targetCameraY=t;
  }
}
function towerHeightCm(){
  let topY=floorYm; for(const r of rocks) for(const v of worldVerts(r)) topY=Math.min(topY,v.y);
  return Math.max(0,Math.round((floorYm-topY)*100));
}
function checkTopple(){
  if(!baseRock) return;
  for(const r of rocks){
    if(r===baseRock) continue;
    if(state.active&&r===state.active.rock) continue;
    const t=r.body.translation();
    if(t.x<-0.3||t.x>worldW+0.3){ triggerGameOver(); return; }
    for(const v of worldVerts(r)){ if(v.y>=floorYm-0.06){ triggerGameOver(); return; } }
  }
}
function triggerGameOver(){
  state.phase='over';
  document.getElementById('ovStones').textContent=towerHeightCm();
  document.getElementById('over').classList.add('show');
}

// ================= background (perlin concrete, built once) =================
let bgCanvas=null;
function buildBackground(){
  const pw=Math.round(W*DPR),ph=Math.round(H*DPR);
  bgCanvas=document.createElement('canvas'); bgCanvas.width=pw; bgCanvas.height=ph;
  const b=bgCanvas.getContext('2d');
  // Very subtle noise base
  const img=b.createImageData(pw,ph); const data=img.data;
  const inv=1/(PPM*DPR);
  for(let y=0;y<ph;y++){
    for(let x=0;x<pw;x++){
      const wx=x*inv, wy=y*inv;
      const md=fbm2(wx*4.0+100, wy*4.0+100, bgPerm, 3);
      const hi=fbm2(wx*18.0+400, wy*18.0+400, bgPerm, 2);
      const v=Math.max(0,Math.min(255, 184 + md*4 + hi*2))|0;
      const i=(y*pw+x)*4;
      data[i]=v; data[i+1]=v; data[i+2]=v; data[i+3]=255;
    }
  }
  b.putImageData(img,0,0);
  // Aggregate speckles — small, dense, subtle
  const rng=mulberry32(42);
  const count=Math.round(pw*ph/900);
  for(let k=0;k<count;k++){
    const sx=rng()*pw, sy=rng()*ph;
    const r=(0.25+rng()*0.55)*DPR;
    const alpha=0.10+rng()*0.28;
    b.beginPath(); b.arc(sx,sy,r,0,Math.PI*2);
    b.fillStyle=`rgba(52,50,48,${alpha.toFixed(2)})`;
    b.fill();
  }
}

// ================= 3D slab rendering =================
// Compute outward edge normals for a screen-space polygon.
function drawLitEdges(pts){
  let area=0;
  for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length]; area+=p.x*q.y-q.x*p.y;}
  const cw=area>0;
  const lx=Math.SQRT1_2, ly=-Math.SQRT1_2;  // light from top-right
  ctx.lineCap='round';
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy);
    if(len<0.001) continue;
    const nx=cw? dy/len:-dy/len, ny=cw?-dx/len: dx/len;
    const d=nx*lx+ny*ly;          // -1 (away) → 0 (perpendicular) → 1 (facing)
    const grey=Math.round((d+1)*0.5*255);
    const alpha=(0.25+Math.abs(d)*0.65).toFixed(2);
    const lw=2.5+Math.abs(d)*1.5;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
    ctx.strokeStyle=`rgba(${grey},${grey},${grey},${alpha})`;
    ctx.lineWidth=lw; ctx.stroke();
  }
}

function drawBlock(r, active){
  const pos=active?{x:active.x,y:active.y}:r.body.translation();
  const ang=active?active.angle:r.body.rotation();
  const bc=Math.cos(ang), bs=Math.sin(ang);
  // texture fill, clipped to outline in rotated local space
  ctx.save();
  ctx.translate(pos.x*PPM,(pos.y-cameraY)*PPM);
  ctx.rotate(ang);
  ctx.beginPath();
  r.outline.forEach((v,i)=>i?ctx.lineTo(v.x*PPM,v.y*PPM):ctx.moveTo(v.x*PPM,v.y*PPM));
  ctx.closePath(); ctx.clip();
  if(r.tex) ctx.drawImage(r.tex,-r.texOX,-r.texOY);
  ctx.restore();
  // lit edges in screen space (light direction fixed in world)
  drawLitEdges(r.outline.map(v=>({
    x:(pos.x+v.x*bc-v.y*bs)*PPM,
    y:(pos.y+v.x*bs+v.y*bc-cameraY)*PPM
  })));
}

// ================= render =================
function render(){
  if(bgCanvas) ctx.drawImage(bgCanvas,0,0,W,H);

  // floor line — visible only while it's still in the play area
  const floorScreenY=(floorYm-cameraY)*PPM;
  if(floorScreenY>0&&floorScreenY<H-BTN_PX){
    ctx.save(); ctx.strokeStyle='rgba(0,0,0,0.28)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,floorScreenY); ctx.lineTo(W,floorScreenY);
    ctx.stroke(); ctx.restore();
  }

  for(const r of rocks) drawBlock(r);
  if(state.active) drawBlock(state.active.rock, state.active);
}

// ================= input =================
window.addEventListener('keydown', e=>{
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

// ================= world / lifecycle =================
let world, groundCol;
function buildWorld(){
  world=new RAPIER.World({x:0,y:5.0});
  // Small (0.3–0.5m) compound pieces tunnel rotationally at a big timestep, so we
  // run physics at a fixed 1/120s substep (see stepWorld) with extra solver
  // iterations for stable stacks. lengthUnit matches our piece scale so Rapier's
  // contact tolerances are sized for these small objects, not 1m defaults.
  const ip=world.integrationParameters;
  ip.dt = FIXED_DT;
  ip.lengthUnit = 0.3;
  ip.numSolverIterations = 12;
  ip.numInternalPgsIterations = 2;
  ip.maxCcdSubsteps = 4;
  const g=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(worldW/2, floorYm+0.5));
  groundCol=world.createCollider(RAPIER.ColliderDesc.cuboid(worldW/2,0.5).setFriction(1.8), g);
}
function removeFallen(){
  for(let i=rocks.length-1;i>=0;i--){ const r=rocks[i];
    if(state.active && r===state.active.rock) continue;
    const t=r.body.translation();
    if(t.y>floorYm+1.0||t.x<-1.0||t.x>worldW+1.0){
      world.removeRigidBody(r.body); colToRock.delete(r.col.handle); rocks.splice(i,1);
    }
  }
}
function reset(){
  buildWorld();
  rocks=[]; colToRock.clear();
  state.phase='aim'; state.active=null; state.used=0; state.settleT=0; state.simT=0;
  cameraY=0; targetCameraY=0; baseRock=null;
  dropQueued=false;
  document.getElementById('over').classList.remove('show');
  spawnRock();
}

window.addEventListener('resize', ()=>{ sizeCanvas(); buildBackground(); });

buildBackground();
reset();
requestAnimationFrame(frame);
