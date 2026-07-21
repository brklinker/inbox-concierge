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

export function BucketCreateDialog({
  open,
  onOpenChange,
  editBucket,
  preset,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this bucket instead of creating. */
  editBucket: ApiBucket | null;
  /** Prefill for create mode (e.g. a suggested bucket). */
  preset?: { name: string; description: string } | null;
  /** The parent owns the request; the dialog is a controlled form. */
  onSubmit: (name: string, description: string) => void;
}) {
  // Initial values come from editBucket/preset; the parent remounts this
  // component (via key) when switching between create and edit targets.
  const [name, setName] = useState(editBucket?.name ?? preset?.name ?? "");
  const [description, setDescription] = useState(
    editBucket?.description ?? preset?.description ?? "",
  );

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName(editBucket?.name ?? preset?.name ?? "");
      setDescription(editBucket?.description ?? preset?.description ?? "");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-surface sm:rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {editBucket ? "Edit bucket" : "Create a bucket"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {editBucket
              ? "Filed threads stay put; new criteria apply the next time you sort."
              : "Describe it in plain language. One scan moves in the matches — nothing else is touched."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(name, description);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="bucket-name" className="text-xs text-muted-foreground">
              Bucket name
            </Label>
            <Input
              id="bucket-name"
              className="rounded-[2px] bg-background"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Receipts"
              disabled={!!editBucket?.isDefault}
              autoFocus={!editBucket?.isDefault}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bucket-description" className="text-xs text-muted-foreground">
              Criteria
            </Label>
            <Textarea
              id="bucket-description"
              className="min-h-[90px] rounded-[2px] bg-background"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Order confirmations, invoices, and payment receipts from any merchant."
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-[2px]"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-[2px]" disabled={!name.trim()}>
              {editBucket ? "Save changes" : "Create & scan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
