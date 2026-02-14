/**
 * Shared hooks for TUI keyboard nav.
 */
import { useCallback, useEffect, useState } from "react";
import { useInput } from "ink";

export interface KeyEvent {
  input: string;
  downArrow: boolean;
  upArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  wheelUp: boolean;
  wheelDown: boolean;
  mouseDown: boolean;
  mouseUp: boolean;
  mouseDrag: boolean;
  mouseX: number | null;
  mouseY: number | null;
}

export type KeyHandler = (ev: KeyEvent) => boolean;

/** Register global input handler; return true if handled. */
export function useGlobalInput(handler: KeyHandler): void {
  useInput((input, key) => {
    const mouse = parseMouseInput(input);
    handler({
      input,
      downArrow: key.downArrow,
      upArrow: key.upArrow,
      leftArrow: key.leftArrow,
      rightArrow: key.rightArrow,
      return: key.return,
      escape: key.escape,
      ctrl: key.ctrl,
      wheelUp: mouse.wheelUp,
      wheelDown: mouse.wheelDown,
      mouseDown: mouse.mouseDown,
      mouseUp: mouse.mouseUp,
      mouseDrag: mouse.mouseDrag,
      mouseX: mouse.mouseX,
      mouseY: mouse.mouseY,
    });
  });
}

export function isMouseWheelUp(input: string): boolean {
  return parseMouseInput(input).wheelUp;
}

export function isMouseWheelDown(input: string): boolean {
  return parseMouseInput(input).wheelDown;
}

export function parseMouseInput(input: string): {
  wheelUp: boolean;
  wheelDown: boolean;
  mouseDown: boolean;
  mouseUp: boolean;
  mouseDrag: boolean;
  mouseX: number | null;
  mouseY: number | null;
} {
  const none = {
    wheelUp: false,
    wheelDown: false,
    mouseDown: false,
    mouseUp: false,
    mouseDrag: false,
    mouseX: null,
    mouseY: null,
  };
  if (!input) return none;
  const sgr = input.match(/\x1b\[<(\d+);(\d+);(\d+)([mM])/);
  if (sgr) {
    const cb = Number(sgr[1]);
    const x = Number(sgr[2]);
    const y = Number(sgr[3]);
    const suffix = sgr[4];
    const isRelease = suffix === "m";
    const isWheel = cb >= 64 && cb < 96;
    const isWheelUp = isWheel && (cb & 1) === 0;
    const isWheelDown = isWheel && (cb & 1) === 1;
    const isMotion = (cb & 32) === 32;
    const button = cb & 3;
    const isLegacyRelease = !isMotion && button === 3;
    return {
      wheelUp: isWheelUp,
      wheelDown: isWheelDown,
      mouseDown: !isRelease && !isWheelUp && !isWheelDown && !isMotion && button === 0,
      mouseUp: (isRelease || isLegacyRelease) && !isWheelUp && !isWheelDown,
      mouseDrag: !isRelease && !isWheelUp && !isWheelDown && isMotion && button === 0,
      mouseX: Number.isFinite(x) ? x : null,
      mouseY: Number.isFinite(y) ? y : null,
    };
  }

  // X10 mouse mode: ESC [ M Cb Cx Cy (Cb=65 for wheel down)
  if (input.startsWith("\x1b[M") && input.length >= 6) {
    const cb = input.charCodeAt(3) - 32;
    const isWheel = cb >= 64 && cb < 96;
    return {
      ...none,
      wheelUp: isWheel && (cb & 1) === 0,
      wheelDown: isWheel && (cb & 1) === 1,
      mouseDown: !isWheel && cb === 0,
      mouseUp: !isWheel && cb === 3,
      mouseDrag: !isWheel && cb === 32,
      mouseX: input.charCodeAt(4) - 32,
      mouseY: input.charCodeAt(5) - 32,
    };
  }
  return none;
}

/** List selection with j/k and arrows. */
export function useListSelection<T>(items: T[], initialIndex = 0): [number, (delta: number) => void, (index: number) => void] {
  const [index, setIndex] = useState(initialIndex);
  const len = items.length;
  useEffect(() => {
    if (len === 0) setIndex(0);
    else if (index >= len) setIndex(Math.max(0, len - 1));
    else if (index < 0) setIndex(0);
  }, [len, index]);
  const move = useCallback(
    (delta: number) => {
      if (len === 0) return;
      setIndex((i) => Math.max(0, Math.min(len - 1, i + delta)));
    },
    [len]
  );
  const set = useCallback(
    (i: number) => {
      setIndex(Math.max(0, Math.min(len - 1, i)));
    },
    [len]
  );
  return [index, move, set];
}
