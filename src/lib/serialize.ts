import type { Bucket } from "@/db/schema";
import type { ApiBucket } from "./types";

/** Strip server-only fields (embedding, userEmail) before sending to the client. */
export function toApiBucket(b: Bucket): ApiBucket {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    isDefault: b.isDefault,
    position: b.position,
  };
}
