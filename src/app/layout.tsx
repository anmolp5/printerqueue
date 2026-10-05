import type { Metadata } from "next";
import "./globals.css";
import { MsalRootProvider } from "@/components/MsalRootProvider";

export const metadata: Metadata = {
  title: "Bambu Lab X1C Shared Queue & Booking Portal | UIUC",
  description:
    "24/7 continuous 15-minute 3D printer reservation portal for UIUC (@illinois.edu) with automated 10-minute cooldown buffers and early-completion shift notifications.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased pb-16">
        <MsalRootProvider>{children}</MsalRootProvider>
      </body>
    </html>
  );
}
