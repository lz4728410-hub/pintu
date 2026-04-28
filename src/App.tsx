import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { Camera, CheckCircle2, Hand, XCircle } from "lucide-react";
import React, { useEffect, useRef, useState, useMemo } from "react";

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
const GRAB_RADIUS_PX = 60; // How close hand needs to be to grab a piece
const FIST_COOLDOWN_MS = 1000; // Cooldown after a fist gesture triggers an action

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
    
    if (newGesture === "FIST" && prevState !== "FIST") {
       // Transitioned to Fist
       if (timeMs - lastFistTimeRef.current > FIST_COOLDOWN_MS) {
         lastFistTimeRef.current = timeMs;
         handleFistTrigger();
       }
    }
    
    if (newGesture === "PINCHING") {
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
      // Bring to front logic could go here by reordering array
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
    
    // Snap to grid logic
    const piece = piecesRef.current.find(p => p.id === id);
    const gridEl = document.getElementById('puzzle-board-grid');
    
    if (piece && piece.targetCol !== undefined && piece.targetRow !== undefined && gridEl) {
      const gridRect = gridEl.getBoundingClientRect();
      const PIECE_SIZE = 128; // 32 Tailwind units
      
      const targetX = gridRect.left + piece.targetCol * PIECE_SIZE + PIECE_SIZE / 2;
      const targetY = gridRect.top + piece.targetRow * PIECE_SIZE + PIECE_SIZE / 2;
      
      const snapDistance = 80; // Distance tolerance for snapping
      const dist = Math.sqrt((piece.x - targetX) ** 2 + (piece.y - targetY) ** 2);
      
      if (dist < snapDistance) {
        piecesRef.current = piecesRef.current.map(p => 
          p.id === id ? { ...p, x: targetX, y: targetY } : p
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
      <div className="flex w-full h-screen items-center justify-center bg-black text-slate-100 font-sans relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px]"></div>
        
        <div className="max-w-md p-8 bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl relative z-10">
           <div className="bg-sky-500/20 p-4 rounded-full w-fit mx-auto mb-6 border border-sky-500/30">
              <Camera className="w-10 h-10 text-sky-400" />
           </div>
           <h1 className="text-2xl font-bold tracking-tight text-center mb-4">手势<span className="text-sky-400">互动拼图</span> v2.0</h1>
           <p className="text-slate-400 mb-8 text-center text-sm leading-relaxed">
             此应用使用您的设备摄像头来追踪手势，并且不会发送任何视频数据。
           </p>
           <div className="bg-slate-950/50 p-4 rounded-xl text-left border border-slate-800 mb-8 space-y-3 shadow-inner">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-2">手势指南</h3>
              <div className="flex items-center gap-3">
                <span className="text-lg">🤌</span> 
                <p className="text-sm"><span className="font-bold text-sky-400">捏合:</span> 抓取并移动</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg">✊</span> 
                <p className="text-sm"><span className="font-bold text-slate-300">握拳:</span> 切换拼图</p>
              </div>
           </div>
           <button 
             onClick={requestCamera} 
             disabled={isLoadingCamera}
             className="w-full py-4 px-6 bg-sky-500 text-white rounded-lg font-bold tracking-wide shadow-[0_0_20px_rgba(56,189,248,0.3)] hover:bg-sky-400 hover:shadow-[0_0_25px_rgba(56,189,248,0.5)] transition-all text-sm disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
           >
              {isLoadingCamera ? "正在初始化摄像头..." : "开启摄像头以开始"}
           </button>
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
        className="absolute inset-0 w-[1280px] h-full object-cover opacity-10 -scale-x-100 mix-blend-screen z-0 bg-black text-black border border-black"
      ></video>

      {/* Canvas for Hand Overlay (Drawing) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      ></canvas>

      <header className="h-24 border-b border-slate-800 flex items-center justify-between px-8 !bg-black backdrop-blur-md shrink-0 z-20 relative">
        <div className="flex items-center gap-4">
          <div className="flex flex-col gap-0.5">
            <h1 className="tracking-[0.1em] text-[#FFFF00] drop-shadow-md font-bold text-left" style={{ fontFamily: 'Arial', fontStyle: 'normal', textDecorationLine: 'none', fontSize: '55px', lineHeight: '59px', borderStyle: 'none', height: '49px' }}>
              纹镜 幻象
            </h1>
            <div className="flex flex-col justify-center border-t border-slate-700 mt-1 pt-1">
               <span className="text-[12px] text-[#FFFF00] tracking-[0.2em] text-left font-medium">青铜纹样视觉重构与动态设计</span>
               <span className="text-[9px] text-[#FFFF00] tracking-widest uppercase text-center mt-0.5 opacity-90">Bronze Pattern Visual Reconstruction And Dynamic Design</span>
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
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                <span className="text-xs font-mono text-emerald-400 uppercase tracking-widest">摄像头已启动</span>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex gap-6 p-6 z-20 pointer-events-none relative">
        {/* Side Control Panel */}
        <aside className="w-80 flex flex-col gap-6 pointer-events-auto h-full">
          <div className="!bg-black backdrop-blur-md border border-slate-800 rounded-xl p-5 overflow-y-auto shadow-2xl flex flex-col gap-6 w-[200px] h-[600px]">
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
           
           {/* 3x3 Snap Target Grid */}
           <div id="puzzle-board-grid" className="relative w-[384px] h-[384px] grid grid-cols-3 grid-rows-3 border-2 border-slate-700/60 rounded-xl overflow-hidden shadow-2xl bg-slate-900/40 backdrop-blur-sm z-10 box-content">
             {[0,1,2,3,4,5,6,7,8].map(i => (
               <div key={i} className="border border-slate-700/40 transition-colors"></div>
             ))}
           </div>
        </section>
      </main>

      {/* Draggable Puzzle Pieces */}
      {pieces.map((piece) => (
        <div
          key={piece.id}
          className={`absolute flex items-center justify-center w-32 h-32 text-6xl rounded-none border bg-slate-900/80 backdrop-blur-md shadow-xl transition-all z-30 pointer-events-auto select-none overflow-hidden
            ${draggedPieceIdRef.current === piece.id ? 'scale-110 shadow-[0_0_30px_rgba(56,189,248,0.3)] ring-4 ring-sky-500/30 z-40' : 'scale-100 hover:scale-105 duration-300'}
            ${piece.color}
          `}
          style={{
            left: piece.x,
            top: piece.y,
            transform: `translate(-50%, -50%) ${draggedPieceIdRef.current === piece.id ? 'rotate-3deg' : ''}`,
            transitionProperty: draggedPieceIdRef.current === piece.id ? 'box-shadow' : 'all',
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
        </div>
      ))}

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
          <span className="text-sky-500">● 追踪中</span>
        </div>
      </footer>
    </div>
  );
}
