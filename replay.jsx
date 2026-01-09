import { jsxDEV } from "react/jsx-dev-runtime";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@websim/remotion/player";
import { ReplayScene } from "./replay-scene.jsx";
const ReplayContainer = ({ data }) => {
  const [isMuted, setIsMuted] = useState(() => data.config?.muted || false);
  const duration = data.frames.length;
  const fps = data.config.fps || 30;
  return /* @__PURE__ */ jsxDEV("div", { style: { width: "100%", height: "100%", position: "relative", background: "#000" }, children: [
    /* @__PURE__ */ jsxDEV(
      Player,
      {
        component: ReplayScene,
        inputProps: { data, isMuted },
        durationInFrames: duration,
        fps,
        compositionWidth: window.innerWidth,
        compositionHeight: window.innerHeight,
        style: { width: "100%", height: "100%" },
        controls: true,
        loop: true,
        autoPlay: true,
        numberOfSharedAudioTags: 20,
        showRenderButton: false
      },
      void 0,
      false,
      {
        fileName: "<stdin>",
        lineNumber: 16,
        columnNumber: 13
      }
    ),
    /* @__PURE__ */ jsxDEV(
      "button",
      {
        onClick: () => setIsMuted(!isMuted),
        style: {
          position: "absolute",
          right: "16px",
          bottom: "16px",
          zIndex: 100,
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          border: "none",
          background: "rgba(0, 0, 0, 0.6)",
          color: "#fff",
          fontSize: "22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          pointerEvents: "auto"
        },
        children: isMuted ? "\u{1F507}" : "\u{1F50A}"
      },
      void 0,
      false,
      {
        fileName: "<stdin>",
        lineNumber: 30,
        columnNumber: 13
      }
    )
  ] }, void 0, true, {
    fileName: "<stdin>",
    lineNumber: 15,
    columnNumber: 9
  });
};
let replayRoot = null;
const mountReplay = (containerId, replayData) => {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (replayRoot) {
    replayRoot.unmount();
  }
  replayRoot = createRoot(container);
  replayRoot.render(/* @__PURE__ */ jsxDEV(ReplayContainer, { data: replayData }, void 0, false, {
    fileName: "<stdin>",
    lineNumber: 70,
    columnNumber: 23
  }));
};
const unmountReplay = () => {
  if (replayRoot) {
    replayRoot.unmount();
    replayRoot = null;
  }
};
export {
  mountReplay,
  unmountReplay
};
