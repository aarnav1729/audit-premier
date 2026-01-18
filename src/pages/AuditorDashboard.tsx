// root/src/pages/AuditorDashboard.tsx
import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  MessageSquare,
  CheckCircle,
  AlertCircle,
  Pencil,
  Lock,
} from "lucide-react";
import { AuditTable } from "@/components/AuditTable";
import { Analytics } from "@/components/Analytics";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { ExcelUpload } from "@/components/ExcelUpload";
import { useAuditStorage } from "@/hooks/useAuditStorage";
import { useAuth } from "@/hooks/useAuth";
import { AuditIssue } from "@/types/audit";
//import { toast } from "@/components/ui/use-toast";

import { EditAuditModal } from "@/components/EditAuditModal";
import { AuditorsManager } from "@/components/AuditorsManager";
import { Reports } from "@/components/Reports";

const API_BASE_URL = `${window.location.origin}/api`;

export const AuditorDashboard: React.FC = () => {
  const { auditIssues, updateAuditIssue, addComment } = useAuditStorage();
  const { user } = useAuth();

  const [reloadKey, setReloadKey] = useState(0);

  const isAuditor = (user?.role || "").toLowerCase() === "auditor";
  const viewerEmail = (user?.email || "").toLowerCase();
  const canBypassLock = viewerEmail === "santosh.kumar@protivitiglobal.in";

  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<any[]>([]);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<AuditIssue | null>(null);
  const [reviewComments, setReviewComments] = useState("");
  const [evidenceStatus, setEvidenceStatus] = useState<
    "Insufficient" | "Accepted" | "Partially Accepted"
  >("Accepted");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // NEW: edit state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [issueToEdit, setIssueToEdit] = useState<AuditIssue | null>(null);

  const isAccepted = (s?: string) =>
    String(s || "")
      .trim()
      .toLowerCase() === "accepted";
  const unlockIssue = async (issue: AuditIssue) => {
    // Don’t call the API if it’s not Accepted right now
    if (!isAccepted(issue.evidenceStatus)) {
      console.warn("Unlock skipped: issue is not in Accepted state.");
      return;
    }

    const reason = window.prompt(
      "Please provide a reason for unlocking this issue:"
    );

    const trimmedReason = (reason || "").trim();
    if (!trimmedReason) {
      console.warn("Unlock cancelled: no reason provided.");
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE_URL}/audit-issues/${issue.id}/unlock`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actor: viewerEmail, reason: trimmedReason }),
        }
      );
      const updated: AuditIssue & { error?: string } = await res.json();
      if (!res.ok) throw new Error(updated.error || "Failed to unlock");

      updateAuditIssue(updated.id, {
        evidenceStatus: updated.evidenceStatus,
        currentStatus: updated.currentStatus,
        reviewComments: updated.reviewComments,
        ...((updated as any).isLocked !== undefined
          ? { isLocked: (updated as any).isLocked }
          : {}),
      } as any);

      // Ensure the table reflects the new status
      setReloadKey((k) => k + 1);
      // toast({ title: "Unlocked", description: "Issue unlocked for editing." });
    } catch (e: any) {
      console.error("Unlock error:", e);
      // toast({ title: "Unlock failed", description: e.message, variant: "destructive" });
    }
  };

  const viewEvidence = (issue: AuditIssue) => {
    setSelectedEvidence(issue.evidenceReceived);
    setEvidenceModalOpen(true);
  };

  const openReviewModal = (issue: AuditIssue) => {
    const locked = isAccepted(issue.evidenceStatus);
    if (locked) {
      //toast({
      //  title: "Locked",
      //  description:
      //    "This issue is locked after acceptance. Review cannot be modified.",
      //  variant: "destructive",
      //});
      return;
    }
    setSelectedIssue(issue);
    setReviewComments(issue.reviewComments || "");
    setEvidenceStatus(issue.evidenceStatus || "Accepted");
    setReviewModalOpen(true);
  };

  const openEditModal = (issue: AuditIssue) => {
    const locked = isAccepted(issue.evidenceStatus);
    issue.evidenceStatus === "Accepted";
    if (locked) {
      // toast({
      //   title: "Locked",
      //   description:
      //    "This issue is locked after acceptance. Editing is disabled.",
      //   variant: "destructive",
      // });
      return;
    }
    setIssueToEdit(issue);
    setEditModalOpen(true);
  };

  const submitReview = async () => {
    if (!selectedIssue) return;
    setIsSubmittingReview(true);

    try {
      // Call server review endpoint
      const res = await fetch(
        `${API_BASE_URL}/audit-issues/${selectedIssue.id}/review`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evidenceStatus,
            reviewComments,
          }),
        }
      );

      const updated: AuditIssue & { error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(updated.error || "Failed to submit review");
      }

      // Update local context
      updateAuditIssue(updated.id, {
        evidenceStatus: updated.evidenceStatus,
        reviewComments: updated.reviewComments,
        currentStatus: updated.currentStatus,
        ...((updated as any).isLocked !== undefined
          ? { isLocked: (updated as any).isLocked }
          : {}),
      } as any);

      // Add a comment record
      addComment({
        auditIssueId: updated.id,
        userId: user?.email || "",
        userName: user?.name || "",
        content: `Evidence marked as ${updated.evidenceStatus}. ${updated.reviewComments}`,
        type: "review",
      });

      // toast({
      //   title: "Review Submitted",
      //   description: `Evidence has been marked as ${updated.evidenceStatus.toLowerCase()}.`,
      // });

      // Reset modal state
      setReviewModalOpen(false);
      setSelectedIssue(null);
      setReviewComments("");
    } catch (err: any) {
      console.error("Review submission error:", err);
      //toast({
      // title: "Error Submitting Review",
      // description: err.message || "Please try again.",
      // variant: "destructive",
      // });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const getActionColumn = (issue: AuditIssue) => {
    const locked = isAccepted(issue.evidenceStatus);
    issue.evidenceStatus === "Accepted";
    return (
      <div className="flex flex-wrap gap-2 items-center">
        {issue.evidenceReceived.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => viewEvidence(issue)}
            className="flex items-center space-x-1"
          >
            <Eye className="h-4 w-4" />
            <span>View</span>
          </Button>
        )}
        {issue.evidenceReceived.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openReviewModal(issue)}
            className="flex items-center space-x-1"
            disabled={locked}
            title={locked ? "Locked after acceptance" : "Review"}
          >
            {issue.evidenceStatus === "Accepted" ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : issue.evidenceStatus === "Partially Accepted" ? (
              <AlertCircle className="h-4 w-4 text-yellow-500" />
            ) : issue.evidenceStatus === "Insufficient" ? (
              <AlertCircle className="h-4 w-4 text-red-500" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
            <span>Review</span>
          </Button>
        )}

        {/* Edit button disabled when locked */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => openEditModal(issue)}
          className="flex items-center space-x-1"
          disabled={locked}
          title={locked ? "Locked after acceptance" : "Edit issue"}
        >
          <Pencil className="h-4 w-4" />
          <span>Edit</span>
        </Button>

        {locked && canBypassLock ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => unlockIssue(issue)}
            className="flex items-center space-x-1"
            title="Unlock this issue for editing"
          >
            <Lock className="h-4 w-4" />
            <span>Unlock</span>
          </Button>
        ) : locked ? (
          <Badge className="bg-gray-700 inline-flex items-center gap-1">
            <Lock className="h-3 w-3" /> Locked
          </Badge>
        ) : null}

        {issue.evidenceStatus && (
          <Badge
            className={
              issue.evidenceStatus === "Accepted"
                ? "bg-green-500"
                : issue.evidenceStatus === "Partially Accepted"
                ? "bg-yellow-500"
                : issue.evidenceStatus === "Submitted"
                ? "bg-blue-500"
                : "bg-red-500" // Insufficient or anything else
            }
          >
            {issue.evidenceStatus}
          </Badge>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Auditor Dashboard
          </h1>
          <p className="text-gray-600 mt-1">
            Manage audit issues and review evidence
          </p>
        </div>
      </div>

      {/* Analytics first, then Audit Issues, then Excel Upload */}
      <Tabs defaultValue="analytics" className="space-y-4">
        <TabsList
          className={`grid w-fit ${isAuditor ? "grid-cols-5" : "grid-cols-3"}`}
        >
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="audit-issues">Audit Issues</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="excel-upload">Excel Upload</TabsTrigger>
          {isAuditor && <TabsTrigger value="auditors">Auditors</TabsTrigger>}
        </TabsList>

        <TabsContent value="analytics" className="space-y-4">
          <Analytics title="Audit Analytics Dashboard" />
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
  <Reports viewerEmail={viewerEmail} />
</TabsContent>

        <TabsContent
          value="audit-issues"
          className="space-y-4 overflow-visible"
        >
          {/* Export toolbar */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                const scope = isAuditor ? "all" : "mine";
                const url = `${API_BASE_URL}/audit-issues/export?scope=${scope}&viewer=${encodeURIComponent(
                  viewerEmail
                )}`;
                // Use navigation to trigger a file download
                window.location.href = url;
              }}
            >
              Export XLSX
            </Button>
          </div>
          <AuditTable
            key={reloadKey}
            // Let the table fetch from the server so evidence shows up immediately
            auditIssues={undefined}
            // viewer is used by the table to request ?scope=all for auditors (server authorizes by AUDITOR_EMAILS)
            viewer={viewerEmail}
            showCreateButton={isAuditor}
            title={isAuditor ? "All Audit Issues" : "My Audit Issues"}
            actionColumn={isAuditor ? getActionColumn : undefined}
          />
        </TabsContent>

        {isAuditor && (
          <TabsContent value="excel-upload" className="space-y-4">
            <ExcelUpload />
          </TabsContent>
        )}

        {isAuditor && (
          <TabsContent value="auditors" className="space-y-4">
            <AuditorsManager viewerEmail={viewerEmail} />
          </TabsContent>
        )}
      </Tabs>

      {/* Evidence Viewer Modal */}
      <EvidenceViewer
        open={evidenceModalOpen}
        onClose={() => setEvidenceModalOpen(false)}
        evidence={selectedEvidence}
        title="Evidence Files"
      />

      {/* Review Evidence Modal */}
      <Dialog open={reviewModalOpen} onOpenChange={setReviewModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review Evidence</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Evidence Status</Label>
              <Select
                value={evidenceStatus}
                onValueChange={(value) =>
                  setEvidenceStatus(
                    value as "Accepted" | "Insufficient" | "Partially Accepted"
                  )
                }
                disabled={isSubmittingReview}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Accepted">Accepted</SelectItem>
                  <SelectItem value="Partially Accepted">
                    Partially Accepted
                  </SelectItem>
                  <SelectItem value="Insufficient">Insufficient</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Review Comments</Label>
              <Textarea
                value={reviewComments}
                onChange={(e) => setReviewComments(e.target.value)}
                placeholder="Add your review comments..."
                rows={4}
                disabled={isSubmittingReview}
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setReviewModalOpen(false)}
                disabled={isSubmittingReview}
              >
                Cancel
              </Button>
              <Button
                onClick={submitReview}
                className="bg-gradient-to-r from-blue-500 to-green-500"
                disabled={isSubmittingReview}
              >
                {isSubmittingReview ? "Submitting..." : "Submit Review"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* NEW: Edit Audit Issue Modal */}
      <EditAuditModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        issue={issueToEdit}
        actorEmail={viewerEmail}
        onSaved={(updated) => {
          updateAuditIssue(updated.id, updated as any);
        }}
      />
    </div>
  );
};
