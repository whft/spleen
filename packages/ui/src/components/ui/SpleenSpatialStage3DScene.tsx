import React from 'react';
import * as THREE from 'three';
import { cn } from '@/lib/utils';

export interface SpleenSpatialStage3DProps {
  className?: string;
}

export const SpleenSpatialStage3DScene: React.FC<SpleenSpatialStage3DProps> = React.memo(({ className }) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [fallback, setFallback] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (reducedMotionQuery?.matches) {
      setFallback(true);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'default',
      });
    } catch {
      setFallback(true);
      return;
    }

    const getSize = () => ({
      width: Math.max(container.clientWidth || window.innerWidth, 320),
      height: Math.max(container.clientHeight || window.innerHeight, 280),
    });

    const initial = getSize();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(initial.width, initial.height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.setAttribute('aria-hidden', 'true');
    container.innerHTML = '';
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x08090a, 0.088);

    const camera = new THREE.PerspectiveCamera(44, initial.width / initial.height, 0.1, 60);
    camera.position.set(0, 1.45, 7.6);
    camera.lookAt(0, -0.35, 0);

    const root = new THREE.Group();
    scene.add(root);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    // Architectural perspective grid floor
    const grid = new THREE.GridHelper(32, 34, 0x262c30, 0x15191c);
    grid.position.set(0, -2.05, -2.5);
    root.add(grid);

    // Horizon calibration arc
    const arcGeo = new THREE.RingGeometry(4.2, 4.225, 96);
    geometries.push(arcGeo);
    const arcMat = new THREE.MeshBasicMaterial({
      color: 0x2c3236,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.52,
    });
    materials.push(arcMat);
    const arcMesh = new THREE.Mesh(arcGeo, arcMat);
    arcMesh.rotation.x = Math.PI / 2;
    arcMesh.position.set(0, -2.02, -2.2);
    root.add(arcMesh);

    // Distant sculpted obsidian wireframe architectural planes (asymmetric depth framing)
    const frameEdgeMat = new THREE.LineBasicMaterial({
      color: 0x2a3135,
      transparent: true,
      opacity: 0.42,
    });
    const accentEdgeMat = new THREE.LineBasicMaterial({
      color: 0xc8fa62,
      transparent: true,
      opacity: 0.18,
    });
    materials.push(frameEdgeMat, accentEdgeMat);

    const slabs: Array<{ obj: THREE.Object3D; baseY: number; phase: number }> = [];
    const slabConfigs = [
      { pos: [-5.6, 0.25, -4.4], size: [1.5, 2.8, 0.12], rot: [0.06, 0.42, 0.02], accent: false },
      { pos: [5.8, -0.1, -5.0], size: [1.8, 2.4, 0.12], rot: [-0.04, -0.48, -0.02], accent: false },
      { pos: [-3.9, 1.35, -7.2], size: [0.95, 1.5, 0.08], rot: [0.1, 0.25, 0], accent: true },
      { pos: [4.1, 1.25, -7.6], size: [1.1, 1.35, 0.08], rot: [-0.08, -0.28, 0], accent: false },
    ] as const;

    slabConfigs.forEach((cfg, idx) => {
      const boxGeo = new THREE.BoxGeometry(cfg.size[0], cfg.size[1], cfg.size[2]);
      const edgeGeo = new THREE.EdgesGeometry(boxGeo);
      boxGeo.dispose();
      geometries.push(edgeGeo);
      const wire = new THREE.LineSegments(edgeGeo, cfg.accent ? accentEdgeMat : frameEdgeMat);
      wire.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      wire.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
      root.add(wire);
      slabs.push({ obj: wire, baseY: cfg.pos[1], phase: idx * 1.45 });
    });

    // Subtle spatial depth motes (platinum + rare surgical lime precision ticks)
    const moteCount = 96;
    const motePositions = new Float32Array(moteCount * 3);
    const moteColors = new Float32Array(moteCount * 3);
    const colPlatinum = new THREE.Color('#959D9C');
    const colLime = new THREE.Color('#C8FA62');

    for (let i = 0; i < moteCount; i += 1) {
      motePositions[i * 3] = (Math.random() - 0.5) * 18;
      motePositions[i * 3 + 1] = -1.6 + Math.random() * 5.2;
      motePositions[i * 3 + 2] = -10.5 + Math.random() * 11.5;
      const isAccent = i % 9 === 0;
      const c = isAccent ? colLime : colPlatinum;
      moteColors[i * 3] = c.r;
      moteColors[i * 3 + 1] = c.g;
      moteColors[i * 3 + 2] = c.b;
    }

    const motesGeo = new THREE.BufferGeometry();
    motesGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
    motesGeo.setAttribute('color', new THREE.BufferAttribute(moteColors, 3));
    geometries.push(motesGeo);

    const motesMat = new THREE.PointsMaterial({
      size: 0.045,
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    materials.push(motesMat);
    const motes = new THREE.Points(motesGeo, motesMat);
    root.add(motes);

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let rafId: number | null = null;
    let isVisibleInViewport = true;
    let isDocumentVisible = !document.hidden;
    const startTime = performance.now();

    const renderFrame = (now: number) => {
      rafId = null;
      if (!isVisibleInViewport || !isDocumentVisible) return;
      const elapsed = (now - startTime) * 0.001;
      currentX += (targetX - currentX) * 0.04;
      currentY += (targetY - currentY) * 0.04;

      camera.position.x = currentX * 0.65 + Math.sin(elapsed * 0.16) * 0.14;
      camera.position.y = 1.45 - currentY * 0.28 + Math.cos(elapsed * 0.13) * 0.06;
      camera.lookAt(0, -0.35, -1.6);

      motes.rotation.y = elapsed * 0.018;
      arcMesh.rotation.z = elapsed * 0.04;

      for (const slab of slabs) {
        slab.obj.position.y = slab.baseY + Math.sin(elapsed * 0.45 + slab.phase) * 0.11;
      }

      renderer.render(scene, camera);
      rafId = window.requestAnimationFrame(renderFrame);
    };

    const startLoop = () => {
      if (rafId === null && isVisibleInViewport && isDocumentVisible) {
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    const stopLoop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const vw = Math.max(window.innerWidth, 1);
      const vh = Math.max(window.innerHeight, 1);
      targetX = ((event.clientX / vw) - 0.5) * 2;
      targetY = ((event.clientY / vh) - 0.5) * 2;
    };

    const handleResize = () => {
      const next = getSize();
      camera.aspect = next.width / next.height;
      camera.updateProjectionMatrix();
      renderer.setSize(next.width, next.height);
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    resizeObserver?.observe(container);

    const intersectionObserver = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          (entries) => {
            isVisibleInViewport = entries.some((entry) => entry.isIntersecting);
            if (isVisibleInViewport) startLoop();
            else stopLoop();
          },
          { threshold: 0.02 },
        )
      : null;
    intersectionObserver?.observe(container);

    const handleVisibilityChange = () => {
      isDocumentVisible = !document.hidden;
      if (isDocumentVisible) startLoop();
      else stopLoop();
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      stopLoop();
      setFallback(true);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    canvas.addEventListener('webglcontextlost', handleContextLost);

    startLoop();

    return () => {
      stopLoop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      if (Array.isArray(grid.material)) grid.material.forEach((m) => m.dispose());
      else grid.material.dispose();
      grid.geometry.dispose();
      renderer.dispose();
      if (canvas.parentNode === container) container.removeChild(canvas);
    };
  }, []);

  if (fallback) {
    return (
      <div
        aria-hidden="true"
        className={cn('pointer-events-none select-none', className)}
        style={{
          background:
            'radial-gradient(ellipse 68% 54% at 50% 42%, rgba(23, 27, 29, 0.55) 0%, rgba(8, 9, 10, 0) 76%)',
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      data-spleen-spatial-stage-3d="true"
      className={cn('pointer-events-none overflow-hidden select-none', className)}
    >
      <div ref={containerRef} className="h-full w-full opacity-90" />
      {/* Seamless obsidian vignette so foreground composer & typography stay razor sharp */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 76% 64% at 50% 48%, rgba(8, 9, 10, 0.08) 0%, rgba(8, 9, 10, 0.68) 72%, rgba(8, 9, 10, 0.98) 100%)',
        }}
      />
    </div>
  );
});

export default SpleenSpatialStage3DScene;
