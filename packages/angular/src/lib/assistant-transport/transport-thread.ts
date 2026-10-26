import { DestroyRef, effect, inject, isSignal, untracked } from '@angular/core';
import {
  createRequestHeaders,
  generateId,
  raceWithAbortSignal,
  type AddToolResultOptions,
  type AppendMessage,
  type AssistantRuntime,
  type ExternalStoreAdapter,
  type ThreadListItemRuntime,
  type ThreadMessage,
  type ToolExecutionStatus,
} from '@ngx-assistant/engine';
import {
  AssistantMessageAccumulator,
  AssistantTransportDecoder,
  DataStreamDecoder,
  toToolsJSONSchema,
  unstable_createInitialMessage as createInitialMessage,
} from 'assistant-stream';
import {
  asAsyncIterableStream,
  type ReadonlyJSONObject,
  type ReadonlyJSONValue,
} from 'assistant-stream/utils';
import { createExternalStoreAssistantRuntime } from '../create-external-store-runtime';
import { CommandQueue } from './command-queue';
import { RenderWait, createReplayBoundaryStream } from './replay-boundary-stream';
import { RunManager } from './run-manager';
import { provideTransportExtras } from './transport-extras';
import type {
  AddMessageCommand,
  AddToolResultCommand,
  AssistantTransportCommand,
  AssistantTransportOptions,
  AssistantTransportState,
  CommandQueueState,
  SendCommandsRequestBody,
  UserMessagePart,
} from './types';

const convertAppendMessageToCommand = (message: AppendMessage): AddMessageCommand | null => {
  if (message.role !== 'user') throw new Error('Only user messages are supported');

  const parts: UserMessagePart[] = [];
  const content = [
    ...message.content,
    ...(message.attachments?.flatMap((attachment) => attachment.content) ?? []),
  ];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
    } else if (part.type === 'image') {
      parts.push({ type: 'image', image: part.image });
    }
  }

  if (parts.length === 0) return null;

  return {
    type: 'add-message',
    message: { role: 'user', id: generateId(), parts },
    parentId: message.parentId,
    sourceId: message.sourceId,
  };
};

const readResumeState = async <T>(
  response: Response,
): Promise<{ runId: string; state: T } | null> => {
  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(
      `Resume state request failed with status ${response.status}: ${await response.text()}`,
    );
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Resume state response was not valid JSON');
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    !('state' in value) ||
    !('runId' in value) ||
    typeof value.runId !== 'string'
  ) {
    throw new Error('Resume state response must contain state and runId');
  }

  return { runId: value.runId, state: value.state as T };
};

/** Marks the messages of user commands not yet confirmed by the server as optimistic. */
const markOptimistic = (
  messages: readonly ThreadMessage[],
  pendingCommands: readonly AssistantTransportCommand[],
): readonly ThreadMessage[] => {
  const pendingIds = new Set(
    pendingCommands.flatMap((command) =>
      command.type === 'add-message' && command.message.role === 'user' ? [command.message.id] : [],
    ),
  );
  if (!messages.some((message) => pendingIds.has(message.id))) return messages;
  return messages.map((message) =>
    pendingIds.has(message.id)
      ? ({
          ...message,
          metadata: { ...message.metadata, isOptimistic: true },
        } as ThreadMessage)
      : message,
  );
};

/**
 * Creates the runtime of one assistant transport thread and ties it to the current injector, which
 * must hold the thread's list item. Not part of the public API.
 *
 * The agent state, the command queue and the run state are kept here; each change schedules one
 * new external store adapter for the next microtask, so an engine callback never re-enters the
 * engine and a burst of changes is shown once.
 */
export function createAssistantTransportThreadRuntime<T>(
  options: AssistantTransportOptions<T>,
  item: ThreadListItemRuntime,
): AssistantRuntime {
  let agentState = options.initialState;
  let resumeRequested = false;
  let isReplaying = false;
  let parentId: string | null | undefined;
  let cancelledCommands: AssistantTransportCommand[] = [];
  let toolStatuses: Record<string, ToolExecutionStatus> = {};
  let destroyed = false;

  let publishScheduled = false;
  const schedulePublish = () => {
    if (publishScheduled || destroyed) return;
    publishScheduled = true;
    queueMicrotask(publish);
  };
  const renderWait = new RenderWait(schedulePublish);

  const setReplaying = (value: boolean) => {
    if (isReplaying === value) return;
    isReplaying = value;
    schedulePublish();
  };
  const updateState = (updater: (state: T) => T) => {
    agentState = updater(agentState);
    schedulePublish();
  };

  const commandQueue = new CommandQueue({
    onQueue: () => runManager.schedule(),
    onChange: schedulePublish,
  });

  const enqueueAppendMessage = (message: AppendMessage) => {
    const command = convertAppendMessageToCommand(message);
    if (!command) {
      console.warn('[ngx-assistant] Skipped add-message command with no supported parts');
      return;
    }
    parentId = message.parentId;
    commandQueue.enqueue(command, { schedule: message.startRun ?? message.role === 'user' });
  };

  const sendCommand = (command: AssistantTransportCommand) => {
    commandQueue.enqueue(
      command.type === 'add-message' && command.message.role === 'user'
        ? { ...command, message: { ...command.message, id: command.message.id ?? generateId() } }
        : command,
    );
  };

  const runManager: RunManager = new RunManager({
    onRunningChange: schedulePublish,
    onRun: async (signal) => {
      const isResume = resumeRequested;
      resumeRequested = false;
      setReplaying(false);
      const commands = isResume ? [] : commandQueue.flush();
      if (commands.length === 0 && !isResume) return;

      // The flushed batch consumes the parentId; read it alongside the flush (before any awaits)
      // so a mid-run append keeps its own value. Resume runs send no commands, so they neither
      // send nor consume it.
      const runParentId = isResume ? undefined : parentId;
      if (!isResume) parentId = undefined;

      // Only a thread without a remote id waits for its initialization, and a resume, which
      // reconnects to an existing run, never creates the thread.
      const threadId =
        item.getState().remoteId ??
        (isResume
          ? undefined
          : (await raceWithAbortSignal(signal, () => item.initialize())).remoteId);

      const headers = await raceWithAbortSignal(signal, () =>
        createRequestHeaders(options.headers ?? {}),
      );
      let resumeState: { runId: string; state: T } | undefined;
      if (isResume && options.resumeStateApi) {
        const resumeStateResponse = await fetch(options.resumeStateApi, {
          method: 'POST',
          headers,
          body: JSON.stringify({ threadId }),
          signal,
        });
        const retained = await readResumeState<T>(resumeStateResponse);
        if (retained === null) {
          if (commandQueue.state.queued.length > 0) runManager.schedule();
          return;
        }
        resumeState = retained;
      }

      const bodyValue: object | undefined = await raceWithAbortSignal(signal, () =>
        typeof options.body === 'function' ? options.body() : options.body,
      );
      const context = runtime.thread.getModelContext();

      const sendCommandsBody: SendCommandsRequestBody = {
        commands,
        ...(resumeState === undefined && { state: agentState }),
        system: context.system,
        tools: context.tools ? toToolsJSONSchema(context.tools) : undefined,
        ...(threadId !== undefined && { threadId }),
        ...(runParentId !== undefined && { parentId: runParentId }),
        callSettings: context.callSettings,
        config: context.config,
        // Also spread at the top level, for backends that read `body.modelName` and the like.
        ...context.callSettings,
        ...context.config,
        ...(bodyValue ?? {}),
      };

      let requestBody: Record<string, unknown> = sendCommandsBody;
      const { prepareSendCommandsRequest } = options;
      if (prepareSendCommandsRequest) {
        requestBody = await raceWithAbortSignal(signal, () =>
          prepareSendCommandsRequest(sendCommandsBody),
        );
      }

      if (resumeState !== undefined) {
        // The server replays a resume from the snapshot it retained for this runId. Body overrides
        // and prepare hooks can neither substitute a state nor drop the id the server checks.
        requestBody = { ...requestBody, runId: resumeState.runId };
        delete requestBody['state'];
      }

      const response = await fetch(isResume ? options.resumeApi! : options.api, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal,
      });

      try {
        await raceWithAbortSignal(signal, () => options.onResponse?.(response));
      } catch (error) {
        void response.body?.cancel().catch(() => undefined);
        throw error;
      }

      if (!response.ok) {
        throw new Error(`Status ${response.status}: ${await response.text()}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      if (resumeState !== undefined) {
        agentState = resumeState.state;
        schedulePublish();
      }

      const body = await createReplayBoundaryStream(response, {
        setReplaying,
        waitForRender: () => raceWithAbortSignal(signal, renderWait.wait),
      });

      const protocol = options.protocol ?? 'data-stream';
      // Resume replays a best-effort buffer; always reconcile leniently.
      const strict = isResume ? false : (options.strict ?? true);
      const decoder =
        protocol === 'assistant-transport'
          ? new AssistantTransportDecoder({
              strict,
              maxLineLength: options.maxStreamLineLength,
              maxEventLength: options.maxStreamEventLength,
            })
          : new DataStreamDecoder({ strict, maxLineLength: options.maxStreamLineLength });

      let streamError: string | undefined;
      const stream = body.pipeThrough(decoder).pipeThrough(
        new AssistantMessageAccumulator({
          initialMessage: createInitialMessage({
            unstable_state: (agentState as ReadonlyJSONValue) ?? null,
          }),
          throttle: isResume,
          strict,
          onError: (error) => {
            streamError = error;
          },
        }),
      );

      let markedDelivered = false;
      for await (const chunk of asAsyncIterableStream(stream)) {
        // abort() cannot error a body that has fully arrived.
        if (signal.aborted) throw signal.reason;
        if (chunk.metadata.unstable_state === agentState) continue;

        if (!markedDelivered) {
          commandQueue.markDelivered();
          markedDelivered = true;
        }

        agentState = chunk.metadata.unstable_state as T;
        schedulePublish();
      }

      if (streamError) throw new Error(streamError);

      // A successful run confirms delivery even when no state-changing chunk was observed.
      if (!markedDelivered) commandQueue.markDelivered();

      // Commands that coalesced into this resume run must not starve.
      if (isResume && commandQueue.state.queued.length > 0) runManager.schedule();
    },
    onFinish: options.onFinish,
    onCancel: (afterError) => {
      setReplaying(false);
      const commands = cancelledCommands;
      cancelledCommands = [];
      if (afterError && commands.length === 0) return;
      options.onCancel?.({ commands, updateState });
    },
    onError: async (error) => {
      resumeRequested = false;
      setReplaying(false);
      const inTransit = [...commandQueue.state.inTransit];
      const queued = [...commandQueue.state.queued];

      commandQueue.reset();
      parentId = undefined;

      try {
        await options.onError?.(error, { commands: inTransit, updateState });
      } finally {
        // onError can settle after the injector is gone; nothing is reported then.
        if (!destroyed) options.onCancel?.({ commands: queued, updateState, error });
      }
    },
  });

  // The converter and the optimistic marks are recomputed only when their inputs change, so the
  // messages keep their identity across unrelated updates.
  let pending: { queue: CommandQueueState; commands: AssistantTransportCommand[] } | undefined;
  const pendingCommands = () => {
    const queue = commandQueue.state;
    if (pending?.queue !== queue) {
      pending = { queue, commands: [...queue.inTransit, ...queue.queued] };
    }
    return pending.commands;
  };
  let converted:
    | {
        inputs: readonly unknown[];
        state: AssistantTransportState;
        messages: readonly ThreadMessage[];
      }
    | undefined;
  const convert = () => {
    const commands = pendingCommands();
    const inputs = [agentState, commands, runManager.isRunning, toolStatuses];
    if (!converted || inputs.some((input, i) => !Object.is(input, converted!.inputs[i]))) {
      const state = options.converter(agentState, {
        pendingCommands: commands,
        isSending: runManager.isRunning,
        toolStatuses,
      });
      const messages =
        converted?.state.messages === state.messages && converted.inputs[1] === commands
          ? converted.messages
          : markOptimistic(state.messages, commands);
      converted = { inputs, state, messages };
    }
    return converted;
  };

  const { canResume } = options;
  const readCanResume = () => (isSignal(canResume) ? untracked(canResume) : !!canResume);

  const buildAdapter = (): ExternalStoreAdapter => {
    const { state, messages } = convert();
    return {
      messages,
      state: state.state,
      isRunning: state.isRunning,
      canResume: readCanResume() && !!options.resumeApi && !runManager.isRunning,
      isLoading: isReplaying,
      adapters: options.adapters,
      unstable_enableToolInvocations: true,
      setToolStatuses: (statuses) => {
        toolStatuses = statuses;
        schedulePublish();
      },
      extras: provideTransportExtras({ sendCommand, state: agentState }),
      onNew: async (message) => enqueueAppendMessage(message),
      ...(options.capabilities?.edit && {
        onEdit: async (message: AppendMessage) => enqueueAppendMessage(message),
      }),
      ...(commandQueue.state.queued.length > 0 && {
        onReload: async (reloadParentId: string | null) => {
          parentId = reloadParentId;
          runManager.schedule();
        },
      }),
      onCancel: async () => {
        resumeRequested = false;
        if (!runManager.cancel()) return;
        const { inTransit, queued } = commandQueue.state;
        cancelledCommands.push(...inTransit, ...queued);
        commandQueue.reset();
        parentId = undefined;
      },
      onResume: async () => {
        if (!options.resumeApi) throw new Error('Must pass resumeApi to options to resume runs');
        resumeRequested = true;
        runManager.schedule();
      },
      onAddToolResult: async (tool: AddToolResultOptions) => {
        const command: AddToolResultCommand = {
          type: 'add-tool-result',
          toolCallId: tool.toolCallId,
          result: tool.result as ReadonlyJSONObject,
          toolName: tool.toolName,
          isError: tool.isError,
          ...(tool.artifact !== undefined && { artifact: tool.artifact }),
          ...(tool.modelContent !== undefined && { modelContent: tool.modelContent }),
        };
        commandQueue.enqueue(command);
      },
      onLoadExternalState: async (state) => {
        agentState = state as T;
        schedulePublish();
      },
    };
  };

  const { runtime, setAdapter } = createExternalStoreAssistantRuntime(buildAdapter());

  function publish() {
    publishScheduled = false;
    if (destroyed) return;
    try {
      setAdapter(buildAdapter());
    } finally {
      // A converter that throws must not leave a replay waiting for this update.
      renderWait.rendered();
    }
  }

  if (isSignal(canResume)) {
    effect(() => {
      canResume();
      untracked(schedulePublish);
    });
  }

  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    runManager.dispose();
    renderWait.dispose();
  });

  return runtime;
}
