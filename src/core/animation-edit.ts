import {
  properties,
  uid,
  type Project,
  type Element,
  type AnimProperty,
  type Keyframe,
} from "./model";
import { parentTime, sampleElement } from "./evaluate";
import type { Command } from "./commands";

function setKey(
  compositionId: string,
  element: Element,
  property: AnimProperty,
  at: number,
  value: number,
): Command {
  const keys = element.tracks[property] ?? [];
  const existing = keys.find((k) => Math.abs(k.at - at) < 1e-5);
  const before = keys.filter((k) => k.at < at).at(-1);
  return {
    type: "keyframe.set",
    compositionId,
    elementId: element.id,
    property,
    keyframe: {
      id: existing?.id ?? uid("key"),
      at: existing?.at ?? at,
      value,
      easing: existing?.easing ?? before?.easing ?? "easeInOut",
    },
  };
}
export function addPropertyKeys(
  project: Project,
  cid: string,
  element: Element,
  time: number,
  channels: AnimProperty[],
): Command[] {
  const sample = sampleElement(
    element,
    parentTime(project, cid, element, time),
  );
  const at = Math.round(sample.progress * 100000) / 100000;
  return channels.map((property) =>
    setKey(cid, element, property, at, sample[property]),
  );
}
export function propertyCommands(
  project: Project,
  compositionId: string,
  element: Element,
  time: number,
  values: Partial<Element>,
  autoKey: boolean,
): Command[] {
  const patch: Partial<Element> = {},
    commands: Command[] = [];
  const sample = sampleElement(
    element,
    parentTime(project, compositionId, element, time),
  );
  const at = Math.round(sample.progress * 100000) / 100000;
  const positionAnimated = !!(
    element.tracks.x?.length || element.tracks.y?.length
  );
  const edits = { ...values };
  if (
    (values.x !== undefined || values.y !== undefined) &&
    (autoKey || positionAnimated)
  ) {
    edits.x ??= sample.x;
    edits.y ??= sample.y;
  }
  for (const [name, value] of Object.entries(edits)) {
    const property = name as AnimProperty;
    if (
      properties.includes(property) &&
      (autoKey ||
        element.tracks[property]?.length ||
        ((property === "x" || property === "y") && positionAnimated))
    ) {
      // The first automatic edit later in a clip must retain its initial pose.
      if (!element.tracks[property]?.length && at > element.sourceIn + 1e-5)
        commands.push(
          setKey(
            compositionId,
            element,
            property,
            element.sourceIn,
            element[property],
          ),
        );
      commands.push(
        setKey(compositionId, element, property, at, Number(value)),
      );
    } else Object.assign(patch, { [name]: value });
  }
  if (Object.keys(patch).length)
    commands.push({
      type: "element.update",
      compositionId,
      elementId: element.id,
      patch,
    });
  return commands;
}
/** Matching position keys move/delete together; unrelated channels stay independent. */
export function pairedKeys(
  element: Element,
  property: AnimProperty,
  key: Keyframe,
) {
  const result = [{ property, key }];
  const other = property === "x" ? "y" : property === "y" ? "x" : undefined;
  const paired =
    other && element.tracks[other]?.find((k) => Math.abs(k.at - key.at) < 1e-5);
  if (paired && other) result.push({ property: other, key: paired });
  return result;
}
