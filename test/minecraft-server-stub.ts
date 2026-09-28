/**
 * Runtime stub so public-repo Vitest can resolve `@minecraft/server`.
 */
type Callback = () => void;

type Scheduled = {
  id: number;
  kind: "run" | "runTimeout" | "runInterval";
  callback: Callback;
  intervalTicks: number;
  nextDueTick: number;
  cancelled: boolean;
};

type Emitter = {
  subscribe(callback: (event: unknown) => void): (event: unknown) => void;
  unsubscribe(callback: (event: unknown) => void): void;
  __dispatch(event: unknown): void;
};

/** Types-only stand-in so Vitest can resolve the specifier. */
export class ItemStack {
  constructor(
    readonly typeId: string,
    readonly amount = 1,
  ) {}
  getTags(): string[] {
    return [];
  }
}

let fakeBlockTypes: { id: string }[] = [];
let fakeItemTypes: { id: string }[] = [];
let fakeEntityTypes: { id: string }[] = [];
let fakeGenerateLootFromBlockType: (blockTypeId: string, toolTypeId: string | undefined) => ItemStack[] | undefined =
  () => undefined;
let fakeGenerateLootFromEntityType: (entityTypeId: string, toolTypeId: string | undefined) => ItemStack[] | undefined =
  () => undefined;

function resetFakeTypeCatalogs(): void {
  fakeBlockTypes = [];
  fakeItemTypes = [];
  fakeEntityTypes = [];
}

function resetFakeLootGenerate(): void {
  fakeGenerateLootFromBlockType = () => undefined;
  fakeGenerateLootFromEntityType = () => undefined;
}

/** Test-only: `generateLootFromBlockType` / `generateLootFromEntityType` return values. */
export function setFakeGenerateLoot(hooks: {
  fromBlock?: (blockTypeId: string, toolTypeId: string | undefined) => ItemStack[] | undefined;
  fromEntity?: (entityTypeId: string, toolTypeId: string | undefined) => ItemStack[] | undefined;
}): void {
  if (hooks.fromBlock !== undefined) fakeGenerateLootFromBlockType = hooks.fromBlock;
  if (hooks.fromEntity !== undefined) fakeGenerateLootFromEntityType = hooks.fromEntity;
}

function createEmitter(): Emitter {
  const callbacks = new Set<(event: unknown) => void>();
  return {
    subscribe(callback) {
      callbacks.add(callback);
      return callback;
    },
    unsubscribe(callback) {
      callbacks.delete(callback);
    },
    __dispatch(event) {
      for (const callback of callbacks) callback(event);
    },
  };
}

function createEventBus(): { bus: Record<string, Emitter>; emitters: Map<PropertyKey, Emitter> } {
  const emitters = new Map<PropertyKey, Emitter>();
  const bus = new Proxy(
    {},
    {
      get(_target, prop) {
        let emitter = emitters.get(prop);
        if (!emitter) {
          emitter = createEmitter();
          emitters.set(prop, emitter);
        }
        return emitter;
      },
    },
  ) as Record<string, Emitter>;
  return { bus, emitters };
}

function createFakeSystem() {
  let nextId = 1;
  let currentTick = 0;
  const jobs = new Map<number, Scheduled>();
  const afterEventsBus = createEventBus();

  function schedule(kind: Scheduled["kind"], callback: Callback, delayTicks: number): number {
    const id = nextId++;
    jobs.set(id, {
      id,
      kind,
      callback,
      intervalTicks: delayTicks,
      nextDueTick: currentTick + delayTicks,
      cancelled: false,
    });
    return id;
  }

  return {
    run(callback: Callback) {
      return schedule("run", callback, 1);
    },
    runTimeout(callback: Callback, tickDelay = 1) {
      return schedule("runTimeout", callback, tickDelay);
    },
    runInterval(callback: Callback, tickInterval = 1) {
      return schedule("runInterval", callback, tickInterval);
    },
    runJob(generator: Generator<void, void, void>) {
      const id = nextId++;
      const pump = () => {
        const job = jobs.get(id);
        if (job?.cancelled) {
          jobs.delete(id);
          return;
        }
        const result = generator.next();
        if (result.done) {
          jobs.delete(id);
          return;
        }
        jobs.set(id, {
          id,
          kind: "runTimeout",
          callback: pump,
          intervalTicks: 1,
          nextDueTick: currentTick + 1,
          cancelled: false,
        });
      };
      jobs.set(id, {
        id,
        kind: "runTimeout",
        callback: pump,
        intervalTicks: 1,
        nextDueTick: currentTick,
        cancelled: false,
      });
      pump();
      return id;
    },
    clearRun(id: number) {
      const job = jobs.get(id);
      if (job) job.cancelled = true;
    },
    clearJob(jobId: number) {
      const job = jobs.get(jobId);
      if (job) job.cancelled = true;
    },
    sendScriptEvent(id: string, message: string) {
      afterEventsBus.bus.scriptEventReceive.__dispatch({ id, message });
    },
    afterEvents: afterEventsBus.bus,
    get currentTick() {
      return currentTick;
    },
    __tick(ticks = 1) {
      for (let step = 0; step < ticks; step++) {
        currentTick++;
        for (const job of [...jobs.values()]) {
          if (job.cancelled || job.nextDueTick > currentTick) continue;
          if (job.kind === "runInterval") {
            job.nextDueTick = currentTick + job.intervalTicks;
          } else {
            jobs.delete(job.id);
          }
          job.callback();
        }
      }
    },
    _reset() {
      jobs.clear();
      nextId = 1;
      currentTick = 0;
      afterEventsBus.emitters.clear();
    },
  };
}

function createFakeWorld() {
  const props = new Map<string, string | number | boolean>();
  return {
    getDynamicProperty(id: string) {
      return props.get(id);
    },
    setDynamicProperty(id: string, value: string | number | boolean | undefined) {
      if (value === undefined) props.delete(id);
      else props.set(id, value);
    },
    getDynamicPropertyIds() {
      return [...props.keys()];
    },
    sendMessage(_message: unknown) {},
    getLootTableManager() {
      return {
        getLootTable(_path: string) {
          return undefined;
        },
        generateLootFromBlockType(scriptBlockType: { id: string }, tool?: ItemStack) {
          return fakeGenerateLootFromBlockType(scriptBlockType.id, tool?.typeId);
        },
        generateLootFromEntityType(entityType: { id: string }, tool?: ItemStack) {
          return fakeGenerateLootFromEntityType(entityType.id, tool?.typeId);
        },
      };
    },
    _reset() {
      props.clear();
    },
  };
}

/** Shared fake `system` for aliased `@minecraft/server` imports. */
export const system = createFakeSystem();

/** Shared fake `world` for aliased `@minecraft/server` imports. */
export const world = createFakeWorld();

/** Clears scheduled jobs, world DPs, and loot/type catalogs. */
export function resetMinecraftServerFake(): void {
  system._reset();
  world._reset();
  resetFakeTypeCatalogs();
  resetFakeLootGenerate();
}

/** Minimal `BlockPermutation.resolve` for the engine dump. */
export const BlockPermutation = {
  resolve(typeId: string) {
    return { type: { id: typeId }, getTags: () => [] as string[] };
  },
};

/** Minimal `BlockTypes`. */
export const BlockTypes = {
  get(typeId: string) {
    return fakeBlockTypes.find((row) => row.id === typeId) ?? { id: typeId };
  },
  getAll() {
    return [...fakeBlockTypes];
  },
  _setAll(ids: readonly string[]): void {
    fakeBlockTypes = ids.map((id) => ({ id }));
  },
};

/** Minimal `ItemTypes`. */
export const ItemTypes = {
  get(itemId: string) {
    return fakeItemTypes.find((row) => row.id === itemId) ?? { id: itemId };
  },
  getAll() {
    return [...fakeItemTypes];
  },
  _setAll(ids: readonly string[]): void {
    fakeItemTypes = ids.map((id) => ({ id }));
  },
};

/** Minimal `EntityTypes`. */
export const EntityTypes = {
  get(identifier: string) {
    return fakeEntityTypes.find((row) => row.id === identifier) ?? { id: identifier };
  },
  getAll() {
    return [...fakeEntityTypes];
  },
  _setAll(ids: readonly string[]): void {
    fakeEntityTypes = ids.map((id) => ({ id }));
  },
};
