// root/src/components/ExcelUpload.tsx

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Download, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export const ExcelUpload: React.FC = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requiredColumns = [
    'S.NO', 'FY', 'Process', 'Entity covered', 'Observation', 'Risk',
    'Recommendation', 'Management Comment', 'Person Responsible', 'Approver',
    'CXO', 'Timeline', 'Current status', 'Evidence', 'Review comments on Evidence Shared',
    'Risk', 'Annexure', 'Action required', 'Management comments', 'IA Comments'
  ];

  const downloadTemplate = () => {
    const csvContent = requiredColumns.join('\t') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit_issues_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Template Downloaded",
      description: "CSV template has been downloaded successfully.",
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:30443/api/audit-issues/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || result.message || 'Upload failed');
      }

      toast({
        title: "Upload Complete",
        description: result.message,
      });

      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Excel Upload</h2>
          <p className="text-gray-600 mt-1">Bulk import audit issues from CSV/Excel files</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Upload className="h-5 w-5" />
              <span>Upload File</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <FileSpreadsheet className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">Upload your CSV or Excel file</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isProcessing}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="bg-gradient-to-r from-blue-500 to-green-500"
              >
                {isProcessing ? 'Processing...' : 'Choose File'}
              </Button>
            </div>

            <div className="flex items-start space-x-2 p-3 bg-blue-50 rounded-lg">
              <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
              <div className="text-sm text-blue-700">
                <p className="font-medium">Important Notes:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>S.NO column should be left blank (auto-generated)</li>
                  <li>Use tab-separated values or the exact column headers</li>
                  <li>Supported formats: CSV, Excel (.xlsx, .xls)</li>
                  <li>Date format: YYYY-MM-DD for Timeline</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Template Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Download className="h-5 w-5" />
              <span>Download Template</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600">
              Download the template file with the required format and column headers.
            </p>
            <Button
              onClick={downloadTemplate}
              variant="outline"
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              Download CSV Template
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Required Format Table */}
      <Card>
        <CardHeader>
          <CardTitle>Required Format</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {requiredColumns.map((column, index) => (
                    <TableHead key={index} className="whitespace-nowrap">
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-gray-500 italic">(auto-generated)</TableCell>
                  <TableCell>2024-25</TableCell>
                  <TableCell>ITGC</TableCell>
                  <TableCell>PEL</TableCell>
                  <TableCell>Sample observation...</TableCell>
                  <TableCell>high</TableCell>
                  <TableCell>Sample recommendation...</TableCell>
                  <TableCell>Sample comment...</TableCell>
                  <TableCell>user@example.com</TableCell>
                  <TableCell>approver@example.com</TableCell>
                  <TableCell>cxo@example.com</TableCell>
                  <TableCell>2024-12-31</TableCell>
                  <TableCell>To Be Received</TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell>high</TableCell>
                  <TableCell>Sample annexure...</TableCell>
                  <TableCell>Sample action...</TableCell>
                  <TableCell>Sample mgmt comment...</TableCell>
                  <TableCell>Sample IA comment...</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};