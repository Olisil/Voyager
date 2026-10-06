import { coerceProject, demoProject, type Project } from "./project";

const KEY = "fardvag:project:v1";

export function loadAutosave(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return coerceProject(JSON.parse(raw));
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return demoProject();
}

export function autosave(p: Project) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* quota or private mode: autosave is best-effort */
  }
}

export function slug(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "trip"
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function saveProjectFile(p: Project) {
  downloadBlob(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }), `${slug(p.name)}.fardvag.json`);
}

export async function readProjectFile(file: File): Promise<Project> {
  return coerceProject(JSON.parse(await file.text()));
}
