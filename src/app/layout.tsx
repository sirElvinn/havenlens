import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata = {
  title: "HavenLens · Exercise room",
  description: "Run a tabletop exercise alongside a real Matterport scan."
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en" className={GeistSans.variable}><body>{children}</body></html>;
}
