/** Injected script-event transport: no `@minecraft/server` import in this module. */
export interface Transport {
  send: (id: string, message: string) => void;
  onEvent: (handler: (id: string, message: string) => void) => () => void;
  /** Schedules `callback` after `ticks` (Bedrock `system.runTimeout`). Returns a cancel function. */
  runTimeout: (callback: () => void, ticks: number) => () => void;
}

/** Structural slice of `system` used to build a {@link Transport}. */
export interface ScriptEventSystem {
  sendScriptEvent(id: string, message: string): void;
  runTimeout(callback: () => void, tickDelay?: number): number;
  clearRun(id: number): void;
  afterEvents: {
    scriptEventReceive: {
      subscribe(callback: (event: { id: string; message: string }) => void): unknown;
      unsubscribe(callback: unknown): void;
    };
  };
}

/** `send` / `onEvent` / tick-timeout adapter over a Bedrock `system`. */
export function transportFromSystem(system: ScriptEventSystem): Transport {
  return {
    send(id, message) {
      system.sendScriptEvent(id, message);
    },
    onEvent(handler) {
      const callback = (event: { id: string; message: string }) => handler(event.id, event.message);
      system.afterEvents.scriptEventReceive.subscribe(callback);
      return () => system.afterEvents.scriptEventReceive.unsubscribe(callback);
    },
    runTimeout(callback, ticks) {
      const id = system.runTimeout(callback, ticks);
      return () => system.clearRun(id);
    },
  };
}
