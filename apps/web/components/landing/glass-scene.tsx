'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A picture with liquid-glass panes over it, drawn in WebGL2 so the glass
 * bends the picture behind it in every browser — Safari and Firefox
 * included, where CSS can only frost it.
 *
 * The refraction follows Liquid Glass Studio (github.com/iyinchao/liquid-glass-studio,
 * MIT, © 2024 Charles Yin): each pane is a rounded-rectangle SDF; within a
 * rim of the edge the background is sampled along the surface normal by
 * Snell's law (n = 1.5), split slightly per colour channel, over a blurred
 * copy of the picture; a Fresnel whitening and a glare from the top left
 * finish the edge. Reduced to what a landing page needs: one pass to place
 * the picture, a separable blur, and the glass.
 *
 * Nothing on it moves, so it is drawn once — when it first comes near the
 * screen — and again only when its size changes. There is no frame loop: a
 * full-window glass shader redrawn every frame is what made the hero heavy on
 * a weak graphics chip. The plain <img> underneath is the first paint and
 * what anyone without WebGL sees, with the panes frosted by CSS instead.
 */

export interface GlassTile {
  /** Centre, in % of the scene's width and height. */
  readonly x: number;
  readonly y: number;
  /** Size in CSS px at 1200 px wide; smaller screens scale it down, to no less than 55%. */
  readonly w: number;
  readonly h: number;
  /** Corner radius in CSS px. */
  readonly r?: number;
}

const MAX_TILES = 16;

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** The picture, cover-fitted to the canvas. */
const PLACE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_media;
uniform vec4 u_cover;
out vec4 fragColor;
void main() {
  fragColor = texture(u_media, v_uv * u_cover.xy + u_cover.zw);
}`;

/** One direction of a 9-tap Gaussian; run across, then down, twice. */
const BLUR = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_step;
out vec4 fragColor;
const float W[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
void main() {
  vec4 c = texture(u_tex, v_uv) * W[0];
  for (int i = 1; i < 5; i++) {
    c += texture(u_tex, v_uv + u_step * float(i)) * W[i];
    c += texture(u_tex, v_uv - u_step * float(i)) * W[i];
  }
  fragColor = c;
}`;

const GLASS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_media;
uniform sampler2D u_blur;
uniform vec4 u_cover;
uniform vec2 u_res;
uniform float u_dpr;
uniform vec4 u_rects[${MAX_TILES}];
uniform float u_radius[${MAX_TILES}];
uniform int u_count;
out vec4 fragColor;

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float scene(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${MAX_TILES}; i++) {
    if (i >= u_count) break;
    d = smin(d, sdRoundRect(p - u_rects[i].xy, u_rects[i].zw, u_radius[i]), 10.0 * u_dpr);
  }
  return d;
}

vec2 normalAt(vec2 p) {
  vec2 e = vec2(1.0, 0.0);
  vec2 g = vec2(scene(p + e.xy) - scene(p - e.xy), scene(p + e.yx) - scene(p - e.yx));
  return g / max(length(g), 1e-5);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 sharp = texture(u_media, v_uv * u_cover.xy + u_cover.zw).rgb;
  float d = scene(p);

  if (d > 0.0) {
    // A soft shadow just outside the glass, so it sits above the picture.
    float shadow = (1.0 - smoothstep(0.0, 16.0 * u_dpr, d)) * 0.10;
    fragColor = vec4(sharp * (1.0 - shadow), 1.0);
    return;
  }

  float depth = -d;
  vec2 n = normalAt(p);

  // Snell's law across a rim of the edge: steeper towards the edge, none in the middle.
  float thickness = 22.0 * u_dpr;
  float bend = 0.0;
  if (depth < thickness) {
    float x = 1.0 - depth / thickness;
    float incident = asin(clamp(x * x, 0.0, 0.999));
    float refracted = asin(clamp(sin(incident) / 1.5, 0.0, 0.999));
    bend = -tan(refracted - incident);
  }
  vec2 offset = -n * bend * 26.0 * u_dpr / u_res;

  // A little dispersion: each channel bends a little differently.
  vec3 col = vec3(
    texture(u_blur, v_uv + offset * 0.95).r,
    texture(u_blur, v_uv + offset).g,
    texture(u_blur, v_uv + offset * 1.05).b
  );

  col = mix(col, vec3(1.0), 0.10);
  float fresnel = pow(clamp(1.0 - depth / (10.0 * u_dpr), 0.0, 1.0), 2.0);
  col = mix(col, vec3(1.0), fresnel * 0.45);
  vec2 light = normalize(vec2(-0.6, 0.8));
  float rim = pow(clamp(1.0 - depth / (6.0 * u_dpr), 0.0, 1.0), 1.5);
  col += (pow(max(dot(n, light), 0.0), 3.0) * 0.8 + pow(max(dot(n, -light), 0.0), 3.0) * 0.3) * rim;

  fragColor = vec4(mix(sharp, clamp(col, 0.0, 1.0), smoothstep(0.0, 1.5, depth)), 1.0);
}`;

interface Target {
  readonly fbo: WebGLFramebuffer;
  readonly tex: WebGLTexture;
}

function compile(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('no shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
  return program;
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function target(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const tex = texture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fbo, tex };
}

/** Scale and offset that cover-fit media of one aspect into a canvas of another. */
function cover(canvasAspect: number, mediaAspect: number): [number, number, number, number] {
  if (mediaAspect > canvasAspect) {
    const s = canvasAspect / mediaAspect;
    return [s, 1, (1 - s) / 2, 0];
  }
  const s = mediaAspect / canvasAspect;
  return [1, s, 0, (1 - s) / 2];
}

export function GlassScene({
  image,
  tiles,
  className = '',
  children,
}: {
  /** A raster picture (JPEG, PNG, WebP, AVIF): WebKit uploads an SVG to WebGL only in part, and the rest draws black. */
  image: string;
  tiles: readonly GlassTile[];
  className?: string;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'loading' | 'webgl' | 'css'>('loading');

  useEffect(() => {
    const host = box.current;
    const element = canvas.current;
    if (!host || !element) return;
    let stop = () => {};

    // Nothing is set up until the scene is nearly on screen: below the fold, it costs the page nothing.
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        near.disconnect();
        stop = setUp(host, element, image, tiles, setMode);
      },
      { rootMargin: '50% 0px' },
    );
    near.observe(host);
    return () => {
      near.disconnect();
      stop();
    };
  }, [image, tiles]);

  return (
    <div ref={box} className={`glass-scene ${className}`} data-mode={mode}>
      {/* The first paint, and the fallback, behind the canvas. */}
      <img src={image} alt="" aria-hidden="true" className="glass-scene-media" loading="lazy" decoding="async" />
      {mode === 'css' ? (
        <div className="glass-scene-tiles" aria-hidden="true">
          {tiles.map((tile, index) => (
            <span
              key={index}
              className="glass glass-tile"
              style={{
                left: `${tile.x}%`,
                top: `${tile.y}%`,
                width: `clamp(${(tile.w * 0.55).toFixed(1)}px, ${(tile.w / 12).toFixed(2)}vw, ${tile.w}px)`,
                height: `clamp(${(tile.h * 0.55).toFixed(1)}px, ${(tile.h / 12).toFixed(2)}vw, ${tile.h}px)`,
                borderRadius: `${tile.r ?? 14}px`,
              }}
            />
          ))}
        </div>
      ) : null}
      <canvas ref={canvas} className="glass-scene-canvas" aria-hidden="true" />
      <div className="glass-scene-content">{children}</div>
    </div>
  );
}

/** Compiles the programs, loads the picture and draws it; returns what undoes it. */
function setUp(
  host: HTMLDivElement,
  element: HTMLCanvasElement,
  image: string,
  tiles: readonly GlassTile[],
  setMode: (mode: 'webgl' | 'css') => void,
): () => void {
  const gl = element.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) {
    setMode('css');
    return () => {};
  }
  let place: WebGLProgram;
  let blur: WebGLProgram;
  let glass: WebGLProgram;
  try {
    place = compile(gl, PLACE);
    blur = compile(gl, BLUR);
    glass = compile(gl, GLASS);
  } catch {
    setMode('css');
    return () => {};
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const media = texture(gl);
  let picture: HTMLImageElement | null = null;
  let mediaAspect = 16 / 9;

  let ping: Target | null = null;
  let pong: Target | null = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(1, Math.round(host.clientWidth * dpr));
    height = Math.max(1, Math.round(host.clientHeight * dpr));
    element.width = width;
    element.height = height;
    const half = [Math.max(1, width >> 1), Math.max(1, height >> 1)] as const;
    for (const t of [ping, pong]) {
      if (t) {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      }
    }
    ping = target(gl, half[0], half[1]);
    pong = target(gl, half[0], half[1]);
  };

  const rects = new Float32Array(MAX_TILES * 4);
  const radii = new Float32Array(MAX_TILES);
  const draw = () => {
    if (!picture || !ping || !pong) return;
    const coverBox = cover(width / height, mediaAspect);
    const halfW = Math.max(1, width >> 1);
    const halfH = Math.max(1, height >> 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, ping.fbo);
    gl.viewport(0, 0, halfW, halfH);
    gl.useProgram(place);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, media);
    gl.uniform1i(gl.getUniformLocation(place, 'u_media'), 0);
    gl.uniform4fv(gl.getUniformLocation(place, 'u_cover'), coverBox);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(blur);
    gl.uniform1i(gl.getUniformLocation(blur, 'u_tex'), 0);
    const step = gl.getUniformLocation(blur, 'u_step');
    for (let pass = 0; pass < 4; pass++) {
      const from = pass % 2 === 0 ? ping : pong;
      const to = pass % 2 === 0 ? pong : ping;
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.uniform2f(step, pass % 2 === 0 ? 2 / halfW : 0, pass % 2 === 0 ? 0 : 2 / halfH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const scale = Math.max(0.55, Math.min(1, host.clientWidth / 1200)) * dpr;
    const count = Math.min(tiles.length, MAX_TILES);
    for (let i = 0; i < count; i++) {
      const tile = tiles[i]!;
      rects[i * 4] = (tile.x / 100) * width;
      rects[i * 4 + 1] = height - (tile.y / 100) * height;
      rects[i * 4 + 2] = (tile.w * scale) / 2;
      rects[i * 4 + 3] = (tile.h * scale) / 2;
      radii[i] = Math.min((tile.r ?? 14) * scale, (Math.min(tile.w, tile.h) * scale) / 2);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(glass);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, media);
    gl.uniform1i(gl.getUniformLocation(glass, 'u_media'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ping.tex);
    gl.uniform1i(gl.getUniformLocation(glass, 'u_blur'), 1);
    gl.uniform4fv(gl.getUniformLocation(glass, 'u_cover'), coverBox);
    gl.uniform2f(gl.getUniformLocation(glass, 'u_res'), width, height);
    gl.uniform1f(gl.getUniformLocation(glass, 'u_dpr'), dpr);
    gl.uniform4fv(gl.getUniformLocation(glass, 'u_rects'), rects);
    gl.uniform1fv(gl.getUniformLocation(glass, 'u_radius'), radii);
    gl.uniform1i(gl.getUniformLocation(glass, 'u_count'), count);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const loaded = new Image();
  loaded.decoding = 'async';
  loaded.onload = () => {
    picture = loaded;
    mediaAspect = loaded.naturalWidth / loaded.naturalHeight;
    gl.bindTexture(gl.TEXTURE_2D, media);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, loaded);
    draw();
    setMode('webgl');
  };
  loaded.onerror = () => setMode('css');
  loaded.src = image;

  resize();
  // A new size is the only thing that changes the picture: redraw for it, at most once a frame.
  let frame = 0;
  const resized = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      resize();
      draw();
    });
  });
  resized.observe(host);
  const lost = (event: Event) => {
    event.preventDefault();
    setMode('css');
  };
  element.addEventListener('webglcontextlost', lost);

  return () => {
    cancelAnimationFrame(frame);
    resized.disconnect();
    element.removeEventListener('webglcontextlost', lost);
    loaded.onload = null;
  };
}
