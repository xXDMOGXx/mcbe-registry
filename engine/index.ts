import { system, world } from "@minecraft/server";
import {
  HOST_CLAIM_PROPERTY,
  STANDALONE_HOST_CLAIMANT,
  runHostElection,
} from "../src/hostClaim.js";
import { transportFromSystem } from "../src/transport.js";
import { startBedrockRegistryHost } from "./host.js";

system.run(() => {
  runHostElection({
    transport: transportFromSystem(system),
    claimant: STANDALONE_HOST_CLAIMANT,
    onElected() {
      world.setDynamicProperty(HOST_CLAIM_PROPERTY, STANDALONE_HOST_CLAIMANT);
      startBedrockRegistryHost();
    },
  });
});
