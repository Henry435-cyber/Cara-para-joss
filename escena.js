/* ============================================================
   ESCENA 3D — "Carta desde la Galaxia"
   Motor: Three.js (r128) · Texturas procedurales · Cámara libre
   ------------------------------------------------------------
   · Sistema solar con planetas de texturas procedurales
   · Tierra heroína con atmósfera, nubes y campo de fuerza
   · Nave nodriza futurista desplegando cazas alienígenas
   · Batalla: proyectiles, escudo con ondas de impacto,
     láseres verdes, explosiones, corazones y meteoros
   · Cámara orbital: arrastra para girar, rueda/pellizco = zoom
   ============================================================ */
(() => {
  'use strict';
  if (!window.THREE) return;

  /* ==================== UTILIDADES ==================== */
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const alAzar = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const suavizar = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const rebote = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const mezclaCol = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  let tGlobal = 0;

  /* ==================== SONIDO (Web Audio sintetizado) ==================== */
  let ctxAudio = null;
  let gananciaMaestra = null;
  let tUltimoBoom = -1;

  function prepararAudio() {
    try {
      if (!ctxAudio) {
        ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
        gananciaMaestra = ctxAudio.createGain();
        gananciaMaestra.gain.value = 0.2; /* volumen moderado */
        gananciaMaestra.connect(ctxAudio.destination);
      }
      if (ctxAudio.state === 'suspended') ctxAudio.resume();
    } catch (e) { ctxAudio = null; }
  }

  function tono(forma, f0, f1, dur, vol) {
    if (!ctxAudio || ctxAudio.state !== 'running') return;
    try {
      const t = ctxAudio.currentTime;
      const osc = ctxAudio.createOscillator();
      const g = ctxAudio.createGain();
      osc.type = forma;
      osc.frequency.setValueAtTime(Math.max(1, f0), t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(gananciaMaestra);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    } catch (e) { /* sin audio */ }
  }

  function ruidoFiltrado(dur, f0, f1, vol) {
    if (!ctxAudio || ctxAudio.state !== 'running') return;
    try {
      const t = ctxAudio.currentTime;
      const n = Math.max(1, Math.floor(ctxAudio.sampleRate * dur));
      const buffer = ctxAudio.createBuffer(1, n, ctxAudio.sampleRate);
      const canal = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) canal[i] = Math.random() * 2 - 1;
      const src = ctxAudio.createBufferSource();
      src.buffer = buffer;
      const filtro = ctxAudio.createBiquadFilter();
      filtro.type = 'lowpass';
      filtro.frequency.setValueAtTime(Math.max(1, f0), t);
      filtro.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      const g = ctxAudio.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filtro);
      filtro.connect(g);
      g.connect(gananciaMaestra);
      src.start(t);
      src.stop(t + dur + 0.05);
    } catch (e) { /* sin audio */ }
  }

  const SONIDO = {
    granDisparo() { tono('sawtooth', 160, 38, 0.55, 0.5); ruidoFiltrado(0.5, 1200, 100, 0.35); },
    disparoAlien() { tono('square', 640, 160, 0.12, 0.14); },
    laser() { tono('sawtooth', 1500, 340, 0.13, 0.18); },
    explosion() {
      if (tGlobal - tUltimoBoom < 0.12) return;
      tUltimoBoom = tGlobal;
      ruidoFiltrado(0.55, 600, 50, 0.42);
      tono('sine', 110, 32, 0.45, 0.36);
    },
    portal() { ruidoFiltrado(1.1, 1400, 120, 0.3); tono('sine', 55, 260, 1.1, 0.2); },
    warp() { ruidoFiltrado(1.0, 200, 2200, 0.35); tono('sine', 90, 700, 0.8, 0.15); },
    lanzamiento() { ruidoFiltrado(0.6, 300, 1600, 0.18); },
    agujero() { tono('sine', 30, 48, 2.5, 0.12); }
  };

  /* el audio se activa con el primer gesto del usuario (política de navegadores) */
  window.addEventListener('pointerdown', prepararAudio);
  window.addEventListener('carta:abierta', prepararAudio);

  /* ==================== RUIDO PROCEDURAL (fBm) ==================== */
  function crearRuido(semilla, tam) {
    const g = new Float32Array(tam * tam);
    let s = (semilla >>> 0) || 1;
    for (let i = 0; i < g.length; i++) {
      s = (s * 16807) % 2147483647;
      g[i] = s / 2147483647;
    }
    return (x, y) => {
      x = ((x % 1) + 1) % 1;
      y = ((y % 1) + 1) % 1;
      const fx = x * tam, fy = y * tam;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = suavizar(fx - x0), ty = suavizar(fy - y0);
      const xa = x0 % tam, ya = y0 % tam;
      const xb = (xa + 1) % tam, yb = (ya + 1) % tam;
      const v00 = g[ya * tam + xa], v10 = g[ya * tam + xb];
      const v01 = g[yb * tam + xa], v11 = g[yb * tam + xb];
      return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
    };
  }

  function fbm(ruido, x, y, oct) {
    let v = 0, amp = 0.5, f = 1, tot = 0;
    for (let i = 0; i < oct; i++) {
      v += amp * ruido(x * f, y * f);
      tot += amp; amp *= 0.5; f *= 2;
    }
    return v / tot;
  }

  /* ==================== PINTORES DE TEXTURAS ==================== */
  function texCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function texturaBrillo() {
    const c = texCanvas(128, 128);
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function texturaCorazon() {
    const c = texCanvas(128, 128);
    const x = c.getContext('2d');
    const halo = x.createRadialGradient(64, 60, 0, 64, 60, 62);
    halo.addColorStop(0, 'rgba(255,255,255,0.5)');
    halo.addColorStop(0.55, 'rgba(255,160,200,0.22)');
    halo.addColorStop(1, 'rgba(255,120,180,0)');
    x.fillStyle = halo;
    x.fillRect(0, 0, 128, 128);
    const cuerpo = x.createRadialGradient(58, 50, 4, 64, 62, 36);
    cuerpo.addColorStop(0, '#fff2f8');
    cuerpo.addColorStop(1, '#ff6fae');
    x.fillStyle = cuerpo;
    x.beginPath();
    x.moveTo(64, 98);
    x.bezierCurveTo(28, 72, 36, 34, 64, 52);
    x.bezierCurveTo(92, 34, 100, 72, 64, 98);
    x.closePath();
    x.fill();
    return new THREE.CanvasTexture(c);
  }

  /* Humo volumétrico para los daños de la nave */
  function texturaHumo() {
    const c = texCanvas(128, 128);
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.38)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 14; i++) {
      const px = rand(30, 98), py = rand(30, 98), pr = rand(6, 18);
      const gg = x.createRadialGradient(px, py, 0, px, py, pr);
      gg.addColorStop(0, 'rgba(255,255,255,0.18)');
      gg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gg;
      x.beginPath();
      x.arc(px, py, pr, 0, TAU);
      x.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  /* Vórtice espiral del portal interdimensional */
  function texturaEspiral() {
    const c = texCanvas(256, 256);
    const x = c.getContext('2d');
    x.translate(128, 128);
    x.strokeStyle = 'rgba(178, 120, 255, 0.9)';
    x.shadowColor = 'rgba(150, 110, 255, 0.9)';
    x.shadowBlur = 14;
    x.lineCap = 'round';
    for (let brazo = 0; brazo < 3; brazo++) {
      x.beginPath();
      for (let a = 0; a < Math.PI * 3.2; a += 0.045) {
        const r = 6 + a * 12.5;
        const ang = a + (brazo * TAU) / 3;
        const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
        if (a === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.lineWidth = 3.2;
      x.stroke();
    }
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 40);
    g.addColorStop(0, 'rgba(200, 170, 255, 0.95)');
    g.addColorStop(1, 'rgba(140, 100, 255, 0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(0, 0, 40, 0, TAU);
    x.fill();
    return new THREE.CanvasTexture(c);
  }

  /* Gigantes gaseosos: bandas horizontales + turbulencia + mancha */
  function pintarGas(ancho, alto, cfg) {
    const c = texCanvas(ancho, alto);
    const x = c.getContext('2d');
    const img = x.createImageData(ancho, alto);
    const d = img.data;
    const ruido = crearRuido(cfg.semilla, 16);
    const pal = cfg.paleta;
    const ciclos = cfg.ciclos || 2;
    for (let py = 0; py < alto; py++) {
      const ny = py / alto;
      for (let px = 0; px < ancho; px++) {
        const nx = px / ancho;
        const turb = (fbm(ruido, nx * 1.4, ny * 3.4, 4) - 0.5) * cfg.turbulencia;
        const f = (ny + turb) * pal.length * ciclos;
        const i0 = Math.floor(f);
        const fr = suavizar(f - i0);
        const a = pal[((i0 % pal.length) + pal.length) % pal.length];
        const b = pal[(((i0 + 1) % pal.length) + pal.length) % pal.length];
        let col = mezclaCol(a, b, fr);
        const sombra = 0.93 + 0.07 * Math.sin(f * Math.PI);
        col = [col[0] * sombra, col[1] * sombra, col[2] * sombra];
        if (cfg.mancha) {
          let dx = nx - cfg.mancha.x;
          dx -= Math.round(dx);
          const dy = ny - cfg.mancha.y;
          const e = Math.hypot(dx / cfg.mancha.rx, dy / cfg.mancha.ry);
          if (e < 1.35) {
            const k = suavizar(clamp(1.25 - e, 0, 1));
            col = mezclaCol(col, cfg.mancha.color, k * 0.85);
          }
        }
        const i = (py * ancho + px) * 4;
        d[i] = clamp(col[0], 0, 255);
        d[i + 1] = clamp(col[1], 0, 255);
        d[i + 2] = clamp(col[2], 0, 255);
        d[i + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = ANISO;
    return tex;
  }

  /* Planetas rocosos: relieve + cráteres + casquetes polares */
  function pintarRocoso(ancho, alto, cfg) {
    const c = texCanvas(ancho, alto);
    const x = c.getContext('2d');
    const img = x.createImageData(ancho, alto);
    const d = img.data;
    const r1 = crearRuido(cfg.semilla, 16);
    const r2 = crearRuido(cfg.semilla + 31, 16);
    const cA = cfg.base[0], cB = cfg.base[1], cC = cfg.base[2];
    for (let py = 0; py < alto; py++) {
      const ny = py / alto;
      const lat = Math.abs(ny - 0.5) * 2;
      for (let px = 0; px < ancho; px++) {
        const nx = px / ancho;
        const n = fbm(r1, nx * 3, ny * 3, 5);
        let col = n < 0.5 ? mezclaCol(cA, cB, n * 2) : mezclaCol(cB, cC, (n - 0.5) * 2);
        if (cfg.zonas && fbm(r2, nx * 2, ny * 2, 4) > 0.62) col = [col[0] * 0.72, col[1] * 0.72, col[2] * 0.72];
        if (cfg.casquetes && lat > 0.82) {
          const k = suavizar(clamp((lat - 0.82) / 0.14, 0, 1));
          col = mezclaCol(col, [235, 240, 245], k * 0.9);
        }
        const i = (py * ancho + px) * 4;
        d[i] = clamp(col[0], 0, 255);
        d[i + 1] = clamp(col[1], 0, 255);
        d[i + 2] = clamp(col[2], 0, 255);
        d[i + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    if (cfg.crateres) {
      for (let i = 0; i < cfg.crateres; i++) {
        const cx = rand(0, ancho), cy = rand(alto * 0.08, alto * 0.92);
        const r = rand(2, ancho * 0.045);
        const sombra = x.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
        sombra.addColorStop(0, 'rgba(0,0,0,0.42)');
        sombra.addColorStop(0.75, 'rgba(0,0,0,0.16)');
        sombra.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = sombra;
        x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
        x.strokeStyle = 'rgba(255,255,255,0.2)';
        x.lineWidth = Math.max(0.6, r * 0.12);
        x.beginPath(); x.arc(cx, cy, r * 0.9, Math.PI * 0.9, Math.PI * 1.9); x.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = ANISO;
    return tex;
  }

  /* Planeta vivo: océanos, continentes, hielo y luces de ciudades */
  function pintarTierra(ancho, alto, semilla, conLuces) {
    const cM = texCanvas(ancho, alto), cB = texCanvas(ancho, alto), cS = texCanvas(ancho, alto);
    let cL = null, xL = null, iL = null, r3 = null, r4 = null;
    if (conLuces) {
      cL = texCanvas(ancho, alto);
      xL = cL.getContext('2d');
      iL = xL.createImageData(ancho, alto);
      r3 = crearRuido(semilla + 407, 20);
      r4 = crearRuido(semilla + 509, 40);
    }
    const xM = cM.getContext('2d'), xB = cB.getContext('2d'), xS = cS.getContext('2d');
    const iM = xM.createImageData(ancho, alto), iB = xB.createImageData(ancho, alto), iS = xS.createImageData(ancho, alto);
    const r1 = crearRuido(semilla, 24);
    const r2 = crearRuido(semilla + 97, 16);
    const NIVEL = 0.55;
    const profundo = [12, 38, 88], somero = [30, 94, 154], costa = [54, 130, 180];
    const baja = [56, 122, 64], media = [124, 108, 66], alta = [150, 148, 146], nieve = [236, 242, 248], hielo = [222, 236, 245];
    for (let py = 0; py < alto; py++) {
      const ny = py / alto;
      const lat = Math.abs(ny - 0.5) * 2;
      for (let px = 0; px < ancho; px++) {
        const nx = px / ancho;
        const elev = fbm(r1, nx * 2.6, ny * 2.6, 5) * 0.78 + fbm(r2, nx * 7, ny * 7, 3) * 0.22;
        let col, brilloSpec = 22, altura;
        if (elev > NIVEL) {
          const h = clamp((elev - NIVEL) / (1 - NIVEL), 0, 1);
          altura = 0.45 + h * 0.55;
          col = h < 0.5 ? mezclaCol(baja, media, h * 2) : mezclaCol(media, alta, (h - 0.5) * 2);
          if (h > 0.85) col = mezclaCol(col, nieve, (h - 0.85) / 0.15);
        } else {
          const prof = clamp((NIVEL - elev) / NIVEL, 0, 1);
          col = mezclaCol(costa, profundo, suavizar(prof));
          brilloSpec = 215 - prof * 60;
          altura = 0.34;
        }
        if (lat > 0.78) {
          const k = suavizar(clamp((lat - 0.78) / 0.2, 0, 1));
          col = mezclaCol(col, hielo, k);
          if (k > 0.35) { brilloSpec = 40; altura = 0.5; }
        }
        const det = 0.86 + 0.26 * fbm(r2, nx * 9, ny * 9, 2);
        const i = (py * ancho + px) * 4;
        iM.data[i] = clamp(col[0] * det, 0, 255);
        iM.data[i + 1] = clamp(col[1] * det, 0, 255);
        iM.data[i + 2] = clamp(col[2] * det, 0, 255);
        iM.data[i + 3] = 255;
        const g = clamp(altura * 255, 0, 255);
        iB.data[i] = iB.data[i + 1] = iB.data[i + 2] = g;
        iB.data[i + 3] = 255;
        iS.data[i] = iS.data[i + 1] = iS.data[i + 2] = brilloSpec;
        iS.data[i + 3] = 255;
        /* luces de ciudades: puntos cálidos en continentes habitables */
        if (conLuces && elev > NIVEL && lat < 0.75) {
          const region = fbm(r3, nx * 4, ny * 4, 3);
          const fino = fbm(r4, nx * 26, ny * 26, 2);
          if (region > 0.55 && fino > 0.6) {
            const br = rand(0.35, 1);
            iL.data[i] = 255 * br;
            iL.data[i + 1] = 196 * br;
            iL.data[i + 2] = 118 * br;
            iL.data[i + 3] = 255;
          }
        }
      }
    }
    xM.putImageData(iM, 0, 0);
    xB.putImageData(iB, 0, 0);
    xS.putImageData(iS, 0, 0);
    if (conLuces) xL.putImageData(iL, 0, 0);
    const tM = new THREE.CanvasTexture(cM);
    tM.wrapS = THREE.RepeatWrapping; tM.encoding = THREE.sRGBEncoding; tM.anisotropy = ANISO;
    const tB = new THREE.CanvasTexture(cB); tB.wrapS = THREE.RepeatWrapping; tB.anisotropy = ANISO;
    const tS = new THREE.CanvasTexture(cS); tS.wrapS = THREE.RepeatWrapping; tS.anisotropy = ANISO;
    const tL = conLuces ? new THREE.CanvasTexture(cL) : null;
    if (tL) { tL.wrapS = THREE.RepeatWrapping; tL.anisotropy = ANISO; }
    return { mapa: tM, bump: tB, spec: tS, luces: tL };
  }

  /* Nubes blancas con alpha */
  function pintarNubes(ancho, alto, semilla) {
    const c = texCanvas(ancho, alto);
    const x = c.getContext('2d');
    const img = x.createImageData(ancho, alto);
    const d = img.data;
    const r = crearRuido(semilla, 20);
    for (let py = 0; py < alto; py++) {
      const ny = py / alto;
      for (let px = 0; px < ancho; px++) {
        const nx = px / ancho;
        const n = fbm(r, nx * 1.8 + 0.3, ny * 3.2, 5);
        const a = suavizar(clamp((n - 0.52) / 0.24, 0, 1));
        const i = (py * ancho + px) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.round(a * 215);
      }
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = ANISO;
    return t;
  }

  /* ZP-53: mundo futurista (venas de circuitos + cúpulas luminosas) */
  function pintarZP53(ancho, alto, semilla) {
    const cM = texCanvas(ancho, alto), cL = texCanvas(ancho, alto);
    const xM = cM.getContext('2d'), xL = cL.getContext('2d');
    const iM = xM.createImageData(ancho, alto), iL = xL.createImageData(ancho, alto);
    const r1 = crearRuido(semilla, 24);
    const r2 = crearRuido(semilla + 77, 32);
    const r3 = crearRuido(semilla + 177, 48);
    for (let py = 0; py < alto; py++) {
      const ny = py / alto;
      for (let px = 0; px < ancho; px++) {
        const nx = px / ancho;
        const n = fbm(r1, nx * 3, ny * 3, 4);
        let col = mezclaCol([30, 38, 60], [64, 80, 112], n);
        /* venas de circuitos luminosos que recorren la superficie */
        const vena = fbm(r2, nx * 5, ny * 5, 4);
        const cerca = Math.abs(vena - 0.5);
        const luz = cerca < 0.02 ? clamp(1 - cerca / 0.02, 0, 1) : 0;
        /* cúpulas y ciudades del futuro */
        const region = fbm(r3, nx * 6, ny * 6, 3);
        const fino = fbm(r2, nx * 30, ny * 30, 2);
        const ciudad = (region > 0.6 && fino > 0.64) ? 0.85 : 0;
        col = mezclaCol(col, [96, 220, 255], luz * 0.9);
        col = mezclaCol(col, [205, 242, 255], ciudad * 0.65);
        const i = (py * ancho + px) * 4;
        iM.data[i] = clamp(col[0], 0, 255);
        iM.data[i + 1] = clamp(col[1], 0, 255);
        iM.data[i + 2] = clamp(col[2], 0, 255);
        iM.data[i + 3] = 255;
        const br = Math.max(luz * 0.9, ciudad);
        iL.data[i] = 90 * br;
        iL.data[i + 1] = 225 * br;
        iL.data[i + 2] = 255 * br;
        iL.data[i + 3] = 255;
      }
    }
    xM.putImageData(iM, 0, 0);
    xL.putImageData(iL, 0, 0);
    const tM = new THREE.CanvasTexture(cM);
    tM.wrapS = THREE.RepeatWrapping; tM.encoding = THREE.sRGBEncoding; tM.anisotropy = ANISO;
    const tL = new THREE.CanvasTexture(cL);
    tL.wrapS = THREE.RepeatWrapping; tL.anisotropy = ANISO;
    return { mapa: tM, luces: tL };
  }

  /* Sol: granulación fina y manchas solares */
  function pintarSol(ancho, alto, semilla) {
    const c = texCanvas(ancho, alto);
    const x = c.getContext('2d');
    const img = x.createImageData(ancho, alto);
    const d = img.data;
    const r1 = crearRuido(semilla, 24);
    const r2 = crearRuido(semilla + 31, 48);
    for (let py = 0; py < alto; py++) {
      const ny = py / alto;
      for (let px = 0; px < ancho; px++) {
        const nx = px / ancho;
        const n = fbm(r1, nx * 4, ny * 4, 4);
        const fino = fbm(r2, nx * 14, ny * 14, 3);
        const brillo = clamp(n * 0.5 + fino * 0.5, 0, 1);
        let col = mezclaCol([255, 122, 28], [255, 244, 196], suavizar(brillo));
        if (n < 0.3) col = mezclaCol(col, [168, 52, 8], clamp((0.3 - n) / 0.12, 0, 1) * 0.8);
        const i = (py * ancho + px) * 4;
        d[i] = clamp(col[0], 0, 255);
        d[i + 1] = clamp(col[1], 0, 255);
        d[i + 2] = clamp(col[2], 0, 255);
        d[i + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = ANISO;
    return tex;
  }

  /* Nebulosa: nube de ruido con dos tonos y caída radial */
  function pintarNebulosa(ancho, alto, semilla, cA, cB) {
    const c = texCanvas(ancho, alto);
    const x = c.getContext('2d');
    const img = x.createImageData(ancho, alto);
    const d = img.data;
    const r1 = crearRuido(semilla, 24);
    const r2 = crearRuido(semilla + 53, 32);
    for (let py = 0; py < alto; py++) {
      const ny = py / alto;
      for (let px = 0; px < ancho; px++) {
        const nx = px / ancho;
        const n = fbm(r1, nx * 3, ny * 3, 5);
        const fino = fbm(r2, nx * 7, ny * 7, 4);
        const dx = nx - 0.5, dy = ny - 0.5;
        const radial = 1 - clamp(Math.hypot(dx, dy) * 2.1, 0, 1);
        const den = clamp((n * 0.6 + fino * 0.4) * radial * 1.7 - 0.12, 0, 1);
        const col = mezclaCol(cA, cB, suavizar(clamp(fino * 1.25, 0, 1)));
        const i = (py * ancho + px) * 4;
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = Math.round(den * 255);
      }
    }
    x.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  /* Anillos de Saturno con división de Cassini */
  function pintarAnillos() {
    const c = texCanvas(512, 512);
    const x = c.getContext('2d');
    const r0 = 160, r1 = 252;
    for (let r = r0; r <= r1; r++) {
      const t = (r - r0) / (r1 - r0);
      let alfa = 0.32 + 0.42 * Math.abs(Math.sin(t * 26 + 1.3));
      if (t < 0.04) alfa *= t / 0.04;
      if (t > 0.94) alfa *= (1 - t) / 0.06;
      if (t > 0.56 && t < 0.64) alfa *= 0.08;
      if (t > 0.30 && t < 0.34) alfa *= 0.45;
      const v = 190 + 34 * Math.sin(t * 60);
      x.strokeStyle = 'rgba(' + Math.round(v) + ',' + Math.round(v * 0.93) + ',' + Math.round(v * 0.74) + ',' + alfa.toFixed(3) + ')';
      x.lineWidth = 1.4;
      x.beginPath();
      x.arc(256, 256, r, 0, TAU);
      x.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = ANISO;
    return tex;
  }

  /* Halo de borde (rim) reutilizable para atmósferas planetarias */
  function materialRim(colorHex, intensidad) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(colorHex) }, uIntensidad: { value: intensidad } },
      vertexShader: [
        'varying vec3 vNormal; varying vec3 vVista;',
        'void main() {',
        '  vNormal = normalize(normalMatrix * normal);',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  vVista = mv.xyz;',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor; uniform float uIntensidad;',
        'varying vec3 vNormal; varying vec3 vVista;',
        'void main() {',
        '  float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(-vVista))), 3.2);',
        '  gl_FragColor = vec4(uColor, fres * uIntensidad);',
        '}'
      ].join('\n'),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
  }

  /* Paneles de blindaje: juntas, tonos por placa y desgaste (mapa de rugosidad) */
  function pintarPaneles() {
    const c = texCanvas(256, 256);
    const x = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const v = 88 + Math.floor(rand(0, 40));
        x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        x.fillRect(i * 32, j * 32, 32, 32);
      }
    }
    x.strokeStyle = 'rgb(215,215,215)';
    x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, 256); x.stroke();
      x.beginPath(); x.moveTo(0, i * 32); x.lineTo(256, i * 32); x.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const px = rand(0, 256), py = rand(0, 256), pr = rand(8, 30);
      const g = x.createRadialGradient(px, py, 0, px, py, pr);
      g.addColorStop(0, 'rgba(180,180,180,0.5)');
      g.addColorStop(1, 'rgba(180,180,180,0)');
      x.fillStyle = g;
      x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /* ==================== RENDERER, CÁMARA Y LUCES ==================== */
  const lienzo = document.getElementById('espacio');
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x010208, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const ANISO = renderer.capabilities.getMaxAnisotropy();
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);

  const luzSol = new THREE.PointLight(0xffe7c4, 1.5, 0, 0);
  luzSol.castShadow = true;
  luzSol.shadow.mapSize.set(2048, 2048);
  luzSol.shadow.camera.near = 2;
  luzSol.shadow.camera.far = 150;
  luzSol.shadow.bias = -0.004;
  luzSol.shadow.normalBias = 0.02;
  escena.add(luzSol);
  escena.add(new THREE.HemisphereLight(0x4a5d8a, 0x090d1a, 0.45));
  const luzRelleno = new THREE.PointLight(0x88aaff, 0.22, 0, 0);
  luzRelleno.position.set(140, 70, 140);
  escena.add(luzRelleno);

  /* ==================== POSPROCESAMIENTO (bloom cinematográfico) ==================== */
  let composer = null;
  if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass && THREE.ShaderPass && THREE.GammaCorrectionShader) {
    try {
      let objetivo = undefined;
      if (renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget) {
        objetivo = new THREE.WebGLMultisampleRenderTarget(window.innerWidth, window.innerHeight);
      }
      composer = new THREE.EffectComposer(renderer, objetivo);
      composer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, 2));
      composer.setSize(window.innerWidth, window.innerHeight);
      composer.addPass(new THREE.RenderPass(escena, camara));
      composer.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.5, 0.68));
      composer.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
    } catch (e) { composer = null; /* sin bloom: la escena sigue funcionando */ }
  }

  /* ==================== CÁMARA ORBITAL ==================== */
  const reduceMov = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctrl = {
    objetivo: new THREE.Vector3(36, 0, 10),
    teta: 1.73, phi: 1.32,
    tetaObj: 1.73, phiObj: 1.32,
    dist: (window.innerWidth / window.innerHeight) < 0.8 ? 195 : 138,
    ultimaEntrada: -99, pelizco: 0
  };
  ctrl.distObj = ctrl.dist;
  const punteros = new Map();

  lienzo.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { lienzo.setPointerCapture(e.pointerId); } catch (err) { /* puntero sintético */ }
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    ctrl.ultimaEntrada = tGlobal;
    ctrl.pelizco = 0;
    lienzo.style.cursor = 'grabbing';
  });
  lienzo.addEventListener('pointermove', (e) => {
    if (!punteros.has(e.pointerId)) return;
    ctrl.ultimaEntrada = tGlobal;
    const p = punteros.get(e.pointerId);
    if (punteros.size === 1) {
      ctrl.tetaObj -= (e.clientX - p.x) * 0.005;
      ctrl.phiObj = clamp(ctrl.phiObj - (e.clientY - p.y) * 0.005, 0.3, 2.65);
    }
    p.x = e.clientX; p.y = e.clientY;
    if (punteros.size === 2) {
      const pts = Array.from(punteros.values());
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (ctrl.pelizco > 0) ctrl.distObj = clamp(ctrl.distObj * ctrl.pelizco / d, 46, 420);
      ctrl.pelizco = d;
    }
  });
  const soltarPuntero = (e) => {
    punteros.delete(e.pointerId);
    if (punteros.size < 2) ctrl.pelizco = 0;
    if (punteros.size === 0) lienzo.style.cursor = 'grab';
  };
  lienzo.addEventListener('pointerup', soltarPuntero);
  lienzo.addEventListener('pointercancel', soltarPuntero);
  lienzo.addEventListener('wheel', (e) => {
    e.preventDefault();
    ctrl.ultimaEntrada = tGlobal;
    ctrl.distObj = clamp(ctrl.distObj * (1 + Math.sign(e.deltaY) * 0.11), 46, 420);
  }, { passive: false });

  function actualizarCamara(dt) {
    /* la cámara sigue con suavidad a la Tierra viajera */
    ctrl.objetivo.lerp(E, Math.min(1, dt * 0.9));
    if (!reduceMov && tGlobal - ctrl.ultimaEntrada > 6) ctrl.tetaObj += 0.028 * dt;
    const k = Math.min(1, dt * 5);
    ctrl.teta += (ctrl.tetaObj - ctrl.teta) * k;
    ctrl.phi += (ctrl.phiObj - ctrl.phi) * k;
    ctrl.dist += (ctrl.distObj - ctrl.dist) * k;
    const sp = Math.sin(ctrl.phi);
    camara.position.set(
      ctrl.objetivo.x + ctrl.dist * sp * Math.cos(ctrl.teta),
      ctrl.objetivo.y + ctrl.dist * Math.cos(ctrl.phi),
      ctrl.objetivo.z + ctrl.dist * sp * Math.sin(ctrl.teta)
    );
    camara.lookAt(ctrl.objetivo);
  }

  /* ==================== CIELO PROFUNDO ==================== */
  const texBrillo = texturaBrillo();
  const texCorazon = texturaCorazon();
  const texHumo = texturaHumo();
  const texEspiral = texturaEspiral();
  const texPaneles = pintarPaneles();

  (function crearCielo() {
    const n = 4200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const normalBanda = new THREE.Vector3(0.38, 1, 0.52).normalize();
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
      if (v.lengthSq() < 1e-6) v.set(1, 0, 0);
      v.normalize();
      if (i > n * 0.45) {
        const d = v.dot(normalBanda);
        v.addScaledVector(normalBanda, -d * rand(0.72, 0.93)).normalize();
      }
      const r = rand(950, 1700);
      pos[i * 3] = v.x * r; pos[i * 3 + 1] = v.y * r; pos[i * 3 + 2] = v.z * r;
      const t = Math.random();
      const c = t < 0.12 ? [1, 0.84, 0.62] : (t < 0.32 ? [0.68, 0.8, 1] : [0.92, 0.95, 1]);
      const br = rand(0.3, 1);
      col[i * 3] = c[0] * br; col[i * 3 + 1] = c[1] * br; col[i * 3 + 2] = c[2] * br;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    escena.add(new THREE.Points(g, new THREE.PointsMaterial({
      size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false
    })));

    /* polvo estelar: una capa tenue que da profundidad al cielo */
    {
      const n2 = 2600;
      const pos2 = new Float32Array(n2 * 3);
      const col2 = new Float32Array(n2 * 3);
      for (let i = 0; i < n2; i++) {
        v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
        if (v.lengthSq() < 1e-6) v.set(1, 0, 0);
        v.normalize().multiplyScalar(rand(850, 1500));
        pos2[i * 3] = v.x; pos2[i * 3 + 1] = v.y; pos2[i * 3 + 2] = v.z;
        const br = rand(0.08, 0.3);
        col2[i * 3] = br * 0.8;
        col2[i * 3 + 1] = br * 0.85;
        col2[i * 3 + 2] = br;
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
      g2.setAttribute('color', new THREE.BufferAttribute(col2, 3));
      escena.add(new THREE.Points(g2, new THREE.PointsMaterial({
        size: 1, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false
      })));
    }

    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texBrillo, color: alAzar([0xcfe4ff, 0xffe9c8, 0xffffff, 0xbfd8ff]),
        transparent: true, opacity: rand(0.5, 0.95), blending: THREE.AdditiveBlending, depthWrite: false
      }));
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize();
      s.position.copy(dir.multiplyScalar(rand(850, 1500)));
      const t = rand(5, 13);
      s.scale.set(t, t, 1);
      escena.add(s);
    }

    /* nebulosas pintadas con nubes de ruido procedurales */
    const paletasNebulosa = [
      [[96, 52, 180], [190, 140, 255]],
      [[20, 120, 160], [130, 240, 255]],
      [[180, 40, 110], [255, 150, 200]],
      [[40, 70, 200], [140, 170, 255]]
    ];
    const texturasNebulosa = paletasNebulosa.map((p, i) => pintarNebulosa(256, 256, 400 + i * 7, p[0], p[1]));
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texturasNebulosa[i % texturasNebulosa.length],
        transparent: true, opacity: rand(0.22, 0.38), blending: THREE.AdditiveBlending, depthWrite: false
      }));
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.8, 0.8), rand(-1, 1)).normalize();
      s.position.copy(dir.multiplyScalar(rand(750, 1150)));
      const t = rand(380, 700);
      s.scale.set(t, t * rand(0.75, 1), 1);
      escena.add(s);
    }
  })();

  /* ==================== SOL ==================== */
  const grupoSol = new THREE.Group();
  {
    const solMalla = new THREE.Mesh(
      new THREE.SphereGeometry(8, 48, 32),
      new THREE.MeshBasicMaterial({ map: pintarSol(512, 256, 909), toneMapped: false })
    );
    grupoSol.add(solMalla);
    grupoSol.userData.malla = solMalla;
    const corona1 = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0xffd88a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    corona1.scale.set(46, 46, 1);
    const corona2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0xffb45e, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    corona2.scale.set(105, 105, 1);
    grupoSol.add(corona1, corona2);
    grupoSol.userData.corona1 = corona1;
  }
  escena.add(grupoSol);

  /* ==================== SISTEMA SOLAR ==================== */
  const DATOS_PLANETAS = [
    { n: 'Mercurio', d: 11, r: 0.55, sp: 0.50, giro: 0.03, incl: 0.02, tipo: 'rocoso', rim: 0x998877, rimInt: 0.22, cfg: { semilla: 11, base: [[148, 140, 130], [98, 92, 84], [120, 112, 104]], crateres: 34, casquetes: false, zonas: false } },
    { n: 'Venus', d: 16.5, r: 1.05, sp: 0.34, giro: -0.02, incl: -0.03, tipo: 'gas', ancho: 512, rim: 0xf0d8a0, rimInt: 0.5, cfg: { semilla: 22, paleta: [[242, 216, 152], [206, 176, 116], [248, 228, 172], [186, 152, 100]], ciclos: 3, turbulencia: 0.1 } },
    { n: 'Marte', d: 56, r: 0.8, sp: 0.17, giro: 0.3, incl: 0.07, tipo: 'rocoso', rim: 0xd88a60, rimInt: 0.3, cfg: { semilla: 33, base: [[196, 100, 54], [148, 66, 34], [170, 84, 46]], crateres: 12, casquetes: true, zonas: true } },
    { n: 'Júpiter', d: 78, r: 3.2, sp: 0.1, giro: 0.95, incl: 0.03, tipo: 'gas', ancho: 1024, lunas: 4, rim: 0xf0d8b0, rimInt: 0.4, anilloTenue: { interior: 1.3, exterior: 1.6, color: 0xa89478, opacidad: 0.12 }, cfg: { semilla: 44, paleta: [[216, 176, 128], [238, 216, 176], [172, 128, 86], [230, 200, 156], [150, 110, 74], [222, 188, 142], [198, 160, 110]], ciclos: 2, turbulencia: 0.16, mancha: { x: 0.3, y: 0.62, rx: 0.055, ry: 0.05, color: [180, 82, 54] } } },
    { n: 'Saturno', d: 92, r: 2.7, sp: 0.075, giro: 0.85, incl: 0.05, tipo: 'gas', ancho: 1024, lunas: 2, anillos: true, brilloAnillo: true, rim: 0xf0e0c0, rimInt: 0.35, cfg: { semilla: 55, paleta: [[218, 198, 154], [238, 222, 182], [198, 172, 126], [230, 210, 166], [208, 184, 136]], ciclos: 2, turbulencia: 0.08 } },
    { n: 'Urano', d: 106, r: 1.8, sp: 0.055, giro: 0.55, incl: -0.06, tipo: 'gas', ancho: 512, inclEje: 1.48, anilloFino: true, rim: 0xa8e8ec, rimInt: 0.4, cfg: { semilla: 66, paleta: [[176, 228, 232], [202, 242, 244], [160, 214, 220], [190, 238, 240]], ciclos: 2, turbulencia: 0.04 } },
    { n: 'Neptuno', d: 118, r: 1.75, sp: 0.045, giro: 0.6, incl: 0.01, tipo: 'gas', ancho: 512, rim: 0x5577ee, rimInt: 0.4, anilloTenue: { interior: 1.45, exterior: 1.75, color: 0x7799ff, opacidad: 0.16 }, cfg: { semilla: 77, paleta: [[46, 88, 200], [58, 111, 224], [36, 74, 158], [72, 128, 232]], ciclos: 2, turbulencia: 0.09, mancha: { x: 0.62, y: 0.45, rx: 0.045, ry: 0.05, color: [22, 40, 108] } } }
  ];

  const planetas = [];
  const matLineaOrbita = new THREE.LineBasicMaterial({ color: 0x8fa8d8, transparent: true, opacity: 0.16 });

  for (const dato of DATOS_PLANETAS) {
    const grupo = new THREE.Group();
    grupo.rotation.x = dato.incl || 0;
    grupo.rotation.z = (dato.incl || 0) * 0.6;
    escena.add(grupo);

    const puntos = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * TAU;
      puntos.push(new THREE.Vector3(Math.cos(a) * dato.d, 0, Math.sin(a) * dato.d));
    }
    grupo.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(puntos), matLineaOrbita));

    const eje = new THREE.Group();
    eje.rotation.z = dato.inclEje || 0;
    grupo.add(eje);

    let malla;
    if (dato.tipo === 'tierra') {
      const t = pintarTierra(512, 256, dato.semilla, true);
      malla = new THREE.Mesh(
        new THREE.SphereGeometry(dato.r, 40, 28),
        new THREE.MeshPhongMaterial({ map: t.mapa, bumpMap: t.bump, bumpScale: 0.02, specularMap: t.spec, specular: 0x224466, shininess: 12, emissiveMap: t.luces, emissive: new THREE.Color(0x8a5a28) })
      );
      const pivoteLuna = new THREE.Group();
      const texLunaFondo = pintarRocoso(128, 64, { semilla: 71, base: [[196, 193, 186], [142, 139, 132], [168, 166, 158]], crateres: 16, casquetes: false, zonas: false });
      const luna = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshPhongMaterial({ map: texLunaFondo, bumpMap: texLunaFondo, bumpScale: 0.008, shininess: 4 }));
      luna.position.set(2.4, 0.35, 0);
      pivoteLuna.add(luna);
      malla.add(pivoteLuna);
      dato.pivoteLuna = pivoteLuna;
    } else if (dato.tipo === 'gas') {
      const tex = pintarGas(dato.ancho, 256, dato.cfg);
      malla = new THREE.Mesh(new THREE.SphereGeometry(dato.r, 48, 32), new THREE.MeshPhongMaterial({ map: tex, shininess: 6, specular: 0x1a1a1a }));
    } else {
      const tex = pintarRocoso(512, 256, dato.cfg);
      malla = new THREE.Mesh(new THREE.SphereGeometry(dato.r, 40, 28), new THREE.MeshPhongMaterial({ map: tex, bumpMap: tex, bumpScale: 0.015, shininess: 4 }));
    }
    eje.add(malla);

    /* halo atmosférico propio: el planeta se ve volumétrico */
    const rimPlaneta = new THREE.Mesh(
      new THREE.SphereGeometry(dato.r * 1.05, 40, 28),
      materialRim(dato.rim, dato.rimInt)
    );
    eje.add(rimPlaneta);

    /* lunas menores (galileanas de Júpiter, Titán…) */
    if (dato.lunas) {
      dato.pivotesLunas = [];
      const matLunaPeq = new THREE.MeshPhongMaterial({ color: 0xb0aca4, shininess: 4 });
      for (let k = 0; k < dato.lunas; k++) {
        const pivoteL = new THREE.Group();
        pivoteL.rotation.x = rand(-0.25, 0.25);
        const lunaP = new THREE.Mesh(new THREE.SphereGeometry(rand(0.14, 0.28), 12, 8), matLunaPeq);
        lunaP.position.set(dato.r * (1.7 + k * 0.5), 0, 0);
        pivoteL.add(lunaP);
        eje.add(pivoteL);
        dato.pivotesLunas.push({ pivote: pivoteL, vel: rand(0.4, 1.0) * (k % 2 ? -1 : 1) });
      }
    }

    if (dato.anillos) {
      const anillos = new THREE.Mesh(
        new THREE.RingGeometry(dato.r * 1.5, dato.r * 2.4, 96),
        new THREE.MeshLambertMaterial({ map: pintarAnillos(), transparent: true, side: THREE.DoubleSide, depthWrite: false })
      );
      anillos.rotation.x = -Math.PI / 2;
      eje.add(anillos);
    }
    if (dato.anilloFino) {
      const anillo = new THREE.Mesh(
        new THREE.RingGeometry(dato.r * 1.45, dato.r * 1.75, 64),
        new THREE.MeshBasicMaterial({ color: 0xaacfe0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
      );
      anillo.rotation.x = -Math.PI / 2;
      eje.add(anillo);
    }
    if (dato.anilloTenue) {
      const tenue = new THREE.Mesh(
        new THREE.RingGeometry(dato.r * dato.anilloTenue.interior, dato.r * dato.anilloTenue.exterior, 72),
        new THREE.MeshBasicMaterial({ color: dato.anilloTenue.color, transparent: true, opacity: dato.anilloTenue.opacidad, side: THREE.DoubleSide, depthWrite: false })
      );
      tenue.rotation.x = -Math.PI / 2;
      eje.add(tenue);
    }
    if (dato.brilloAnillo) {
      const velo = new THREE.Mesh(
        new THREE.RingGeometry(dato.r * 2.42, dato.r * 2.62, 96),
        new THREE.MeshBasicMaterial({ color: 0xd9c8a5, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      velo.rotation.x = -Math.PI / 2 - 0.025;
      eje.add(velo);
      dato.veloAnillo = velo;
    }

    dato.ang = rand(0, TAU);
    dato.malla = malla;
    planetas.push(dato);
  }

  /* ==================== CINTURÓN DE ASTEROIDES ==================== */
  const cinturon = new THREE.Group();
  {
    const N = 450;
    const geoRoca = new THREE.IcosahedronGeometry(1, 0);
    const matRoca = new THREE.MeshStandardMaterial({ color: 0x9a8d7a, roughness: 0.95, metalness: 0.05, flatShading: true });
    const rocas = new THREE.InstancedMesh(geoRoca, matRoca, N);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const ang = rand(0, TAU);
      const rad = rand(62, 70);
      dummy.position.set(Math.cos(ang) * rad, rand(-1.2, 1.2), Math.sin(ang) * rad);
      dummy.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      const esc = rand(0.035, 0.16);
      dummy.scale.set(esc * rand(0.7, 1.3), esc * rand(0.7, 1.3), esc * rand(0.7, 1.3));
      dummy.updateMatrix();
      rocas.setMatrixAt(i, dummy.matrix);
    }
    cinturon.add(rocas);
  }
  escena.add(cinturon);

  /* ==================== TIERRA HEROÍNA (en su órbita del sistema) ==================== */
  const E = new THREE.Vector3();
  const TIERRA_D = 33;        /* tercera órbita, entre Venus (16.5) y Marte (56) */
  const TIERRA_SP = 0.035;    /* avance sereno: una vuelta completa cada ~3 minutos */
  const INCL_ORBITA = 0.07;
  const ALTURA_ORBITA = -4;
  let angTierra = 0.9;
  const posicionTierra = (ang) => {
    E.set(Math.cos(ang) * TIERRA_D, Math.sin(ang) * TIERRA_D * INCL_ORBITA + ALTURA_ORBITA, Math.sin(ang) * TIERRA_D);
  };
  posicionTierra(angTierra);

  const ESCUDO_R = 11.8;
  const tierraGrupo = new THREE.Group();
  tierraGrupo.position.copy(E);
  escena.add(tierraGrupo);

  /* línea punteada de la órbita terrestre */
  {
    const puntosOrbita = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * TAU;
      puntosOrbita.push(new THREE.Vector3(
        Math.cos(a) * TIERRA_D,
        Math.sin(a) * TIERRA_D * INCL_ORBITA + ALTURA_ORBITA,
        Math.sin(a) * TIERRA_D
      ));
    }
    escena.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(puntosOrbita), matLineaOrbita));
  }

  const texTierra = pintarTierra(1024, 512, 2024, true);
  const tierraMalla = new THREE.Mesh(
    new THREE.SphereGeometry(6, 96, 64),
    new THREE.MeshPhongMaterial({
      map: texTierra.mapa,
      bumpMap: texTierra.bump,
      bumpScale: 0.06,
      specularMap: texTierra.spec,
      specular: 0x33507a,
      shininess: 18,
      emissiveMap: texTierra.luces,
      emissive: new THREE.Color(0xa86e34)
    })
  );
  tierraGrupo.add(tierraMalla);

  const nubesMalla = new THREE.Mesh(
    new THREE.SphereGeometry(6.09, 48, 32),
    new THREE.MeshLambertMaterial({ map: pintarNubes(1024, 512, 777), transparent: true, depthWrite: false })
  );
  nubesMalla.renderOrder = 1;
  tierraGrupo.add(nubesMalla);

  const matAtmosfera = materialRim(0x5fb4ff, 1.0);
  const atmosfera = new THREE.Mesh(new THREE.SphereGeometry(6.55, 48, 32), matAtmosfera);
  atmosfera.renderOrder = 2;
  tierraGrupo.add(atmosfera);

  const uniEscudo = {
    uTiempo: { value: 0 },
    uCentro: { value: E.clone() },
    uColor: { value: new THREE.Color(0x6fe4ff) },
    uFlash: { value: 0 },
    uImpactos: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 1, 0, -1)) }
  };
  const matEscudo = new THREE.ShaderMaterial({
    uniforms: uniEscudo,
    vertexShader: [
      'varying vec3 vNormal; varying vec3 vVista; varying vec3 vMundo;',
      'void main() {',
      '  vNormal = normalize(normalMatrix * normal);',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      '  vVista = mv.xyz;',
      '  vMundo = (modelMatrix * vec4(position, 1.0)).xyz;',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform float uTiempo; uniform vec3 uCentro; uniform vec3 uColor; uniform float uFlash;',
      'uniform vec4 uImpactos[6];',
      'varying vec3 vNormal; varying vec3 vVista; varying vec3 vMundo;',
      'void main() {',
      '  vec3 n = normalize(vNormal);',
      '  float fres = pow(1.0 - abs(dot(n, normalize(-vVista))), 2.3);',
      '  float pulso = 0.8 + 0.2 * sin(uTiempo * 2.1);',
      '  float brillo = fres * (1.15 + uFlash * 1.5) * pulso;',
      '  vec3 dirFrag = normalize(vMundo - uCentro);',
      '  for (int i = 0; i < 6; i++) {',
      '    vec4 imp = uImpactos[i];',
      '    if (imp.w < 0.0) { continue; }',
      '    float edad = uTiempo - imp.w;',
      '    if (edad > 1.1) { continue; }',
      '    float ang = acos(clamp(dot(dirFrag, normalize(imp.xyz)), -1.0, 1.0));',
      '    float radio = edad * 1.5 + 0.03;',
      '    float anillo = smoothstep(0.16, 0.0, abs(ang - radio));',
      '    brillo += anillo * (1.0 - edad / 1.1) * 1.5;',
      '  }',
      '  float rejilla = pow(max(sin(dirFrag.y * 30.0 + uTiempo * 0.35), 0.0), 6.0) * 0.045;',
      '  brillo += rejilla;',
      '  gl_FragColor = vec4(uColor * brillo, clamp(brillo, 0.0, 1.0) * 0.9);',
      '}'
    ].join('\n'),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  const escudo = new THREE.Mesh(new THREE.SphereGeometry(ESCUDO_R, 56, 40), matEscudo);
  escudo.renderOrder = 3;
  tierraGrupo.add(escudo);

  /* ==================== ZP-53 — EL MUNDO FUTURISTA (antes "la Luna") ==================== */
  const pivoteLunaHeroe = new THREE.Group();
  pivoteLunaHeroe.rotation.x = 0.18;
  const zpGrupo = new THREE.Group();
  zpGrupo.position.set(23, 0, 0);
  const texZP = pintarZP53(512, 256, 5353);
  const zpMalla = new THREE.Mesh(
    new THREE.SphereGeometry(1.9, 56, 40),
    new THREE.MeshPhongMaterial({
      map: texZP.mapa,
      bumpMap: texZP.mapa,
      bumpScale: 0.03,
      shininess: 26,
      specular: 0x99bbdd,
      emissiveMap: texZP.luces,
      emissive: new THREE.Color(0x59d4ff)
    })
  );
  zpGrupo.add(zpMalla);
  const atmosferaZP = new THREE.Mesh(new THREE.SphereGeometry(2.08, 40, 28), materialRim(0x6fe4ff, 1.0));
  zpGrupo.add(atmosferaZP);
  const anilloZP = new THREE.Mesh(
    new THREE.RingGeometry(2.75, 3.4, 64),
    new THREE.MeshBasicMaterial({ color: 0x7fd8e8, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
  );
  anilloZP.rotation.x = -Math.PI / 2 + 0.12;
  zpGrupo.add(anilloZP);
  const estacionesZP = [];
  for (let i = 0; i < 2; i++) {
    const est = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.26), new THREE.MeshStandardMaterial({ color: 0xcfd8e8, metalness: 0.7, roughness: 0.35 }));
    const faro = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0x6fffd8, toneMapped: false }));
    faro.position.y = 0.1;
    est.add(faro);
    zpGrupo.add(est);
    estacionesZP.push({ obj: est, faro, ang: rand(0, TAU), vel: rand(0.5, 0.8) * (i ? 1 : -1), r: 4 });
  }
  pivoteLunaHeroe.add(zpGrupo);
  tierraGrupo.add(pivoteLunaHeroe);

  /* la Tierra y ZP-53 se proyectan sombras mutuamente (eclipses reales) */
  tierraMalla.castShadow = true;
  tierraMalla.receiveShadow = true;
  zpMalla.castShadow = true;
  zpMalla.receiveShadow = true;

  const pivoteSats = new THREE.Group();
  pivoteSats.rotation.x = 0.24;
  tierraGrupo.add(pivoteSats);
  const satelites = [];
  {
    const matCascoSat = new THREE.MeshStandardMaterial({ color: 0xa8b4cc, metalness: 0.8, roughness: 0.4 });
    const matPanelSat = new THREE.MeshStandardMaterial({ color: 0x24406e, metalness: 0.5, roughness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const sat = new THREE.Group();
      const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.55), matCascoSat);
      const pIzq = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.04, 0.42), matPanelSat);
      pIzq.position.x = -0.85;
      const pDer = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.04, 0.42), matPanelSat);
      pDer.position.x = 0.85;
      const faro = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0x39ff14, toneMapped: false }));
      faro.position.y = 0.36;
      sat.add(cuerpo, pIzq, pDer, faro);
      sat.userData.faro = faro;
      const ang = i * TAU / 3;
      sat.position.set(Math.cos(ang) * 13.6, 0, Math.sin(ang) * 13.6);
      pivoteSats.add(sat);
      satelites.push(sat);
    }
  }

  /* ==================== PLANETA NATAL DE LA INVASIÓN ==================== */
  const P_NATAL = new THREE.Vector3(-210, 75, -170);
  const planetaNatal = new THREE.Group();
  planetaNatal.position.copy(P_NATAL);
  {
    const texNatal = pintarGas(512, 256, {
      semilla: 313,
      paleta: [[96, 42, 132], [142, 62, 160], [70, 30, 112], [126, 54, 140], [104, 46, 122]],
      ciclos: 2,
      turbulencia: 0.13,
      mancha: { x: 0.55, y: 0.42, rx: 0.07, ry: 0.06, color: [46, 16, 70] }
    });
    const mallaNatal = new THREE.Mesh(
      new THREE.SphereGeometry(10, 56, 40),
      new THREE.MeshPhongMaterial({ map: texNatal, shininess: 8, specular: 0x221a33 })
    );
    planetaNatal.add(mallaNatal);
    const anilloNatal = new THREE.Mesh(
      new THREE.RingGeometry(13.5, 17.5, 72),
      new THREE.MeshBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
    );
    anilloNatal.rotation.x = -Math.PI / 2 + 0.35;
    planetaNatal.add(anilloNatal);
    const auraNatal = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texBrillo, color: 0x8a4fd0,
      transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    auraNatal.scale.set(70, 70, 1);
    planetaNatal.add(auraNatal);
    planetaNatal.userData.malla = mallaNatal;
  }
  escena.add(planetaNatal);

  /* ==================== AGUJERO NEGRO LEJANO (aparición periódica) ==================== */
  const agujero = new THREE.Group();
  const matsAgujero = [];
  {
    /* sombra del horizonte de sucesos: un disco negro que oculta las estrellas */
    const negro = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 }));
    agujero.add(negro);
    matsAgujero.push({ m: negro.material, max: 1 });
    /* disco de acrecimiento inclinado (como Gargantua) */
    const disco1 = new THREE.Mesh(new THREE.TorusGeometry(11, 0.34, 8, 96), new THREE.MeshBasicMaterial({ color: 0xffc07a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    disco1.rotation.x = Math.PI / 2 - 0.42;
    const disco2 = new THREE.Mesh(new THREE.TorusGeometry(13.2, 0.16, 6, 88), new THREE.MeshBasicMaterial({ color: 0xff9a50, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    disco2.rotation.x = Math.PI / 2 - 0.5;
    /* halo vertical: la luz curvada que rodea a la sombra */
    const arco = new THREE.Mesh(new THREE.TorusGeometry(11.6, 0.2, 8, 72), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0xff9a50, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(46, 46, 1);
    agujero.add(disco1, disco2, arco, halo);
    matsAgujero.push({ m: disco1.material, max: 0.95 }, { m: disco2.material, max: 0.6 }, { m: arco.material, max: 0.7 }, { m: halo.material, max: 0.28 });
    agujero.position.set(-430, 150, -540);
    agujero.visible = false;
  }
  escena.add(agujero);

  /* chispas de acreción orbitando el agujero negro */
  const chispasAgujero = (() => {
    const n = 260;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const r = rand(10.2, 13.8);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rand(-0.18, 0.18);
      pos[i * 3 + 2] = Math.sin(a) * r;
      const t = rand(0.4, 1);
      col[i * 3] = t;
      col[i * 3 + 1] = t * rand(0.55, 0.75);
      col[i * 3 + 2] = t * rand(0.2, 0.4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    const puntos = new THREE.Points(g, m);
    agujero.add(puntos);
    return puntos;
  })();
  matsAgujero.push({ m: chispasAgujero.material, max: 0.75 });

  const cicloAgujero = { fase: 'espera', t: rand(20, 40) };

  /* ==================== NAVE NODRIZA ==================== */
  const N = new THREE.Vector3();
  const OFFSET_NODRIZA = new THREE.Vector3(2, 62, -2);
  N.copy(E).add(OFFSET_NODRIZA);
  const nave = new THREE.Group();
  nave.position.copy(N);
  escena.add(nave);
  const piezasNave = {
    luces: [], escaner: null, bahia: null, motores: [], faro: null,
    emergencia: [], matCasco: null, holograma: null, nucleoHolo: null,
    humo: [new THREE.Vector3(9.2, 0.5, 1.0), new THREE.Vector3(-8.6, -0.2, 1.6), new THREE.Vector3(1.3, 3.4, 0.9)],
    fuego: [new THREE.Vector3(8.7, -0.5, -0.8), new THREE.Vector3(-1.6, -4.2, 1.1)]
  };

  {
    const matCasco = new THREE.MeshStandardMaterial({ color: 0x8a92a2, metalness: 0.72, roughness: 1.0, roughnessMap: texPaneles, bumpMap: texPaneles, bumpScale: 0.012 });
    const matCascoOsc = new THREE.MeshStandardMaterial({ color: 0x3c424e, metalness: 0.68, roughness: 0.5 });
    const matPanel = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.55, roughness: 1.0, roughnessMap: texPaneles });
    piezasNave.matCasco = matCasco;

    /* ============ EL ANILLO DE GRAVEDAD (toro de Stanford segmentado) ============ */
    const anillo = new THREE.Group();
    const N_BLOQUES = 24;
    const R_ANILLO = 9;
    const geoBloque = new THREE.BoxGeometry(2.15, 1.15, 1.55);
    for (let i = 0; i < N_BLOQUES; i++) {
      const a = (i * TAU) / N_BLOQUES;
      /* bloque modular habitacional */
      const bloque = new THREE.Mesh(geoBloque, matCasco);
      bloque.position.set(Math.cos(a) * R_ANILLO, 0, Math.sin(a) * R_ANILLO);
      bloque.rotation.y = -a - Math.PI / 2;
      anillo.add(bloque);
      /* junta estructural entre bloques */
      if (i % 2 === 0) {
        const aJ = a + Math.PI / N_BLOQUES;
        const junta = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.3, 1.32), matCascoOsc);
        junta.position.set(Math.cos(aJ) * R_ANILLO, -0.05, Math.sin(aJ) * R_ANILLO);
        junta.rotation.y = -aJ - Math.PI / 2;
        anillo.add(junta);
      }
      /* viga de refuerzo inferior */
      const viga = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 1.9), matPanel);
      viga.position.set(Math.cos(a) * R_ANILLO, -0.72, Math.sin(a) * R_ANILLO);
      viga.rotation.y = -a;
      anillo.add(viga);
      /* tanques periféricos y paneles solares alternos */
      if (i % 4 === 1) {
        const tanque = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 10), matCascoOsc);
        tanque.position.set(Math.cos(a) * (R_ANILLO + 1.05), 0.25, Math.sin(a) * (R_ANILLO + 1.05));
        anillo.add(tanque);
      }
      if (i % 4 === 3) {
        const placaSolar = new THREE.Mesh(
          new THREE.BoxGeometry(1.15, 0.05, 2.3),
          new THREE.MeshStandardMaterial({ color: 0x1d3550, metalness: 0.4, roughness: 0.6, emissive: 0x0a1c33, emissiveIntensity: 0.5 })
        );
        placaSolar.position.set(Math.cos(a) * (R_ANILLO + 1.02), -0.05, Math.sin(a) * (R_ANILLO + 1.02));
        placaSolar.rotation.y = -a;
        anillo.add(placaSolar);
      }
    }
    /* ventanas cálidas del anillo: residencias, laboratorios e invernaderos */
    {
      const nVentanas = 96;
      const geoVentana = new THREE.BoxGeometry(0.36, 0.18, 0.06);
      const matVentana = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      const ventanas = new THREE.InstancedMesh(geoVentana, matVentana, nVentanas);
      const dummyV = new THREE.Object3D();
      const colorV = new THREE.Color();
      for (let i = 0; i < nVentanas; i++) {
        const a = (i * TAU) / nVentanas + rand(-0.03, 0.03);
        dummyV.position.set(Math.cos(a) * (R_ANILLO + 0.8), rand(-0.3, 0.34), Math.sin(a) * (R_ANILLO + 0.8));
        dummyV.rotation.set(0, Math.PI / 2 - a, 0);
        dummyV.updateMatrix();
        ventanas.setMatrixAt(i, dummyV.matrix);
        const t = rand(0.55, 1);
        colorV.setRGB(t, t * rand(0.6, 0.72), t * rand(0.28, 0.4));
        ventanas.setColorAt(i, colorV);
      }
      ventanas.instanceMatrix.needsUpdate = true;
      if (ventanas.instanceColor) ventanas.instanceColor.needsUpdate = true;
      anillo.add(ventanas);
    }
    /* radios estructurales con costillas: giran con el anillo */
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6 + 0.13;
      const radio = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.5, 0.7), matCascoOsc);
      radio.position.set(Math.cos(a) * 5.1, 0, Math.sin(a) * 5.1);
      radio.rotation.y = -a;
      anillo.add(radio);
      for (let k = 0; k < 5; k++) {
        const costilla = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.64, 0.78), matPanel);
        const rr = 2.3 + k * 1.4;
        costilla.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
        costilla.rotation.y = -a;
        anillo.add(costilla);
      }
    }
    /* luces de posición del anillo (navegación giratoria) */
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      const luz = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb45e : 0x8fb8ff, toneMapped: false }));
      luz.position.set(Math.cos(a) * (R_ANILLO + 0.95), 0.65, Math.sin(a) * (R_ANILLO + 0.95));
      anillo.add(luz);
      piezasNave.luces.push(luz);
    }
    nave.add(anillo);
    piezasNave.escaner = anillo;

    /* ============ EJE DE CONEXIÓN CENTRAL (microgravedad) ============ */
    const ejeCentral = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 8.5, 24), matCasco);
    ejeCentral.position.y = 0.4;
    nave.add(ejeCentral);
    for (let i = 0; i < 4; i++) {
      const collar = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.09, 8, 28), matCascoOsc);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = -1.6 + i * 1.7;
      nave.add(collar);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4 + 0.5;
      const conducto = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 8.2, 8), matPanel);
      conducto.position.set(Math.cos(a) * 1.42, 0.5, Math.sin(a) * 1.42);
      nave.add(conducto);
    }
    /* maquinaria expuesta del eje */
    for (let i = 0; i < 12; i++) {
      const a = rand(0, TAU);
      const caja = new THREE.Mesh(new THREE.BoxGeometry(rand(0.2, 0.55), rand(0.15, 0.4), rand(0.2, 0.55)), matPanel);
      caja.position.set(Math.cos(a) * 1.45, rand(-2.5, 3.0), Math.sin(a) * 1.45);
      caja.rotation.y = rand(0, TAU);
      nave.add(caja);
    }

    /* ============ AGUJA DE COMANDO SUPERIOR (fuertemente iluminada) ============ */
    const baseAguja = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.55, 20), matCascoOsc);
    baseAguja.position.y = 4.85;
    const nivel1 = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.6, 18), matCasco);
    nivel1.position.y = 5.45;
    const bandaObservacion = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.09, 8, 26), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, toneMapped: false }));
    bandaObservacion.rotation.x = Math.PI / 2;
    bandaObservacion.position.y = 5.45;
    const nivel2 = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 1.0, 0.55, 16), matCasco);
    nivel2.position.y = 6.0;
    const conoAguja = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.5, 14), matCasco);
    conoAguja.position.y = 6.85;
    const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), matCascoOsc);
    mastil.position.y = 8.1;
    const faroRojo = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4040, toneMapped: false }));
    faroRojo.position.y = 8.85;
    nave.add(baseAguja, nivel1, bandaObservacion, nivel2, conoAguja, mastil, faroRojo);
    piezasNave.faro = faroRojo;
    const nivelesVentanas = [
      { r: 1.42, y: 4.92, n: 14 },
      { r: 1.05, y: 5.52, n: 10 },
      { r: 0.74, y: 6.07, n: 8 }
    ];
    for (const nv of nivelesVentanas) {
      for (let i = 0; i < nv.n; i++) {
        const a = (i * TAU) / nv.n + rand(0, 0.2);
        const ventana = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.15, 0.05), new THREE.MeshBasicMaterial({ color: 0xffc873, toneMapped: false }));
        ventana.position.set(Math.cos(a) * nv.r, nv.y, Math.sin(a) * nv.r);
        ventana.rotation.y = Math.PI / 2 - a;
        nave.add(ventana);
      }
    }

    /* radar de navegación giratorio */
    const radar = new THREE.Group();
    const pieRadar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), matCascoOsc);
    pieRadar.position.y = 0.35;
    const platoRadar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 20), matPanel);
    platoRadar.position.y = 0.75;
    platoRadar.rotation.z = 0.3;
    radar.add(pieRadar, platoRadar);
    radar.position.set(-1.6, 5.6, 0.7);
    nave.add(radar);
    piezasNave.radar = radar;

    /* ============ SISTEMAS DE ACOPLAMIENTO INFERIORES ============ */
    const tambor = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 1.9, 1.3, 22), matCascoOsc);
    tambor.position.y = -4.3;
    nave.add(tambor);
    /* campana invertida: bahía de carga y despliegue */
    const matCampana = matCasco.clone();
    matCampana.side = THREE.DoubleSide;
    const campana = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 3.3, 1.7, 26, 1, true), matCampana);
    campana.position.y = -5.75;
    nave.add(campana);
    const labioBahia = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.14, 8, 32), matCascoOsc);
    labioBahia.rotation.x = Math.PI / 2;
    labioBahia.position.y = -6.55;
    nave.add(labioBahia);
    const nucleoBahia = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb464, transparent: true, opacity: 0.35, toneMapped: false }));
    nucleoBahia.position.y = -6.0;
    nave.add(nucleoBahia);
    piezasNave.canon = nucleoBahia;
    /* brazos mecánicos de carga */
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + 0.7;
      const seg1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.6), matCascoOsc);
      seg1.position.set(Math.cos(a) * 2.4, -4.1, Math.sin(a) * 2.4);
      seg1.rotation.y = -a;
      seg1.rotation.x = 0.5;
      const juntaBrazo = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), matPanel);
      juntaBrazo.position.set(Math.cos(a) * 2.8, -4.75, Math.sin(a) * 2.8);
      const seg2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1.4), matPanel);
      seg2.position.set(Math.cos(a) * 2.8, -5.35, Math.sin(a) * 2.8);
      seg2.rotation.x = 0.65;
      nave.add(seg1, juntaBrazo, seg2);
    }
    /* antenas de la base */
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4 + 1.2;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, rand(0.9, 1.5), 6), matCascoOsc);
      ant.position.set(Math.cos(a) * 1.65, -3.5, Math.sin(a) * 1.65);
      ant.rotation.x = Math.sin(a) * 0.3;
      ant.rotation.z = -Math.cos(a) * 0.3;
      nave.add(ant);
    }
    /* focos de trabajo cálidos bajo el tambor */
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + 0.8;
      const foco = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb45e, toneMapped: false }));
      foco.position.set(Math.cos(a) * 1.95, -3.55, Math.sin(a) * 1.95);
      nave.add(foco);
    }
    /* propulsores de maniobra laterales */
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + 0.5;
      const soporte = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), matPanel);
      soporte.position.set(Math.cos(a) * 2.35, -4.3, Math.sin(a) * 2.35);
      soporte.rotation.y = -a;
      const brillo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0x8fb8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      brillo.position.set(Math.cos(a) * 2.6, -4.5, Math.sin(a) * 2.6);
      brillo.scale.set(1.4, 1.4, 1);
      nave.add(soporte, brillo);
      piezasNave.motores.push(brillo);
    }
    /* luces rojas de emergencia (visibles cuando hay daños) */
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6 + 0.3;
      const yE = i < 3 ? 2.4 : -3.6;
      const rE = i < 3 ? 1.5 : 2.15;
      const emerg = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }));
      emerg.position.set(Math.cos(a) * rE, yE, Math.sin(a) * rE);
      emerg.visible = false;
      nave.add(emerg);
      piezasNave.emergencia.push(emerg);
    }
    /* baliza holográfica sobre la aguja de mando */
    const holograma = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 1.5, 22, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8fd4ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    );
    holograma.position.y = 9.85;
    holograma.rotation.x = Math.PI;
    nave.add(holograma);
    piezasNave.holograma = holograma;
    const nucleoHolo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0x9fe8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    nucleoHolo.scale.set(1.3, 1.3, 1);
    nucleoHolo.position.y = 9.2;
    nave.add(nucleoHolo);
    piezasNave.nucleoHolo = nucleoHolo;

    /* ============ PLATAFORMA LOGÍSTICA CON CONTENEDORES ============ */
    const plataforma = new THREE.Group();
    const basePlat = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.26, 3.2), matCascoOsc);
    plataforma.add(basePlat);
    for (let k = 0; k < 3; k++) {
      const vigaP = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.1, 0.14), matPanel);
      vigaP.position.set(0, -0.2, -1.1 + k * 1.1);
      plataforma.add(vigaP);
    }
    {
      const N_CONT = 18;
      const coloresCont = [new THREE.Color(0x8a4a3a), new THREE.Color(0x9a8a6a), new THREE.Color(0x4a6a8a), new THREE.Color(0x707884)];
      const geoCont = new THREE.BoxGeometry(1.02, 0.6, 0.84);
      const matCont = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.7 });
      const contenedores = new THREE.InstancedMesh(geoCont, matCont, N_CONT);
      const dummyC = new THREE.Object3D();
      let idx = 0;
      for (let ix = 0; ix < 4 && idx < N_CONT; ix++) {
        for (let iz = 0; iz < 3 && idx < N_CONT; iz++) {
          const niveles = 1 + ((ix + iz) % 2);
          for (let nv = 0; nv < niveles && idx < N_CONT; nv++) {
            dummyC.position.set(-1.6 + ix * 1.08 + rand(-0.03, 0.03), 0.44 + nv * 0.63, -0.95 + iz * 0.95 + rand(-0.03, 0.03));
            dummyC.rotation.set(0, rand(-0.05, 0.05), 0);
            dummyC.updateMatrix();
            contenedores.setMatrixAt(idx, dummyC.matrix);
            contenedores.setColorAt(idx, alAzar(coloresCont));
            idx++;
          }
        }
      }
      contenedores.instanceMatrix.needsUpdate = true;
      if (contenedores.instanceColor) contenedores.instanceColor.needsUpdate = true;
      plataforma.add(contenedores);
    }
    for (let i = 0; i < 2; i++) {
      const baliza = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffb45e, toneMapped: false }));
      baliza.position.set(i ? 2.2 : -2.2, 0.28, 0);
      plataforma.add(baliza);
    }
    plataforma.position.set(-16, -4, 9);
    plataforma.rotation.y = 0.45;
    nave.add(plataforma);

    /* ============ TRANSBORDADORES DE RECONOCIMIENTO ============ */
    piezasNave.transbordadores = [];
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Group();
      const cascoT = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.26, 0.95), matCasco);
      t.add(cascoT);
      const alaT = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.35), matCascoOsc);
      alaT.position.set(0, 0.02, -0.25);
      t.add(alaT);
      const cabina = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, toneMapped: false }));
      cabina.position.set(0, 0.13, 0.42);
      t.add(cabina);
      const motorT = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0x9fe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      motorT.position.set(0, 0, -0.58);
      motorT.scale.set(0.55, 0.55, 1);
      t.add(motorT);
      nave.add(t);
      piezasNave.transbordadores.push({ obj: t, ang: rand(0, TAU), vel: rand(0.12, 0.26) * (i % 2 ? -1 : 1), radio: 13.5 + i * 1.5, alt: rand(-2.5, 2.5) });
    }

    /* destello cálido de la bahía al desplegar naves */
    const bahia = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0xffc27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    bahia.position.y = -6.9;
    bahia.scale.set(5, 5, 1);
    nave.add(bahia);
    piezasNave.bahia = bahia;

    const luzNave = new THREE.PointLight(0xff9a50, 0.8, 34, 2);
    luzNave.position.set(0, -6.5, 0);
    nave.add(luzNave);
  }

  /* sombras realistas: las piezas grandes de la nodriza proyectan sobre su propio casco */
  nave.traverse((h) => {
    if (!h.isMesh) return;
    h.receiveShadow = true;
    if (h.material && h.material.transparent) return;
    if (h.geometry && h.geometry.boundingSphere === null) h.geometry.computeBoundingSphere();
    if (h.geometry.boundingSphere && h.geometry.boundingSphere.radius >= 0.4) h.castShadow = true;
  });

  /* ==================== CAZAS ALIENÍGENAS ==================== */
  const matCuerpoAlien = new THREE.MeshStandardMaterial({ color: 0x9aa8c8, metalness: 0.8, roughness: 0.32 });
  const matAroAlien = new THREE.MeshStandardMaterial({ color: 0x5f74c9, metalness: 0.7, roughness: 0.4 });
  const matCristalAlien = new THREE.MeshPhongMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0.6, shininess: 90, specular: 0xffffff });
  const matNucleoAlien = new THREE.MeshBasicMaterial({ color: 0xbff4ff, toneMapped: false });
  const matLuzAlien = new THREE.MeshBasicMaterial({ color: 0xff5d8f, toneMapped: false });
  const matBrilloAlien = new THREE.SpriteMaterial({ map: texBrillo, color: 0x7fd8ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  const geoCascoAlien = new THREE.SphereGeometry(1.15, 20, 12);
  const geoAroAlien = new THREE.TorusGeometry(1.06, 0.06, 6, 22);
  const geoCupulaAlien = new THREE.SphereGeometry(0.48, 14, 10, 0, TAU, 0, Math.PI / 2);
  const geoNucleoAlien = new THREE.SphereGeometry(0.14, 8, 6);
  const geoLuzAlien = new THREE.SphereGeometry(0.09, 6, 4);

  function construirAlien() {
    const g = new THREE.Group();
    const casco = new THREE.Mesh(geoCascoAlien, matCuerpoAlien);
    casco.scale.y = 0.34;
    const aro = new THREE.Mesh(geoAroAlien, matAroAlien);
    aro.rotation.x = Math.PI / 2;
    const cupula = new THREE.Mesh(geoCupulaAlien, matCristalAlien);
    cupula.position.y = 0.17;
    const nucleo = new THREE.Mesh(geoNucleoAlien, matNucleoAlien);
    nucleo.position.y = 0.24;
    g.add(casco, aro, cupula, nucleo);
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3;
      const luz = new THREE.Mesh(geoLuzAlien, matLuzAlien);
      luz.position.set(Math.cos(a) * 0.86, 0, Math.sin(a) * 0.86);
      g.add(luz);
    }
    const brillo = new THREE.Sprite(matBrilloAlien);
    brillo.scale.set(2.6, 2.6, 1);
    brillo.position.y = -0.05;
    g.add(brillo);
    return g;
  }

  /* ==================== NAVES DE ZP-53 (cruceros estilo Interestelar) ==================== */
  const matBlancoNave = new THREE.MeshStandardMaterial({ color: 0xd9dfe9, metalness: 0.55, roughness: 0.42 });
  const matOscuroNave = new THREE.MeshStandardMaterial({ color: 0x3a4256, metalness: 0.6, roughness: 0.5 });
  const geoAnilloNave = new THREE.TorusGeometry(1.7, 0.08, 8, 56);
  const geoPodNave = new THREE.BoxGeometry(0.42, 0.36, 0.52);
  const geoRadiNave = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
  const geoFuselajeNave = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 16);
  const geoToberaNave = new THREE.CylinderGeometry(0.16, 0.24, 0.3, 10);

  function construirNaveHumana() {
    const nave = new THREE.Group();
    /* anillo giratorio (gravedad artificial, como la Endurance) */
    const giro = new THREE.Group();
    giro.add(new THREE.Mesh(geoAnilloNave, matBlancoNave));
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8;
      const pod = new THREE.Mesh(geoPodNave, matBlancoNave);
      pod.position.set(Math.cos(a) * 1.7, Math.sin(a) * 1.7, 0);
      pod.rotation.z = a + Math.PI / 2;
      giro.add(pod);
      if (i % 2 === 0) {
        const radi = new THREE.Mesh(geoRadiNave, matOscuroNave);
        radi.position.set(Math.cos(a) * 0.85, Math.sin(a) * 0.85, 0);
        radi.rotation.z = a - Math.PI / 2;
        radi.scale.y = 1.7;
        giro.add(radi);
      }
    }
    nave.add(giro);
    /* fuselaje central */
    const fuselaje = new THREE.Mesh(geoFuselajeNave, matBlancoNave);
    fuselaje.rotation.x = Math.PI / 2;
    nave.add(fuselaje);
    const morro = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12, 0, TAU, 0, Math.PI / 2), matOscuroNave);
    morro.rotation.x = Math.PI / 2;
    morro.position.z = 0.6;
    nave.add(morro);
    /* toberas y llamas de motor */
    const llamas = [];
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + 0.5;
      const tobera = new THREE.Mesh(geoToberaNave, matOscuroNave);
      tobera.rotation.x = Math.PI / 2;
      tobera.position.set(Math.cos(a) * 0.28, Math.sin(a) * 0.28, -0.75);
      nave.add(tobera);
      const llama = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0x9fe8ff, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
      llama.position.set(Math.cos(a) * 0.28, Math.sin(a) * 0.28, -1.05);
      llama.scale.set(0.9, 0.9, 1);
      nave.add(llama);
      llamas.push(llama);
    }
    nave.userData.giro = giro;
    nave.userData.llamas = llamas;
    return nave;
  }

  let navesHumanas = [];
  let tNaveHumana = 5;

  function lanzarNaveHumana() {
    if (navesHumanas.length >= 3) return;
    const obj = construirNaveHumana();
    const origen = new THREE.Vector3();
    zpMalla.getWorldPosition(origen);
    obj.position.copy(origen);
    const mision = Math.random() < 0.55 ? 'escolta' : 'asalto';
    navesHumanas.push({
      obj,
      mision,
      estado: 'viaje',
      objetivo: mision === 'escolta' ? E : P_NATAL,
      dir: new THREE.Vector3(rand(-1, 1), rand(-0.4, 0.4), rand(-1, 1)).normalize(),
      vel: mision === 'escolta' ? rand(10, 14) : rand(34, 42),
      ang: rand(0, TAU),
      hsp: rand(0.22, 0.34) * (Math.random() < 0.5 ? 1 : -1),
      u: null, v: null,
      t: 0,
      disparo: rand(2, 4),
      vida: mision === 'escolta' ? rand(30, 42) : rand(20, 28)
    });
    escena.add(obj);
    SONIDO.lanzamiento();
    crearChispas(origen, 10, [[0.7, 1, 0.9], [1, 1, 1], [0.6, 0.9, 1]], 4, 0.5, 0.8);
  }

  function actualizarNavesHumanas(dt) {
    for (let i = navesHumanas.length - 1; i >= 0; i--) {
      const h = navesHumanas[i];
      h.t += dt;
      h.vida -= dt;
      h.obj.userData.giro.rotation.z += 1.4 * dt;
      const pulso = h.estado === 'viaje' ? 1.3 : 0.9;
      for (const llama of h.obj.userData.llamas) {
        llama.material.opacity = 0.45 + 0.3 * Math.abs(Math.sin(tGlobal * 9 + h.t));
        llama.scale.set(pulso, pulso, 1);
      }
      if (h.estado === 'viaje') {
        const hacia = _v1.copy(h.objetivo).sub(h.obj.position);
        const dist = hacia.length();
        hacia.normalize();
        h.dir.lerp(hacia, Math.min(1, dt * 1.4)).normalize();
        h.obj.position.addScaledVector(h.dir, h.vel * dt);
        h.obj.lookAt(_v2.copy(h.obj.position).add(h.dir));
        if (h.mision === 'escolta' && dist < 27) {
          h.estado = 'patrulla';
          const plano = planoAleatorio();
          h.u = plano.u; h.v = plano.v;
        } else if (h.mision === 'asalto' && dist < 42) {
          h.estado = 'asaltando';
          const plano = planoAleatorio();
          h.u = plano.u; h.v = plano.v;
        }
        if (h.vida <= 0) h.estado = 'regreso';
      } else if (h.estado === 'patrulla') {
        /* escolta a la Tierra: orbita y defiende */
        h.ang += h.hsp * dt;
        const rr = 25 + Math.sin(h.t * 0.7) * 2;
        h.obj.position.copy(E).addScaledVector(h.u, Math.cos(h.ang) * rr).addScaledVector(h.v, Math.sin(h.ang) * rr);
        h.obj.lookAt(E);
        h.obj.rotateZ(Math.sin(h.ang) * 0.2);
        h.disparo -= dt;
        if (h.disparo <= 0) {
          const vivos = aliens.filter((a) => !a.muerto && a.nace >= 1);
          if (vivos.length) {
            const objetivo = alAzar(vivos);
            objetivo.muerto = tGlobal + 0.22;
            crearRayo(objetivo, -1, null, () => h.obj.position);
            SONIDO.laser();
            h.disparo = rand(2.5, 4.5);
          } else {
            h.disparo = 1;
          }
        }
        if (h.vida <= 0) h.estado = 'regreso';
      } else if (h.estado === 'asaltando') {
        /* sobrevuela el planeta natal alienígena bombardeándolo */
        h.ang += 0.3 * dt;
        h.obj.position.copy(P_NATAL).addScaledVector(h.u, Math.cos(h.ang) * 24).addScaledVector(h.v, Math.sin(h.ang) * 24);
        h.obj.lookAt(P_NATAL);
        h.disparo -= dt;
        if (h.disparo <= 0) {
          const punto = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(10.4).add(P_NATAL);
          crearFlash(punto, 0x39ff14, 3.2, 0.3);
          crearChispas(punto, 8, [[0.35, 1, 0.25], [0.7, 1, 0.6], [1, 1, 1]], 5, 0.5, 0.8);
          SONIDO.laser();
          h.disparo = rand(1.6, 2.6);
        }
        if (h.vida <= 0) h.estado = 'regreso';
      } else if (h.estado === 'regreso') {
        const zpPos = new THREE.Vector3();
        zpMalla.getWorldPosition(zpPos);
        const hacia = _v1.copy(zpPos).sub(h.obj.position);
        const dist = hacia.length();
        hacia.normalize();
        h.dir.lerp(hacia, Math.min(1, dt * 1.4)).normalize();
        h.obj.position.addScaledVector(h.dir, h.vel * 1.25 * dt);
        h.obj.lookAt(_v2.copy(h.obj.position).add(h.dir));
        if (dist < 7) {
          crearFlash(h.obj.position, 0x9fe8ff, 4, 0.35);
          SONIDO.lanzamiento();
          escena.remove(h.obj);
          navesHumanas.splice(i, 1);
          continue;
        }
      }
    }
  }

  /* ==================== ESTADO DE LA BATALLA ==================== */
  const MAX_ALIENS = 6;
  const geoRayoNucleo = new THREE.CylinderGeometry(0.22, 0.22, 1, 6, 1, true);
  const geoRayoHalo = new THREE.CylinderGeometry(0.6, 0.6, 1, 6, 1, true);
  const geoRayoAura = new THREE.CylinderGeometry(1.05, 1.05, 1, 6, 1, true);
  const geoAnilloExplosion = new THREE.RingGeometry(0.85, 1, 40);
  const geoBala = new THREE.SphereGeometry(0.28, 10, 8);
  const geoBalaGrande = new THREE.SphereGeometry(0.65, 14, 10);
  const matBala = new THREE.MeshBasicMaterial({ color: 0xff5040, toneMapped: false });
  const matBalaGrande = new THREE.MeshBasicMaterial({ color: 0xff3838, toneMapped: false });
  const matBrilloBala = new THREE.SpriteMaterial({ map: texBrillo, color: 0xff6b50, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const matBrilloBalaGrande = new THREE.SpriteMaterial({ map: texBrillo, color: 0xff5040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const matEstelaBala = new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const ARRIBA = new THREE.Vector3(0, 1, 0);
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  let aliens = [];
  let proyectiles = [];
  let rayos = [];
  let efectos = [];
  let defensa = 1.0;
  let disparos = 0;
  let flashNodriza = 0;
  let tDespliegue = 1.2;
  let tGranDisparo = 5;
  let tCorazon = 5;
  let tFugaz = 6;
  let slotImpacto = 0;

  /* ---- ciclo de la nave nodriza: ataque → dañada → salto → su planeta → regreso ---- */
  let faseNodriza = 'ataque';
  let vidaNodriza = 5;
  const MAX_VIDA_NODRIZA = 5;
  let tFase = 0;
  let anguloNatal = 0;
  let golpesFlicker = 0;
  let tHumo = 0;
  let tFuego = 0;
  let reparacionT = 0;
  let nodrizaSeFue = false;
  let nodrizaVolvio = false;

  /* ==================== EFECTOS ==================== */
  function crearChispas(pos, n, colores, velMax, vida, tam) {
    const geo = new THREE.BufferGeometry();
    const posiciones = new Float32Array(n * 3);
    const coloresArr = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      posiciones[i * 3] = pos.x;
      posiciones[i * 3 + 1] = pos.y;
      posiciones[i * 3 + 2] = pos.z;
      const a = rand(0, TAU), b = Math.acos(rand(-1, 1)), sp = rand(velMax * 0.25, velMax);
      vel[i * 3] = Math.sin(b) * Math.cos(a) * sp;
      vel[i * 3 + 1] = Math.cos(b) * sp;
      vel[i * 3 + 2] = Math.sin(b) * Math.sin(a) * sp;
      const c = alAzar(colores);
      coloresArr[i * 3] = c[0];
      coloresArr[i * 3 + 1] = c[1];
      coloresArr[i * 3 + 2] = c[2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(coloresArr, 3));
    const mat = new THREE.PointsMaterial({ size: tam, vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const puntos = new THREE.Points(geo, mat);
    escena.add(puntos);
    efectos.push({ tipo: 'chispas', obj: puntos, vel, t: 0, vida });
  }

  function crearFlash(pos, color, escala, vida) {
    const mat = new THREE.SpriteMaterial({ map: texBrillo, color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.set(0.5, 0.5, 1);
    escena.add(s);
    efectos.push({ tipo: 'flash', obj: s, t: 0, vida, escala });
  }

  function crearAnillo(pos, color, rMax, vida) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    const anillo = new THREE.Mesh(geoAnilloExplosion, mat);
    anillo.position.copy(pos);
    escena.add(anillo);
    efectos.push({ tipo: 'anillo', obj: anillo, t: 0, vida, rMax });
  }

  function crearCorazon(pos, tinte, escala) {
    const mat = new THREE.SpriteMaterial({ map: texCorazon, color: tinte, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.set(escala, escala, 1);
    escena.add(s);
    efectos.push({ tipo: 'corazon', obj: s, t: 0, vida: rand(4, 6.5), vy: rand(1.2, 2.6), fase: rand(0, TAU), fv: rand(0.8, 1.6) });
  }

  function crearFugaz() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const raya = new THREE.Mesh(geoRayoNucleo, mat);
    raya.position.set(rand(-250, 250), rand(80, 200), rand(-250, 250));
    const vel = new THREE.Vector3(rand(-1, 1), rand(-0.5, -0.2), rand(-1, 1)).normalize().multiplyScalar(rand(55, 95));
    raya.scale.set(1, 12, 1);
    raya.quaternion.setFromUnitVectors(ARRIBA, vel.clone().normalize());
    escena.add(raya);
    efectos.push({ tipo: 'fugaz', obj: raya, vel, t: 0, vida: rand(1, 1.6) });
  }

  /* Humo que sale del casco dañado */
  function crearHumo(pos, escalaIni) {
    const mat = new THREE.SpriteMaterial({ map: texHumo, color: 0x3a3742, transparent: true, opacity: 0.5, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.set(escalaIni, escalaIni, 1);
    escena.add(s);
    efectos.push({ tipo: 'humo', obj: s, t: 0, vida: rand(2.2, 3.4), vy: rand(0.7, 1.3), crece: rand(1.4, 2.2), base: escalaIni });
  }

  /* Escombros metálicos despedidos al recibir un impacto */
  function crearEscombro(pos) {
    const geo = new THREE.BoxGeometry(rand(0.18, 0.5), rand(0.18, 0.5), rand(0.18, 0.5));
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a5578, metalness: 0.7, roughness: 0.5, transparent: true, opacity: 1 });
    const trozo = new THREE.Mesh(geo, mat);
    trozo.position.copy(pos);
    const vel = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5));
    escena.add(trozo);
    efectos.push({ tipo: 'escombro', obj: trozo, vel, gir: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)), t: 0, vida: rand(3, 4.5) });
  }

  /* Portal interdimensional (anillos + vórtice espiral) */
  function crearPortal(pos, vida, dirNormal) {
    const g = new THREE.Group();
    const aro1 = new THREE.Mesh(
      new THREE.TorusGeometry(6.5, 0.28, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x9a5cff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    const aro2 = new THREE.Mesh(
      new THREE.TorusGeometry(5.6, 0.12, 6, 56),
      new THREE.MeshBasicMaterial({ color: 0x6fe4ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    const espiral = new THREE.Sprite(new THREE.SpriteMaterial({ map: texEspiral, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    espiral.scale.set(12, 12, 1);
    g.add(aro1, aro2, espiral);
    g.position.copy(pos);
    if (dirNormal) {
      /* portal-puerta: la nave lo atraviesa volando */
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirNormal.clone().normalize());
    } else {
      /* portal horizontal (poza de energía) */
      g.rotation.x = Math.PI / 2;
    }
    escena.add(g);
    efectos.push({ tipo: 'portal', obj: g, espiral, t: 0, vida });
    SONIDO.portal();
  }

  function explotar(pos) {
    SONIDO.explosion();
    crearChispas(pos, 30, [[1, 0.72, 0.28], [1, 0.45, 0.25], [0.35, 1, 0.25], [1, 1, 1], [0.61, 0.9, 1]], 11, 0.9, 1.3);
    crearAnillo(pos, 0xffaa55, 8.5, 0.55);
    crearFlash(pos, 0xdfffc8, 6.5, 0.28);
  }

  function registrarImpacto(posMundo, fuerte) {
    const dir = _v1.copy(posMundo).sub(E).normalize();
    uniEscudo.uImpactos.value[slotImpacto].set(dir.x, dir.y, dir.z, tGlobal);
    slotImpacto = (slotImpacto + 1) % 6;
    uniEscudo.uFlash.value = Math.min(1.2, uniEscudo.uFlash.value + (fuerte ? 0.85 : 0.35));
  }

  function quitarEfecto(i) {
    const e = efectos[i];
    escena.remove(e.obj);
    if (e.tipo === 'chispas' || e.tipo === 'escombro') {
      e.obj.geometry.dispose();
      e.obj.material.dispose();
    } else if (e.tipo === 'portal') {
      e.obj.traverse((hijo) => {
        if (hijo.geometry) hijo.geometry.dispose();
        if (hijo.material) hijo.material.dispose();
      });
    } else {
      e.obj.material.dispose();
    }
    efectos.splice(i, 1);
  }

  function actualizarEfectos(dt) {
    for (let i = efectos.length - 1; i >= 0; i--) {
      const e = efectos[i];
      e.t += dt;
      const k = clamp(e.t / e.vida, 0, 1);
      if (e.tipo === 'chispas') {
        const amort = Math.exp(-1.9 * dt);
        const arr = e.obj.geometry.attributes.position.array;
        for (let j = 0; j < arr.length; j += 3) {
          arr[j] += e.vel[j] * dt;
          arr[j + 1] += e.vel[j + 1] * dt;
          arr[j + 2] += e.vel[j + 2] * dt;
          e.vel[j] *= amort;
          e.vel[j + 1] *= amort;
          e.vel[j + 2] *= amort;
        }
        e.obj.geometry.attributes.position.needsUpdate = true;
        e.obj.material.opacity = 1 - k;
      } else if (e.tipo === 'anillo') {
        e.obj.scale.setScalar(lerp(0.6, e.rMax, easeOut(k)));
        e.obj.material.opacity = 0.95 * (1 - k);
        e.obj.quaternion.copy(camara.quaternion);
      } else if (e.tipo === 'flash') {
        const t = lerp(0.5, e.escala, easeOut(k));
        e.obj.scale.set(t, t, 1);
        e.obj.material.opacity = 0.95 * (1 - k);
      } else if (e.tipo === 'corazon') {
        e.obj.position.y += e.vy * dt;
        e.fase += e.fv * dt;
        e.obj.position.x += Math.sin(e.fase) * 1.6 * dt;
        e.obj.material.opacity = Math.min(1, e.t * 1.6, (e.vida - e.t) * 1.1) * 0.92;
      } else if (e.tipo === 'fugaz') {
        e.obj.position.addScaledVector(e.vel, dt);
        e.obj.material.opacity = 0.85 * (1 - k);
      } else if (e.tipo === 'humo') {
        e.obj.position.y += e.vy * dt;
        const esc = e.base + e.crece * k * 3;
        e.obj.scale.set(esc, esc, 1);
        e.obj.material.opacity = 0.5 * (1 - k);
      } else if (e.tipo === 'escombro') {
        e.obj.position.addScaledVector(e.vel, dt);
        e.obj.rotation.x += e.gir.x * dt;
        e.obj.rotation.y += e.gir.y * dt;
        e.obj.material.opacity = 1 - k;
      } else if (e.tipo === 'portal') {
        const escala = k < 0.15 ? suavizar(k / 0.15) : (k > 0.85 ? suavizar((1 - k) / 0.15) : 1);
        e.obj.scale.setScalar(Math.max(0.02, escala));
        e.espiral.material.rotation += dt * 5;
        e.obj.rotateZ(dt * 0.6);
      } else if (e.tipo === 'estela') {
        e.obj.material.opacity = 0.9 * (1 - k);
        const est = 2.2 * (1 - k * 0.5);
        e.obj.scale.set(est, 68, est);
      }
      if (e.t >= e.vida) quitarEfecto(i);
    }
  }

  /* ==================== DESPLIEGUE Y ATAQUES ==================== */
  function planoAleatorio() {
    const normal = new THREE.Vector3(0, 1, 0)
      .applyAxisAngle(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize(), rand(0.12, 0.5) * alAzar([1, -1]));
    let u = new THREE.Vector3(1, 0, 0).addScaledVector(normal, -normal.x);
    if (u.lengthSq() < 1e-4) u.set(0, 0, 1);
    u.normalize();
    const v = new THREE.Vector3().crossVectors(normal, u);
    return { u, v };
  }

  function desplegarAlien() {
    const plano = planoAleatorio();
    const a = {
      obj: construirAlien(),
      estado: 'vuelo', nace: 0, t: rand(0, TAU),
      vel: rand(9, 13),
      hoverR: ESCUDO_R + rand(3.5, 9.5),
      u: plano.u, v: plano.v, ang: rand(0, TAU),
      hsp: rand(0.22, 0.42) * alAzar([1, -1]),
      disparo: rand(0.9, 2.1),
      muerto: 0,
      serp: new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize()
    };
    a.obj.position.copy(N);
    a.obj.position.y -= 7.2;
    escena.add(a.obj);
    aliens.push(a);
    flashNodriza = 1;
    crearChispas(a.obj.position, 8, [[0.75, 0.55, 1], [0.61, 0.9, 1]], 4.5, 0.5, 0.8);
  }

  function alienInicial() {
    desplegarAlien();
    const a = aliens[aliens.length - 1];
    a.nace = 1;
    a.estado = 'ronda';
    a.obj.scale.setScalar(1);
    a.ang = rand(0, TAU);
    a.obj.position.copy(E).addScaledVector(a.u, Math.cos(a.ang) * a.hoverR).addScaledVector(a.v, Math.sin(a.ang) * a.hoverR);
    flashNodriza = 0;
  }

  function dispararAlien(a) {
    const vel = _v1.copy(E).sub(a.obj.position).normalize().clone().multiplyScalar(rand(11, 16));
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(geoBala, matBala));
    const brillo = new THREE.Sprite(matBrilloBala);
    brillo.scale.set(1.7, 1.7, 1);
    obj.add(brillo);
    /* estela del proyectil */
    const estela = new THREE.Mesh(geoRayoNucleo, matEstelaBala);
    estela.quaternion.setFromUnitVectors(ARRIBA, vel.clone().normalize());
    estela.scale.set(0.4, 2.8, 0.4);
    estela.position.addScaledVector(vel.clone().normalize(), -1.4);
    obj.add(estela);
    obj.position.copy(a.obj.position);
    escena.add(obj);
    proyectiles.push({ obj, vel, grande: false });
    SONIDO.disparoAlien();
    crearChispas(a.obj.position, 3, [[1, 0.4, 0.3]], 2.5, 0.3, 0.6);
  }

  function disparoGrande() {
    const vel = _v1.copy(E).sub(N).normalize().clone().multiplyScalar(9);
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(geoBalaGrande, matBalaGrande));
    const brillo = new THREE.Sprite(matBrilloBalaGrande);
    brillo.scale.set(4.2, 4.2, 1);
    obj.add(brillo);
    obj.position.copy(N);
    obj.position.y -= 7.0;
    escena.add(obj);
    proyectiles.push({ obj, vel, grande: true });
    flashNodriza = 1;
    SONIDO.granDisparo();
  }

  /* ==================== DEFENA TERRESTRE ==================== */
  function puntoOrigenRayo(rayo, objetivo, destino) {
    if (rayo.sat >= 0) {
      satelites[rayo.sat].getWorldPosition(destino);
      return destino;
    }
    const dir = _v2.copy(objetivo.obj.position).sub(E).normalize();
    return destino.copy(E).addScaledVector(dir, 6.15);
  }

  function crearRayo(a, sat, destino, origenFn) {
    const matN = new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const matH = new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const matA = new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const nucleo = new THREE.Mesh(geoRayoNucleo, matN);
    const halo = new THREE.Mesh(geoRayoHalo, matH);
    const aura = new THREE.Mesh(geoRayoAura, matA);
    const impacto = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0x9dff7a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    const origen = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrillo, color: 0x39ff14, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    escena.add(nucleo, halo, aura, impacto, origen);
    rayos.push({ a, t: 0, vida: 0.22, sat, nucleo, halo, aura, impacto, origen, matN, matH, matA, destino: destino || null, origenFn: origenFn || null });
    SONIDO.laser();
  }

  function retirarRayo(r) {
    escena.remove(r.nucleo, r.halo, r.aura, r.impacto, r.origen);
    r.matN.dispose();
    r.matH.dispose();
    r.matA.dispose();
    r.impacto.material.dispose();
    r.origen.material.dispose();
  }

  function actualizarDefensa(dt) {
    defensa -= dt;
    if (defensa <= 0) {
      const rondando = aliens.filter((a) => !a.muerto && a.nace >= 1 && a.estado === 'ronda');
      const vivos = rondando.length ? rondando : aliens.filter((a) => !a.muerto && a.nace >= 1);
      const golpearNave = faseNodriza === 'ataque' && (disparos % 4 === 3 || !vivos.length);
      if (golpearNave) {
        /* el rayo verde golpea el casco de la nave nodriza */
        const destino = new THREE.Vector3(nave.position.x + rand(-4, 4), nave.position.y + rand(-0.8, 0.5), nave.position.z + rand(-4, 4));
        crearRayo(null, disparos % 2 === 0 ? (disparos / 2) % 3 : -1, destino);
        disparos++;
        defensa = rand(0.9, 1.5);
      } else if (vivos.length) {
        const obj = alAzar(vivos);
        obj.muerto = tGlobal + 0.22;
        crearRayo(obj, disparos % 2 === 0 ? (disparos / 2) % 3 : -1, null);
        disparos++;
        defensa = rand(1.2, 2.2);
      } else {
        defensa = rand(1.2, 2.2);
      }
    }
  }

  function actualizarRayos(dt) {
    for (let i = rayos.length - 1; i >= 0; i--) {
      const r = rayos[i];
      r.t += dt;
      const al = 1 - clamp(r.t / r.vida, 0, 1);
      if (r.t >= r.vida) {
        if (r.destino) registrarGolpeNodriza(r.destino);
        retirarRayo(r);
        rayos.splice(i, 1);
        continue;
      }
      if (!r.destino && !aliens.includes(r.a)) {
        retirarRayo(r);
        rayos.splice(i, 1);
        continue;
      }
      const dest = r.destino ? r.destino : r.a.obj.position;
      const org = r.origenFn ? _v1.copy(r.origenFn()) : puntoOrigenRayo(r, { obj: { position: dest } }, _v1);
      const dir = _v2.copy(dest).sub(org);
      const len = dir.length() || 1;
      const latido = 1 + 0.18 * Math.sin(tGlobal * 45);
      r.nucleo.position.copy(org).addScaledVector(dir, 0.5);
      r.nucleo.quaternion.setFromUnitVectors(ARRIBA, dir.normalize());
      r.nucleo.scale.set(latido, len, latido);
      r.halo.position.copy(r.nucleo.position);
      r.halo.quaternion.copy(r.nucleo.quaternion);
      r.halo.scale.set(1, len, 1);
      r.aura.position.copy(r.nucleo.position);
      r.aura.quaternion.copy(r.nucleo.quaternion);
      r.aura.scale.set(1, len, 1);
      r.matN.opacity = 0.95 * al;
      r.matH.opacity = 0.3 * al;
      r.matA.opacity = 0.08 * al;
      r.impacto.position.copy(dest);
      const ti = 2.6 * al + 0.4;
      r.impacto.scale.set(ti, ti, 1);
      r.impacto.material.opacity = 0.95 * al;
      r.origen.position.copy(org);
      const to = 1.6 * al + 0.3;
      r.origen.scale.set(to, to, 1);
      r.origen.material.opacity = 0.9 * al;
    }
  }

  /* ==================== NODRIZA, ALIENS Y PROYECTILES ==================== */
  /* ==================== DAÑOS Y CICLO DE LA NODRIZA ==================== */
  function registrarGolpeNodriza(punto) {
    if (faseNodriza !== 'ataque') return;
    vidaNodriza--;
    golpesFlicker = 0.4;
    crearChispas(punto, 22, [[1, 0.8, 0.4], [1, 0.55, 0.2], [1, 1, 1], [0.6, 0.75, 1]], 9, 0.7, 1.1);
    crearFlash(punto, 0xffcc88, 4, 0.22);
    crearAnillo(punto, 0xffaa55, 5, 0.4);
    for (let i = 0; i < 4; i++) crearEscombro(punto);
    for (let i = 0; i < 3; i++) {
      const humoPos = punto.clone();
      humoPos.y += rand(0.2, 0.8);
      crearHumo(humoPos, rand(0.8, 1.4));
    }
    if (vidaNodriza <= 2) {
      for (const l of piezasNave.emergencia) l.visible = true;
    }
    if (vidaNodriza <= 0) {
      faseNodriza = 'danada';
      tFase = 0;
    }
  }

  function emitirHumo(dt, cadencia) {
    tHumo -= dt;
    if (tHumo <= 0) {
      const punto = alAzar(piezasNave.humo);
      const pos = punto.clone().add(nave.position);
      crearHumo(pos, rand(0.9, 1.6));
      tHumo = cadencia;
    }
  }

  function emitirFuego(dt) {
    tFuego -= dt;
    if (tFuego <= 0) {
      const punto = alAzar(piezasNave.fuego);
      const pos = punto.clone().add(nave.position);
      pos.x += rand(-0.5, 0.5);
      pos.z += rand(-0.5, 0.5);
      crearFlash(pos, 0xff7733, rand(1.2, 2.4), 0.22);
      tFuego = 0.07;
    }
  }

  function animarLucesNodriza(dt, rapidez) {
    for (let i = 0; i < piezasNave.luces.length; i++) {
      piezasNave.luces[i].scale.setScalar(0.55 + 0.55 * Math.abs(Math.sin(tGlobal * rapidez + i * 0.65)));
    }
    piezasNave.faro.scale.setScalar(0.7 + 0.5 * Math.abs(Math.sin(tGlobal * rapidez * 1.4)));
    piezasNave.bahia.material.opacity = flashNodriza * 0.85;
    const tb = 2.2 + 2.6 * flashNodriza;
    piezasNave.bahia.scale.set(tb, tb, 1);
    const sputter = (faseNodriza === 'danada' || faseNodriza === 'salto');
    for (let i = 0; i < piezasNave.motores.length; i++) {
      piezasNave.motores[i].material.opacity = sputter
        ? 0.12 + 0.38 * Math.abs(Math.sin(tGlobal * 13 + i * 2.4))
        : 0.42 + 0.25 * Math.sin(tGlobal * 7 + i * 2.1);
    }
    if (piezasNave.holograma) {
      piezasNave.holograma.rotation.y += 0.6 * dt;
      const viva = faseNodriza === 'ataque' || faseNodriza === 'regreso';
      piezasNave.holograma.material.opacity = viva ? 0.07 + 0.05 * Math.abs(Math.sin(tGlobal * 2)) : 0.02;
      piezasNave.nucleoHolo.material.opacity = viva ? 0.35 + 0.2 * Math.abs(Math.sin(tGlobal * 2)) : 0.08;
    }
    if (piezasNave.radar) piezasNave.radar.rotation.y += 0.5 * dt;
    if (piezasNave.canon) piezasNave.canon.material.opacity = 0.3 + flashNodriza * 0.55;
    /* transbordadores de reconocimiento orbitando la estación */
    if (piezasNave.transbordadores) {
      for (const tr of piezasNave.transbordadores) {
        tr.ang += tr.vel * dt;
        tr.obj.position.set(Math.cos(tr.ang) * tr.radio, tr.alt + Math.sin(tGlobal * 0.8 + tr.ang) * 0.35, Math.sin(tr.ang) * tr.radio);
        tr.obj.lookAt(nave.position);
        tr.obj.rotateZ(Math.sin(tGlobal * 0.5 + tr.ang) * 0.15);
      }
    }
    flashNodriza = Math.max(0, flashNodriza - dt * 2.0);
  }

  function actualizarNodriza(dt) {
    tFase += dt;

    /* parpadeo del casco tras cada impacto */
    if (golpesFlicker > 0) {
      golpesFlicker -= dt;
      piezasNave.matCasco.emissive.setHex(Math.random() < 0.5 ? 0x662200 : 0x000000);
      if (golpesFlicker <= 0) piezasNave.matCasco.emissive.setHex(0x000000);
    }

    /* luces rojas de emergencia */
    const emergenciaVisible = vidaNodriza <= 2 && faseNodriza !== 'ausente';
    for (let i = 0; i < piezasNave.emergencia.length; i++) {
      const l = piezasNave.emergencia[i];
      l.visible = emergenciaVisible;
      const vel = faseNodriza === 'ataque' ? 2.5 : 7;
      l.scale.setScalar(0.6 + 0.5 * Math.abs(Math.sin(tGlobal * vel + i * 0.9)));
    }

    if (faseNodriza === 'ataque') {
      nave.position.y = N.y + Math.sin(tGlobal * 0.5) * 1.6;
      nave.position.x = N.x + Math.sin(tGlobal * 0.23) * 1.4;
      nave.rotation.z = Math.sin(tGlobal * 0.21) * 0.05;
      nave.rotation.x = Math.sin(tGlobal * 0.17) * 0.04;
      nave.rotation.y += 0.04 * dt;
      const resp = Math.sin(tGlobal * 0.9) * 0.01;
      nave.scale.set(1 + resp, 1 + resp * 1.4, 1 + resp);
      piezasNave.escaner.rotation.y = tGlobal * 0.45;
      animarLucesNodriza(dt, 2.6);
      if (vidaNodriza <= 3) emitirHumo(dt, 0.5);
      tDespliegue -= dt;
      if (aliens.length < MAX_ALIENS && tDespliegue <= 0) {
        desplegarAlien();
        tDespliegue = rand(1.7, 3.4);
      }
      tGranDisparo -= dt;
      if (tGranDisparo <= 0) {
        disparoGrande();
        tGranDisparo = rand(6.5, 11);
      }
    } else if (faseNodriza === 'danada') {
      /* sacudida, humo denso y fuego: la nave queda fuera de combate */
      nave.position.y = N.y + 1.2 + Math.sin(tGlobal * 9) * 0.45;
      nave.position.x = N.x + Math.sin(tGlobal * 7) * 0.3;
      nave.rotation.z = 0.12 + Math.sin(tGlobal * 3) * 0.06;
      nave.rotation.x = 0.1 + Math.sin(tGlobal * 2.3) * 0.05;
      piezasNave.escaner.rotation.y += dt * 0.12;
      animarLucesNodriza(dt, 4.5);
      emitirHumo(dt, 0.09);
      emitirFuego(dt);
      if (tFase > 4) {
        faseNodriza = 'salto';
        tFase = 0;
        /* portal-puerta que apunta hacia su planeta natal */
        const dirNatal = new THREE.Vector3().subVectors(P_NATAL, N).normalize();
        crearPortal(new THREE.Vector3().copy(N).addScaledVector(dirNatal, 17), 3.0, dirNatal);
      }
    } else if (faseNodriza === 'salto') {
      /* carga de energía y despegue WARP hacia su planeta */
      const dirNatal = _v1.copy(P_NATAL).sub(nave.position).normalize();
      if (tFase < 1.4) {
        /* carga: se eleva girando, motores al máximo */
        nave.rotation.y += dt * 2.4;
        nave.position.y += 2.2 * dt;
        emitirHumo(dt, 0.14);
        for (const m of piezasNave.motores) m.material.opacity = 0.7 + 0.25 * Math.sin(tGlobal * 18);
      }
      if (tFase >= 1.4 && !nodrizaSeFue) {
        /* ¡SALTO! estela warp rumbo al planeta natal */
        nodrizaSeFue = true;
        const estela = new THREE.Mesh(geoRayoHalo, new THREE.MeshBasicMaterial({ color: 0xb98cff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        estela.position.copy(nave.position).addScaledVector(dirNatal, 34);
        estela.quaternion.setFromUnitVectors(ARRIBA, dirNatal);
        estela.scale.set(2.2, 68, 2.2);
        escena.add(estela);
        efectos.push({ tipo: 'estela', obj: estela, t: 0, vida: 1.2 });
        crearFlash(nave.position, 0xc7a2ff, 16, 0.5);
        SONIDO.warp();
      }
      if (tFase >= 1.4) {
        /* se estira y dispara hacia el planeta, empequeñeciéndose a lo lejos */
        const k2 = clamp((tFase - 1.4) / 1.0, 0, 1);
        nave.quaternion.setFromUnitVectors(ARRIBA, dirNatal);
        nave.position.addScaledVector(dirNatal, (60 + 220 * k2) * dt);
        nave.scale.set(1 - k2 * 0.9, 1 + k2 * 2.4, 1 - k2 * 0.9);
      }
      if (tFase > 2.5) {
        /* la onda del salto destruye a los invasores restantes */
        for (const a of aliens) explotar(a.obj.position);
        for (const a of aliens) escena.remove(a.obj);
        aliens.length = 0;
        crearAnillo(N, 0xb98cff, 26, 0.9);
        crearFlash(N, 0xffffff, 10, 0.3);
        nave.visible = false;
        nave.scale.set(1, 1, 1);
        nave.rotation.set(0, 0, 0);
        faseNodriza = 'ausente';
        tFase = 0;
        nodrizaSeFue = false;
      }
    } else if (faseNodriza === 'ausente') {
      /* reparación en su planeta natal */
      nave.visible = true;
      nave.scale.setScalar(0.32);
      anguloNatal += dt * 0.25;
      nave.position.set(
        P_NATAL.x + Math.cos(anguloNatal) * 20,
        P_NATAL.y + 7,
        P_NATAL.z + Math.sin(anguloNatal) * 20
      );
      nave.rotation.y += dt * 0.6;
      piezasNave.escaner.rotation.y += dt * 0.3;
      reparacionT -= dt;
      if (reparacionT <= 0) {
        crearChispas(nave.position, 8, [[0.4, 1, 0.45], [0.7, 1, 0.8], [1, 1, 1]], 3.5, 0.7, 0.9);
        reparacionT = rand(0.8, 1.6);
      }
      if (tFase > 13) {
        faseNodriza = 'regreso';
        tFase = 0;
        nodrizaVolvio = false;
        crearPortal(new THREE.Vector3(N.x, N.y + 3.5, N.z), 3.2);
        crearFlash(new THREE.Vector3(N.x, N.y + 3.5, N.z), 0x9a5cff, 8, 0.5);
      }
    } else if (faseNodriza === 'regreso') {
      /* emerge del salto interdimensional sobre la Tierra */
      nave.visible = true;
      nave.rotation.y += dt * 5;
      if (tFase <= 0.9) {
        nave.scale.setScalar(0.05);
        nave.position.set(N.x, N.y + 3.5, N.z);
      } else {
        const k2 = clamp((tFase - 0.9) / 0.8, 0, 1);
        nave.scale.setScalar(0.05 + 0.95 * suavizar(k2));
        nave.position.set(N.x, N.y + 3.5 - k2 * 3.5, N.z);
      }
      animarLucesNodriza(dt, 2.6);
      if (tFase > 1.5 && !nodrizaVolvio) {
        crearFlash(nave.position, 0xc7a2ff, 12, 0.4);
        crearAnillo(nave.position, 0x6fe4ff, 18, 0.8);
        nodrizaVolvio = true;
      }
      if (tFase > 2.4) {
        nave.scale.setScalar(1);
        nave.rotation.set(0, 0, 0);
        vidaNodriza = MAX_VIDA_NODRIZA;
        for (const l of piezasNave.emergencia) l.visible = false;
        faseNodriza = 'ataque';
        tFase = 0;
        tDespliegue = 0.3;
        tGranDisparo = rand(4, 6);
        alienInicial();
        alienInicial();
        alienInicial();
      }
    }
  }

  function actualizarAliens(dt) {
    for (let i = aliens.length - 1; i >= 0; i--) {
      const a = aliens[i];
      a.nace = Math.min(1, a.nace + dt * 2.4);
      if (a.muerto && tGlobal >= a.muerto) {
        explotar(a.obj.position);
        escena.remove(a.obj);
        aliens.splice(i, 1);
        continue;
      }
      a.obj.scale.setScalar(0.25 + 0.75 * rebote(a.nace));
      const hacia = _v1.copy(E).sub(a.obj.position);
      const dist = hacia.length() || 1;
      if (a.estado === 'vuelo') {
        hacia.normalize();
        a.obj.position.addScaledVector(hacia, a.vel * dt);
        a.obj.position.addScaledVector(a.serp, Math.sin(a.t * 3) * 1.8 * dt);
        if (dist <= a.hoverR) {
          a.estado = 'ronda';
          const rel = _v2.copy(a.obj.position).sub(E);
          a.ang = Math.atan2(rel.dot(a.v), rel.dot(a.u));
        }
      } else {
        a.ang += a.hsp * dt;
        const rr = a.hoverR + Math.sin(a.t * 1.6) * 1.4;
        a.obj.position.copy(E)
          .addScaledVector(a.u, Math.cos(a.ang) * rr)
          .addScaledVector(a.v, Math.sin(a.ang) * rr);
        a.obj.lookAt(E);
        a.obj.rotateZ(-Math.sign(a.hsp) * 0.35);
        a.obj.rotateY(a.t * 2.2);
      }
      a.t += dt;
      if (!a.muerto) {
        a.disparo -= dt;
        if (a.disparo <= 0 && a.nace > 0.6) {
          dispararAlien(a);
          a.disparo = rand(1.3, 2.7);
        }
      }
    }
  }

  function actualizarProyectiles(dt) {
    for (let i = proyectiles.length - 1; i >= 0; i--) {
      const p = proyectiles[i];
      p.obj.position.addScaledVector(p.vel, dt);
      if (p.grande && p.obj.children[1]) {
        const s = 4.2 * (1 + 0.18 * Math.sin(tGlobal * 9));
        p.obj.children[1].scale.set(s, s, 1);
      }
      const d = p.obj.position.distanceTo(E);
      if (d <= ESCUDO_R) {
        registrarImpacto(p.obj.position, p.grande);
        crearChispas(p.obj.position, p.grande ? 18 : 9, [[0.61, 0.9, 1], [0.8, 0.97, 1], [1, 1, 1]], p.grande ? 8 : 5, 0.55, 0.9);
        if (p.grande) crearAnillo(p.obj.position, 0x9be7ff, 10, 0.6);
        crearFlash(p.obj.position, 0x9be7ff, p.grande ? 4.5 : 2.2, 0.25);
        escena.remove(p.obj);
        proyectiles.splice(i, 1);
      } else if (Math.abs(p.obj.position.x) > 400 || Math.abs(p.obj.position.y) > 400 || Math.abs(p.obj.position.z) > 400) {
        escena.remove(p.obj);
        proyectiles.splice(i, 1);
      }
    }
  }

  /* ==================== CORAZONES AL ABRIR LA CARTA ==================== */
  window.addEventListener('carta:abierta', (ev) => {
    const px = ev.detail && typeof ev.detail.x === 'number' ? ev.detail.x : window.innerWidth / 2;
    const py = ev.detail && typeof ev.detail.y === 'number' ? ev.detail.y : window.innerHeight / 2;
    const p = new THREE.Vector3((px / window.innerWidth) * 2 - 1, -((py / window.innerHeight) * 2 - 1), 0.5).unproject(camara);
    const colores = [0x39ff14, 0x6dff8a, 0xff7ab8, 0x9be7ff];
    for (let i = 0; i < 16; i++) {
      const pos = p.clone();
      pos.x += rand(-16, 16);
      pos.y += rand(-10, 14);
      pos.z += rand(-8, 8);
      crearCorazon(pos, alAzar(colores), rand(2.2, 3.8));
    }
  });

  /* ==================== BUCLE PRINCIPAL ==================== */
  alienInicial();
  alienInicial();
  alienInicial();

  const reloj = new THREE.Clock();

  function actualizarEscena(dt) {
    /* la Tierra recorre su órbita; el escudo, ZP-53 y los satélites la siguen */
    angTierra += TIERRA_SP * dt;
    posicionTierra(angTierra);
    tierraGrupo.position.copy(E);
    uniEscudo.uCentro.value.copy(E);
    N.copy(E).add(OFFSET_NODRIZA);

    grupoSol.userData.corona1.scale.set(46 + Math.sin(tGlobal * 1.7) * 2.4, 46 + Math.sin(tGlobal * 1.7) * 2.4, 1);
    grupoSol.userData.malla.rotation.y += 0.02 * dt;

    for (const p of planetas) {
      p.ang += p.sp * dt;
      p.malla.position.set(Math.cos(p.ang) * p.d, 0, Math.sin(p.ang) * p.d);
      p.malla.rotation.y += p.giro * dt;
      if (p.pivoteLuna) p.pivoteLuna.rotation.y += 0.3 * dt;
      if (p.pivotesLunas) {
        for (const l of p.pivotesLunas) {
          l.pivote.position.copy(p.malla.position);
          l.pivote.rotation.y += l.vel * dt;
        }
      }
      if (p.veloAnillo) p.veloAnillo.material.opacity = 0.07 + 0.05 * Math.sin(tGlobal * 0.6 + p.d);
    }
    cinturon.rotation.y += 0.006 * dt;
    planetaNatal.userData.malla.rotation.y += 0.035 * dt;

    tierraMalla.rotation.y += 0.12 * dt;
    nubesMalla.rotation.y += 0.17 * dt;
    pivoteLunaHeroe.rotation.y += 0.11 * dt;
    zpMalla.rotation.y += 0.25 * dt;
    for (const est of estacionesZP) {
      est.ang += est.vel * dt;
      est.obj.position.set(Math.cos(est.ang) * est.r, 0.5, Math.sin(est.ang) * est.r);
      est.faro.scale.setScalar(0.7 + 0.5 * Math.abs(Math.sin(tGlobal * 4 + est.ang)));
    }
    pivoteSats.rotation.y += 0.3 * dt;
    for (let i = 0; i < 3; i++) {
      satelites[i].userData.faro.scale.setScalar(0.7 + 0.5 * Math.abs(Math.sin(tGlobal * 5 + i * 2)));
    }

    uniEscudo.uTiempo.value = tGlobal;
    uniEscudo.uFlash.value = Math.max(0, uniEscudo.uFlash.value - dt * 1.4);

    actualizarNodriza(dt);
    actualizarAliens(dt);
    actualizarProyectiles(dt);
    actualizarDefensa(dt);
    actualizarRayos(dt);
    actualizarNavesHumanas(dt);
    actualizarEfectos(dt);

    tNaveHumana -= dt;
    if (tNaveHumana <= 0) {
      lanzarNaveHumana();
      tNaveHumana = rand(9, 15);
    }

    tCorazon -= dt;
    if (tCorazon <= 0) {
      crearCorazon(new THREE.Vector3(E.x + rand(-25, 25), E.y + rand(-25, 10), E.z + rand(-25, 25)), 0xff7ab8, rand(2, 3.4));
      tCorazon = rand(6, 11);
    }
    tFugaz -= dt;
    if (tFugaz <= 0) {
      crearFugaz();
      tFugaz = rand(5, 9);
    }

    /* ciclo del agujero negro lejano */
    const cAgujero = cicloAgujero;
    cAgujero.t -= dt;
    if (cAgujero.fase === 'espera' && cAgujero.t <= 0) {
      cAgujero.fase = 'apareciendo';
      cAgujero.t = 3;
      agujero.visible = true;
      SONIDO.agujero();
    } else if (cAgujero.fase === 'apareciendo') {
      const k = 1 - clamp(cAgujero.t / 3, 0, 1);
      for (const p of matsAgujero) p.m.opacity = p.max * suavizar(k);
      chispasAgujero.rotation.y += dt * 0.6;
      agujero.lookAt(camara.position);
      if (cAgujero.t <= 0) { cAgujero.fase = 'visible'; cAgujero.t = rand(10, 16); }
    } else if (cAgujero.fase === 'visible') {
      matsAgujero[1].m.opacity = matsAgujero[1].max * (0.85 + 0.15 * Math.sin(tGlobal * 2.0));
      chispasAgujero.rotation.y += dt * 0.6;
      agujero.lookAt(camara.position);
      if (cAgujero.t <= 0) { cAgujero.fase = 'desvaneciendo'; cAgujero.t = 3; }
    } else if (cAgujero.fase === 'desvaneciendo') {
      const k = clamp(cAgujero.t / 3, 0, 1);
      for (const p of matsAgujero) p.m.opacity = p.max * suavizar(k);
      agujero.lookAt(camara.position);
      if (cAgujero.t <= 0) { cAgujero.fase = 'espera'; cAgujero.t = rand(55, 90); agujero.visible = false; }
    }
  }

  function animar() {
    requestAnimationFrame(animar);
    const dt = clamp(reloj.getDelta(), 0, 0.05);
    tGlobal += dt;
    actualizarCamara(dt);
    actualizarEscena(dt);
    if (composer) composer.render();
    else renderer.render(escena, camara);
  }
  animar();

  window.addEventListener('resize', () => {
    camara.aspect = window.innerWidth / window.innerHeight;
    camara.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  });
})();
