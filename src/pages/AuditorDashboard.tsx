
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
import { useAuditStorage } from '@/hooks/useAuditStorage';
import { useAuth } from '@/hooks/useAuth';
import { AuditIssue } from '@/types/audit';
import { toast } from '@/hooks/use-toast';

export const AuditorDashboard: React.FC = () => {
  const { auditIssues, updateAuditIssue, addComment } = useAuditStorage();
  const { user } = useAuth();
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<any[]>([]);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<AuditIssue | null>(null);
  const [reviewComments, setReviewComments] = useState('');
  const [evidenceStatus, setEvidenceStatus] = useState<'Insufficient' | 'Accepted'>('Accepted');

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

  const submitReview = () => {
    if (!selectedIssue) return;

    updateAuditIssue(selectedIssue.id, {
      evidenceStatus,
      reviewComments,
      currentStatus: evidenceStatus === 'Accepted' ? 'Received' : 'To Be Received'
    });

    // Add comment
    addComment({
      auditIssueId: selectedIssue.id,
      userId: user?.email || '',
      userName: user?.name || '',
      content: `Evidence marked as ${evidenceStatus}. ${reviewComments}`,
      type: 'review'
    });

    toast({
      title: "Review Submitted",
      description: `Evidence has been marked as ${evidenceStatus.toLowerCase()}.`,
    });

    setReviewModalOpen(false);
    setSelectedIssue(null);
    setReviewComments('');
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
          ) : issue.evidenceStatus === 'Insufficient' ? (
            <AlertCircle className="h-4 w-4 text-red-500" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
          <span>Review</span>
        </Button>
      )}
      {issue.evidenceStatus && (
        <Badge className={issue.evidenceStatus === 'Accepted' ? 'bg-green-500' : 'bg-red-500'}>
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
        <TabsList className="grid w-fit grid-cols-2">
          <TabsTrigger value="audit-issues">Audit Issues</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="audit-issues" className="space-y-4">
          <AuditTable
            auditIssues={auditIssues}
            showCreateButton={true}
            title="All Audit Issues"
            actionColumn={getActionColumn}
          />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Analytics auditIssues={auditIssues} title="Audit Analytics Dashboard" />
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
              <Select value={evidenceStatus} onValueChange={(value: any) => setEvidenceStatus(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Accepted">Accepted</SelectItem>
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
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setReviewModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submitReview} className="bg-gradient-to-r from-blue-500 to-green-500">
                Submit Review
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
