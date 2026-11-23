import React from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { TeamDagTask, TeamMember } from './api';

export interface TeamConstellation3DProps {
  teamName: string;
  teamStatus: string;
  members: TeamMember[];
  tasks: TeamDagTask[];
  onSelectMember?: (member: TeamMember) => void;
  height?: number;
}

const isMemberActive = (member: TeamMember, tasks: TeamDagTask[]): boolean => {
  if (member.status === 'working' || member.status === 'running' || member.status === 'active') return true;
  return tasks.some((task) => task.assignee === member.id && task.status === 'running');
};

const FallbackConstellation2D: React.FC<TeamConstellation3DProps> = ({
  members,
  tasks,
  onSelectMember,
  height = 220,
}) => {
  const leadIndex = Math.max(0, members.findIndex((m) => m.role === 'lead'));
  const lead = members[leadIndex] ?? null;
  const workers = members.filter((_, idx) => idx !== leadIndex);
  const cx = 180;
  const cy = 96;
  const rx = 122;
  const ry = 56;

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-border/70 bg-[#08090A]"
      style={{ height }}
    >
      <svg viewBox="0 0 360 192" className="h-full w-full">
        <defs>
          <radialGradient id="spleen-constellation-bg" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#171B1D" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#08090A" stopOpacity="1" />
          </radialGradient>
        </defs>
        <rect width="360" height="192" fill="url(#spleen-constellation-bg)" />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#282D30" strokeDasharray="3 4" strokeWidth="1" />
        {workers.map((worker, idx) => {
          const angle = (idx / Math.max(1, workers.length)) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * rx;
          const y = cy + Math.sin(angle) * ry;
          const active = isMemberActive(worker, tasks);
          return (
            <g key={worker.id} className="cursor-pointer" onClick={() => onSelectMember?.(worker)}>
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke={active ? '#C8FA62' : '#282D30'}
                strokeOpacity={active ? 0.65 : 0.8}
                strokeWidth={active ? 1.5 : 1}
              />
              <circle
                cx={x}
                cy={y}
                r={12}
                fill="#111416"
                stroke={active ? '#C8FA62' : '#434A4E'}
                strokeWidth={active ? 1.6 : 1.2}
              />
              <text
                x={x}
                y={y + 22}
                textAnchor="middle"
                fill="#E5E8E3"
                fontSize="8.5"
                fontFamily="monospace"
              >
                {worker.name.slice(0, 14)}
              </text>
            </g>
          );
        })}
        {lead ? (
          <g className="cursor-pointer" onClick={() => onSelectMember?.(lead)}>
            <polygon
              points={`${cx},${cy - 18} ${cx + 16},${cy} ${cx},${cy + 18} ${cx - 16},${cy}`}
              fill="#171B1D"
              stroke="#C8FA62"
              strokeWidth="1.5"
            />
            <text
              x={cx}
              y={cy + 30}
              textAnchor="middle"
              fill="#F1F2EF"
              fontSize="9"
              fontWeight="600"
              fontFamily="monospace"
            >
              {lead.name}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
};

export const TeamConstellation3DScene: React.FC<TeamConstellation3DProps> = React.memo(
  ({ teamName, teamStatus, members, tasks, onSelectMember, height = 224 }) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const [fallback, setFallback] = React.useState(false);

    const activeCount = React.useMemo(
      () => members.filter((m) => isMemberActive(m, tasks)).length,
      [members, tasks],
    );

    const memberSignature = React.useMemo(
      () => members.map((m) => `${m.id}:${m.role}:${isMemberActive(m, tasks) ? '1' : '0'}`).join('|'),
      [members, tasks],
    );

    const edgeSignature = React.useMemo(
      () => tasks.map((t) => `${t.id}:${t.assignee || ''}:${t.status}:${t.dependsOn.join(',')}`).join('|'),
      [tasks],
    );

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

      const width = Math.max(container.clientWidth || 320, 220);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;

      const canvas = renderer.domElement;
      canvas.style.width = '100%';
      canvas.style.height = `${height}px`;
      canvas.style.display = 'block';
      canvas.setAttribute('aria-hidden', 'true');
      container.innerHTML = '';
      container.appendChild(canvas);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x08090a, 0.085);

      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 40);
      camera.position.set(0, 2.35, 6.2);
      camera.lookAt(0, 0.05, 0);

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const roomEnv = new RoomEnvironment();
      const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
      scene.environment = envTarget.texture;
      roomEnv.dispose();

      const keyLight = new THREE.DirectionalLight(0xf1f2ef, 2.2);
      keyLight.position.set(3.5, 5.5, 4.2);
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0x959d9c, 1.0);
      fillLight.position.set(-4.0, 1.5, 3.0);
      scene.add(fillLight);

      const limeRim = new THREE.PointLight(0xc8fa62, 1.2, 12);
      limeRim.position.set(0, 1.6, 0);
      scene.add(limeRim);

      const root = new THREE.Group();
      scene.add(root);

      const geometries: THREE.BufferGeometry[] = [];
      const materials: THREE.Material[] = [];

      // Subtle architectural coordinate plane under constellation
      const grid = new THREE.GridHelper(12, 16, 0x262c30, 0x15191c);
      grid.position.y = -1.25;
      root.add(grid);

      // Orbital reference ring
      const orbitRingGeo = new THREE.RingGeometry(2.14, 2.17, 72);
      geometries.push(orbitRingGeo);
      const orbitRingMat = new THREE.MeshBasicMaterial({
        color: 0x282d30,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72,
      });
      materials.push(orbitRingMat);
      const orbitRing = new THREE.Mesh(orbitRingGeo, orbitRingMat);
      orbitRing.rotation.x = Math.PI / 2;
      orbitRing.position.y = -0.15;
      root.add(orbitRing);

      // Inner halo ring around Lead
      const haloGeo = new THREE.TorusGeometry(0.86, 0.012, 12, 64);
      geometries.push(haloGeo);
      const haloMat = new THREE.MeshBasicMaterial({
        color: teamStatus === 'active' ? 0xc8fa62 : 0x5c6468,
        transparent: true,
        opacity: teamStatus === 'active' ? 0.55 : 0.25,
      });
      materials.push(haloMat);
      const leadHalo = new THREE.Mesh(haloGeo, haloMat);
      leadHalo.rotation.x = Math.PI / 2.25;
      leadHalo.position.y = 0.35;
      root.add(leadHalo);

      const leadMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#C5CECB'),
        metalness: 0.92,
        roughness: 0.18,
        envMapIntensity: 1.65,
      });
      const workerIdleMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#272D31'),
        metalness: 0.86,
        roughness: 0.28,
        envMapIntensity: 1.35,
      });
      const workerActiveMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#2F3A26'),
        emissive: new THREE.Color('#C8FA62'),
        emissiveIntensity: 0.38,
        metalness: 0.78,
        roughness: 0.22,
        envMapIntensity: 1.5,
      });
      const wireIdleMat = new THREE.LineBasicMaterial({ color: 0x959d9c, transparent: true, opacity: 0.35 });
      const wireActiveMat = new THREE.LineBasicMaterial({ color: 0xc8fa62, transparent: true, opacity: 0.8 });
      const beamIdleMat = new THREE.LineBasicMaterial({ color: 0x2f363a, transparent: true, opacity: 0.65 });
      const beamActiveMat = new THREE.LineBasicMaterial({ color: 0xc8fa62, transparent: true, opacity: 0.72 });
      const pulseMat = new THREE.MeshBasicMaterial({ color: 0xc8fa62 });
      materials.push(leadMat, workerIdleMat, workerActiveMat, wireIdleMat, wireActiveMat, beamIdleMat, beamActiveMat, pulseMat);

      const leadGeo = new THREE.OctahedronGeometry(0.46, 0);
      const leadEdgeGeo = new THREE.EdgesGeometry(leadGeo);
      const workerGeo = new THREE.IcosahedronGeometry(0.28, 0);
      const workerEdgeGeo = new THREE.EdgesGeometry(workerGeo);
      const pulseGeo = new THREE.SphereGeometry(0.052, 10, 10);
      geometries.push(leadGeo, leadEdgeGeo, workerGeo, workerEdgeGeo, pulseGeo);

      const leadIndex = Math.max(0, members.findIndex((m) => m.role === 'lead'));
      const leadMember = members[leadIndex] ?? null;
      const workerMembers = members.filter((_, idx) => idx !== leadIndex);

      const positionByMemberId = new Map<string, THREE.Vector3>();
      const animatedNodes: Array<{ mesh: THREE.Object3D; baseY: number; phase: number; speed: number }> = [];
      const pulseTracks: Array<{ mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; speed: number; offset: number }> = [];

      const leadPos = new THREE.Vector3(0, 0.38, 0);
      if (leadMember) {
        positionByMemberId.set(leadMember.id, leadPos);
        const leadMesh = new THREE.Mesh(leadGeo, leadMat);
        leadMesh.position.copy(leadPos);
        leadMesh.add(new THREE.LineSegments(leadEdgeGeo, isMemberActive(leadMember, tasks) ? wireActiveMat : wireIdleMat));
        root.add(leadMesh);
        animatedNodes.push({ mesh: leadMesh, baseY: leadPos.y, phase: 0, speed: 0.9 });
      }

      workerMembers.forEach((member, idx) => {
        const angle = (idx / Math.max(1, workerMembers.length)) * Math.PI * 2;
        const radius = 2.15;
        const pos = new THREE.Vector3(
          Math.cos(angle) * radius,
          -0.12 + Math.sin(angle * 2) * 0.14,
          Math.sin(angle) * radius,
        );
        positionByMemberId.set(member.id, pos);
        const active = isMemberActive(member, tasks);

        const mesh = new THREE.Mesh(workerGeo, active ? workerActiveMat : workerIdleMat);
        mesh.position.copy(pos);
        mesh.add(new THREE.LineSegments(workerEdgeGeo, active ? wireActiveMat : wireIdleMat));
        root.add(mesh);
        animatedNodes.push({ mesh, baseY: pos.y, phase: idx * 1.15, speed: 1.15 });

        // Link from Lead to worker
        const lineGeo = new THREE.BufferGeometry().setFromPoints([leadPos, pos]);
        geometries.push(lineGeo);
        root.add(new THREE.Line(lineGeo, active ? beamActiveMat : beamIdleMat));

        if (active) {
          const pulse = new THREE.Mesh(pulseGeo, pulseMat);
          root.add(pulse);
          pulseTracks.push({ mesh: pulse, from: leadPos, to: pos, speed: 0.72, offset: idx * 0.27 });
        }
      });

      // DAG inter-agent dependency edges
      const taskById = new Map(tasks.map((t) => [t.id, t]));
      for (const task of tasks) {
        const toPos = task.assignee ? positionByMemberId.get(task.assignee) : null;
        if (!toPos) continue;
        for (const depId of task.dependsOn) {
          const depTask = taskById.get(depId);
          const fromPos = depTask?.assignee ? positionByMemberId.get(depTask.assignee) : null;
          if (!fromPos || fromPos.equals(toPos)) continue;
          const mid = fromPos.clone().lerp(toPos, 0.5);
          mid.y += 0.42;
          const curve = new THREE.QuadraticBezierCurve3(fromPos, mid, toPos);
          const pts = curve.getPoints(18);
          const depGeo = new THREE.BufferGeometry().setFromPoints(pts);
          geometries.push(depGeo);
          root.add(new THREE.Line(depGeo, task.status === 'running' ? beamActiveMat : beamIdleMat));
        }
      }

      // Subtle atmospheric depth dust
      const dustCount = 48;
      const dustPositions = new Float32Array(dustCount * 3);
      for (let i = 0; i < dustCount; i += 1) {
        dustPositions[i * 3] = (Math.random() - 0.5) * 9;
        dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 3.8;
        dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 7;
      }
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
      geometries.push(dustGeo);
      const dustMat = new THREE.PointsMaterial({
        color: 0x959d9c,
        size: 0.038,
        transparent: true,
        opacity: 0.38,
      });
      materials.push(dustMat);
      root.add(new THREE.Points(dustGeo, dustMat));

      let targetYaw = 0;
      let targetPitch = 0;
      let currentYaw = 0;
      let currentPitch = 0;
      let rafId: number | null = null;
      let isVisibleInViewport = true;
      let isDocumentVisible = !document.hidden;
      const startTime = performance.now();

      const renderFrame = (now: number) => {
        rafId = null;
        if (!isVisibleInViewport || !isDocumentVisible) return;
        const t = (now - startTime) * 0.001;
        currentYaw += (targetYaw - currentYaw) * 0.06;
        currentPitch += (targetPitch - currentPitch) * 0.06;

        root.rotation.y = t * 0.14 + currentYaw * 0.55;
        root.rotation.x = currentPitch * 0.22;
        leadHalo.rotation.z = t * 0.42;

        for (const node of animatedNodes) {
          node.mesh.rotation.y = t * 0.55 + node.phase;
          node.mesh.rotation.x = Math.sin(t * 0.4 + node.phase) * 0.2;
          node.mesh.position.y = node.baseY + Math.sin(t * node.speed + node.phase) * 0.055;
        }

        for (const pulse of pulseTracks) {
          const progress = (t * pulse.speed + pulse.offset) % 1;
          pulse.mesh.position.lerpVectors(pulse.from, pulse.to, progress);
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

      const handlePointerMove = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        targetYaw = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        targetPitch = ((e.clientY - rect.top) / rect.height - 0.5) * 1.4;
      };
      const handlePointerLeave = () => {
        targetYaw = 0;
        targetPitch = 0;
      };

      const handleResize = () => {
        const nextWidth = Math.max(container.clientWidth || 320, 220);
        camera.aspect = nextWidth / height;
        camera.updateProjectionMatrix();
        renderer.setSize(nextWidth, height);
      };

      const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
      resizeObserver?.observe(container);

      const intersectionObserver = typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              const visible = entries.some((entry) => entry.isIntersecting);
              isVisibleInViewport = visible;
              if (visible) startLoop();
              else stopLoop();
            },
            { threshold: 0.05 },
          )
        : null;
      intersectionObserver?.observe(container);

      const handleVisibilityChange = () => {
        isDocumentVisible = !document.hidden;
        if (isDocumentVisible) startLoop();
        else stopLoop();
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      const handleContextLost = (e: Event) => {
        e.preventDefault();
        stopLoop();
        setFallback(true);
      };
      canvas.addEventListener('webglcontextlost', handleContextLost);
      container.addEventListener('pointermove', handlePointerMove);
      container.addEventListener('pointerleave', handlePointerLeave);

      startLoop();

      return () => {
        stopLoop();
        resizeObserver?.disconnect();
        intersectionObserver?.disconnect();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        canvas.removeEventListener('webglcontextlost', handleContextLost);
        container.removeEventListener('pointermove', handlePointerMove);
        container.removeEventListener('pointerleave', handlePointerLeave);
        geometries.forEach((g) => g.dispose());
        materials.forEach((m) => m.dispose());
        if (Array.isArray(grid.material)) grid.material.forEach((m) => m.dispose());
        else grid.material.dispose();
        grid.geometry.dispose();
        envTarget.dispose();
        pmremGenerator.dispose();
        renderer.dispose();
        if (canvas.parentNode === container) container.removeChild(canvas);
      };
    }, [memberSignature, edgeSignature, teamStatus, height]);

    if (fallback) {
      return (
        <FallbackConstellation2D
          teamName={teamName}
          teamStatus={teamStatus}
          members={members}
          tasks={tasks}
          onSelectMember={onSelectMember}
          height={height}
        />
      );
    }

    return (
      <div className="relative w-full overflow-hidden rounded-lg border border-border/70 bg-[#08090A]">
        <div ref={containerRef} className="w-full" style={{ height }} />
        {/* Top-left subtle HUD telemetry */}
        <div className="pointer-events-none absolute top-2.5 left-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-[#0B0D0F]/85 px-2 py-0.5 font-mono text-[10px] tracking-wide text-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${activeCount > 0 || teamStatus === 'active' ? 'bg-[#C8FA62]' : 'bg-muted-foreground'}`}
            />
            {teamName}
          </span>
          <span className="rounded border border-border/60 bg-[#0B0D0F]/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {members.length} nodes · {activeCount} active
          </span>
        </div>
        {/* Bottom interactive node bar */}
        <div className="absolute right-2 bottom-2 left-2 flex flex-wrap items-center gap-1">
          {members.map((member) => {
            const active = isMemberActive(member, tasks);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => onSelectMember?.(member)}
                title={member.sessionId ? `Open ${member.name}'s session` : member.name}
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] transition ${
                  active
                    ? 'border-[#C8FA62]/50 bg-[#111416]/90 text-foreground hover:border-[#C8FA62]'
                    : 'border-border/70 bg-[#0B0D0F]/85 text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[#C8FA62]' : 'bg-muted-foreground/50'}`} />
                <span>{member.name}</span>
                <span className="opacity-60">/{member.role}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  },
);

export default TeamConstellation3DScene;
