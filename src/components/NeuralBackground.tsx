import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial, Float } from '@react-three/drei';
import * as THREE from 'three';

function ParticleField({ count = 500 }) {
  const points = useMemo(() => {
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 10;
      p[i * 3 + 1] = (Math.random() - 0.5) * 10;
      p[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    return p;
  }, [count]);

  const ref = useRef<THREE.Points>(null!);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    ref.current.rotation.y = time * 0.05;
    ref.current.rotation.x = time * 0.03;
    
    // Pulse effect
    const scale = 1 + Math.sin(time * 0.5) * 0.1;
    ref.current.scale.set(scale, scale, scale);
  });

  return (
    <Points ref={ref} positions={points} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        color="#6366f1"
        size={0.02}
        sizeAttenuation={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </Points>
  );
}

function NeuralConnection({ count = 20 }) {
  const lines = useMemo(() => {
    const l = [];
    for (let i = 0; i < count; i++) {
      const start = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      const end = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      l.push({ start, end });
    }
    return l;
  }, [count]);

  const ref = useRef<THREE.Group>(null!);

  useFrame((state) => {
    ref.current.rotation.y = state.clock.getElapsedTime() * 0.02;
  });

  return (
    <group ref={ref}>
      {lines.map((line, i) => (
        <line key={i}>
          <bufferGeometry attach="geometry">
            <float32BufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array([line.start.x, line.start.y, line.start.z, line.end.x, line.end.y, line.end.z])}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial attach="material" color="#818cf8" transparent opacity={0.1} />
        </line>
      ))}
    </group>
  );
}

const isWebGLAvailable = () => {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
};

export function NeuralBackground() {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none opacity-40 bg-gradient-to-br from-black via-primary/10 to-black" />
  );
}
