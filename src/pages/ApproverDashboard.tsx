import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Eye, MessageSquare } from 'lucide-react';
import { AuditTable } from '@/components/AuditTable';
import { Analytics } from '@/components/Analytics';
import { EvidenceViewer } from '@/components/EvidenceViewer';
import { useAuditStorage } from '@/hooks/useAuditStorage';
import { useAuth } from '@/hooks/useAuth';
import { AuditIssue, Evidence } from '@/types/audit';
import { toast } from '@/hooks/use-toast';

export const ApproverDashboard: React.FC = () => {
  const { auditIssues, addComment } = useAuditStorage();
  const { user } = useAuth();
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence[]>([]);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<AuditIssue | null>(null);
  const [comment, setComment] = useState('');

  // Filter issues where user is CXO responsible or approver
  const approverIssues = auditIssues.filter(issue => 
    issue.cxoResponsible === user?.email || issue.approver === user?.email
  );

  const viewEvidence = (issue: AuditIssue) => {
    setSelectedEvidence(issue.evidenceReceived);
    setEvidenceModalOpen(true);
  };

  const openCommentModal = (issue: AuditIssue) => {
    setSelectedIssue(issue);
    setComment('');
    setCommentModalOpen(true);
  };

  const submitComment = () => {
    if (!selectedIssue || !comment.trim()) return;

    addComment({
      auditIssueId: selectedIssue.id,
      userId: user?.email || '',
      userName: user?.name || '',
      content: comment,
      type: 'general'
    });

    toast({
      title: "Comment Added",
      description: "Your comment has been successfully added.",
    });

    setCommentModalOpen(false);
    setSelectedIssue(null);
    setComment('');
  };

  const getActionColumn = (issue: AuditIssue) => (
    <div className="flex space-x-2 items-center">
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
      
      <Button
        variant="outline"
        size="sm"
        onClick={() => openCommentModal(issue)}
        className="flex items-center space-x-1"
      >
        <MessageSquare className="h-4 w-4" />
        <span>Add Comment</span>
      </Button>
      
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
          <h1 className="text-3xl font-bold text-gray-900">Approver Dashboard</h1>
          <p className="text-gray-600 mt-1">Review and approve audit issues</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">Issues for Review</p>
          <p className="text-2xl font-bold text-purple-600">{approverIssues.length}</p>
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
            title="Issues for Review & Approval"
            actionColumn={getActionColumn}
          />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Analytics title="Approver Analytics Dashboard" />
        </TabsContent>
      </Tabs>

      {/* Evidence Viewer Modal */}
      <EvidenceViewer
        open={evidenceModalOpen}
        onClose={() => setEvidenceModalOpen(false)}
        evidence={selectedEvidence}
        title="Evidence Files"
      />

      {/* Comment Modal */}
      <Dialog open={commentModalOpen} onOpenChange={setCommentModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Comment</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Your Comment</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add your comments about this audit issue..."
                rows={4}
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setCommentModalOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={submitComment} 
                disabled={!comment.trim()}
                className="bg-gradient-to-r from-blue-500 to-green-500"
              >
                Add Comment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
