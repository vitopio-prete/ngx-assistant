import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createAssistantStream } from "assistant-stream";
import type { AssistantRuntime } from "../runtime/api/assistant-runtime";
import type { RemoteThreadListAdapter } from "../runtimes/remote-thread-list/types";
import { deferred, makeAdapter } from "./remote-thread-list-test-helpers";
import {
  act,
  actSettled,
  createMessageStore,
  createRemoteThreadListRuntime,
  externalStoreThreadRuntime,
  getThreadCore,
  localThreadRuntime,
  userMessage,
} from "./remote-thread-list-runtime-test-helpers";

describe("first-run titles", () => {
  it.each([
    "completion",
    "error",
    "cancel",
    "loaded",
    "empty loaded title",
    "already titled",
    "renamed",
    "empty rename",
    "pending automatic empty",
    "pending automatic title",
    "pending explicit empty",
    "pending explicit title",
    "empty fallback",
  ] as const)(
    "handles %s and only attempts the fallback once",
    async (scenario) => {
      const run = deferred<void>();
      const firstTitle = deferred<string>();
      const explicitTitle = deferred<string>();
      const loaded = scenario === "loaded" || scenario === "empty loaded title";
      const pendingAutomatic = scenario.startsWith("pending automatic");
      const pendingExplicit = scenario.startsWith("pending explicit");
      const renamed = scenario === "renamed" || scenario === "empty rename";
      const expectedFallback =
        !renamed &&
        ![
          "already titled",
          "pending automatic title",
          "pending explicit title",
        ].includes(scenario);
      const adapter = makeAdapter({
        fetch: vi.fn(async (remoteId) => ({
          remoteId,
          status: "regular" as const,
          ...(scenario === "empty loaded title" ? { title: "" } : {}),
        })),
        generateTitle: vi.fn(async () => {
          const call = vi.mocked(adapter.generateTitle).mock.calls.length;
          const title =
            !loaded && call === 1
              ? await firstTitle.promise
              : pendingExplicit && call === 2
                ? await explicitTitle.promise
                : scenario === "empty fallback"
                  ? ""
                  : "First exchange";
          return createAssistantStream(async (controller) => {
            if (title) controller.appendText(title);
          });
        }),
      });
      const capture: { runtime: AssistantRuntime | null } = { runtime: null };
      const created = createRemoteThreadListRuntime({
        adapter,
        threadRuntime: localThreadRuntime({
          run: async function* () {
            yield { content: [{ type: "text", text: "hello back" }] };
            await run.promise;
            if (scenario === "error") throw new Error("run failed");
          },
        }),
      });
      onTestFinished(created.dispose);
      capture.runtime = created.runtime;
      try {
        await vi.waitFor(() => expect(capture.runtime).not.toBeNull());
        if (loaded)
          await actSettled(() =>
            capture.runtime!.threads.switchToThread("external"),
          );
        const runtime = capture.runtime!;
        const item = runtime.threads.mainItem;
        if (!pendingAutomatic)
          firstTitle.resolve(
            scenario === "already titled" ? "Initial title" : "",
          );
        act(() => runtime.thread.append("hello"));
        await vi.waitFor(() =>
          expect(runtime.thread.getState().messages).toHaveLength(2),
        );
        await vi.waitFor(() =>
          expect(runtime.thread.getState().isRunning).toBe(true),
        );
        if (!loaded) {
          await vi.waitFor(() =>
            expect(adapter.generateTitle).toHaveBeenCalledTimes(1),
          );
          expect(
            vi
              .mocked(adapter.generateTitle)
              .mock.calls[0]![1].map((message) => message.role),
          ).toEqual(["user"]);
        }
        if (renamed)
          await actSettled(() =>
            item.rename(scenario === "empty rename" ? "" : "Manual"),
          );
        let explicit: Promise<void> | undefined;
        if (pendingExplicit) {
          act(() => {
            explicit = item.generateTitle();
          });
          await vi.waitFor(() =>
            expect(adapter.generateTitle).toHaveBeenCalledTimes(2),
          );
        }
        await act(async () => {
          if (scenario === "cancel") runtime.thread.cancelRun();
          run.resolve();
        });
        await vi.waitFor(() =>
          expect(runtime.thread.getState().isRunning).toBe(false),
        );
        if (pendingAutomatic || pendingExplicit) {
          expect(adapter.generateTitle).toHaveBeenCalledTimes(
            pendingExplicit ? 2 : 1,
          );
          await act(async () => {
            const title = scenario.endsWith(" title") ? "Delayed title" : "";
            if (pendingExplicit) {
              explicitTitle.resolve(title);
              await explicit;
            } else firstTitle.resolve(title);
          });
        }
        const count =
          (loaded ? 0 : pendingExplicit ? 2 : 1) + (expectedFallback ? 1 : 0);
        await vi.waitFor(() =>
          expect(adapter.generateTitle).toHaveBeenCalledTimes(count),
        );
        if (expectedFallback) {
          const messages = vi
            .mocked(adapter.generateTitle)
            .mock.calls.at(-1)![1];
          expect(
            messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ).toEqual([
            { role: "user", content: [{ type: "text", text: "hello" }] },
            {
              role: "assistant",
              content: [{ type: "text", text: "hello back" }],
            },
          ]);
          await vi.waitFor(() =>
            expect(item.getState().title).toBe(
              scenario === "empty fallback" ? undefined : "First exchange",
            ),
          );
        } else {
          await vi.waitFor(() =>
            expect(item.getState().title).toBe(
              renamed
                ? scenario === "empty rename"
                  ? ""
                  : "Manual"
                : scenario === "already titled"
                  ? "Initial title"
                  : "Delayed title",
            ),
          );
        }
        act(() => runtime.thread.append("again"));
        await vi.waitFor(() =>
          expect(runtime.thread.getState().messages).toHaveLength(4),
        );
        await vi.waitFor(() =>
          expect(runtime.thread.getState().isRunning).toBe(false),
        );
        await act(async () => {});
        expect(adapter.generateTitle).toHaveBeenCalledTimes(count);
      } finally {
        created.dispose();
      }
    },
  );
});

describe("RemoteThreadInstanceManager title generation", () => {
  it("generates the title once initialization resolves, without waiting for a run", async () => {
    const initialization = deferred<{
      remoteId: string;
      externalId: string;
    }>();
    const generateTitle = vi.fn<RemoteThreadListAdapter["generateTitle"]>(
      async () => new ReadableStream(),
    );
    const adapter = makeAdapter({
      initialize: vi.fn(() => initialization.promise),
      generateTitle,
    });
    const runtimeRef: { current: AssistantRuntime | null } = { current: null };

    const created = createRemoteThreadListRuntime({
      adapter,
      threadRuntime: localThreadRuntime({ run: async () => ({ content: [] }) }),
    });
    onTestFinished(created.dispose);
    runtimeRef.current = created.runtime;
    await vi.waitFor(() => {
      expect(runtimeRef.current?.threads.mainItem.getState().id).toBeDefined();
    });
    const localId = runtimeRef.current!.threads.mainItem.getState().id;

    void getThreadCore(runtimeRef.current!).append(userMessage("hello"));
    await Promise.resolve();

    expect(adapter.initialize).toHaveBeenCalledTimes(1);
    expect(generateTitle).not.toHaveBeenCalled();

    initialization.resolve({
      remoteId: `remote-${localId}`,
      externalId: `external-${localId}`,
    });

    await vi.waitFor(() => {
      expect(generateTitle).toHaveBeenCalledTimes(1);
    });
    expect(generateTitle).toHaveBeenCalledWith(`remote-${localId}`, [
      expect.objectContaining({
        role: "user",
        content: [expect.objectContaining({ type: "text", text: "hello" })],
      }),
    ]);
  });

  it("excludes the in-flight assistant message from the title payload", async () => {
    const initialization = deferred<{
      remoteId: string;
      externalId: string;
    }>();
    const generateTitle = vi.fn<RemoteThreadListAdapter["generateTitle"]>(
      async () => new ReadableStream(),
    );
    const adapter = makeAdapter({
      initialize: vi.fn(() => initialization.promise),
      generateTitle,
    });
    const runtimeRef: { current: AssistantRuntime | null } = { current: null };

    const created = createRemoteThreadListRuntime({
      adapter,
      threadRuntime: localThreadRuntime({
        run: () => new Promise<never>(() => {}),
      }),
    });
    onTestFinished(created.dispose);
    runtimeRef.current = created.runtime;
    await vi.waitFor(() => {
      expect(runtimeRef.current?.threads.mainItem.getState().id).toBeDefined();
    });
    const localId = runtimeRef.current!.threads.mainItem.getState().id;

    void getThreadCore(runtimeRef.current!).append({
      ...userMessage("hello"),
      startRun: true,
    });
    await act(async () => {});

    initialization.resolve({
      remoteId: `remote-${localId}`,
      externalId: `external-${localId}`,
    });

    await vi.waitFor(() => {
      expect(generateTitle).toHaveBeenCalledTimes(1);
    });
    const titleCall = generateTitle.mock.calls[0];
    if (titleCall === undefined) throw new Error("Expected title generation");
    const [, titledMessages] = titleCall;
    expect(titledMessages.map((message) => message.role)).toEqual(["user"]);
  });

  it("waits for a settled message on an agent-initiated first turn", async () => {
    const initialization = deferred<{
      remoteId: string;
      externalId: string;
    }>();
    const run = deferred<{ content: { type: "text"; text: string }[] }>();
    const generateTitle = vi.fn<RemoteThreadListAdapter["generateTitle"]>(
      async () => new ReadableStream(),
    );
    const adapter = makeAdapter({
      initialize: vi.fn(() => initialization.promise),
      generateTitle,
    });
    const runtimeRef: { current: AssistantRuntime | null } = { current: null };

    const created = createRemoteThreadListRuntime({
      adapter,
      threadRuntime: localThreadRuntime({ run: () => run.promise }),
    });
    onTestFinished(created.dispose);
    runtimeRef.current = created.runtime;
    await vi.waitFor(() => {
      expect(runtimeRef.current?.threads.mainItem.getState().id).toBeDefined();
    });
    const localId = runtimeRef.current!.threads.mainItem.getState().id;

    act(() => {
      runtimeRef.current!.thread.startRun({ parentId: null });
    });
    await act(async () => {});

    initialization.resolve({
      remoteId: `remote-${localId}`,
      externalId: `external-${localId}`,
    });
    await act(async () => {});

    expect(generateTitle).not.toHaveBeenCalled();

    run.resolve({ content: [{ type: "text", text: "hi there" }] });

    await vi.waitFor(() => {
      expect(generateTitle).toHaveBeenCalledTimes(1);
    });
    const titleCall = generateTitle.mock.calls[0];
    if (titleCall === undefined) throw new Error("Expected title generation");
    const [, titledMessages] = titleCall;
    expect(titledMessages.map((message) => message.role)).toEqual([
      "assistant",
    ]);
  });

  it("waits for the first message when initialization resolves before the store lands it", async () => {
    const generateTitle = vi.fn<RemoteThreadListAdapter["generateTitle"]>(
      async () => new ReadableStream(),
    );
    const adapter = makeAdapter({ generateTitle });
    const store = createMessageStore();
    const capture: { runtime: AssistantRuntime | null } = { runtime: null };

    const created = createRemoteThreadListRuntime({
      adapter,
      threadRuntime: externalStoreThreadRuntime(store, {
        onNew: async () => {},
      }),
    });
    onTestFinished(created.dispose);
    capture.runtime = created.runtime;
    await vi.waitFor(() => {
      expect(capture.runtime?.threads.mainItem.getState().id).toBeDefined();
    });

    void getThreadCore(capture.runtime!).append(userMessage("hello"));
    await vi.waitFor(() => {
      expect(adapter.initialize).toHaveBeenCalledTimes(1);
    });

    await act(async () => {});
    expect(generateTitle).not.toHaveBeenCalled();

    await act(async () => {
      store.set([{ role: "user", content: [{ type: "text", text: "hello" }] }]);
    });

    await vi.waitFor(() => {
      expect(generateTitle).toHaveBeenCalledTimes(1);
    });
    const titleCall = generateTitle.mock.calls[0];
    if (titleCall === undefined) throw new Error("Expected title generation");
    const [, titledMessages] = titleCall;
    expect(titledMessages).toHaveLength(1);
    expect(titledMessages[0]).toMatchObject({ role: "user" });
  });

  it("titles a new thread that another caller initialized first", async () => {
    const generateTitle = vi.fn<RemoteThreadListAdapter["generateTitle"]>(
      async () => new ReadableStream(),
    );
    const adapter = makeAdapter({ generateTitle });
    const runtimeRef: { current: AssistantRuntime | null } = { current: null };

    const created = createRemoteThreadListRuntime({
      adapter,
      threadRuntime: localThreadRuntime({ run: async () => ({ content: [] }) }),
    });
    onTestFinished(created.dispose);
    runtimeRef.current = created.runtime;
    await vi.waitFor(() => {
      expect(runtimeRef.current?.threads.mainItem.getState().id).toBeDefined();
    });

    await act(async () => {
      await runtimeRef.current!.threads.mainItem.initialize();
    });
    void getThreadCore(runtimeRef.current!).append(userMessage("hello"));

    await vi.waitFor(() => {
      expect(generateTitle).toHaveBeenCalledTimes(1);
    });
    expect(adapter.initialize).toHaveBeenCalledTimes(1);
  });

  it("reports title generation failures", async () => {
    const error = new Error("title unavailable");
    const adapter = makeAdapter({
      generateTitle: vi.fn(async () => {
        throw error;
      }),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const runtimeRef: { current: AssistantRuntime | null } = { current: null };

    const created = createRemoteThreadListRuntime({
      adapter,
      threadRuntime: localThreadRuntime({ run: async () => ({ content: [] }) }),
    });
    onTestFinished(created.dispose);
    runtimeRef.current = created.runtime;
    await vi.waitFor(() => {
      expect(runtimeRef.current?.threads.mainItem.getState().id).toBeDefined();
    });

    void getThreadCore(runtimeRef.current!).append(userMessage("hello"));

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "[ngx-assistant] Thread title generation failed",
        error,
      );
    });
    expect(adapter.generateTitle).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("titles a new thread whose runtime restarts while it initializes", async () => {
    const initialization = deferred<{
      remoteId: string;
      externalId: string;
    }>();
    const generateTitle = vi.fn<RemoteThreadListAdapter["generateTitle"]>(
      async () => new ReadableStream(),
    );
    const adapter = makeAdapter({
      initialize: vi.fn(() => initialization.promise),
      generateTitle,
    });
    const store = createMessageStore();
    const capture: { runtime: AssistantRuntime | null } = { runtime: null };

    const created = createRemoteThreadListRuntime({
      adapter,
      threadRuntime: externalStoreThreadRuntime(store, {
        onNew: async () => {
          store.set([
            { role: "user", content: [{ type: "text", text: "hello" }] },
          ]);
        },
      }),
    });
    onTestFinished(created.dispose);
    capture.runtime = created.runtime;
    await vi.waitFor(() => {
      expect(capture.runtime?.threads.mainItem.getState().id).toBeDefined();
    });
    const localId = capture.runtime!.threads.mainItem.getState().id;

    await act(async () => {
      void getThreadCore(capture.runtime!).append(userMessage("hello"));
    });
    await vi.waitFor(() => {
      expect(adapter.initialize).toHaveBeenCalledTimes(1);
    });

    await actSettled(() => capture.runtime!.threads.reloadMainThread());

    await act(async () => {
      initialization.resolve({
        remoteId: `remote-${localId}`,
        externalId: `external-${localId}`,
      });
    });

    await vi.waitFor(() => {
      expect(generateTitle).toHaveBeenCalledTimes(1);
    });
    expect(generateTitle).toHaveBeenCalledWith(`remote-${localId}`, [
      expect.objectContaining({ role: "user" }),
    ]);
    await act(async () => {});
    expect(generateTitle).toHaveBeenCalledTimes(1);
  });

  it("retains the first title source through a runtime restart", async () => {
    const initialization = deferred<{
      remoteId: string;
      externalId: string;
    }>();
    const generateTitle = vi.fn<RemoteThreadListAdapter["generateTitle"]>(
      async () => new ReadableStream(),
    );
    const adapter = makeAdapter({
      initialize: vi.fn(() => initialization.promise),
      generateTitle,
    });
    const runtimeRef: { current: AssistantRuntime | null } = { current: null };

    const created = createRemoteThreadListRuntime({
      adapter,
      threadRuntime: localThreadRuntime({ run: async () => ({ content: [] }) }),
    });
    onTestFinished(created.dispose);
    runtimeRef.current = created.runtime;
    await vi.waitFor(() => {
      expect(runtimeRef.current?.threads.mainItem.getState().id).toBeDefined();
    });
    const localId = runtimeRef.current!.threads.mainItem.getState().id;

    await act(async () => {
      void getThreadCore(runtimeRef.current!).append(userMessage("hello"));
    });
    await vi.waitFor(() => {
      expect(adapter.initialize).toHaveBeenCalledTimes(1);
    });

    await actSettled(() => runtimeRef.current!.threads.reloadMainThread());
    await act(async () => {
      initialization.resolve({
        remoteId: `remote-${localId}`,
        externalId: `external-${localId}`,
      });
    });
    expect(runtimeRef.current!.thread.getState().messages).toHaveLength(0);

    await vi.waitFor(() => {
      expect(generateTitle).toHaveBeenCalledTimes(1);
    });
    expect(generateTitle).toHaveBeenCalledWith(`remote-${localId}`, [
      expect.objectContaining({
        role: "user",
        content: [expect.objectContaining({ type: "text", text: "hello" })],
      }),
    ]);
  });
});
