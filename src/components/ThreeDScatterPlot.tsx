import { useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Float, PerspectiveCamera, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

interface DataPoint {
  id: string;
  name: string;
  avgDuration: number;
  correctRate: number;
  confusionIndex: number;
}

function Sphere({ position, data, isSelected, onClick }: { position: [number, number, number], data: DataPoint, isSelected: boolean, onClick: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHover] = useState(false);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(time + position[0]) * 0.1;
      if (hovered || isSelected) {
        meshRef.current.scale.setScalar(THREE.MathUtils.lerp(meshRef.current.scale.x, 1.5, 0.1));
      } else {
        meshRef.current.scale.setScalar(THREE.MathUtils.lerp(meshRef.current.scale.x, 1, 0.1));
      }
    }
  });

  const color = data.confusionIndex > 50 ? '#ef4444' : '#6366f1';

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
        onClick={onClick}
      >
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial 
          color={color} 
          emissive={color} 
          emissiveIntensity={hovered || isSelected ? 2 : 0.5} 
          transparent 
          opacity={0.8}
        />
      </mesh>
      {(hovered || isSelected) && (
        <Text
          position={[0, 0.6, 0]}
          fontSize={0.2}
          color="white"
          anchorX="center"
          anchorY="middle"
        >
          {data.name}\n{data.correctRate}%
        </Text>
      )}
    </group>
  );
}

function Axis({ start, end, label }: { start: [number, number, number], end: [number, number, number], label: string }) {
  return (
    <group>
      <line>
        <bufferGeometry attach="geometry">
          <float32BufferAttribute attach="attributes-position" count={2} array={new Float32Array([...start, ...end])} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial attach="material" color="#ffffff" transparent opacity={0.2} />
      </line>
      <Text
        position={end}
        fontSize={0.2}
        color="white"
        opacity={0.4}
        transparent
      >
        {label}
      </Text>
    </group>
  );
}

export function ThreeDScatterPlot({ data }: { data: DataPoint[] }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center glass-panel-strong border-white/5 rounded-3xl p-10 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Activity className="w-8 h-8 text-primary" />
      </div>
      <h4 className="text-lg font-black text-foreground uppercase tracking-wider mb-2">Neural Matrix Active</h4>
      <p className="text-xs text-muted-foreground max-w-xs uppercase tracking-widest leading-loose">
        Data points for {data.length} slides processed. 3D Spatial rendering is currently in maintenance mode.
      </p>
    </div>
  );
}
