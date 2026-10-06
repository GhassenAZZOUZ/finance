"use client";

import { App } from "@capacitor/app";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { appRouteOf, isNativeApp } from "@/lib/native/platform";

/**
 * Android app only (issue #84): a magic link that opens the app lands on the sign-in page inside it
 * (AC-02), and the system back button goes back a page, or leaves the app from the first one.
 * Renders nothing; on the website it does nothing.
 */
export function NativeBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    const listeners = [
      App.addListener("appUrlOpen", ({ url }) => {
        const route = appRouteOf(url);
        if (route) router.replace(route);
      }),
      App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else void App.exitApp();
      }),
    ];
    return () => {
      for (const listener of listeners) void listener.then((l) => l.remove());
    };
  }, [router]);

  return null;
}
