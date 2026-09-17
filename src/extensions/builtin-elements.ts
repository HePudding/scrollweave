import { registerElement } from "./registry";
registerElement({
  id: "badge",
  create(element, doc) {
    const node = doc.createElement("div");
    node.textContent = String(element.customData.label ?? "OPEN SOURCE");
    node.style.cssText =
      "border:2px solid currentColor;border-radius:999px;padding:14px 28px;display:inline-block;font:500 24px system-ui;letter-spacing:3px";
    return node;
  },
});
