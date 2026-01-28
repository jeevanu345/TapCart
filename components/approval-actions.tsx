"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle, XCircle, Loader2, Mail } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

interface ApprovalActionsProps {
  storeId: string
  email: string
  onStatusChange?: () => void
}

export function ApprovalActions({ storeId, email, onStatusChange }: ApprovalActionsProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [denyReason, setDenyReason] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const { toast } = useToast()

  function openGmailCompose(to: string, subject: string, body: string) {
    const params = new URLSearchParams({
      view: "cm",
      fs: "1",
      to,
      su: subject,
      body,
    })
    const url = `https://mail.google.com/mail/?${params.toString()}`
    if (typeof window !== "undefined") {
      window.open(url, "_blank")
    }
  }

  const handleApproval = async (action: "approve" | "deny") => {
    setIsLoading(true)

    try {
      const response = await fetch("/api/admin/approve-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          email,
          action,
          reason: action === "deny" ? denyReason : undefined,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        toast({
          title: `Store ${action}d successfully`,
          description: "Opening Gmail compose to notify the store owner...",
        })

        setIsDialogOpen(false)
        setDenyReason("")
        onStatusChange?.()

        if (action === "approve") {
          const subject = "Your Store Account Has Been Approved"
          const body = `Hello ${storeId},\n\nYour store registration has been approved. You can visit https://tapcart-fr.onrender.com/ and login at the store login page.\n\nStore ID: ${storeId}\nEmail: ${email}\n\nRegards,\nAdmin, TapCart`
          openGmailCompose(email, subject, body)
        } else {
          const subject = "Update on Your Store Registration"
          const reasonText = denyReason ? `Reason: ${denyReason}\n\n` : ""
          const body = `Hello ${storeId},\n\nWe are unable to approve your store registration at this time.\n${reasonText}Regards,\nAdmin, TapCart`
          openGmailCompose(email, subject, body)
        }
      } else {
        toast({
          title: "Error",
          description: data.error || `Failed to ${action} store`,
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Network error. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        className="bg-green-600 hover:bg-green-700 text-white"
        onClick={() => handleApproval("approve")}
        disabled={isLoading}
      >
        {isLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
        Approve
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 bg-transparent"
            disabled={isLoading}
          >
            <XCircle className="h-4 w-4 mr-1" />
            Deny
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny Store Registration</DialogTitle>
            <DialogDescription>
              Are you sure you want to deny the registration for <strong>{storeId}</strong>? This will open Gmail compose
              so you can send a notification email to the store owner.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="reason">Reason for denial (optional)</Label>
              <Textarea
                id="reason"
                placeholder="Provide a reason for the denial..."
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                className="mt-2"
              />
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Mail className="h-4 w-4" />
              <span>Email will be sent to: {email}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              onClick={() => handleApproval("deny")}
              disabled={isLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Denying...
                </>
              ) : (
                "Deny Registration"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
