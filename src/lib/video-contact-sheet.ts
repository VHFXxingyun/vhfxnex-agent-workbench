"use client";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 10 * 60;

function waitFor(
  target: HTMLVideoElement,
  eventName: "loadedmetadata" | "loadeddata" | "seeked",
) {
  return new Promise<void>((resolve, reject) => {
    const alreadyReady =
      (eventName === "loadedmetadata" && target.readyState >= HTMLMediaElement.HAVE_METADATA) ||
      (eventName === "loadeddata" && target.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    if (alreadyReady) {
      resolve();
      return;
    }
    if (target.error) {
      reject(new Error("浏览器无法读取该视频格式；请转成 MP4 或 WebM 后重试。"));
      return;
    }
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("视频读取超时，请换一个较短的 MP4 或 WebM 文件。"));
    }, 12_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      target.removeEventListener(eventName, onReady);
      target.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("浏览器无法读取该视频格式；请转成 MP4 或 WebM 后重试。"));
    };
    target.addEventListener(eventName, onReady, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

export function isVideoFile(file: File) {
  return (
    file.type.startsWith("video/") ||
    /\.(?:mp4|webm|mov)$/i.test(file.name)
  );
}

/** Samples six frames locally. Only the resulting JPEG contact sheet is sent to the server. */
export async function createVideoContactSheet(file: File): Promise<string> {
  if (file.size > MAX_VIDEO_BYTES) throw new Error("视频不能超过 100 MB。" );
  const source = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = source;
  try {
    await waitFor(video, "loadedmetadata");
    await waitFor(video, "loadeddata");
    if (!Number.isFinite(video.duration) || video.duration <= 0)
      throw new Error("无法读取视频时长。" );
    if (video.duration > MAX_VIDEO_SECONDS)
      throw new Error("当前最多处理 10 分钟视频，请先剪出需要分析的片段。" );

    const frameWidth = 480;
    const frameHeight = 270;
    const labelHeight = 32;
    const columns = 2;
    const frameCount = Math.min(6, Math.max(1, Math.ceil(video.duration / 20)));
    const rows = Math.ceil(frameCount / columns);
    const canvas = document.createElement("canvas");
    canvas.width = columns * frameWidth;
    canvas.height = rows * (frameHeight + labelHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建视频帧预览。" );

    context.fillStyle = "#111318";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < frameCount; index += 1) {
      const time = frameCount === 1 ? 0 : (video.duration * index) / (frameCount - 1);
      const targetTime = Math.min(time, Math.max(0, video.duration - 0.05));
      if (Math.abs(video.currentTime - targetTime) > 0.05) {
        const seeked = waitFor(video, "seeked");
        video.currentTime = targetTime;
        await seeked;
      }
      const x = (index % columns) * frameWidth;
      const y = Math.floor(index / columns) * (frameHeight + labelHeight);
      context.drawImage(video, x, y, frameWidth, frameHeight);
      context.fillStyle = "#1b1e25";
      context.fillRect(x, y + frameHeight, frameWidth, labelHeight);
      context.fillStyle = "#f3f4f6";
      context.font = "14px system-ui, sans-serif";
      context.fillText(`画面 ${index + 1} · ${formatTime(time)}`, x + 12, y + frameHeight + 21);
    }
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(source);
  }
}

function formatTime(seconds: number) {
  const total = Math.floor(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
