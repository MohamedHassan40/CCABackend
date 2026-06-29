export const PMO_PHASES = ['design', 'preparation', 'planning', 'execution', 'closing'] as const;
export type PmoPhase = (typeof PMO_PHASES)[number];

export type PhaseToolDef = {
  key: string;
  tab: string;
  mandatory: boolean;
  labelKey: string;
};

export const PMO_PHASE_TOOLS: Record<PmoPhase, PhaseToolDef[]> = {
  design: [
    { key: 'basicInfo', tab: 'overview', mandatory: true, labelKey: 'pmo.lifecycle.tool.basicInfo' },
    { key: 'problem', tab: 'design', mandatory: true, labelKey: 'pmo.lifecycle.tool.problem' },
    { key: 'objectives', tab: 'design', mandatory: true, labelKey: 'pmo.lifecycle.tool.objectives' },
    { key: 'targetAudience', tab: 'design', mandatory: true, labelKey: 'pmo.lifecycle.tool.targetAudience' },
    { key: 'mainOutputs', tab: 'design', mandatory: true, labelKey: 'pmo.lifecycle.tool.mainOutputs' },
    { key: 'swot', tab: 'design', mandatory: false, labelKey: 'pmo.lifecycle.tool.swot' },
    { key: 'problemTree', tab: 'design', mandatory: false, labelKey: 'pmo.lifecycle.tool.problemTree' },
    { key: 'objectiveTree', tab: 'design', mandatory: false, labelKey: 'pmo.lifecycle.tool.objectiveTree' },
    { key: 'logicalFramework', tab: 'design', mandatory: false, labelKey: 'pmo.lifecycle.tool.logicalFramework' },
  ],
  preparation: [
    { key: 'charter', tab: 'charter', mandatory: true, labelKey: 'pmo.lifecycle.tool.charter' },
    { key: 'projectManager', tab: 'managers', mandatory: true, labelKey: 'pmo.lifecycle.tool.projectManager' },
    { key: 'team', tab: 'managers', mandatory: true, labelKey: 'pmo.lifecycle.tool.team' },
    { key: 'stakeholders', tab: 'stakeholders', mandatory: true, labelKey: 'pmo.lifecycle.tool.stakeholders' },
    { key: 'riskPlan', tab: 'risks', mandatory: true, labelKey: 'pmo.lifecycle.tool.riskPlan' },
  ],
  planning: [
    { key: 'executivePlan', tab: 'executivePlan', mandatory: true, labelKey: 'pmo.lifecycle.tool.executivePlan' },
    { key: 'financialPlan', tab: 'budget', mandatory: false, labelKey: 'pmo.lifecycle.tool.financialPlan' },
    { key: 'wbs', tab: 'wbs', mandatory: false, labelKey: 'pmo.lifecycle.tool.wbs' },
    { key: 'raci', tab: 'raci', mandatory: false, labelKey: 'pmo.lifecycle.tool.raci' },
    { key: 'communication', tab: 'plans', mandatory: false, labelKey: 'pmo.lifecycle.tool.communication' },
    { key: 'resources', tab: 'plans', mandatory: false, labelKey: 'pmo.lifecycle.tool.resources' },
    { key: 'procurement', tab: 'plans', mandatory: false, labelKey: 'pmo.lifecycle.tool.procurement' },
    { key: 'quality', tab: 'plans', mandatory: false, labelKey: 'pmo.lifecycle.tool.quality' },
  ],
  execution: [
    { key: 'tracking', tab: 'executivePlan', mandatory: true, labelKey: 'pmo.lifecycle.tool.tracking' },
    { key: 'issuesLog', tab: 'issues', mandatory: true, labelKey: 'pmo.lifecycle.tool.issuesLog' },
    { key: 'changeRequests', tab: 'changeRequests', mandatory: true, labelKey: 'pmo.lifecycle.tool.changeRequests' },
    { key: 'periodicReports', tab: 'reports', mandatory: true, labelKey: 'pmo.lifecycle.tool.periodicReports' },
  ],
  closing: [
    { key: 'finalReport', tab: 'closure', mandatory: true, labelKey: 'pmo.lifecycle.tool.finalReport' },
    { key: 'certificate', tab: 'closure', mandatory: true, labelKey: 'pmo.lifecycle.tool.certificate' },
    { key: 'lessonsLearned', tab: 'lessons', mandatory: true, labelKey: 'pmo.lifecycle.tool.lessonsLearned' },
  ],
};

export const PHASE_GATE_REQUIREMENTS: Record<PmoPhase, string[]> = {
  design: ['basicInfo', 'problem', 'objectives', 'targetAudience', 'mainOutputs'],
  preparation: ['charter', 'projectManager', 'stakeholders', 'riskPlan'],
  planning: ['executivePlan'],
  execution: ['tracking', 'issuesLog'],
  closing: ['finalReport', 'lessonsLearned'],
};

export function nextPhase(phase: PmoPhase): PmoPhase | null {
  const idx = PMO_PHASES.indexOf(phase);
  return idx >= 0 && idx < PMO_PHASES.length - 1 ? PMO_PHASES[idx + 1] : null;
}

export function prevPhase(phase: PmoPhase): PmoPhase | null {
  const idx = PMO_PHASES.indexOf(phase);
  return idx > 0 ? PMO_PHASES[idx - 1] : null;
}

type DesignData = {
  problemStatement?: string;
  objectives?: string;
  targetAudience?: string;
  mainOutputs?: string;
  swot?: { strengths?: string; weaknesses?: string; opportunities?: string; threats?: string };
  problemTree?: { problem?: string; objectives?: string };
  objectiveTree?: string;
  logicalFramework?: unknown;
};

function asDesignData(raw: unknown): DesignData {
  return (raw && typeof raw === 'object' ? raw : {}) as DesignData;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
}

function hasText(val: unknown): boolean {
  return typeof val === 'string' && val.trim().length > 0;
}

export type ToolStatus = 'not_started' | 'in_progress' | 'completed' | 'under_review' | 'not_added';

export function evaluateToolStatus(
  toolKey: string,
  project: {
    name: string;
    description: string | null;
    designData: unknown;
    projectManagers: unknown[];
    stakeholders: unknown[];
    risks: unknown[];
    charter: { approvalStatus?: string } | null;
    deliverables: unknown[];
    tasks: { status: string }[];
    budgets: unknown[];
    plans: { planType: string }[];
    raciEntries: unknown[];
    issues: unknown[];
    changeRequests: { status: string }[];
    closure: { finalReport?: string | null; certificateNumber?: string | null; closureStatus?: string } | null;
    lessonsLearned: unknown[];
    proposal: { logicalFramework?: unknown; problemTree?: unknown } | null;
  },
): ToolStatus {
  const d = asDesignData(project.designData);

  switch (toolKey) {
    case 'basicInfo':
      return hasText(project.name) && hasText(project.description) ? 'completed' : 'in_progress';
    case 'problem':
      return hasText(d.problemStatement) ? 'completed' : 'not_started';
    case 'objectives':
      return hasText(d.objectives) ? 'completed' : 'not_started';
    case 'targetAudience':
      return hasText(d.targetAudience) ? 'completed' : 'not_started';
    case 'mainOutputs':
      return hasText(d.mainOutputs) ? 'completed' : 'not_started';
    case 'swot': {
      const s = d.swot;
      if (!s) return 'not_added';
      const filled = [s.strengths, s.weaknesses, s.opportunities, s.threats].filter(hasText).length;
      if (filled === 0) return 'not_added';
      return filled >= 4 ? 'completed' : 'in_progress';
    }
    case 'problemTree':
      if (d.problemTree?.problem || d.problemTree?.objectives || project.proposal?.problemTree) return 'completed';
      return 'not_added';
    case 'objectiveTree':
      return hasText(d.objectiveTree) ? 'completed' : 'not_added';
    case 'logicalFramework':
      return d.logicalFramework || project.proposal?.logicalFramework ? 'completed' : 'not_added';
    case 'charter':
      if (!project.charter) return 'not_started';
      if (project.charter.approvalStatus === 'approved') return 'completed';
      if (project.charter.approvalStatus === 'pending') return 'under_review';
      return 'in_progress';
    case 'projectManager':
      return project.projectManagers.length > 0 ? 'completed' : 'not_started';
    case 'team':
      return project.projectManagers.length >= 1 ? 'completed' : 'in_progress';
    case 'stakeholders':
      return project.stakeholders.length > 0 ? 'completed' : 'not_started';
    case 'riskPlan':
      return project.risks.length > 0 ? 'completed' : 'not_started';
    case 'executivePlan':
    case 'tracking': {
      const hasPlan = project.deliverables.length > 0 || project.tasks.length > 0;
      if (!hasPlan) return 'not_started';
      const done = project.tasks.filter((t) => t.status === 'completed').length;
      if (done === project.tasks.length && project.tasks.length > 0) return 'completed';
      return 'in_progress';
    }
    case 'financialPlan':
      return project.budgets.length > 0 ? 'completed' : 'not_added';
    case 'wbs':
      return project.deliverables.some((x: any) => x.parentId || x.wbsCode) ? 'completed' : 'not_added';
    case 'raci':
      return project.raciEntries.length > 0 ? 'completed' : 'not_added';
    case 'communication':
      return project.plans.some((p) => p.planType === 'communication') ? 'completed' : 'not_added';
    case 'resources':
      return project.plans.some((p) => p.planType === 'resource') ? 'completed' : 'not_added';
    case 'procurement':
      return project.plans.some((p) => p.planType === 'procurement') ? 'completed' : 'not_added';
    case 'quality':
      return project.plans.some((p) => p.planType === 'quality') ? 'completed' : 'not_added';
    case 'issuesLog':
      return project.issues.length > 0 ? 'in_progress' : 'not_started';
    case 'changeRequests':
      if (project.changeRequests.length === 0) return 'not_started';
      return project.changeRequests.some((c) => c.status === 'pending') ? 'in_progress' : 'completed';
    case 'periodicReports':
      return project.tasks.length > 0 || project.deliverables.length > 0 ? 'in_progress' : 'not_started';
    case 'finalReport':
      return hasText(project.closure?.finalReport) ? 'completed' : 'not_started';
    case 'certificate':
      return project.closure?.certificateNumber ? 'completed' : 'not_started';
    case 'lessonsLearned':
      return project.lessonsLearned.length > 0 ? 'completed' : 'not_started';
    default:
      return 'not_started';
  }
}

export function isToolComplete(status: ToolStatus): boolean {
  return status === 'completed' || status === 'under_review';
}

export function computePhaseGate(
  phase: PmoPhase,
  project: Parameters<typeof evaluateToolStatus>[1],
  manualChecklist: unknown,
  approvals: unknown,
) {
  const requirements = PHASE_GATE_REQUIREMENTS[phase];
  const manual = asRecord(manualChecklist)[phase] as Record<string, boolean> | undefined;
  const approval = asRecord(approvals)[phase] as { approvedAt?: string } | undefined;

  const items = requirements.map((key) => {
    const tool = PMO_PHASE_TOOLS[phase].find((t) => t.key === key);
    const autoComplete = isToolComplete(evaluateToolStatus(key, project));
    const manualComplete = manual?.[key] === true;
    return {
      key,
      labelKey: tool?.labelKey ?? key,
      completed: autoComplete || manualComplete,
      autoComplete,
      manualComplete,
    };
  });

  const completedCount = items.filter((i) => i.completed).length;
  const totalCount = items.length;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const canApprove = completedCount === totalCount && !approval?.approvedAt;

  return {
    phase,
    items,
    completedCount,
    totalCount,
    percent,
    canApprove,
    approved: !!approval?.approvedAt,
    approval,
  };
}

export function computePhaseProgress(phase: PmoPhase, project: Parameters<typeof evaluateToolStatus>[1]) {
  const tools = PMO_PHASE_TOOLS[phase];
  const mandatory = tools.filter((t) => t.mandatory);
  if (mandatory.length === 0) return 0;
  const done = mandatory.filter((t) => isToolComplete(evaluateToolStatus(t.key, project))).length;
  return Math.round((done / mandatory.length) * 100);
}

export function filterVisibleTools(
  phase: PmoPhase,
  disabledOrgTools: string[],
  enabledProjectTools: string[] | null,
) {
  return PMO_PHASE_TOOLS[phase].filter((tool) => {
    if (disabledOrgTools.includes(tool.key)) return false;
    if (tool.mandatory) return true;
    return enabledProjectTools?.includes(tool.key) ?? false;
  });
}

export function getAvailableOptionalTools(
  phase: PmoPhase,
  disabledOrgTools: string[],
  enabledProjectTools: string[] | null,
) {
  const enabled = new Set(enabledProjectTools ?? []);
  return PMO_PHASE_TOOLS[phase].filter(
    (tool) => !tool.mandatory && !disabledOrgTools.includes(tool.key) && !enabled.has(tool.key),
  );
}

export function getPhaseTabs(phase: PmoPhase): string[] {
  const tabs = new Set<string>();
  for (const tool of PMO_PHASE_TOOLS[phase]) {
    tabs.add(tool.tab);
  }
  return Array.from(tabs);
}

export function getPhaseIndex(phase: PmoPhase): number {
  return PMO_PHASES.indexOf(phase);
}

export function canViewPhase(
  phase: PmoPhase,
  currentLifecyclePhase: PmoPhase,
  phaseApprovals: Record<string, { approvedAt?: string }> | null | undefined,
): boolean {
  const targetIdx = getPhaseIndex(phase);
  const currentIdx = getPhaseIndex(currentLifecyclePhase);
  if (targetIdx <= currentIdx) return true;
  return !!phaseApprovals?.[phase]?.approvedAt;
}
