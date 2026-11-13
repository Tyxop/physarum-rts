// Núcleo de la simulación (sin DOM). Lo usan physarum.html y las pruebas en node.
//
// MUNDO con varias colonias de Physarum sobre una matriz de píxeles que CRECE sin límite
// (se amplía cuando una punta se acerca al borde).
//  - Cada colonia tiene material conservado: avanzar cuesta material; sin material libre se secan
//    las ramas más lejanas (dejan un píxel apagado); la comida suma material y engrosa las ramas que comen.
//  - Las puntas se fusionan con venas PROPIAS (no las cruzan) y ATACAN las venas enemigas:
//    la punta muere, la vena pierde grosor y si cae, todo lo que dependía de ella queda cortado y se seca.
//  - Cada colonia tiene un corazón (el núcleo): si pierde toda la vida, la colonia es derrotada.
(function (root) {
  function World(P) {
    this.P = P;
    this.reset();
  }

  World.prototype.alloc = function () {
    const N = this.W * this.H;
    this.core = new Uint8Array(N);       // hay vena viva
    this.cown = new Uint8Array(N);       // colonia dueña de esa vena
    this.cnt = new Uint8Array(N);
    this.stamp = new Int32Array(N);
    this.pnode = new Int32Array(N);      // último nodo en el píxel
    this.dead = new Uint8Array(N);       // píxel apagado (id de la colonia dueña)
    this.vein = new Float32Array(N);
    this.film = new Float32Array(N);
    this.vown = new Uint8Array(N);
    this.bvein = new Float32Array(N);    // núcleos (estáticos)
    this.bfilm = new Float32Array(N);
    this.bown = new Uint8Array(N);
    this.food = new Uint8Array(N);
    this.famt = new Float32Array(N);
  };

  World.prototype.reset = function () {
    const P = this.P;
    this.W = P.worldW; this.H = P.worldH; this.alloc();
    this.t = 0; this.gen = 1; this.shiftX = 0; this.shiftY = 0;
    this.foodCount = 0; this.foodSum = 0;
    this.cols = P.colonies.map((d, k) => this.makeColony(k + 1, d));
    this.winner = 0;
    this.setFood();
    this.scatterFood(0, 0, this.W, this.H);
  };

  World.prototype.makeColony = function (id, d) {
    const P = this.P, NC = P.maxNodes;
    const c = {
      id, name: d.name, cx: d.x, cy: d.y, aggro: d.aggro || 0, hp: P.heartHP, defeated: false,
      nx: new Float32Array(NC), ny: new Float32Array(NC), npix: new Int32Array(NC), npar: new Int32Array(NC),
      npgen: new Int32Array(NC), ngen: new Int32Array(NC), nkid: new Uint16Array(NC), nm: new Float32Array(NC),
      nborn: new Int32Array(NC), nprot: new Int32Array(NC), nalive: new Uint8Array(NC),
      nstr: new Float32Array(NC), nfirst: new Int32Array(NC).fill(-1), nnext: new Int32Array(NC), nprev: new Int32Array(NC),
      freeList: new Int32Array(NC), freeTop: 0, hi: 0, cursor: 0,
      x: new Float32Array(P.maxTips), y: new Float32Array(P.maxTips), a: new Float32Array(P.maxTips),
      tn: new Int32Array(P.maxTips), tg: new Int32Array(P.maxTips), n: 0,
      Mtot: P.startMass, used: 0, eaten: 0, nNodes: 0, stolen: 0, lost: 0, coreInit: 0, coreLeft: 0, lastAttacker: 0, order: null, dbg: { fuse: 0, enemy: 0, orphan: 0, border: 0, stall: 0, nomat: 0 }, focus: 0, siteX: 0, siteY: 0, feedNode: -1, feedGen: 0, cuts: 0,
      ph: [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28]
    };
    this.initBlob(c);
    return c;
  };

  World.prototype.initBlob = function (c) {
    const { W, P } = this, R0 = P.coreRadius, cx = c.cx, cy = c.cy;
    const x0 = Math.floor(cx - R0 * 1.3 - 3), x1 = Math.ceil(cx + R0 * 1.3 + 3);
    const y0 = Math.floor(cy - R0 * 1.3 - 3), y1 = Math.ceil(cy + R0 * 1.3 + 3);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r <= R0 * (1 + 0.12 * Math.sin(6 * Math.atan2(y - cy, x - cx) + c.ph[0]))) {
        const i = y * W + x; this.bvein[i] = 1; this.bfilm[i] = 1; this.bown[i] = c.id;
        this.core[i] = 1; this.cown[i] = c.id; this.stamp[i] = -9999; c.coreInit++;
      }
    }
    c.coreLeft = c.coreInit;
    for (let k = 0; k < R0 * 1.6; k++) {                    // poros del núcleo
      const r = Math.sqrt(Math.random()) * R0 * 0.8, th = Math.random() * 6.283;
      const hx = Math.round(cx + Math.cos(th) * r), hy = Math.round(cy + Math.sin(th) * r), hr = 1 + Math.random() * 1.5;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        if (dx * dx + dy * dy <= hr * hr) { const i = (hy + dy) * W + hx + dx; this.bvein[i] = 0.35; this.bfilm[i] = 0.5; }
    }
    for (let i = 0; i < P.startTips; i++) {
      const th = (i / P.startTips) * 6.2832 + Math.random() * 0.05;
      const px = cx + Math.cos(th) * (R0 + 1), py = cy + Math.sin(th) * (R0 + 1);
      const id = this.newNode(c, px, py, -1, 0); c.nkid[id] = 1;
      c.x[i] = px; c.y[i] = py; c.a[i] = th; c.tn[i] = id; c.tg[i] = c.ngen[id]; c.n++;
    }
  };

  // ---------- nodos ----------
  World.prototype.newNode = function (c, px, py, parent, t) {
    const { W, H } = this;
    let id;
    if (c.freeTop > 0) id = c.freeList[--c.freeTop];
    else if (c.hi < this.P.maxNodes) id = c.hi++;
    else return -1;
    const ix = Math.min(W - 1, Math.max(0, Math.round(px))), iy = Math.min(H - 1, Math.max(0, Math.round(py)));
    const pix = iy * W + ix;
    c.nx[id] = px; c.ny[id] = py; c.npix[id] = pix; c.npar[id] = parent;
    c.npgen[id] = parent >= 0 ? c.ngen[parent] : 0;
    c.ngen[id] = this.gen++;
    const pv = parent >= 0 && c.nalive[parent];
    c.nkid[id] = 0; c.nm[id] = 1; c.nborn[id] = t; c.nprot[id] = 0; c.nalive[id] = 1;
    // fuerza: se hereda por la rama (una rama alimentada sigue siendo fuerte) pero NO cuesta material
    c.nstr[id] = pv ? 1 + Math.max(0, c.nstr[parent] - 1) * this.P.inherit : 1;
    c.nfirst[id] = -1; c.nprev[id] = -1; c.nnext[id] = -1;
    if (pv) { const f = c.nfirst[parent]; c.nnext[id] = f; if (f >= 0) c.nprev[f] = id; c.nfirst[parent] = id; }
    this.cnt[pix]++; this.core[pix] = 1; this.cown[pix] = c.id; this.stamp[pix] = t; this.dead[pix] = 0; this.pnode[pix] = id;
    c.used += 1; c.nNodes++;
    return id;
  };

  World.prototype.parentOf = function (c, id) {
    const p = c.npar[id];
    return (p >= 0 && c.nalive[p] && c.ngen[p] === c.npgen[id]) ? p : -1;
  };

  World.prototype.removeNode = function (c, id) {
    const p = this.parentOf(c, id);
    if (p >= 0) {
      c.nkid[p]--;
      const pr = c.nprev[id], nx = c.nnext[id];
      if (pr >= 0) c.nnext[pr] = nx; else c.nfirst[p] = nx;
      if (nx >= 0) c.nprev[nx] = pr;
    }
    const pix = c.npix[id];
    if (--this.cnt[pix] <= 0) { this.cnt[pix] = 0; this.core[pix] = 0; this.dead[pix] = c.id; }
    const m = c.nm[id];
    c.used -= m; c.nNodes--;
    c.nalive[id] = 0; c.ngen[id] = -1; c.freeList[c.freeTop++] = id;
    return m;
  };

  // ---------- comida (cubos de 8x8 con contador y centroide: sin escaneos del mundo) ----------
  World.prototype.bucketAdd = function (x, y, sg) {
    const B = this.fb, b = ((y / B) | 0) * this.gw + ((x / B) | 0);
    this.bcnt[b] += sg; this.bsx[b] += sg * x; this.bsy[b] += sg * y;
  };
  World.prototype.addFood = function (x, y, on) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x, was = this.food[i] && this.famt[i] > 0;
    if (on && !was) { this.food[i] = 1; this.famt[i] = this.P.foodAmount; this.bucketAdd(x, y, 1); this.foodCount++; this.foodSum += this.P.foodAmount; }
    else if (!on && was) { this.foodSum -= this.famt[i]; this.food[i] = 0; this.famt[i] = 0; this.bucketAdd(x, y, -1); this.foodCount--; }
  };
  World.prototype.foodGone = function (i) {
    const x = i % this.W, y = (i / this.W) | 0;
    this.food[i] = 0; this.famt[i] = 0; this.bucketAdd(x, y, -1); this.foodCount--;
  };
  World.prototype.clearFood = function () { this.food.fill(0); this.famt.fill(0); this.setFood(); };
  // reconstruye los cubos (al crear el mundo o al crecer)
  World.prototype.setFood = function () {
    const { W, H, food, famt } = this, B = 8;
    this.fb = B; this.gw = Math.ceil(W / B); this.gh = Math.ceil(H / B);
    const n = this.gw * this.gh;
    this.bcnt = new Uint16Array(n); this.bsx = new Float32Array(n); this.bsy = new Float32Array(n);
    let c = 0, sum = 0;
    for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) { const i = row + x; if (food[i] && famt[i] > 0) { c++; sum += famt[i]; this.bucketAdd(x, y, 1); } } }
    this.foodCount = c; this.foodSum = sum;
  };
  World.prototype.foodLeft = function () { return this.foodSum; };
  // comida más cercana dentro de 'range' (centroide del cubo): deja el resultado en _fx,_fy,_fd
  World.prototype.nearestFood = function (px, py, range) {
    const B = this.fb, gw = this.gw, gh = this.gh, bcnt = this.bcnt, bsx = this.bsx, bsy = this.bsy;
    const gx0 = Math.max(0, Math.floor((px - range) / B)), gx1 = Math.min(gw - 1, Math.floor((px + range) / B));
    const gy0 = Math.max(0, Math.floor((py - range) / B)), gy1 = Math.min(gh - 1, Math.floor((py + range) / B));
    let bd = range, bx = 0, by = 0, found = false;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const b = gy * gw + gx; if (!bcnt[b]) continue;
      const fx = bsx[b] / bcnt[b], fy = bsy[b] / bcnt[b], d = Math.hypot(fx - px, fy - py);
      if (d < bd) { bd = d; bx = fx; by = fy; found = true; }
    }
    this._fx = bx; this._fy = by; this._fd = bd; return found;
  };
  // comida aleatoria en una región: foodPct = % de celdas cubiertas, foodConc = tamaño de las manchas (0 dispersa, 1 densas)
  World.prototype.scatterFood = function (x0, y0, x1, y1) {
    const P = this.P;
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(this.W, x1 | 0); y1 = Math.min(this.H, y1 | 0);
    const area = (x1 - x0) * (y1 - y0); if (area <= 0) return;
    const total = P.foodPct / 100 * area; if (total < 1) return;
    const nc = 1 + 150 * P.foodConc * P.foodConc, safe = P.coreRadius + 30 + Math.sqrt(nc);
    let k = Math.floor(total / nc); if (Math.random() < total / nc - k) k++;
    const r = Math.sqrt(nc / Math.PI) * 1.15, R = Math.ceil(r) + 1;
    for (let q = 0; q < k; q++) {
      const cx = x0 + Math.random() * (x1 - x0), cy = y0 + Math.random() * (y1 - y0);
      if (this.cols.some(c => Math.hypot(cx - c.cx, cy - c.cy) < safe)) continue;
      const ix = Math.round(cx), iy = Math.round(cy);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > r * r * (0.55 + 0.9 * Math.random())) continue;
        const x = ix + dx, y = iy + dy;
        if (x < 0 || y < 0 || x >= this.W || y >= this.H || this.core[y * this.W + x]) continue;
        this.addFood(x, y, true);
      }
    }
  };

  // ¿línea de visión libre (sin venas vivas ajenas a la punta) hasta la comida?
  World.prototype.los = function (px, py, fx, fy, t) {
    const { W, core, stamp, P } = this;
    const d = Math.hypot(fx - px, fy - py), steps = Math.floor(d / 2);
    for (let s = 2; s < steps; s++) {
      const q = s * 2 / d, j = Math.round(py + (fy - py) * q) * W + Math.round(px + (fx - px) * q);
      if (core[j] && stamp[j] < t - P.selfAge) return false;
    }
    return true;
  };

  // seca la hoja menos útil (lejos de la comida; sin comida, lejos del corazón)
  World.prototype.dryOne = function (c, t) {
    const { P } = this;
    if (c.hi === 0) return 0;
    let best = -1, bs = -Infinity;
    for (let k = 0; k < P.dryTries; k++) {
      const id = (Math.random() * c.hi) | 0;
      if (!c.nalive[id] || c.nkid[id] > 0 || c.nprot[id] > t) continue;
      let sc;
      if (c.order) {                                         // con una orden: se seca lo más lejano al objetivo
        sc = Math.hypot(c.order.x - c.nx[id], c.order.y - c.ny[id]) + (t - c.nborn[id]) * 0.01;
      } else if (c.focus > 0) {                              // tras un hallazgo: se seca lo más lejano al sitio
        sc = Math.hypot(c.siteX - c.nx[id], c.siteY - c.ny[id]) + (t - c.nborn[id]) * 0.01;
      } else if (this.foodCount > 0) {
        sc = (this.nearestFood(c.nx[id], c.ny[id], 160) ? this._fd : 200) + (t - c.nborn[id]) * 0.02;
      } else sc = Math.hypot(c.nx[id] - c.cx, c.ny[id] - c.cy) + (t - c.nborn[id]) * 0.005;
      if (sc > bs) { bs = sc; best = id; }
    }
    if (best < 0) return 0;
    let freed = 0, id = best, k = 0;
    while (id >= 0 && k < P.dryCascade) {
      const p = this.parentOf(c, id);
      freed += this.removeNode(c, id); k++;
      if (p < 0 || c.nkid[p] > 0 || c.nprot[p] > t) break;
      id = p;
    }
    return freed;
  };

  // corta el nodo pid de la colonia e y seca al instante todo lo que colgaba de él
  World.prototype.cutNode = function (a, e, pid) {
    const P = this.P, stack = [pid];
    let total = 0, m0 = -1;
    while (stack.length) {
      const id = stack.pop();
      for (let ch = e.nfirst[id]; ch >= 0;) {
        const nx = e.nnext[ch];
        if (e.nalive[ch] && e.npar[ch] === id && e.npgen[ch] === e.ngen[id]) stack.push(ch);
        ch = nx;
      }
      const m = this.removeNode(e, id); total += m; if (m0 < 0) m0 = m;
    }
    e.Mtot -= total; e.lost += total; e.lastAttacker = a.id;
    const gain = m0 * P.loot + (total - m0) * P.orphanLoot;     // el nodo cortado se absorbe entero; el resto, en parte
    a.Mtot += gain; a.stolen += gain;
    return total;
  };

  // un ataque a la vena del píxel j (de la colonia e) por parte de la colonia a: lo destruido se lo queda el atacante
  World.prototype.attack = function (a, e, j, mult) {
    const P = this.P; mult = mult || 1;
    const pid = this.pnode[j];
    if (e.nalive[pid] && e.npix[pid] === j) {
      e.lastAttacker = a.id;
      const dmg = Math.min(e.nm[pid], P.attack * mult);
      e.nm[pid] -= dmg; e.used -= dmg; e.Mtot -= dmg; a.Mtot += dmg * P.loot; a.stolen += dmg * P.loot;
      if (e.nm[pid] <= P.killBelow) this.cutNode(a, e, pid);   // la vena cae: lo que colgaba de ella se seca
    } else if (this.bown[j] === e.id) {                     // es el núcleo: se come píxel a píxel
      const { W, H } = this, R = Math.round(P.biteRadius * Math.sqrt(mult)), cx = j % W, cy = (j / W) | 0;
      let eaten = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (this.bown[i] !== e.id) continue;
        this.bown[i] = 0; this.bvein[i] = 0; this.bfilm[i] = 0; this.core[i] = 0; this.cown[i] = 0; this.dead[i] = e.id;
        eaten++;
      }
      if (eaten) {
        e.coreLeft -= eaten; e.lost += eaten * P.coreValue;
        a.Mtot += eaten * P.coreValue; a.stolen += eaten * P.coreValue;
        e.hp = 100 * e.coreLeft / e.coreInit;
        if (e.hp <= P.defeatPct) this.defeat(e);
      }
    }
  };

  World.prototype.setOrder = function (id, x, y, type) { const c = this.cols[id - 1]; if (c && !c.defeated) c.order = { x, y, type }; };
  World.prototype.clearOrder = function (id) { const c = this.cols[id - 1]; if (c) c.order = null; };

  World.prototype.defeat = function (c) {
    c.defeated = true; c.hp = 0; c.n = 0;
    const alive = this.cols.filter(k => !k.defeated);
    if (alive.length === 1) this.winner = alive[0].id;
  };

  const SENS = [0, -1, 1, -2, 2];
  World.prototype.stepColony = function (c, t) {
    const { W, H, P, core, cown, stamp, famt } = this;
    const x = c.x, y = c.y, a = c.a, tn = c.tn, tg = c.tg, ph = c.ph, cx = c.cx, cy = c.cy;
    let n = c.n, want = 0;
    // aniquilada pero con el núcleo vivo: rebrota desde el núcleo con un poco de material
    if (c.nNodes === 0 && n === 0 && c.coreLeft > 0) {
      c.Mtot += P.reseedMass;
      for (let i = 0; i < P.startTips; i++) {
        const th = (i / P.startTips) * 6.2832 + Math.random() * 0.05;
        const px = cx + Math.cos(th) * (P.coreRadius + 1), py = cy + Math.sin(th) * (P.coreRadius + 1);
        const id = this.newNode(c, px, py, -1, t); if (id < 0) break;
        c.nkid[id] = 1; x[i] = px; y[i] = py; a[i] = th; tn[i] = id; tg[i] = c.ngen[id]; n++;
      }
    }
    const enemy = this.cols.find(k => k !== c && !k.defeated);
    let rmax = P.coreRadius;
    for (let i = 0; i < n; i += 4) { const r = Math.hypot(x[i] - cx, y[i] - cy); if (r > rmax) rmax = r; }
    const reg = Math.min(6, Math.max(0.15, P.tipDensity * rmax / Math.max(1, n)));
    const hasFood = this.foodCount > 0;
    const ord = c.order, bearing = ord ? Math.atan2(ord.y - cy, ord.x - cx) : 0;
    let minD = 1e9;                                          // distancia de la punta más adelantada al objetivo
    if (ord) for (let i = 0; i < n; i++) { const d0 = Math.hypot(ord.x - x[i], ord.y - y[i]); if (d0 < minD) minD = d0; }
    // reposición de la vanguardia: si quedan pocas puntas en el frente, nacen otras desde la hoja más cercana al objetivo
    if (ord && n < P.maxTips && c.hi > 0) {
      let van = 0; for (let i = 0; i < n; i++) if (Math.hypot(ord.x - x[i], ord.y - y[i]) <= minD + P.vanBand) van++;
      for (let r = van; r < P.minVan && n < P.maxTips; r++) {
        let bid = -1, bd = 1e9;
        for (let k = 0; k < 120; k++) {
          const id = (Math.random() * c.hi) | 0;
          if (!c.nalive[id] || c.nkid[id] !== 0 || this.parentOf(c, id) < 0) continue;
          const d0 = Math.hypot(ord.x - c.nx[id], ord.y - c.ny[id]);
          if (d0 < bd) { bd = d0; bid = id; }
        }
        if (bid < 0) break;
        x[n] = c.nx[bid]; y[n] = c.ny[bid];
        a[n] = Math.atan2(ord.y - c.ny[bid], ord.x - c.nx[bid]) + (Math.random() - 0.5) * 0.7;
        tn[n] = bid; tg[n] = c.ngen[bid]; c.nkid[bid]++; n++;
      }
    }
    // la colonia nunca deja de explorar: si quedan pocas puntas, nace una desde un extremo de rama
    if (n < P.minTips && c.hi > 0 && n < P.maxTips) {
      let bid = -1, br = -1;
      for (let k = 0; k < 60; k++) {
        const id = (Math.random() * c.hi) | 0;
        if (!c.nalive[id] || c.nkid[id] !== 0 || this.parentOf(c, id) < 0) continue;
        const r = Math.hypot(c.nx[id] - cx, c.ny[id] - cy);
        if (r > br) { br = r; bid = id; }
      }
      if (bid >= 0) {
        const pr = c.npar[bid];
        x[n] = c.nx[bid]; y[n] = c.ny[bid];
        a[n] = Math.atan2(c.ny[bid] - c.ny[pr], c.nx[bid] - c.nx[pr]) + (Math.random() - 0.5) * 0.8;
        tn[n] = bid; tg[n] = c.ngen[bid]; c.nkid[bid]++; n++;
      }
    }
    const off = n > 0 ? (t * 7919) % n : 0;
    for (let q = 0; q < n; q++) {
      const i = (q + off) % n;
      // la punta muere si el nodo del que cuelga fue destruido (rama cortada)
      if (!c.nalive[tn[i]] || c.ngen[tn[i]] !== tg[i]) { c.dbg.orphan++; n--; x[i] = x[n]; y[i] = y[n]; a[i] = a[n]; tn[i] = tn[n]; tg[i] = tg[n]; continue; }
      const px = x[i], py = y[i]; let ang = a[i];
      // ---- ¿comiendo? ----
      if (hasFood) {
        const ix0 = Math.round(px), iy0 = Math.round(py);
        let fi = -1;
        for (let dy = -3; dy <= 3 && fi < 0; dy++) for (let dx = -3; dx <= 3; dx++) {
          const xx = ix0 + dx, yy = iy0 + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          if (famt[yy * W + xx] > 0) { fi = yy * W + xx; break; }
        }
        if (fi >= 0) {
          const e = Math.min(famt[fi], P.eatRate);
          famt[fi] -= e; c.eaten += e; c.Mtot += e; this.foodSum -= e;
          if (famt[fi] <= 0) this.foodGone(fi);
          let nd = tn[i], k = 0; const share = 0.5 * e / 40;
          while (nd >= 0 && k < 40) {                              // engrosa y protege hasta la raíz
            if (c.nm[nd] < P.mMax) { c.nm[nd] += share; c.used += share; }
            if (c.nstr[nd] < P.strMax) c.nstr[nd] += share * P.strGain;
            c.nprot[nd] = t + P.protTime; nd = this.parentOf(c, nd); k++;
          }
          c.focus = P.focusTime; c.siteX = px; c.siteY = py; c.feedNode = tn[i]; c.feedGen = tg[i];   // modo "he encontrado algo"
          continue;
        }
      }
      const rx = px - cx, ry = py - cy, d = Math.hypot(rx, ry), th = Math.atan2(ry, rx);
      const lobe = 1 + P.lobeAmp * (0.45 * Math.sin(7 * th + ph[0]) + 0.3 * Math.sin(5 * th + ph[1]) + 0.25 * Math.sin(3 * th + ph[2]));
      let da = (Math.random() - 0.5) * P.noise;
      let diff = th - ang; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      da += P.radialPull * diff;
      if (c.aggro > 0 && enemy) {                                  // IA: sesgo hacia el corazón enemigo
        let dt = Math.atan2(enemy.cy - py, enemy.cx - px) - ang; dt = Math.atan2(Math.sin(dt), Math.cos(dt));
        da += c.aggro * dt;
      }
      // ---- ORDEN del jugador: las puntas del lado del objetivo avanzan hacia él y se ramifican más ----
      let ordBoost = 1, atkMult = 1, isVan = true, rear = false, siege = false;
      if (ord) {
        const ox = ord.x - px, oy = ord.y - py, od = Math.hypot(ox, oy);
        const tw = Math.cos(th - bearing);
        rear = tw <= 0.2 && od > 6;                         // retaguardia: no avanza, el material va a la vanguardia
        isVan = od <= minD + P.vanBand;                     // vanguardia: las puntas más cercanas al objetivo
        if (tw > 0.2 && od > 6) {
          let dd = Math.atan2(oy, ox) - ang; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
          da += Math.max(-0.35, Math.min(0.35, P.orderPull * dd)) * tw;
          da -= P.radialPull * diff * 0.8 * tw;
          ordBoost = 1 + P.orderBranch * tw;
        }
        if (ord.type === 'attack' && enemy) {
          atkMult = P.attackMult;
          if (Math.hypot(px - enemy.cx, py - enemy.cy) < P.coreRadius * 2.5) {       // asedio: va a por el núcleo que queda
            siege = true;
            const cs = this.coreSamples && this.coreSamples[enemy.id];
            if (cs && cs.length) {
              let bi = -1, bdd = 1e9;
              for (let k = 0; k < cs.length; k += 2) { const dd2 = (cs[k] - px) * (cs[k] - px) + (cs[k + 1] - py) * (cs[k + 1] - py); if (dd2 < bdd) { bdd = dd2; bi = k; } }
              if (bi >= 0) {
                let dd = Math.atan2(cs[bi + 1] - py, cs[bi] - px) - ang; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
                da += Math.max(-0.4, Math.min(0.4, 0.7 * dd)); da -= P.radialPull * diff; ordBoost = Math.max(ordBoost, 2);
              }
            }
          }
          for (let s = 0; s < 5; s++) {                        // olfato: busca vena o núcleo enemigo por delante
            const sa = SENS[s] * 0.35, jx = Math.round(px + Math.cos(ang + sa) * 12), jy = Math.round(py + Math.sin(ang + sa) * 12);
            if (jx < 0 || jy < 0 || jx >= W || jy >= H) continue;
            const j = jy * W + jx;
            if (core[j] && cown[j] !== c.id) { da += sa * 0.6; ordBoost = Math.max(ordBoost, 2); break; }
          }
        }
      }
      if (rear) { a[i] = ang; continue; }
      // atracción: comida más cercana con línea de visión libre
      let foodBoost = 1;
      if (hasFood && !ord && this.nearestFood(px, py, P.foodRange)) {
        const bd = this._fd, fx = this._fx, fy = this._fy;
        if (bd > 3 && this.los(px, py, fx, fy, t)) {
          let dd = Math.atan2(fy - py, fx - px) - ang; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
          da += Math.max(-0.2, Math.min(0.2, P.foodPull * dd)) * (1.1 - bd / P.foodRange);
          da -= P.radialPull * diff * P.foodRadialCut;
          foodBoost = P.foodBranch;
        }
      }
      if (ordBoost > foodBoost) foodBoost = ordBoost;
      ang += da;
      const sp = P.speed * Math.max(0.15, lobe);
      // ---- 3 sondas por delante: vena propia -> fusión; vena enemiga -> ataque ----
      let dead = false, hitx = 0, hity = 0, enemyHit = -1;
      const probe = (aa) => {
        const ax = px + Math.cos(aa) * (sp + P.fuseDist), ay = py + Math.sin(aa) * (sp + P.fuseDist);
        const ix = Math.round(ax), iy = Math.round(ay);
        if (ix < 1 || iy < 1 || ix >= W - 1 || iy >= H - 1) { dead = true; hitx = px; hity = py; return; }
        const j = iy * W + ix;
        if (!core[j]) return;
        if (cown[j] !== c.id) { dead = true; enemyHit = j; return; }
        if (stamp[j] < t - P.selfAge && !siege) { dead = true; hitx = ax; hity = ay; }   // (en asedio no se fusiona: pasa por su propio túnel)
      };
      probe(ang); if (!dead) probe(ang - 0.5); if (!dead) probe(ang + 0.5);
      let crossed = false;
      if (dead && enemyHit >= 0) {
        const e = this.cols[cown[enemyHit] - 1];
        if (e && !e.defeated) {
          const str = c.nstr[tn[i]] * atkMult;                     // fuerza = materia de mi rama (x orden de ataque)
          const pid = this.pnode[enemyHit];
          const isNode = e.nalive[pid] && e.npix[pid] === enemyHit;
          // ventaja de territorio: cerca del propio núcleo las ramas son mucho más difíciles de cortar
          const home = isNode ? 1 + P.homeBonus * Math.max(0, 1 - Math.hypot(e.nx[pid] - e.cx, e.ny[pid] - e.cy) / P.homeRadius) : 1;
          const defStr = isNode ? e.nstr[pid] * home : P.coreStrength;
          if (str > defStr) {                                      // más materia: la corta (su subárbol se seca) y sigue por encima
            if (isNode) this.cutNode(c, e, pid); else this.attack(c, e, enemyHit, atkMult);
            c.cuts++; crossed = true; dead = false;
          } else this.attack(c, e, enemyHit, atkMult);             // menos materia: solo daña y la punta muere
        }
      }
      if (dead) {
        const last = tn[i];
        if (enemyHit >= 0) {
          c.dbg.enemy++; c.nkid[last]--;
        } else if (hitx === px && hity === py) {                  // borde del mundo
          c.dbg.border++; c.nkid[last]--;
        } else if (c.used + 1 <= c.Mtot) {                         // anastomosis: cierra la conexión
          c.dbg.fuse++;
          const id = this.newNode(c, hitx, hity, last, t); if (id < 0) c.nkid[last]--;
        } else c.nkid[last]--;
        n--; x[i] = x[n]; y[i] = y[n]; a[i] = a[n]; tn[i] = tn[n]; tg[i] = tg[n]; continue;
      }
      const nx = px + Math.cos(ang) * sp, ny = py + Math.sin(ang) * sp;
      const last = tn[i];
      if (Math.hypot(nx - c.nx[last], ny - c.ny[last]) >= 1) {
        const need = (ord && !isVan) ? P.reserve : 1;          // el resto solo avanza si sobra material
        if (c.Mtot - c.used < need) { if (isVan) want++; c.dbg.stall++; a[i] = ang; continue; }  // sin material: espera y se seca otra rama
        const id = this.newNode(c, nx, ny, last, t);
        if (id < 0) { want++; continue; }
        c.nkid[id] = 1; tn[i] = id; tg[i] = c.ngen[id];
      }
      x[i] = nx; y[i] = ny; a[i] = ang;
      let expl = 1;       // tras un hallazgo, las puntas lejos del sitio dejan de ramificar (se retraen)
      if (c.focus > 0 && !ord && Math.hypot(nx - c.siteX, ny - c.siteY) > P.siteRadius) expl = P.focusExplore;
      if (n < P.maxTips && c.Mtot - c.used > 3 &&
          Math.random() < P.branch * foodBoost * expl * reg * (0.6 + 0.8 * Math.min(1, lobe / 1.4))) {
        const s = (0.3 + Math.random() * 0.4) * (Math.random() < 0.5 ? -1 : 1);
        x[n] = nx; y[n] = ny; a[n] = ang + s; tn[n] = tn[i]; tg[n] = tg[i]; c.nkid[tn[i]]++; a[i] = ang - s * 0.4; n++;
      }
    }
    c.n = n;
    // secado: libera material para las puntas que esperan
    let freed = 0, tries = 0;
    let budget = Math.min(want, P.dryMax);
    if (c.order) budget = (c.Mtot - c.used < P.reserve) ? P.dryMax * 3 : 0;      // con orden: el material fluye hacia delante
    const focusing = c.focus > 0 && !c.order;
    if (c.focus > 0) c.focus--;
    if (focusing && c.Mtot - c.used < P.focusFree) budget = Math.max(budget, P.focusDry);   // retrae las otras ramas
    while (freed < budget && tries++ < 12) freed += this.dryOne(c, t);
    let spear = -1;                                     // nodo cuya rama se refuerza con el material liberado
    if (focusing && c.feedNode >= 0 && c.nalive[c.feedNode] && c.ngen[c.feedNode] === c.feedGen) spear = c.feedNode;
    else if (c.order && c.n > 0) {                      // con orden: la punta más cercana al objetivo es la vanguardia
      let bd = 1e9;
      for (let i = 0; i < c.n; i++) { const d = Math.hypot(c.order.x - x[i], c.order.y - y[i]); if (d < bd) { bd = d; spear = tn[i]; } }
    }
    if (spear >= 0 && freed > 0 && c.nalive[spear]) {
      let nd = spear, k = 0; const per = freed * P.reinforce / 60;
      while (nd >= 0 && k < 60) {
        const add = Math.min(P.mMax - c.nm[nd], per);
        if (add > 0) { c.nm[nd] += add; c.used += add; }
        c.nstr[nd] = Math.min(P.strMax, c.nstr[nd] + per * P.strGain);
        c.nprot[nd] = t + P.protTime; nd = this.parentOf(c, nd); k++;
      }
    }
    // ramas cortadas por el enemigo: sin conexión al corazón, mueren (barrido incremental)
    for (let k = 0; k < P.orphanScan && c.hi > 0; k++) {
      c.cursor = (c.cursor + 1) % c.hi;
      const id = c.cursor;
      if (!c.nalive[id] || c.npar[id] < 0) continue;
      if (this.parentOf(c, id) < 0) {
        const m = this.removeNode(c, id); c.Mtot -= m; c.lost += m;
        const a = c.lastAttacker ? this.cols[c.lastAttacker - 1] : null;
        if (a && !a.defeated) { a.Mtot += m * P.orphanLoot; a.stolen += m * P.orphanLoot; }
      }
    }
  };

  World.prototype.refreshCoreSamples = function () {
    const { W, H, P } = this;
    if (!this.coreSamples) this.coreSamples = {};
    for (const e of this.cols) {
      const R = Math.ceil(P.coreRadius * 1.4) + 2, x0 = Math.max(0, Math.floor(e.cx - R)), x1 = Math.min(W, Math.ceil(e.cx + R));
      const y0 = Math.max(0, Math.floor(e.cy - R)), y1 = Math.min(H, Math.ceil(e.cy + R));
      const all = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (this.bown[y * W + x] === e.id) all.push(x, y);
      const stride = Math.max(2, 2 * Math.floor(all.length / 2 / 160)), out = [];
      for (let i = 0; i < all.length; i += stride) out.push(all[i], all[i + 1]);
      this.coreSamples[e.id] = out;
    }
  };

  World.prototype.step = function () {
    const t = this.t;
    if (t % 15 === 0) this.refreshCoreSamples();
    for (const c of this.cols) if (!c.defeated) this.stepColony(c, t);
    this.checkGrow();
    this.t++;
  };

  // ---------- mundo sin límite: se amplía cuando una punta se acerca al borde ----------
  World.prototype.checkGrow = function () {
    const { P } = this, M = P.growMargin, G = P.growStep;
    let L = 0, R = 0, T = 0, B = 0;
    for (const c of this.cols) for (let i = 0; i < c.n; i++) {
      if (c.x[i] < M) L = G; if (c.x[i] > this.W - M) R = G;
      if (c.y[i] < M) T = G; if (c.y[i] > this.H - M) B = G;
    }
    if (!(L || R || T || B)) return;
    if ((this.W + L + R) * (this.H + T + B) > P.maxCells) return;
    this.grow(L, R, T, B);
  };

  World.prototype.grow = function (L, R, T, B) {
    const oW = this.W, oH = this.H, nW = oW + L + R, nH = oH + T + B;
    const re = (arr, Ctor) => {
      const out = new Ctor(nW * nH);
      for (let y = 0; y < oH; y++) out.set(arr.subarray(y * oW, (y + 1) * oW), (y + T) * nW + L);
      return out;
    };
    for (const k of ['core', 'cown', 'cnt', 'dead', 'vown', 'bown', 'food']) this[k] = re(this[k], Uint8Array);
    for (const k of ['vein', 'film', 'bvein', 'bfilm', 'famt']) this[k] = re(this[k], Float32Array);
    this.stamp = re(this.stamp, Int32Array); this.pnode = re(this.pnode, Int32Array);
    this.W = nW; this.H = nH; this.shiftX += L; this.shiftY += T;
    for (const c of this.cols) {
      c.cx += L; c.cy += T;
      if (c.order) { c.order.x += L; c.order.y += T; }
      for (let i = 0; i < c.n; i++) { c.x[i] += L; c.y[i] += T; }
      for (let id = 0; id < c.hi; id++) {
        if (!c.nalive[id]) continue;
        c.nx[id] += L; c.ny[id] += T;
        c.npix[id] = Math.round(c.ny[id]) * nW + Math.round(c.nx[id]);
      }
    }
    this.setFood();
    if (this.P.autoFood) {                                  // comida nueva en las zonas recién descubiertas
      if (L) this.scatterFood(0, 0, L, nH); if (R) this.scatterFood(nW - R, 0, nW, nH);
      if (T) this.scatterFood(L, 0, nW - R, T); if (B) this.scatterFood(L, nH - B, nW - R, nH);
    }
  };

  // ---------- dibujo ----------
  World.prototype.paint = function (px, py, rv, rf, cid) {
    const { W, H, vein, film, vown } = this;
    const R = Math.ceil(rf), cx = Math.round(px), cy = Math.round(py);
    for (let dy = -R; dy <= R; dy++) {
      const yy = cy + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = cx + dx; if (xx < 0 || xx >= W) continue;
        const d = Math.sqrt(dx * dx + dy * dy), i = yy * W + xx;
        if (d <= rv) { vein[i] = 1; film[i] = 1; vown[i] = cid; }
        else if (d <= rf) { const f = 0.55 * (1 - (d - rv) / (rf - rv + 1e-6)) + 0.25; if (f > film[i]) { film[i] = f; if (vein[i] === 0) vown[i] = cid; } }
      }
    }
  };

  // repinta solo la región visible [x0,x1)x[y0,y1) desde los nodos vivos
  World.prototype.renderView = function (x0, y0, x1, y1) {
    const { P, W, H } = this;
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W, x1 | 0); y1 = Math.min(H, y1 | 0);
    if (x1 <= x0 || y1 <= y0) return;
    for (let y = y0; y < y1; y++) {
      const a = y * W + x0, b = y * W + x1;
      this.vein.set(this.bvein.subarray(a, b), a); this.film.set(this.bfilm.subarray(a, b), a); this.vown.set(this.bown.subarray(a, b), a);
    }
    const mg = 8;
    for (const c of this.cols) {
      const { nalive, nx, ny, nm } = c;
      for (let id = 0; id < c.hi; id++) {
        if (!nalive[id]) continue;
        const px = nx[id], py = ny[id];
        if (px < x0 - mg || px > x1 + mg || py < y0 - mg || py > y1 + mg) continue;
        const r = Math.hypot(px - c.cx, py - c.cy);
        const k = Math.max(0, 1 - (r - P.coreRadius) / P.thickFall);
        const rv = P.veinMin + (P.veinMax - P.veinMin) * k * k + 0.6 * Math.min(3, Math.max(nm[id] - 1, (c.nstr[id] - 1) * 0.6));
        this.paint(px, py, rv, rv + P.filmWidth, c.id);
      }
    }
  };

  root.PhysarumWorld = World;
  root.PHYS_DEFAULTS = {
    worldW: 1100, worldH: 1000, growStep: 256, growMargin: 70, maxCells: 8e6,
    colonies: [
      { name: 'Jugador', x: 330, y: 500, aggro: 0 },
      { name: 'Enemigo', x: 720, y: 480, aggro: 0.015 }
    ],
    heartHP: 100, defeatPct: 10, biteRadius: 3, coreValue: 3, reseedMass: 800, attack: 0.6, killBelow: 0.15, loot: 1.0, orphanLoot: 0.35, orphanScan: 3000,
    startMass: 14000, foodAmount: 6, eatRate: 0.6, mMax: 4, protTime: 900,
    dryMax: 3, dryTries: 300, dryCascade: 6,
    maxNodes: 150000, maxTips: 20000, startTips: 56, coreRadius: 28, minTips: 40,
    speed: 0.5, noise: 0.5, radialPull: 0.04, lobeAmp: 0.7,
    branch: 0.01, tipDensity: 2.6, fuseDist: 2.2, selfAge: 18,
    veinMin: 0.35, veinMax: 2.2, thickFall: 110, filmWidth: 2.2,
    foodRange: 38, foodPull: 0.12, foodRadialCut: 0.3, foodBranch: 1.6,
    homeBonus: 2, homeRadius: 110, vanBand: 70, minVan: 8, reserve: 30, inherit: 0.985, strGain: 1.0, strMax: 6, coreStrength: 1.8, focusTime: 700, focusExplore: 0.2, focusFree: 900, focusDry: 6, reinforce: 0.5, siteRadius: 45,
    foodPct: 0.3, foodConc: 0.5, autoFood: true,
    orderPull: 0.5, orderBranch: 2.0, attackMult: 2.5
  };
})(typeof window !== 'undefined' ? window : globalThis);
