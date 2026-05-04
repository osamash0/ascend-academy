import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Float, Text, ContactShadows, Environment } from '@react-three/drei';
import * as THREE from 'three';

interface DataPoint {
  x: number;
  y: number;
  z: number;
  label: string;
  color?: string;
}

interface ThreeCanvasProps {
  data: DataPoint[];
  title?: string;
  height?: number;
}

function Points({ data }: { data: DataPoint[] }) {
  const pointsRef = useRef<THREE.Group>(null);

  const processedData = useMemo(() => {
    // Normalize data to fit in a reasonable 3D space (approx -5 to 5)
    const xVals = data.map(d => d.x);
    const yVals = data.map(d => d.y);
    const zVals = data.map(d => d.z);

    const xMin = Math.min(...xVals);
    const xMax = Math.max(...xVals);
    const yMin = Math.min(...yVals);
    const yMax = Math.max(...yVals);
    const zMin = Math.min(...zVals);
    const zMax = Math.max(...zVals);

    const rangeX = xMax - xMin || 1;
    const rangeY = yMax - yMin || 1;
    const rangeZ = zMax - zMin || 1;

    return data.map(d => ({
      ...d,
      pos: [
        ((d.x - xMin) / rangeX) * 10 - 5,
        ((d.y - yMin) / rangeY) * 10 - 5,
        ((d.z - zMin) / rangeZ) * 10 - 5,
      ] as [number, number, number],
      color: d.color || '#6366f1'
    }));
  }, [data]);

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.1;
    }
  });

  return (
    <group ref={pointsRef}>
      {processedData.map((point, i) => (
        <group key={i} position={point.pos}>
          <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
            <mesh>
              <sphereGeometry args={[0.2, 32, 32]} />
              <meshStandardMaterial 
                color={point.color} 
                emissive={point.color} 
                emissiveIntensity={2} 
                toneMapped={false} 
              />
            </mesh>
            <Text
              position={[0, 0.4, 0]}
              fontSize={0.2}
              color="white"
              anchorX="center"
              anchorY="middle"
              font="/fonts/Inter-Bold.woff" // Assuming a standard font path or fallback
            >
              {point.label}
            </Text>
          </Float>
        </group>
      ))}

      {/* Grid Helper */}
      <gridHelper args={[12, 12, 0x444444, 0x222222]} position={[0, -5.5, 0]} />
    </group>
  );
}

export default function ThreeCanvas({ data, title, height = 400 }: ThreeCanvasProps) {
  return (
    <div style={{ height, width: '100%', position: 'relative', background: '#0a0a0a', borderRadius: '24px', overflow: 'hidden' }}>
      <Canvas gl={{ antialias: true }} dpr={[1, 2]}>
        <PerspectiveCamera makeDefault position={[12, 12, 12]} fov={40} />
        <OrbitControls 
          enableDamping 
          dampingFactor={0.05} 
          rotateSpeed={0.5} 
          maxDistance={30} 
          minDistance={5} 
        />
        
        <color attach="background" args={['#0a0a0a']} />
        <fog attach="fog" args={['#0a0a0a', 10, 50]} />
        
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <spotLight position={[-10, 10, 10]} angle={0.15} penumbra={1} intensity={1} />

        <Points data={data} />
        
        <ContactShadows 
          position={[0, -5.5, 0]} 
          opacity={0.4} 
          scale={20} 
          blur={2.4} 
          far={10} 
        />
        
        <Environment preset="city" />
      </Canvas>
      
      {title && (
        <div style={{ position: 'absolute', top: '24px', left: '24px', pointerEvents: 'none' }}>
          <h4 style={{ margin: 0, fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)' }}>
            {title}
          </h4>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', fontWeight: 700, color: 'white' }}>
            Interactive 3D Engine
          </p>
        </div>
      )}
    </div>
  );
}
