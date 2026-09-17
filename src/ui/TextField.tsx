import { useEffect, useRef, useState } from "react";
export function TextField({
  label,
  value,
  revision,
  onCommit,
  multiline = false,
  className,
  placeholder,
}: {
  label: string;
  value: string;
  revision: number;
  onCommit(value: string, revision: number): void;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const captured = useRef(revision);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const props = {
    "aria-label": label,
    value: draft,
    className,
    placeholder,
    onFocus: () => {
      focused.current = true;
      captured.current = revision;
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: () => {
      focused.current = false;
      if (draft !== value) onCommit(draft, captured.current);
    },
  };
  return multiline ? (
    <textarea {...props} />
  ) : (
    <input
      {...props}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
