"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { ApiBucket } from "@/lib/types";
import { signOut } from "next-auth/react";

export function SettingsDialog({
  open,
  onOpenChange,
  userEmail,
  buckets,
  counts,
  mailActionsDisabled,
  onCheckNewMail,
  onResort,
  onEditBucket,
  onDeleteBucket,
  onDeleteData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
  buckets: ApiBucket[];
  counts: Map<string, number>;
  mailActionsDisabled: boolean;
  onCheckNewMail: () => void;
  onResort: () => void;
  onEditBucket: (bucket: ApiBucket) => void;
  onDeleteBucket: (bucket: ApiBucket) => void;
  onDeleteData: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Buckets, mail actions, and your account.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto">
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Buckets</h3>
            <ul className="space-y-1">
              {buckets.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {b.name}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {counts.get(b.id) ?? 0} threads
                        {b.isDefault ? " · default" : ""}
                      </span>
                    </p>
                    {b.description && (
                      <p className="truncate text-xs text-muted-foreground">
                        {b.description}
                      </p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onEditBucket(b)}>
                    {b.isDefault ? "Edit criteria" : "Edit"}
                  </Button>
                  {!b.isDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => onDeleteBucket(b)}
                    >
                      Delete
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Descriptions are the sorting criteria — edit them to teach the
              classifier what belongs where.
            </p>
          </section>

          <Separator />

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Mail</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={mailActionsDisabled}
                onClick={onCheckNewMail}
              >
                Check new mail
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={mailActionsDisabled}
                onClick={onResort}
              >
                Re-sort everything
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Re-sorting refetches and reclassifies every thread. Threads
              you&apos;ve re-filed yourself are never overwritten.
            </p>
          </section>

          <Separator />

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Account</h3>
            <p className="text-xs text-muted-foreground">Signed in as {userEmail}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => signOut()}>
                Sign out
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={onDeleteData}
              >
                Delete my data
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
