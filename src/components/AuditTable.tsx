
import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, ArrowUpDown, Plus, Filter } from 'lucide-react';
import { AuditIssue } from '@/types/audit';
import { CreateAuditModal } from './CreateAuditModal';

interface AuditTableProps {
  auditIssues: AuditIssue[];
  showCreateButton?: boolean;
  title?: string;
  actionColumn?: (issue: AuditIssue) => React.ReactNode;
}

export const AuditTable: React.FC<AuditTableProps> = ({ 
  auditIssues, 
  showCreateButton = false, 
  title = "Audit Issues",
  actionColumn 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<keyof AuditIssue>('serialNumber');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterRisk, setFilterRisk] = useState<string>('all');
  const [filterFiscalYear, setFilterFiscalYear] = useState<string>('all');
  const [filterProcess, setFilterProcess] = useState<string>('all');
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const highlightText = (text: string, searchTerm: string) => {
    if (!searchTerm) return text;
    
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className="highlight">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const filteredAndSortedIssues = useMemo(() => {
    let filtered = auditIssues.filter(issue => {
      const matchesSearch = searchTerm === '' || 
        Object.values(issue).some(value => 
          value?.toString().toLowerCase().includes(searchTerm.toLowerCase())
        );
      
      const matchesStatus = filterStatus === 'all' || issue.currentStatus === filterStatus;
      const matchesRisk = filterRisk === 'all' || issue.riskLevel === filterRisk;
      const matchesFiscalYear = filterFiscalYear === 'all' || issue.fiscalYear === filterFiscalYear;
      const matchesProcess = filterProcess === 'all' || issue.process === filterProcess;
      
      return matchesSearch && matchesStatus && matchesRisk && matchesFiscalYear && matchesProcess;
    });

    filtered.sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [auditIssues, searchTerm, sortField, sortDirection, filterStatus, filterRisk, filterFiscalYear, filterProcess]);

  const handleSort = (field: keyof AuditIssue) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getRiskBadgeColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusBadgeColor = (status: string) => {
    return status === 'Received' ? 'bg-green-500' : 'bg-orange-500';
  };

  const fiscalYears = [...new Set(auditIssues.map(issue => issue.fiscalYear))];
  const processes = [...new Set(auditIssues.map(issue => issue.process))];

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-semibold">{title}</CardTitle>
          {showCreateButton && (
            <Button 
              onClick={() => setCreateModalOpen(true)}
              className="bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New
            </Button>
          )}
        </div>
        
        <div className="flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-64">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search across all fields..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="flex gap-2 items-center">
            <Filter className="h-4 w-4 text-gray-500" />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Received">Received</SelectItem>
                <SelectItem value="To Be Received">To Be Received</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={filterRisk} onValueChange={setFilterRisk}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Risk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={filterFiscalYear} onValueChange={setFilterFiscalYear}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {fiscalYears.map(year => (
                  <SelectItem key={year} value={year}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={filterProcess} onValueChange={setFilterProcess}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Process" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Processes</SelectItem>
                {processes.map(process => (
                  <SelectItem key={process} value={process}>{process}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => handleSort('serialNumber')}
                >
                  <div className="flex items-center">
                    S.No
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => handleSort('fiscalYear')}
                >
                  <div className="flex items-center">
                    Fiscal Year
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => handleSort('date')}
                >
                  <div className="flex items-center">
                    Date
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => handleSort('process')}
                >
                  <div className="flex items-center">
                    Process
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Observation</TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => handleSort('riskLevel')}
                >
                  <div className="flex items-center">
                    Risk Level
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead>Person Responsible</TableHead>
                <TableHead>CXO Responsible</TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => handleSort('currentStatus')}
                >
                  <div className="flex items-center">
                    Status
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                {actionColumn && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedIssues.map((issue) => (
                <TableRow key={issue.id} className="hover:bg-gray-50 transition-colors">
                  <TableCell className="font-medium">{issue.serialNumber}</TableCell>
                  <TableCell>{highlightText(issue.fiscalYear, searchTerm)}</TableCell>
                  <TableCell>{highlightText(new Date(issue.date).toLocaleDateString(), searchTerm)}</TableCell>
                  <TableCell>{highlightText(issue.process, searchTerm)}</TableCell>
                  <TableCell>{highlightText(issue.entityCovered, searchTerm)}</TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate" title={issue.observation}>
                      {highlightText(issue.observation, searchTerm)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`${getRiskBadgeColor(issue.riskLevel)} text-white`}>
                      {issue.riskLevel.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate" title={issue.recommendation}>
                      {highlightText(issue.recommendation, searchTerm)}
                    </div>
                  </TableCell>
                  <TableCell>{highlightText(issue.personResponsible, searchTerm)}</TableCell>
                  <TableCell>{highlightText(issue.cxoResponsible, searchTerm)}</TableCell>
                  <TableCell>
                    <Badge className={`${getStatusBadgeColor(issue.currentStatus)} text-white`}>
                      {issue.currentStatus}
                    </Badge>
                  </TableCell>
                  {actionColumn && <TableCell>{actionColumn(issue)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {filteredAndSortedIssues.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No audit issues found matching your criteria.
            </div>
          )}
        </div>
      </CardContent>
      
      <CreateAuditModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} />
    </Card>
  );
};
