import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export { schema };
export const getDb = createGetDb(schema);
