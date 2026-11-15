import type { ReactNode } from "react";
import { GeistSerifRegular } from "geist/font/serif/regular";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata = {
  title: "HavenLens · Building risk dossiers",
  description: "Pre-incident building intelligence from CoStar, Vexcel and Matterport."
};

export const viewport = { themeColor: "#0f1113", colorScheme: "dark" };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${GeistSerifRegular.variable}`}><body>{children}</body></html>;
}
