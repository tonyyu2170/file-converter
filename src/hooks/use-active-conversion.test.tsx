import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetForTests, useActiveConversion } from "./use-active-conversion";

describe("useActiveConversion", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(window, "addEventListener");
    removeSpy = vi.spyOn(window, "removeEventListener");
    __resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetForTests();
  });

  function beforeUnloadCalls(spy: ReturnType<typeof vi.spyOn>): number {
    return spy.mock.calls.filter((c) => c[0] === "beforeunload").length;
  }

  it("attaches the beforeunload listener on first active mount", () => {
    renderHook(() => useActiveConversion(true));
    expect(beforeUnloadCalls(addSpy)).toBe(1);
    expect(beforeUnloadCalls(removeSpy)).toBe(0);
  });

  it("does not attach when active=false", () => {
    renderHook(() => useActiveConversion(false));
    expect(beforeUnloadCalls(addSpy)).toBe(0);
  });

  it("removes the listener when the only active flips to false", () => {
    const { rerender } = renderHook(({ a }) => useActiveConversion(a), {
      initialProps: { a: true },
    });
    expect(beforeUnloadCalls(addSpy)).toBe(1);

    rerender({ a: false });
    expect(beforeUnloadCalls(removeSpy)).toBe(1);
  });

  it("keeps the listener attached while any consumer is still active", () => {
    const a = renderHook(() => useActiveConversion(true));
    const b = renderHook(() => useActiveConversion(true));
    expect(beforeUnloadCalls(addSpy)).toBe(1); // attached once, not twice

    a.unmount();
    expect(beforeUnloadCalls(removeSpy)).toBe(0); // still active via b

    b.unmount();
    expect(beforeUnloadCalls(removeSpy)).toBe(1);
  });

  it("removes the listener on unmount when active=true", () => {
    const { unmount } = renderHook(() => useActiveConversion(true));
    unmount();
    expect(beforeUnloadCalls(removeSpy)).toBe(1);
  });

  it("re-attaches after counter returns from zero to positive", () => {
    const first = renderHook(() => useActiveConversion(true));
    first.unmount();
    expect(beforeUnloadCalls(removeSpy)).toBe(1);

    renderHook(() => useActiveConversion(true));
    expect(beforeUnloadCalls(addSpy)).toBe(2);
  });

  it("under StrictMode the listener nets to one registration", async () => {
    const { StrictMode } = await import("react");
    renderHook(() => useActiveConversion(true), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    expect(beforeUnloadCalls(addSpy) - beforeUnloadCalls(removeSpy)).toBe(1);
  });

  it("attaches the listener when active flips false → true on the same instance", () => {
    const { rerender } = renderHook(({ a }) => useActiveConversion(a), {
      initialProps: { a: false },
    });
    expect(beforeUnloadCalls(addSpy)).toBe(0);
    rerender({ a: true });
    expect(beforeUnloadCalls(addSpy)).toBe(1);
  });
});
