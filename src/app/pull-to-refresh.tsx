"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, RefreshCw } from "lucide-react";

type Phase = "idle" | "pulling" | "ready" | "blocked" | "refreshing";
const threshold = 76;

function isScrollable(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (/(auto|scroll|overlay)/.test(overflow) && node.scrollHeight > node.clientHeight + 1) return true;
    node = node.parentElement;
  }
  return false;
}
function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("input, textarea, select, button, a, [contenteditable='true'], [role='dialog'], .sidebar, .mobile-nav");
}
function editingInput(): boolean {
  const element=document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) return !element.readOnly && !element.disabled && /^(text|search|tel|email|password|url|number)$/.test(element.type);
  return false;
}

export function PullToRefresh({isBlocked,reload=()=>window.location.reload()}:{isBlocked:()=>boolean;reload?:()=>void}) {
  const [phase,setPhase]=useState<Phase>("idle");
  const blockedRef=useRef(isBlocked), reloadRef=useRef(reload);
  useEffect(()=>{blockedRef.current=isBlocked;reloadRef.current=reload;},[isBlocked,reload]);
  useEffect(()=>{
    let start: {x:number;y:number;active:boolean;distance:number} | null=null;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshing=false;
    const reset=()=>{start=null;setPhase("idle");};
    const onStart=(event:TouchEvent)=>{
      if (event.touches.length!==1) { if (start) reset(); return; }
      if (refreshing || window.innerWidth>760 || window.scrollY>0 || isScrollable(event.target) || isInteractive(event.target)) return;
      if(hideTimer) clearTimeout(hideTimer);
      start={x:event.touches[0].clientX,y:event.touches[0].clientY,active:false,distance:0};
    };
    const onMove=(event:TouchEvent)=>{
      if(!start) return;
      if(event.touches.length!==1 || window.scrollY>0) {reset();return;}
      const dy=event.touches[0].clientY-start.y, dx=event.touches[0].clientX-start.x;
      if(!start.active && Math.abs(dx)>12 && Math.abs(dx)>Math.abs(dy)) {reset();return;}
      if(dy<=8) {if(start.active) setPhase("pulling");start.distance=0;return;}
      if(Math.abs(dx)>dy*0.85) {reset();return;}
      start.active=true; start.distance=dy;
      if(event.cancelable) event.preventDefault();
      setPhase(blockedRef.current() || editingInput() ? "blocked" : dy>=threshold ? "ready" : "pulling");
    };
    const onEnd=(event:TouchEvent)=>{
      if(!start) return;
      if(event.touches.length>0) {reset();return;}
      const armed=start.active && start.distance>=threshold;
      start=null;
      if(armed && !blockedRef.current() && !editingInput()) {refreshing=true;setPhase("refreshing");reloadRef.current();return;}
      if(armed && (blockedRef.current() || editingInput())) {setPhase("blocked");hideTimer=setTimeout(()=>setPhase("idle"),1800);}
      else setPhase("idle");
    };
    const onBeforeUnload=(event:BeforeUnloadEvent)=>{if(blockedRef.current() || editingInput()){event.preventDefault();event.returnValue="";}};
    window.addEventListener("touchstart",onStart,{passive:true});
    window.addEventListener("touchmove",onMove,{passive:false});
    window.addEventListener("touchend",onEnd,{passive:true});
    window.addEventListener("touchcancel",reset,{passive:true});
    window.addEventListener("beforeunload",onBeforeUnload);
    return ()=>{
      window.removeEventListener("touchstart",onStart);window.removeEventListener("touchmove",onMove);
      window.removeEventListener("touchend",onEnd);window.removeEventListener("touchcancel",reset);
      window.removeEventListener("beforeunload",onBeforeUnload);if(hideTimer) clearTimeout(hideTimer);
    };
  },[]);
  if(phase==="idle") return null;
  const text=phase==="blocked" ? "Hãy lưu hoặc đóng nội dung đang sửa" : phase==="refreshing" ? "Đang làm mới…" : phase==="ready" ? "Thả để làm mới" : "Kéo xuống để làm mới";
  return <div className={`pull-refresh pull-refresh-${phase}`} role="status" aria-live="polite">{phase==="refreshing" ? <RefreshCw size={17} aria-hidden="true"/> : <ArrowDown size={17} aria-hidden="true"/>}<span>{text}</span></div>;
}
