import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import type { Project } from "../core/model";
import { mountStage } from "../runtime/render";
/** The source monitor owns its own clock and never sends session or edit commands. */
export function SourceComposition({
  project,
  compositionId,
}: {
  project: Project;
  compositionId: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    stage = useRef<ReturnType<typeof mountStage> | null>(null),
    clock = useRef(0),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    duration = project.compositions[compositionId].duration;
  useLayoutEffect(() => {
    stage.current = mountStage(host.current!, project, compositionId);
    return () => stage.current?.destroy();
  }, [project, compositionId]);
  useLayoutEffect(() => {
    stage.current?.draw(time, { playing, muted: true });
  }, [time, playing, project]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      last = performance.now();
    const tick = (now: number) => {
      clock.current = Math.min(duration, clock.current + (now - last) / 1000);
      last = now;
      setTime(clock.current);
      if (clock.current >= duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  return (
    <div className="source-composition">
      <div ref={host} className="source-composition-stage" />
      <div>
        <button
          aria-label={playing ? "暂停复合素材" : "播放复合素材"}
          onClick={() => {
            if (time >= duration) {
              clock.current = 0;
              setTime(0);
            }
            setPlaying((v) => !v);
          }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <input
          type="range"
          aria-label="复合素材预览秒数"
          min="0"
          max={duration}
          step=".01"
          value={time}
          onChange={(e) => {
            setPlaying(false);
            clock.current = Number(e.target.value);
            setTime(clock.current);
          }}
        />
        <span>
          {time.toFixed(2)} / {duration.toFixed(2)} s · 静音
        </span>
      </div>
    </div>
  );
}
