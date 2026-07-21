import type { Metadata } from "next";
import "./globals.css";
import "./identity.css";
import "./allocation.css";

export const metadata: Metadata = {
  title: "Vereinskasse · SV Beispielhausen",
  description: "Die einfache, tabletfreundliche Kasse für den Verein.",
  openGraph: {
    title: "Vereinskasse",
    description: "Einfach verkaufen. Gemeinsam feiern.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
