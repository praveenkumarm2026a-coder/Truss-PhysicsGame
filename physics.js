/**
 * physics.js – Truss Physics Solver & Level Factory
 * Group 2 Team A
 *
 * Features:
 *  - Static 2D pin-jointed truss solver (Method of Joints / matrix least-squares)
 *  - Support reactions via moment balance
 *  - Member length, angle computation
 *  - Zero-force detection, equal-force detection
 *  - Step-by-step solution generator
 *  - Hint generator (priority: ZFM → equal forces → reveal one force)
 *  - Levels 1-6+ with escalating joint counts (all joints pin or roller only)
 */

/* ════════ Node ════════ */
class Node {
  constructor(id, name, x, y, support = null, loadX = 0, loadY = 0) {
    this.id      = id;
    this.name    = name;
    this.x       = x;  this.y = y;
    this.support = support;   // 'pin' | 'roller'
    this.loadX   = loadX;
    this.loadY   = loadY;
  }
}

/* ════════ Member ════════ */
class Member {
  constructor(id, nodeA, nodeB) {
    this.id    = id;
    this.nodeA = nodeA;
    this.nodeB = nodeB;
    this.calculatedForce = 0;
    this.forceType       = 'Zero'; // 'Tension'|'Compression'|'Zero'
    this.userForce = null;
    this.userType  = null;
    this.isCorrect = null;
  }

  get name()   { return `${this.nodeA.name}${this.nodeB.name}`; }

  get length() {
    const dx = this.nodeB.x - this.nodeA.x;
    const dy = this.nodeB.y - this.nodeA.y;
    return Math.hypot(dx, dy);
  }

  /** Angle FROM nodeA TO nodeB in degrees [0, 360) */
  get angleDeg() {
    const dx = this.nodeB.x - this.nodeA.x;
    const dy = this.nodeB.y - this.nodeA.y;
    let a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (a < 0) a += 360;
    return a;
  }

  angleFrom(node) {
    const other = (node === this.nodeA) ? this.nodeB : this.nodeA;
    return Math.atan2(other.y - node.y, other.x - node.x);
  }
}

/* ════════ TrussStructure ════════ */
class TrussStructure {
  constructor() {
    this.nodes   = [];
    this.members = [];
    this.reactions = {};
    this.solved    = false;
  }

  addNode(name, x, y, support = null, loadX = 0, loadY = 0) {
    const n = new Node(this.nodes.length, name, x, y, support, loadX, loadY);
    this.nodes.push(n);
    return n;
  }

  addMember(nA, nB) {
    const m = new Member(this.members.length, nA, nB);
    this.members.push(m);
    return m;
  }

  /* ── Solve ── */
  solve() {
    const N = this.nodes.length, M = this.members.length;
    if (!N || !M) return false;

    const pin    = this.nodes.find(n => n.support === 'pin');
    const roller = this.nodes.find(n => n.support === 'roller');
    if (!pin || !roller) return false;

    /* Step 1 – reactions via moment about pin */
    let sumMA = 0;
    for (const n of this.nodes) {
      sumMA += (n.x - pin.x) * n.loadY - (n.y - pin.y) * n.loadX;
    }
    const dxR = roller.x - pin.x;
    const rBy = Math.abs(dxR) > 1e-6 ? -sumMA / dxR : 0;
    const rAx = -this.nodes.reduce((a, n) => a + n.loadX, 0);
    const rAy = -this.nodes.reduce((a, n) => a + n.loadY, 0) - rBy;

    this.reactions[pin.id]    = { rx: _r(rAx), ry: _r(rAy) };
    this.reactions[roller.id] = { rx: 0,        ry: _r(rBy) };

    /* Step 2 – form 2N × M system */
    const A = Array.from({length: 2*N}, () => new Array(M).fill(0));
    const B = new Array(2*N).fill(0);

    for (let i = 0; i < N; i++) {
      const nd = this.nodes[i];
      const rx = (this.reactions[nd.id]?.rx) || 0;
      const ry = (this.reactions[nd.id]?.ry) || 0;
      B[2*i]   = -(nd.loadX + rx);
      B[2*i+1] = -(nd.loadY + ry);
      for (let j = 0; j < M; j++) {
        const m = this.members[j];
        const other = m.nodeA === nd ? m.nodeB : m.nodeB === nd ? m.nodeA : null;
        if (!other) continue;
        const L = m.length;
        if (L < 1e-6) continue;
        A[2*i][j]   = (other.x - nd.x) / L;
        A[2*i+1][j] = (other.y - nd.y) / L;
      }
    }

    try {
      const forces = solveLSQ(A, B, M);
      for (let j = 0; j < M; j++) {
        let f = forces[j] || 0;
        if (Math.abs(f) < 1e-3) f = 0;
        this.members[j].calculatedForce = _r(f);
        this.members[j].forceType = f === 0 ? 'Zero' : (f > 0 ? 'Tension' : 'Compression');
      }
      this.solved = true;
      return true;
    } catch (e) {
      console.error('Solver error', e);
      return false;
    }
  }

  /* ── Answer check ── */
  checkAnswers(tol = 0.1, absTol = 0.5) {
    const failed = [], ok = [];
    for (const m of this.members) {
      if (m.userForce === null || m.userType === null) {
        m.isCorrect = false; failed.push(m); continue;
      }
      const cf = m.calculatedForce, ct = m.forceType;
      const uf = m.userForce,       ut = m.userType;

      /* User enters 0 → treat as Zero */
      const isUserZero = (Math.abs(uf) < absTol);

      let typeMatch;
      if (ct === 'Zero')  typeMatch = isUserZero;
      else                typeMatch = (ut === ct) && !isUserZero;

      const ca = Math.abs(cf), ua = Math.abs(uf);
      const magMatch = ca < 1e-2
        ? isUserZero
        : (Math.abs(ca - ua) <= absTol || Math.abs(ca - ua) / ca <= tol);

      m.isCorrect = typeMatch && magMatch;
      (m.isCorrect ? ok : failed).push(m);
    }
    return { allCorrect: failed.length === 0, failed };
  }

  /* ── Hint Generator (strict priority) ── */
  generateHint() {
    // Priority 1: zero-force members
    const zfm = this.members.filter(m => m.forceType === 'Zero');
    if (zfm.length) {
      return `💡 Zero-force member${zfm.length > 1 ? 's' : ''}: <strong>${zfm.map(m => m.name).join(', ')}</strong>. Enter 0 for these members.`;
    }

    // Priority 2: equal-force members (same magnitude, not revealed)
    const groups = _groupByMagnitude(this.members);
    const equalGroups = groups.filter(g => g.length >= 2);
    if (equalGroups.length) {
      const g = equalGroups[0];
      return `💡 Members <strong>${g.map(m => m.name).join(' &amp; ')}</strong> carry equal force magnitudes.`;
    }

    // Priority 3: reveal one member's force
    const m = this.members[0];
    const abs = Math.abs(m.calculatedForce);
    return `💡 Member <strong>${m.name}</strong> carries <strong>${abs} kN</strong> (${m.forceType}).`;
  }

  /* ── Step-by-Step Solution ── */
  generateSolution() {
    if (!this.solved) return '<p>Solve structure first.</p>';

    const pin    = this.nodes.find(n => n.support === 'pin');
    const roller = this.nodes.find(n => n.support === 'roller');
    const rPin   = this.reactions[pin?.id]    || {rx:0, ry:0};
    const rRoll  = this.reactions[roller?.id] || {rx:0, ry:0};

    let html = '';

    /* Reactions */
    html += `<h4>Step 1 – Support Reactions</h4>`;
    html += `<div class="sol-step">Taking moments about Pin (${pin?.name}):</div>`;
    html += `<div class="sol-step"><code>Σ M${pin?.name} = 0</code> → R<sub>${roller?.name}y</sub> = <strong>${rRoll.ry} kN</strong></div>`;
    html += `<div class="sol-step"><code>Σ Fx = 0</code> → R<sub>${pin?.name}x</sub> = <strong>${rPin.rx} kN</strong></div>`;
    html += `<div class="sol-step"><code>Σ Fy = 0</code> → R<sub>${pin?.name}y</sub> = <strong>${rPin.ry} kN</strong></div>`;

    /* Each member */
    html += `<h4>Step 2 – Member Forces (Method of Joints)</h4>`;
    for (const m of this.members) {
      const ang = _r(m.angleDeg);
      const len = _r(m.length);
      const f   = Math.abs(m.calculatedForce);
      const cls = m.forceType === 'Tension' ? 't-label' : m.forceType === 'Compression' ? 'c-label' : 'z-label';
      const lbl = m.forceType;
      html += `<div class="sol-step">
        <strong>${m.name}</strong>: L = ${len} m, θ = ${ang}°
        → <strong>${f} kN</strong> <span class="${cls}">(${lbl})</span>
      </div>`;
    }

    return html;
  }
}

/* ════════ Linear algebra helpers ════════ */
function _r(v) { return Math.round(v * 1000) / 1000; }

function solveLSQ(A, B, M) {
  const rows = A.length;
  const AtA = Array.from({length:M}, () => new Array(M).fill(0));
  const AtB = new Array(M).fill(0);
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++)
      for (let k = 0; k < rows; k++) AtA[i][j] += A[k][i] * A[k][j];
    for (let k = 0; k < rows; k++) AtB[i] += A[k][i] * B[k];
  }
  return gaussElim(AtA, AtB);
}

function gaussElim(A, B) {
  const n = B.length;
  A = A.map(r => [...r]);
  B = [...B];
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let k = i+1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[max][i])) max = k;
    [A[i],A[max]] = [A[max],A[i]];
    [B[i],B[max]] = [B[max],B[i]];
    if (Math.abs(A[i][i]) < 1e-10) continue;
    for (let k = i+1; k < n; k++) {
      const c = -A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] += c * A[i][j];
      B[k] += c * B[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n-1; i >= 0; i--) {
    if (Math.abs(A[i][i]) < 1e-10) continue;
    x[i] = B[i] / A[i][i];
    for (let k = i-1; k >= 0; k--) B[k] -= A[k][i] * x[i];
  }
  return x;
}

function _groupByMagnitude(members, eps = 0.05) {
  const used   = new Array(members.length).fill(false);
  const groups = [];
  for (let i = 0; i < members.length; i++) {
    if (used[i]) continue;
    const g = [members[i]];
    used[i] = true;
    const fa = Math.abs(members[i].calculatedForce);
    if (fa < 0.05) continue;           // skip zeros
    for (let j = i+1; j < members.length; j++) {
      if (used[j]) continue;
      if (Math.abs(Math.abs(members[j].calculatedForce) - fa) < eps) {
        g.push(members[j]); used[j] = true;
      }
    }
    groups.push(g);
  }
  return groups;
}

/* ════════ Level Factory ════════ */
function createLevelWeb(num) {
  const ts = new TrussStructure();
  let name, desc;

  switch (num) {

    case 1: {
      name = 'Simple Triangle';
      desc = 'A basic 3-joint triangular truss carrying a 10 kN downward load at apex C.';
      const a = ts.addNode('A', 0, 0, 'pin');
      const b = ts.addNode('B', 4, 0, 'roller');
      const c = ts.addNode('C', 2, 3, null, 0, -10);
      ts.addMember(a, b); ts.addMember(b, c); ts.addMember(c, a);
      break;
    }

    case 2: {
      name = 'Corner Braced Frame';
      desc = '4-joint frame with a diagonal brace. 12 kN applied at joint C.';
      const a = ts.addNode('A', 0, 0, 'pin');
      const b = ts.addNode('B', 4, 0, 'roller');
      const c = ts.addNode('C', 4, 3, null, 0, -12);
      const d = ts.addNode('D', 0, 3, null);
      ts.addMember(a, b); ts.addMember(b, c);
      ts.addMember(c, d); ts.addMember(d, a); ts.addMember(a, c);
      break;
    }

    case 3: {
      name = 'Warren Bridge Cell';
      desc = '5-joint Warren truss. Two apex loads of 15 kN each at joints D and E.';
      const a = ts.addNode('A', 0, 0, 'pin');
      const b = ts.addNode('B', 4, 0, null);
      const c = ts.addNode('C', 8, 0, 'roller');
      const d = ts.addNode('D', 2, 3, null, 0, -15);
      const e = ts.addNode('E', 6, 3, null, 0, -15);
      ts.addMember(a, b); ts.addMember(b, c); ts.addMember(d, e);
      ts.addMember(a, d); ts.addMember(d, b); ts.addMember(b, e); ts.addMember(e, c);
      break;
    }

    case 4: {
      name = 'Pratt Bridge Truss';
      desc = '6-joint Pratt truss with 20 kN loads at top joints E and F.';
      const a = ts.addNode('A', 0,  0, 'pin');
      const b = ts.addNode('B', 4,  0, null);
      const c = ts.addNode('C', 8,  0, null);
      const d = ts.addNode('D', 12, 0, 'roller');
      const e = ts.addNode('E', 4,  3, null, 0, -20);
      const f = ts.addNode('F', 8,  3, null, 0, -20);
      ts.addMember(a, b); ts.addMember(b, c); ts.addMember(c, d);
      ts.addMember(e, f);
      ts.addMember(a, e); ts.addMember(e, b); ts.addMember(b, f); ts.addMember(f, c); ts.addMember(f, d);
      break;
    }

    case 5: {
      name = 'Howe Roof Truss';
      desc = '7-joint pitched roof truss with 30 kN central ridge load.';
      const a = ts.addNode('A', 0,   0, 'pin');
      const b = ts.addNode('B', 3,   0, null);
      const c = ts.addNode('C', 6,   0, null);
      const d = ts.addNode('D', 9,   0, 'roller');
      const e = ts.addNode('E', 3,   2, null);
      const f = ts.addNode('F', 4.5, 4, null, 0, -30);
      const g = ts.addNode('G', 6,   2, null);
      ts.addMember(a, b); ts.addMember(b, c); ts.addMember(c, d);
      ts.addMember(a, e); ts.addMember(e, f); ts.addMember(f, g); ts.addMember(g, d);
      ts.addMember(e, b); ts.addMember(f, b); ts.addMember(f, c); ts.addMember(g, c);
      break;
    }

    case 6: {
      name = 'Double Tower Truss';
      desc = '8-joint tower with combined horizontal (10 kN) and vertical (25 kN) loads.';
      const a = ts.addNode('A', 0, 0, 'pin');
      const b = ts.addNode('B', 6, 0, 'roller');
      const c = ts.addNode('C', 0, 3, null);
      const d = ts.addNode('D', 6, 3, null);
      const e = ts.addNode('E', 0, 6, null);
      const f = ts.addNode('F', 6, 6, null);
      const gn= ts.addNode('G', 3, 9, null, 0,   -20);
      const h = ts.addNode('H', 6, 9, null, 10,  -25);
      ts.addMember(a, b); ts.addMember(a, c); ts.addMember(b, d);
      ts.addMember(c, d); ts.addMember(a, d); ts.addMember(c, e);
      ts.addMember(d, f); ts.addMember(e, f); ts.addMember(c, f);
      ts.addMember(e, gn);ts.addMember(f, h); ts.addMember(gn, h); ts.addMember(f, gn);
      break;
    }

    default: {
      const bays = num - 2;
      name = `${num + 2}-Joint Multi-Bay Bridge`;
      desc = `A ${num + 2}-joint ${bays}-bay Warren bridge with escalating loads.`;
      const bNodes = [], tNodes = [];
      for (let i = 0; i <= bays; i++) {
        const sup = i === 0 ? 'pin' : i === bays ? 'roller' : null;
        bNodes.push(ts.addNode(String.fromCharCode(65 + i), i * 3, 0, sup));
      }
      for (let i = 0; i < bays; i++) {
        const load = -(15 + num * 2);
        tNodes.push(ts.addNode(String.fromCharCode(65 + bays + 1 + i),
          (i + 0.5) * 3, 3, null, 0, load));
      }
      for (let i = 0; i < bays; i++) ts.addMember(bNodes[i], bNodes[i+1]);
      for (let i = 0; i < bays-1; i++) ts.addMember(tNodes[i], tNodes[i+1]);
      for (let i = 0; i < bays; i++) {
        ts.addMember(bNodes[i],   tNodes[i]);
        ts.addMember(tNodes[i], bNodes[i+1]);
      }
    }
  }

  ts.solve();
  return { name, desc, structure: ts };
}
