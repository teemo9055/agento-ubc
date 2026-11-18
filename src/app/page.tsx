import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "Agento: say it, check it, approve once",
  description: "Say what you want done in plain words, check the plan, approve once and watch it happen. It can only spend what you approved.",
};

// First visit: what Agento does, in four panels. The app home lives at /home.
export default function LandingPage() {
  return <Landing />;
}
