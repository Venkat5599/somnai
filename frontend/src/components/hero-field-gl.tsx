"use client";

/**
 * The fold's atmosphere: a single-hue noise field, lit directionally.
 *
 * Adapted from reactbits-pro `hero-3`, which supplies the simplex-noise shader
 * and the cursor coupling. Almost everything around that core was rewritten,
 * for four separate reasons.
 *
 * 1. THE ORIGINAL REBUILT THE RENDERER ON EVERY MOUSE MOVE. Its effect closed
 *    over `mousePosition` state and listed it in the dependency array, so each
 *    pointer event disposed the geometry, material and WebGLRenderer and
 *    constructed a new one — recompiling the shader dozens of times a second.
 *    The mouse is a ref here and the effect runs once. This is a real bug, not
 *    a style preference, and it is the reason this file is an adaptation rather
 *    than an install.
 *
 * 2. THE CANVAS WAS `position: fixed`. A background sheet pinned to the
 *    viewport and dragged behind every section — including under the nav — is
 *    the lazy version of an animated background. This one is absolutely
 *    positioned inside the fold it belongs to, so it is part of that
 *    composition and ends with it.
 *
 * 3. THE COLOUR WAS A RED/GREEN/BLUE WASH. Three independent channel factors
 *    over a noise field produce exactly the drifting multi-hue gradient that
 *    reads as machine-made. PRISM has one accent. So the noise drives
 *    INTENSITY along a single hue instead of hue itself: near-black substrate,
 *    one cyan, raked from the upper left with real falloff. Grain is dithered
 *    in because a smooth gradient of one colour bands badly on a dark screen.
 *
 * 4. IT COULD NOT DEGRADE. Content sits ABOVE this canvas and never depends on
 *    it: if WebGL is unavailable, the context is lost, or the user prefers
 *    reduced motion, the field renders as a static tone or not at all and the
 *    hero is unchanged. Nothing here is load-bearing.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

const VERTEX = `
  varying vec2 vUv;
  void main() {
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    vUv = uv;
  }
`;

/**
 * Simplex noise (Ashima/Gustavson), unchanged — it is the one part of the
 * original worth keeping verbatim. Everything after `main()` is PRISM's.
 */
const FRAGMENT = `
  varying vec2 vUv;
  uniform vec2  uRes;
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uIntensity;
  uniform vec3  uBase;
  uniform vec3  uAccent;

  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v){
    const vec2  C = vec2(1.0/6.0, 1.0/3.0);
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  /** Cheap ordered dither. Breaks the banding a single-hue ramp shows on dark. */
  float grain(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // Correct for aspect so the field does not stretch into stripes on wide
    // viewports — the original sampled raw uv and smeared horizontally.
    vec2 uv = vUv;
    vec2 p = vec2(uv.x * (uRes.x / uRes.y), uv.y);

    // Two octaves is enough for atmosphere. More reads as texture, not light.
    float n =
      snoise(vec3(p * 2.2, uTime * 0.045)) * 0.6 +
      snoise(vec3(p * 4.5, uTime * 0.030)) * 0.4;

    // ONE directional source from the upper left, with real falloff. Not a
    // centred radial bloom — a symmetric halo behind the content is the tell
    // this palette exists to avoid.
    float rake = 1.0 - clamp(distance(uv, vec2(0.06, 0.98)) * 0.92, 0.0, 1.0);
    rake = pow(rake, 2.1);

    // The cursor lifts the field locally. Subtle enough to be felt, not watched.
    float m = 1.0 - clamp(distance(p, vec2(uMouse.x * (uRes.x / uRes.y), uMouse.y)) * 1.6, 0.0, 1.0);

    float energy = clamp(rake * (0.55 + n * 0.45) + m * m * 0.16, 0.0, 1.0);

    // Single hue. The noise moves INTENSITY, never colour, so this can never
    // drift into a multi-hue wash however the parameters are tuned.
    vec3 col = mix(uBase, uAccent, energy * uIntensity);

    col += (grain(gl_FragCoord.xy) - 0.5) * 0.016;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function HeroFieldGL({
  /** Ceiling on how far toward the accent the brightest point travels. */
  intensity = 0.34,
  /** Substrate the field sits on. Defaults to the terminal's near-black. */
  base = "#050505",
  /** The single hue the noise drives intensity along. */
  accent = "#4d7cfe",
  className,
}: {
  intensity?: number;
  base?: string;
  accent?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // A REF, not state. This is the fix for the original's rebuild-per-pointer-
  // event bug: the render loop reads it directly, so moving the mouse never
  // re-runs the effect and never recompiles the shader.
  const mouse = useRef({ x: 0.5, y: 0.62 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    } catch {
      // No WebGL. The hero is already complete without this.
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);

    const uniforms = {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uMouse: { value: new THREE.Vector2(0.5, 0.62) },
      uIntensity: { value: intensity },
      uBase: { value: new THREE.Color(base) },
      uAccent: { value: new THREE.Color(accent) },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    scene.add(new THREE.Mesh(geometry, material));

    // Size from the CONTAINER, not the viewport. The canvas belongs to the
    // fold, so a taller page must not stretch it.
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas.parentElement ?? canvas;
      if (w === 0 || h === 0) return;
      // Capped at 1.5: this is diffuse atmosphere, and full retina resolution
      // costs real battery to render something deliberately out of focus.
      renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
      renderer.setSize(w, h, false);
      uniforms.uRes.value.set(w, h);
    };
    resize();

    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.current = {
        x: (e.clientX - r.left) / r.width,
        y: 1 - (e.clientY - r.top) / r.height,
      };
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    // Stop rendering when the fold is off screen. An animation nobody can see
    // is pure battery cost.
    let visible = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    if (canvas.parentElement) io.observe(canvas.parentElement);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      uniforms.uTime.value = clock.getElapsedTime();
      // Ease toward the pointer so the light trails it rather than snapping.
      const u = uniforms.uMouse.value;
      u.x += (mouse.current.x - u.x) * 0.045;
      u.y += (mouse.current.y - u.y) * 0.045;
      renderer.render(scene, camera);
    };
    tick();

    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("webglcontextlost", onLost);
      ro.disconnect();
      io.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [intensity, base, accent]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      // Absolute, inside the fold. Never `fixed`.
      className={className ?? "absolute inset-0 w-full h-full z-0"}
    />
  );
}
