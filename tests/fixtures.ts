import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseScreen, type RawSnapshot, type Screen } from "../src/core/screen.ts";

export type FixtureName = "home" | "explore";

/**
 * The fixtures are verbatim `agent-device snapshot --json` output for the
 * sample app, envelope included, so the parser is exercised against the real
 * response shape rather than a hand-written approximation.
 */
export function loadRaw(name: FixtureName): RawSnapshot {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  const envelope: { data: RawSnapshot } = JSON.parse(readFileSync(path, "utf8"));
  return envelope.data;
}

export function loadScreen(name: FixtureName): Screen {
  return parseScreen(loadRaw(name), "ios");
}
