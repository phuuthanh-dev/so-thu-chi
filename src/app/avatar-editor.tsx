"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { avatarCropRect, type AvatarCrop } from "@/lib/avatar";

export function AvatarEditor({ file, onSave, onCancel, error, busy, motionEnabled }: {
  file: File; onSave: (crop: AvatarCrop) => void; onCancel: () => void;
  error: string; busy: boolean; motionEnabled: boolean;
}) {
  const [url, setUrl] = useState("");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [crop, setCrop] = useState<AvatarCrop>({ zoom: 1, x: 50, y: 50 });
  const form = useRef<HTMLFormElement>(null);
  const drag = useRef<{ pointer: number; startX: number; startY: number; x: number; y: number; width: number; size: number; maxX: number; maxY: number } | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    let active = true;
    Promise.resolve().then(() => { if (active) setUrl(objectUrl); });
    return () => { active = false; URL.revokeObjectURL(objectUrl); };
  }, [file]);

  useGSAP(() => {
    if (!motionEnabled || typeof window.matchMedia !== "function") return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(form.current, { y: 8, autoAlpha: 0, duration: 0.25, ease: "power2.out" });
    });
    return () => media.revert();
  }, { scope: form, dependencies: [motionEnabled], revertOnUpdate: true });

  const rect = dimensions ? avatarCropRect(dimensions.width, dimensions.height, crop) : null;
  const maxX = dimensions && rect ? Math.max(0, dimensions.width - rect.size) : 0;
  const maxY = dimensions && rect ? Math.max(0, dimensions.height - rect.size) : 0;
  // Fit the image's diagonal inside the circular avatar when fully zoomed out.
  const minZoom = dimensions ? Math.max(0.01, Math.floor(Math.min(dimensions.width, dimensions.height) / Math.hypot(dimensions.width, dimensions.height) * 100) / 100) : 1;
  const setValue = (key: keyof AvatarCrop, value: number) => setCrop((previous) => ({ ...previous, [key]: value }));
  return <form ref={form} className="avatar-editor" onSubmit={(event) => { event.preventDefault(); if (dimensions && !loadError) onSave(crop); }}>
    <p className="modal-desc">Kéo ảnh để đổi vị trí; thu nhỏ để thấy toàn bộ ảnh. Vùng trong vòng tròn là ảnh sẽ hiển thị.</p>
    <div className="avatar-crop-preview" role="img" aria-label="Xem trước ảnh đại diện" onPointerDown={(event) => {
      if (!rect) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: crop.x, y: crop.y, width: event.currentTarget.getBoundingClientRect().width, size: rect.size, maxX, maxY };
    }} onPointerMove={(event) => {
      const d = drag.current;
      if (!d || d.pointer !== event.pointerId || !d.width) return;
      const limit = (n: number) => Math.min(100, Math.max(0, n));
      setCrop((previous) => ({ ...previous,
        x: d.maxX ? limit(d.x - (event.clientX - d.startX) * d.size / d.width / d.maxX * 100) : previous.x,
        y: d.maxY ? limit(d.y - (event.clientY - d.startY) * d.size / d.width / d.maxY * 100) : previous.y }));
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {url && /* Blob URL is local and temporary; the preview does not fetch remote content. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={url} alt="" draggable={false} onLoad={(event) => {
          const width = event.currentTarget.naturalWidth, height = event.currentTarget.naturalHeight;
          if (!width || !height || width * height > 20_000_000) { setLoadError("Kích thước ảnh không hợp lệ hoặc quá lớn."); return; }
          setDimensions({ width, height });
        }} onError={() => setLoadError("Không đọc được ảnh. Hãy chọn ảnh khác.")} style={dimensions && rect ? {
          width: `${dimensions.width / rect.size * 100}%`, height: `${dimensions.height / rect.size * 100}%`,
          left: `${-rect.x / rect.size * 100}%`, top: `${-rect.y / rect.size * 100}%`,
        } : { visibility: "hidden" }} />}
      {!dimensions && !loadError && <span>Đang mở ảnh...</span>}
    </div>
    {(loadError || error) && <p className="avatar-error" role="alert">{loadError || error}</p>}
    <label className="crop-control">Độ phóng <output>{crop.zoom.toFixed(2)}×</output>
      <input type="range" aria-label="Độ phóng ảnh" min={minZoom} max="3" step="0.01" value={crop.zoom} onChange={(event) => setValue("zoom", Number(event.target.value))} />
    </label>
    <label className="crop-control">Vị trí ngang
      <input type="range" aria-label="Vị trí ngang" min="0" max="100" value={crop.x} disabled={!maxX} onChange={(event) => setValue("x", Number(event.target.value))} />
    </label>
    <label className="crop-control">Vị trí dọc
      <input type="range" aria-label="Vị trí dọc" min="0" max="100" value={crop.y} disabled={!maxY} onChange={(event) => setValue("y", Number(event.target.value))} />
    </label>
    <div className="crop-actions"><button type="button" className="outline-btn" onClick={onCancel}>Hủy</button><button type="submit" className="primary-btn" disabled={!dimensions || !!loadError || busy}>Lưu ảnh</button></div>
  </form>;
}
