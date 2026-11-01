import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  // Native window titles.
  "window.localHostTitle": "DeepSeek Bots – Hôte local",
  "window.localClientTitle": "DeepSeek Bots – Client local",
  "window.computerUsePermissionTitle": "Activer Computer Use",
} as const satisfies PartialTranslation<typeof source>;
