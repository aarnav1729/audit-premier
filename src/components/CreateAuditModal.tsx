
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { AuditIssue } from '@/types/audit';
import { useAuditStorage } from '@/hooks/useAuditStorage';
import { toast } from '@/hooks/use-toast';

interface CreateAuditModalProps {
  open: boolean;
  onClose: () => void;
}

const FISCAL_YEARS = ['2022-23', '2023-24', '2024-25', '2025-26'];
const PROCESSES = ['ITGC', 'Bank & Treasury', 'O2C', 'FSCP', 'Compliance Management'];
const ENTITIES = ['PEL', 'PSPT', 'PEPPL', 'PEIPL', 'PEGEPL'];
const RISK_LEVELS = ['high', 'medium', 'low'] as const;
const STATUSES = ['Received', 'To Be Received'] as const;

export const CreateAuditModal: React.FC<CreateAuditModalProps> = ({ open, onClose }) => {
  const { addAuditIssue } = useAuditStorage();
  const [isLoading, setIsLoading] = useState(false);
  const [timeline, setTimeline] = useState<Date>();
  
  const [formData, setFormData] = useState({
    fiscalYear: '',
    date: new Date().toISOString().split('T')[0],
    process: '',
    entityCovered: '',
    observation: '',
    riskLevel: 'medium' as const,
    recommendation: '',
    managementComment: '',
    personResponsible: '',
    approver: '',
    cxoResponsible: '',
    currentStatus: 'To Be Received' as const,
    riskAnnexure: '',
    actionRequired: '',
    iaComments: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const auditIssue: Omit<AuditIssue, 'id' | 'serialNumber' | 'createdAt' | 'updatedAt'> = {
        ...formData,
        timeline: timeline ? timeline.toISOString() : '',
        evidenceReceived: []
      };

      addAuditIssue(auditIssue);
      
      toast({
        title: "Audit Issue Created",
        description: "New audit issue has been successfully created.",
      });
      
      onClose();
      
      // Reset form
      setFormData({
        fiscalYear: '',
        date: new Date().toISOString().split('T')[0],
        process: '',
        entityCovered: '',
        observation: '',
        riskLevel: 'medium',
        recommendation: '',
        managementComment: '',
        personResponsible: '',
        approver: '',
        cxoResponsible: '',
        currentStatus: 'To Be Received',
        riskAnnexure: '',
        actionRequired: '',
        iaComments: ''
      });
      setTimeline(undefined);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create audit issue. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Create New Audit Issue</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fiscalYear">Fiscal Year *</Label>
              <Select value={formData.fiscalYear} onValueChange={(value) => setFormData({...formData, fiscalYear: value})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select fiscal year" />
                </SelectTrigger>
                <SelectContent>
                  {FISCAL_YEARS.map(year => (
                    <SelectItem key={year} value={year}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="process">Process *</Label>
              <Select value={formData.process} onValueChange={(value) => setFormData({...formData, process: value})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select process" />
                </SelectTrigger>
                <SelectContent>
                  {PROCESSES.map(process => (
                    <SelectItem key={process} value={process}>{process}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="entityCovered">Entity Covered *</Label>
              <Select value={formData.entityCovered} onValueChange={(value) => setFormData({...formData, entityCovered: value})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITIES.map(entity => (
                    <SelectItem key={entity} value={entity}>{entity}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="riskLevel">Risk Level *</Label>
              <Select value={formData.riskLevel} onValueChange={(value: any) => setFormData({...formData, riskLevel: value})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select risk level" />
                </SelectTrigger>
                <SelectContent>
                  {RISK_LEVELS.map(level => (
                    <SelectItem key={level} value={level}>
                      <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                        level === 'high' ? 'bg-red-500' : 
                        level === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                      }`}></span>
                      {level.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currentStatus">Current Status *</Label>
              <Select value={formData.currentStatus} onValueChange={(value: any) => setFormData({...formData, currentStatus: value})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map(status => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Timeline</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !timeline && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {timeline ? format(timeline, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={timeline}
                    onSelect={setTimeline}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="personResponsible">Person Responsible (Email) *</Label>
              <Input
                id="personResponsible"
                type="email"
                value={formData.personResponsible}
                onChange={(e) => setFormData({...formData, personResponsible: e.target.value})}
                placeholder="person@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="approver">Approver (Email) *</Label>
              <Input
                id="approver"
                type="email"
                value={formData.approver}
                onChange={(e) => setFormData({...formData, approver: e.target.value})}
                placeholder="approver@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cxoResponsible">CXO Responsible (Email) *</Label>
              <Input
                id="cxoResponsible"
                type="email"
                value={formData.cxoResponsible}
                onChange={(e) => setFormData({...formData, cxoResponsible: e.target.value})}
                placeholder="cxo@example.com"
                required
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="observation">Observation *</Label>
              <Textarea
                id="observation"
                value={formData.observation}
                onChange={(e) => setFormData({...formData, observation: e.target.value})}
                placeholder="Describe the audit observation..."
                required
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="recommendation">Recommendation *</Label>
              <Textarea
                id="recommendation"
                value={formData.recommendation}
                onChange={(e) => setFormData({...formData, recommendation: e.target.value})}
                placeholder="Provide recommendations..."
                required
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="managementComment">Management Comment</Label>
              <Textarea
                id="managementComment"
                value={formData.managementComment}
                onChange={(e) => setFormData({...formData, managementComment: e.target.value})}
                placeholder="Management comments..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="riskAnnexure">Risk Annexure</Label>
                <Textarea
                  id="riskAnnexure"
                  value={formData.riskAnnexure}
                  onChange={(e) => setFormData({...formData, riskAnnexure: e.target.value})}
                  placeholder="Risk annexure details..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="actionRequired">Action Required</Label>
                <Textarea
                  id="actionRequired"
                  value={formData.actionRequired}
                  onChange={(e) => setFormData({...formData, actionRequired: e.target.value})}
                  placeholder="Required actions..."
                  rows={2}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="iaComments">IA Comments</Label>
              <Textarea
                id="iaComments"
                value={formData.iaComments}
                onChange={(e) => setFormData({...formData, iaComments: e.target.value})}
                placeholder="Internal audit comments..."
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600">
              {isLoading ? "Creating..." : "Create Audit Issue"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
