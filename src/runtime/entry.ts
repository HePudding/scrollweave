import { mountPage } from "./render";
import type { Project } from "../core/model";
declare global {
  interface Window {
    ScrollWeave: ReturnType<typeof mountPage>;
    __SW_PROJECT__: Project;
    __SW_ERRORS__: string[];
  }
}
window.__SW_ERRORS__ = [];
window.addEventListener("error", (e) => window.__SW_ERRORS__.push(e.message));
const project = JSON.parse(
  document.getElementById("sw-project")!.textContent!,
) as Project;
window.__SW_PROJECT__ = project;
let sent = 0;
window.ScrollWeave = mountPage(
  document.getElementById("sw-root")!,
  project,
  (position) => {
    if (window.parent !== window && performance.now() - sent > 70) {
      sent = performance.now();
      window.parent.postMessage(
        { type: "scrollweave:progress", position },
        "*",
      );
    }
  },
);
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || window.parent === window) return;
  if (event.data?.type === "scrollweave:seek")
    window.ScrollWeave.seek(event.data.progress, event.data.sectionId, true);
  if (
    event.data?.type === "scrollweave:mode" &&
    ["exact", "smooth"].includes(event.data.mode)
  )
    window.ScrollWeave.setMode(event.data.mode);
});
