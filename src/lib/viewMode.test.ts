import { beforeEach, describe, expect, it } from "vitest";
import { getCurrentView, getViewMode, initRouter, navigate, setIsLoggedIn } from "./state.svelte.js";

describe("view-mode routing", () => {
  beforeEach(() => {
    setIsLoggedIn(true);
    history.replaceState({}, "", "/expense");
    initRouter();
  });

  it("reads list mode from /expense/list and /income/list", () => {
    navigate("/expense/list");
    expect([getCurrentView(), getViewMode()]).toEqual(["expense", "list"]);
    navigate("/income/list");
    expect([getCurrentView(), getViewMode()]).toEqual(["income", "list"]);
  });

  it("defaults to overview for /income and /expense", () => {
    navigate("/income");
    expect([getCurrentView(), getViewMode()]).toEqual(["income", "overview"]);
    navigate("/expense");
    expect([getCurrentView(), getViewMode()]).toEqual(["expense", "overview"]);
  });

  it("ignores a /list segment on views without modes", () => {
    navigate("/account/list");
    expect([getCurrentView(), getViewMode()]).toEqual(["account", "overview"]);
  });
});
