type AuditStatus =
  | "To Be Received"
  | "Received"
  | "Partially Received"
  | "In Progress"
  | "Resolved"
  | "Closed";

export interface AuditIssue {
  id: string;
  serialNumber: number;
  fiscalYear: string;
  date: string;
  process: string;
  entityCovered: string;
  observation: string;
  riskLevel: "high" | "medium" | "low";
  recommendation: string;
  managementComment: string;
  personResponsible: string;
  approver: string;
  cxoResponsible: string;
  timeline: string;
  currentStatus: AuditStatus;
  evidenceReceived: Evidence[];
  evidenceStatus?: 'Insufficient' | 'Accepted' | 'Partially Accepted';
  reviewComments?: string;
  risk: string;
  actionRequired: string;
  startMonth?: string;
  endMonth?: string;
  coOwner?: string;
  annexureAttachment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  uploadedBy: string;
  content?: string;
  base64Data?: string;
}

export interface User {
  email: string;
  role: "auditor" | "user" | "approver";
  name: string;
}

export interface Comment {
  id: string;
  auditIssueId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
  type: "review" | "general";
}
