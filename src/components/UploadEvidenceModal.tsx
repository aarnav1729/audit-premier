// root/src/components/UploadEvidenceModal.tsx

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Upload, File, X } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Evidence } from '@/types/audit';

interface UploadEvidenceModalProps {
  open: boolean;
  onClose: () => void;
  onUpload: (evidence: Evidence[]) => void;
  auditIssueId: string;
  userEmail: string;
}

export const UploadEvidenceModal: React.FC<UploadEvidenceModalProps> = ({
  open,
  onClose,
  onUpload,
  auditIssueId,
  userEmail
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [textEvidence, setTextEvidence] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0 && !textEvidence.trim()) return;
    setIsLoading(true);

    try {
      const formData = new FormData();
      files.forEach(file => formData.append('evidence', file));
      formData.append('uploadedBy', userEmail);
      if (textEvidence.trim()) {
        formData.append('textEvidence', textEvidence.trim());
      }

      const res = await fetch(
        `https://audit-premier.onrender.com/api/audit-issues/${auditIssueId}/evidence`,
        { method: 'POST', body: formData }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }

      const result = await res.json();
      toast({
        title: "Proof Uploaded",
        description: result.message,
      });

      // build Evidence[] for local update
      const newEvidence: Evidence[] = files.map(file => ({
        id: Date.now().toString() + Math.random().toString(36).substr(2,9),
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userEmail
      }));

      onUpload(newEvidence);
      setFiles([]);
      setTextEvidence('');
      onClose();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload evidence",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Evidence</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="file-upload">Upload Files</Label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <div className="mt-2">
                <Label htmlFor="file-upload" className="cursor-pointer">
                  <span className="text-blue-600 hover:text-blue-500">Upload files</span>
                  <span className="text-gray-500"> or drag and drop</span>
                </Label>
                <Input
                  id="file-upload"
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Any file type, no size restriction
              </p>
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <Label>Selected Files</Label>
              <div className="space-y-2">
                {files.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <File className="h-5 w-5 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{file.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeFile(idx)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="text-evidence">Text Evidence (Optional)</Label>
            <Textarea
              id="text-evidence"
              value={textEvidence}
              onChange={e => setTextEvidence(e.target.value)}
              placeholder="Additional comments..."
              rows={4}
            />
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || (files.length === 0 && !textEvidence.trim())}
              className="bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600"
            >
              {isLoading ? 'Uploading...' : 'Upload Evidence'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
