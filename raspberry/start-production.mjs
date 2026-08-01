import { resolve } from "node:path";
import { startProdServer } from "vinext/server/prod-server";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT muss eine gültige TCP-Portnummer sein.");
}

await startProdServer({
  port,
  host,
  outDir: resolve(process.env.VEREINSKASSE_DIST_DIR || "dist"),
});
