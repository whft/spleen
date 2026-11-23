import React from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SPLEEN_LOGO_ART } from './spleenLogoArt';
import { SpleenLogo } from './SpleenLogo';
import { cn } from '@/lib/utils';

export interface SpleenMonolith3DProps {
  size?: number;
  className?: string;
  interactive?: boolean;
}

function svgPathToShape(pathStr: string): THREE.Shape {
  const shape = new THREE.Shape();
  const tokens = pathStr.trim().split(/\s+/);
  let i = 0;
  let cx = 0;
  let cy = 0;
  const toWorldX = (x: number) => (x - 500) / 290;
  const toWorldY = (y: number) => (500 - y) / 290;

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M': {
        cx = Number(tokens[i++]);
        cy = Number(tokens[i++]);
        shape.moveTo(toWorldX(cx), toWorldY(cy));
        break;
      }
      case 'L': {
        cx = Number(tokens[i++]);
        cy = Number(tokens[i++]);
        shape.lineTo(toWorldX(cx), toWorldY(cy));
        break;
      }
      case 'H': {
        cx = Number(tokens[i++]);
        shape.lineTo(toWorldX(cx), toWorldY(cy));
        break;
      }
      case 'V': {
        cy = Number(tokens[i++]);
        shape.lineTo(toWorldX(cx), toWorldY(cy));
        break;
      }
      case 'Z':
      case 'z': {
        shape.closePath();
        break;
      }
      default:
        break;
    }
  }
  return shape;
}

export const SpleenMonolith3DScene: React.FC<SpleenMonolith3DProps> = React.memo(
  ({ size = 96, className, interactive = true }) => {
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

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(size, size);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;

      const canvas = renderer.domElement;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.style.display = 'block';
      canvas.setAttribute('aria-hidden', 'true');
      container.innerHTML = '';
      container.appendChild(canvas);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
      camera.position.set(0, 0, 4.35);

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const roomEnv = new RoomEnvironment();
      const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
      scene.environment = envTarget.texture;
      roomEnv.dispose();

      const group = new THREE.Group();
      scene.add(group);

      const extrudeSettings: THREE.ExtrudeGeometryOptions = {
        depth: 0.18,
        bevelEnabled: true,
        bevelThickness: 0.032,
        bevelSize: 0.026,
        bevelSegments: 3,
      };

      const outerMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#24292D'),
        metalness: 0.88,
        roughness: 0.24,
        envMapIntensity: 1.45,
      });

      const coreMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#B4BCBA'),
        metalness: 0.94,
        roughness: 0.17,
        envMapIntensity: 1.7,
      });

      const outerEdgeMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color('#E5E8E3'),
        transparent: true,
        opacity: 0.28,
      });

      const coreEdgeMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color('#F1F2EF'),
        transparent: true,
        opacity: 0.48,
      });

      const geometries: THREE.BufferGeometry[] = [];
      const bladeMeshes: THREE.Object3D[] = [];

      SPLEEN_LOGO_ART.shell.forEach((pathStr, idx) => {
        const shape = svgPathToShape(pathStr);
        const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geo.translate(0, 0, -0.09);
        geometries.push(geo);

        const mesh = new THREE.Mesh(geo, outerMaterial);
        const edgeGeo = new THREE.EdgesGeometry(geo, 24);
        geometries.push(edgeGeo);
        const edges = new THREE.LineSegments(edgeGeo, outerEdgeMaterial);
        mesh.add(edges);
        mesh.position.z = idx === 0 ? 0.045 : -0.045;
        group.add(mesh);
        bladeMeshes.push(mesh);
      });

      const coreShape = svgPathToShape(SPLEEN_LOGO_ART.core);
      const coreGeo = new THREE.ExtrudeGeometry(coreShape, {
        ...extrudeSettings,
        depth: 0.22,
      });
      coreGeo.translate(0, 0, -0.11);
      geometries.push(coreGeo);

      const coreMesh = new THREE.Mesh(coreGeo, coreMaterial);
      const coreEdgeGeo = new THREE.EdgesGeometry(coreGeo, 24);
      geometries.push(coreEdgeGeo);
      const coreEdges = new THREE.LineSegments(coreEdgeGeo, coreEdgeMaterial);
      coreMesh.add(coreEdges);
      coreMesh.position.z = 0.01;
      group.add(coreMesh);
      bladeMeshes.push(coreMesh);

      // Sculptural counter-tilted telemetry halo rings framing the monolith
      const outerHaloGeo = new THREE.TorusGeometry(1.18, 0.01, 14, 72);
      const innerHaloGeo = new THREE.TorusGeometry(0.98, 0.007, 12, 64);
      geometries.push(outerHaloGeo, innerHaloGeo);

      const outerHaloMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#3B4247'),
        metalness: 0.9,
        roughness: 0.25,
        transparent: true,
        opacity: 0.55,
      });
      const innerHaloMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color('#C8FA62'),
        transparent: true,
        opacity: 0.28,
      });

      const outerHalo = new THREE.Mesh(outerHaloGeo, outerHaloMat);
      outerHalo.rotation.set(Math.PI / 2.6, 0.25, 0);
      group.add(outerHalo);

      const innerHalo = new THREE.Mesh(innerHaloGeo, innerHaloMat);
      innerHalo.rotation.set(Math.PI / 1.9, -0.45, 0);
      group.add(innerHalo);

      // Precision studio lighting: platinum key, cool slate fill, surgical lime rim glint
      const keyLight = new THREE.DirectionalLight(0xf1f2ef, 2.4);
      keyLight.position.set(2.4, 3.2, 3.5);
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0x959d9c, 1.15);
      fillLight.position.set(-2.8, -1.8, 2.0);
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xc8fa62, 0.55);
      rimLight.position.set(1.8, -2.6, -2.2);
      scene.add(rimLight);

      // Initial sculptural 3/4 poise
      group.rotation.y = -0.22;
      group.rotation.x = 0.12;

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
        if (!isVisibleInViewport || !isDocumentVisible) {
          return;
        }
        const elapsed = (now - startTime) * 0.001;
        currentX += (targetX - currentX) * 0.08;
        currentY += (targetY - currentY) * 0.08;

        group.rotation.y = -0.22 + Math.sin(elapsed * 0.85) * 0.16 + currentX * 0.42;
        group.rotation.x = 0.12 + Math.cos(elapsed * 0.65) * 0.08 + currentY * 0.32;
        group.position.y = Math.sin(elapsed * 1.2) * 0.035;

        if (bladeMeshes[0]) {
          bladeMeshes[0].position.z = 0.045 + Math.sin(elapsed * 1.1) * 0.018;
        }
        if (bladeMeshes[1]) {
          bladeMeshes[1].position.z = -0.045 - Math.sin(elapsed * 1.1) * 0.018;
        }
        outerHalo.rotation.z = elapsed * 0.24;
        innerHalo.rotation.z = -elapsed * 0.36;

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

      const handlePointerMove = (e: PointerEvent) => {
        if (!interactive) return;
        const rect = container.getBoundingClientRect();
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.5;
        const normX = Math.max(-1, Math.min(1, (e.clientX - centerX) / 260));
        const normY = Math.max(-1, Math.min(1, (e.clientY - centerY) / 260));
        targetX = normX;
        targetY = normY;
      };

      const handleVisibilityChange = () => {
        isDocumentVisible = !document.hidden;
        if (isDocumentVisible) {
          startLoop();
        } else {
          stopLoop();
        }
      };

      const handleContextLost = (event: Event) => {
        event.preventDefault();
        stopLoop();
        setFallback(true);
      };

      const intersectionObserver =
        typeof IntersectionObserver !== 'undefined'
          ? new IntersectionObserver(
              (entries) => {
                const entry = entries[0];
                isVisibleInViewport = Boolean(entry?.isIntersecting);
                if (isVisibleInViewport) {
                  startLoop();
                } else {
                  stopLoop();
                }
              },
              { threshold: 0.05 },
            )
          : null;

      intersectionObserver?.observe(container);
      if (interactive) {
        window.addEventListener('pointermove', handlePointerMove, { passive: true });
      }
      document.addEventListener('visibilitychange', handleVisibilityChange);
      canvas.addEventListener('webglcontextlost', handleContextLost);

      startLoop();

      return () => {
        stopLoop();
        intersectionObserver?.disconnect();
        if (interactive) {
          window.removeEventListener('pointermove', handlePointerMove);
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        canvas.removeEventListener('webglcontextlost', handleContextLost);

        geometries.forEach((g) => g.dispose());
        outerMaterial.dispose();
        coreMaterial.dispose();
        outerEdgeMaterial.dispose();
        coreEdgeMaterial.dispose();
        outerHaloMat.dispose();
        innerHaloMat.dispose();
        envTarget.dispose();
        pmremGenerator.dispose();
        renderer.dispose();
        if (canvas.parentNode === container) {
          container.removeChild(canvas);
        }
      };
    }, [interactive, size]);

    if (fallback) {
      return (
        <div
          className={cn('inline-flex items-center justify-center select-none', className)}
          style={{ width: size, height: size }}
        >
          <SpleenLogo width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} className="opacity-95" />
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        data-spleen-monolith-3d="true"
        className={cn('inline-flex items-center justify-center select-none', className)}
        style={{ width: size, height: size }}
      />
    );
  },
);

export default SpleenMonolith3DScene;
