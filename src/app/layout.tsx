import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Economic Intelligence OS",
  description: "AI-native decision intelligence for business and markets",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
