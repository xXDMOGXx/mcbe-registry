import { stringifyEnvelope } from "./compactJson.js";
import { EVENT } from "./protocol.js";
import { PROTOCOL_SCHEMA } from "@mcbe-registry/client";

/** Host-side send: event id plus compact JSON. */
export type HostSend = (id: string, message: string) => void;

/** JSON discovery host: `hello` → `ready` and `broadcastReady` only. */
export interface RegistryHost {
  /** Handles one inbound script-event. Data-op ids are ignored. */
  onEvent(id: string, message: string): void;
  /** Broadcasts `bedrockregistry:ready`. */
  broadcastReady(): void;
}

/** Discovery-only JSON host (`hello` / `ready`). Catalog data ops are schema-5 IPC. */
export function createRegistryHost(options: {
  send: HostSend;
  /** Vanilla snapshot Minecraft version announced on `ready`. */
  minecraft?: string;
}): RegistryHost {
  const readyBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = { v: PROTOCOL_SCHEMA, schema: PROTOCOL_SCHEMA };
    if (options.minecraft !== undefined) body.minecraft = options.minecraft;
    return body;
  };

  return {
    onEvent(id) {
      if (id === EVENT.hello) {
        options.send(EVENT.ready, stringifyEnvelope(readyBody()));
      }
    },
    broadcastReady() {
      options.send(EVENT.ready, stringifyEnvelope(readyBody()));
    },
  };
}
