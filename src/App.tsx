import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { Camera, CheckCircle2, Hand, XCircle, Cpu, ShieldCheck, Zap } from "lucide-react";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import ParticleTransition from "./ParticleTransition";

// --- Types & Constants ---
type Point = { x: number; y: number };
type Piece = { 
  id: string; 
  x: number; 
  y: number; 
  type?: "emoji" | "image";
  emoji?: string; 
  color: string;
  imageUrl?: string;
  bgPos?: string;
  gridSize?: number;
  targetCol?: number;
  targetRow?: number;
};

const PINCH_THRESHOLD_PX = 40; // Distance between thumb and index to trigger pinch
const GRAB_RADIUS_PX = 150; // How close hand needs to be to grab a piece
const FIST_COOLDOWN_MS = 1000; // Cooldown after a fist gesture triggers an action

const TaotieIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 200 120" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M100 23 L110 38 L100 48 L90 38 Z" />
    
    <path d="M25 20 V 43 C40 43 50 33 60 33 L70 33 C75 33 80 38 85 43 C75 43 70 38 65 38 H55 C45 38 35 48 20 46 V 20 Z" />
    <path transform="scale(-1,1) translate(-200,0)" d="M25 20 V 43 C40 43 50 33 60 33 L70 33 C75 33 80 38 85 43 C75 43 70 38 65 38 H55 C45 38 35 48 20 46 V 20 Z" />

    <path d="M50 23 H 70 C75 23 80 28 85 33 C80 33 75 28 70 28 H 50 V 23 Z" />
    <path transform="scale(-1,1) translate(-200,0)" d="M50 23 H 70 C75 23 80 28 85 33 C80 33 75 28 70 28 H 50 V 23 Z" />

    <path d="M50 48 V 63 C50 68 60 68 70 68 C80 68 85 63 85 63 V 48 H 50 Z M 60 53 H 75 V 58 H 60 V 53 Z" />
    <path transform="scale(-1,1) translate(-200,0)" d="M50 48 V 63 C50 68 60 68 70 68 C80 68 85 63 85 63 V 48 H 50 Z M 60 53 H 75 V 58 H 60 V 53 Z" />

    <path d="M95 53 C90 53 90 58 95 58 C100 58 100 63 95 63 C90 63 90 68 95 68" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
    <path d="M105 53 C110 53 110 58 105 58 C100 58 100 63 105 63 C110 63 110 68 105 68" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
    
    <path d="M95 68 C90 68 90 73 95 73" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
    <path d="M105 68 C110 68 110 73 105 73" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>

    <path d="M15 46 C25 46 25 56 35 56 V 73 H 25 V 63 C 15 63 15 53 15 46 Z" />
    <path transform="scale(-1,1) translate(-200,0)" d="M15 46 C25 46 25 56 35 56 V 73 H 25 V 63 C 15 63 15 53 15 46 Z" />

    <path d="M75 73 C 65 73 60 83 70 93 C 75 98 85 98 85 93 C 85 88 80 88 80 93 C 75 96 65 96 62 88 C 60 78 70 78 75 78 Z" />
    <path transform="scale(-1,1) translate(-200,0)" d="M75 73 C 65 73 60 83 70 93 C 75 98 85 98 85 93 C 85 88 80 88 80 93 C 75 96 65 96 62 88 C 60 78 70 78 75 78 Z" />

    <path d="M85 93 C 95 103 105 103 115 93 C 110 88 105 88 105 93 C 100 98 95 93 95 93 C 95 88 90 88 85 93 Z" />

    <path d="M60 88 C 50 98 40 88 35 88 C 40 98 50 108 60 108 C 70 108 75 98 75 98 C 70 103 65 103 60 88 Z" />
    <path transform="scale(-1,1) translate(-200,0)" d="M60 88 C 50 98 40 88 35 88 C 40 98 50 108 60 108 C 70 108 75 98 75 98 C 70 103 65 103 60 88 Z" />

    <path d="M35 73 C 45 73 55 83 55 93 C 55 103 45 103 45 93 C 45 88 50 88 50 93 C 50 98 40 98 40 93 C 40 83 30 83 25 83 C 30 83 35 78 35 73 Z" />
    <path transform="scale(-1,1) translate(-200,0)" d="M35 73 C 45 73 55 83 55 93 C 55 103 45 103 45 93 C 45 88 50 88 50 93 C 50 98 40 98 40 93 C 40 83 30 83 25 83 C 30 83 35 78 35 73 Z" />
  </svg>
)

const createImageSet = (url: string, size: number): Omit<Piece, 'x' | 'y'>[] => {
  const pieces: Omit<Piece, 'x' | 'y'>[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      pieces.push({
        id: `img-${row}-${col}`,
        type: "image",
        imageUrl: url,
        bgPos: `${(col / (size - 1)) * 100}% ${(row / (size - 1)) * 100}%`,
        gridSize: size,
        color: "bg-slate-800 border-sky-500/50 shadow-[0_0_20px_rgba(56,189,248,0.2)] ring-sky-500/20",
        targetCol: col,
        targetRow: row,
      });
    }
  }
  return pieces;
};

const DEFAULT_IMAGES = [
  "/1.png",
  "/2.png",
  "/3.png",
  "/4.png",
  "/5.png",
  "/6.png"
];

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const boardRef = useRef<HTMLElement>(null);
  
  // State 
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isLoadingCamera, setIsLoadingCamera] = useState(false);
  const [modelLoadingState, setModelLoadingState] = useState<"loading" | "ready" | "error">("loading");
  
  const [currentGesture, setCurrentGesture] = useState<"IDLE" | "PINCHING" | "FIST">("IDLE");
  const [transitionState, setTransitionState] = useState<"IDLE" | "FIST_HOLD" | "TRANSITIONING">("IDLE");
  const transitionStateRef = useRef<"IDLE" | "FIST_HOLD" | "TRANSITIONING">("IDLE");
  
  // App Logic State
  const activePuzzleSets = useMemo(() => [
    ...DEFAULT_IMAGES.map(url => createImageSet(url, 3))
  ], []);

  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [pieces, setPieces] = useState<Piece[]>([]);
  
  // Using refs for animation loop variables to avoid React re-renders breaking the 60FPS loop
  const piecesRef = useRef<Piece[]>([]);
  const draggedPieceIdRef = useRef<string | null>(null);
  const gestureStateRef = useRef<"IDLE" | "PINCHING" | "FIST">("IDLE");
  const lastFistTimeRef = useRef<number>(0);

  // Initialize pieces when set changes
  useEffect(() => {
    const defaultPositions = activePuzzleSets[currentSetIndex].map((p, i, arr) => {
      // Scatter the 9 pieces randomly, or just space them if it's the 3 piece set
      const isGrid = arr.length > 3;
      const xOffset = isGrid ? (Math.random() - 0.5) * 600 : (i - 1) * 120;
      const yOffset = isGrid ? (Math.random() - 0.5) * 400 : 0;
      
      return {
        ...p,
        x: window.innerWidth / 2 + xOffset,
        y: window.innerHeight / 2 + yOffset,
      };
    });
    setPieces(defaultPositions as Piece[]);
    piecesRef.current = defaultPositions as Piece[];
  }, [currentSetIndex, activePuzzleSets]);

  // Request Camera
  const requestCamera = async () => {
    setIsLoadingCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }});
      streamRef.current = stream;
      setHasPermission(true);
    } catch (err) {
      console.error("Camera permission denied", err);
      setHasPermission(false);
    } finally {
      setIsLoadingCamera(false);
    }
  };

  // Attach stream once permission is granted
  useEffect(() => {
    if (hasPermission && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [hasPermission]);

  // Setup MediaPipe Hand Landmarker
  useEffect(() => {
    if (!hasPermission || !videoRef.current || !canvasRef.current) return;

    let handLandmarker: HandLandmarker | null = null;
    let animationFrameId: number;

    const setupModel = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1, // Only track one hand for simplicity
        });
        setModelLoadingState("ready");
        startDetection();
      } catch (e) {
        console.error("Failed to load MediaPipe model:", e);
        setModelLoadingState("error");
      }
    };

    const startDetection = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!video || !canvas || !ctx || !handLandmarker) return;

      let lastVideoTime = -1;

      const detectFrame = async () => {
        // Match canvas size to window/video
        if (canvas.width !== window.innerWidth) canvas.width = window.innerWidth;
        if (canvas.height !== window.innerHeight) canvas.height = window.innerHeight;

        const startTimeMs = performance.now();
        if (video.currentTime !== lastVideoTime && video.videoWidth > 0 && video.videoHeight > 0) {
          lastVideoTime = video.currentTime;
          
          // Execute detection
          const results = handLandmarker.detectForVideo(video, startTimeMs);
          
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0]; // First hand

            // Draw Wireframe (Debugging UI)
            drawHandWireframe(ctx, landmarks, canvas.width, canvas.height);

            // Calculate Gesture Logic
            processGestures(landmarks, canvas.width, canvas.height, startTimeMs);
          } else {
            // Hand lost, reset gesture
            updateGesture("IDLE");
            if (draggedPieceIdRef.current) dropPiece();
          }
        }
        animationFrameId = requestAnimationFrame(detectFrame);
      };
      
      detectFrame();
    };

    setupModel();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (handLandmarker) handLandmarker.close();
    };
  }, [hasPermission]);

  // --- Hand Interaction Logic ---
  const processGestures = (landmarks: any[], screenW: number, screenH: number, timeMs: number) => {
    // 1. Get pixel coordinates of key points
    // Note: camera feeds are mirrored naturally. MediaPipe gives normal coordinates where x=0 is left.
    // If you mirror the video in CSS, you must mirror the X coordinate here so physical movement matches screen.
    // For this app, we will mirror X (1 - x).
    const getScreenCoord = (lm: {x: number, y: number}): Point => ({ 
      x: (1 - lm.x) * screenW, 
      y: lm.y * screenH 
    });

    const thumbTip = getScreenCoord(landmarks[4]);
    const indexTip = getScreenCoord(landmarks[8]);
    
    // Additional points for fist calculation
    // Wrist is 0. Base of fingers are 5, 9, 13, 17. Tips are 8, 12, 16, 20.
    const wristInfo = getScreenCoord(landmarks[0]);
    
    // Calculates distance between two points
    const dist = (p1: Point, p2: Point) => Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2);
    
    // --- 1. Pinch Detection (捏合 = 抓取可移动) ---
    const pinchDist = dist(thumbTip, indexTip);
    const isCurrentlyPinching = pinchDist < PINCH_THRESHOLD_PX;
    const handCenterPoint: Point = {
      x: (thumbTip.x + indexTip.x) / 2,
      y: (thumbTip.y + indexTip.y) / 2
    };

    // --- 2. Fist Detection (握拳 = 切换拼图) ---
    // A heuristic for a fist: The fingertips are closer to the wrist than the base joints of the fingers.
    // Or simpler: Finger tips are "below" the PIP joints.
    let isCurrentlyFist = true;
    const fingerPairs = [
      [8, 5],   // Index tip vs MCP
      [12, 9],  // Middle tip vs MCP
      [16, 13], // Ring tip vs MCP
      [20, 17]  // Pinky tip vs MCP
    ];
    for (const [tipIdx, baseIdx] of fingerPairs) {
      const tip = getScreenCoord(landmarks[tipIdx]);
      const base = getScreenCoord(landmarks[baseIdx]);
      // If the tip is further from the wrist than the base, finger is extended.
      // So if dist(wrist, tip) > dist(wrist, base), it's NOT a fist.
      if (dist(wristInfo, tip) > dist(wristInfo, base)) {
         isCurrentlyFist = false;
         break;
      }
    }

    // Determine current priority state
    let newGesture: "IDLE" | "PINCHING" | "FIST" = "IDLE";
    if (isCurrentlyFist) newGesture = "FIST";
    else if (isCurrentlyPinching) newGesture = "PINCHING";

    // Detect State Changes
    const prevState = gestureStateRef.current;
    const prevTransition = transitionStateRef.current;
    
    if (newGesture === "FIST" && prevState !== "FIST") {
       // Transitioned to Fist
       if (prevTransition === "IDLE") {
         updateTransitionState("FIST_HOLD");
         if (draggedPieceIdRef.current) dropPiece();
       }
    }
    
    if (newGesture === "PINCHING" && prevTransition === "IDLE") {
      // While pinching
      if (prevState !== "PINCHING") {
        // Newly pinched
        attemptGrabPiece(handCenterPoint);
      } else if (draggedPieceIdRef.current) {
        // Holding something, move it
        moveGrabbedPiece(handCenterPoint);
      }
    } else {
      // Released pinch
      if (draggedPieceIdRef.current) {
        dropPiece();
      }
    }

    updateGesture(newGesture);
  };

  // State Update Helpers
  const updateGesture = (g: "IDLE" | "PINCHING" | "FIST") => {
    if (gestureStateRef.current !== g) {
      gestureStateRef.current = g;
      setCurrentGesture(g); // Triggers UI render
    }
  };

  const updateTransitionState = (s: "IDLE" | "FIST_HOLD" | "TRANSITIONING") => {
    if (transitionStateRef.current !== s) {
      transitionStateRef.current = s;
      setTransitionState(s);
    }
  };

  const attemptGrabPiece = (cursor: Point) => {
    let closestPieceId: string | null = null;
    let minDistance = GRAB_RADIUS_PX;

    // Find closest piece within grab radius
    for (const piece of piecesRef.current) {
      // Calculate distance to the center of the piece (assuming dimensions ~ 64x64)
      const distToPieceCenters = Math.sqrt((cursor.x - piece.x) ** 2 + (cursor.y - piece.y) ** 2);
      if (distToPieceCenters < minDistance) {
        minDistance = distToPieceCenters;
        closestPieceId = piece.id;
      }
    }

    if (closestPieceId) {
      draggedPieceIdRef.current = closestPieceId;
      // Bring to front
      const pieceIdx = piecesRef.current.findIndex(p => p.id === closestPieceId);
      if (pieceIdx > -1) {
        const piece = piecesRef.current[pieceIdx];
        piecesRef.current.splice(pieceIdx, 1);
        piecesRef.current.push(piece);
        setPieces([...piecesRef.current]);
      }
    }
  };

  const moveGrabbedPiece = (cursor: Point) => {
    const id = draggedPieceIdRef.current;
    if (!id) return;

    // Update the ref for fast loops
    piecesRef.current = piecesRef.current.map(p => 
      p.id === id ? { ...p, x: cursor.x, y: cursor.y } : p
    );
    
    // Update react state so DOM reflects it (done fast)
    setPieces(piecesRef.current);
  };

  const dropPiece = () => {
    const id = draggedPieceIdRef.current;
    draggedPieceIdRef.current = null;
    if (!id) return;
    
    // Snap to grid logic (centered on page)
    const piece = piecesRef.current.find(p => p.id === id);
    
    if (piece) {
      const CELL_SIZE = 128;
      const GRID_SIZE = CELL_SIZE * 3; // 384
      
      const gridLeft = window.innerWidth / 2 - GRID_SIZE / 2;
      const gridTop = window.innerHeight / 2 - GRID_SIZE / 2;
      
      const relativeX = piece.x - gridLeft;
      const relativeY = piece.y - gridTop;
      
      // Calculate nearest col and row
      let nearestCol = Math.floor(relativeX / CELL_SIZE);
      let nearestRow = Math.floor(relativeY / CELL_SIZE);
      
      // Check if dropped reasonably near the 9-grid (allow a larger drop area to be forgiving)
      const inGridBounds = 
        nearestCol >= -1 && nearestCol <= 3 && 
        nearestRow >= -1 && nearestRow <= 3;

      if (inGridBounds) {
        // Clamp to 0-2 for actual slot snapping (9 grid locked positions)
        nearestCol = Math.max(0, Math.min(2, nearestCol));
        nearestRow = Math.max(0, Math.min(2, nearestRow));

        const snapX = gridLeft + nearestCol * CELL_SIZE + CELL_SIZE / 2;
        const snapY = gridTop + nearestRow * CELL_SIZE + CELL_SIZE / 2;
        
        piecesRef.current = piecesRef.current.map(p => 
          p.id === id ? { ...p, x: snapX, y: snapY } : p
        );
        setPieces([...piecesRef.current]);
      }
    }
  };

  const activePuzzleSetsLengthRef = useRef(activePuzzleSets.length);
  useEffect(() => {
    activePuzzleSetsLengthRef.current = activePuzzleSets.length;
  }, [activePuzzleSets]);

  const handleFistTrigger = () => {
    // Switch to next puzzle set immediately on fist
    setCurrentSetIndex(prevIndex => (prevIndex + 1) % activePuzzleSetsLengthRef.current);
    // Make sure we drop anything we were holding
    dropPiece();
  };

  // --- Render Functions ---
  const drawHandWireframe = (ctx: CanvasRenderingContext2D, landmarks: any[], w: number, h: number) => {
    // Draw connecting lines
    ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
    ctx.lineWidth = 2;
    // Just a simple path between all points to show connections, not anatomically perfect but looks cool
    ctx.beginPath();
    ctx.moveTo((1 - landmarks[0].x) * w, landmarks[0].y * h);
    landmarks.forEach((lm: any) => {
      ctx.lineTo((1 - lm.x) * w, lm.y * h);
    });
    ctx.stroke();

    // Draw joints
    ctx.fillStyle = "#38bdf8"; // sky-400
    landmarks.forEach((lm: any) => {
      ctx.beginPath();
      ctx.arc((1 - lm.x) * w, lm.y * h, 3, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  // --- UI Screens ---
  if (hasPermission === null) {
    return (
      <div className="flex w-full h-screen items-center justify-center bg-black text-slate-100 font-sans relative overflow-hidden select-none">
        {/* Animated Cyber Background */}
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px]"></div>
          <motion.div 
            initial={{ y: "-100%" }}
            animate={{ y: "100%" }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-sky-500/50 to-transparent shadow-[0_0_15px_rgba(56,189,248,0.5)] z-10"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black pointer-events-none"></div>
        </div>

        {/* Floating Particles or Shapes */}
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ 
              opacity: [0.1, 0.3, 0.1], 
              scale: [1, 1.2, 1],
              x: [0, (i % 2 === 0 ? 50 : -50), 0],
              y: [0, (i < 3 ? 30 : -30), 0]
            }}
            transition={{ duration: 5 + i, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-64 h-64 border border-sky-500/10 rounded-full"
            style={{ 
              left: `${15 + i * 12}%`, 
              top: `${20 + (i % 3) * 20}%`,
              filter: 'blur(40px)'
            }}
          />
        ))}

        <div className="relative z-10 w-full max-w-2xl px-6 flex flex-col items-center">
          {/* Logo/Icon Container */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="mb-12 flex justify-center w-full"
          >
            <TaotieIcon className="w-32 h-auto text-[#8305ff] drop-shadow-[0_0_15px_rgba(131,5,255,0.4)]" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 1 }}
            className="text-center space-y-6"
          >
            <div className="flex flex-col items-center">
              <motion.h1 
                className="text-7xl font-bold tracking-[0.15em] text-[#8305ff] leading-tight mb-2"
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                纹镜 幻象
              </motion.h1>
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ delay: 0.8, duration: 1, ease: "easeInOut" }}
                className="h-px bg-gradient-to-r from-transparent via-[#8305ff] to-transparent mb-4"
              />
              <span className="text-sm text-[#8305ff] tracking-[0.4em] uppercase font-mono opacity-80">
                Bronze Pattern Visual Reimagining
              </span>
            </div>

            <p className="text-[#8305ff] max-w-sm mx-auto text-sm leading-relaxed font-light mb-12">
               穿越时空的数字窥镜。利用先进的 AI 视觉技术，探索古代青铜纹样的几何奥秘与动态之美。
            </p>

            <div className="grid grid-cols-3 gap-4 mb-12 w-full max-w-md mx-auto">
               {[
                 { icon: <Cpu className="w-4 h-4" />, label: "手势交互" },
                 { icon: <Zap className="w-4 h-4" />, label: "实时追踪" },
                 { icon: <ShieldCheck className="w-4 h-4" />, label: "隐私安全" }
               ].map((item, i) => (
                 <motion.div 
                   key={i}
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   transition={{ delay: 1.2 + i * 0.1 }}
                   className="flex flex-col items-center gap-2 p-3 rounded-xl bg-slate-900/50 border border-white/5 backdrop-blur-sm"
                 >
                   <div className="text-[#8305ff]">{item.icon}</div>
                   <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{item.label}</span>
                 </motion.div>
               ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.5, duration: 0.8 }}
            >
              <button 
                onClick={requestCamera} 
                disabled={isLoadingCamera}
                className="group relative px-12 py-5 overflow-hidden rounded-full bg-transparent border border-[#8305ff]/40 text-white font-bold tracking-widest transition-all hover:border-[#8305ff] disabled:opacity-50"
              >
                {/* Button Shine/Scan effect */}
                <motion.div 
                  initial={{ x: "-100%" }}
                  whileHover={{ x: "100%" }}
                  transition={{ duration: 0.6, ease: "easeInOut" }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12"
                />
                <div className="absolute inset-0 bg-[#8305ff]/10 group-hover:bg-[#8305ff]/20 transition-colors"></div>
                
                <span className="relative z-10 flex items-center gap-3">
                  {isLoadingCamera ? (
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-4 h-4 border-2 border-[#8305ff] border-t-transparent rounded-full"
                    />
                  ) : <Zap className="w-4 h-4 text-[#8305ff] fill-[#8305ff]" />}
                  {isLoadingCamera ? "INITIALIZING SYSTEM..." : "ACCESS INTERFACE"}
                </span>
                
                {/* Corner Accents */}
                <span className="absolute top-0 left-4 w-2 h-0.5 bg-[#8305ff] group-hover:w-8 transition-all"></span>
                <span className="absolute bottom-0 right-4 w-2 h-0.5 bg-[#8305ff] group-hover:w-8 transition-all"></span>
              </button>
              
              <div className="mt-4 text-[10px] font-mono text-slate-600 uppercase tracking-tighter">
                Secure encryption enabled // Camera access required for AI tracking
              </div>
            </motion.div>
          </motion.div>
        </div>

        {/* Footer info in cover */}
        <div className="absolute bottom-10 inset-x-10 flex justify-between items-end opacity-30">
          <div className="space-y-1">
             <div className="text-[10px] font-mono tracking-widest uppercase">Process ID: BRONZE_MIRROR_RECON</div>
             <div className="text-[10px] font-mono tracking-widest uppercase">Build: v2.4.0.ALPHA</div>
          </div>
          <div className="w-32 h-1 bg-slate-900 rounded-full overflow-hidden">
             <motion.div 
               animate={{ x: ["-100%", "100%"] }}
               transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
               className="w-1/2 h-full bg-sky-500"
             />
          </div>
        </div>
      </div>
    );
  }

  if (hasPermission === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-slate-100 font-sans">
        <div className="text-center p-8 text-rose-500 bg-slate-900 border border-slate-800 rounded-2xl">
           <XCircle className="w-12 h-12 mx-auto mb-4" />
           <p>摄像头访问被拒绝。请在浏览器中允许权限以使用此应用。</p>
        </div>
      </div>
    );
  }

  // Main UI
  return (
    <div className="relative w-full h-screen overflow-hidden bg-black text-slate-100 font-sans flex flex-col select-none">
      
      {/* Video element for MediaPipe feed and background view */}
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className="absolute inset-0 w-full h-full object-cover opacity-10 -scale-x-100 mix-blend-screen z-0 bg-black pointer-events-none"
      ></video>

      {/* Canvas for Hand Overlay (Drawing) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      ></canvas>

      <header className="h-24 border-none flex items-center justify-between px-8 !bg-black backdrop-blur-md shrink-0 z-20 relative">
        <div className="flex items-center gap-4">
          <div className="flex flex-col gap-0.5">
            <h1 className="tracking-[0.1em] text-[#8305ff] bg-black drop-shadow-md font-bold text-left" style={{ fontFamily: 'Arial', fontStyle: 'normal', textDecorationLine: 'none', fontSize: '55px', lineHeight: '59px', borderStyle: 'none', height: '49px' }}>
              纹镜 幻象
            </h1>
            <div className="flex flex-col justify-center border-t border-slate-700 mt-1 pt-1">
               <span className="text-[12px] text-[#9931ff] tracking-[0.2em] text-left font-medium">青铜纹样视觉重构与动态设计</span>
               <span className="text-[9px] text-[#9839ff] tracking-widest uppercase text-center mt-0.5 opacity-90">Bronze Pattern Visual Reconstruction And Dynamic Design</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            {modelLoadingState === 'loading' ? (
              <>
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div>
                <span className="text-xs font-mono text-amber-400 uppercase tracking-widest">AI 初始化中...</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-[#ffe400] animate-pulse shadow-[0_0_8px_rgba(255,228,0,0.8)]"></div>
                <span className="text-[17px] leading-[24px] font-mono text-[#9429ff] uppercase tracking-widest">摄像头已启动</span>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex gap-6 p-6 z-20 pointer-events-none relative">
        {/* Side Control Panel */}
        <aside className="w-80 flex flex-col gap-6 pointer-events-auto h-full">
          <div className="!bg-black backdrop-blur-md border border-slate-800 rounded-xl p-5 overflow-y-auto shadow-2xl flex flex-col gap-6 w-[200px] h-[690px]">
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase mb-4 tracking-widest">交互状态 & 手势说明</h2>
              
              <div className="bg-black/60 rounded-lg border border-slate-700/50 p-4 relative overflow-hidden flex flex-col items-center justify-center gap-3 h-28 shadow-inner mb-5">
                <div className="absolute inset-0 opacity-30 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:12px_12px] !bg-black"></div>
                
                <span className="text-4xl relative z-10 drop-shadow-md">
                  {currentGesture === "IDLE" && "🖐️"}
                  {currentGesture === "PINCHING" && "🤌"}
                  {currentGesture === "FIST" && "✊"}
                </span>
                
                <span className={`text-[11px] font-mono tracking-widest relative z-10 px-2 py-1 rounded border ${currentGesture === 'IDLE' ? 'text-slate-400 border-slate-700 bg-slate-900/50' : currentGesture === 'PINCHING' ? 'text-sky-400 border-sky-500/50 bg-sky-500/10 font-bold' : 'text-emerald-400 border-emerald-500/50 bg-emerald-500/10 font-bold'}`}>
                  {currentGesture === "IDLE" && "张开手掌"}
                  {currentGesture === "PINCHING" && "检测到捏合"}
                  {currentGesture === "FIST" && "检测到握拳"}
                </span>
              </div>

              <div className="space-y-3">
                <div className={`flex items-center gap-4 p-3 rounded-lg border transition-all duration-300 !bg-black ${currentGesture === 'PINCHING' ? 'border-sky-500/40 shadow-[0_0_15px_rgba(56,189,248,0.1)]' : 'border-slate-800'}`}>
                  <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${currentGesture === 'PINCHING' ? 'border-sky-500 text-sky-400' : 'border-slate-700 text-slate-300'}`}>
                    <span className="text-lg">🤌</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-200 uppercase">捏合</p>
                    <p className="text-xs text-slate-400">抓取并移动贴图</p>
                  </div>
                </div>
                <div className={`flex items-center gap-4 p-3 rounded-lg border transition-all duration-300 !bg-black ${currentGesture === 'FIST' ? 'border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'border-slate-800'}`}>
                  <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${currentGesture === 'FIST' ? 'border-emerald-500 text-emerald-400' : 'border-slate-700 text-slate-300'}`}>
                    <span className="text-lg">✊</span>
                  </div>
                  <div className="w-full">
                    <p className="text-sm font-bold text-slate-300 uppercase mb-1">握拳</p>
                    <p className="text-xs text-slate-500">握拳以切换拼图</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-5 border-t border-slate-800 space-y-4">
              {activePuzzleSets[currentSetIndex] && activePuzzleSets[currentSetIndex][0]?.imageUrl && (
                <div className="rounded-lg overflow-hidden border border-slate-700 bg-slate-950 relative group">
                  <img src={activePuzzleSets[currentSetIndex][0].imageUrl} alt="Reference" className="w-[157px] h-[157px] object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                  <div className="absolute inset-x-0 bottom-0 bg-slate-900/90 backdrop-blur-sm border-t border-slate-700 px-3 py-2 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-400">参考原图</span>
                  </div>
                </div>
              )}
              
              <p className="text-[11px] leading-relaxed text-slate-500 italic mt-2">
                请确保手部在画面内清晰可见。交互操作将直接映射到屏幕空间。握拳以切换拼图内容。
              </p>
            </div>
          </div>
        </aside>

        {/* Puzzle Board Area (Full screen overlay basically) */}
        <section ref={boardRef} className="absolute inset-0 pointer-events-none flex items-center justify-center">
           {/* Decorative Grid Background to hint at a board */}
           <div className="absolute inset-0 flex items-center justify-center opacity-30">
              <div className="w-[800px] h-[600px] bg-[radial-gradient(#334155_2px,transparent_2px)] [background-size:40px_40px] mask-image-[radial-gradient(ellipse_at_center,black_40%,transparent_70%)]"></div>
           </div>
        </section>
      </main>

      {/* Draggable Puzzle Pieces */}
      <AnimatePresence>
        {transitionState === 'IDLE' && pieces.map((piece) => (
          <motion.div
            key={piece.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.2, filter: 'blur(10px)' }}
            transition={{ duration: 0.5 }}
            className={`absolute flex items-center justify-center w-32 h-32 text-6xl rounded-none border bg-slate-900/80 backdrop-blur-md shadow-xl transition-colors z-30 pointer-events-auto select-none overflow-hidden
              ${draggedPieceIdRef.current === piece.id ? 'shadow-[0_0_30px_rgba(56,189,248,0.3)] ring-4 ring-sky-500/30 z-40' : 'hover:scale-105 duration-300'}
              ${piece.color}
            `}
            style={{
              left: piece.x,
              top: piece.y,
              transform: `translate(-50%, -50%) ${draggedPieceIdRef.current === piece.id ? 'rotate-3deg scale(1.1)' : ''}`,
            }}
          >
            {piece.type === 'image' && piece.imageUrl ? (
              <div 
                 className="w-full h-full pointer-events-none"
                 style={{
                   backgroundImage: `url(${piece.imageUrl})`,
                   backgroundSize: `${piece.gridSize ? piece.gridSize * 100 : 300}%`,
                   backgroundPosition: piece.bgPos,
                 }}
              />
            ) : (
              piece.emoji
            )}
            {draggedPieceIdRef.current === piece.id && (
               <div className="absolute -top-3 -right-3 px-2 py-1 bg-sky-500 rounded text-white text-[10px] font-bold tracking-wider shadow-md border border-sky-400 z-50">已抓取</div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Particle Effect Overlay */}
      {transitionState === 'FIST_HOLD' && (
         <ParticleTransition 
            imageUrl={activePuzzleSets[Math.min(currentSetIndex, activePuzzleSets.length - 1)][0]?.imageUrl || DEFAULT_IMAGES[0]}
            active={currentGesture === "FIST"}
            onComplete={() => {
              handleFistTrigger();
              updateTransitionState("IDLE");
            }}
         />
      )}

      {/* Center Reticle UI guide when empty */}
      {pieces.length === 0 && modelLoadingState === "ready" && (
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-500 text-center pointer-events-none z-20">
            <Hand className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm font-mono tracking-widest uppercase">握拳以生成拼图贴图</p>
         </div>
      )}

      {/* Footer info */}
      <footer className="h-10 border-t border-slate-800 px-8 flex items-center justify-between text-[10px] font-mono text-slate-500 shrink-0 bg-slate-950/80 backdrop-blur-md z-20 relative">
        <div className="flex gap-4">
          <span>引擎: MediaPipe WebAssembly</span>
          <span>模型: 手部关键点检测 v1</span>
        </div>
        <div className="flex gap-4">
          <span className="text-[12px] leading-[19px] text-[#ffdf05]">● 追踪中</span>
        </div>
      </footer>
    </div>
  );
}
