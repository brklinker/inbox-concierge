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
import { signOut } from "next-auth/react";

export function SettingsDialog({
  open,
  onOpenChange,
  userEmail,
  mailActionsDisabled,
  onCheckNewMail,
  onResort,
  onDeleteData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
  mailActionsDisabled: boolean;
  onCheckNewMail: () => void;
  onResort: () => void;
  onDeleteData: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-[520px] sm:rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Mail actions and your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section>
            <div className="kicker text-press">Buckets</div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Hover a bucket in the section index and open its ⋯ menu to edit
              or delete.
            </p>
          </section>

          <section className="space-y-2">
            <div className="kicker text-press">Mail</div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-[2px]"
                disabled={mailActionsDisabled}
                onClick={onCheckNewMail}
              >
                Check new mail
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-[2px]"
                disabled={mailActionsDisabled}
                onClick={onResort}
              >
                Re-sort everything
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Re-sorting reclassifies every thread. Your own re-files are never
              overwritten.
            </p>
          </section>

          <section className="space-y-2">
            <div className="kicker text-press">Account</div>
            <p className="text-xs text-muted-foreground">Signed in as {userEmail}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-[2px]"
                onClick={() => signOut()}
              >
                Sign out
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto rounded-[2px] border-press2-300 text-press2-700"
                onClick={onDeleteData}
              >
                Delete all data
              </Button>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button className="rounded-[2px]" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
