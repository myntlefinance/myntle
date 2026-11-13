import { describe, it, expect, vi } from "vitest";
import {
  isDesktop,
  isEditableElement,
  focusComposer,
  typeToFocusComposer,
} from "./composer";

describe("composer utilities", () => {
  /**
   * `navigator` is a getter-only own property on globalThis in Node 22, so a
   * plain assignment throws. Defining it as configurable lets the test put it
   * back by deleting the own property.
   */
  function setGlobal(key: "window" | "navigator", value: unknown): void {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }

  function restoreGlobals(): void {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { navigator?: unknown }).navigator;
  }

  describe("isDesktop", () => {
    it("returns false during SSR when window or navigator is undefined", () => {
      expect(isDesktop(undefined, undefined)).toBe(false);
    });

    it("returns true for macOS desktop Chrome/Safari", () => {
      const mockNav = {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        platform: "MacIntel",
        maxTouchPoints: 0,
      } as Navigator;

      const mockWin = {
        matchMedia: (query: string) => ({
          matches: query.includes("pointer: fine") || query.includes("hover: hover"),
        }),
      } as unknown as Window;

      expect(isDesktop(mockWin, mockNav)).toBe(true);
    });

    it("returns true for Windows desktop", () => {
      const mockNav = {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        platform: "Win32",
        maxTouchPoints: 0,
      } as Navigator;

      const mockWin = {
        matchMedia: (query: string) => ({
          matches: query.includes("pointer: fine") || query.includes("hover: hover"),
        }),
      } as unknown as Window;

      expect(isDesktop(mockWin, mockNav)).toBe(true);
    });

    it("returns false for iPhone", () => {
      const mockNav = {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
      } as Navigator;

      const mockWin = {
        matchMedia: (query: string) => ({
          matches: query.includes("pointer: coarse"),
        }),
      } as unknown as Window;

      expect(isDesktop(mockWin, mockNav)).toBe(false);
    });

    it("returns false for Android phone", () => {
      const mockNav = {
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      } as Navigator;

      const mockWin = {
        matchMedia: () => ({ matches: false }),
      } as unknown as Window;

      expect(isDesktop(mockWin, mockNav)).toBe(false);
    });

    it("returns false for iPad disguised as MacIntel", () => {
      const mockNav = {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      } as Navigator;

      const mockWin = {
        matchMedia: (query: string) => ({
          matches: query.includes("pointer: coarse"),
        }),
      } as unknown as Window;

      expect(isDesktop(mockWin, mockNav)).toBe(false);
    });

    it("returns false for touch-only devices without hover", () => {
      const mockNav = {
        userAgent: "CustomTabletBrowser/1.0",
        platform: "TabletOS",
        maxTouchPoints: 10,
      } as Navigator;

      const mockWin = {
        matchMedia: (query: string) => ({
          matches: query.includes("pointer: coarse") || query.includes("hover: none"),
        }),
      } as unknown as Window;

      expect(isDesktop(mockWin, mockNav)).toBe(false);
    });
  });

  describe("isEditableElement", () => {
    it("returns false for null or undefined", () => {
      expect(isEditableElement(null)).toBe(false);
    });

    it("returns true for textarea", () => {
      const textarea = { tagName: "TEXTAREA" } as unknown as Element;
      expect(isEditableElement(textarea)).toBe(true);
    });

    it("returns true for text-like inputs", () => {
      for (const type of ["text", "email", "search", "password", "number", "tel", "url"]) {
        const input = { tagName: "INPUT", type } as unknown as Element;
        expect(isEditableElement(input)).toBe(true);
      }
    });

    it("returns false for non-text inputs like buttons and checkboxes", () => {
      for (const type of ["button", "checkbox", "radio", "submit", "file", "range"]) {
        const input = { tagName: "INPUT", type } as unknown as Element;
        expect(isEditableElement(input)).toBe(false);
      }
    });

    it("returns true for select and contenteditable elements", () => {
      const select = { tagName: "SELECT" } as unknown as Element;
      expect(isEditableElement(select)).toBe(true);

      const div = { tagName: "DIV", isContentEditable: true } as unknown as Element;
      expect(isEditableElement(div)).toBe(true);
    });

    it("returns false for standard non-editable elements", () => {
      expect(isEditableElement({ tagName: "DIV" } as unknown as Element)).toBe(false);
      expect(isEditableElement({ tagName: "BUTTON" } as unknown as Element)).toBe(false);
      expect(isEditableElement({ tagName: "SPAN" } as unknown as Element)).toBe(false);
    });
  });

  describe("focusComposer event dispatch", () => {
    it("dispatches custom event on desktop", () => {
      const dispatchEvent = vi.fn();
      const mockWin = {
        dispatchEvent,
        matchMedia: (q: string) => ({ matches: q.includes("pointer: fine") }),
      } as unknown as Window;

      const mockNav = {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
        maxTouchPoints: 0,
      } as Navigator;

      // When isDesktop is true:
      expect(isDesktop(mockWin, mockNav)).toBe(true);

      // Verify that focusComposer dispatches when executed in desktop context
      setGlobal("window", mockWin);
      setGlobal("navigator", mockNav);

      try {
        focusComposer({ clearDraft: true });
        expect(dispatchEvent).toHaveBeenCalled();
      } finally {
        restoreGlobals();
      }
    });

    it("does not dispatch event on mobile to prevent virtual keyboard popup", () => {
      const dispatchEvent = vi.fn();
      const mockWin = {
        dispatchEvent,
        matchMedia: () => ({ matches: false }),
      } as unknown as Window;

      const mockNav = {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        platform: "iPhone",
        maxTouchPoints: 5,
      } as Navigator;

      expect(isDesktop(mockWin, mockNav)).toBe(false);

      setGlobal("window", mockWin);
      setGlobal("navigator", mockNav);

      try {
        focusComposer({ clearDraft: true });
        expect(dispatchEvent).not.toHaveBeenCalled();
      } finally {
        restoreGlobals();
      }
    });
  });

  describe("typeToFocusComposer", () => {
    it("inserts typed character at cursor and positions selection correctly", () => {
      const focus = vi.fn();
      const setSelectionRange = vi.fn();
      const dispatchEvent = vi.fn();

      const mockTextarea = {
        value: "hello",
        selectionStart: 5,
        selectionEnd: 5,
        focus,
        setSelectionRange,
        dispatchEvent,
      } as unknown as HTMLTextAreaElement;

      const onValueChange = vi.fn();
      typeToFocusComposer(mockTextarea, "!", onValueChange);

      expect(focus).toHaveBeenCalled();
      expect(mockTextarea.value).toBe("hello!");
      expect(setSelectionRange).toHaveBeenCalledWith(6, 6);
      expect(onValueChange).toHaveBeenCalledWith("hello!");
    });

    it("inserts character at selection start when cursor is in the middle", () => {
      const focus = vi.fn();
      const setSelectionRange = vi.fn();

      const mockTextarea = {
        value: "swap",
        selectionStart: 1,
        selectionEnd: 1,
        focus,
        setSelectionRange,
        dispatchEvent: vi.fn(),
      } as unknown as HTMLTextAreaElement;

      const onValueChange = vi.fn();
      typeToFocusComposer(mockTextarea, "h", onValueChange);

      expect(focus).toHaveBeenCalled();
      expect(mockTextarea.value).toBe("shwap");
      expect(setSelectionRange).toHaveBeenCalledWith(2, 2);
      expect(onValueChange).toHaveBeenCalledWith("shwap");
    });
  });
});
