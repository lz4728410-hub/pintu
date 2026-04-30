import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const ParticleTransition = ({ imageUrl, active, onComplete }: { imageUrl: string, active: boolean, onComplete?: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || !imageUrl) return;

    let isMounted = true;
    const container = containerRef.current;
    
    // Setup Three.js scene
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10000);
    // Move camera further back to see the particles clearly
    camera.position.z = 800;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const geometry = new THREE.BufferGeometry();
    let mesh: THREE.Points | null = null;
    let material: THREE.ShaderMaterial | null = null;

    // Load Image and parse data
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      if (!isMounted) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Use a fixed size for sampling, e.g., 512x512 to preserve detail but control performance
      const sSize = 512;
      canvas.width = sSize;
      canvas.height = sSize;
      
      // Draw image to cover
      const scale = Math.max(sSize / img.width, sSize / img.height);
      const x = (sSize / 2) - (img.width / 2) * scale;
      const y = (sSize / 2) - (img.height / 2) * scale;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

      const imgData = ctx.getImageData(0, 0, sSize, sSize).data;

      // Sampling logic
      const targetParticles = 130000;
      const positions: number[] = [];
      const colors: number[] = [];
      const randoms: number[] = []; // for noise offset

      const center = sSize / 2;
      const maxDist = Math.sqrt(center * center + center * center);

      let attempts = 0;
      const maxAttempts = 1000000;

      while (positions.length / 3 < targetParticles && attempts < maxAttempts) {
        attempts++;
        const rx = Math.random() * sSize;
        const ry = Math.random() * sSize;
        
        // Rejection sampling for vignette: likelihood decreases with distance
        const dx = rx - center;
        const dy = ry - center;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const prob = Math.pow(1.0 - (dist / maxDist), 1.5); // increased exponent for stronger vignette
        
        if (Math.random() > prob) continue;

        // Passed rejection, get pixel data
        const px = Math.floor(rx);
        const py = Math.floor(ry);
        const idx = (py * sSize + px) * 4;
        
        const r = imgData[idx] / 255;
        const g = imgData[idx + 1] / 255;
        const b = imgData[idx + 2] / 255;
        
        // Brightness for depth mapping (Z-axis)
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        
        // Map grid coordinates to 3D space. 
        // Image Y goes down, 3D Y goes up.
        // Scale appropriately: let"s map 512 to maybe ~600 units wide
        const scale3D = 600 / sSize;
        const pX = (rx - center) * scale3D;
        const pY = -(ry - center) * scale3D;
        // Brighter pixels are closer (higher Z), darker are further (lower Z)
        const pZ = (brightness - 0.5) * 200;

        positions.push(pX, pY, pZ);
        colors.push(r, g, b);
        randoms.push(Math.random());
      }

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('aRandom', new THREE.Float32BufferAttribute(randoms, 1));

      // Shaders
      const vertexShader = `
        uniform float uTime;
        uniform float uProgress;
        
        attribute float aRandom;
        varying vec3 vColor;
        varying float vAlpha;

        // Simple noise function helper
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }
        // Classic Perlin noise, periodic version
        float pnoise(vec3 P, vec3 rep) {
            vec3 Pi0 = mod(floor(P), rep); // Integer part, modulo period
            vec3 Pi1 = mod(Pi0 + vec3(1.0), rep); // Integer part + 1, mod period
            Pi0 = mod289(Pi0);
            Pi1 = mod289(Pi1);
            vec3 Pf0 = fract(P); // Fractional part for interpolation
            vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
            vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
            vec4 iy = vec4(Pi0.yy, Pi1.yy);
            vec4 iz0 = Pi0.zzzz;
            vec4 iz1 = Pi1.zzzz;
            vec4 ixy = permute(permute(ix) + iy);
            vec4 ixy0 = permute(ixy + iz0);
            vec4 ixy1 = permute(ixy + iz1);
            vec4 gx0 = ixy0 * (1.0 / 7.0);
            vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
            gx0 = fract(gx0);
            vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
            vec4 sz0 = step(gz0, vec4(0.0));
            gx0 -= sz0 * (step(0.0, gx0) - 0.5);
            gy0 -= sz0 * (step(0.0, gy0) - 0.5);
            vec4 gx1 = ixy1 * (1.0 / 7.0);
            vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
            gx1 = fract(gx1);
            vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
            vec4 sz1 = step(gz1, vec4(0.0));
            gx1 -= sz1 * (step(0.0, gx1) - 0.5);
            gy1 -= sz1 * (step(0.0, gy1) - 0.5);
            vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
            vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
            vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
            vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
            vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
            vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
            vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
            vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
            vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
            g000 *= norm0.x;
            g010 *= norm0.y;
            g100 *= norm0.z;
            g110 *= norm0.w;
            vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
            g001 *= norm1.x;
            g011 *= norm1.y;
            g101 *= norm1.z;
            g111 *= norm1.w;
            float n000 = dot(g000, Pf0);
            float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
            float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
            float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
            float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
            float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
            float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
            float n111 = dot(g111, Pf1);
            vec3 fade_xyz = fade(Pf0);
            vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
            vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
            float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
            return 2.2 * n_xyz;
        }

        vec3 curlNoise(vec3 p) {
          float e = 0.1;
          vec3 dx = vec3(e, 0.0, 0.0);
          vec3 dy = vec3(0.0, e, 0.0);
          vec3 dz = vec3(0.0, 0.0, e);
          
          vec3 rep = vec3(100.0);
          vec3 p_x0 = vec3(pnoise(p - dx, rep), pnoise(p - dx + vec3(12.4), rep), pnoise(p - dx + vec3(34.2), rep));
          vec3 p_x1 = vec3(pnoise(p + dx, rep), pnoise(p + dx + vec3(12.4), rep), pnoise(p + dx + vec3(34.2), rep));
          vec3 p_y0 = vec3(pnoise(p - dy, rep), pnoise(p - dy + vec3(12.4), rep), pnoise(p - dy + vec3(34.2), rep));
          vec3 p_y1 = vec3(pnoise(p + dy, rep), pnoise(p + dy + vec3(12.4), rep), pnoise(p + dy + vec3(34.2), rep));
          vec3 p_z0 = vec3(pnoise(p - dz, rep), pnoise(p - dz + vec3(12.4), rep), pnoise(p - dz + vec3(34.2), rep));
          vec3 p_z1 = vec3(pnoise(p + dz, rep), pnoise(p + dz + vec3(12.4), rep), pnoise(p + dz + vec3(34.2), rep));
          
          float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
          float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
          float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;
          
          return normalize(vec3(x,y,z) / (2.0 * e));
        }

        void main() {
          vColor = color;
          
          // Breathing effect via curl noise
          vec3 noisePos = position * 0.005;
          vec3 curl = curlNoise(noisePos + uTime * 0.2);
          
          // Base position
          vec3 pos = position;
          
          // Explosion / transition out logic using uProgress
          // If uProgress > 0, explode outward based on noise and depth
          float explodeAmt = pow(uProgress, 2.0) * 800.0;
          vec3 expandDir = normalize(position + curl * 50.0);
          pos += expandDir * explodeAmt * aRandom;
          
          // Normal breathing
          pos += curl * min(30.0, uProgress > 0.0 ? 0.0 : 30.0); // Stop breathing if exploding
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          
          // Point size based on depth
          gl_PointSize = (4.0 + aRandom * 3.0) * (500.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          
          // Fade alpha based on progress
          vAlpha = 1.0 - uProgress;
        }
      `;

      const fragmentShader = `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          // Create soft circle
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          
          float strength = 1.0 - (dist * 2.0);
          
          // Dynamic brightness based on base color brightness
          float brightness = dot(vColor, vec3(0.299, 0.587, 0.114));
          vec3 finalColor = mix(vColor, vColor * 1.5, brightness);
          
          gl_FragColor = vec4(finalColor, strength * vAlpha);
        }
      `;

      material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 } // 0 = stable, 1 = exploded
        },
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });

      mesh = new THREE.Points(geometry, material);
      scene.add(mesh);
    };
    img.src = imageUrl;

    let time = 0;
    let localProgress = 0;
    const startTime = Date.now();

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      time += 0.01;
      
      if (material) {
        material.uniforms.uTime.value = time;
        
        // Update transition logic
        const elapsed = Date.now() - startTime;
        
        if (elapsed > 3000 || !active) {
          // After 3 seconds, or if hand opened early, scatter automatically
          localProgress += 0.02; // Transition speed
          if (localProgress >= 1.0 && onComplete) {
            onComplete();
            localProgress = 1.0; 
          }
        }
        material.uniforms.uProgress.value = localProgress;
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      isMounted = false;
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (rendererRef.current && container.contains(rendererRef.current.domElement)) {
        container.removeChild(rendererRef.current.domElement);
      }
      geometry.dispose();
      material?.dispose();
    };
  }, [imageUrl, active, onComplete]);

  return (
    <div 
      ref={containerRef} 
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100vw] h-[100vh] pointer-events-none z-50 overflow-hidden flex items-center justify-center"
    />
  );
};

export default ParticleTransition;
