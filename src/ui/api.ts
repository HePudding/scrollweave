export async function action<T = any>(
  name: string,
  args: unknown = {},
): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "操作失败");
  return result;
}
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
}
export function downloadJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
