
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
  onUpload: (evidence: Evidence[], textEvidence?: string) => void;
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
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const evidenceFiles: Evidence[] = [];

      // Process file uploads
      for (const file of files) {
        const reader = new FileReader();
        const base64Data = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });

        const evidence: Evidence = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: userEmail,
          base64Data
        };

        evidenceFiles.push(evidence);
      }

      // Add text evidence if provided
      if (textEvidence.trim()) {
        const textEvidenceFile: Evidence = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          fileName: 'Text Evidence',
          fileType: 'text/plain',
          fileSize: textEvidence.length,
          uploadedAt: new Date().toISOString(),
          uploadedBy: userEmail,
          content: textEvidence
        };
        evidenceFiles.push(textEvidenceFile);
      }

      onUpload(evidenceFiles, textEvidence);
      
      toast({
        title: "Evidence Uploaded",
        description: "Evidence has been successfully uploaded.",
      });

      // Reset form
      setFiles([]);
      setTextEvidence('');
      onClose();
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: "Failed to upload evidence. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
                Any file type, up to 10MB per file
              </p>
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <Label>Selected Files</Label>
              <div className="space-y-2">
                {files.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <File className="h-5 w-5 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{file.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                    >
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
              onChange={(e) => setTextEvidence(e.target.value)}
              placeholder="Enter any additional text evidence or comments..."
              rows={4}
            />
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading || (files.length === 0 && !textEvidence.trim())}
              className="bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600"
            >
              {isLoading ? "Uploading..." : "Upload Evidence"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
