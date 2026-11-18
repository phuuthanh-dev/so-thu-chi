"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export function PetalFall({ enabled }: { enabled: boolean }) {
  const layer = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (!enabled || typeof window.matchMedia !== "function") return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const petals = gsap.utils.toArray<SVGSVGElement>(".falling-flower", layer.current);
      const animations = petals.map((petal, index) => {
        return gsap.fromTo(petal,
          { y: -40, x: 0, rotation: index * 37, autoAlpha: 0.48 },
          { y: () => window.innerHeight + 80, x: index % 2 ? 65 : -50, rotation: index * 37 + 240,
            duration: 13 + index * 1.3, delay: -index * 2.6, ease: "none", repeat: -1, repeatRefresh: true },
        );
      });
      const updateVisibility = () => animations.forEach((animation) => document.hidden ? animation.pause() : animation.resume());
      document.addEventListener("visibilitychange", updateVisibility);
      updateVisibility();
      return () => document.removeEventListener("visibilitychange", updateVisibility);
    });
    return () => media.revert();
  }, { scope: layer, dependencies: [enabled], revertOnUpdate: true });

  return <div ref={layer} className="petal-layer" aria-hidden="true">
    {Array.from({ length: 8 }, (_, i) => <svg key={i} className="falling-flower" style={{ left: `${7 + i * 13}%` }} viewBox="0 0 32 32" width={i % 3 === 0 ? 19 : 15} height={i % 3 === 0 ? 19 : 15}>
      {[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cx="16" cy="9" rx="4.2" ry="7.5" transform={`rotate(${angle} 16 16)`} fill="#ed9bb6" />)}
      <circle cx="16" cy="16" r="3" fill="#f7d3ae" />
    </svg>)}
  </div>;
}
