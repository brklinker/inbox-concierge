// Client-side shapes of API responses (dates arrive as ISO strings).

export interface ApiThread {
  id: string;
  subject: string | null;
  sender: string | null;
  senderDomain: string | null;
  snippet: string | null;
  internalDate: string | null;
  bucketId: string | null;
  confidence: number | null;
  reason: string | null;
  classifiedAt: string | null;
  /** Client-only: staggers the arrival animation within a batch. */
  arrivalDelay?: number;
}

export interface ApiBucket {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  position: number;
}

export interface ClassifyEvent {
  type: "start" | "batch" | "review_start" | "done" | "error";
  total?: number;
  batches?: number;
  completed?: number;
  flagged?: number;
  message?: string;
  results?: {
    id: string;
    bucketId: string | null;
    bucket: string | null;
    confidence: number;
    reason: string;
  }[];
  classified?: number;
  reviewed?: number;
  corrections?: {
    id: string;
    bucketId: string | null;
    bucket: string | null;
    confidence: number;
    reason: string;
    previousBucket: string;
  }[];
}
