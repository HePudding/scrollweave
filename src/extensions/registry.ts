import type { Element, Project } from "../core/model";
import type { Command } from "../core/commands";
export interface PresetContext {
  project: Project;
  compositionId: string;
  elementId?: string;
  options: Record<string, string | number>;
}
export interface Preset {
  id: string;
  name: string;
  description: string;
  build(context: PresetContext): Command[];
}
export interface CustomElement {
  id: string;
  create(element: Element, document: Document): HTMLElement;
  update?(node: HTMLElement, element: Element, progress: number): void;
}
export interface ExportAdapter {
  id: string;
  name: string;
  extension: string;
  export(project: Project): Promise<string>;
}
export const presets = new Map<string, Preset>();
export const customElements = new Map<string, CustomElement>();
export const exportAdapters = new Map<string, ExportAdapter>();
export function registerPreset(preset: Preset) {
  if (presets.has(preset.id)) throw new Error(`重复预制: ${preset.id}`);
  presets.set(preset.id, preset);
}
export function registerElement(element: CustomElement) {
  if (customElements.has(element.id))
    throw new Error(`重复元素: ${element.id}`);
  customElements.set(element.id, element);
}
export function registerExporter(adapter: ExportAdapter) {
  if (exportAdapters.has(adapter.id))
    throw new Error(`重复导出适配器: ${adapter.id}`);
  exportAdapters.set(adapter.id, adapter);
}
