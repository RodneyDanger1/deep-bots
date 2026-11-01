import type { AgentMessage } from "@openbot/ui/data";
import { AgentActivityIndicator } from "@openbot/ui/features/conversation/AgentActivity";
import { contextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { render, screen } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { type ActivityProps, createActivityStore } from "./stores/activity-store";
import { reportedCostUsd } from "./turn-steps";

/**
 * The host stores a provider's reasoning deltas as a commentary message (`turn-lifecycle.ts`
 * `item/reasoning/textDelta` sets `itemType = "commentary"`). That text is private deliberation,
 * not a user-facing activity label, so the activity line must never read it.
 */
const REASONING =
  "Docs pages have no date metadata. So for product-description claims I should keep the dates that the search results gave me.";

/** The host's own tool progress line. It is a summary that the user may read, unlike the reasoning. */
const TOOL_FAILURE = "A tool step failed; reviewing the result and deciding what to try next…";

function commentaryMessage(text: string): AgentMessage {
  return {
    id: "m1",
    author: "agent",
    turnId: "t1",
    body: "",
    time: "16:00",
    items: [text],
    itemIds: ["m1"],
    streaming: true,
    itemType: "commentary",
  };
}

/** A store over the props that the activity line reads, on a root the test disposes. */
function storeWith(overrides: Partial<ActivityProps> = {}) {
  const props: ActivityProps = {
    agent: undefined,
    activeTurnId: "t1",
    messages: [],
    queue: undefined,
    server: undefined,
    prompt: undefined,
    approval: undefined,
    browserTakeover: undefined,
    activityDetail: undefined,
    turnStepLines: undefined,
    ...overrides,
  };
  let dispose = () => {};
  const store = createRoot((stop) => {
    dispose = stop;
    return createActivityStore({
      props,
      activeDeliveries: () => [],
      agentActivityLabels: new Map(),
      turnRuntimes: new Map(),
    });
  });
  return { store, dispose: () => dispose() };
}

describe("the activity line", () => {
  it("never reads the model's reasoning text as its detail", () => {
    const { store, dispose } = storeWith({ messages: [commentaryMessage(REASONING)] });
    try {
      expect(store.activeActivityDetail()).toBeNull();
    } finally {
      dispose();
    }
  });

  it("keeps reasoning text out of the accessible status", () => {
    const { store, dispose } = storeWith({ messages: [commentaryMessage(REASONING)] });
    try {
      render(() => (
        <AgentActivityIndicator agent={undefined} detail={store.activeActivityDetail()} label="Working on it…" />
      ));
      const status = screen.getByRole("status");
      expect(status).toHaveAccessibleName("Agent is working: Working on it…");
      expect(status.getAttribute("aria-label")).not.toContain("Docs pages have no date metadata");
      expect(screen.getByLabelText("Current activity").textContent).not.toContain("Docs pages have no date metadata");
    } finally {
      dispose();
    }
  });

  it("shows the host's own tool step summary once, and offers no retry for it", () => {
    const { store, dispose } = storeWith({ activityDetail: TOOL_FAILURE });
    try {
      expect(store.activeActivityDetail()).toBe(TOOL_FAILURE);
      render(() => (
        <AgentActivityIndicator agent={undefined} detail={store.activeActivityDetail()} label="Working on it…" />
      ));
      const region = screen.getByLabelText("Current activity");
      expect(region.textContent?.split("A tool step failed").length).toBe(2);
      // No control retries a tool step, so the row shows none. A false retry would be a lie.
      expect(screen.queryByRole("button", { name: /retry|try again/i })).toBeNull();
    } finally {
      dispose();
    }
  });
});

describe("context and cost", () => {
  it("passes the provider's own context figures through without adding them up again", () => {
    const view = contextUsageView({
      agentId: "a1",
      threadId: "t1",
      usage: {
        usedTokens: 482_344,
        windowTokens: 1_048_576,
        autoCompactAt: 0.8,
        nativeManaged: false,
        estimated: true,
      },
      compaction: null,
    });
    expect(view).toMatchObject({ usedTokens: 482_344, windowTokens: 1_048_576, estimated: true, compacting: false });
  });

  it("reports no cost when the provider reported none, and never zero", () => {
    expect(reportedCostUsd(undefined)).toBeNull();
    expect(reportedCostUsd({ startedAt: "", endedAt: null, steps: [] })).toBeNull();
    expect(reportedCostUsd({ startedAt: "", endedAt: null, steps: [], costUsd: null })).toBeNull();
    expect(reportedCostUsd({ startedAt: "", endedAt: null, steps: [], costUsd: 0.0123 })).toBe(0.0123);
  });
});
