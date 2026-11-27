"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Role } from "@bakery-os/shared";
import { useAuth } from "@/lib/auth-context";
import { homeFor } from "@/lib/nav";
import { CountApp } from "./count-app";

export default function CountPage() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login?next=/count");
  }, [isLoading, user, router]);

  if (isLoading || !user) return <p className="p-8 text-center text-base text-muted">Загрузка…</p>;
  if (user.role !== Role.SHELF_COUNTER) {
    return (
      <div className="p-8 text-center">
        <p className="mb-4 text-base text-foreground">Этот экран — для пересчёта товара на точке. Войдите под входом «Пересчёт остатков».</p>
        <Link href={homeFor(user.role)} className="rounded-xl bg-accent px-4 py-2 text-base font-medium text-accent-foreground">
          Вернуться в программу
        </Link>
      </div>
    );
  }
  return <CountApp onLogout={logout} />;
}
