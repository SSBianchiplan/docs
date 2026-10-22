import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/lib/types";

interface Session {
  token: string | null;
  user: User | null;
  /** token restrito: só serve para a troca de senha obrigatória */
  mustChange: boolean;
  login: (token: string, user: User) => void;
  requireChange: () => void;
  logout: () => void;
}
export const useSession = create<Session>()(persist((set) => ({
  token: null, user: null, mustChange: false,
  login: (token, user) => set({ token, user, mustChange: !!user.must_change_password }),
  requireChange: () => set({ mustChange: true }),
  logout: () => set({ token: null, user: null, mustChange: false }),
}), { name: "gps-docs-session" }));
