import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "HavenLens · Scenario studio",
  description: "Explore a synthetic six-floor training scenario."
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
