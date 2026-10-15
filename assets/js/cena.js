/* Cuidare — cena 3D em WebGL, sem bibliotecas: corações e esferas de vidro azul.
   CuidareCena.init(canvas, opts) -> { pulse, setScroll, destroy }
   opts.objects(aspect, halfW, halfH) -> [{ shape: 'heart'|'sphere', x, y, z, s, ry, rx, spin, bob, depth }]
   Pausa fora da tela, reduz a resolução em aparelhos lentos e desenha um quadro
   estático com prefers-reduced-motion. */
(function () {
  'use strict';

  var VS = [
    'attribute vec3 aPos; attribute vec3 aNor;',
    'uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;',
    'uniform float uTime; uniform float uWob;',
    'varying vec3 vN; varying vec3 vW; varying float vY;',
    'void main(){',
    '  float w=1.0+uWob*0.035*sin(uTime*2.1+aPos.y*3.2+aPos.x*2.0);',
    '  vec4 p=uModel*vec4(aPos*w,1.0);',
    '  vW=p.xyz; vN=normalize((uModel*vec4(aNor,0.0)).xyz); vY=aPos.y;',
    '  gl_Position=uProj*uView*p;',
    '}'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'varying vec3 vN; varying vec3 vW; varying float vY;',
    'uniform vec3 uCam; uniform vec3 uLight; uniform float uAlpha; uniform float uGlow; uniform float uBack;',
    'uniform vec3 uShade; uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uRim; uniform vec3 uSpec;',
    'void main(){',
    '  vec3 N=normalize(vN); if(uBack>0.5) N=-N;',
    '  vec3 V=normalize(uCam-vW); vec3 L=normalize(uLight-vW);',
    '  float ndl=max(dot(N,L),0.0); float ndv=clamp(dot(N,V),0.0,1.0);',
    '  float fres=pow(1.0-ndv,2.6);',
    '  vec3 H=normalize(L+V); float nh=max(dot(N,H),0.0);',
    '  float spec=pow(nh,140.0)*1.5+pow(nh,18.0)*0.18;',
    '  vec3 R=reflect(-V,N);',
    '  float env=smoothstep(0.38,0.95,R.y)*0.7+smoothstep(0.6,0.98,R.x*0.55+R.y*0.55)*0.5;',
    '  float g=smoothstep(-1.15,1.0,vY*0.75+N.y*0.5);',
    '  vec3 col=mix(mix(uShade,uDeep,0.6),uMid,g);',
    '  col*=0.6+0.32*(ndl*0.75+0.25);',
    '  col=mix(col,uRim,fres*0.82);',
    '  float under=pow(max(dot(N,normalize(vec3(-0.35,-0.9,0.45))),0.0),3.0);',
    '  col+=uMid*under*0.45+uRim*uGlow*fres*0.45;',
    '  col+=uRim*env*(0.28+0.72*fres)+uSpec*spec;',
    '  float a=mix(0.8,1.0,fres)*uAlpha;',
    '  if(uBack>0.5){ col=mix(uDeep,uMid,0.55)*0.8+uRim*fres*0.3; a*=0.3; }',
    '  float mx=max(col.r,max(col.g,col.b));',
    '  if(mx>1.0) col=mix(col/mx,vec3(1.0),min(1.0,(mx-1.0)*0.75));',
    '  gl_FragColor=vec4(col*a,a);',
    '}'
  ].join('\n');

  var PT_VS = [
    'attribute vec3 aPos; attribute float aSeed;',
    'uniform mat4 uProj; uniform mat4 uView; uniform float uTime; uniform float uSize; uniform vec2 uShift;',
    'varying float vA;',
    'void main(){',
    '  vec3 p=aPos+0.06*vec3(sin(uTime*0.3+aSeed*6.28),cos(uTime*0.26+aSeed*4.0),0.0);',
    '  p.xy+=uShift*(0.4+aSeed);',
    '  vec4 v=uView*vec4(p,1.0);',
    '  gl_Position=uProj*v;',
    '  gl_PointSize=uSize*(0.5+fract(aSeed*7.13))/(-v.z);',
    '  vA=(0.3+0.7*fract(aSeed*3.71))*(0.6+0.4*sin(uTime*0.9+aSeed*20.0));',
    '}'
  ].join('\n');

  var PT_FS = [
    'precision mediump float;',
    'varying float vA; uniform float uAlpha; uniform vec3 uColor;',
    'void main(){',
    '  float d=length(gl_PointCoord-0.5);',
    '  float a=smoothstep(0.5,0.06,d)*vA*uAlpha*0.6;',
    '  gl_FragColor=vec4(uColor*a,a);',
    '}'
  ].join('\n');

  /* ---------- Matemática ---------- */
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function model(x, y, z, rx, ry, rz, s) {
    var cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    var T = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
    var RY = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
    var RX = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
    var RZ = new Float32Array([cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    var S = new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
    return mul(T, mul(RZ, mul(RY, mul(RX, S))));
  }

  /* ---------- Geometria ---------- */
  function icosphere(level) {
    var t = (1 + Math.sqrt(5)) / 2;
    function nrm(v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
    var verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(nrm);
    var faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (var lv = 0; lv < level; lv++) {
      var cache = {};
      var mid = function (a, b) {
        var k = a < b ? a + '_' + b : b + '_' + a;
        if (cache[k] === undefined) {
          var va = verts[a], vb = verts[b];
          verts.push(nrm([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
          cache[k] = verts.length - 1;
        }
        return cache[k];
      };
      var nf = [];
      for (var i = 0; i < faces.length; i++) {
        var f = faces[i], ab = mid(f[0], f[1]), bc = mid(f[1], f[2]), ca = mid(f[2], f[0]);
        nf.push([f[0], ab, ca], [f[1], bc, ab], [f[2], ca, bc], [ab, bc, ca]);
      }
      faces = nf;
    }
    return { verts: verts, faces: faces };
  }

  // Coração: superfície implícita (x² + 9/4·d² + y² − 1)³ − x²·y³ − 9/80·d²·y³ = 0,
  // com y para cima e d em profundidade. Cada vértice da esfera é levado até a superfície.
  function heartF(x, y, d) {
    var q = x * x + 2.25 * d * d + y * y - 1;
    return q * q * q - x * x * y * y * y - 0.1125 * d * d * y * y * y;
  }
  function heartMesh(level) {
    var g = icosphere(level), oy = 0.15;
    var pts = g.verts.map(function (u) {
      var step = 0.02, t = step, prev = 0;
      while (t < 3 && heartF(u[0] * t, u[1] * t + oy, u[2] * t) < 0) { prev = t; t += step; }
      var lo = prev, hi = t;
      for (var k = 0; k < 24; k++) { var m = (lo + hi) / 2; if (heartF(u[0] * m, u[1] * m + oy, u[2] * m) < 0) lo = m; else hi = m; }
      var r = (lo + hi) / 2;
      return [u[0] * r, u[1] * r + oy, u[2] * r];
    });
    // centraliza e normaliza (meia-altura = 1)
    var minY = Infinity, maxY = -Infinity;
    pts.forEach(function (p) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    var cy = (minY + maxY) / 2, sc = 2 / (maxY - minY);
    pts = pts.map(function (p) { return [p[0] * sc, (p[1] - cy) * sc, p[2] * sc]; });
    return build(pts, g.faces, null);
  }
  function sphereMesh(level) {
    var g = icosphere(level);
    return build(g.verts, g.faces, g.verts);
  }
  function build(pts, faces, normals) {
    var n = pts.length, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = new Uint16Array(faces.length * 3);
    pts.forEach(function (p, i) { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; });
    faces.forEach(function (f, i) {
      idx[i * 3] = f[0]; idx[i * 3 + 1] = f[1]; idx[i * 3 + 2] = f[2];
      if (normals) return;
      var a = pts[f[0]], b = pts[f[1]], c = pts[f[2]];
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (var j = 0; j < 3; j++) { nor[f[j] * 3] += nx; nor[f[j] * 3 + 1] += ny; nor[f[j] * 3 + 2] += nz; }
    });
    for (var i = 0; i < n; i++) {
      var x = normals ? normals[i][0] : nor[i * 3], y = normals ? normals[i][1] : nor[i * 3 + 1], z = normals ? normals[i][2] : nor[i * 3 + 2];
      var l = Math.hypot(x, y, z) || 1;
      // garante normais para fora (a malha da esfera define a orientação)
      if (x * pos[i * 3] + y * pos[i * 3 + 1] + z * pos[i * 3 + 2] < 0) l = -l;
      nor[i * 3] = x / l; nor[i * 3 + 1] = y / l; nor[i * 3 + 2] = z / l;
    }
    return { pos: pos, nor: nor, idx: idx };
  }

  function program(gl, vs, fs) {
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p: p, u: u };
  }
  function hex(h) { var n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

  var PALETTE = { shade: '#061A35', deep: '#0757B8', mid: '#1769FF', rim: '#DCEBFF', spec: '#FFFFFF', particle: '#DCEBFF' };

  function init(canvas, opts) {
    opts = opts || {};
    var gl;
    try { gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true }); } catch (e) { gl = null; }
    if (!gl) { if (opts.onFail) opts.onFail(); return null; }

    var mobile = !!opts.mobile, reduce = !!opts.reduce;
    var pal = {}, P = Object.assign({}, PALETTE, opts.palette || {});
    Object.keys(P).forEach(function (k) { pal[k] = hex(P[k]); });

    var prog, pt;
    try { prog = program(gl, VS, FS); pt = program(gl, PT_VS, PT_FS); }
    catch (err) { init.lastError = String(err && err.message || err); if (opts.onFail) opts.onFail(); return null; }

    function upload(m) {
      var b = { n: m.idx.length };
      b.pos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
      b.nor = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b.nor); gl.bufferData(gl.ARRAY_BUFFER, m.nor, gl.STATIC_DRAW);
      b.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      return b;
    }
    var meshes = { heart: upload(heartMesh(4)), sphere: upload(sphereMesh(mobile ? 3 : 4)) };
    var aPos = gl.getAttribLocation(prog.p, 'aPos'), aNor = gl.getAttribLocation(prog.p, 'aNor');

    var COUNT = opts.particles !== undefined ? opts.particles : (mobile ? 40 : 110);
    var pts = new Float32Array(Math.max(COUNT, 1) * 4);
    for (var i = 0; i < COUNT; i++) {
      pts[i * 4] = (Math.random() * 2 - 1) * 7;
      pts[i * 4 + 1] = (Math.random() * 2 - 1) * 4;
      pts[i * 4 + 2] = -Math.random() * 4;
      pts[i * 4 + 3] = Math.random();
    }
    var pbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pbo); gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
    var ptPos = gl.getAttribLocation(pt.p, 'aPos'), ptSeed = gl.getAttribLocation(pt.p, 'aSeed');

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    var FOV = 32 * Math.PI / 180, CAMZ = 8;
    var view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -CAMZ, 1]);
    var proj, objs = [];
    var dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
    var objectsFn = opts.objects || function (aspect, hw, hh) { return [{ shape: 'heart', x: 0, y: 0, z: 0, s: Math.min(hw, hh) * 0.5 }]; };

    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      var aspect = w / h;
      proj = perspective(FOV, aspect, 0.1, 60);
      var halfH = Math.tan(FOV / 2) * CAMZ, halfW = halfH * aspect;
      objs = (objectsFn(aspect, halfW, halfH) || []).map(function (o, k) {
        return Object.assign({ shape: 'heart', x: 0, y: 0, z: 0, s: 1, rx: 0, ry: 0, rz: 0, spin: 0.25, bob: 0.08, depth: 1, phase: k * 1.7, order: k }, o);
      }).sort(function (a, b) { return a.z - b.z; });
    }

    var mouse = { x: 0, y: 0, tx: 0, ty: 0, v: 0 };
    var scroll = 0, scrollT = 0, pulseV = 0;
    function onMove(e) {
      var nx = (e.clientX / window.innerWidth) * 2 - 1, ny = (e.clientY / window.innerHeight) * 2 - 1;
      mouse.v = Math.min(1, mouse.v + Math.hypot(nx - mouse.tx, ny - mouse.ty) * 2);
      mouse.tx = nx; mouse.ty = ny;
    }
    if (!reduce && !mobile && opts.mouse !== false) window.addEventListener('pointermove', onMove, { passive: true });

    var start = performance.now(), lastT = 3, intro = reduce ? 1 : 0, introStart = 0;
    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

    function drawMesh(m, M, alpha, glow, back, t, wob) {
      gl.useProgram(prog.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nor); gl.enableVertexAttribArray(aNor); gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
      gl.uniformMatrix4fv(prog.u.uProj, false, proj);
      gl.uniformMatrix4fv(prog.u.uView, false, view);
      gl.uniformMatrix4fv(prog.u.uModel, false, M);
      gl.uniform1f(prog.u.uTime, t); gl.uniform1f(prog.u.uWob, wob);
      gl.uniform3f(prog.u.uCam, 0, 0, CAMZ);
      gl.uniform3f(prog.u.uLight, mouse.x * 4 - 3, -mouse.y * 3 + 5, 6);
      gl.uniform1f(prog.u.uAlpha, alpha); gl.uniform1f(prog.u.uGlow, glow); gl.uniform1f(prog.u.uBack, back ? 1 : 0);
      gl.uniform3fv(prog.u.uShade, pal.shade); gl.uniform3fv(prog.u.uDeep, pal.deep); gl.uniform3fv(prog.u.uMid, pal.mid);
      gl.uniform3fv(prog.u.uRim, pal.rim); gl.uniform3fv(prog.u.uSpec, pal.spec);
      gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(aPos); gl.disableVertexAttribArray(aNor);
    }

    function draw(t) {
      if (!proj) return;
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var fade = 1 - Math.min(1, scroll) * 0.7;
      objs.forEach(function (o, k) {
        var e = easeOut(Math.max(0, Math.min(1, intro * 1.6 - o.order * 0.12)));
        if (e <= 0) return;
        var d = o.depth;
        var x = o.x + mouse.x * 0.22 * d;
        var y = o.y + Math.sin(t * 0.7 + o.phase) * o.bob - mouse.y * 0.14 * d + scroll * 1.6 * d;
        var s = o.s * (0.7 + 0.3 * e) * (1 + pulseV * 0.07 * (k === 0 ? 1.4 : 1));
        var ry = o.ry + Math.sin(t * o.spin + o.phase) * 0.55 + mouse.x * 0.35;
        var rx = o.rx + Math.sin(t * 0.45 + o.phase) * 0.1 + mouse.y * 0.18;
        var rz = o.rz + Math.sin(t * 0.38 + o.phase * 1.3) * 0.06;
        var M = model(x, y, o.z, rx, ry, rz, s);
        var m = meshes[o.shape] || meshes.heart;
        var a = e * fade, glow = mouse.v * 0.6 + pulseV;
        gl.depthMask(false); gl.cullFace(gl.FRONT); drawMesh(m, M, a, glow, true, t, mouse.v + pulseV);
        gl.depthMask(true); gl.cullFace(gl.BACK); drawMesh(m, M, a, glow, false, t, mouse.v + pulseV);
      });
      if (COUNT > 0) {
        gl.depthMask(false);
        gl.useProgram(pt.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, pbo);
        gl.enableVertexAttribArray(ptPos); gl.enableVertexAttribArray(ptSeed);
        gl.vertexAttribPointer(ptPos, 3, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(ptSeed, 1, gl.FLOAT, false, 16, 12);
        gl.uniformMatrix4fv(pt.u.uProj, false, proj);
        gl.uniformMatrix4fv(pt.u.uView, false, view);
        gl.uniform1f(pt.u.uTime, t);
        gl.uniform2f(pt.u.uShift, mouse.x * 0.12, -mouse.y * 0.08 + scroll * 0.8);
        gl.uniform1f(pt.u.uSize, (mobile ? 18 : 22) * dpr);
        gl.uniform1f(pt.u.uAlpha, easeOut(intro) * fade);
        gl.uniform3fv(pt.u.uColor, pal.particle);
        gl.drawArrays(gl.POINTS, 0, COUNT);
        gl.disableVertexAttribArray(ptPos); gl.disableVertexAttribArray(ptSeed);
        gl.depthMask(true);
      }
    }

    var frames = 0, acc = 0, prev = 0, degraded = false, running = false, visible = true, raf = 0, ready = false, dead = false;
    function frame(now) {
      raf = 0;
      if (!running || dead) return;
      var t = (now - start) / 1000;
      var dt = prev ? Math.min(now - prev, 100) : 16; prev = now;
      if (!introStart) introStart = now + (opts.delay || 0);
      intro = Math.max(0, Math.min(1, (now - introStart) / 2200));
      mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
      mouse.v *= 0.95; pulseV *= 0.93;
      scroll += (scrollT - scroll) * 0.12;
      lastT = t;
      draw(t);
      if (!ready) { ready = true; if (opts.onReady) opts.onReady(); }
      frames++;
      if (frames > 40 && frames <= 160) acc += dt;
      if (frames === 160) {
        var avg = acc / 120;
        if (avg > 26 && !degraded && dpr > 1) { degraded = true; dpr = 1; resize(); frames = 0; acc = 0; }
        else if (avg > 34) { stop(); gl.clear(gl.COLOR_BUFFER_BIT); if (opts.onFail) opts.onFail(); return; }
      }
      raf = requestAnimationFrame(frame);
    }
    function play() { if (!dead && !running && visible && !document.hidden) { running = true; prev = 0; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

    resize();
    var rt;
    function onResize() { clearTimeout(rt); rt = setTimeout(function () { resize(); if (reduce || !running) draw(lastT); }, 100); }
    window.addEventListener('resize', onResize, { passive: true });
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stop(); if (opts.onFail) opts.onFail(); });

    var inst = {
      setScroll: function (p) { scrollT = p; if (reduce) { scroll = p; draw(lastT); } },
      pulse: function () { pulseV = 1; if (reduce) draw(lastT); },
      destroy: function () { dead = true; stop(); window.removeEventListener('resize', onResize); window.removeEventListener('pointermove', onMove); }
    };

    if (reduce) { draw(lastT); if (opts.onReady) opts.onReady(); return inst; }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; if (visible) play(); else stop(); }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else play(); });
    play();
    return inst;
  }

  window.CuidareCena = { init: init, heartMesh: heartMesh };
})();
