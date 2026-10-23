// Lets `node --test` load the app's TypeScript the way Vite does: Node strips
// the types itself (Node 22.18+), and this hook adds the ".ts" / ".tsx"
// extension that the app's imports leave out.
import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
