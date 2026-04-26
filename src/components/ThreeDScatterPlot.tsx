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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const normalizedData = useMemo(() => {
    if (data.length === 0) return [];
    const maxDuration = Math.max(...data.map(d => d.avgDuration), 1);
    const maxConfusion = Math.max(...data.map(d => d.confusionIndex), 1);

    return data.map(d => ({
      ...d,
      x: (d.avgDuration / maxDuration) * 6 - 3,
      y: (d.correctRate / 100) * 6 - 3,
      z: (d.confusionIndex / maxConfusion) * 6 - 3,
    }));
  }, [data]);

  return (
    <div className="w-full h-full relative cursor-grab active:cursor-grabbing">
      <Canvas>
        <PerspectiveCamera makeDefault position={[5, 5, 8]} />
        <OrbitControls enableZoom={true} enablePan={false} maxDistance={15} minDistance={3} />
        
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <spotLight position={[-10, 10, 10]} angle={0.15} penumbra={1} intensity={1} />

        <group>
          {/* Grid Helper */}
          <gridHelper args={[10, 10, 0xffffff, 0x333333]} position={[0, -3, 0]} rotation={[0, 0, 0]} transparent opacity={0.1} />
          
          {/* Axes */}
          <Axis start={[-3, -3, -3]} end={[4, -3, -3]} label="Duration →" />
          <Axis start={[-3, -3, -3]} end={[-3, 4, -3]} label="Accuracy ↑" />
          <Axis start={[-3, -3, -3]} end={[-3, -3, 4]} label="Confusion ↗" />

          {normalizedData.map((d) => (
            <Sphere 
              key={d.id} 
              position={[d.x, d.y, d.z]} 
              data={d} 
              isSelected={selectedId === d.id}
              onClick={() => setSelectedId(d.id === selectedId ? null : d.id)}
            />
          ))}
        </group>

        <ContactShadows position={[0, -3.5, 0]} opacity={0.4} scale={20} blur={2} far={4.5} />
      </Canvas>
      
      <div className="absolute top-4 left-4 pointer-events-none">
        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Orbital Spatial Matrix</p>
        <p className="text-[9px] text-muted-foreground uppercase tracking-widest mt-1">Drag to rotate • Scroll to zoom</p>
      </div>
    </div>
  );
}
