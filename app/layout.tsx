import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./identity.css";
import "./allocation.css";
import "./rounds.css";
import "./controls.css";
import "./pricing.css";
import "./dark.css";
import "./trust.css";
import "./openaccounts.css";
import "./cash.css";
import "./accountdetails.css";
import "./members.css";
import "./controls-extra.css";
import "./simple-flow.css";
import "./guests.css";
import "./guests-hierarchy.css";
import "./monthly.css";
import "./events.css";
import "./event-dialog.css";
import "./bundles.css";
import "./profiles.css";
import "./profiles-dialog.css";
import "./brand.css";
import "./system.css";
import "./openlist.css";
import "./undo.css";
import "./recovery.css";
import "./admin-sections.css";
import "./tablet-number.css";
import "./direct-checkout.css";
import "./checkout-future.css";
import "./price-mode.css";
import "./account-urgency.css";
import "./random-rewards.css";
import "./club-split.css";
import "./kiosk-design.css";
import "./product-manager.css";
import "./responsive-layout.css";
import "./rfid.css";
import "./pos-ergonomics.css";
import "./allocation-ergonomics.css";
import "./split-history.css";
import "./safety.css";
import "./retail-pos.css";
import "./payment-choice.css";
import "./balance-check.css";
import "./member-admin-cleanup.css";
import "./event-pos.css";

export const metadata: Metadata = {
  title: "Vereinskasse · SV Barver Darts",
  description: "Die einfache, tabletfreundliche Kasse für den SV Barver Darts.",
  manifest: "/manifest.webmanifest",
  applicationName: "Vereinskasse",
  icons: {
    icon: [
      { url: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Vereinskasse",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Vereinskasse · SV Barver Darts",
    description: "Vereinsabend, Veranstaltungen und Monatsabrechnungen für den SV Barver Darts.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#173b32",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
