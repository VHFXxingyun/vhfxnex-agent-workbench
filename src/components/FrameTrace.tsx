"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";

export default function FrameTrace({ delay = 0 }: { delay?: number }) {
  const gradientId = `vhfx-frame-${useId().replace(/:/g, "")}`;
  const prefersReducedMotion = useReducedMotion();
  const framePath =
    "M 7 1.5 H 93 Q 98.5 1.5 98.5 7 V 93 Q 98.5 98.5 93 98.5 H 7 Q 1.5 98.5 1.5 93 V 7 Q 1.5 1.5 7 1.5 Z";
  const initial = prefersReducedMotion ? false : { pathLength: 0, opacity: 0 };
  const transition = {
    pathLength: { duration: 1.18, delay, ease: [0.22, 0.8, 0.2, 1] as const },
    opacity: { duration: 1.42, delay, times: [0, 0.12, 1], ease: "linear" as const },
  };

  return (
    <motion.svg
      className="frame-trace"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#b99ae8" />
          <stop offset="52%" stopColor="#e1d2ff" />
          <stop offset="100%" stopColor="#b9e7c6" />
        </linearGradient>
      </defs>
      <motion.path
        d={framePath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={initial}
        animate={prefersReducedMotion ? { pathLength: 0, opacity: 0 } : { pathLength: 1, opacity: [0, 0.32, 0] }}
        transition={transition}
      />
      <motion.path
        d={framePath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={initial}
        animate={
          prefersReducedMotion
            ? { pathLength: 0, opacity: 0 }
            : { pathLength: 1, opacity: [0, 0.96, 0] }
        }
        transition={transition}
      />
    </motion.svg>
  );
}
