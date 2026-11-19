"use client";
import { createContext, useContext } from "react";
import type { Net } from "@/lib/networks";

/** The Arc network of the job on screen, so every explorer link inside it points at the right chain. */
const Ctx = createContext<Net>("testnet");
export const NetProvider = ({ net, children }: { net?: Net; children: React.ReactNode }) => <Ctx.Provider value={net ?? "testnet"}>{children}</Ctx.Provider>;
export const useNet = () => useContext(Ctx);
