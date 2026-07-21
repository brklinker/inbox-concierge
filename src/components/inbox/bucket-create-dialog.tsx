"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApiBucket } from "@/lib/types";
import { useState } from "react";

export interface BucketCreateResult {
  bucket: ApiBucket;
  scanned: number;
  evaluated: number;
  usedFallback: boolean;
  moved: { id: string; bucketId: string; confidence: number; reason: string }[];
}

export function BucketCreateDialog({
  open,
  onOpenChange,
  editBucket,
  onCreated,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog renames/redescribes this bucket instead of creating. */
  editBucket: ApiBucket | null;
  onCreated: (result: BucketCreateResult) => void;
  onRenamed: (bucket: ApiBucket) => void;
}) {
  // Initial values come from editBucket; the parent remounts this component
  // (via a key on editBucket) when switching between create and edit targets.
  const [name, setName] = useState(editBucket?.name ?? "");
  const [description, setDescription] = useState(editBucket?.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BucketCreateResult | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName(editBucket?.name ?? "");
      setDescription(editBucket?.description ?? "");
      setError(null);
      setResult(null);
      setPending(false);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        editBucket ? `/api/buckets/${editBucket.id}` : "/api/buckets",
        {
          method: editBucket ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (editBucket) {
        onRenamed(data.bucket);
        handleOpenChange(false);
      } else {
        setResult(data);
        onCreated(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editBucket ? "Edit bucket" : "New bucket"}</DialogTitle>
          <DialogDescription>
            Describe it the way you&apos;d tell an assistant what belongs here —
            the description is the sorting criteria.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium">
              Scanned {result.scanned} threads · evaluated {result.evaluated}{" "}
              candidates · moved {result.moved.length}
            </p>
            {result.usedFallback && (
              <p className="text-muted-foreground">
                The description was too broad for similarity retrieval, so every
                thread was evaluated.
              </p>
            )}
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="bucket-name">Name</Label>
              <Input
                id="bucket-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Job Applications"
                disabled={!!editBucket?.isDefault}
                autoFocus={!editBucket?.isDefault}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bucket-description">Description (optional)</Label>
              <Textarea
                id="bucket-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Recruiter outreach, interview scheduling, application confirmations"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending
                  ? editBucket
                    ? "Saving…"
                    : "Scanning inbox…"
                  : editBucket
                    ? "Save"
                    : "Create & sort"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
