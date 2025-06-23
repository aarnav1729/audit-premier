// root/src/components/CreateAuditModal.tsx
import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useAuditStorage } from '@/hooks/useAuditStorage'
import { toast } from '@/hooks/use-toast'

interface CreateAuditModalProps {
  open: boolean
  onClose: () => void
}

const FISCAL_YEARS = ['2022-23','2023-24','2024-25','2025-26']
const PROCESSES = [
  'Procure to Pay','Inventory Management','Order to Cash',
  'Production Planning and Quality Control','HR & Payroll',
  'Compliance Monitoring Mechanism','Financial Statement Close Procedures',
  'Bank & Treasury','Fixed Asset Management','Information Technology General Controls',
  'Project Management Review','SAP Security Controls Review',
  'Environment, Health and Safety (EHS)','Specific Expense Management Review'
]
const ENTITIES = ['PEL','PSPT','PEPPL','PEIPL','PEGEPL']
const RISK_LEVELS = ['high','medium','low'] as const
const STATUSES = ['Received','To Be Received'] as const

export const CreateAuditModal: React.FC<CreateAuditModalProps> = ({ open, onClose }) => {
  const { addAuditIssue } = useAuditStorage()
  const [isLoading, setIsLoading] = useState(false)
  const [timeline, setTimeline] = useState<Date>()
  const [samePerson, setSamePerson] = useState(true)

  const [formData, setFormData] = useState({
    fiscalYear: '',
    date: new Date().toISOString().split('T')[0],
    process: '',
    entities: [] as string[],
    observation: '',
    riskLevel: 'medium' as typeof RISK_LEVELS[number],
    recommendation: '',
    managementComment: '',
    // if samePerson: use personResponsible; else use byEntityResponsibles
    personResponsible: '',
    byEntityResponsibles: {} as Record<string,string>,
    approver: '',
    cxoResponsible: '',
    currentStatus: 'To Be Received' as typeof STATUSES[number],
    riskAnnexureText: '',
    riskAnnexureFile: null as File|null,
    actionRequired: '',
    iaComments: '',
  })

  const toggleEntity = (ent: string) => {
    setFormData(fd => {
      const list = fd.entities.includes(ent)
        ? fd.entities.filter(e => e!==ent)
        : [...fd.entities, ent]
      return { ...fd, entities: list }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.entities.length === 0) {
      toast({ title: 'Select at least one Entity', variant: 'destructive' })
      return
    }
    setIsLoading(true)
    try {
      // for each entity, build one FormData and POST
      await Promise.all(formData.entities.map(async ent => {
        const payload = new FormData()
        payload.append('fiscalYear', formData.fiscalYear)
        payload.append('date', formData.date)
        payload.append('process', formData.process)
        payload.append('entityCovered', ent)
        payload.append('observation', formData.observation)
        payload.append('riskLevel', formData.riskLevel)
        payload.append('recommendation', formData.recommendation)
        payload.append('managementComment', formData.managementComment)
        // personResponsible:
        const pr = samePerson
          ? formData.personResponsible
          : formData.byEntityResponsibles[ent] || ''
        payload.append('personResponsible', pr)
        payload.append('approver', formData.approver)
        payload.append('cxoResponsible', formData.cxoResponsible)
        if (timeline) payload.append('timeline', timeline.toISOString().split('T')[0])
        payload.append('currentStatus', formData.currentStatus)
        payload.append('riskAnnexure', formData.riskAnnexureText)
        if (formData.riskAnnexureFile) {
          payload.append('annexure', formData.riskAnnexureFile)
        }
        payload.append('actionRequired', formData.actionRequired)
        payload.append('iaComments', formData.iaComments)

        const res = await fetch('http://localhost:30443/api/audit-issues', {
          method: 'POST',
          body: payload
        })
        if (!res.ok) throw new Error(`Entity ${ent} failed (${res.status})`)
        const created = await res.json()
        addAuditIssue(created)  // mirror in local storage
      }))

      toast({ title: 'All issues created successfully' })
      onClose()
      // reset
      setFormData({
        fiscalYear: '', date: new Date().toISOString().split('T')[0],
        process: '', entities: [], observation: '',
        riskLevel: 'medium', recommendation: '', managementComment: '',
        personResponsible: '', byEntityResponsibles: {},
        approver: '', cxoResponsible: '',
        currentStatus: 'To Be Received', riskAnnexureText: '',
        riskAnnexureFile: null, actionRequired: '', iaComments: ''
      })
      setTimeline(undefined)
      setSamePerson(true)
    } catch (err) {
      console.error(err)
      toast({ title: 'Error creating issues', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Create New Audit Issue</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* fiscalYear, date, process */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Fiscal Year */}
            <div className="space-y-2">
              <Label>Fiscal Year *</Label>
              <Select
                value={formData.fiscalYear}
                onValueChange={v => setFormData(fd=>({...fd, fiscalYear:v}))}>
                <SelectTrigger><SelectValue placeholder="Select fiscal year"/></SelectTrigger>
                <SelectContent>
                  {FISCAL_YEARS.map(y=>(
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Date */}
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={formData.date}
                onChange={e=>setFormData(fd=>({...fd, date:e.target.value}))}
                required />
            </div>
            {/* Process */}
            <div className="space-y-2">
              <Label>Process *</Label>
              <Select
                value={formData.process}
                onValueChange={v=>setFormData(fd=>({...fd, process:v}))}>
                <SelectTrigger><SelectValue placeholder="Select process"/></SelectTrigger>
                <SelectContent>
                  {PROCESSES.map(p=>(
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Entity Covered checkboxes */}
          <div className="space-y-2">
            <Label>Entity Covered *</Label>
            <div className="flex flex-wrap gap-4">
              {ENTITIES.map(ent=>(
                <label key={ent} className="inline-flex items-center space-x-2">
                  <Checkbox
                    checked={formData.entities.includes(ent)}
                    onCheckedChange={()=>toggleEntity(ent)} />
                  <span>{ent}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Responsible toggle & inputs */}
          <div className="flex items-center space-x-4">
            <Checkbox
              checked={samePerson}
              onCheckedChange={v=>setSamePerson(Boolean(v))} />
            <Label>Same person responsible for all entities?</Label>
          </div>
          {samePerson
            ? (
              <div className="space-y-2">
                <Label>Person Responsible (Email) *</Label>
                <Input
                  type="email"
                  value={formData.personResponsible}
                  onChange={e=>setFormData(fd=>({...fd, personResponsible:e.target.value}))}
                  placeholder="person@example.com"
                  required />
              </div>
            )
            : formData.entities.map(ent=>(
              <div key={ent} className="space-y-2">
                <Label>Person Responsible for {ent} *</Label>
                <Input
                  type="email"
                  value={formData.byEntityResponsibles[ent]||''}
                  onChange={e=>{
                    const val=e.target.value
                    setFormData(fd=>({
                      ...fd,
                      byEntityResponsibles:{...fd.byEntityResponsibles, [ent]:val}
                    }))
                  }}
                  placeholder="person@example.com"
                  required />
              </div>
            ))
          }

          {/* Approver & CXO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Approver (Email) *</Label>
              <Input
                type="email"
                value={formData.approver}
                onChange={e=>setFormData(fd=>({...fd, approver:e.target.value}))}
                required />
            </div>
            <div className="space-y-2">
              <Label>CXO Responsible (Email) *</Label>
              <Input
                type="email"
                value={formData.cxoResponsible}
                onChange={e=>setFormData(fd=>({...fd, cxoResponsible:e.target.value}))}
                required />
            </div>
          </div>

          {/* Observation / Recommendation */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Observation *</Label>
              <Textarea
                rows={3}
                value={formData.observation}
                onChange={e=>setFormData(fd=>({...fd, observation:e.target.value}))}
                required />
            </div>
            <div className="space-y-2">
              <Label>Recommendation *</Label>
              <Textarea
                rows={3}
                value={formData.recommendation}
                onChange={e=>setFormData(fd=>({...fd, recommendation:e.target.value}))}
                required />
            </div>
          </div>

          {/* Risk Level / Status / Timeline */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Risk Level *</Label>
              <Select
                value={formData.riskLevel}
                onValueChange={v=>setFormData(fd=>({...fd, riskLevel:v as any}))}>
                <SelectTrigger><SelectValue placeholder="Select risk level"/></SelectTrigger>
                <SelectContent>
                  {RISK_LEVELS.map(l=>(
                    <SelectItem key={l} value={l}>
                      <span className={cn(
                        'inline-block w-2 h-2 rounded-full mr-2',
                        l==='high'?'bg-red-500':l==='medium'?'bg-yellow-500':'bg-green-500'
                      )} />
                      {l.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Current Status *</Label>
              <Select
                value={formData.currentStatus}
                onValueChange={v=>setFormData(fd=>({...fd, currentStatus:v as any}))}>
                <SelectTrigger><SelectValue placeholder="Select status"/></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s=>(
                    <SelectItem key={s} value={s}>{s}</SelectItem>
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
                    className={cn("w-full justify-start text-left", !timeline && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {timeline ? format(timeline, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="p-0">
                  <Calendar
                    mode="single"
                    selected={timeline}
                    onSelect={setTimeline}
                    className="p-3"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Risk Annexure (text + file) */}
          <div className="space-y-2">
            <Label>Risk Annexure</Label>
            <Textarea
              rows={2}
              value={formData.riskAnnexureText}
              onChange={e=>setFormData(fd=>({...fd, riskAnnexureText:e.target.value}))} />
            <input
              type="file"
              onChange={e=>setFormData(fd=>({...fd, riskAnnexureFile:e.target.files?.[0]||null}))} />
          </div>

          {/* Action Required / IA Comments */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Action Required</Label>
              <Textarea
                rows={2}
                value={formData.actionRequired}
                onChange={e=>setFormData(fd=>({...fd, actionRequired:e.target.value}))} />
            </div>
            <div className="space-y-2">
              <Label>IA Comments</Label>
              <Textarea
                rows={2}
                value={formData.iaComments}
                onChange={e=>setFormData(fd=>({...fd, iaComments:e.target.value}))} />
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Creating…' : 'Create Audit Issue'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}