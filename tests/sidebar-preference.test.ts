import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("the dashboard sidebar preference (ticket 64)", () => {
  it("starts compact when the browser has no saved choice", async () => {
    const preference = await import("../src/app/dashboard/sidebar-preference");

    expect(preference.initialSidebarCollapsed()).toBe(true);
    expect(
      preference.restoreSidebarCollapsed({ getItem: () => null }),
    ).toBe(true);
  });

  it("remembers an expanded choice synchronously across header mounts", async () => {
    const preference = await import("../src/app/dashboard/sidebar-preference");
    const saved: string[] = [];

    preference.persistSidebarCollapsed(
      { setItem: (_key, value) => saved.push(value) },
      false,
    );

    expect(saved).toEqual(["0"]);
    expect(preference.initialSidebarCollapsed()).toBe(false);
  });

  it("restores only the exact expanded marker and keeps later mounts stable", async () => {
    const preference = await import("../src/app/dashboard/sidebar-preference");

    expect(
      preference.restoreSidebarCollapsed({ getItem: () => "0" }),
    ).toBe(false);
    expect(preference.initialSidebarCollapsed()).toBe(false);

    preference.persistSidebarCollapsed({ setItem: () => undefined }, true);
    expect(preference.initialSidebarCollapsed()).toBe(true);
  });
});
