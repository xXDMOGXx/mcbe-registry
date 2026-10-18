/**
 * Dump scriptevent attach, compiled in only when `MCBAB_REGISTRY_DUMP=1`.
 */
export function maybeAttachVanillaEngineDump(): void {
  if (process.env.MCBAB_REGISTRY_DUMP === "1") {
    void import("./vanillaEngineDump.js").then((mod) => {
      mod.attachVanillaEngineDump();
    });
  }
}
