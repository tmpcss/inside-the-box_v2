import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ─── Types ────────────────────────────────────────────────────────────────────
type SceneType = 'camera' | 'trailer' | 'fileinput' | 'grid_img' | 'gradient' | 'matrix' | 'turbulent' | 'geo' | 'win98' | 'scanlines' | 'white' | 'kinetic' | 'countdown';
type LightType = 'point' | 'spot' | 'led';

interface FaceConfig {
  id: number;
  name: string;
  scene: SceneType;
  cameraSegment: number; // 0-3 default segment
  mapping: { x: number; y: number; w: number; h: number }; // Normalized UV rect
  params: Record<string, any>; // Per-scene custom settings
  resolution: { w: number; h: number }; // Per-face canvas resolution
}

interface LightPreset {
  name: string;
  lights: LightConfig[];
}

interface LightConfig {
  id: number;
  name: string;
  color: string;
  intensity: number;
  strobe: boolean;
  strobeHz: number;
  type: LightType;
  x: number;
  y: number;
  z: number;
  rotX: number; // degrees
  rotY: number; // degrees
  ledCount?: number;
}

interface LightObjects {
  threeLight: THREE.PointLight | THREE.SpotLight;
  helperMesh: THREE.Mesh;
  helperMat: THREE.MeshBasicMaterial;
  ledGroup?: THREE.Group;
  spotHelper?: THREE.SpotLightHelper;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const BASE_CUBE_SIZE = 3.5;
const HALF = BASE_CUBE_SIZE / 2;

const SCENE_OPTIONS: { value: SceneType; label: string }[] = [
  { value: 'trailer', label: '🎬 Video Principal' },
  { value: 'camera', label: '📹 Cámara Virtual' },
  { value: 'fileinput', label: '📁 Archivo Local' },
  { value: 'grid_img', label: '▦ Grid' },
  { value: 'gradient', label: '🌈 Gradient Wash' },
  { value: 'matrix', label: '💻 Matrix Rain' },
  { value: 'turbulent', label: '🌊 Turbulent Noise' },
  { value: 'geo', label: '🔷 Geo Shapes' },
  { value: 'win98', label: '🖥️ Win98 Glitch' },
  { value: 'scanlines', label: '📺 Scanlines' },
  { value: 'kinetic', label: '🏃 Kinetic Typo' },
  { value: 'countdown', label: '🕙 Countdown 24h' },
  { value: 'white', label: '⬜ Blanco (OFF)' },
];

// ─── Standalone rig builder helpers ──────────────────────────────────────────
function buildPipeRig(group: THREE.Group, HW: number, HH: number, HD: number, FY: number) {
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.3 });
  const nodeMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.2 });

  const makeTube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.04) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(r, r, len, 8);
    const m = new THREE.Mesh(geo, trussMat);
    m.position.copy(a.clone().add(b).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    group.add(m);
  };

  const makeNode = (p: THREE.Vector3, r = 0.08) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 16), nodeMat);
    m.position.copy(p);
    group.add(m);
  };

  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Main 8 corners
  const C = [
    V(-HW, -HH, -HD), V(HW, -HH, -HD), V(HW, -HH, HD), V(-HW, -HH, HD),
    V(-HW, HH, -HD), V(HW, HH, -HD), V(HW, HH, HD), V(-HW, HH, HD),
  ];
  const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  EDGES.forEach(([a, b]) => makeTube(C[a], C[b]));
  C.forEach(c => makeNode(c));

  // Vertical cross-bracing
  [[0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => {
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      const p = C[a].clone().lerp(C[b], t);
      const bg = new THREE.CylinderGeometry(0.015, 0.015, 0.14, 4);
      const bm = new THREE.Mesh(bg, trussMat);
      bm.position.copy(p);
      bm.rotation.z = k % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
      group.add(bm);
    }
  });

  // Ceiling Rig
  const CY = HH + 0.12;
  const CC = [V(-HW, CY, -HD), V(HW, CY, -HD), V(HW, CY, HD), V(-HW, CY, HD)];
  [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]].forEach(([a, b]) => makeTube(CC[a], CC[b], 0.03));
  CC.forEach(c => { makeNode(c, 0.06); makeTube(c, V(c.x, HH, c.z), 0.025); });
  makeTube(V(0, CY, -HD), V(0, CY, HD), 0.025);
  makeTube(V(-HW, CY, 0), V(HW, CY, 0), 0.025);

  // Floor Rig
  const FC2 = [V(-HW, FY, -HD), V(HW, FY, -HD), V(HW, FY, HD), V(-HW, FY, HD)];
  [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([a, b]) => makeTube(FC2[a], FC2[b], 0.03));
  FC2.forEach(c => { makeNode(c, 0.06); makeTube(c, V(c.x, -HH, c.z), 0.025); });
}

function makeTrussSegment(
  group: THREE.Group,
  pointA: THREE.Vector3,
  pointB: THREE.Vector3,
  trussHalfSize = 0.10,
  color = 0x111111
) {
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.2 });
  const chordR = 0.022;
  const webR = 0.014;

  const dir = pointB.clone().sub(pointA);
  const length = dir.length();
  const zAxis = dir.clone().normalize();
  const tempUp = Math.abs(zAxis.dot(new THREE.Vector3(0, 1, 0))) < 0.95
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const xAxis = new THREE.Vector3().crossVectors(tempUp, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  const offsets = [
    xAxis.clone().multiplyScalar(trussHalfSize).add(yAxis.clone().multiplyScalar(trussHalfSize)),
    xAxis.clone().multiplyScalar(-trussHalfSize).add(yAxis.clone().multiplyScalar(trussHalfSize)),
    xAxis.clone().multiplyScalar(-trussHalfSize).add(yAxis.clone().multiplyScalar(-trussHalfSize)),
    xAxis.clone().multiplyScalar(trussHalfSize).add(yAxis.clone().multiplyScalar(-trussHalfSize)),
  ];

  const addTube = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 0.001) return;
    const geo = new THREE.CylinderGeometry(r, r, len, 6);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    group.add(mesh);
  };

  offsets.forEach(off => {
    addTube(pointA.clone().add(off), pointB.clone().add(off), chordR);
  });

  const panelCount = Math.max(2, Math.round(length / 0.5));
  for (let k = 0; k < panelCount; k++) {
    const t0 = k / panelCount;
    const t1 = (k + 1) / panelCount;
    const p0 = pointA.clone().add(dir.clone().multiplyScalar(t0));
    const p1 = pointA.clone().add(dir.clone().multiplyScalar(t1));
    for (let f = 0; f < 4; f++) {
      const o0 = offsets[f];
      const o1 = offsets[(f + 1) % 4];
      addTube(p0.clone().add(o0), p1.clone().add(o1), webR);
      addTube(p0.clone().add(o1), p1.clone().add(o0), webR);
    }
    if (k === 0 || k === panelCount - 1 || k % 2 === 0) {
      const pp = k === 0 ? p0 : p1;
      for (let f = 0; f < 4; f++) {
        addTube(pp.clone().add(offsets[f]), pp.clone().add(offsets[(f + 1) % 4]), webR);
      }
    }
  }
}

function buildTrussRig(group: THREE.Group, HW: number, HH: number, HD: number, FY: number) {
  const nodeMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 });
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  const C = [
    V(-HW, -HH, -HD), V(HW, -HH, -HD), V(HW, -HH, HD), V(-HW, -HH, HD),
    V(-HW, HH, -HD), V(HW, HH, -HD), V(HW, HH, HD), V(-HW, HH, HD),
  ];

  const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  EDGES.forEach(([a, b]) => makeTrussSegment(group, C[a], C[b]));

  C.forEach(c => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), nodeMat);
    m.position.copy(c);
    group.add(m);
  });

  // Ceiling rig
  const CY = HH + 0.12;
  const CC = [V(-HW, CY, -HD), V(HW, CY, -HD), V(HW, CY, HD), V(-HW, CY, HD)];
  [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]].forEach(([a, b]) => makeTrussSegment(group, CC[a], CC[b], 0.07));
  CC.forEach(c => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), nodeMat);
    m.position.copy(c);
    group.add(m);
    makeTrussSegment(group, c, V(c.x, HH, c.z), 0.07);
  });
  makeTrussSegment(group, V(0, CY, -HD), V(0, CY, HD), 0.07);
  makeTrussSegment(group, V(-HW, CY, 0), V(HW, CY, 0), 0.07);

  // Floor rig
  const FC2 = [V(-HW, FY, -HD), V(HW, FY, -HD), V(HW, FY, HD), V(-HW, FY, HD)];
  [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([a, b]) => makeTrussSegment(group, FC2[a], FC2[b], 0.07));
  FC2.forEach(c => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), nodeMat);
    m.position.copy(c);
    group.add(m);
    makeTrussSegment(group, c, V(c.x, -HH, c.z), 0.07);
  });
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // Three.js refs
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const animIdRef = useRef<number>(0);
  const clockRef = useRef(new THREE.Clock());

  // Face data
  const faceMatsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const faceOrigTexRef = useRef<THREE.CanvasTexture[]>([]);
  const faceCanvasRef = useRef<Map<number, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>>(new Map());
  const matrixColsRef = useRef<Map<number, number[]>>(new Map());

  // Video / camera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoTexRef = useRef<THREE.VideoTexture | null>(null);
  const faceVideoTexturesRef = useRef<THREE.VideoTexture[]>([]);

  // Trailer video
  const trailerVideoRef = useRef<HTMLVideoElement | null>(null);
  const trailerVideoTexturesRef = useRef<THREE.VideoTexture[]>([]);

  // File input (local video/image)
  const fileSourceRef = useRef<{ type: 'image'; el: HTMLImageElement } | { type: 'video'; el: HTMLVideoElement; tex: THREE.VideoTexture } | null>(null);
  const fileCanvasRef = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null);

  // Grid image
  const gridImgRef = useRef<HTMLImageElement | null>(null);
  const gridImgReadyRef = useRef(false);

  // Mapping preview composite canvas
  const mappingPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Cube dims
  const cubeDimsRef = useRef({ w: 3.6, h: 3.6, d: 3.6 });
  const faceMeshesRef = useRef<THREE.Mesh[]>([]);

  // Rig
  const rigGroupRef = useRef<THREE.Group | null>(null);

  // Lights
  const lightObjsRef = useRef<LightObjects[]>([]);

  // Refs mirroring state (for animation loop)
  const autoOrbitRef = useRef(false);
  const lightsRef = useRef<LightConfig[]>([]);
  const facesRef = useRef<FaceConfig[]>([]);
  const ledCountRef = useRef(12);
  const cameraScaleRef = useRef(1.0);
  const offFaceOpacityRef = useRef(1.0);
  const previewCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // ─── React State ───────────────────────────────────────────────────────────
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [autoOrbitSpeed, setAutoOrbitSpeed] = useState(2.0);
  const autoOrbitSpeedRef = useRef(2.0);
  const [cameraList, setCameraList] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamId, setSelectedCamId] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraResolution, setCameraResolution] = useState({ w: 0, h: 0 });
  const [cameraScale, setCameraScale] = useState(1.0);
  const [showMappingUI, setShowMappingUI] = useState(false);
  const [offFaceOpacity, setOffFaceOpacity] = useState(1.0);
  const [ledCountGlobal] = useState(12);
  const [showFacePanel, setShowFacePanel] = useState(false);
  const [showLightPanel, setShowLightPanel] = useState(false);
  const [showCameraSection, setShowCameraSection] = useState(false);
  const [showEstructuraPanel, setShowEstructuraPanel] = useState(false);
  const [showResolucionPanel, setShowResolucionPanel] = useState(false);
  const [cubeDims, setCubeDims] = useState({ w: 3.6, h: 3.6, d: 3.6 });
  const [rigStyle, setRigStyle] = useState<'pipe' | 'truss'>('truss');
  const [activeLightTab, setActiveLightTab] = useState(0);
  const [chaserActive, setChaserActive] = useState(false);
  const [chaserBpm, setChaserBpm] = useState(120);
  const [syncScene, setSyncScene] = useState<SceneType>('gradient');
  const [lightsAllOff, setLightsAllOff] = useState(false);
  const [showPreviews, setShowPreviews] = useState(true);
  const lightsAllOffRef = useRef(false);
  const [lightPresets, setLightPresets] = useState<LightPreset[]>(() => {
    try { return JSON.parse(localStorage.getItem('stage_viz_light_presets') || '[]'); } catch { return []; }
  });
  const [presetName, setPresetName] = useState('');
  const chaserActiveRef = useRef(false);
  const chaserBpmRef = useRef(120);

  // Undo/Redo History
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const isUndoRedoing = useRef(false);

  // Floating UI state
  const [mappingPos, setMappingPos] = useState({ x: 200, y: 100 });
  const dragStartRef = useRef({ x: 0, y: 0, winX: 0, winY: 0 });
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const faceDragRef = useRef<{ faceId: number; startMouseX: number; startMouseY: number; startMX: number; startMY: number; mW: number; mH: number } | null>(null);
  const faceResizeRef = useRef<{ faceId: number; handle: string; startMouseX: number; startMouseY: number; startMX: number; startMY: number; startMW: number; startMH: number } | null>(null);

  const [faces, setFaces] = useState<FaceConfig[]>(() => {
    const initScene: SceneType = 'trailer';
    return [
      { id: 0, name: 'izq_frente', scene: initScene, cameraSegment: 0, mapping: { x: 0.25, y: 0, w: 0.25, h: 1 }, params: { text: '*404*', motion: 'elegant', colorMode: 'bw' }, resolution: { w: 1080, h: 1080 } },
      { id: 1, name: 'der_back', scene: initScene, cameraSegment: 1, mapping: { x: 0.75, y: 0, w: 0.25, h: 1 }, params: { density: 1 }, resolution: { w: 1080, h: 1080 } },
      { id: 2, name: 'der_frente', scene: initScene, cameraSegment: 2, mapping: { x: 0.50, y: 0, w: 0.25, h: 1 }, params: { scale: 1 }, resolution: { w: 1080, h: 1080 } },
      { id: 3, name: 'izq_back', scene: initScene, cameraSegment: 3, mapping: { x: 0.00, y: 0, w: 0.25, h: 1 }, params: {}, resolution: { w: 1080, h: 1080 } },
    ];
  });

  const [lights, setLights] = useState<LightConfig[]>([
    { id: 0, name: 'Light A', color: '#ff0066', intensity: 2, strobe: false, strobeHz: 3, type: 'spot', x: -0.5, y: 0.3, z: 0.5, rotX: -20, rotY: 180, ledCount: 12 },
    { id: 1, name: 'Light B', color: '#00ff85', intensity: 2, strobe: false, strobeHz: 3, type: 'spot', x: 0.5, y: 0.3, z: 0.5, rotX: -20, rotY: 90, ledCount: 12 },
    { id: 2, name: 'Light C', color: '#0066ff', intensity: 2, strobe: false, strobeHz: 3, type: 'spot', x: 0.5, y: 0.3, z: -0.5, rotX: -20, rotY: 0, ledCount: 12 },
    { id: 3, name: 'Light D', color: '#ffffff', intensity: 1.5, strobe: false, strobeHz: 3, type: 'spot', x: -0.5, y: 0.3, z: -0.5, rotX: -20, rotY: 270, ledCount: 12 },
  ]);

  // Keep refs in sync
  useEffect(() => { autoOrbitRef.current = autoOrbit; }, [autoOrbit]);
  useEffect(() => { autoOrbitSpeedRef.current = autoOrbitSpeed; }, [autoOrbitSpeed]);
  useEffect(() => { lightsRef.current = lights; }, [lights]);

  // ─── Trailer Video Init ──────────────────────────────────────────────────
  useEffect(() => {
    const v = document.createElement('video');
    v.src = '/Inside_the_box_v3.mp4';
    v.crossOrigin = 'anonymous';
    v.loop = true;
    v.muted = true;
    v.playsInline = true;

    const playTrailer = () => {
      v.play().catch(() => { });
    };
    playTrailer();
    window.addEventListener('pointerdown', playTrailer, { once: true });
    window.addEventListener('touchstart', playTrailer, { once: true });

    trailerVideoRef.current = v;

    // Create 4 video textures for the 4 faces so mapping offsets are independent
    trailerVideoTexturesRef.current = [0, 1, 2, 3].map(() => {
      const tex = new THREE.VideoTexture(v);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    });

    return () => {
      window.removeEventListener('pointerdown', playTrailer);
      window.removeEventListener('touchstart', playTrailer);
      v.pause();
      v.src = '';
      v.load();
      trailerVideoTexturesRef.current.forEach(t => t.dispose());
    };
  }, []);

  // Load GRID_V2 image
  useEffect(() => {
    const img = new Image();
    img.src = '/GRID_V2.jpg';
    img.onload = () => { gridImgReadyRef.current = true; };
    gridImgRef.current = img;
  }, []);

  useEffect(() => { facesRef.current = faces; }, [faces]);
  useEffect(() => { ledCountRef.current = ledCountGlobal; }, [ledCountGlobal]);
  useEffect(() => { cameraScaleRef.current = cameraScale; }, [cameraScale]);
  useEffect(() => { chaserActiveRef.current = chaserActive; }, [chaserActive]);
  useEffect(() => { chaserBpmRef.current = chaserBpm; }, [chaserBpm]);
  useEffect(() => { cubeDimsRef.current = cubeDims; }, [cubeDims]);
  useEffect(() => { offFaceOpacityRef.current = offFaceOpacity; }, [offFaceOpacity]);
  useEffect(() => { lightsAllOffRef.current = lightsAllOff; }, [lightsAllOff]);

  // ─── Preview thumbnails + mapping composite rAF loop ─────────────────────
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      // Face thumbnail previews
      previewCanvasesRef.current.forEach((previewCanvas, faceId) => {
        const src = faceCanvasRef.current.get(faceId);
        if (!src) return;
        const ctx = previewCanvas.getContext('2d');
        if (ctx) ctx.drawImage(src.canvas, 0, 0, previewCanvas.width, previewCanvas.height);
      });

      // Mapping preview — composite all face sources at their mapping positions
      const mp = mappingPreviewCanvasRef.current;
      if (mp) {
        const ctx = mp.getContext('2d');
        if (ctx) {
          const cw = mp.width, ch = mp.height;
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(0, 0, cw, ch);
          facesRef.current.forEach((face, i) => {
            const { x, y, w, h } = face.mapping;
            const dx = x * cw, dy = y * ch, dw = w * cw, dh = h * ch;
            try {
              if (face.scene === 'camera' && videoRef.current?.srcObject) {
                ctx.drawImage(videoRef.current, dx, dy, dw, dh);
              } else if (face.scene === 'trailer' && trailerVideoRef.current && (trailerVideoRef.current.readyState ?? 0) >= 2) {
                ctx.drawImage(trailerVideoRef.current, dx, dy, dw, dh);
              } else if (face.scene === 'fileinput' && fileSourceRef.current) {
                ctx.drawImage(fileSourceRef.current.el, dx, dy, dw, dh);
              } else if (face.scene === 'grid_img' && gridImgReadyRef.current && gridImgRef.current) {
                ctx.drawImage(gridImgRef.current, dx, dy, dw, dh);
              } else {
                const src = faceCanvasRef.current.get(i);
                if (src) ctx.drawImage(src.canvas, dx, dy, dw, dh);
              }
            } catch { /* source not ready yet */ }
          });
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Record history (debounced for sliders)
  useEffect(() => {
    if (isUndoRedoing.current) return;
    const timer = setTimeout(() => {
      const snap = JSON.stringify({ faces, lights, offFaceOpacity });
      setHistory(prev => {
        const newHist = prev.slice(0, historyIdx + 1);
        if (newHist[newHist.length - 1] === snap) return prev;
        const result = [...newHist, snap];
        if (result.length > 50) result.shift();
        return result;
      });
      setHistoryIdx(prev => Math.min(prev + 1, 49));
    }, 400);
    return () => clearTimeout(timer);
  }, [faces, lights, offFaceOpacity]);

  const undo = useCallback(() => {
    if (historyIdx <= 0) return;
    isUndoRedoing.current = true;
    const prev = JSON.parse(history[historyIdx - 1]);
    setFaces(prev.faces);
    setLights(prev.lights);
    setOffFaceOpacity(prev.offFaceOpacity);
    setHistoryIdx(h => h - 1);
    setTimeout(() => { isUndoRedoing.current = false; }, 50);
  }, [history, historyIdx]);

  const redo = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    isUndoRedoing.current = true;
    const next = JSON.parse(history[historyIdx + 1]);
    setFaces(next.faces);
    setLights(next.lights);
    setOffFaceOpacity(next.offFaceOpacity);
    setHistoryIdx(h => h + 1);
    setTimeout(() => { isUndoRedoing.current = false; }, 50);
  }, [history, historyIdx]);

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) redo(); else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        redo();
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [undo, redo]);

  // ─── Texture draw functions ────────────────────────────────────────────────
  const noise2D = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const dot = (ix: number, iy: number) => {
      const v = Math.sin(ix * 12.9898 + iy * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    const a = dot(i, j), b = dot(i + 1, j), c = dot(i, j + 1), d = dot(i + 1, j + 1);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  };

  // --- ANIMATION HELPERS ---
  const easeBackOut = (x: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };

  const drawGradient = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) => {
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    const h1 = (t * 20) % 360, h2 = (h1 + 120) % 360, h3 = (h1 + 240) % 360;
    g.addColorStop(0, `hsl(${h1},100%,50%)`);
    g.addColorStop(0.5, `hsl(${h2},100%,50%)`);
    g.addColorStop(1, `hsl(${h3},100%,50%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const drawMatrix = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, cols: number[]) => {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '14px monospace';
    const chars = 'アイウエオカキクケコ0123456789ABCDEFGHabcdefgh';
    for (let i = 0; i < cols.length; i++) {
      ctx.fillStyle = `rgba(0,255,133,${Math.random() * 0.5 + 0.5})`;
      ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * 12, cols[i]);
      if (cols[i] > canvas.height && Math.random() > 0.975) cols[i] = 0;
      cols[i] += 14;
    }
  };

  const drawTurbulent = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number, params: any) => {
    const sc = params.scale || 0.1;
    const seed = params.seed || 0;
    const posterize = params.posterize || false;
    const id = ctx.createImageData(canvas.width, canvas.height);
    const d = id.data;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        let n = 0, a = 1, f = 1;
        for (let k = 0; k < 4; k++) {
          n += noise2D(x * sc * f + t + seed, y * sc * f + t * 0.7 + seed * 0.5) * a;
          a *= 0.5; f *= 2;
        }
        let v = (n + 1) * 0.5; // 0..1
        if (posterize) v = Math.floor(v * 6) / 6;
        const colorV = Math.floor(v * 255);
        const idx = (y * canvas.width + x) * 4;
        d[idx] = colorV;
        d[idx + 1] = Math.floor(colorV * 0.6 + 60);
        d[idx + 2] = Math.floor(colorV * 0.3 + 120);
        d[idx + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
  };

  const drawGeo = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number, params: any) => {
    const speed = params.speed || 1.0;
    const complexity = params.complexity || 3;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < 5 + complexity; i++) {
      const cycleLen = 4 / speed;
      const progress = (t % cycleLen) / cycleLen;
      const bounce = easeBackOut(progress > 0.8 ? (1 - progress) * 5 : progress * 1.25 % 1);

      const phase = (t * 0.3 * speed + i * 0.8) % (Math.PI * 2);
      const x = canvas.width / 2 + Math.cos(phase + i) * (80 * bounce);
      const y = canvas.height / 2 + Math.sin(phase + (i * 0.5)) * (80 * bounce);
      const sz = (25 + Math.sin(t * speed + i) * 15) * bounce;

      const hue = (i * 45 + t * 20) % 360;
      ctx.fillStyle = `hsla(${hue}, 90%, 60%, 0.4)`;
      ctx.strokeStyle = `hsla(${hue}, 100%, 70%, 0.8)`;
      ctx.lineWidth = 3;

      ctx.beginPath();
      const st = Math.floor((i + Math.floor(t * speed / 2)) % 3);
      if (st < 1) {
        ctx.arc(x, y, sz, 0, Math.PI * 2);
      } else if (st < 2) {
        ctx.moveTo(x, y - sz);
        ctx.lineTo(x + sz, y + sz);
        ctx.lineTo(x - sz, y + sz);
        ctx.closePath();
      } else {
        ctx.rect(x - sz, y - sz, sz * 2, sz * 2);
      }
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  const drawWin98 = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number, params: any) => {
    const chaos = params.speed || 1;
    ctx.fillStyle = '#008080'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw background icons
    const drawIcon = (x: number, y: number, label: number) => {
      ctx.fillStyle = '#c0c0c0'; ctx.fillRect(x, y, 20, 20); // Base
      ctx.fillStyle = '#000'; ctx.font = '6px Arial';
      ctx.fillText(label % 2 === 0 ? 'My Comp' : 'Recycle', x - 5, y + 28);
    };
    for (let i = 0; i < 4; i++) drawIcon(20 + i * 60, 20, i);

    // Dynamic windows
    const count = 3 + Math.floor(chaos * 2);
    for (let i = 0; i < count; i++) {
      const cycle = (t * 0.3 * chaos + i) % 1;
      const bounce = easeBackOut(cycle);
      const x = 20 + i * 40 + (Math.sin(t * 0.2 + i) * 30 * bounce);
      const y = 40 + (i * 30) + (Math.cos(t * 0.4 + i) * 20 * bounce);
      const w = 120, h = 90;

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + 4, y + 4, w, h);
      // Window body
      ctx.fillStyle = '#c0c0c0'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = '#333'; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

      // Title bar - randomized pro colors
      const headers = ['#000080', '#008080', '#800000', '#808000', '#000000'];
      ctx.fillStyle = headers[i % headers.length];
      ctx.fillRect(x + 2, y + 2, w - 4, 16);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 9px "Tahoma", sans-serif';
      ctx.fillText(i % 2 === 0 ? 'SYSTΕM ΕRROR' : 'MΕMORY LΕAK', x + 6, y + 13);

      // Content
      ctx.fillStyle = '#000'; ctx.font = '8px "Courier New"';
      const msgs = ['404 Not Found', 'Init sequence...', 'Stack Overflow', 'Re-routing...'];
      ctx.fillText(msgs[(i + Math.floor(t)) % msgs.length], x + 10, y + 40);

      // Progress bar
      ctx.fillStyle = '#888'; ctx.fillRect(x + 10, y + 60, w - 20, 10);
      ctx.fillStyle = '#000080'; ctx.fillRect(x + 10, y + 60, (w - 20) * ((t * 2 + i) % 10 / 10), 10);
    }

    // Cursor Trail
    for (let k = 0; k < 8; k++) {
      const ct = t - k * 0.05;
      const cx = canvas.width / 2 + Math.sin(ct * 2 * chaos) * 80;
      const cy = canvas.height / 2 + Math.cos(ct * 1.5 * chaos) * 60;
      ctx.globalAlpha = 1 - (k / 8);
      ctx.fillStyle = '#fff'; ctx.fillRect(cx, cy, 4, 4); // Pixel cursor
      ctx.strokeStyle = '#000'; ctx.strokeRect(cx, cy, 4, 4);
    }
    ctx.globalAlpha = 1;
  };

  const drawScanlines = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scanY = ((t * 60) % (canvas.height + 100)) - 50;
    for (let y = 0; y < canvas.height; y += 4) {
      ctx.fillStyle = `rgba(0,255,133,${y % 8 === 0 ? 0.12 : 0.05})`;
      ctx.fillRect(0, y, canvas.width, 2);
    }
    const gr = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 60);
    gr.addColorStop(0, 'rgba(0,255,133,0)');
    gr.addColorStop(0.5, 'rgba(0,255,133,0.6)');
    gr.addColorStop(1, 'rgba(0,255,133,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, scanY - 60, canvas.width, 120);
    ctx.strokeStyle = '#00ff85'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(canvas.width, scanY); ctx.stroke();
  };

  const drawWhite = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const drawGrid = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, opacity = 0.1) => {
    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.lineWidth = 0.5;
    const step = 20;
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
    for (let y = 0; y <= canvas.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
    ctx.stroke();
  };

  const drawKinetic = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number, params: any) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, canvas, 0.05);

    const txt = params.text || '*404* error';
    const speed = params.speed || 1;
    const motion = params.motion || 'elegant';
    const isBW = params.colorMode === 'bw';

    const words = txt.split(' ');
    ctx.textAlign = 'center';

    words.forEach((word: string, idx: number) => {
      ctx.save();
      // Form vs Counter-form logic: alternate globalCompositeOperation
      if (idx % 2 === 0) {
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = isBW ? '#fff' : `hsl(${(t * 50 + idx * 30) % 360}, 100%, 60%)`;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = isBW ? '#fff' : `hsl(${(t * 50 + idx * 60) % 360}, 100%, 70%)`;
      }

      let yPos, scale, rot = 0;
      if (motion === 'glitch') {
        const snapT = Math.floor(t * 12) / 12;
        yPos = (canvas.height / 2) + Math.sin(snapT * speed + idx) * 100;
        scale = 1.0 + (Math.random() > 0.9 ? 0.5 : 0);
        rot = Math.random() > 0.95 ? (Math.random() - 0.5) * 0.2 : 0;
      } else {
        const slowT = t * 0.5 * speed;
        yPos = (canvas.height / 2) + Math.cos(slowT + idx * 0.8) * 80;
        scale = 1.2 + Math.sin(slowT + idx) * 0.4;
      }

      ctx.font = `bold ${Math.floor(60 * scale)}px Impact, sans-serif`;
      ctx.translate(canvas.width / 2, yPos);
      ctx.rotate(rot);
      ctx.fillText(word, 0, 0);
      ctx.restore();
    });
    ctx.globalCompositeOperation = 'source-over';
  };

  const drawCountdown = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, canvas, 0.03);

    const ms = (24 * 3600 * 1000) - (t * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const msStr = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${msStr}`;

    // Programmer aesthetic: No neon, no blur
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`> SYSTEM_TIME: ${timeStr}`, 20, 30);
    ctx.fillText(`> STATUS: CALIBRATING VOLUMES`, 20, 45);
    ctx.fillText(`> BUFFER: [${'█'.repeat(Math.floor((t * 2) % 10))}${'░'.repeat(10 - Math.floor((t * 2) % 10))}]`, 20, 60);

    ctx.textAlign = 'center';
    ctx.font = 'bold 64px "Courier New", monospace';
    ctx.fillText(timeStr, canvas.width / 2, canvas.height / 2 + 20);

    // Subtle data noise
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    for (let i = 0; i < 3; i++) {
      const ry = Math.floor(Math.random() * canvas.height);
      ctx.fillRect(0, ry, canvas.width, 1);
    }
  };

  // ─── Three.js Initialization ───────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const W = container.clientWidth || window.innerWidth;
    const H = container.clientHeight || window.innerHeight;

    // Scene / Camera / Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    sceneRef.current = scene;

    const cam = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
    cam.position.set(5, 4, 5);
    cam.lookAt(0, 0, 0);
    cameraRef.current = cam;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const cvs = renderer.domElement;
    Object.assign(cvs.style, { display: 'block', position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', touchAction: 'none' });
    container.appendChild(cvs);
    rendererRef.current = renderer;

    const controls = new OrbitControls(cam, cvs);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 20;
    controls.autoRotateSpeed = 0.6;
    orbitRef.current = controls;

    // Grid floor (fixed size)
    const grid = new THREE.GridHelper(14, 28, 0x2a2a2a, 0x1a1a1a);
    grid.position.y = -HALF - 0.12 - 0.02;
    scene.add(grid);

    // ── 4 Lateral Faces ─────────────────────────────────────────────────────
    const faceDefs = [
      { pos: new THREE.Vector3(0, 0, HALF), rot: [0, 0, 0] as [number, number, number] },       // 2_izq (Front)
      { pos: new THREE.Vector3(0, 0, -HALF), rot: [0, Math.PI, 0] as [number, number, number] }, // 3_der (Back slot)
      { pos: new THREE.Vector3(HALF, 0, 0), rot: [0, Math.PI / 2, 0] as [number, number, number] }, // 4_der_back (Right slot)
      { pos: new THREE.Vector3(-HALF, 0, 0), rot: [0, -Math.PI / 2, 0] as [number, number, number] }, // 1_izq_back (Left slot)
    ];

    const faceGeo = new THREE.PlaneGeometry(BASE_CUBE_SIZE, BASE_CUBE_SIZE);
    faceMatsRef.current = [];
    faceOrigTexRef.current = [];
    faceCanvasRef.current.clear();
    faceMeshesRef.current = [];

    const initialFaces = facesRef.current;
    faceDefs.forEach((def, i) => {
      const initRes = initialFaces[i]?.resolution ?? { w: 1080, h: 1080 };
      const canvas = document.createElement('canvas');
      canvas.width = initRes.w; canvas.height = initRes.h;
      const ctx = canvas.getContext('2d')!;

      // Matrix columns init
      const cols: number[] = [];
      for (let c = 0; c < 24; c++) cols[c] = Math.random() * initRes.h;
      matrixColsRef.current.set(i, cols);

      faceCanvasRef.current.set(i, { canvas, ctx });

      const tex = new THREE.CanvasTexture(canvas);
      faceOrigTexRef.current.push(tex);

      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new THREE.Color(0.25, 0.25, 0.25),
        emissiveIntensity: 1.0,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1.0,
      });
      faceMatsRef.current.push(mat);

      const mesh = new THREE.Mesh(faceGeo, mat);
      mesh.position.copy(def.pos);
      mesh.rotation.set(...def.rot);
      mesh.userData.faceIndex = i;
      scene.add(mesh);
      faceMeshesRef.current.push(mesh);
    });

    // ── Interior Lights ──────────────────────────────────────────────────────
    const helperGeo = new THREE.SphereGeometry(0.09, 12, 12);
    lightObjsRef.current = [];

    lightsRef.current.forEach((cfg, idx) => {
      const hMat = new THREE.MeshBasicMaterial({ color: cfg.color, toneMapped: false });
      const hMesh = new THREE.Mesh(helperGeo, hMat);
      hMesh.position.set(cfg.x, cfg.y, cfg.z);
      scene.add(hMesh);

      if (cfg.type === 'spot') {
        const spot = new THREE.SpotLight(cfg.color, cfg.intensity);
        spot.position.set(cfg.x, cfg.y, cfg.z);
        spot.angle = Math.PI / 7;
        spot.penumbra = 0.25;
        spot.distance = 10;
        spot.castShadow = true;
        scene.add(spot);
        scene.add(spot.target);
        hMesh.visible = true;
        const spotHelper = new THREE.SpotLightHelper(spot);
        scene.add(spotHelper);
        lightObjsRef.current.push({ threeLight: spot, helperMesh: hMesh, helperMat: hMat, spotHelper });
      } else {
        const light = new THREE.PointLight(new THREE.Color(cfg.color).getHex(), cfg.intensity, 8);
        light.position.set(cfg.x, cfg.y, cfg.z);
        light.castShadow = true;
        scene.add(light);
        lightObjsRef.current.push({ threeLight: light, helperMesh: hMesh, helperMat: hMat });
      }
      void idx;
    });

    scene.add(new THREE.AmbientLight(0x222222));

    // ── Animation Loop ───────────────────────────────────────────────────────
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      const time = clockRef.current.getElapsedTime();
      const ctrl = orbitRef.current!;
      ctrl.autoRotate = autoOrbitRef.current;
      ctrl.autoRotateSpeed = autoOrbitSpeedRef.current; // Direct usage or via ref
      ctrl.update();

      // Scale face meshes to cubeDims
      const cd = cubeDimsRef.current;
      faceMeshesRef.current.forEach((mesh, i) => {
        if (i === 0) { // 2_izq (Front, z=+D/2)
          mesh.scale.set(cd.w / BASE_CUBE_SIZE, cd.h / BASE_CUBE_SIZE, 1);
          mesh.position.set(0, 0, cd.d / 2);
        } else if (i === 1) { // 3_der (Back, z=-D/2)
          mesh.scale.set(cd.w / BASE_CUBE_SIZE, cd.h / BASE_CUBE_SIZE, 1);
          mesh.position.set(0, 0, -cd.d / 2);
        } else if (i === 2) { // 4_der_back (Right, x=+W/2)
          mesh.scale.set(cd.d / BASE_CUBE_SIZE, cd.h / BASE_CUBE_SIZE, 1);
          mesh.position.set(cd.w / 2, 0, 0);
        } else if (i === 3) { // 1_izq_back (Left, x=-W/2)
          mesh.scale.set(cd.d / BASE_CUBE_SIZE, cd.h / BASE_CUBE_SIZE, 1);
          mesh.position.set(-cd.w / 2, 0, 0);
        }
      });

      // Face centers in world space (matches cubeDims)
      const SPOT_ANGLE = Math.PI / 7;
      const COS_SPOT = Math.cos(SPOT_ANGLE);
      const FC: [number, number, number][] = [
        [0, 0, cd.d / 2], [0, 0, -cd.d / 2], [cd.w / 2, 0, 0], [-cd.w / 2, 0, 0],
      ];

      // Update fileinput image canvas if image source
      if (fileSourceRef.current?.type === 'image' && fileCanvasRef.current) {
        const { canvas: fc, ctx: fctx } = fileCanvasRef.current;
        fctx.drawImage(fileSourceRef.current.el, 0, 0, fc.width, fc.height);
      }

      // Update face textures
      facesRef.current.forEach((face, i) => {
        const fd = faceCanvasRef.current.get(i);
        const mat = faceMatsRef.current[i];
        if (!fd || !mat) return;

        // --- Software lighting: realistic interior-light-on-projection-screen ---
        const fc = FC[i] ?? [0, 0, 0];
        let lr = 0, lg = 0, lb = 0;

        if (!lightsAllOffRef.current) {
          lightsRef.current.forEach(lCfg => {
            const hz = lCfg.strobeHz ?? 3;
            const strobeOn = !lCfg.strobe || Math.sin(time * hz * Math.PI * 2) > 0;
            if (!strobeOn) return;

            const hex = parseInt(lCfg.color.replace('#', ''), 16);
            const cr = ((hex >> 16) & 0xff) / 255;
            const cg = ((hex >> 8) & 0xff) / 255;
            const cb = (hex & 0xff) / 255;

            const vx = fc[0] - lCfg.x, vy = fc[1] - lCfg.y, vz = fc[2] - lCfg.z;
            const dist = Math.sqrt(vx * vx + vy * vy + vz * vz) || 0.001;
            const vnx = vx / dist, vny = vy / dist, vnz = vz / dist;

            // Quadratic attenuation – lights inside a ≈3.6m cube
            let s = (lCfg.intensity * 0.55) / (0.3 + dist * dist * 0.7);

            if (lCfg.type === 'spot') {
              const rx = (lCfg.rotX * Math.PI) / 180;
              const ry = (lCfg.rotY * Math.PI) / 180;
              const dx = Math.sin(ry) * Math.cos(rx);
              const dy = -Math.cos(rx);
              const dz = Math.cos(ry) * Math.cos(rx);
              const dot = dx * vnx + dy * vny + dz * vnz;
              if (dot < COS_SPOT) return;
              s *= (dot - COS_SPOT) / (1 - COS_SPOT);
            }

            lr += cr * s; lg += cg * s; lb += cb * s;
          });
        }

        // Mix: white (full projection) → tinted toward light color as intensity grows.
        // This simulates interior light bleeding through the projected screen fabric.
        const lightPow = Math.sqrt(lr * lr + lg * lg + lb * lb);
        let er = 1, eg = 1, eb = 1;
        if (lightPow > 0.02) {
          const nr = lr / lightPow, ng = lg / lightPow, nb = lb / lightPow;
          const blend = Math.min(0.98, lightPow * 0.5);
          er = 1 - blend + nr * blend;
          eg = 1 - blend + ng * blend;
          eb = 1 - blend + nb * blend;
        }
        mat.emissive.setRGB(er, eg, eb);
        mat.emissiveIntensity = offFaceOpacityRef.current;

        // Skip canvas redraw for active camera (uses VideoTexture directly)
        if (face.scene === 'camera' && cameraActive) return;
        // Skip canvas redraw for fileinput (uses VideoTexture or CanvasTexture directly handled in useEffect)
        if (face.scene === 'fileinput') return;
        if (face.scene === 'trailer') return;

        const { canvas, ctx } = fd;
        switch (face.scene) {
          case 'gradient': drawGradient(ctx, canvas, time); break;
          case 'matrix': {
            const cols = matrixColsRef.current.get(i) || [];
            drawMatrix(ctx, canvas, cols);
            break;
          }
          case 'turbulent': drawTurbulent(ctx, canvas, time, face.params); break;
          case 'geo': drawGeo(ctx, canvas, time, face.params); break;
          case 'win98': drawWin98(ctx, canvas, time, face.params); break;
          case 'scanlines': drawScanlines(ctx, canvas, time); break;
          case 'kinetic': drawKinetic(ctx, canvas, time, face.params); break;
          case 'countdown': drawCountdown(ctx, canvas, time); break;
          case 'white': drawWhite(ctx, canvas); break;
          case 'grid_img': {
            if (gridImgReadyRef.current && gridImgRef.current) {
              ctx.drawImage(gridImgRef.current, 0, 0, canvas.width, canvas.height);
            } else {
              ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            break;
          }
          case 'camera': {
            ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            drawGrid(ctx, canvas, 0.05);
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.font = '8px "Courier New"';
            ctx.textAlign = 'center';
            ctx.fillText('SIGNAL_LOST // AWAITING STREAM', canvas.width / 2, canvas.height / 2);
            break;
          }
        }

        const tex = mat.map as THREE.CanvasTexture | null;
        if (tex) tex.needsUpdate = true;
      });

      // Update lights
      lightsRef.current.forEach((cfg, i) => {
        const lo = lightObjsRef.current[i];
        if (!lo) return;
        const { threeLight, helperMesh, helperMat } = lo;

        threeLight.position.set(cfg.x, cfg.y, cfg.z);
        helperMesh.position.set(cfg.x, cfg.y, cfg.z);
        threeLight.color.set(cfg.color);

        // Global blackout override
        if (lightsAllOffRef.current) {
          threeLight.intensity = 0;
        } else if (chaserActiveRef.current) {
          const beatDuration = 60 / chaserBpmRef.current;
          const activeIdx = Math.floor(time / beatDuration) % lightsRef.current.length;
          threeLight.intensity = i === activeIdx ? cfg.intensity : 0;
        } else {
          const hz = cfg.strobeHz ?? 3;
          const activeIntensity = cfg.strobe
            ? (Math.sin(time * hz * Math.PI * 2) > 0 ? cfg.intensity * 2 : 0)
            : cfg.intensity;
          threeLight.intensity = activeIntensity;
        }
        const activeIntensity = threeLight.intensity;

        // Helper brightness scales with intensity (max intensity assumed ~4)
        const brightFactor = Math.min(1, activeIntensity / 4);
        const hc = new THREE.Color(cfg.color);
        helperMat.color.setRGB(hc.r * brightFactor, hc.g * brightFactor, hc.b * brightFactor);

        // Spotlight direction + cone helper
        if (threeLight instanceof THREE.SpotLight) {
          const rx = (cfg.rotX * Math.PI) / 180;
          const ry = (cfg.rotY * Math.PI) / 180;
          const dx = Math.sin(ry) * Math.cos(rx);
          const dy = Math.cos(rx) * -1;
          const dz = Math.cos(ry) * Math.cos(rx);
          threeLight.target.position.set(cfg.x + dx * 3, cfg.y + dy * 3, cfg.z + dz * 3);
          threeLight.target.updateMatrixWorld();

          // Ray-AABB: find distance to nearest cube wall
          const dir = [dx, dy, dz];
          const pos = [cfg.x, cfg.y, cfg.z];
          let wallDist = 20;
          for (let a = 0; a < 3; a++) {
            if (Math.abs(dir[a]) > 0.0001) {
              for (const sign of [-1, 1]) {
                const t = (sign * HALF - pos[a]) / dir[a];
                if (t > 0.01) wallDist = Math.min(wallDist, t);
              }
            }
          }
          threeLight.distance = wallDist + 0.1;

          if (lo.spotHelper) {
            lo.spotHelper.color = new THREE.Color(cfg.color);
            lo.spotHelper.update();
          }
        }

        // LED group transform + strobe
        if (lo.ledGroup) {
          lo.ledGroup.position.set(cfg.x, cfg.y, cfg.z);
          lo.ledGroup.rotation.set((cfg.rotX * Math.PI) / 180, (cfg.rotY * Math.PI) / 180, 0);
          const lInt = cfg.strobe ? (Math.sin(time * 18) > 0 ? cfg.intensity * 0.4 : 0) : cfg.intensity * 0.25;
          lo.ledGroup.children.forEach(child => {
            if (child instanceof THREE.PointLight) child.intensity = lInt;
            if (child instanceof THREE.Mesh) {
              const m = child.material as THREE.MeshBasicMaterial;
              if (m.toneMapped === false) m.color.set(cfg.color);
            }
          });
        }
      });

      renderer.render(scene, cam);
    };
    animate();

    // ── Light drag gizmos ────────────────────────────────────────────────────
    const dragRaycaster = new THREE.Raycaster();
    const dragPlaneHit = new THREE.Vector3();
    let activeLightDrag: { idx: number; plane: THREE.Plane } | null = null;

    const getNDC = (e: PointerEvent) => {
      const rect = cvs.getBoundingClientRect();
      return new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
    };

    const onLightDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragRaycaster.setFromCamera(getNDC(e), cam);
      const helpers = lightObjsRef.current.map(lo => lo.helperMesh);
      const hits = dragRaycaster.intersectObjects(helpers);
      if (!hits.length) return;
      const hitIdx = lightObjsRef.current.findIndex(lo => lo.helperMesh === hits[0].object);
      if (hitIdx < 0) return;
      const cfg = lightsRef.current[hitIdx];
      activeLightDrag = { idx: hitIdx, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -cfg.y) };
      controls.enabled = false;
      cvs.style.cursor = 'grabbing';
      e.stopPropagation();
    };

    const onLightMove = (e: PointerEvent) => {
      if (!activeLightDrag) return;
      dragRaycaster.setFromCamera(getNDC(e), cam);
      if (dragRaycaster.ray.intersectPlane(activeLightDrag.plane, dragPlaneHit)) {
        const idx = activeLightDrag.idx;
        setLights(prev => prev.map((l, i) => i === idx
          ? { ...l, x: +dragPlaneHit.x.toFixed(3), z: +dragPlaneHit.z.toFixed(3) }
          : l
        ));
      }
    };

    const onLightUp = () => {
      if (!activeLightDrag) return;
      controls.enabled = true;
      activeLightDrag = null;
      cvs.style.cursor = '';
    };

    cvs.addEventListener('pointerdown', onLightDown);
    window.addEventListener('pointermove', onLightMove);
    window.addEventListener('pointerup', onLightUp);

    // Resize
    const onResize = () => {
      const cw = container.clientWidth || window.innerWidth;
      const ch = container.clientHeight || window.innerHeight;
      cam.aspect = cw / ch;
      cam.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cvs.removeEventListener('pointerdown', onLightDown);
      window.removeEventListener('pointermove', onLightMove);
      window.removeEventListener('pointerup', onLightUp);
      cancelAnimationFrame(animIdRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(cvs)) container.removeChild(cvs);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Rig rebuild when cubeDims or rigStyle changes ────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (rigGroupRef.current) {
      scene.remove(rigGroupRef.current);
      rigGroupRef.current = null;
    }
    const group = new THREE.Group();
    const cd = cubeDims;
    const HW = (cd.w / 2) - 0.15, HH = (cd.h / 2) - 0.15, HD = (cd.d / 2) - 0.15;
    const FY = -HH - 0.12;

    if (rigStyle === 'pipe') {
      buildPipeRig(group, HW, HH, HD, FY);
    } else {
      buildTrussRig(group, HW, HH, HD, FY);
    }
    scene.add(group);
    rigGroupRef.current = group;
  }, [cubeDims, rigStyle]); // eslint-disable-line

  // ─── Update face materials when scene/camera changes ─────────────────────
  useEffect(() => {
    faces.forEach((face, i) => {
      const mat = faceMatsRef.current[i];
      if (!mat) return;

      if (face.scene === 'camera' && faceVideoTexturesRef.current[i]) {
        const tex = faceVideoTexturesRef.current[i];

        // --- 1:1 DIRECT MAPPING (Zoom is now UI-only for precision) ---
        const repX = face.mapping.w;
        const repY = face.mapping.h;
        const offX = face.mapping.x;
        const offY = 1 - repY - face.mapping.y;

        tex.repeat.set(repX, repY);
        tex.offset.set(offX, offY);
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;

        if (mat.map !== tex) { mat.map = tex; mat.emissiveMap = tex; }
        mat.opacity = offFaceOpacity;
        mat.needsUpdate = true;
      } else if (face.scene === 'trailer' && trailerVideoTexturesRef.current[i]) {
        const tex = trailerVideoTexturesRef.current[i];

        const repX = face.mapping.w;
        const repY = face.mapping.h;
        const offX = face.mapping.x;
        const offY = 1 - repY - face.mapping.y;

        tex.repeat.set(repX, repY);
        tex.offset.set(offX, offY);
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;

        if (mat.map !== tex) { mat.map = tex; mat.emissiveMap = tex; }
        mat.opacity = offFaceOpacity;
        mat.needsUpdate = true;
      } else if (face.scene === 'fileinput' && fileSourceRef.current) {
        if (fileSourceRef.current.type === 'video') {
          const tex = fileSourceRef.current.tex;
          if (mat.map !== tex) { mat.map = tex; mat.emissiveMap = tex; }
        } else if (fileSourceRef.current.type === 'image' && fileCanvasRef.current) {
          const origTex = faceOrigTexRef.current[i] || null;
          mat.map = origTex;
          mat.emissiveMap = origTex;
        }
        mat.opacity = offFaceOpacity;
        mat.needsUpdate = true;
      } else {
        const origTex = faceOrigTexRef.current[i] || null;
        mat.map = origTex;
        mat.emissiveMap = origTex;
        mat.opacity = offFaceOpacity;
      }
      mat.needsUpdate = true;
    });
  }, [faces, cameraActive, offFaceOpacity]);

  // ─── Resize face canvas when resolution changes ────────────────────────────
  useEffect(() => {
    faces.forEach((face, i) => {
      const fd = faceCanvasRef.current.get(i);
      if (!fd) return;
      const { canvas } = fd;
      if (canvas.width !== face.resolution.w || canvas.height !== face.resolution.h) {
        canvas.width = face.resolution.w;
        canvas.height = face.resolution.h;
        // Re-init matrix columns for new size
        const cols: number[] = [];
        for (let c = 0; c < Math.ceil(face.resolution.w / 12); c++) cols[c] = Math.random() * face.resolution.h;
        matrixColsRef.current.set(i, cols);
        // Mark texture as needing update
        const tex = faceOrigTexRef.current[i];
        if (tex) tex.needsUpdate = true;
        const mat = faceMatsRef.current[i];
        if (mat) mat.needsUpdate = true;
      }
    });
  }, [faces]);

  // ─── Camera enumeration ───────────────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devs => {
      const vids = devs.filter(d => d.kind === 'videoinput');
      setCameraList(vids);
      if (vids.length > 0) setSelectedCamId(vids[0].deviceId);
    }).catch(() => { });
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 4320 }, height: { ideal: 1080 },
          ...(selectedCamId ? { deviceId: { exact: selectedCamId } } : {})
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const video = document.createElement('video');
      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;

      video.onloadedmetadata = () => {
        video.play();
        setCameraResolution({ w: video.videoWidth, h: video.videoHeight });

        // Create 4 distinct textures for independent mapping
        faceVideoTexturesRef.current = [
          new THREE.VideoTexture(video),
          new THREE.VideoTexture(video),
          new THREE.VideoTexture(video),
          new THREE.VideoTexture(video)
        ];

        setCameraActive(true);
      };
      videoRef.current = video;
    } catch (e) {
      alert('No se pudo acceder a la cámara: ' + (e as Error).message);
    }
  }, [selectedCamId]);

  const stopCamera = useCallback(() => {
    if (videoRef.current) {
      (videoRef.current.srcObject as MediaStream)?.getTracks().forEach(t => t.stop());
      videoRef.current = null;
    }
    videoTexRef.current = null;
    setCameraActive(false);
    // Restore canvas textures for camera faces
    setFaces(prev => prev.map(f => f.scene === 'camera' ? { ...f, scene: 'white' } : f));
  }, []);

  const handleFileInput = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.src = url;
      vid.loop = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.play().catch(() => { });
      const tex = new THREE.VideoTexture(vid);
      fileSourceRef.current = { type: 'video', el: vid, tex };
    } else if (file.type.startsWith('image/')) {
      // Shared offscreen canvas for image drawing
      if (!fileCanvasRef.current) {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 512;
        fileCanvasRef.current = { canvas: c, ctx: c.getContext('2d')! };
      }
      const img = new Image();
      img.onload = () => {
        const fc = fileCanvasRef.current!;
        fc.ctx.drawImage(img, 0, 0, fc.canvas.width, fc.canvas.height);
        // Assign this canvas as texture to fileinput faces
        faces.forEach((face, i) => {
          if (face.scene !== 'fileinput') return;
          const mat = faceMatsRef.current[i];
          if (!mat) return;
          const tex = new THREE.CanvasTexture(fc.canvas);
          faceOrigTexRef.current[i] = tex;
          mat.map = tex;
          mat.emissiveMap = tex;
          mat.needsUpdate = true;
        });
      };
      img.src = url;
      fileSourceRef.current = { type: 'image', el: img };
    }
  }, [faces]);

  // ─── Light type switching ─────────────────────────────────────────────────
  const switchLightType = useCallback((index: number, type: LightType) => {
    const scene3 = sceneRef.current;
    if (!scene3) return;
    const lo = lightObjsRef.current[index];
    if (!lo) return;
    const cfg = lightsRef.current[index];
    const nLed = ledCountRef.current;

    // Remove old
    scene3.remove(lo.threeLight);
    if (lo.ledGroup) scene3.remove(lo.ledGroup);
    if (lo.spotHelper) { scene3.remove(lo.spotHelper); lo.spotHelper.dispose(); }

    let newLight: THREE.PointLight | THREE.SpotLight;
    let newLedGroup: THREE.Group | undefined;
    let newSpotHelper: THREE.SpotLightHelper | undefined;

    if (type === 'spot') {
      const spot = new THREE.SpotLight(cfg.color, cfg.intensity);
      spot.position.set(cfg.x, cfg.y, cfg.z);
      spot.angle = Math.PI / 7;
      spot.penumbra = 0.25;
      spot.distance = 10;
      spot.castShadow = true;
      scene3.add(spot);
      scene3.add(spot.target);
      newLight = spot;
      lo.helperMesh.visible = true;
      newSpotHelper = new THREE.SpotLightHelper(spot);
      scene3.add(newSpotHelper);

    } else if (type === 'led') {
      // Vertical LED strip on inner truss chord
      const cd = cubeDimsRef.current;
      const HW = cd.w / 2, HH = cd.h / 2, HD = cd.d / 2; void HH;
      const th = 0.10;
      const edgePositions: [number, number, number][] = [
        [-HW + th, 0, HD - th],
        [HW - th, 0, HD - th],
        [HW - th, 0, -HD + th],
        [-HW + th, 0, -HD + th],
      ];
      const [ex, , ez] = edgePositions[index % 4];

      const group = new THREE.Group();
      group.position.set(ex, 0, ez);
      const stripLen = cd.h * 0.92;
      const nLedStrip = cfg.ledCount ?? nLed;

      // Tube body (vertical)
      const tbGeo = new THREE.CylinderGeometry(0.018, 0.018, stripLen, 8);
      group.add(new THREE.Mesh(tbGeo, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7, roughness: 0.3 })));

      // LED spheres + lights (vertical, along Y)
      const ledGeo = new THREE.SphereGeometry(0.028, 8, 8);
      for (let k = 0; k < nLedStrip; k++) {
        const yOff = (k / Math.max(1, nLedStrip - 1) - 0.5) * stripLen;
        const ledMat = new THREE.MeshBasicMaterial({ color: cfg.color, toneMapped: false });
        const ledMesh = new THREE.Mesh(ledGeo, ledMat);
        ledMesh.position.set(0, yOff, 0);
        group.add(ledMesh);
        if (k % 3 === 0) {
          const lgt = new THREE.PointLight(cfg.color, cfg.intensity * 0.3, 4);
          lgt.position.set(0, yOff, 0);
          group.add(lgt);
        }
      }
      scene3.add(group);
      newLedGroup = group;
      lo.helperMesh.visible = true;

      // Fill point light at strip center
      const pt = new THREE.PointLight(cfg.color, cfg.intensity * 0.5, 10);
      pt.position.set(ex, 0, ez);
      scene3.add(pt);
      newLight = pt;

      // Update state position to edge
      setLights(prev => prev.map((l, li) => li === index ? { ...l, type, x: ex, y: 0, z: ez } : l));
      lightObjsRef.current[index] = { threeLight: newLight, helperMesh: lo.helperMesh, helperMat: lo.helperMat, ledGroup: newLedGroup };
      return;

    } else {
      const pt = new THREE.PointLight(cfg.color, cfg.intensity, 8);
      pt.position.set(cfg.x, cfg.y, cfg.z);
      pt.castShadow = true;
      scene3.add(pt);
      newLight = pt;
      lo.helperMesh.visible = true;
    }

    lightObjsRef.current[index] = { threeLight: newLight, helperMesh: lo.helperMesh, helperMat: lo.helperMat, ledGroup: newLedGroup, spotHelper: newSpotHelper };
    setLights(prev => prev.map((l, i) => i === index ? { ...l, type } : l));
  }, []);

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const resetCamera = () => {
    cameraRef.current?.position.set(5, 4, 5);
    cameraRef.current?.lookAt(0, 0, 0);
    orbitRef.current?.target.set(0, 0, 0);
    orbitRef.current?.update();
  };

  const updateLight = (i: number, patch: Partial<LightConfig>) =>
    setLights(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const savePreset = () => {
    const name = presetName.trim() || `Preset ${lightPresets.length + 1}`;
    const updated = [...lightPresets.filter(p => p.name !== name), { name, lights: JSON.parse(JSON.stringify(lights)) }];
    setLightPresets(updated);
    localStorage.setItem('stage_viz_light_presets', JSON.stringify(updated));
    setPresetName('');
  };

  const loadPreset = (preset: LightPreset) => {
    preset.lights.forEach((newL, idx) => {
      if (lights[idx] && lights[idx].type !== newL.type) switchLightType(idx, newL.type);
    });
    setLights(preset.lights.map((l, idx) => ({ ...l, id: idx })));
  };

  const deletePreset = (name: string) => {
    const updated = lightPresets.filter(p => p.name !== name);
    setLightPresets(updated);
    localStorage.setItem('stage_viz_light_presets', JSON.stringify(updated));
  };

  const updateFace = (id: number, patch: Partial<FaceConfig>) =>
    setFaces(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));

  // --- PERSISTENCE: Load/Save Effects ---
  useEffect(() => {
    const saved = localStorage.getItem('stage_viz_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.faces) {
          const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone/i.test(navigator.userAgent);
          if (isMobile) {
            setFaces(parsed.faces.map((f: FaceConfig) => ({ ...f, scene: 'trailer' })));
          } else {
            setFaces(parsed.faces);
          }
        }
        if (parsed.lights) setLights(parsed.lights);
        if (parsed.cameraScale) setCameraScale(parsed.cameraScale);
        if (parsed.offFaceOpacity) setOffFaceOpacity(parsed.offFaceOpacity);
        if (parsed.selectedCamId) setSelectedCamId(parsed.selectedCamId);
        if (parsed.autoOrbit !== undefined) setAutoOrbit(parsed.autoOrbit);
        if (parsed.autoOrbitSpeed !== undefined) setAutoOrbitSpeed(parsed.autoOrbitSpeed);
        if (parsed.cubeDims) setCubeDims(parsed.cubeDims);
        if (parsed.rigStyle) setRigStyle(parsed.rigStyle);
      } catch (e) { console.error('Error loading config', e); }
    }
  }, []);

  useEffect(() => {
    const data = JSON.stringify({ faces, lights, cameraScale, offFaceOpacity, selectedCamId, autoOrbit, autoOrbitSpeed, cubeDims, rigStyle });
    localStorage.setItem('stage_viz_config', data);
  }, [faces, lights, cameraScale, offFaceOpacity, selectedCamId, autoOrbit, autoOrbitSpeed, cubeDims, rigStyle]);

  useEffect(() => {
    if (selectedCamId && !cameraActive) {
      startCamera().catch(() => { });
    }
  }, [selectedCamId, cameraActive, startCamera]);

  // ─── Computed values ──────────────────────────────────────────────────────
  const totalPixels = faces.reduce((acc, f) => acc + f.resolution.w * f.resolution.h, 0);
  // Recommended input: face[0] and face[1] side by side
  const recInputW = (faces[0]?.resolution.w ?? 0) + (faces[1]?.resolution.w ?? 0);
  const recInputH = faces[0]?.resolution.h ?? 0;

  // ─── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full" style={{ overflow: 'hidden', fontFamily: "'Courier New', monospace" }}>
      {/* Three.js container */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

      {/* Title */}
      <div className="absolute top-4 left-4 pointer-events-none" style={{ zIndex: 10 }}>
        <h1 className="text-2xl font-bold tracking-widest" style={{ color: '#00FF85' }}>INSIDE THE BOX</h1>
        <p className="text-xs mt-0.5" style={{ color: '#444' }}> By toni y tomi </p>
      </div>

      {/* Top-right controls */}
      <div className="absolute top-24 right-4 flex flex-col gap-2" style={{ zIndex: 10, width: 220 }} onPointerDown={e => e.stopPropagation()}>
        <div className="flex flex-col gap-2 w-full">
          <button className="btn-secondary text-xs w-full py-2 flex items-center justify-center font-bold tracking-widest" onClick={resetCamera}>
            ⌂ RESET CAM
          </button>
          <button
            className={`btn-secondary text-xs w-full py-2 flex items-center justify-center gap-2 transition-all`}
            style={autoOrbit ? { background: '#00FF85', color: '#000', border: '1px solid #00FF85', fontWeight: 'bold' } : {}}
            onClick={() => setAutoOrbit(v => !v)}
          >
            <div className={`w-2 h-2 rounded-full ${autoOrbit ? 'bg-black animate-pulse' : 'bg-gray-600'}`}></div>
            <span className="font-bold tracking-widest">⟳ AUTO ORBIT</span>
          </button>
        </div>

        {autoOrbit && (
          <div className="bg-black/80 backdrop-blur-md p-2 rounded border border-white/5 w-full">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] text-gray-500 uppercase font-bold">Orbit Speed</span>
              <span className="text-[10px] text-blue-400 font-mono">{autoOrbitSpeed.toFixed(1)}x</span>
            </div>
            <input
              type="range" min={-20} max={20} step={0.1} value={autoOrbitSpeed}
              onChange={e => setAutoOrbitSpeed(+e.target.value)}
              className="w-full h-1 accent-[#00FF85]"
            />
          </div>
        )}
      </div>

      {/* Hint */}
      <div className="absolute bottom-4 right-4 text-right pointer-events-none" style={{ zIndex: 10 }}>
        <p className="text-xs" style={{ color: '#333' }}>Drag: Orbit · Scroll: Zoom · R-click: Pan</p>
      </div>

      {/* ── LEFT SIDEBAR (Escenas + Luces) ── */}
      <div className="absolute top-24 left-4 flex flex-col gap-2" style={{ zIndex: 10, width: 256 }} onPointerDown={e => e.stopPropagation()}>
        {/* Mapeo Módulo */}
        <button
          className="w-full text-xs py-2 border border-green-800/50 rounded flex justify-center items-center bg-green-900/20 hover:bg-green-800/40 text-green-400 font-bold tracking-widest uppercase transition-colors"
          onClick={() => setShowMappingUI(true)}
        >
          ⚙ Configurar Mapeiito . _.
        </button>

        {/* PANEL: Cámara Virtual (Independent) */}
        <div>
          <button
            className="btn-secondary text-xs mb-1 w-full flex items-center justify-center relative py-2"
            onClick={() => setShowCameraSection(v => !v)}
          >
            <span className="absolute left-3 text-gray-500">{showCameraSection ? '▼' : '▶'}</span>
            <span style={{ color: '#00FF85', fontWeight: 'bold', letterSpacing: '0.1em' }}>📹 CÁMARA VIRTUAL</span>
          </button>

          {showCameraSection && (
            <div className="control-panel p-3 mb-2" style={{ width: 256 }}>
              <select
                className="w-full text-xs rounded p-1 mb-2"
                style={{ background: '#111', color: '#ccc', border: '1px solid #444' }}
                value={selectedCamId}
                onChange={e => setSelectedCamId(e.target.value)}
              >
                {cameraList.length === 0 && <option>— sin cámaras detectadas —</option>}
                {cameraList.map(c => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || `Cam ${c.deviceId.slice(0, 8)}…`}
                  </option>
                ))}
              </select>
              <button
                className={`w-full text-xs py-1.5 rounded font-bold mb-3 ${cameraActive ? 'btn-primary' : 'btn-secondary'}`}
                onClick={cameraActive ? stopCamera : startCamera}
              >{cameraActive ? '⏹ Detener Cámara' : '▶ Iniciar Cámara'}</button>

              {/* Local file input - Improved UI */}
              <div className="border border-dashed border-gray-600 rounded p-4 text-center hover:border-gray-400 bg-black/40 transition-colors relative cursor-pointer group">
                <p className="text-[10px] text-gray-400 font-bold group-hover:text-white uppercase tracking-widest mb-1">📁 Cargar Archivo</p>
                <p className="text-[8px] text-gray-500">Video (.mp4) o Imagen (.png)</p>
                <input
                  type="file"
                  accept="video/*,image/*"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFileInput(file);
                  }}
                />
              </div>

              {cameraActive && (
                <div className="mt-3 text-center p-2 bg-black/30 rounded border border-green-500/20">
                  <p className="text-xs font-bold" style={{ color: '#00FF85' }}>● Cámara activa</p>
                  <p className="text-[10px] text-gray-500 mt-1">Resolución: {cameraResolution.w}×{cameraResolution.h}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <button
            className="btn-secondary text-xs mb-1 w-full flex items-center justify-center relative py-2 font-bold tracking-widest uppercase"
            onClick={() => setShowFacePanel(v => !v)}
          >
            <span className="absolute left-3 text-gray-500">{showFacePanel ? '▼' : '▶'}</span>
            ESCENAS
          </button>

          {showFacePanel && (
            <div className="control-panel p-3" style={{ width: 256, maxHeight: 480, overflowY: 'auto' }}>
              {/* Global Intensity */}
              <div className="mb-3 pb-3" style={{ borderBottom: '1px solid #333' }}>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] text-gray-500 uppercase">Master Projection</label>
                  <span className="text-xs text-gray-300">{(offFaceOpacity * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={offFaceOpacity}
                  onChange={e => setOffFaceOpacity(parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* SYNC — broadcast one scene to all faces */}
              <div className="mb-3 pb-3" style={{ borderBottom: '1px solid #333' }}>
                <label className="text-[9px] text-gray-500 uppercase block mb-1.5">Sync a todas</label>
                <div className="flex gap-1.5">
                  <select
                    className="flex-1 text-[10px] rounded px-1 py-1"
                    style={{ background: '#111', color: '#ccc', border: '1px solid #444' }}
                    value={syncScene}
                    onChange={e => setSyncScene(e.target.value as SceneType)}
                  >
                    {SCENE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    className="px-2 py-1 rounded text-[10px] font-bold transition-all"
                    style={{ background: '#00FF85', color: '#000', whiteSpace: 'nowrap' }}
                    onClick={() => setFaces(prev => prev.map(f => ({ ...f, scene: syncScene })))}
                  >▶ SYNC</button>
                </div>
              </div>

              {/* Previews toggle */}
              <div className="flex justify-between items-center mb-2">
                <span className="text-[9px] text-gray-500 uppercase">Previews</span>
                <button
                  className="text-[8px] px-2 py-0.5 rounded border"
                  style={{ borderColor: showPreviews ? '#00FF85' : '#333', color: showPreviews ? '#00FF85' : '#555', background: 'transparent' }}
                  onClick={() => setShowPreviews(v => !v)}
                >{showPreviews ? 'Ocultar' : 'Mostrar'}</button>
              </div>

              {/* Per-face scene selector */}
              {faces.map(face => (
                <div key={face.id} className="mb-3">
                  {/* Live preview thumbnail */}
                  {showPreviews && (
                    <canvas
                      ref={el => {
                        if (el) previewCanvasesRef.current.set(face.id, el);
                        else previewCanvasesRef.current.delete(face.id);
                      }}
                      width={112} height={63}
                      className="rounded mb-1"
                      style={{ display: 'block', width: '50%', border: '1px solid rgba(255,255,255,0.08)', background: '#000' }}
                    />
                  )}
                  <input
                    className="w-full text-xs mb-1 bg-transparent border-b border-transparent hover:border-gray-800 focus:border-gray-500 focus:outline-none transition-colors"
                    style={{ color: '#888' }}
                    value={face.name}
                    onChange={e => updateFace(face.id, { name: e.target.value })}
                  />
                  <select
                    className="w-full text-xs rounded p-1"
                    style={{ background: '#111', color: '#ccc', border: '1px solid #444' }}
                    value={face.scene}
                    onChange={e => updateFace(face.id, { scene: e.target.value as SceneType })}
                  >
                    {SCENE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>

                  {/* Per-Scene Parameters */}
                  {face.scene !== 'white' && face.scene !== 'camera' && (
                    <div className="mt-2 p-2 bg-black/30 rounded border border-white/5 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] text-gray-500 uppercase font-bold">Variación</span>
                      </div>

                      {/* text for kinetic */}
                      {face.scene === 'kinetic' && (
                        <>
                          <input type="text" placeholder="TEXT..." value={face.params?.text || ''}
                            onChange={e => updateFace(face.id, { params: { ...face.params, text: e.target.value } })}
                            className="w-full text-[10px] bg-black border border-white/10 rounded px-1 py-0.5 text-white/70" />

                          <div className="flex gap-1">
                            {(['elegant', 'glitch'] as const).map(m => (
                              <button key={m}
                                onClick={() => updateFace(face.id, { params: { ...face.params, motion: m } })}
                                className="flex-1 text-[8px] py-1 rounded border border-white/5 uppercase"
                                style={{ background: face.params?.motion === m ? '#fff' : '#111', color: face.params?.motion === m ? '#000' : '#666' }}>
                                {m}
                              </button>
                            ))}
                          </div>

                          <div className="flex gap-1">
                            {(['color', 'bw'] as const).map(c => (
                              <button key={c}
                                onClick={() => updateFace(face.id, { params: { ...face.params, colorMode: c } })}
                                className="flex-1 text-[8px] py-1 rounded border border-white/5 uppercase"
                                style={{ background: face.params?.colorMode === c ? '#fff' : '#111', color: face.params?.colorMode === c ? '#000' : '#666' }}>
                                {c}
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      {face.scene === 'turbulent' && (
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-[8px] text-gray-500 uppercase">
                            <span>Seed</span>
                            <span>{face.params?.seed || 0}</span>
                          </div>
                          <input type="range" min={0} max={100} step={1} value={face.params?.seed || 0}
                            onChange={e => updateFace(face.id, { params: { ...face.params, seed: +e.target.value } })}
                            className="w-full h-0.5 accent-white" />

                          <label className="flex items-center gap-2 text-[8px] text-gray-500 cursor-pointer pt-1">
                            <input type="checkbox" checked={face.params?.posterize || false}
                              onChange={e => updateFace(face.id, { params: { ...face.params, posterize: e.target.checked } })}
                              className="w-3 h-3" />
                            <span>POSTERIZAR</span>
                          </label>
                        </div>
                      )}

                      {face.scene === 'geo' && (
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-[8px] text-gray-500 uppercase">
                            <span>Layers</span>
                            <span>{face.params?.complexity || 3}</span>
                          </div>
                          <input type="range" min={1} max={15} step={1} value={face.params?.complexity || 3}
                            onChange={e => updateFace(face.id, { params: { ...face.params, complexity: +e.target.value } })}
                            className="w-full h-0.5 accent-white" />
                        </div>
                      )}

                      {/* density for matrix */}
                      {face.scene === 'matrix' && (
                        <div className="flex gap-2 items-center">
                          <span className="text-[8px] text-gray-600">Dns</span>
                          <input type="range" min={0.5} max={3} step={0.1} value={face.params?.density || 1}
                            onChange={e => updateFace(face.id, { params: { ...face.params, density: +e.target.value } })}
                            className="flex-1 h-0.5 accent-white" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── LIGHT PANEL ── */}
        <div>
          <button
            className="btn-secondary text-xs mb-1 w-full flex items-center justify-center relative py-2 font-bold tracking-widest uppercase"
            onClick={() => setShowLightPanel(v => !v)}
          >
            <span className="absolute left-3 text-gray-500">{showLightPanel ? '▼' : '▶'}</span>
            LUCES
          </button>

          {showLightPanel && (
            <div className="control-panel p-3" style={{ width: 256 }}>

              {/* ── Presets ── */}
              <div className="mb-3 pb-3" style={{ borderBottom: '1px solid #222' }}>
                <label className="text-[9px] text-gray-500 uppercase block mb-1.5">Presets</label>
                <div className="flex gap-1 mb-2">
                  <input
                    type="text"
                    placeholder="Nombre…"
                    value={presetName}
                    onChange={e => setPresetName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && savePreset()}
                    className="flex-1 text-[10px] bg-black border border-white/10 rounded px-1.5 py-1 text-white/70 font-mono"
                  />
                  <button
                    className="px-2 py-1 rounded text-[10px] font-bold"
                    style={{ background: '#00FF85', color: '#000' }}
                    onClick={savePreset}
                  >SAVE</button>
                </div>
                {lightPresets.length === 0 && (
                  <p className="text-[8px] text-gray-600 italic">Sin presets guardados</p>
                )}
                <div className="space-y-1" style={{ maxHeight: 120, overflowY: 'auto' }}>
                  {lightPresets.map(p => (
                    <div key={p.name} className="flex items-center gap-1">
                      <button
                        className="flex-1 text-left text-[9px] px-1.5 py-1 rounded truncate"
                        style={{ background: '#111', color: '#aaa', border: '1px solid #2a2a2a' }}
                        onClick={() => loadPreset(p)}
                        title={`Cargar: ${p.name}`}
                      >▶ {p.name}</button>
                      <button
                        className="px-1.5 py-1 rounded text-[9px]"
                        style={{ background: '#1a0000', color: '#ff4444', border: '1px solid #330000' }}
                        onClick={() => deletePreset(p.name)}
                        title="Eliminar"
                      >✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Master controls row ── */}
              <div className="flex gap-1.5 mb-3">
                {/* All ON/OFF */}
                <button
                  className="flex-1 text-xs py-1.5 rounded font-bold transition-all"
                  style={{
                    background: lightsAllOff ? '#ff3333' : '#1a1a1a',
                    color: lightsAllOff ? '#fff' : '#555',
                    border: lightsAllOff ? 'none' : '1px solid #333',
                  }}
                  onClick={() => setLightsAllOff(v => !v)}
                >{lightsAllOff ? '🔴 APAGADO' : '⚡ ENCENDIDO'}</button>
                {/* Chasers */}
                <button
                  className="flex-1 text-xs py-1.5 rounded font-bold transition-all"
                  style={{
                    background: chaserActive ? '#00FF85' : '#1a1a1a',
                    color: chaserActive ? '#000' : '#555',
                    border: chaserActive ? 'none' : '1px solid #333',
                  }}
                  onClick={() => setChaserActive(v => !v)}
                >⚡ CHASE</button>
              </div>
              {chaserActive && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[9px] text-gray-500 uppercase w-8">BPM</span>
                  <input type="range" min={30} max={300} step={1} value={chaserBpm}
                    onChange={e => setChaserBpm(+e.target.value)}
                    className="flex-1 h-1 accent-[#00FF85]" />
                  <input type="number" min={30} max={300} value={chaserBpm}
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setChaserBpm(Math.max(30, Math.min(300, v))); }}
                    className="text-[9px] bg-black border border-white/10 rounded px-1 py-0.5 text-green-400 font-mono"
                    style={{ width: 44 }} />
                </div>
              )}

              {/* Light tabs */}
              <div className="flex gap-1 mb-3">
                {lights.map((l, i) => {
                  const typeEmoji = l.type === 'spot' ? '🔦' : l.type === 'led' ? '💡' : '💡';
                  return (
                    <button key={i} className="flex-1 text-xs py-1 rounded"
                      style={{
                        background: l.color, color: '#000', fontWeight: 'bold',
                        border: activeLightTab === i ? '2px solid #fff' : '2px solid transparent',
                        opacity: lightsAllOff ? 0.2 : Math.max(0.35, Math.min(1, l.intensity / 4)),
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => setActiveLightTab(i)}
                    >{typeEmoji} {l.name.split(' ')[1]}</button>
                  );
                })}
              </div>

              {(() => {
                const l = lights[activeLightTab];
                if (!l) return null;
                const i = activeLightTab;
                const numInput = (val: number, min: number, max: number, step: number, key: string) => (
                  <input
                    type="number" min={min} max={max} step={step} value={val}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) updateLight(i, { [key]: Math.max(min, Math.min(max, v)) });
                    }}
                    className="text-[9px] bg-black border border-white/10 rounded px-1 py-0.5 text-green-400 font-mono"
                    style={{ width: 50 }}
                  />
                );
                return (
                  <div>
                    {/* Type selector */}
                    <div className="flex gap-1 mb-3">
                      {(['point', 'spot', 'led'] as LightType[]).map(t => (
                        <button key={t} className="flex-1 text-xs py-1.5 rounded"
                          style={{
                            background: l.type === t ? '#00FF85' : '#1a1a1a',
                            color: l.type === t ? '#000' : '#666',
                            fontWeight: l.type === t ? 'bold' : 'normal',
                            border: l.type === t ? 'none' : '1px solid #333',
                          }}
                          onClick={() => switchLightType(i, t)}>
                          {t === 'point' ? '💡 Point' : t === 'spot' ? '🔦 Spot' : '💡 Leds'}
                        </button>
                      ))}
                    </div>

                    {/* Color + intensity */}
                    <div className="flex items-center gap-2 mb-2">
                      <input type="color" value={l.color}
                        onChange={e => updateLight(i, { color: e.target.value })}
                        className="cursor-pointer" style={{ width: 36, height: 28 }} />
                      <div className="flex-1">
                        <label className="text-[9px] text-gray-500 uppercase block mb-0.5">Intensidad</label>
                        <div className="flex items-center gap-1">
                          <input type="range" min={0} max={10} step={0.1} value={l.intensity}
                            onChange={e => updateLight(i, { intensity: +e.target.value })}
                            className="flex-1 h-1 accent-[#00FF85]" />
                          {numInput(l.intensity, 0, 10, 0.1, 'intensity')}
                        </div>
                      </div>
                    </div>

                    {/* Per-light LED count (only for led type) */}
                    {l.type === 'led' && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-[9px] text-gray-500 uppercase" style={{ minWidth: 28 }}>LEDs</span>
                        <input type="range" min={2} max={48} step={1} value={l.ledCount ?? 12}
                          onChange={e => {
                            updateLight(i, { ledCount: +e.target.value });
                            switchLightType(i, 'led');
                          }}
                          className="flex-1 h-1 accent-[#00FF85]" />
                        {numInput(l.ledCount ?? 12, 2, 48, 1, 'ledCount')}
                      </div>
                    )}

                    {/* Strobe */}
                    <div className="mb-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className={`toggle-switch ${l.strobe ? 'active' : ''}`}
                          onClick={() => updateLight(i, { strobe: !l.strobe })} />
                        <span className="text-[9px] text-gray-500 uppercase">Strobe</span>
                      </div>
                      {l.strobe && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-gray-500 uppercase w-4">Hz</span>
                          <input type="range" min={0.5} max={20} step={0.5} value={l.strobeHz ?? 3}
                            onChange={e => updateLight(i, { strobeHz: +e.target.value })}
                            className="flex-1 h-1 accent-[#00FF85]" />
                          {numInput(l.strobeHz ?? 3, 0.5, 20, 0.5, 'strobeHz')}
                        </div>
                      )}
                    </div>

                    {/* Position XYZ */}
                    <p className="text-[9px] text-gray-500 uppercase mb-1">Posición XYZ</p>
                    {(['x', 'y', 'z'] as const).map(ax => (
                      <div key={ax} className="flex items-center gap-1 mb-1">
                        <span className="text-xs w-3 font-bold" style={{ color: ax === 'x' ? '#f66' : ax === 'y' ? '#6f6' : '#66f' }}>
                          {ax.toUpperCase()}
                        </span>
                        <input type="range" min={-2.5} max={2.5} step={0.02} value={l[ax]}
                          onChange={e => updateLight(i, { [ax]: +e.target.value })}
                          className="flex-1 h-1 accent-[#00FF85]" />
                        {numInput(l[ax], -2.5, 2.5, 0.01, ax)}
                      </div>
                    ))}

                    {/* Rotation (spot + led) */}
                    {(l.type === 'spot' || l.type === 'led') && (
                      <>
                        <p className="text-[9px] text-gray-500 uppercase mb-1 mt-2">Rotación</p>
                        {(['rotX', 'rotY'] as const).map(ax => (
                          <div key={ax} className="flex items-center gap-1 mb-1">
                            <span className="text-[9px] text-gray-500" style={{ minWidth: 28 }}>
                              {ax === 'rotX' ? 'TILT' : 'PAN'}
                            </span>
                            <input type="range" min={-180} max={180} step={1} value={l[ax]}
                              onChange={e => updateLight(i, { [ax]: +e.target.value })}
                              className="flex-1 h-1 accent-[#00FF85]" />
                            {numInput(l[ax], -180, 180, 1, ax)}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT FLOATING PANELS ── */}
      <div className="absolute right-4 flex flex-col gap-2 transition-all duration-300" style={{ zIndex: 10, width: 220, top: autoOrbit ? '14.5rem' : '11.5rem' }} onPointerDown={e => e.stopPropagation()}>

        {/* Panel A — Estructura */}
        <div>
          <button
            className="btn-secondary text-xs mb-1 w-full flex items-center justify-center relative py-2 font-bold tracking-widest uppercase"
            onClick={() => setShowEstructuraPanel(v => !v)}
          >
            <span className="absolute left-3 text-gray-500">{showEstructuraPanel ? '▼' : '▶'}</span>
            ESTRUCTURA
          </button>
          {showEstructuraPanel && (
            <div className="control-panel p-3" style={{ width: 220 }}>
              {/* Rig style toggle */}
              <div className="mb-3 pb-3" style={{ borderBottom: '1px solid #333' }}>
                <label className="text-[9px] text-gray-500 uppercase block mb-1.5">Estilo Rig</label>
                <div className="flex gap-1">
                  <button
                    className="flex-1 text-xs py-1.5 rounded font-bold transition-all"
                    style={{
                      background: rigStyle === 'pipe' ? '#00FF85' : '#1a1a1a',
                      color: rigStyle === 'pipe' ? '#000' : '#666',
                      border: rigStyle === 'pipe' ? 'none' : '1px solid #333',
                    }}
                    onClick={() => setRigStyle('pipe')}
                  >⬜ Pipe</button>
                  <button
                    className="flex-1 text-xs py-1.5 rounded font-bold transition-all"
                    style={{
                      background: rigStyle === 'truss' ? '#00FF85' : '#1a1a1a',
                      color: rigStyle === 'truss' ? '#000' : '#666',
                      border: rigStyle === 'truss' ? 'none' : '1px solid #333',
                    }}
                    onClick={() => setRigStyle('truss')}
                  >▦ Truss</button>
                </div>
              </div>

              {/* Cube dimensions */}
              <label className="text-[9px] text-gray-500 uppercase block mb-2">Dimensiones</label>
              {(['w', 'h', 'd'] as const).map(dim => {
                const labels: Record<string, string> = { w: 'Ancho (W)', h: 'Alto (H)', d: 'Profundidad (D)' };
                return (
                  <div key={dim} className="flex items-center gap-2 mb-2">
                    <label className="text-[9px] text-gray-500 uppercase" style={{ minWidth: 76 }}>{labels[dim]}</label>
                    <input
                      type="number"
                      min={0.5} max={20} step={0.1}
                      value={cubeDims[dim]}
                      onChange={e => setCubeDims(prev => ({ ...prev, [dim]: Math.max(0.5, Math.min(20, +e.target.value || 0.5)) }))}
                      className="flex-1 text-[10px] bg-black border border-white/10 rounded px-1 py-0.5 text-green-400 font-mono"
                      style={{ width: 52 }}
                    />
                    <span className="text-[9px] text-gray-600">m</span>
                  </div>
                );
              })}
              <div className="mt-1 text-center text-[9px] text-gray-500 font-mono">
                {cubeDims.w.toFixed(1)} × {cubeDims.h.toFixed(1)} × {cubeDims.d.toFixed(1)} m
              </div>
            </div>
          )}
        </div>

        {/* Panel B — Resolución */}
        <div>
          <button
            className="btn-secondary text-xs mb-1 w-full flex items-center justify-center relative py-2 font-bold tracking-widest uppercase"
            onClick={() => setShowResolucionPanel(v => !v)}
          >
            <span className="absolute left-3 text-gray-500">{showResolucionPanel ? '▼' : '▶'}</span>
            RESOLUCIÓN
          </button>
          {showResolucionPanel && (
            <div className="control-panel p-3" style={{ width: 220 }}>
              <label className="text-[9px] text-gray-500 uppercase block mb-2">Resolución por Cara</label>
              {faces.map(face => (
                <div key={face.id} className="mb-2.5">
                  <p className="text-[9px] text-gray-400 mb-1">{face.name}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[8px] text-gray-600">W:</span>
                    <input
                      type="number"
                      min={64} max={2048} step={1}
                      value={face.resolution.w}
                      onChange={e => {
                        const v = Math.max(64, Math.min(2048, parseInt(e.target.value) || 64));
                        updateFace(face.id, { resolution: { ...face.resolution, w: v } });
                      }}
                      className="text-[9px] bg-black border border-white/10 rounded px-1 py-0.5 text-green-400 font-mono"
                      style={{ width: 54 }}
                    />
                    <span className="text-[8px] text-gray-600">×</span>
                    <span className="text-[8px] text-gray-600">H:</span>
                    <input
                      type="number"
                      min={64} max={2048} step={1}
                      value={face.resolution.h}
                      onChange={e => {
                        const v = Math.max(64, Math.min(2048, parseInt(e.target.value) || 64));
                        updateFace(face.id, { resolution: { ...face.resolution, h: v } });
                      }}
                      className="text-[9px] bg-black border border-white/10 rounded px-1 py-0.5 text-green-400 font-mono"
                      style={{ width: 54 }}
                    />
                  </div>
                </div>
              ))}

              <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid #222' }}>
                <div className="flex justify-between text-[8px]">
                  <span className="text-gray-500 uppercase">Total px</span>
                  <span className="text-green-400 font-mono">{totalPixels.toLocaleString()}</span>
                </div>
                <div className="text-[8px] text-gray-500 uppercase">Res. entrada recomendada:</div>
                <div className="text-[9px] text-green-400 font-mono">{recInputW} × {recInputH}</div>
              </div>

            </div>
          )}
        </div>

      </div>

      {/* ── MAPPING OVERLAY (FLOATING & GLASSMORPHIC) ── */}
      {showMappingUI && (
        <div
          className="fixed z-[100] flex flex-col pointer-events-auto select-none"
          style={{
            left: mappingPos.x, top: mappingPos.y,
            width: 860, height: 620,
            background: 'rgba(15, 15, 15, 0.75)',
            backdropFilter: 'blur(30px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.9)',
            display: 'flex', flexFlow: 'column'
          }}
          onPointerDown={e => e.stopPropagation()}
        >
          {/* Draggable Header */}
          <div
            className="p-3 border-b border-white/5 flex justify-between items-center cursor-move bg-white/5"
            onPointerDown={e => {
              dragStartRef.current = { x: e.clientX, y: e.clientY, winX: mappingPos.x, winY: mappingPos.y };
              const move = (me: PointerEvent) => {
                const dx = me.clientX - dragStartRef.current.x;
                const dy = me.clientY - dragStartRef.current.y;
                setMappingPos({ x: dragStartRef.current.winX + dx, y: dragStartRef.current.winY + dy });
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
          >
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <h2 className="text-[10px] font-black text-white/50 tracking-[0.2em] uppercase">Configurar mapeito . _.</h2>
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1 bg-white/5 hover:bg-white/10 text-white/70 text-[10px] rounded transition-all uppercase font-bold"
                onClick={undo}>Undo</button>
              <button className="px-3 py-1 bg-green-500 hover:bg-green-400 text-black text-[10px] rounded transition-all uppercase font-bold"
                onClick={() => setShowMappingUI(false)}>Cerrar</button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col p-4 gap-4">
            {/* Info section */}
            <div className="bg-black/40 rounded-lg border border-white/5 p-3 text-[9px] text-white/40 space-y-1">
              <div className="flex gap-4 flex-wrap">
                <span><span className="text-white/20 uppercase">Dims:</span> <span className="text-green-400 font-mono">{cubeDims.w.toFixed(1)}×{cubeDims.h.toFixed(1)}×{cubeDims.d.toFixed(1)} m</span></span>
                <span><span className="text-white/20 uppercase">Total px:</span> <span className="text-green-400 font-mono">{totalPixels.toLocaleString()}</span></span>
              </div>
              <div className="flex gap-3 flex-wrap">
                {faces.map(f => (
                  <span key={f.id} className="font-mono">{f.name}: <span className="text-white/60">{f.resolution.w}×{f.resolution.h}</span></span>
                ))}
              </div>
            </div>

            {/* Global Config Tools */}
            <div className="flex gap-2">
              <button
                className="px-2 py-1 bg-red-900/50 hover:bg-red-800 text-[9px] text-white/70 rounded border border-red-500/20 uppercase"
                onClick={() => {
                  if (confirm('¿Restablecer todo a fábrica?')) {
                    localStorage.removeItem('stage_viz_config');
                    window.location.reload();
                  }
                }}
              >Factory Reset</button>
            </div>

            {/* Preview Container */}
            <div
              ref={previewContainerRef}
              className="relative bg-black rounded-lg border border-white/5 overflow-hidden"
              style={{ height: 320 }}
            >
              {/* Composite canvas — shows live content of each face at its mapping position */}
              <canvas
                ref={mappingPreviewCanvasRef}
                width={860}
                height={320}
                className="absolute inset-0 w-full h-full"
              />

              {/* Draggable segment overlays — Resolume-style with 8-point resize handles */}
              <div className="absolute inset-0" style={{ overflow: 'visible' }}>
                {(() => {
                  const COLORS = ['#ff0066', '#00ff85', '#0066ff', '#ffff00'];
                  const HANDLES: { key: string; style: React.CSSProperties }[] = [
                    { key: 'nw', style: { top: -5, left:  -5, cursor: 'nwse-resize' } },
                    { key: 'n',  style: { top: -5, left: 'calc(50% - 5px)', cursor: 'ns-resize' } },
                    { key: 'ne', style: { top: -5, right: -5, cursor: 'nesw-resize' } },
                    { key: 'e',  style: { top: 'calc(50% - 5px)', right: -5, cursor: 'ew-resize' } },
                    { key: 'se', style: { bottom: -5, right: -5, cursor: 'nwse-resize' } },
                    { key: 's',  style: { bottom: -5, left: 'calc(50% - 5px)', cursor: 'ns-resize' } },
                    { key: 'sw', style: { bottom: -5, left:  -5, cursor: 'nesw-resize' } },
                    { key: 'w',  style: { top: 'calc(50% - 5px)', left: -5, cursor: 'ew-resize' } },
                  ];
                  return faces.map((face, index) => {
                    const color = COLORS[index];
                    return (
                      <div
                        key={face.id}
                        className="absolute select-none"
                        style={{ left: `${face.mapping.x * 100}%`, top: `${face.mapping.y * 100}%`, width: `${face.mapping.w * 100}%`, height: `${face.mapping.h * 100}%`, border: `2px solid ${color}`, background: color + '15', boxSizing: 'border-box', cursor: 'move' }}
                        onPointerDown={e => {
                          if ((e.target as HTMLElement).dataset.handle) return;
                          e.stopPropagation();
                          (e.target as HTMLElement).setPointerCapture(e.pointerId);
                          faceDragRef.current = { faceId: face.id, startMouseX: e.clientX, startMouseY: e.clientY, startMX: face.mapping.x, startMY: face.mapping.y, mW: face.mapping.w, mH: face.mapping.h };
                        }}
                        onPointerMove={e => {
                          const drag = faceDragRef.current;
                          if (!drag || drag.faceId !== face.id) return;
                          const rect = previewContainerRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          updateFace(face.id, { mapping: { ...face.mapping, x: drag.startMX + (e.clientX - drag.startMouseX) / rect.width, y: drag.startMY + (e.clientY - drag.startMouseY) / rect.height } });
                        }}
                        onPointerUp={() => { faceDragRef.current = null; }}
                      >
                        <div className="absolute top-0 left-0 px-1 py-0.5 text-[7px] font-bold uppercase pointer-events-none" style={{ background: color, color: '#000' }}>{face.name}</div>
                        <div className="absolute bottom-0 right-0 px-1 py-0.5 text-[7px] font-bold uppercase pointer-events-none" style={{ background: color + 'bb', color: '#000' }}>{face.name}</div>

                        {HANDLES.map(({ key, style }) => (
                          <div
                            key={key}
                            data-handle={key}
                            className="absolute"
                            style={{ width: 10, height: 10, background: '#fff', border: `2px solid ${color}`, boxSizing: 'border-box', zIndex: 20, ...style }}
                            onPointerDown={e => {
                              e.stopPropagation();
                              (e.target as HTMLElement).setPointerCapture(e.pointerId);
                              faceResizeRef.current = { faceId: face.id, handle: key, startMouseX: e.clientX, startMouseY: e.clientY, startMX: face.mapping.x, startMY: face.mapping.y, startMW: face.mapping.w, startMH: face.mapping.h };
                            }}
                            onPointerMove={e => {
                              const r = faceResizeRef.current;
                              if (!r || r.faceId !== face.id || r.handle !== key) return;
                              const rect = previewContainerRef.current?.getBoundingClientRect();
                              if (!rect) return;
                              const dx = (e.clientX - r.startMouseX) / rect.width;
                              const dy = (e.clientY - r.startMouseY) / rect.height;
                              let x = r.startMX, y = r.startMY, w = r.startMW, h = r.startMH;
                              if (key.includes('e')) w = Math.max(0.02, w + dx);
                              if (key.includes('w')) { x = x + dx; w = Math.max(0.02, w - dx); }
                              if (key.includes('s')) h = Math.max(0.02, h + dy);
                              if (key.includes('n')) { y = y + dy; h = Math.max(0.02, h - dy); }
                              updateFace(face.id, { mapping: { x, y, w, h } });
                            }}
                            onPointerUp={() => { faceResizeRef.current = null; }}
                          />
                        ))}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Precision Inputs */}
            {(() => {
              const COLORS = ['#ff0066', '#00ff85', '#0066ff', '#ffff00'];
              return (
                <div className="grid grid-cols-4 gap-3 bg-black/40 p-3 rounded-lg border border-white/5 overflow-y-auto">
                  {faces.map((f, idx) => {
                    const color = COLORS[idx];
                    const row = (label: string, val: number, onChange: (v: number) => void, min = -1, max = 2) => (
                      <div key={label}>
                        <div className="flex justify-between text-[8px] text-white/30 uppercase mb-0.5"><span>{label}</span><span>{val.toFixed(3)}</span></div>
                        <input type="range" min={min} max={max} step={0.001} value={val} onChange={e => onChange(+e.target.value)} className="w-full accent-white h-1" />
                      </div>
                    );
                    return (
                      <div key={f.id} className="space-y-1.5 border-l-2 pl-2" style={{ borderColor: color }}>
                        <p className="text-[9px] font-black uppercase" style={{ color }}>{f.name}</p>
                        {row('X', f.mapping.x, v => updateFace(f.id, { mapping: { ...f.mapping, x: v } }))}
                        {row('Y', f.mapping.y, v => updateFace(f.id, { mapping: { ...f.mapping, y: v } }))}
                        {row('W', f.mapping.w, v => updateFace(f.id, { mapping: { ...f.mapping, w: Math.max(0.01, v) } }), 0.01, 2)}
                        {row('H', f.mapping.h, v => updateFace(f.id, { mapping: { ...f.mapping, h: Math.max(0.01, v) } }), 0.01, 2)}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

    </div>
  );
}
