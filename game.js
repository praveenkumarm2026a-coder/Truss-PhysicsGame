/**
 * game.js – Canvas Renderer, Collapse Physics, UI Controller
 * Group 2 Team A
 *
 * Colour scheme:
 *   Unsolved members  : white
 *   Tension           : #ef4444 (red)
 *   Compression       : #3b82f6 (blue)
 *   Zero-force (0 entered) : #f59e0b (gold/amber)
 */

/* ────────────────────────────────────────────
   STATE
──────────────────────────────────────────── */
let canvas, ctx;
let level       = null;
let levelNum    = 1;
let selectedMbr = null;
let selectedNd  = null;
let activeType  = 'Tension';
let score       = 0;
let levelTime   = 0;
let timerID     = null;
let isCollapsing = false;
let cParticles   = [];
let cBeams       = [];

const COLORS = {
  white:       '#f0f4ff',
  tension:     '#ef4444',
  compression: '#3b82f6',
  zero:        '#f59e0b',
  selected:    '#22d3ee',
  grid:        '#111e36',
  node_fill:   '#0b1120',
  node_stroke: '#06b6d4',
  node_sel:    '#22d3ee',
  load_arrow:  '#eab308',
  support:     '#06b6d4',
  floor:       '#374151',
};

/* ────────────────────────────────────────────
   INIT
──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('trussCanvas');
  ctx    = canvas.getContext('2d');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  bindUI();
  loadLevel(1);
  requestAnimationFrame(loop);
});

function resizeCanvas() {
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  canvas.width  = w;
  canvas.height = h;
}

/* ────────────────────────────────────────────
   LEVEL LOAD
──────────────────────────────────────────── */
function loadLevel(n) {
  levelNum     = n;
  level        = createLevelWeb(n);
  selectedMbr  = null;
  selectedNd   = level.structure.nodes[0] || null;
  isCollapsing = false;
  levelTime    = 0;
  activeType   = 'Tension';

  document.getElementById('level-badge').innerText = `Level ${n}`;
  document.getElementById('level-title').innerText  = level.name;
  document.getElementById('failure-overlay').classList.add('hidden');
  document.getElementById('victory-overlay').classList.add('hidden');
  document.getElementById('hint-panel').classList.add('hidden');
  document.getElementById('sol-panel').classList.add('hidden');
  document.getElementById('force-input').value = '';

  setType('Tension');
  updateInspector();

  clearInterval(timerID);
  timerID = setInterval(() => {
    if (!isCollapsing) {
      levelTime++;
      document.getElementById('timer-val').innerText = `${levelTime}s`;
    }
  }, 1000);
}

/* ────────────────────────────────────────────
   BIND UI EVENTS
──────────────────────────────────────────── */
function bindUI() {

  /* Canvas click */
  canvas.addEventListener('click', e => {
    if (isCollapsing) return;
    const r  = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (canvas.width  / r.width);
    const my = (e.clientY - r.top)  * (canvas.height / r.height);
    handleCanvasClick(mx, my);
  });

  /* Toggle buttons */
  document.querySelectorAll('.btn-toggle').forEach(b => {
    b.addEventListener('click', () => setType(b.dataset.type));
  });

  /* Save member force */
  document.getElementById('btn-save-member').addEventListener('click', saveMember);

  /* Test & Submit */
  document.getElementById('btn-submit-truss').addEventListener('click', submitTruss);

  /* Retry / Next */
  document.getElementById('btn-retry-level').addEventListener('click', () => loadLevel(levelNum));
  document.getElementById('btn-next-level').addEventListener('click',  () => loadLevel(levelNum + 1));

  /* Icon row */
  document.getElementById('btn-fbd').addEventListener('click',  showFBD);
  document.getElementById('btn-calc').addEventListener('click', () => openModal('modal-calc'));
  document.getElementById('btn-hint').addEventListener('click', showHint);
  document.getElementById('btn-sol').addEventListener('click',  showSolution);
  document.getElementById('btn-team-icon').addEventListener('click', () => openModal('modal-team'));

  /* Header team icon */
  document.getElementById('btn-team-credits').addEventListener('click', () => openModal('modal-team'));

  /* Theory guide */
  document.getElementById('btn-guide').addEventListener('click', () => openModal('modal-guide'));

  /* Modal close buttons */
  document.querySelectorAll('.modal-close').forEach(b => {
    b.addEventListener('click', () => {
      document.getElementById(b.dataset.close).classList.add('hidden');
    });
  });

  /* Calculator */
  document.querySelectorAll('.calc-btn').forEach(b => {
    b.addEventListener('click', () => {
      const v = b.dataset.val;
      const d = document.getElementById('calc-display');
      if (v === 'C') { d.value = '0'; return; }
      if (v === '=') {
        try {
          let expr = d.value
            .replace(/sin\(/g, 'Math.sin(Math.PI/180*')
            .replace(/cos\(/g, 'Math.cos(Math.PI/180*')
            .replace(/tan\(/g, 'Math.tan(Math.PI/180*')
            .replace(/sqrt\(/g, 'Math.sqrt(');
          d.value = String(parseFloat(eval(expr).toFixed(6)));
        } catch { d.value = 'Error'; }
        return;
      }
      d.value = (d.value === '0') ? v : d.value + v;
    });
  });
}

/* ────────────────────────────────────────────
   CANVAS CLICK → select member / node
──────────────────────────────────────────── */
function handleCanvasClick(mx, my) {
  const ts = level.structure;

  /* Nodes first */
  for (const n of ts.nodes) {
    const [sx, sy] = w2s(n.x, n.y);
    if (Math.hypot(mx - sx, my - sy) <= 18) {
      selectedNd = n; updateInspector(); return;
    }
  }

  /* Members */
  for (const m of ts.members) {
    const [ax, ay] = w2s(m.nodeA.x, m.nodeA.y);
    const [bx, by] = w2s(m.nodeB.x, m.nodeB.y);
    if (distSeg(mx, my, ax, ay, bx, by) <= 12) {
      selectedMbr = m;
      document.getElementById('force-input').value =
        m.userForce !== null ? m.userForce : '';
      if (m.userType) setType(m.userType);
      updateInspector();
      return;
    }
  }
}

/* ────────────────────────────────────────────
   SAVE MEMBER
──────────────────────────────────────────── */
function saveMember() {
  if (!selectedMbr) return;
  const raw = parseFloat(document.getElementById('force-input').value);
  if (isNaN(raw)) return;

  selectedMbr.userForce = raw;
  selectedMbr.userType  = (raw === 0) ? 'Zero' : activeType;
}

/* ────────────────────────────────────────────
   SUBMIT TRUSS
──────────────────────────────────────────── */
function submitTruss() {
  const res = level.structure.checkAnswers();
  if (res.allCorrect) {
    const bonus = Math.max(50, 300 - levelTime * 2);
    score += 100 * levelNum + bonus;
    document.getElementById('score-val').innerText = score;
    document.getElementById('victory-overlay').classList.remove('hidden');
  } else {
    triggerCollapse(res.failed);
  }
}

/* ────────────────────────────────────────────
   HINT
──────────────────────────────────────────── */
function showHint() {
  const panel = document.getElementById('hint-panel');
  document.getElementById('hint-text').innerHTML = level.structure.generateHint();
  panel.classList.toggle('hidden');
}

/* ────────────────────────────────────────────
   SOLUTION
──────────────────────────────────────────── */
function showSolution() {
  const panel = document.getElementById('sol-panel');
  document.getElementById('sol-text').innerHTML = level.structure.generateSolution();
  panel.classList.toggle('hidden');
}

/* ────────────────────────────────────────────
   FBD
──────────────────────────────────────────── */
function showFBD() {
  const nd = selectedNd || level.structure.nodes[0];
  const ts = level.structure;
  const rx = ts.reactions[nd.id]?.rx || 0;
  const ry = ts.reactions[nd.id]?.ry || 0;

  const members = ts.members.filter(m => m.nodeA === nd || m.nodeB === nd);
  let html = `
    <h3>Joint ${nd.name}</h3>
    <p>External load: Px = ${nd.loadX} kN, Py = ${nd.loadY} kN</p>
    <p>Support reactions: Rx = ${rx} kN, Ry = ${ry} kN</p>
    <p style="margin-top:8px;color:#94a3b8;">Equilibrium equations:</p>
    <p><code>Σ Fx = 0  →  Σ(F<sub>i</sub> · cos θ<sub>i</sub>) + ${rx} + ${nd.loadX} = 0</code></p>
    <p><code>Σ Fy = 0  →  Σ(F<sub>i</sub> · sin θ<sub>i</sub>) + ${ry} + ${nd.loadY} = 0</code></p>
    <p style="margin-top:10px;color:#22d3ee;font-weight:600;">Connected members:</p>`;
  for (const m of members) {
    const ang = m.angleFrom(nd) * 180 / Math.PI;
    html += `<p>${m.name}: θ = ${ang.toFixed(1)}°, cos = ${Math.cos(m.angleFrom(nd)).toFixed(3)}, sin = ${Math.sin(m.angleFrom(nd)).toFixed(3)}</p>`;
  }

  document.getElementById('fbd-body-content').innerHTML = html;
  openModal('modal-fbd');
}

/* ────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────── */
function setType(type) {
  activeType = type;
  document.querySelectorAll('.btn-toggle').forEach(b => {
    b.classList.remove('active-t', 'active-c');
    if (b.dataset.type === type) {
      b.classList.add(type === 'Tension' ? 'active-t' : 'active-c');
    }
  });
}

function updateInspector() {
  document.getElementById('sel-name').innerText =
    selectedMbr ? `Member: ${selectedMbr.name}` : 'Click any member to inspect';

  if (selectedMbr) {
    document.getElementById('sel-len').innerText = `L = ${selectedMbr.length.toFixed(2)} m`;
    document.getElementById('sel-ang').innerText = `θ = ${selectedMbr.angleDeg.toFixed(1)}°`;
  } else {
    document.getElementById('sel-len').innerText = 'Length: —';
    document.getElementById('sel-ang').innerText = 'Angle: —';
  }
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2-x1, dy = y2-y1;
  if (!dx && !dy) return Math.hypot(px-x1, py-y1);
  const t = Math.max(0, Math.min(1, ((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(px-(x1+t*dx), py-(y1+t*dy));
}

/* ────────────────────────────────────────────
   WORLD → SCREEN
──────────────────────────────────────────── */
function w2s(wx, wy) {
  const nodes = level.structure.nodes;
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const margin = 90;
  const avW = canvas.width  - 2*margin;
  const avH = canvas.height - 2*margin;
  const scale = Math.min(avW/spanX, avH/spanY);
  const offX = margin + (avW - spanX*scale)/2;
  const offY = canvas.height - margin - (avH - spanY*scale)/2;
  return [offX + (wx - minX)*scale, offY - (wy - minY)*scale];
}

/* ────────────────────────────────────────────
   COLLAPSE PHYSICS
──────────────────────────────────────────── */
function triggerCollapse(failedMembers) {
  isCollapsing = true;
  cParticles = []; cBeams = [];

  const ts = level.structure;
  const nMap = {};
  for (const n of ts.nodes) {
    const [sx, sy] = w2s(n.x, n.y);
    nMap[n.id] = { id: n.id, name: n.name, x: sx, y: sy,
      vx: (Math.random()-.5)*60, vy: (Math.random()-.5)*30,
      pinned: n.support === 'pin' };
  }

  for (const m of ts.members) {
    const na = nMap[m.nodeA.id], nb = nMap[m.nodeB.id];
    const failed = failedMembers.includes(m);
    const broken = failed || Math.random() < .4;
    const mx = (na.x+nb.x)/2, my = (na.y+nb.y)/2;
    cBeams.push({ na, nb, broken,
      f1: { x:mx, y:my, vx:(Math.random()-.5)*250, vy:-Math.random()*200 },
      f2: { x:mx, y:my, vx:(Math.random()-.5)*250, vy:-Math.random()*200 }
    });
    if (broken) for (let k=0; k<24; k++)
      cParticles.push({ x:mx, y:my,
        vx:(Math.random()-.5)*350, vy:(Math.random()-.5)*350,
        life:1, color: '#f59e0b' });
  }

  const names = failedMembers.slice(0,3).map(m=>m.name).join(', ');
  document.getElementById('failure-msg').innerText =
    `Member${failedMembers.length>1?'s':''} ${names} — equilibrium violated!`;
  document.getElementById('failure-overlay').classList.remove('hidden');
}

function stepCollapse() {
  const dt = 1/60, g = 900, floor = canvas.height - 50;
  for (const b of cBeams) {
    for (const nd of [b.na, b.nb]) {
      if (nd.pinned) continue;
      nd.vy += g*dt; nd.x += nd.vx*dt; nd.y += nd.vy*dt;
      if (nd.y >= floor) { nd.y = floor; nd.vy *= -.28; nd.vx *= .7; }
    }
    if (b.broken) {
      for (const f of [b.f1, b.f2]) {
        f.vy += g*dt; f.x += f.vx*dt; f.y += f.vy*dt;
        if (f.y >= floor) { f.y=floor; f.vy*=-.28; f.vx*=.7; }
      }
    }
  }
  cParticles = cParticles.filter(p => p.life > 0);
  for (const p of cParticles) {
    p.life -= dt*1.8; p.vy += g*.4*dt; p.x += p.vx*dt; p.y += p.vy*dt;
  }
}

/* ────────────────────────────────────────────
   DRAW
──────────────────────────────────────────── */
function loop() {
  if (isCollapsing) stepCollapse();
  draw();
  requestAnimationFrame(loop);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  if (isCollapsing) { drawCollapse(); return; }
  drawTruss();
}

function drawGrid() {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = 0; x < canvas.width;  x += step) {
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += step) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
  }
}

function drawTruss() {
  const ts = level.structure;

  /* ── Supports ── */
  for (const n of ts.nodes) {
    const [sx, sy] = w2s(n.x, n.y);
    ctx.strokeStyle = COLORS.support; ctx.lineWidth = 2;
    if (n.support === 'pin') {
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(sx-14,sy+22); ctx.lineTo(sx+14,sy+22);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx-18,sy+22); ctx.lineTo(sx+18,sy+22); ctx.stroke();
      /* Hatch under pin */
      ctx.lineWidth=1; ctx.strokeStyle='#334155';
      for(let i=-16;i<=16;i+=6){
        ctx.beginPath(); ctx.moveTo(sx+i,sy+22); ctx.lineTo(sx+i-6,sy+28); ctx.stroke();
      }
    } else if (n.support === 'roller') {
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(sx-14,sy+18); ctx.lineTo(sx+14,sy+18);
      ctx.closePath(); ctx.strokeStyle=COLORS.support; ctx.lineWidth=2; ctx.stroke();
      ctx.beginPath(); ctx.arc(sx-8,sy+23,4,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx+8,sy+23,4,0,Math.PI*2); ctx.stroke();
      ctx.lineWidth=1; ctx.strokeStyle='#334155';
      ctx.beginPath(); ctx.moveTo(sx-20,sy+27); ctx.lineTo(sx+20,sy+27); ctx.stroke();
    }
  }

  /* ── Members ── */
  for (const m of ts.members) {
    const [ax, ay] = w2s(m.nodeA.x, m.nodeA.y);
    const [bx, by] = w2s(m.nodeB.x, m.nodeB.y);
    const isSel = (m === selectedMbr);

    /* member colour */
    let col = COLORS.white;
    if (m.userForce !== null) {
      if      (m.userForce === 0 || m.userType === 'Zero')        col = COLORS.zero;
      else if (m.userType === 'Tension')     col = COLORS.tension;
      else if (m.userType === 'Compression') col = COLORS.compression;
    }

    ctx.strokeStyle = isSel ? COLORS.selected : col;
    ctx.lineWidth   = isSel ? 7 : 5;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();

    /* selection highlight */
    if (isSel) {
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth   = 2; ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
      ctx.setLineDash([]);
    }

    /* Length & angle label on member */
    const mx  = (ax+bx)/2, my = (ay+by)/2;
    const len = m.length.toFixed(2);
    const ang = m.angleDeg.toFixed(1);
    const tag = `${m.name}  L=${len}m  θ=${ang}°`;
    ctx.font = '10px JetBrains Mono, monospace';
    const tw = ctx.measureText(tag).width;

    ctx.fillStyle = 'rgba(11,17,32,.82)';
    ctx.fillRect(mx-tw/2-4, my-8, tw+8, 16);
    ctx.fillStyle = isSel ? COLORS.selected : '#c7d2fe';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tag, mx, my);

    /* Force value tag (if saved) */
    if (m.userForce !== null) {
      const fTag = m.userForce === 0
        ? 'ZF'
        : `${Math.abs(m.userForce)}kN (${m.userType?.[0]})`;
      const ftw = ctx.measureText(fTag).width;
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(mx-ftw/2-3, my+9, ftw+6, 14);
      ctx.fillStyle = col;
      ctx.fillText(fTag, mx, my+16);
    }
  }

  /* ── Nodes ── */
  for (const n of ts.nodes) {
    const [sx, sy] = w2s(n.x, n.y);
    const isSel = (n === selectedNd);

    ctx.fillStyle   = COLORS.node_fill;
    ctx.strokeStyle = isSel ? COLORS.node_sel : COLORS.node_stroke;
    ctx.lineWidth   = isSel ? 3 : 2;
    ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle    = '#fff';
    ctx.font         = 'bold 12px Outfit, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.name, sx, sy);

    /* Load arrows */
    if (Math.abs(n.loadY) > .01) {
      const alen = 48;
      const endY = n.loadY < 0 ? sy-alen : sy+alen;
      ctx.strokeStyle = COLORS.load_arrow; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, endY); ctx.stroke();
      /* arrowhead */
      ctx.fillStyle = COLORS.load_arrow;
      const tip = n.loadY < 0 ? sy : sy;
      const dir = n.loadY < 0 ? -1 : 1;
      ctx.beginPath(); ctx.moveTo(sx,sy+(dir*2)); ctx.lineTo(sx-6,sy+(dir*14)); ctx.lineTo(sx+6,sy+(dir*14)); ctx.fill();
      ctx.font='11px Outfit,sans-serif'; ctx.fillStyle=COLORS.load_arrow;
      ctx.fillText(`P=${Math.abs(n.loadY)}kN`, sx+32, endY+6*-Math.sign(n.loadY));
    }
    if (Math.abs(n.loadX) > .01) {
      const dir = n.loadX > 0 ? 1 : -1;
      ctx.strokeStyle=COLORS.load_arrow; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+dir*48,sy); ctx.stroke();
      ctx.fillStyle=COLORS.load_arrow;
      ctx.beginPath(); ctx.moveTo(sx+(dir*2),sy); ctx.lineTo(sx+(dir*14),sy-6); ctx.lineTo(sx+(dir*14),sy+6); ctx.fill();
      ctx.font='11px Outfit,sans-serif';
      ctx.fillText(`Px=${n.loadX}kN`, sx+dir*52, sy-12);
    }
  }
}

/* ── Collapse drawing ── */
function drawCollapse() {
  const floor = canvas.height - 50;
  ctx.strokeStyle = COLORS.floor; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,floor); ctx.lineTo(canvas.width,floor); ctx.stroke();

  for (const b of cBeams) {
    ctx.lineWidth=5; ctx.lineCap='round';
    if (!b.broken) {
      ctx.strokeStyle='#6b7280';
      ctx.beginPath(); ctx.moveTo(b.na.x,b.na.y); ctx.lineTo(b.nb.x,b.nb.y); ctx.stroke();
    } else {
      ctx.strokeStyle=COLORS.tension;
      ctx.beginPath(); ctx.moveTo(b.na.x,b.na.y); ctx.lineTo(b.f1.x,b.f1.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.nb.x,b.nb.y); ctx.lineTo(b.f2.x,b.f2.y); ctx.stroke();
      ctx.fillStyle='#fbbf24';
      ctx.beginPath(); ctx.arc(b.f1.x,b.f1.y,5,0,Math.PI*2); ctx.fill();
    }
  }

  for (const p of cParticles) {
    ctx.globalAlpha = Math.max(0,p.life);
    ctx.fillStyle   = p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const b of cBeams) {
    for (const nd of [b.na, b.nb]) {
      ctx.fillStyle   = COLORS.node_fill;
      ctx.strokeStyle = COLORS.node_stroke; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(nd.x,nd.y,12,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#fff'; ctx.font='bold 11px Outfit'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(nd.name, nd.x, nd.y);
    }
  }
}
