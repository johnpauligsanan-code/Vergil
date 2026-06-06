/**
 * Void Slash implementation for Vergil Yamato
 * Target: Bedrock v26.23
 *
 * This script listens for the player using the vergil:yamato item while sneaking
 * and spawns a short-lived "vergil:void_slash" entity in front of the player.
 * The slash damages and launches nearby non-player entities, plays particles
 * and a sound, and expires shortly after spawning.
 *
 * Requirements:
 * - The behavior pack manifest must include a scripting module pointing at "scripts/index.js"
 * - Experimental scripting/GameTest must be enabled in the world
 *
 * Tunables:
 *  - COOLDOWN_MS (not used since you requested no concentration/cooldown)
 *  - SLASH_DAMAGE
 *  - SLASH_SPEED (not used for physics-based motion; we approximate via periodic damage around the slash entity)
 *  - SLASH_LIFETIME_MS
 */

import { world, system } from "mojang-minecraft";

const YAMATO_ID = "vergil:yamato"; // confirmed identifier
// Tunables
const SLASH_DAMAGE = 9; // damage done to entities
const SLASH_LIFETIME_MS = 300; // how long the slash exists (ms)
const SLASH_AABB_RADIUS = 1.25; // radius to detect hits around the slash

// There is no concentration / cooldown per user request.

function nowMs() {
  return Date.now();
}

// Subscribe to item use events (prefer beforeItemUse if available so we can cancel default behavior)
if (world.events.beforeItemUse) {
  world.events.beforeItemUse.subscribe(ev => {
    tryHandleUse(ev);
  });
} else if (world.events.itemUse) {
  world.events.itemUse.subscribe(ev => {
    tryHandleUse(ev);
  });
} else {
  console.warn("No itemUse/beforeItemUse event available in this environment.");
}

function tryHandleUse(ev) {
  try {
    const player = ev.source;
    const item = ev.item;
    if (!player || !item) return;
    if (item.id !== YAMATO_ID) return;

    // require sneaking (crouch + use)
    const sneaking = (typeof player.isSneaking === "boolean") ? player.isSneaking : false;
    if (!sneaking) return;

    // cancel base item use if possible
    if (typeof ev.cancel !== "undefined") ev.cancel = true;

    const dim = player.dimension;
    // player's eye position approximation
    const eyePos = { x: player.location.x, y: player.location.y + 1.0, z: player.location.z };
    // derive look vector if method exists
    const look = (typeof player.getViewDirection === "function") ? player.getViewDirection() : { x: 0, y: 0, z: 1 };
    const spawnPos = { x: eyePos.x + look.x * 1.2, y: eyePos.y + look.y * 0.1, z: eyePos.z + look.z * 1.2 };

    // spawn the slash entity
    let slashEntity = null;
    try {
      slashEntity = dim.spawnEntity("vergil:void_slash", spawnPos);
    } catch (e) {
      // fallback to command summon if API spawnEntity isn't available
      try {
        dim.runCommand(`summon vergil:void_slash ${spawnPos.x} ${spawnPos.y} ${spawnPos.z}`);
      } catch (cmdErr) {
        console.warn("Failed to spawn vergil:void_slash:", cmdErr);
      }
    }

    // play particle and sound at spawn
    try {
      dim.runCommand(`particle minecraft:spell ${spawnPos.x} ${spawnPos.y} ${spawnPos.z} 0.5 0.5 0.5 0.02 12`);
      dim.runCommand(`playsound random.explode @s ${spawnPos.x} ${spawnPos.y} ${spawnPos.z}`);
    } catch (e) { /* non-fatal */ }

    // run a short interval to damage nearby entities around the nearest slash entity
    const start = nowMs();
    const interval = system.runInterval(() => {
      const elapsed = nowMs() - start;
      if (elapsed > SLASH_LIFETIME_MS) {
        // remove slash entities spawned near spawnPos to clean up
        try {
          dim.runCommand(`kill @e[type=vergil:void_slash, x=${spawnPos.x}, y=${spawnPos.y}, z=${spawnPos.z}, r=2]`);
        } catch (e) {}
        interval.cancel();
        return;
      }

      // Damage non-player entities within radius using execute/damage
      try {
        // Damage up to 10 entities in radius around the slash
        dim.runCommand(`execute at @e[type=vergil:void_slash,sort=nearest,limit=1] run damage @e[distance=..${SLASH_AABB_RADIUS},type=!player,limit=10] ${SLASH_DAMAGE}`);
        // Apply a simple knock-up teleport to approximate upward launch
        dim.runCommand(`execute at @e[type=vergil:void_slash,sort=nearest,limit=1] run tp @e[distance=..${SLASH_AABB_RADIUS},type=!player,limit=10] ~ ~0.6 ~`);
      } catch (e) {
        // commands may fail in some environments — non-fatal
      }
    }, 1);

    // schedule a final cleanup in case the interval missed
    system.runTimeout(() => {
      try {
        dim.runCommand(`kill @e[type=vergil:void_slash, x=${spawnPos.x}, y=${spawnPos.y}, z=${spawnPos.z}, r=2]`);
      } catch (e) {}
    }, SLASH_LIFETIME_MS + 50);

  } catch (outer) {
    console.error("Error in tryHandleUse:", outer);
  }
}
