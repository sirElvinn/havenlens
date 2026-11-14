import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "HavenLens · Building explorer",
  description: "Explore captured spaces in Matterport."
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
