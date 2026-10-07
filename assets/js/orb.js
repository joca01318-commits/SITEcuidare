/* Cuidare — esfera orgânica em WebGL (sem bibliotecas).
   Pausa fora da tela, reduz resolução em aparelhos lentos e
   renderiza um quadro estático com prefers-reduced-motion. */
(function () {
  'use strict';

  var NOISE = [
    'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}',
    'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
    'float snoise(vec3 v){',
    '  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);',
    '  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);',
    '  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);',
    '  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;',
    '  i=mod289(i);',
    '  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
    '  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;',
    '  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);',
    '  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);',
    '  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);',
    '  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));',
    '  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
    '  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);',
    '  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
    '  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;',
    '  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;',
    '  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
    '}'
  ].join('\n');

  var ORB_VS = [
    'attribute vec3 aPos;',
    'uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;',
    'uniform float uTime; uniform float uAmp; uniform float uFreq;',
    'varying vec3 vN; varying vec3 vW; varying float vD;',
    NOISE,
    'vec3 displace(vec3 p){',
    '  float n=snoise(p*uFreq+vec3(uTime*0.11,uTime*0.07,0.0))*0.86+snoise(p*uFreq*1.7-vec3(0.0,uTime*0.09,uTime*0.05))*0.14;',
    '  return p*(1.0+uAmp*n);',
    '}',
    'void main(){',
    '  vec3 p=normalize(aPos);',
    '  vec3 t=normalize(cross(p,abs(p.y)<0.99?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0)));',
    '  vec3 b=normalize(cross(p,t));',
    '  float e=0.012;',
    '  vec3 d0=displace(p);',
    '  vec3 d1=displace(normalize(p+t*e));',
    '  vec3 d2=displace(normalize(p+b*e));',
    '  vec3 n=normalize(cross(d1-d0,d2-d0));',
    '  if(dot(n,p)<0.0) n=-n;',
    '  vec4 w=uModel*vec4(d0,1.0);',
    '  vW=w.xyz; vN=normalize((uModel*vec4(n,0.0)).xyz); vD=length(d0)-1.0;',
    '  gl_Position=uProj*uView*w;',
    '}'
  ].join('\n');

  var ORB_FS = [
    'precision mediump float;',
    'varying vec3 vN; varying vec3 vW; varying float vD;',
    'uniform vec3 uCam; uniform vec3 uLight; uniform float uAlpha; uniform float uPhase; uniform float uGlow;',
    'void main(){',
    '  vec3 N=normalize(vN); vec3 V=normalize(uCam-vW); vec3 L=normalize(uLight-vW);',
    '  float ndl=max(dot(N,L),0.0); float ndv=max(dot(N,V),0.0);',
    '  float fres=pow(1.0-ndv,2.3);',
    '  vec3 H=normalize(L+V); float spec=pow(max(dot(N,H),0.0),36.0);',
    '  vec3 deep=vec3(0.035,0.19,0.33); vec3 mid=vec3(0.11,0.45,0.61);',
    '  vec3 cyan=vec3(0.353,0.757,0.882); vec3 ice=vec3(0.88,0.96,0.99);',
    '  vec3 col=mix(deep,mid,smoothstep(0.0,1.0,ndl));',
    '  col=mix(col,cyan,fres*0.85);',
    '  col+=cyan*clamp(vD*1.4,-0.04,0.16);',
    '  float ph=fres*6.0+uPhase*0.25;',
    '  col+=0.05*vec3(sin(ph),sin(ph+2.1),sin(ph+4.2))*fres;',
    '  col+=ice*spec*0.32+cyan*uGlow*fres*0.4;',
    '  float a=uAlpha*mix(0.94,1.0,fres);',
    '  gl_FragColor=vec4(col*a,a);',
    '}'
  ].join('\n');

  var PT_VS = [
    'attribute vec3 aPos; attribute float aSeed;',
    'uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;',
    'uniform float uTime; uniform float uSize;',
    'varying float vA;',
    'void main(){',
    '  vec3 p=aPos+0.04*vec3(sin(uTime*0.4+aSeed*6.28),cos(uTime*0.35+aSeed*4.0),sin(uTime*0.3+aSeed*9.0));',
    '  vec4 v=uView*uModel*vec4(p,1.0);',
    '  gl_Position=uProj*v;',
    '  gl_PointSize=uSize*(0.6+fract(aSeed*7.13))/(-v.z);',
    '  vA=(0.35+0.65*fract(aSeed*3.71))*(0.65+0.35*sin(uTime*1.1+aSeed*20.0));',
    '}'
  ].join('\n');

  var PT_FS = [
    'precision mediump float;',
    'varying float vA; uniform float uAlpha;',
    'void main(){',
    '  float d=length(gl_PointCoord-0.5);',
    '  float a=smoothstep(0.5,0.05,d)*vA*uAlpha*0.75;',
    '  gl_FragColor=vec4(vec3(0.62,0.88,0.96)*a,a);',
    '}'
  ].join('\n');

  /* ---------------- matemática ---------------- */
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
  function model(x, y, z, rx, ry, s) {
    var cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    var T = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
    var RY = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
    var RX = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
    var S = new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
    return mul(T, mul(RY, mul(RX, S)));
  }

  function icosphere(level) {
    var t = (1 + Math.sqrt(5)) / 2;
    var verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(nrm);
    var faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    function nrm(v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
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
    var pos = new Float32Array(verts.length * 3), idx = new Uint16Array(faces.length * 3);
    verts.forEach(function (v, i) { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; });
    faces.forEach(function (f, i) { idx[i * 3] = f[0]; idx[i * 3 + 1] = f[1]; idx[i * 3 + 2] = f[2]; });
    return { pos: pos, idx: idx };
  }

  /* ---------------- WebGL ---------------- */
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

  var api = { setScroll: function () {} };

  api.init = function (canvas, opts) {
    opts = opts || {};
    var gl;
    try {
      gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    } catch (e) { gl = null; }
    if (!gl) { if (opts.onFail) opts.onFail(); return false; }

    var mobile = !!opts.mobile;
    var reduce = !!opts.reduce;
    var orbP, ptP;
    try {
      orbP = program(gl, ORB_VS, ORB_FS);
      ptP = program(gl, PT_VS, PT_FS);
    } catch (err) {
      api.lastError = String(err && err.message || err);
      if (opts.onFail) opts.onFail();
      return false;
    }

    var mesh = icosphere(mobile ? 4 : 5);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.STATIC_DRAW);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    var orbPos = gl.getAttribLocation(orbP.p, 'aPos');

    var COUNT = mobile ? 70 : 160;
    var pts = new Float32Array(COUNT * 4);
    for (var i = 0; i < COUNT; i++) {
      var th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = 1.3 + Math.random() * 1.1;
      pts[i * 4] = r * Math.sin(ph) * Math.cos(th);
      pts[i * 4 + 1] = r * Math.cos(ph) * 0.8;
      pts[i * 4 + 2] = r * Math.sin(ph) * Math.sin(th);
      pts[i * 4 + 3] = Math.random();
    }
    var pbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pbo);
    gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
    var ptPos = gl.getAttribLocation(ptP.p, 'aPos');
    var ptSeed = gl.getAttribLocation(ptP.p, 'aSeed');

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    var FOV = 35 * Math.PI / 180, CAMZ = 6;
    var view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -CAMZ, 1]);
    var proj, layout = { x: 0, y: 0, s: 1, a: 1 };
    var dprCap = mobile ? 1.5 : 1.75;
    var dpr = Math.min(window.devicePixelRatio || 1, dprCap);

    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      var aspect = w / h;
      proj = perspective(FOV, aspect, 0.1, 50);
      var halfH = Math.tan(FOV / 2) * CAMZ, halfW = halfH * aspect;
      if (aspect > 1.15) {
        layout = { x: halfW * 0.47, y: halfH * 0.06, s: Math.min(halfH * 0.58, halfW * 0.32), a: 1 };
      } else if (aspect > 0.8) {
        layout = { x: halfW * 0.5, y: halfH * 0.38, s: halfW * 0.42, a: 0.75 };
      } else {
        layout = { x: halfW * 0.62, y: halfH * 0.56, s: halfW * 0.66, a: 0.62 };
      }
    }

    // estado interativo (suavizado)
    var mouse = { x: 0, y: 0, tx: 0, ty: 0, v: 0 };
    var scroll = 0, scrollT = 0;
    api.setScroll = function (p) { scrollT = p; if (reduce) { scroll = p; draw(lastT); } };

    if (!reduce && !mobile) {
      var lastMX = 0, lastMY = 0;
      window.addEventListener('pointermove', function (e) {
        var nx = (e.clientX / window.innerWidth) * 2 - 1;
        var ny = (e.clientY / window.innerHeight) * 2 - 1;
        mouse.v = Math.min(1, mouse.v + Math.hypot(nx - lastMX, ny - lastMY) * 2.5);
        lastMX = nx; lastMY = ny;
        mouse.tx = nx; mouse.ty = ny;
      }, { passive: true });
    }

    var start = performance.now(), lastT = 0;
    var intro = reduce ? 1 : 0;

    function drawOrb(m, amp, freq, alpha, glow, t) {
      gl.useProgram(orbP.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(orbPos);
      gl.vertexAttribPointer(orbPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.uniformMatrix4fv(orbP.u.uProj, false, proj);
      gl.uniformMatrix4fv(orbP.u.uView, false, view);
      gl.uniformMatrix4fv(orbP.u.uModel, false, m);
      gl.uniform1f(orbP.u.uTime, t);
      gl.uniform1f(orbP.u.uPhase, t);
      gl.uniform1f(orbP.u.uAmp, amp);
      gl.uniform1f(orbP.u.uFreq, freq);
      gl.uniform3f(orbP.u.uCam, 0, 0, CAMZ);
      gl.uniform3f(orbP.u.uLight, mouse.x * 4 - 1.5, -mouse.y * 3 + 3, 5);
      gl.uniform1f(orbP.u.uAlpha, alpha);
      gl.uniform1f(orbP.u.uGlow, glow);
      gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(orbPos);
    }

    function draw(t) {
      if (!proj) return;
      var e = easeOut(intro);
      var a = layout.a * e * (1 - scroll * 0.55);
      var s = layout.s * (0.82 + 0.18 * e) * (1 + scroll * 0.12);
      var cx = layout.x + mouse.x * 0.12;
      var cy = layout.y + scroll * layout.s * 0.9 - mouse.y * 0.08;
      var rx = mouse.y * 0.35 + t * 0.03 + scroll * 0.8;
      var ry = mouse.x * 0.5 + t * 0.06;
      var amp = 0.1 + 0.025 * Math.sin(t * 0.45) + mouse.v * 0.06;

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.depthMask(true);

      drawOrb(model(cx, cy, 0, rx, ry, s), amp, 0.85, a, mouse.v, t);

      // satélites
      var o1 = t * 0.22 + 0.6, o2 = -t * 0.17 + 2.6;
      drawOrb(model(cx + Math.cos(o1) * s * 1.55, cy + Math.sin(o1) * s * 0.45 + s * 0.35, Math.sin(o1) * s * 0.9,
        rx * 1.4, ry * 1.4, s * 0.15), 0.05, 1.2, a, 0.3, t + 10);
      drawOrb(model(cx + Math.cos(o2) * s * 1.35, cy - s * 0.75 + Math.sin(o2) * s * 0.3, Math.sin(o2) * s * 0.8,
        rx, -ry, s * 0.075), 0.05, 1.2, a * 0.9, 0.3, t + 20);

      // partículas
      gl.depthMask(false);
      gl.useProgram(ptP.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, pbo);
      gl.enableVertexAttribArray(ptPos);
      gl.enableVertexAttribArray(ptSeed);
      gl.vertexAttribPointer(ptPos, 3, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(ptSeed, 1, gl.FLOAT, false, 16, 12);
      gl.uniformMatrix4fv(ptP.u.uProj, false, proj);
      gl.uniformMatrix4fv(ptP.u.uView, false, view);
      gl.uniformMatrix4fv(ptP.u.uModel, false, model(cx, cy, 0, rx * 0.4, -t * 0.025 + mouse.x * 0.25, s));
      gl.uniform1f(ptP.u.uTime, t);
      gl.uniform1f(ptP.u.uSize, (mobile ? 16 : 20) * dpr);
      gl.uniform1f(ptP.u.uAlpha, a);
      gl.drawArrays(gl.POINTS, 0, COUNT);
      gl.disableVertexAttribArray(ptPos);
      gl.disableVertexAttribArray(ptSeed);
    }

    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

    // qualidade adaptativa
    var frames = 0, acc = 0, prev = 0, degraded = false, running = false, visible = true, raf = 0, ready = false;

    function frame(now) {
      raf = 0;
      if (!running) return;
      var t = (now - start) / 1000;
      var dt = prev ? now - prev : 16; prev = now;
      intro = Math.min(1, intro + dt / 1800);
      mouse.x += (mouse.tx - mouse.x) * 0.045;
      mouse.y += (mouse.ty - mouse.y) * 0.045;
      mouse.v *= 0.96;
      scroll += (scrollT - scroll) * 0.12;
      lastT = t;
      draw(t);
      if (!ready) { ready = true; if (opts.onReady) opts.onReady(); }

      frames++;
      if (frames > 40 && frames <= 160) acc += dt;
      if (frames === 160) {
        var avg = acc / 120;
        if (avg > 26 && !degraded && dpr > 1) {
          degraded = true; dpr = 1; resize(); frames = 0; acc = 0;
        } else if (avg > 34) {
          stop(); gl.clear(gl.COLOR_BUFFER_BIT); if (opts.onFail) opts.onFail(); return;
        }
      }
      raf = requestAnimationFrame(frame);
    }
    function play() { if (!running && visible && !document.hidden) { running = true; prev = 0; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

    resize();
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { resize(); if (reduce || !running) draw(lastT); }, 100);
    }, { passive: true });

    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stop(); if (opts.onFail) opts.onFail(); });

    if (reduce) {
      draw(4);
      lastT = 4;
      if (opts.onReady) opts.onReady();
      return true;
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) play(); else stop();
      }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else play(); });
    play();
    return true;
  };

  window.CuidareOrb = api;
})();
