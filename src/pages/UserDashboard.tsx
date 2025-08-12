import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle, AlertCircle, Eye } from "lucide-react";
import { AuditTable } from "@/components/AuditTable";
import { UploadEvidenceModal } from "@/components/UploadEvidenceModal";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { useAuditStorage } from "@/hooks/useAuditStorage";
import { useAuth } from "@/hooks/useAuth";
import { AuditIssue, Evidence } from "@/types/audit";

export const UserDashboard: React.FC = () => {
  const { auditIssues, updateAuditIssue } = useAuditStorage();
  const { user } = useAuth();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string>("");
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence[]>([]);

  // Filter issues assigned to current user
  // Instead of: issue.personResponsible === user?.email
  const userIssues = auditIssues.filter((issue) => {
    const emails = (issue.personResponsible || "")
      .split(/[;,]/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return emails.includes((user?.email || "").toLowerCase());
  });

  const openUploadModal = (issueId: string) => {
    setSelectedIssueId(issueId);
    setUploadModalOpen(true);
  };

  const viewEvidence = (issue: AuditIssue) => {
    setSelectedEvidence(issue.evidenceReceived);
    setEvidenceModalOpen(true);
  };

  const handleEvidenceUpload = (
    evidence: Evidence[],
    textEvidence?: string
  ) => {
    const issue = auditIssues.find((i) => i.id === selectedIssueId);
    if (!issue) return;

    const updatedEvidence = [...issue.evidenceReceived, ...evidence];

    updateAuditIssue(selectedIssueId, {
      evidenceReceived: updatedEvidence,
      currentStatus: "Received",
    });
  };

  const getActionColumn = (issue: AuditIssue) => (
    <div className="flex space-x-2 items-center">
      <Button
        variant="outline"
        size="sm"
        onClick={() => openUploadModal(issue.id)}
        className="flex items-center space-x-1"
      >
        <Upload className="h-4 w-4" />
        <span>Upload Evidence</span>
      </Button>

      {issue.evidenceReceived.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => viewEvidence(issue)}
          className="flex items-center space-x-1"
        >
          <Eye className="h-4 w-4" />
          <span>View Evidence</span>
        </Button>
      )}

      {issue.evidenceStatus && (
        <div className="flex items-center space-x-2">
          <Badge
            className={
              issue.evidenceStatus === "Accepted"
                ? "bg-green-500"
                : "bg-red-500"
            }
          >
            {issue.evidenceStatus === "Accepted" ? (
              <CheckCircle className="h-3 w-3 mr-1" />
            ) : (
              <AlertCircle className="h-3 w-3 mr-1" />
            )}
            {issue.evidenceStatus}
          </Badge>
        </div>
      )}

      {issue.reviewComments && (
        <div className="max-w-xs">
          <p
            className="text-xs text-gray-600 italic"
            title={issue.reviewComments}
          >
            {issue.reviewComments.length > 30
              ? `${issue.reviewComments.substring(0, 30)}...`
              : issue.reviewComments}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Manage your assigned audit issues
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">Assigned Issues</p>
          <p className="text-2xl font-bold text-blue-600">
            {userIssues.length}
          </p>
        </div>
      </div>

      <AuditTable
        auditIssues={userIssues}
        title="Your Assigned Audit Issues"
        actionColumn={getActionColumn}
      />

      <UploadEvidenceModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUpload={handleEvidenceUpload}
        auditIssueId={selectedIssueId}
        userEmail={user?.email || ""}
      />

      <EvidenceViewer
        open={evidenceModalOpen}
        onClose={() => setEvidenceModalOpen(false)}
        evidence={selectedEvidence}
        title="Your Evidence Files"
      />
    </div>
  );
};
