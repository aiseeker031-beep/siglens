import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Maximize2,
  RotateCcw,
} from 'lucide-react';
import { formatPrice, formatTimestamp } from '../../shared/format';
import type {
  Candle,
  IndicatorSeriesPack,
  OrderBookSnapshot,
  SupportResistanceZone,
} from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';

export type Mode3D =
  | 'candlesticks'
  | 'volume_landscape'
  | 'volatility_surface'
  | 'market_depth'
  | 'indicator_landscape';

export type ZAxisMode = 'volume' | 'volatility' | 'indicator_strength';

interface Chart3DStudioProps {
  candles: Candle[];
  series: IndicatorSeriesPack | null;
  supportResistance: SupportResistanceZone[];
  orderBook: OrderBookSnapshot | null;
  symbol: string;
  timeframe: string;
  height?: number;
  onFallbackTo2D?: () => void;
}

const isSoftwareWebGL = (() => {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
})();

const hasWebGLSupport = (() => {
  if (typeof document === 'undefined') return true;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
})();

// Pre-allocated scratch helpers outside render loop
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

export const Chart3DStudio: React.FC<Chart3DStudioProps> = ({
  candles,
  series,
  supportResistance,
  orderBook,
  symbol,
  timeframe,
  height = 520,
  onFallbackTo2D,
}) => {
  const theme = useAppStore((s) => s.preferences.theme);
  const timezone = useAppStore((s) => s.preferences.timezone);
  const precision = useAppStore((s) => s.preferences.decimalPrecision);
  const reducedMotion = useAppStore((s) => s.preferences.reducedMotion);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [mode, setMode] = useState<Mode3D>('candlesticks');
  const [zAxis, setZAxis] = useState<ZAxisMode>('volume');
  const [cameraType, setCameraType] = useState<'perspective' | 'orthographic'>('perspective');
  const [showEmaLayer, setShowEmaLayer] = useState(true);
  const [showSrLayer, setShowSrLayer] = useState(true);
  const [showVolLayer, setShowVolLayer] = useState(true);
  const [dockOpen, setDockOpen] = useState(true);
  const [webglError, setWebglError] = useState<string | null>(
    hasWebGLSupport ? null : 'WebGL is unavailable on this device or browser.',
  );
  const [inspectedCandle, setInspectedCandle] = useState<{
    index: number;
    candle: Candle;
    rsi: number | null;
    atrPct: number | null;
    rvol: number | null;
  } | null>(null);

  const isDark = useMemo(() => {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, [theme]);

  // Keep visible slice crisp & performant (up to 72 candles)
  const visibleSlice = useMemo(() => {
    const count = Math.min(candles.length, 72);
    const start = candles.length - count;
    return {
      candles: candles.slice(start),
      startOffset: start,
    };
  }, [candles]);

  // Refs to control the persistent Three.js engine without tearing down WebGL on UI changes
  const engineRef = useRef<{
    scene: THREE.Scene;
    dataGroup: THREE.Group;
    renderer: THREE.WebGLRenderer;
    perspCam: THREE.PerspectiveCamera;
    orthoCam: THREE.OrthographicCamera;
    activeCam: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    controls: OrbitControls;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    interactableBodies: THREE.InstancedMesh | null;
    requestRender: () => void;
    resetCamera: () => void;
    exportPng: () => void;
    switchCamera: (t: 'perspective' | 'orthographic') => void;
  } | null>(null);

  const sliceRef = useRef(visibleSlice);
  sliceRef.current = visibleSlice;
  const seriesRef = useRef(series);
  seriesRef.current = series;

  // 1. Mount WebGLRenderer & Scene ONCE
  useEffect(() => {
    const container = mountRef.current;
    if (!container || !hasWebGLSupport) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareWebGL,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      setWebglError('Failed to initialize WebGL2 context.');
      return;
    }

    const width = Math.max(container.clientWidth, 300);
    const h = Math.max(container.clientHeight, height);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareWebGL ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, h);
    renderer.shadowMap.enabled = !isSoftwareWebGL;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const bgHex = isDark ? 0x0b0f14 : 0xf4f7fb;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.Fog(bgHex, 38, 95);

    // Mandatory RoomEnvironment studio reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    // Balanced warm/cool lighting rig
    const hemi = new THREE.HemisphereLight(0xcbe0ff, 0x1b232d, 0.75);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.35);
    keyLight.position.set(16, 24, 18);
    if (!isSoftwareWebGL) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7cc4ff, 0.45);
    rimLight.position.set(-18, 12, -16);
    scene.add(rimLight);

    // Base analytical stage grid
    const grid = new THREE.GridHelper(36, 24, isDark ? 0x2c3a4a : 0xcbd5e1, isDark ? 0x1a232e : 0xe2e8f0);
    grid.position.y = -0.02;
    scene.add(grid);

    // Grounded matte stage floor slightly offset to avoid Z-fighting
    const stageFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 36),
      new THREE.MeshStandardMaterial({
        color: isDark ? 0x10151c : 0xeef2f6,
        roughness: 0.9,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: 1,
      }),
    );
    stageFloor.rotation.x = -Math.PI / 2;
    stageFloor.position.y = -0.05;
    stageFloor.receiveShadow = !isSoftwareWebGL;
    scene.add(stageFloor);

    const dataGroup = new THREE.Group();
    scene.add(dataGroup);

    const aspect = width / h;
    const perspCam = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
    perspCam.position.set(14, 11.5, 22);

    const frustum = 18;
    const orthoCam = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      0.1,
      200,
    );
    orthoCam.position.copy(perspCam.position);

    let activeCam: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspCam;

    const controls = new OrbitControls(activeCam as THREE.Camera, renderer.domElement);
    controls.target.set(0, 4.5, 0);
    controls.enableDamping = !isSoftwareWebGL && !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 6;
    controls.maxDistance = 60;
    controls.update();

    // On-demand coalesced rendering with software-WebGL fence pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      try {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (typeof gl.fenceSync === 'function') {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          const poll = () => {
            if (disposed) return;
            const st = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
            if (st === gl.UNSIGNALED) {
              frameId = window.setTimeout(poll, 5);
            } else {
              if (sync) gl.deleteSync(sync);
              frameId = window.setTimeout(cb, 70);
            }
          };
          frameId = window.setTimeout(poll, 5);
          return;
        }
      } catch {
        // fallback below
      }
      frameId = window.setTimeout(cb, 60);
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        controls.update();
        renderer.render(scene, activeCam);
        const done = () => {
          renderBusy = false;
          if (renderDirty && !disposed) requestRender();
        };
        if (isSoftwareWebGL) afterDraw(done);
        else done();
      });
    };

    controls.addEventListener('change', requestRender);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastRaycastTs = 0;

    const inspectAtEvent = (evt: PointerEvent, force = false) => {
      const now = performance.now();
      if (!force && now - lastRaycastTs < 55) return;
      lastRaycastTs = now;
      const bodyMesh = engineRef.current?.interactableBodies;
      if (!bodyMesh) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, activeCam);
      const hits = raycaster.intersectObject(bodyMesh, false);
      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        const localIdx = hits[0].instanceId;
        const c = sliceRef.current.candles[localIdx];
        if (c) {
          const globalIdx = sliceRef.current.startOffset + localIdx;
          setInspectedCandle({
            index: localIdx,
            candle: c,
            rsi: seriesRef.current?.rsi14[globalIdx] ?? null,
            atrPct: seriesRef.current?.atrPct[globalIdx] ?? null,
            rvol: seriesRef.current?.rvol20[globalIdx] ?? null,
          });
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => inspectAtEvent(e, false);
    const onPointerDown = (e: PointerEvent) => inspectAtEvent(e, true);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    const ro = new ResizeObserver(() => {
      if (!container || disposed) return;
      const w = Math.max(container.clientWidth, 300);
      const nh = Math.max(container.clientHeight, height);
      const a = w / nh;
      perspCam.aspect = a;
      perspCam.updateProjectionMatrix();
      orthoCam.left = (-frustum * a) / 2;
      orthoCam.right = (frustum * a) / 2;
      orthoCam.top = frustum / 2;
      orthoCam.bottom = -frustum / 2;
      orthoCam.updateProjectionMatrix();
      renderer.setSize(w, nh);
      requestRender();
    });
    ro.observe(container);

    engineRef.current = {
      scene,
      dataGroup,
      renderer,
      perspCam,
      orthoCam,
      activeCam,
      controls,
      raycaster,
      pointer,
      interactableBodies: null,
      requestRender,
      resetCamera: () => {
        activeCam.position.set(14, 11.5, 22);
        controls.target.set(0, 4.5, 0);
        controls.update();
        requestRender();
      },
      switchCamera: (t) => {
        const prevPos = activeCam.position.clone();
        activeCam = t === 'orthographic' ? orthoCam : perspCam;
        activeCam.position.copy(prevPos);
        controls.object = activeCam;
        controls.update();
        if (engineRef.current) engineRef.current.activeCam = activeCam;
        requestRender();
      },
      exportPng: () => {
        renderer.render(scene, activeCam);
        const url = renderer.domElement.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `cryptolens-${symbol.replace('/', '-')}-${timeframe}-3d.png`;
        a.click();
      },
    };

    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      ro.disconnect();
      controls.removeEventListener('change', requestRender);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      envTex.dispose();
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
      engineRef.current = null;
    };
  }, [height, isDark, reducedMotion, symbol, timeframe]);

  // 2. Rebuild 3D financial geometry whenever candles, mode, zAxis, or layers change
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    // Dispose previous data meshes cleanly
    while (eng.dataGroup.children.length > 0) {
      const child = eng.dataGroup.children[0];
      eng.dataGroup.remove(child);
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
    }
    eng.interactableBodies = null;

    const list = visibleSlice.candles;
    const offset = visibleSlice.startOffset;
    if (list.length === 0) {
      eng.requestRender();
      return;
    }

    const n = list.length;
    const xSpan = 26;
    const xStep = xSpan / Math.max(1, n - 1);
    const minLow = Math.min(...list.map((c) => c.low));
    const maxHigh = Math.max(...list.map((c) => c.high));
    const priceSpan = Math.max(maxHigh - minLow, 1e-6);
    const maxVol = Math.max(...list.map((c) => c.volume), 1e-6);

    const mapX = (i: number) => -xSpan / 2 + i * xStep;
    const mapY = (p: number) => 1.5 + ((p - minLow) / priceSpan) * 8.5;
    const mapZ = (i: number): number => {
      const globalIdx = offset + i;
      if (zAxis === 'volume') {
        return ((list[i].volume / maxVol) - 0.5) * 6.0;
      }
      if (zAxis === 'volatility') {
        const atrP = series?.atrPct[globalIdx] ?? 1.0;
        return Math.max(-4, Math.min(4, (atrP - 1.2) * 2.0));
      }
      const rsi = series?.rsi14[globalIdx] ?? 50;
      return ((rsi - 50) / 50) * 4.5;
    };

    // Axis guide rails (X: Time, Y: Price, Z: Analytical dimension)
    const axisMat = new THREE.LineBasicMaterial({ color: isDark ? 0x475569 : 0x94a3b8 });
    const axisPts = [
      new THREE.Vector3(-xSpan / 2 - 1, 0.05, -5.5),
      new THREE.Vector3(xSpan / 2 + 1, 0.05, -5.5),
      new THREE.Vector3(-xSpan / 2 - 1, 0.05, -5.5),
      new THREE.Vector3(-xSpan / 2 - 1, 10.5, -5.5),
      new THREE.Vector3(-xSpan / 2 - 1, 0.05, -5.5),
      new THREE.Vector3(-xSpan / 2 - 1, 0.05, 5.5),
    ];
    const axisGeo = new THREE.BufferGeometry().setFromPoints(axisPts);
    eng.dataGroup.add(new THREE.LineSegments(axisGeo, axisMat));

    if (mode === 'candlesticks') {
      const bodyGeo = new THREE.BoxGeometry(Math.min(0.28, xStep * 0.65), 1, 0.34);
      const bodyMat = new THREE.MeshStandardMaterial({
        roughness: 0.32,
        metalness: 0.18,
      });
      const bodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, n);
      bodyInst.frustumCulled = false;

      const wickGeo = new THREE.CylinderGeometry(0.032, 0.032, 1, 6);
      const wickMat = new THREE.MeshStandardMaterial({
        roughness: 0.55,
        metalness: 0.25,
      });
      const wickInst = new THREE.InstancedMesh(wickGeo, wickMat, n);
      wickInst.frustumCulled = false;

      const volGeo = new THREE.BoxGeometry(Math.min(0.22, xStep * 0.52), 1, 0.22);
      const volMat = new THREE.MeshStandardMaterial({
        roughness: 0.65,
        metalness: 0.08,
        transparent: true,
        opacity: 0.72,
      });
      const volInst = new THREE.InstancedMesh(volGeo, volMat, n);
      volInst.frustumCulled = false;

      for (let i = 0; i < n; i++) {
        const c = list[i];
        const x = mapX(i);
        const z = mapZ(i) * 0.65;
        const yOpen = mapY(c.open);
        const yClose = mapY(c.close);
        const yHigh = mapY(c.high);
        const yLow = mapY(c.low);
        const isBull = c.close >= c.open;

        const bodyH = Math.max(0.08, Math.abs(yClose - yOpen));
        _pos.set(x, (yOpen + yClose) / 2, z);
        _scale.set(1, bodyH, 1);
        _mat4.compose(_pos, _quat, _scale);
        bodyInst.setMatrixAt(i, _mat4);
        _color.setHex(isBull ? 0x35c89a : 0xf16b72);
        bodyInst.setColorAt(i, _color);

        const wickH = Math.max(0.1, yHigh - yLow);
        _pos.set(x, (yHigh + yLow) / 2, z);
        _scale.set(1, wickH, 1);
        _mat4.compose(_pos, _quat, _scale);
        wickInst.setMatrixAt(i, _mat4);
        _color.setHex(isBull ? 0x62e0b8 : 0xf7969b);
        wickInst.setColorAt(i, _color);

        const volH = Math.max(0.06, (c.volume / maxVol) * 2.2);
        _pos.set(x, volH / 2, -4.6);
        _scale.set(1, volH, 1);
        _mat4.compose(_pos, _quat, _scale);
        volInst.setMatrixAt(i, _mat4);
        _color.setHex(isBull ? 0x228b6b : 0xb3434a);
        volInst.setColorAt(i, _color);
      }

      bodyInst.instanceMatrix.needsUpdate = true;
      if (bodyInst.instanceColor) bodyInst.instanceColor.needsUpdate = true;
      bodyInst.computeBoundingSphere();

      wickInst.instanceMatrix.needsUpdate = true;
      if (wickInst.instanceColor) wickInst.instanceColor.needsUpdate = true;
      wickInst.computeBoundingSphere();

      volInst.instanceMatrix.needsUpdate = true;
      if (volInst.instanceColor) volInst.instanceColor.needsUpdate = true;
      volInst.computeBoundingSphere();

      eng.dataGroup.add(bodyInst);
      eng.dataGroup.add(wickInst);
      if (showVolLayer) eng.dataGroup.add(volInst);
      eng.interactableBodies = bodyInst;

      // EMA 20 & EMA 50 3D smooth tubes
      if (showEmaLayer && series) {
        const addTube = (arr: (number | null)[], hex: number, zOff: number) => {
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i < n; i++) {
            const v = arr[offset + i];
            if (v !== null && Number.isFinite(v)) {
              pts.push(new THREE.Vector3(mapX(i), mapY(v), zOff));
            }
          }
          if (pts.length >= 3) {
            const curve = new THREE.CatmullRomCurve3(pts);
            const tube = new THREE.Mesh(
              new THREE.TubeGeometry(curve, Math.min(pts.length * 2, 120), 0.055, 6, false),
              new THREE.MeshStandardMaterial({ color: hex, roughness: 0.25, metalness: 0.3 }),
            );
            eng.dataGroup.add(tube);
          }
        };
        addTube(series.ema20, 0x38bdf8, 0.5);
        addTube(series.ema50, 0xf59e0b, -0.5);
      }

      // Translucent Support & Resistance planes
      if (showSrLayer && supportResistance.length > 0) {
        for (const z of supportResistance.slice(0, 4)) {
          if (z.price < minLow || z.price > maxHigh) continue;
          const y = mapY(z.price);
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(xSpan + 1, 7.5),
            new THREE.MeshStandardMaterial({
              color: z.type === 'SUPPORT' ? 0x35c89a : 0xf16b72,
              transparent: true,
              opacity: 0.14,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          );
          plane.rotation.x = -Math.PI / 2;
          plane.position.set(0, y, 0);
          eng.dataGroup.add(plane);
        }
      }
    } else if (mode === 'volume_landscape') {
      const colGeo = new THREE.BoxGeometry(Math.min(0.32, xStep * 0.72), 1, 1.35);
      const colMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.22 });
      const inst = new THREE.InstancedMesh(colGeo, colMat, n);
      inst.frustumCulled = false;

      for (let i = 0; i < n; i++) {
        const c = list[i];
        const h = Math.max(0.15, (c.volume / maxVol) * 9.0);
        const priceNormZ = (((c.close - minLow) / priceSpan) - 0.5) * 8.0;
        _pos.set(mapX(i), h / 2, priceNormZ);
        _scale.set(1, h, 1);
        _mat4.compose(_pos, _quat, _scale);
        inst.setMatrixAt(i, _mat4);
        const rvol = series?.rvol20[offset + i] ?? 1;
        if (rvol >= 1.6) _color.setHex(0xb6f36a);
        else _color.setHex(c.close >= c.open ? 0x35c89a : 0xf16b72);
        inst.setColorAt(i, _color);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      eng.dataGroup.add(inst);
      eng.interactableBodies = inst;
    } else if (mode === 'volatility_surface') {
      // Observed Historical Volatility Surface (Rows: Realized Vol, ATR%, BB Width, Bar Range%)
      const cols = n;
      const rows = 4;
      const geo = new THREE.PlaneGeometry(xSpan, 9, cols - 1, rows - 1);
      geo.rotateX(-Math.PI / 2);

      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(posAttr.count * 3);

      for (let r = 0; r < rows; r++) {
        for (let cIdx = 0; cIdx < cols; cIdx++) {
          const vIdx = r * cols + cIdx;
          const gIdx = offset + cIdx;
          const bar = list[cIdx];
          let metric = 1.0;
          if (r === 0) metric = (series?.atrPct[gIdx] ?? 1.0) * 1.8;
          else if (r === 1) metric = (series?.bbBandwidth[gIdx] ?? 3.0) * 0.55;
          else if (r === 2) metric = ((bar.high - bar.low) / Math.max(bar.open, 1e-6)) * 100 * 1.4;
          else metric = Math.abs((bar.close - bar.open) / Math.max(bar.open, 1e-6)) * 100 * 2.0;

          const y = Math.min(9.5, Math.max(0.2, metric));
          posAttr.setY(vIdx, y);

          const t = Math.min(1, y / 7.5);
          _color.setHSL(0.45 - t * 0.42, 0.72, 0.5);
          colors[vIdx * 3] = _color.r;
          colors[vIdx * 3 + 1] = _color.g;
          colors[vIdx * 3 + 2] = _color.b;
        }
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      const surfMesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.42,
          metalness: 0.15,
          side: THREE.DoubleSide,
        }),
      );
      eng.dataGroup.add(surfMesh);

      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(geo),
        new THREE.LineBasicMaterial({ color: isDark ? 0x1e293b : 0x64748b, transparent: true, opacity: 0.35 }),
      );
      wire.position.y = 0.02;
      eng.dataGroup.add(wire);
    } else if (mode === 'market_depth') {
      const bids = orderBook?.bids ?? [];
      const asks = orderBook?.asks ?? [];
      const allLevels = [
        ...bids.slice().reverse().map((b) => ({ ...b, side: 'bid' as const })),
        ...asks.map((a) => ({ ...a, side: 'ask' as const })),
      ];
      if (allLevels.length > 0) {
        const maxTotal = Math.max(...allLevels.map((l) => l.total), 1e-6);
        const step = xSpan / Math.max(1, allLevels.length - 1);
        const geo = new THREE.BoxGeometry(Math.min(0.45, step * 0.8), 1, 2.8);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.18 });
        const inst = new THREE.InstancedMesh(geo, mat, allLevels.length);
        inst.frustumCulled = false;

        allLevels.forEach((lvl, idx) => {
          const h = Math.max(0.15, (lvl.total / maxTotal) * 8.5);
          const x = -xSpan / 2 + idx * step;
          const z = lvl.side === 'bid' ? -1.8 : 1.8;
          _pos.set(x, h / 2, z);
          _scale.set(1, h, 1);
          _mat4.compose(_pos, _quat, _scale);
          inst.setMatrixAt(idx, _mat4);
          _color.setHex(lvl.side === 'bid' ? 0x35c89a : 0xf16b72);
          inst.setColorAt(idx, _color);
        });
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.computeBoundingSphere();
        eng.dataGroup.add(inst);
      }
    } else if (mode === 'indicator_landscape') {
      // Multi-track 3D indicator ribbons: Track 1 RSI (z=-3.5), Track 2 ADX (z=0), Track 3 MACD Hist (z=+3.5)
      const addTrack = (
        values: (number | null)[],
        zPos: number,
        hex: number,
        normalize: (v: number) => number,
      ) => {
        const geo = new THREE.BoxGeometry(Math.min(0.24, xStep * 0.6), 1, 0.9);
        const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.35, metalness: 0.2 });
        const inst = new THREE.InstancedMesh(geo, mat, n);
        inst.frustumCulled = false;
        for (let i = 0; i < n; i++) {
          const raw = values[offset + i];
          const h = raw !== null ? Math.max(0.1, normalize(raw)) : 0.05;
          _pos.set(mapX(i), h / 2, zPos);
          _scale.set(1, h, 1);
          _mat4.compose(_pos, _quat, _scale);
          inst.setMatrixAt(i, _mat4);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        eng.dataGroup.add(inst);
      };

      if (series) {
        addTrack(series.rsi14, -3.6, 0x38bdf8, (v) => (v / 100) * 7.5);
        addTrack(series.adx14, 0, 0xf59e0b, (v) => Math.min(7.5, (v / 60) * 7.5));
        const maxAbsMacd = Math.max(
          ...series.macdHist
            .slice(offset)
            .map((v) => Math.abs(v ?? 0)),
          1e-6,
        );
        addTrack(series.macdHist, 3.6, 0xb6f36a, (v) => (Math.abs(v) / maxAbsMacd) * 7.0);
      }
    }

    eng.requestRender();
  }, [
    isDark,
    mode,
    orderBook,
    series,
    showEmaLayer,
    showSrLayer,
    showVolLayer,
    supportResistance,
    visibleSlice,
    zAxis,
  ]);

  const handleCameraToggle = (t: 'perspective' | 'orthographic') => {
    setCameraType(t);
    engineRef.current?.switchCamera(t);
  };

  const handleFullscreen = () => {
    if (!wrapperRef.current) return;
    if (!document.fullscreenElement) {
      wrapperRef.current.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  if (webglError) {
    return (
      <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-8 text-center">
        <p className="text-sm font-semibold text-[#17212B] dark:text-[#F4F7FA]">
          3D WebGL Viewport Unavailable
        </p>
        <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-1">{webglError}</p>
        {onFallbackTo2D && (
          <button
            type="button"
            onClick={onFallbackTo2D}
            className="mt-4 px-4 py-2 text-xs font-medium rounded-lg bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14]"
          >
            Switch to 2D Professional Chart
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      data-testid="chart-3d-studio"
      data-mode={mode}
      className="relative w-full rounded-xl overflow-hidden border border-[#E6EBF0] dark:border-[#27313C] bg-[#0B0F14]"
      style={{ height: `${height}px` }}
    >
      {/* Isolated WebGL canvas mount */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top-left minimal spec & axis legend (solid rgba, zero backdrop-filter over WebGL) */}
      <div className="absolute top-3 left-3 pointer-events-none max-w-[340px] rounded-lg px-3 py-2 bg-[#10151C]/92 border border-[#27313C] text-[#F4F7FA]">
        <div className="text-xs font-semibold tracking-tight flex items-center gap-2">
          <span>{symbol} · {timeframe}</span>
          <span className="text-[#8B97A5] font-normal">·</span>
          <span className="text-[#B6F36A] font-mono">
            {mode === 'candlesticks'
              ? '3D Candlesticks'
              : mode === 'volume_landscape'
                ? 'Volume Landscape'
                : mode === 'volatility_surface'
                  ? 'Observed Volatility Surface'
                  : mode === 'market_depth'
                    ? 'Live Order-Book Depth'
                    : 'Indicator Landscape'}
          </span>
        </div>
        <div className="text-[11px] font-mono text-[#8B97A5] mt-0.5">
          X: Time ({visibleSlice.candles.length} bars) · Y: Price · Z:{' '}
          {mode === 'market_depth'
            ? 'Bid/Ask Side'
            : mode === 'volatility_surface'
              ? 'ATR% / BBW / Range'
              : mode === 'indicator_landscape'
                ? 'RSI / ADX / MACD'
                : zAxis === 'volume'
                  ? 'Normalized Volume'
                  : zAxis === 'volatility'
                    ? 'ATR% Volatility'
                    : 'RSI Strength'}
        </div>
        {inspectedCandle && (
          <div className="mt-1.5 pt-1.5 border-t border-[#27313C] text-[11px] font-mono tabular-nums space-y-0.5">
            <div className="text-[#8B97A5]">
              {formatTimestamp(inspectedCandle.candle.openTime, timezone)}
            </div>
            <div>
              O {formatPrice(inspectedCandle.candle.open, precision)} · H{' '}
              {formatPrice(inspectedCandle.candle.high, precision)} · L{' '}
              {formatPrice(inspectedCandle.candle.low, precision)} · C{' '}
              <span
                className={
                  inspectedCandle.candle.close >= inspectedCandle.candle.open
                    ? 'text-[#35C89A]'
                    : 'text-[#F16B72]'
                }
              >
                {formatPrice(inspectedCandle.candle.close, precision)}
              </span>
            </div>
            <div className="text-[#8B97A5]">
              Vol {inspectedCandle.candle.volume.toFixed(2)} · RSI{' '}
              {inspectedCandle.rsi?.toFixed(1) ?? '—'} · ATR%{' '}
              {inspectedCandle.atrPct?.toFixed(2) ?? '—'}%
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Unified Bottom Control Dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(920px,95%)] flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockOpen((v) => !v)}
          className="px-3 py-1 rounded-t-lg bg-[#151B23]/95 border border-b-0 border-[#27313C] text-[11px] font-medium text-[#8B97A5] hover:text-[#F4F7FA] flex items-center gap-1"
        >
          {dockOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          {dockOpen ? 'Hide 3D Controls' : 'Show 3D Controls'}
        </button>

        {dockOpen && (
          <div className="w-full rounded-xl bg-[#151B23]/95 border border-[#27313C] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#F4F7FA]">
            {/* 5 3D Modes */}
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['candlesticks', 'Candlesticks'],
                  ['volume_landscape', 'Volume'],
                  ['volatility_surface', 'Volatility'],
                  ['market_depth', 'Depth'],
                  ['indicator_landscape', 'Indicators'],
                ] as [Mode3D, string][]
              ).map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                    mode === m
                      ? 'bg-[#B6F36A] text-[#0B0F14]'
                      : 'text-[#8B97A5] hover:text-[#F4F7FA] hover:bg-[#1B232D]'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {/* Z-axis & layers */}
            <div className="flex flex-wrap items-center gap-1.5">
              {mode === 'candlesticks' && (
                <>
                  <select
                    aria-label="Z-Axis Dimension"
                    value={zAxis}
                    onChange={(e) => setZAxis(e.target.value as ZAxisMode)}
                    className="px-2 py-1 rounded-md bg-[#1B232D] border border-[#27313C] text-xs text-[#F4F7FA]"
                  >
                    <option value="volume">Z: Volume</option>
                    <option value="volatility">Z: Volatility</option>
                    <option value="indicator_strength">Z: RSI Strength</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowEmaLayer((v) => !v)}
                    className={`px-2 py-1 rounded-md border text-[11px] font-mono ${
                      showEmaLayer ? 'border-[#38BDF8] text-[#38BDF8]' : 'border-[#27313C] text-[#8B97A5]'
                    }`}
                  >
                    EMAs
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSrLayer((v) => !v)}
                    className={`px-2 py-1 rounded-md border text-[11px] font-mono ${
                      showSrLayer ? 'border-[#35C89A] text-[#35C89A]' : 'border-[#27313C] text-[#8B97A5]'
                    }`}
                  >
                    S/R
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowVolLayer((v) => !v)}
                    className={`px-2 py-1 rounded-md border text-[11px] font-mono ${
                      showVolLayer ? 'border-[#B6F36A] text-[#B6F36A]' : 'border-[#27313C] text-[#8B97A5]'
                    }`}
                  >
                    Vol
                  </button>
                </>
              )}

              {/* Camera & actions */}
              <button
                type="button"
                onClick={() =>
                  handleCameraToggle(cameraType === 'perspective' ? 'orthographic' : 'perspective')
                }
                className="px-2 py-1 rounded-md bg-[#1B232D] border border-[#27313C] text-[11px] font-mono text-[#F4F7FA] hover:border-[#B6F36A]"
              >
                {cameraType === 'perspective' ? 'Persp' : 'Ortho'}
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.resetCamera()}
                title="Reset Camera"
                aria-label="Reset 3D camera"
                className="p-1.5 rounded-md bg-[#1B232D] border border-[#27313C] text-[#8B97A5] hover:text-[#F4F7FA]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.exportPng()}
                title="Export 3D Chart PNG"
                aria-label="Export 3D chart image"
                className="p-1.5 rounded-md bg-[#1B232D] border border-[#27313C] text-[#8B97A5] hover:text-[#F4F7FA]"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleFullscreen}
                title="Toggle Fullscreen"
                aria-label="Toggle 3D fullscreen"
                className="p-1.5 rounded-md bg-[#1B232D] border border-[#27313C] text-[#8B97A5] hover:text-[#F4F7FA]"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
