"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";

export type Profile = {
  id: number; name: string; exam_type: string; exam_date: string | null; days_left: number | null; target_pct: number;
  daily_hours: number; study_days: number[]; notes: string; archived: boolean; subjects: number; topics: number;
  topics_completed: number; documents: number; mocks: number;
};
export type User = { id: number; username: string; display_name: string; active_profile_id: number | null };

type Ctx = {
  user: User | null; profiles: Profile[]; profile: Profile | null; pid: number | null; online: boolean;
  setActive: (id: number) => Promise<void>; refresh: () => Promise<void>;
};

const AppCtx = createContext<Ctx>({} as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [online, setOnline] = useState(true);

  const refresh = useCallback(async () => {
    const [u, ps] = await Promise.all([api.get<User>("/api/auth/me"), api.get<Profile[]>("/api/profiles")]);
    setUser(u);
    setProfiles(ps);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    // Host-offline indicator: the Windows PC must stay on for remote access.
    const ping = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        setOnline(r.ok);
      } catch {
        setOnline(false);
      }
    };
    ping();
    const t = setInterval(ping, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const pid = user?.active_profile_id && profiles.some((p) => p.id === user.active_profile_id) ? user.active_profile_id : profiles[0]?.id ?? null;
  const profile = profiles.find((p) => p.id === pid) ?? null;

  const setActive = async (id: number) => {
    const u = await api.patch<User>("/api/auth/me", { active_profile_id: id });
    setUser(u);
  };

  return <AppCtx.Provider value={{ user, profiles, profile, pid, online, setActive, refresh }}>{children}</AppCtx.Provider>;
}
