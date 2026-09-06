import type { ActionSink } from "./report.ts";
import { renderScreen } from "./screen.ts";
import type { DeviceSession } from "./session.ts";

/**
 * Attaches `screen.png` and `screen.txt` through the sink.
 *
 * Never throws. A capture that fails records a note and returns, because
 * masking the test's real error with a screenshot error is worse than having
 * no screenshot. `screen.txt` is rendered by `renderScreen`, the same function
 * that builds the listing inside a failure message.
 */
export async function captureEvidence(session: DeviceSession, sink: ActionSink): Promise<void> {
  try {
    const path = await session.screenshot(sink.outputPath("screen.png"));
    await sink.attach({ name: "screen.png", path, contentType: "image/png" });
  } catch (error) {
    sink.note("evidence", `screenshot failed: ${messageOf(error)}`);
  }
  try {
    const screen = await session.screen();
    await sink.attach({
      name: "screen.txt",
      body: renderScreen(screen),
      contentType: "text/plain",
    });
  } catch (error) {
    sink.note("evidence", `screen listing failed: ${messageOf(error)}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
