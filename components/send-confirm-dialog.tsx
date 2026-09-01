"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  /**
   * The draft is needs_check: the server only accepts it with an explicit
   * confirmation that the fadmin check happened. The dialog says so and the
   * confirm button asserts it.
   */
  locked?: boolean
}

export function SendConfirmDialog({ open, onOpenChange, onConfirm, locked = false }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{locked ? "Send a draft that needs a check" : "Send to Intercom"}</DialogTitle>
          <DialogDescription>
            {locked
              ? "This draft is locked because it needs a fadmin check first (payout, KYC or media). Only confirm if you have already verified it in fadmin. It goes out as a public reply and the customer sees it immediately."
              : "This will send the AI-generated draft as a public reply in this Intercom conversation. The customer will see it immediately."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>{locked ? "I checked fadmin, send" : "Send reply"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
