"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Circle, GitBranch, PackageCheck, Target } from "lucide-react";
import type { Task } from "@/lib/goal";

function workflowTitle(category: string) {
  if (/活动|会议|招新|工作坊|赛事|展览/.test(category)) return "活动流程";
  if (/项目|开发|Web|产品|软件/.test(category)) return "项目流程";
  if (/旅行|出行|行程/.test(category)) return "行程流程";
  if (/日程|学习|安排/.test(category)) return "日程节奏";
  return "推进流程";
}

function groupByPhase(tasks: Task[]) {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const phase = task.phase.trim() || "待分类";
    groups.set(phase, [...(groups.get(phase) || []), task]);
  }
  return Array.from(groups, ([phase, phaseTasks]) => ({ phase, tasks: phaseTasks }));
}

type Point = { x: number; y: number };
type DragOrigin = Point & { pointerId: number; pan: Point };

export default function ProjectFlowPanel({
  category,
  prompt,
  tasks,
  artifactCount,
}: {
  category: string;
  prompt: string;
  tasks: Task[];
  artifactCount: number;
}) {
  const prefersReducedMotion = useReducedMotion();
  const phases = groupByPhase(tasks);
  const activeIndex = phases.findIndex((phase) =>
    phase.tasks.some((task) => task.status !== "done"),
  );
  const title = workflowTitle(category);
  const dragOriginRef = useRef<DragOrigin | null>(null);
  const [pan, setPan] = useState<Point>({ x: 0, y: 12 });
  const [isPanning, setIsPanning] = useState(false);
  const panByKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const amount = event.shiftKey ? 72 : 36;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setPan((current) => ({
        ...current,
        x: current.x + (event.key === "ArrowLeft" ? amount : -amount),
      }));
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setPan((current) => ({
        ...current,
        y: current.y + (event.key === "ArrowUp" ? amount : -amount),
      }));
    }
  };
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
    dragOriginRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan,
    };
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    setPan({
      x: origin.pan.x + event.clientX - origin.x,
      y: origin.pan.y + event.clientY - origin.y,
    });
  };
  const stopPan = (event: PointerEvent<HTMLDivElement>) => {
    if (dragOriginRef.current?.pointerId === event.pointerId) {
      dragOriginRef.current = null;
      setIsPanning(false);
    }
  };
  const panByWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
  };

  return (
    <aside id="project-flow-panel" className="workspace-flow-panel" aria-label={title}>
      <header className="workspace-flow-head">
        <div className="workspace-flow-title">
          <span className="workspace-flow-icon">
            <GitBranch size={17} />
          </span>
          <span>
            <small>PROJECT FLOW</small>
            <strong>{title}</strong>
          </span>
          <b>{phases.length}</b>
        </div>
      </header>
      <div className="workspace-flow-map">
        <div
          className={`flow-canvas${isPanning ? " is-panning" : ""}`}
          role="region"
          aria-label={`${title}流程画布，可拖动平移`}
          tabIndex={0}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={stopPan}
          onPointerCancel={stopPan}
          onWheel={panByWheel}
          onKeyDown={panByKeyboard}
        >
          <div
            className="flow-canvas-board"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
          >
            <div className="flow-canvas-node-row">
              <article className="flow-canvas-node goal">
                <span className="flow-canvas-node-icon">
                  <Target size={16} />
                </span>
                <div>
                  <small>目标 · {category}</small>
                  <strong>{prompt}</strong>
                  <span>Agent 已建立执行路线</span>
                </div>
                <i>输入</i>
              </article>
            </div>
            {phases.map((phase, index) => {
              const complete = phase.tasks.every((task) => task.status === "done");
              const current = !complete && index === activeIndex;
              const state = complete ? "complete" : current ? "current" : "upcoming";
              return (
                <motion.div
                  className="flow-canvas-step"
                  key={`${phase.phase}-${index}`}
                  layout
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 360,
                    damping: 32,
                    delay: prefersReducedMotion ? 0 : index * 0.035,
                  }}
                >
                  <div className="flow-canvas-connector" aria-hidden="true" />
                  <div className="flow-canvas-node-row">
                    <article className={`flow-canvas-node ${state}`}>
                      <span className="flow-canvas-node-icon" aria-hidden="true">
                        {complete ? <Check size={15} /> : <Circle size={13} />}
                      </span>
                      <div>
                        <small>阶段 {String(index + 1).padStart(2, "0")}</small>
                        <strong>{phase.phase}</strong>
                        <span>
                          {phase.tasks[0]?.title}
                          {phase.tasks.length > 1 ? ` · 另有 ${phase.tasks.length - 1} 项` : ""}
                        </span>
                      </div>
                      <i>{complete ? "已完成" : current ? "进行中" : "待推进"}</i>
                    </article>
                  </div>
                </motion.div>
              );
            })}
            {artifactCount > 0 && (
              <motion.div
                className="flow-canvas-step"
                layout
                initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 360, damping: 32 }}
              >
                <div className="flow-canvas-connector" aria-hidden="true" />
                <div className="flow-canvas-node-row">
                  <article className="flow-canvas-node complete">
                    <span className="flow-canvas-node-icon">
                      <PackageCheck size={16} />
                    </span>
                    <div>
                      <small>交付成果</small>
                      <strong>成果可查看</strong>
                      <span>{artifactCount} 项文件已放入行动计划</span>
                    </div>
                    <i>已生成</i>
                  </article>
                </div>
              </motion.div>
            )}
          </div>
          <span className="flow-canvas-hint">
            <span /> 拖动平移 · 滚轮移动
          </span>
        </div>
        <p className="workspace-flow-footnote">
          阶段会随任务完成状态更新；拖动画布可查看完整流程。
        </p>
      </div>
    </aside>
  );
}
