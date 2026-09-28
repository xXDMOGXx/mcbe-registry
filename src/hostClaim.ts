import { EVENT } from "./protocol.js";
import type { Transport } from "./transport.js";

/**
 * World DP written after a host wins election (reload hint, not the lock).
 */
export const HOST_CLAIM_PROPERTY = "bedrockregistry:host_claim";

/** Claimant id of the standalone Bedrock Registry pack. */
export const STANDALONE_HOST_CLAIMANT = "bedrockregistry";

/** Script-event id for host election announcements. */
export const HOST_CLAIM_EVENT = EVENT.claim;

/** Ticks from election start until the winner is chosen. */
export const HOST_ELECTION_TICKS = 2;

/** Tick delay before sending this pack's claim announcement. */
const HOST_CLAIM_SEND_TICKS = 1;

/**
 * Winner among announced claimant ids. Standalone `bedrockregistry` wins when
 * present; otherwise the lexicographically first id.
 */
export function electHost(heard: ReadonlySet<string>): string | undefined {
  if (heard.size === 0) return undefined;
  if (heard.has(STANDALONE_HOST_CLAIMANT)) return STANDALONE_HOST_CLAIMANT;
  let winner: string | undefined;
  for (const id of heard) {
    if (winner === undefined || id < winner) winner = id;
  }
  return winner;
}

/** Claimant id from a `bedrockregistry:claim` body, or undefined if invalid. */
export function claimantFromMessage(message: string): string | undefined {
  try {
    const parsed = JSON.parse(message) as { claimant?: unknown };
    if (typeof parsed.claimant === "string" && parsed.claimant.length > 0) return parsed.claimant;
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Announces this claimant, then calls `onElected` only if this pack wins.
 */
export function runHostElection(options: {
  transport: Transport;
  claimant: string;
  onElected: () => void;
}): void {
  const heard = new Set<string>([options.claimant]);
  const unsub = options.transport.onEvent((id, message) => {
    if (id !== HOST_CLAIM_EVENT) return;
    const claimant = claimantFromMessage(message);
    if (claimant) heard.add(claimant);
  });
  options.transport.runTimeout(() => {
    options.transport.send(HOST_CLAIM_EVENT, JSON.stringify({ claimant: options.claimant }));
  }, HOST_CLAIM_SEND_TICKS);
  options.transport.runTimeout(() => {
    unsub();
    if (electHost(heard) === options.claimant) options.onElected();
  }, HOST_ELECTION_TICKS);
}
