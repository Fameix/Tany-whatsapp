"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const greetingFor = (hour: number) => (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");

/** Uses the viewer's local time; the server render falls back to a neutral greeting. */
export function Greeting({ name }: { name: string }) {
  const greeting = useSyncExternalStore(subscribe, () => greetingFor(new Date().getHours()), () => "Welcome back");
  return <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[28px]">{greeting}, {name}</h1>;
}
