import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";
interface Ui {
  theme: Theme;
  projectId: string | null;        // filtro global de projeto
  setTheme: (t: Theme) => void;
  setProject: (id: string | null) => void;
}
export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
export const useUi = create<Ui>()(persist((set) => ({
  theme: "system", projectId: null,
  setTheme: (theme) => { applyTheme(theme); set({ theme }); },
  setProject: (projectId) => set({ projectId }),
}), { name: "gps-docs-ui" }));
