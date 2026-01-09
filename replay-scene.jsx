import { jsxDEV } from "react/jsx-dev-runtime";
import React, { useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Audio, Sequence } from "remotion";
import * as THREE from "three";
import { createEarth, createAtmosphere, createSnakeHead, createFood, createBonusFood, createSegment } from "./replay-assets.js";
const ReplayScene = ({ data, isMuted }) => {
  const frameIndex = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const containerRef = useRef(null);
  const { audioCues, rippleEvents } = useMemo(() => {
    const cues = [];
    const ripples = [];
    if (!data || !data.frames) return { audioCues: cues, rippleEvents: ripples };
    data.frames.forEach((frame, idx) => {
      if (frame.events && frame.events.length > 0) {
        frame.events.forEach((evt, i) => {
          const name = typeof evt === "string" ? evt : evt.name;
          const payload = typeof evt === "string" ? null : evt.payload;
          const url = data.config.sounds && data.config.sounds[name];
          if (url) {
            const volume = payload && typeof payload.volume === "number" ? payload.volume : 1;
            cues.push({
              id: `sfx-${idx}-${i}-${name}`,
              frame: idx,
              src: url,
              name,
              volume
            });
          }
          if (name === "ripple" && payload) {
            ripples.push({
              frame: idx,
              center: new THREE.Vector3().fromArray(payload.center),
              duration: payload.duration
            });
          }
        });
      }
    });
    return { audioCues: cues, rippleEvents: ripples };
  }, [data]);
  const activeCues = audioCues.filter((cue) => {
    const duration = cue.name === "die" ? 150 : 30;
    return frameIndex >= cue.frame && frameIndex < cue.frame + duration;
  });
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const rippleUniforms = useRef({
    uTime: { value: 0 },
    uRippleCenters: { value: new Array(5).fill().map(() => new THREE.Vector3()) },
    uRippleStartTimes: { value: new Array(5).fill(-1e3) },
    uRippleIntensities: { value: new Array(5).fill(0) }
  });
  const objectsRef = useRef({
    earth: null,
    head: null,
    tongue: null,
    food: null,
    bonusFoods: [],
    segments: [],
    cameraRig: null
  });
  useEffect(() => {
    if (!data || !data.frames || data.frames.length === 0) return;
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1e3);
    cameraRef.current = camera;
    const cameraRig = new THREE.Group();
    scene.add(cameraRig);
    cameraRig.add(camera);
    camera.position.z = 25;
    camera.position.y = 10;
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setClearColor(0, 1);
    if (containerRef.current) {
      containerRef.current.appendChild(renderer.domElement);
    }
    rendererRef.current = renderer;
    const ambientLight = new THREE.AmbientLight(16777215, 0.5);
    scene.add(ambientLight);
    const hemiLight = new THREE.HemisphereLight(16777215, 4473924, 1);
    scene.add(hemiLight);
    const r = data.config.earthRadius;
    const earth = createEarth(r, rippleUniforms);
    scene.add(earth);
    const atmosphere = createAtmosphere(r);
    scene.add(atmosphere);
    const { head, tongue } = createSnakeHead();
    scene.add(head);
    const food = createFood();
    scene.add(food);
    objectsRef.current = {
      earth,
      head,
      tongue,
      food,
      bonusFoods: [],
      segments: [],
      cameraRig
    };
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      sceneRef.current = null;
    };
  }, [width, height, data]);
  useLayoutEffect(() => {
    if (!sceneRef.current || !rendererRef.current || !data.frames) return;
    const safeIndex = Math.min(Math.floor(frameIndex), data.frames.length - 1);
    if (safeIndex < 0) return;
    const frameData = data.frames[safeIndex];
    const objs = objectsRef.current;
    const currentTime = safeIndex / fps;
    rippleUniforms.current.uTime.value = currentTime;
    for (let i = 0; i < 5; i++) rippleUniforms.current.uRippleStartTimes.value[i] = -1e3;
    const slotsFilled = [false, false, false, false, false];
    let filledCount = 0;
    for (let i = rippleEvents.length - 1; i >= 0; i--) {
      const rip = rippleEvents[i];
      if (rip.frame > safeIndex) continue;
      const slot = i % 5;
      if (!slotsFilled[slot]) {
        const ripTime = rip.frame / fps;
        rippleUniforms.current.uRippleCenters.value[slot].copy(rip.center);
        rippleUniforms.current.uRippleStartTimes.value[slot] = ripTime;
        let intensity = 0.15;
        if (rip.duration > 200) {
          const factor = Math.min((rip.duration - 200) / 400, 1);
          intensity = 0.15 + factor * 0.3;
        }
        rippleUniforms.current.uRippleIntensities.value[slot] = intensity;
        slotsFilled[slot] = true;
        filledCount++;
      }
      if (filledCount === 5) break;
    }
    if (!objs.head || !objs.food) return;
    objs.head.position.fromArray(frameData.head.pos);
    objs.head.quaternion.fromArray(frameData.head.quat);
    if (objs.tongue && frameData.tongue) {
      objs.tongue.scale.set(frameData.tongue.scaleX, 1, frameData.tongue.scaleZ);
    }
    objs.food.position.fromArray(frameData.food);
    const bonusData = frameData.bonusFoods || [];
    while (objs.bonusFoods.length < bonusData.length) {
      const mesh = createBonusFood();
      sceneRef.current.add(mesh);
      objs.bonusFoods.push(mesh);
    }
    while (objs.bonusFoods.length > bonusData.length) {
      const mesh = objs.bonusFoods.pop();
      if (mesh) {
        sceneRef.current.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      }
    }
    bonusData.forEach((pos, i) => {
      if (objs.bonusFoods[i]) {
        objs.bonusFoods[i].position.fromArray(pos);
      }
    });
    while (objs.segments.length < frameData.segments.length) {
      const colorHex = frameData.segments[objs.segments.length].color;
      const segment = createSegment(colorHex);
      sceneRef.current.add(segment);
      objs.segments.push(segment);
    }
    while (objs.segments.length > frameData.segments.length) {
      const segment = objs.segments.pop();
      if (segment && sceneRef.current) {
        sceneRef.current.remove(segment);
        if (segment.geometry) segment.geometry.dispose();
        if (segment.material) segment.material.dispose();
      }
    }
    frameData.segments.forEach((segData, i) => {
      if (objs.segments[i]) {
        objs.segments[i].position.fromArray(segData.pos);
        objs.segments[i].quaternion.fromArray(segData.quat);
        if (segData.color !== void 0) {
          objs.segments[i].material.color.setHex(segData.color);
        }
      }
    });
    if (frameData.camera && cameraRef.current) {
      cameraRef.current.position.fromArray(frameData.camera.pos);
      cameraRef.current.quaternion.fromArray(frameData.camera.quat);
      cameraRef.current.up.fromArray(frameData.camera.up);
    }
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [frameIndex, data, fps]);
  const currentFrameData = data.frames[Math.min(Math.floor(frameIndex), data.frames.length - 1)] || {};
  const score = currentFrameData.score || 0;
  const playerInfo = data.config.playerInfo || { username: "Player", avatarUrl: "./default_avatar.png" };
  return /* @__PURE__ */ jsxDEV(AbsoluteFill, { children: [
    /* @__PURE__ */ jsxDEV("div", { ref: containerRef, style: { width: "100%", height: "100%" } }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 282,
      columnNumber: 13
    }),
    /* @__PURE__ */ jsxDEV("div", { style: {
      position: "absolute",
      top: "20px",
      left: "20px",
      display: "flex",
      alignItems: "flex-start",
      gap: "15px",
      pointerEvents: "none",
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    }, children: [
      /* @__PURE__ */ jsxDEV("div", { style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "5px"
      }, children: [
        /* @__PURE__ */ jsxDEV(
          "img",
          {
            src: playerInfo.avatarUrl || "./default_avatar.png",
            onError: (e) => {
              e.target.onerror = null;
              e.target.src = "./default_avatar.png";
            },
            style: {
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              border: "3px solid white",
              backgroundColor: "#333",
              objectFit: "cover",
              boxShadow: "0 4px 6px rgba(0,0,0,0.3)"
            }
          },
          void 0,
          false,
          {
            fileName: "<stdin>",
            lineNumber: 301,
            columnNumber: 21
          }
        ),
        /* @__PURE__ */ jsxDEV("div", { style: {
          color: "white",
          fontSize: "14px",
          fontWeight: "600",
          textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
          background: "rgba(0,0,0,0.5)",
          padding: "2px 6px",
          borderRadius: "4px",
          maxWidth: "100px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }, children: playerInfo.username }, void 0, false, {
          fileName: "<stdin>",
          lineNumber: 317,
          columnNumber: 21
        })
      ] }, void 0, true, {
        fileName: "<stdin>",
        lineNumber: 295,
        columnNumber: 17
      }),
      /* @__PURE__ */ jsxDEV("div", { style: {
        fontSize: "48px",
        color: "white",
        fontWeight: "bold",
        textShadow: "2px 2px 4px rgba(0,0,0,0.5)",
        alignSelf: "flex-start",
        marginTop: "10px"
      }, children: score }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 333,
        columnNumber: 17
      })
    ] }, void 0, true, {
      fileName: "<stdin>",
      lineNumber: 285,
      columnNumber: 13
    }),
    activeCues.map((cue) => {
      const duration = cue.name === "die" ? 150 : 30;
      const finalVolume = isMuted ? 0 : 0.5 * (cue.volume ?? 1);
      return /* @__PURE__ */ jsxDEV(Sequence, { from: cue.frame, durationInFrames: duration, children: /* @__PURE__ */ jsxDEV(Audio, { src: cue.src, volume: finalVolume }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 351,
        columnNumber: 25
      }) }, cue.id, false, {
        fileName: "<stdin>",
        lineNumber: 350,
        columnNumber: 21
      });
    })
  ] }, void 0, true, {
    fileName: "<stdin>",
    lineNumber: 281,
    columnNumber: 9
  });
};
export {
  ReplayScene
};
