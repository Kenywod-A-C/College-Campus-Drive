// Deterministic eligibility service (mock of the Flask `EligibilityService`).
// Pure function over structured rules: the LLM never decides eligibility, it only reads this result.
import type { Company, EligibilityCheck, EligibilityResult, Job, Offer, PlacementPolicy, Student } from '@/types';

export interface EligibilityContext {
  policies: PlacementPolicy[];
  offers: Offer[];
  companies: Company[];
  departmentName: (id: string) => string;
  now?: Date;
}

const tierRank = { regular: 0, dream: 1, super_dream: 2 } as const;

export function evaluateEligibility(student: Student, job: Job, ctx: EligibilityContext): EligibilityResult {
  const rule = job.eligibility;
  const now = ctx.now ?? new Date();
  const checks: EligibilityCheck[] = [];
  const a = student.academic;

  // 1. Department
  const deptOk = rule.departmentIds.length === 0 || rule.departmentIds.includes(student.departmentId);
  checks.push({
    key: 'department',
    label: 'Department',
    passed: deptOk,
    detail: deptOk
      ? `${ctx.departmentName(student.departmentId)} is an eligible department.`
      : `Open to ${rule.departmentIds.map(ctx.departmentName).join(', ')}; your department is ${ctx.departmentName(student.departmentId)}.`,
  });

  // 2. Graduation year
  const yearOk = rule.graduationYears.length === 0 || rule.graduationYears.includes(student.graduationYear);
  checks.push({
    key: 'graduationYear',
    label: 'Graduation year',
    passed: yearOk,
    detail: yearOk
      ? `Batch ${student.graduationYear} is eligible.`
      : `Open to batch ${rule.graduationYears.join(', ')}; your batch is ${student.graduationYear}.`,
  });

  // 3. CGPA (missing -> cannot be determined)
  if (a.cgpa == null) {
    checks.push({ key: 'cgpa', label: 'Minimum CGPA', passed: null, detail: `Requires ${rule.minCgpa.toFixed(1)}+. Your CGPA is not on your profile yet.` });
  } else {
    const ok = a.cgpa >= rule.minCgpa;
    checks.push({
      key: 'cgpa',
      label: 'Minimum CGPA',
      passed: ok,
      detail: ok ? `Your CGPA ${a.cgpa.toFixed(2)} meets the ${rule.minCgpa.toFixed(1)} requirement.` : `Requires ${rule.minCgpa.toFixed(1)}+; your CGPA is ${a.cgpa.toFixed(2)}.`,
    });
  }

  // 4. Arrears
  const arrOk = a.activeArrears <= rule.maxActiveArrears;
  checks.push({
    key: 'arrears',
    label: 'Active arrears',
    passed: arrOk,
    detail: arrOk
      ? `${a.activeArrears} active arrear(s); up to ${rule.maxActiveArrears} allowed.`
      : `${a.activeArrears} active arrear(s); only ${rule.maxActiveArrears} allowed.`,
  });
  if (rule.maxArrearHistory != null) {
    const ok = a.arrearHistory <= rule.maxArrearHistory;
    checks.push({
      key: 'arrearHistory',
      label: 'Arrear history',
      passed: ok,
      detail: ok ? `${a.arrearHistory} cleared arrear(s) in history; up to ${rule.maxArrearHistory} allowed.` : `${a.arrearHistory} arrear(s) in history; only ${rule.maxArrearHistory} allowed.`,
    });
  }

  // 5. Job open for applications
  const deadlinePassed = new Date(job.deadline) < now;
  const open = job.status === 'published' && !deadlinePassed;
  checks.push({
    key: 'open',
    label: 'Applications open',
    passed: open,
    detail: open ? 'This job is accepting applications.' : job.status !== 'published' ? `This job is ${job.status} and not accepting applications.` : 'The application deadline has passed.',
  });

  // 6. Configurable placement policies
  const myOffers = ctx.offers.filter((o) => o.studentId === student.id && o.status === 'accepted');
  const company = ctx.companies.find((c) => c.id === job.companyId);
  for (const p of ctx.policies.filter((p) => p.enabled)) {
    const inScope =
      p.scope === 'college' ||
      (p.scope === 'department' && p.scopeValue === student.departmentId) ||
      (p.scope === 'academic_year' && p.scopeValue === String(student.graduationYear));
    if (!inScope) continue;
    if (p.kind === 'max_offers') {
      const max = Number(p.params.maxAcceptedOffers);
      const ok = myOffers.length < max;
      checks.push({
        key: `policy:${p.id}`,
        label: 'Placement policy',
        passed: ok,
        detail: ok ? `${p.name}: ${myOffers.length} of ${max} accepted offers used.` : `${p.name}: you already hold ${myOffers.length} accepted offer(s) (limit ${max}).`,
      });
    }
    if (p.kind === 'tier_restriction' && myOffers.length && company) {
      const best = Math.max(...myOffers.map((o) => tierRank[ctx.companies.find((c) => c.id === o.companyId)?.tier ?? 'regular']));
      const ok = best >= 2 ? false : best === 0 ? true : tierRank[company.tier] > best;
      checks.push({
        key: `policy:${p.id}`,
        label: 'Placement policy',
        passed: ok,
        detail: ok ? `${p.name}: this company tier is permitted.` : `${p.name}: with an accepted offer you may only apply to a higher company tier.`,
      });
    }
  }

  const hard = checks.filter((c) => c.passed === false);
  const unknown = checks.filter((c) => c.passed === null);
  let state: EligibilityResult['state'];
  let summary: string;
  if (hard.length) {
    state = 'not_eligible';
    summary = `Not eligible: ${hard.map((c) => c.label.toLowerCase()).join(', ')}.`;
  } else if (unknown.length) {
    state = 'profile_incomplete';
    summary = 'Profile incomplete: add your CGPA and academic details so eligibility can be evaluated.';
  } else if (!a.cgpaVerified) {
    state = 'needs_verification';
    summary = 'Your CGPA is awaiting verification by the placement cell. You can apply once verified.';
  } else {
    state = 'eligible';
    summary = 'You meet all eligibility criteria.';
  }
  return { state, checks, summary, evaluatedAt: now.toISOString() };
}
