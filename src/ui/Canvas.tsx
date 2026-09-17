import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Moveable from "react-moveable";
import { mountStage } from "../runtime/render";
import { sampleElement } from "../core/evaluate";
import {
  properties,
  uid,
  type Project,
  type Element,
  type AnimProperty,
} from "../core/model";
import type { Command } from "../core/commands";

export function parentProgress(
  project: Project,
  cid: string,
  element: Element,
  progress: number,
): number {
  if (!element.parentId) return progress;
  const parent = project.compositions[cid].elements.find(
    (e) => e.id === element.parentId,
  )!;
  return sampleElement(parent, parentProgress(project, cid, parent, progress))
    .progress;
}
export function propertyCommands(
  project: Project,
  compositionId: string,
  element: Element,
  progress: number,
  values: Partial<Element>,
  autoKey: boolean,
): Command[] {
  const patch: Partial<Element> = {};
  const commands: Command[] = [];
  const at =
    Math.round(
      sampleElement(
        element,
        parentProgress(project, compositionId, element, progress),
      ).progress * 100000,
    ) / 100000;
  for (const [name, value] of Object.entries(values)) {
    const prop = name as AnimProperty;
    if (
      properties.includes(prop) &&
      (autoKey || element.tracks[prop]?.length)
    ) {
      const existing = element.tracks[prop]?.find(
        (k) => Math.abs(k.at - at) < 0.00001,
      );
      commands.push({
        type: "keyframe.set",
        compositionId,
        elementId: element.id,
        property: prop,
        keyframe: {
          id: existing?.id ?? uid("key"),
          at: existing?.at ?? at,
          value: Number(value),
          easing: existing?.easing ?? "easeInOut",
        },
      });
    } else (patch as any)[name] = value;
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
type Props = {
  project: Project;
  compositionId: string;
  progress: number;
  revision: number;
  selected: string[];
  autoKey: boolean;
  zoom: number;
  onSelect(ids: string[]): void;
  onCommit(
    commands: Command[],
    label: string,
    revision?: number,
  ): Promise<void>;
};
export function Canvas({
  project,
  compositionId,
  progress,
  revision,
  selected,
  autoKey,
  zoom,
  onSelect,
  onCommit,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<ReturnType<typeof mountStage> | null>(null);
  const moveable = useRef<Moveable>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const gesture = useRef<{ revision: number; values: Partial<Element> } | null>(
    null,
  );
  const element = project.compositions[compositionId].elements.find(
    (e) => e.id === selected[0],
  );
  const current = element
    ? sampleElement(
        element,
        parentProgress(project, compositionId, element, progress),
      )
    : null;
  useLayoutEffect(() => {
    if (!host.current) return;
    stage.current = mountStage(host.current, project, compositionId);
    stage.current.draw(progress);
    const find =
      element && !element.locked
        ? [
            ...stage.current.design.querySelectorAll<HTMLElement>(
              "[data-element-id]",
            ),
          ].find((n) => n.dataset.elementId === element.id)
        : null;
    setTarget(find ?? null);
    return () => {
      stage.current?.destroy();
      stage.current = null;
    };
  }, [project, compositionId]);
  useEffect(() => {
    if (!stage.current) return;
    const find =
      element && !element.locked
        ? [
            ...stage.current.design.querySelectorAll<HTMLElement>(
              "[data-element-id]",
            ),
          ].find((n) => n.dataset.elementId === element.id)
        : null;
    setTarget(find ?? null);
  }, [selected.join("|"), element?.locked, project]);
  useLayoutEffect(() => {
    if (!gesture.current) stage.current?.draw(progress);
    moveable.current?.updateRect();
  }, [progress, target, zoom]);
  useEffect(() => {
    const observer = new ResizeObserver(() => moveable.current?.updateRect());
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const begin = () => {
    gesture.current = { revision, values: {} };
  };
  const end = async () => {
    const data = gesture.current;
    gesture.current = null;
    if (data && element && Object.keys(data.values).length)
      await onCommit(
        propertyCommands(
          project,
          compositionId,
          element,
          progress,
          data.values,
          autoKey,
        ),
        "画布变换",
        data.revision,
      );
    stage.current?.draw(progress);
    moveable.current?.updateRect();
  };
  return (
    <div
      className="canvas-area"
      data-testid="canvas-area"
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest(".moveable-control-box"))
          return;
        let node = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-element-id]",
        );
        while (
          node &&
          !project.compositions[compositionId].elements.some(
            (e) => e.id === node!.dataset.elementId,
          )
        )
          node =
            node.parentElement?.closest<HTMLElement>("[data-element-id]") ??
            null;
        const id = node?.dataset.elementId;
        if (id)
          onSelect(
            event.shiftKey
              ? selected.includes(id)
                ? selected.filter((i) => i !== id)
                : [...selected, id]
              : [id],
          );
        else onSelect([]);
      }}
    >
      <div className="canvas-guide">
        <span>1920</span>
        <span>1080</span>
      </div>
      <div
        className="canvas-host"
        ref={host}
        style={{ transform: `scale(${zoom})` }}
      />
      {element && current && (
        <Moveable
          ref={moveable}
          target={target}
          draggable
          resizable
          rotatable
          origin={false}
          snappable
          snapDirections={{
            left: true,
            right: true,
            center: true,
            top: true,
            bottom: true,
            middle: true,
          }}
          onDragStart={(event) => {
            begin();
            event.set([current.x, current.y]);
          }}
          onDrag={(event) => {
            event.target.style.transform = event.transform;
            if (gesture.current)
              gesture.current.values = {
                x: event.beforeTranslate[0],
                y: event.beforeTranslate[1],
              };
          }}
          onDragEnd={() => void end()}
          onResizeStart={(event) => {
            begin();
            event.setMin([8, 8]);
            event.dragStart && event.dragStart.set([current.x, current.y]);
          }}
          onResize={(event) => {
            event.target.style.width = `${event.width}px`;
            event.target.style.height = `${event.height}px`;
            event.target.style.transform = event.drag.transform;
            if (gesture.current)
              gesture.current.values = {
                width: event.width,
                height: event.height,
                x: event.drag.beforeTranslate[0],
                y: event.drag.beforeTranslate[1],
              };
          }}
          onResizeEnd={() => void end()}
          onRotateStart={(event) => {
            begin();
            event.set(current.rotation);
            event.dragStart && event.dragStart.set([current.x, current.y]);
          }}
          onRotate={(event) => {
            event.target.style.transform = event.drag.transform;
            if (gesture.current)
              gesture.current.values = {
                rotation: event.beforeRotate,
                x: event.drag.beforeTranslate[0],
                y: event.drag.beforeTranslate[1],
              };
          }}
          onRotateEnd={() => void end()}
        />
      )}
      <div className="canvas-caption">
        <span className="live-dot" />
        {project.compositions[compositionId].name}
        <span>可编辑画布 · {Math.round(progress * 100)}%</span>
      </div>
    </div>
  );
}
