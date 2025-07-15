// root/src/pages/AuditorDashboard.tsx

import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, MessageSquare, CheckCircle, AlertCircle } from 'lucide-react';
import { AuditTable } from '@/components/AuditTable';
import { Analytics } from '@/components/Analytics';
import { EvidenceViewer } from '@/components/EvidenceViewer';
import { ExcelUpload } from '@/components/ExcelUpload';
import { useAuditStorage } from '@/hooks/useAuditStorage';
import { useAuth } from '@/hooks/useAuth';
import { AuditIssue } from '@/types/audit';
import { toast } from '@/hooks/use-toast';


const API_BASE_URL = 'http://localhost:7723/api';


export const AuditorDashboard: React.FC = () => {
  const { auditIssues, updateAuditIssue, addComment } = useAuditStorage();
  const { user } = useAuth();

  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<any[]>([]);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<AuditIssue | null>(null);
  const [reviewComments, setReviewComments] = useState('');
  const [evidenceStatus, setEvidenceStatus] = useState<'Insufficient' | 'Accepted' | 'Partially Accepted'>('Accepted');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  const viewEvidence = (issue: AuditIssue) => {
    setSelectedEvidence(issue.evidenceReceived);
    setEvidenceModalOpen(true);
  };

  const openReviewModal = (issue: AuditIssue) => {
    setSelectedIssue(issue);
    setReviewComments(issue.reviewComments || '');
    setEvidenceStatus(issue.evidenceStatus || 'Accepted');
    setReviewModalOpen(true);
  };

  const submitReview = async () => {
    if (!selectedIssue) return;
    setIsSubmittingReview(true);

    try {
      // Call server review endpoint
      const res = await fetch(
        `${API_BASE_URL}/audit-issues/${selectedIssue.id}/review`,
        {
          method: 'PUT',
          credentials: "include",
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            evidenceStatus,
            reviewComments
          })
        }
      );

      const updated: AuditIssue & { error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(updated.error || 'Failed to submit review');
      }

      // Update local context
      updateAuditIssue(updated.id, {
        evidenceStatus: updated.evidenceStatus,
        reviewComments: updated.reviewComments,
        currentStatus: updated.currentStatus
      });

      // Add a comment record
      addComment({
        auditIssueId: updated.id,
        userId: user?.email || '',
        userName: user?.name || '',
        content: `Evidence marked as ${updated.evidenceStatus}. ${updated.reviewComments}`,
        type: 'review'
      });

      toast({
        title: "Review Submitted",
        description: `Evidence has been marked as ${updated.evidenceStatus.toLowerCase()}.`,
      });

      // Reset modal state
      setReviewModalOpen(false);
      setSelectedIssue(null);
      setReviewComments('');
    } catch (err: any) {
      console.error('Review submission error:', err);
      toast({
        title: "Error Submitting Review",
        description: err.message || 'Please try again.',
        variant: "destructive",
      });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const getActionColumn = (issue: AuditIssue) => (
    <div className="flex space-x-2">
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
        >
          {issue.evidenceStatus === 'Accepted' ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : issue.evidenceStatus === 'Partially Accepted' ? (
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          ) : issue.evidenceStatus === 'Insufficient' ? (
            <AlertCircle className="h-4 w-4 text-red-500" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}

          <span>Review</span>
        </Button>
      )}
      {issue.evidenceStatus && (
        <Badge
          className={
            issue.evidenceStatus === 'Accepted'
              ? 'bg-green-500'
              : issue.evidenceStatus === 'Partially Accepted'
                ? 'bg-yellow-500'
                : 'bg-red-500'
          }
        >
          {issue.evidenceStatus}
        </Badge>
      )}

    </div>
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Auditor Dashboard</h1>
          <p className="text-gray-600 mt-1">Manage audit issues and review evidence</p>
        </div>
      </div>

      <Tabs defaultValue="audit-issues" className="space-y-4">
        <TabsList className="grid w-fit grid-cols-3">
          <TabsTrigger value="audit-issues">Audit Issues</TabsTrigger>
          <TabsTrigger value="excel-upload">Excel Upload</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="audit-issues" className="space-y-4">
          <AuditTable
            auditIssues={auditIssues}
            showCreateButton={true}
            title="All Audit Issues"
            actionColumn={getActionColumn}
          //currentUserRole='Auditor'
          />
        </TabsContent>

        <TabsContent value="excel-upload" className="space-y-4">
          <ExcelUpload />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Analytics title="Audit Analytics Dashboard" />
        </TabsContent>
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
                onValueChange={(value) => setEvidenceStatus(value as 'Accepted' | 'Insufficient' | 'Partially Accepted')}
                disabled={isSubmittingReview}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Accepted">Accepted</SelectItem>
                  <SelectItem value="Partially Accepted">Partially Accepted</SelectItem>
                  <SelectItem value="Insufficient">Insufficient</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Review Comments</Label>
              <Textarea
                value={reviewComments}
                onChange={e => setReviewComments(e.target.value)}
                placeholder="Add your review comments..."
                rows={4}
                disabled={isSubmittingReview}
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setReviewModalOpen(false)} disabled={isSubmittingReview}>
                Cancel
              </Button>
              <Button
                onClick={submitReview}
                className="bg-gradient-to-r from-blue-500 to-green-500"
                disabled={isSubmittingReview}
              >
                {isSubmittingReview ? 'Submitting...' : 'Submit Review'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};