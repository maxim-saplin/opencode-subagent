import { describe, it, expect } from "bun:test";
import { isMouseWheelUp, isMouseWheelDown, parseMouseInput } from "../../src/tui/hooks";

describe("TUI input mouse parsing", () => {
  it("parses SGR wheel sequences", () => {
    expect(isMouseWheelUp("\x1b[<64;10;5M")).toBe(true);
    expect(isMouseWheelDown("\x1b[<65;10;5M")).toBe(true);
    expect(isMouseWheelUp("\x1b[<68;10;5M")).toBe(true); // shift+wheel up
    expect(isMouseWheelDown("\x1b[<69;10;5M")).toBe(true); // shift+wheel down
    expect(isMouseWheelUp("\x1b[<65;10;5M")).toBe(false);
    expect(isMouseWheelDown("\x1b[<64;10;5M")).toBe(false);
  });

  it("parses X10 wheel sequences", () => {
    const x10Up = `\x1b[M${String.fromCharCode(96)}${String.fromCharCode(33)}${String.fromCharCode(33)}`;
    const x10Down = `\x1b[M${String.fromCharCode(97)}${String.fromCharCode(33)}${String.fromCharCode(33)}`;
    expect(isMouseWheelUp(x10Up)).toBe(true);
    expect(isMouseWheelDown(x10Down)).toBe(true);
    expect(isMouseWheelUp(x10Down)).toBe(false);
    expect(isMouseWheelDown(x10Up)).toBe(false);
  });

  it("parses SGR left press, drag, and release", () => {
    const down = parseMouseInput("\x1b[<0;12;4M");
    expect(down.mouseDown).toBe(true);
    expect(down.mouseDrag).toBe(false);
    expect(down.mouseUp).toBe(false);
    expect(down.mouseX).toBe(12);
    expect(down.mouseY).toBe(4);

    const drag = parseMouseInput("\x1b[<32;15;4M");
    expect(drag.mouseDown).toBe(false);
    expect(drag.mouseDrag).toBe(true);
    expect(drag.mouseUp).toBe(false);

    const up = parseMouseInput("\x1b[<0;18;4m");
    expect(up.mouseDown).toBe(false);
    expect(up.mouseDrag).toBe(false);
    expect(up.mouseUp).toBe(true);
  });

  it("parses SGR legacy release encoded as M with cb=3", () => {
    const up = parseMouseInput("\x1b[<3;20;7M");
    expect(up.mouseUp).toBe(true);
    expect(up.mouseDown).toBe(false);
    expect(up.mouseDrag).toBe(false);
  });

  it("parses X10 button press/release", () => {
    const x10Down = `\x1b[M${String.fromCharCode(32)}${String.fromCharCode(36)}${String.fromCharCode(40)}`;
    const x10Up = `\x1b[M${String.fromCharCode(35)}${String.fromCharCode(36)}${String.fromCharCode(40)}`;
    expect(parseMouseInput(x10Down).mouseDown).toBe(true);
    expect(parseMouseInput(x10Up).mouseUp).toBe(true);
  });
});

