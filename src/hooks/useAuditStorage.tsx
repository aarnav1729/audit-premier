
import { useState, useEffect } from 'react';
import { AuditIssue, Comment } from '@/types/audit';

const STORAGE_KEY = 'audit_issues';
const COMMENTS_KEY = 'audit_comments';

export const useAuditStorage = () => {
  const [auditIssues, setAuditIssues] = useState<AuditIssue[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const storedComments = localStorage.getItem(COMMENTS_KEY);
    
    if (stored) {
      setAuditIssues(JSON.parse(stored));
    }
    if (storedComments) {
      setComments(JSON.parse(storedComments));
    }
  }, []);

  const saveAuditIssues = (issues: AuditIssue[]) => {
    setAuditIssues(issues);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(issues));
  };

  const saveComments = (newComments: Comment[]) => {
    setComments(newComments);
    localStorage.setItem(COMMENTS_KEY, JSON.stringify(newComments));
  };

  const addAuditIssue = (issue: Omit<AuditIssue, 'id' | 'serialNumber' | 'createdAt' | 'updatedAt'>) => {
    const newIssue: AuditIssue = {
      ...issue,
      id: Date.now().toString(),
      serialNumber: auditIssues.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const updatedIssues = [...auditIssues, newIssue];
    saveAuditIssues(updatedIssues);
    return newIssue;
  };

  const updateAuditIssue = (id: string, updates: Partial<AuditIssue>) => {
    const updatedIssues = auditIssues.map(issue =>
      issue.id === id
        ? { ...issue, ...updates, updatedAt: new Date().toISOString() }
        : issue
    );
    saveAuditIssues(updatedIssues);
  };

  const addComment = (comment: Omit<Comment, 'id' | 'createdAt'>) => {
    const newComment: Comment = {
      ...comment,
      id: Date.now().toString(),
      createdAt: new Date().toISOString()
    };
    
    const updatedComments = [...comments, newComment];
    saveComments(updatedComments);
    return newComment;
  };

  return {
    auditIssues,
    comments,
    addAuditIssue,
    updateAuditIssue,
    addComment
  };
};
