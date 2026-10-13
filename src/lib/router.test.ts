import { beforeEach, describe, expect, it } from "vitest";
import {
  dashboardPath,
  getCurrentView,
  getViewMode,
  initRouter,
  navigate,
  parsePath,
  setIsLoggedIn,
} from "./state.svelte.js";

function current() {
  return [window.location.pathname, getCurrentView(), getViewMode()];
}

describe("parsePath", () => {
  it("treats / as the public landing page", () => {
    expect(parsePath("/")).toEqual({ view: "landing", mode: "overview", path: "/" });
  });

  it("keeps /login as the auth screen", () => {
    expect(parsePath("/login")).toEqual({ view: "login", mode: "overview", path: "/login" });
  });

  it("reads views and modes under /dashboard", () => {
    expect(parsePath("/dashboard/income/list")).toEqual({ view: "income", mode: "list", path: "/dashboard/income/list" });
    expect(parsePath("/dashboard/spaces")).toEqual({ view: "spaces", mode: "overview", path: "/dashboard/spaces" });
  });

  it("defaults /dashboard and unknown dashboard views to the expense overview", () => {
    expect(parsePath("/dashboard").path).toBe("/dashboard/expense");
    expect(parsePath("/dashboard/nope").path).toBe("/dashboard/expense");
  });

  it("rewrites legacy pre-/dashboard links", () => {
    expect(parsePath("/expense").path).toBe("/dashboard/expense");
    expect(parsePath("/income/list").path).toBe("/dashboard/income/list");
    expect(parsePath("/account").path).toBe("/dashboard/account");
  });

  it("ignores a /list segment on views without modes", () => {
    expect(parsePath("/dashboard/account/list").path).toBe("/dashboard/account");
  });

  it("sends unknown top-level paths to the landing page", () => {
    expect(parsePath("/does-not-exist").view).toBe("landing");
  });
});

describe("dashboardPath", () => {
  it("builds canonical dashboard URLs", () => {
    expect(dashboardPath()).toBe("/dashboard/expense");
    expect(dashboardPath("income", "list")).toBe("/dashboard/income/list");
    expect(dashboardPath("summaries", "list")).toBe("/dashboard/summaries");
  });
});

describe("navigate", () => {
  describe("when signed in", () => {
    beforeEach(() => {
      setIsLoggedIn(true);
      history.replaceState({}, "", "/");
      initRouter();
    });

    it("moves between dashboard views and modes", () => {
      navigate("/dashboard/expense/list");
      expect(current()).toEqual(["/dashboard/expense/list", "expense", "list"]);
      navigate(dashboardPath("income"));
      expect(current()).toEqual(["/dashboard/income", "income", "overview"]);
    });

    it("still shows the landing page at /", () => {
      navigate("/");
      expect(current()).toEqual(["/", "landing", "overview"]);
    });

    it("sends /login on to the dashboard", () => {
      navigate("/login");
      expect(current()).toEqual(["/dashboard/expense", "expense", "overview"]);
    });
  });

  describe("when signed out", () => {
    beforeEach(() => {
      setIsLoggedIn(false);
      history.replaceState({}, "", "/");
      initRouter();
    });

    it("guards dashboard views behind /login", () => {
      navigate("/dashboard/income");
      expect(current()).toEqual(["/login", "login", "overview"]);
    });

    it("allows the landing page", () => {
      navigate("/login");
      navigate("/");
      expect(current()).toEqual(["/", "landing", "overview"]);
    });
  });
});

describe("initRouter", () => {
  it("canonicalizes a legacy URL on load", () => {
    history.replaceState({}, "", "/income/list");
    initRouter();
    expect(current()).toEqual(["/dashboard/income/list", "income", "list"]);
  });
});
