// In-memory mock database. DEMO DATA ONLY: every record below is fictional/illustrative.
// This stands in for MySQL + SQLAlchemy. It resets on page reload.
import type {
  AppNotification, Application, ApplicationStatus, AuditLog, Company, Conversation, Course, Department, DocumentRecord,
  Interview, Job, NotificationPrefs, Offer, Permission, PlacementPolicy, Reminder, Role, Student, User,
} from '@/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@/auth/permissions';
import { evaluateEligibility, type EligibilityContext } from './eligibility';

export const day = (n: number, h = 10, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

let counter = 1000;
export const uid = (prefix: string) => `${prefix}_${(++counter).toString(36)}`;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;

// ---------------- Departments & courses ----------------
export const departments: Department[] = [
  { id: 'd_cse', code: 'CSE', name: 'Computer Science & Engineering', headName: 'Dr. Lakshmi Narayanan' },
  { id: 'd_it', code: 'IT', name: 'Information Technology', headName: 'Dr. S. Karthikeyan' },
  { id: 'd_aids', code: 'AI&DS', name: 'Artificial Intelligence & Data Science', headName: 'Dr. Anita Joseph' },
  { id: 'd_ece', code: 'ECE', name: 'Electronics & Communication', headName: 'Dr. Mohan Raj' },
  { id: 'd_eee', code: 'EEE', name: 'Electrical & Electronics', headName: 'Dr. R. Sundaram' },
  { id: 'd_mech', code: 'MECH', name: 'Mechanical Engineering', headName: 'Dr. Vikram Iyer' },
  { id: 'd_civil', code: 'CIVIL', name: 'Civil Engineering', headName: 'Dr. Farah Khan' },
];
export const deptName = (id: string) => departments.find((d) => d.id === id)?.code ?? id;

export const courses: Course[] = departments.map((d, i) => ({
  id: `c_${d.id.slice(2)}`,
  code: `${d.code.replace('&', '')}-UG`,
  name: d.name,
  degree: i % 3 === 1 ? 'B.Tech' : 'B.E.',
  departmentId: d.id,
  durationYears: 4,
}));
courses.push({ id: 'c_mba', code: 'MBA', name: 'Master of Business Administration', degree: 'MBA', departmentId: 'd_cse', durationYears: 2 });

export const academicYears = [
  { id: 'ay_2026', label: '2026-27', graduationYear: 2027, active: true },
  { id: 'ay_2025', label: '2025-26', graduationYear: 2026, active: false },
  { id: 'ay_2027', label: '2027-28', graduationYear: 2028, active: false },
];

// ---------------- Companies ----------------
const co = (id: string, name: string, industry: string, tier: Company['tier'], color: string, desc: string): Company => ({
  id, name, industry, tier, color, description: desc,
  website: `https://www.${name.toLowerCase().replace(/[^a-z]/g, '')}.example.com`,
  contactName: pick(['Anjali Rao', 'Rohit Kapoor', 'Sneha Pillai', 'Karan Shetty', 'Divya Menon']),
  contactEmail: `campus@${name.toLowerCase().replace(/[^a-z]/g, '')}.example.com`,
  contactPhone: '+91 90000 0' + Math.floor(1000 + rand() * 8999),
  createdAt: day(-300),
});
export const companies: Company[] = [
  co('co_tcs', 'TCS', 'IT Services', 'regular', '#1d4ed8', 'Global IT services and consulting organisation with large-scale campus hiring programmes.'),
  co('co_zoho', 'Zoho', 'Software Products', 'dream', '#b91c1c', 'Product company building a broad suite of business software, known for hiring strong problem solvers.'),
  co('co_infosys', 'Infosys', 'IT Services', 'regular', '#0f766e', 'Consulting and digital services company with structured fresher training.'),
  co('co_wipro', 'Wipro', 'IT Services', 'regular', '#7c3aed', 'Technology services and consulting company hiring across engineering streams.'),
  co('co_accenture', 'Accenture', 'Consulting', 'regular', '#9333ea', 'Professional services company offering strategy, technology and operations roles.'),
  co('co_bosch', 'Bosch', 'Engineering & Automotive', 'dream', '#dc2626', 'Engineering and technology company, hiring for embedded, electronics and mechanical roles.'),
  co('co_lt', 'L&T', 'Construction & Engineering', 'regular', '#d97706', 'Engineering and construction conglomerate with graduate engineer trainee programmes.'),
  co('co_cognizant', 'Cognizant', 'IT Services', 'regular', '#0369a1', 'Technology services company running GenC and GenC Next fresher programmes.'),
  co('co_freshworks', 'Freshworks', 'SaaS', 'super_dream', '#0891b2', 'SaaS company offering customer and employee engagement software.'),
];
export const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;

// ---------------- Jobs ----------------
const ALL_DEPTS = departments.map((d) => d.id);
const CS_DEPTS = ['d_cse', 'd_it', 'd_aids'];
const mkJob = (j: Partial<Job> & Pick<Job, 'id' | 'companyId' | 'title'>): Job => ({
  domain: 'Software', location: 'Chennai', type: 'Full-time',
  description: 'Join the graduate programme and work with experienced engineers on real projects. This is illustrative demo data.',
  responsibilities: ['Contribute to production code and reviews', 'Learn through structured onboarding and mentoring', 'Collaborate with cross-functional teams'],
  skills: [], rounds: [
    { id: uid('r'), name: 'Online Assessment', mode: 'Online' },
    { id: uid('r'), name: 'Technical Interview', mode: 'On-campus' },
    { id: uid('r'), name: 'HR Interview', mode: 'On-campus' },
  ],
  eligibility: { minCgpa: 6.5, maxActiveArrears: 0, departmentIds: CS_DEPTS, graduationYears: [2027], requiredSkills: [] },
  openDate: day(-14), deadline: day(10), status: 'published', publishedAt: day(-14), createdBy: 'u_f1', updatedAt: day(-3),
  ...j,
});
export const jobs: Job[] = [
  mkJob({ id: 'j_tcs_ninja', companyId: 'co_tcs', title: 'TCS Ninja', type: 'Full-time', ctcLpa: 3.6, skills: ['Aptitude', 'Programming Basics'], status: 'closed', deadline: day(-20), driveDate: day(-12), openDate: day(-40), domain: 'IT Services',
    eligibility: { minCgpa: 6.0, maxActiveArrears: 1, departmentIds: ALL_DEPTS, graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_tcs_digital', companyId: 'co_tcs', title: 'TCS Digital', ctcLpa: 7.0, skills: ['Java', 'Python', 'SQL', 'Data Structures'], deadline: day(4), driveDate: day(9), domain: 'IT Services',
    eligibility: { minCgpa: 7.5, maxActiveArrears: 0, maxArrearHistory: 2, departmentIds: CS_DEPTS.concat('d_ece'), graduationYears: [2027], requiredSkills: ['Java', 'Python'] } }),
  mkJob({ id: 'j_tcs_prime', companyId: 'co_tcs', title: 'TCS Prime', ctcLpa: 9.0, skills: ['Java', 'System Design', 'SQL', 'Cloud'], deadline: day(6), driveDate: day(13), domain: 'IT Services',
    eligibility: { minCgpa: 8.0, maxActiveArrears: 0, maxArrearHistory: 0, departmentIds: CS_DEPTS, graduationYears: [2027], requiredSkills: ['Java'] } }),
  mkJob({ id: 'j_zoho_sde', companyId: 'co_zoho', title: 'Software Developer', ctcLpa: 8.5, skills: ['C++', 'Data Structures', 'Algorithms', 'Problem Solving'], location: 'Chennai / Hybrid', deadline: day(3), driveDate: day(8),
    eligibility: { minCgpa: 7.0, maxActiveArrears: 0, departmentIds: CS_DEPTS.concat('d_ece', 'd_eee'), graduationYears: [2027], requiredSkills: ['Data Structures'] },
    rounds: [{ id: uid('r'), name: 'Programming Round 1', mode: 'On-campus' }, { id: uid('r'), name: 'Programming Round 2', mode: 'On-campus' }, { id: uid('r'), name: 'Technical Interview', mode: 'On-campus' }, { id: uid('r'), name: 'HR Interview', mode: 'On-campus' }] }),
  mkJob({ id: 'j_infosys_se', companyId: 'co_infosys', title: 'Systems Engineer', ctcLpa: 3.8, skills: ['Aptitude', 'Java', 'SQL'], deadline: day(12), driveDate: day(17), domain: 'IT Services',
    eligibility: { minCgpa: 6.0, maxActiveArrears: 0, departmentIds: ALL_DEPTS, graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_infosys_sp', companyId: 'co_infosys', title: 'Specialist Programmer', ctcLpa: 9.5, skills: ['Algorithms', 'Data Structures', 'Python', 'Java'], deadline: day(14), driveDate: day(20), domain: 'IT Services',
    eligibility: { minCgpa: 7.5, maxActiveArrears: 0, departmentIds: CS_DEPTS, graduationYears: [2027], requiredSkills: ['Algorithms'] } }),
  mkJob({ id: 'j_wipro_elite', companyId: 'co_wipro', title: 'Elite National Talent Hunt', ctcLpa: 3.5, skills: ['Aptitude', 'Communication'], status: 'closed', deadline: day(-9), driveDate: day(-3), domain: 'IT Services',
    eligibility: { minCgpa: 6.0, maxActiveArrears: 0, departmentIds: ALL_DEPTS, graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_wipro_turbo', companyId: 'co_wipro', title: 'Turbo Hiring', ctcLpa: 6.5, skills: ['Java', 'Cloud'], deadline: day(16), driveDate: day(22), domain: 'IT Services',
    eligibility: { minCgpa: 7.0, maxActiveArrears: 0, departmentIds: CS_DEPTS, graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_acc_ase', companyId: 'co_accenture', title: 'Associate Software Engineer', ctcLpa: 4.5, skills: ['Programming Basics', 'Communication'], deadline: day(9), driveDate: day(15), location: 'Bengaluru',
    eligibility: { minCgpa: 6.5, maxActiveArrears: 1, departmentIds: ALL_DEPTS.filter((d) => d !== 'd_civil'), graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_acc_adv', companyId: 'co_accenture', title: 'Advanced App Engineering Analyst', ctcLpa: 6.5, skills: ['Cloud', 'Java', 'Microservices'], status: 'draft', publishedAt: undefined, deadline: day(25), driveDate: day(30), location: 'Bengaluru / Pune',
    eligibility: { minCgpa: 7.5, maxActiveArrears: 0, departmentIds: CS_DEPTS, graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_bosch_emb', companyId: 'co_bosch', title: 'Embedded Software Engineer', ctcLpa: 7.2, skills: ['C', 'Embedded Systems', 'RTOS', 'Microcontrollers'], domain: 'Embedded', location: 'Coimbatore', deadline: day(7), driveDate: day(12),
    eligibility: { minCgpa: 7.5, maxActiveArrears: 0, departmentIds: ['d_ece', 'd_eee', 'd_cse'], graduationYears: [2027], requiredSkills: ['C'] } }),
  mkJob({ id: 'j_lt_get', companyId: 'co_lt', title: 'Graduate Engineer Trainee', ctcLpa: 5.5, skills: ['AutoCAD', 'Project Management', 'Site Execution'], domain: 'Core Engineering', location: 'Multiple sites', deadline: day(11), driveDate: day(18),
    eligibility: { minCgpa: 7.0, maxActiveArrears: 0, departmentIds: ['d_mech', 'd_civil', 'd_eee'], graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_fw_sde', companyId: 'co_freshworks', title: 'Software Development Engineer', ctcLpa: 14.0, skills: ['React', 'TypeScript', 'Node.js', 'System Design'], location: 'Chennai', deadline: day(5), driveDate: day(11),
    eligibility: { minCgpa: 8.0, maxActiveArrears: 0, maxArrearHistory: 0, departmentIds: CS_DEPTS, graduationYears: [2027], requiredSkills: ['React'] } }),
  mkJob({ id: 'j_fw_intern', companyId: 'co_freshworks', title: 'SDE Intern (2028 batch)', type: 'Internship + PPO', stipendPerMonth: 40000, skills: ['JavaScript', 'React', 'Data Structures'], deadline: day(18), driveDate: day(24),
    eligibility: { minCgpa: 7.5, maxActiveArrears: 0, departmentIds: CS_DEPTS, graduationYears: [2028], requiredSkills: [] } }),
  mkJob({ id: 'j_cts_genc', companyId: 'co_cognizant', title: 'GenC', ctcLpa: 4.0, skills: ['Aptitude', 'Programming Basics'], status: 'closed', deadline: day(-30), driveDate: day(-24), openDate: day(-50), domain: 'IT Services',
    eligibility: { minCgpa: 6.0, maxActiveArrears: 1, departmentIds: ALL_DEPTS, graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_cts_next', companyId: 'co_cognizant', title: 'GenC Next', ctcLpa: 6.75, skills: ['Java', 'SQL', 'Cloud'], status: 'closed', deadline: day(-26), driveDate: day(-19), openDate: day(-46), domain: 'IT Services',
    eligibility: { minCgpa: 7.0, maxActiveArrears: 0, departmentIds: CS_DEPTS.concat('d_ece'), graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_inf_pp', companyId: 'co_infosys', title: 'Power Programmer', ctcLpa: 8.0, skills: ['Algorithms', 'Data Structures'], status: 'closed', deadline: day(-35), driveDate: day(-28), openDate: day(-55), domain: 'IT Services',
    eligibility: { minCgpa: 7.5, maxActiveArrears: 0, departmentIds: CS_DEPTS, graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_lt_closed', companyId: 'co_lt', title: 'Design Engineer Trainee', ctcLpa: 5.0, skills: ['AutoCAD', 'SolidWorks'], status: 'closed', deadline: day(-28), driveDate: day(-21), openDate: day(-48), domain: 'Core Engineering',
    eligibility: { minCgpa: 6.5, maxActiveArrears: 0, departmentIds: ['d_mech', 'd_civil', 'd_eee'], graduationYears: [2027], requiredSkills: [] } }),
  mkJob({ id: 'j_zoho_cancel', companyId: 'co_zoho', title: 'Support Engineer (Night shift)', status: 'cancelled', deadline: day(-2), openDate: day(-20),
    eligibility: { minCgpa: 6.0, maxActiveArrears: 1, departmentIds: ALL_DEPTS, graduationYears: [2027], requiredSkills: [] } }),
];

// ---------------- Policies ----------------
export const policies: PlacementPolicy[] = [
  { id: 'pol_max', name: 'Maximum accepted offers', description: 'A student may hold at most this many accepted offers at any time.', kind: 'max_offers', scope: 'college', params: { maxAcceptedOffers: 2 }, enabled: true, updatedAt: day(-90), updatedBy: 'Rahul Verma' },
  { id: 'pol_mech', name: 'Mechanical: extended offer limit', description: 'Core departments may hold one additional accepted offer.', kind: 'max_offers', scope: 'department', scopeValue: 'd_mech', params: { maxAcceptedOffers: 3 }, enabled: false, updatedAt: day(-60), updatedBy: 'Rahul Verma' },
  { id: 'pol_tier', name: 'Dream / Super Dream tier rule', description: 'After accepting an offer, students may only apply to companies in a higher tier.', kind: 'tier_restriction', scope: 'college', params: { allowOnlyHigherTier: true }, enabled: true, updatedAt: day(-90), updatedBy: 'Rahul Verma' },
  { id: 'pol_apps', name: 'Concurrent application limit', description: 'Maximum number of simultaneously active applications per student.', kind: 'application_limit', scope: 'academic_year', scopeValue: '2027', params: { maxActiveApplications: 8 }, enabled: true, updatedAt: day(-45), updatedBy: 'Rahul Verma' },
  { id: 'pol_accept', name: 'Offer acceptance window', description: 'Students must respond to an official offer within this many days unless extended by the placement cell.', kind: 'accepted_offer', scope: 'college', params: { acceptanceWindowDays: 14 }, enabled: true, updatedAt: day(-30), updatedBy: 'Rahul Verma' },
  { id: 'pol_exc', name: 'Eligibility exception approval', description: 'Any eligibility exception needs a written reason and an approving faculty member; it is recorded in the audit log.', kind: 'exception_approval', scope: 'college', params: { requireReason: true, requireApprover: true }, enabled: true, updatedAt: day(-30), updatedBy: 'Rahul Verma' },
];

// ---------------- Users & students ----------------
export const users: User[] = [];
export const students: Student[] = [];

const FIRST = ['Aarav', 'Meera', 'Ishaan', 'Diya', 'Rohan', 'Ananya', 'Karthik', 'Priya', 'Vihaan', 'Sneha', 'Arjun', 'Kavya', 'Nikhil', 'Lakshmi', 'Siddharth', 'Pooja', 'Rahul', 'Nandini', 'Harish', 'Swathi', 'Aditya', 'Divya', 'Manoj', 'Shreya', 'Varun', 'Janani', 'Gokul', 'Harini', 'Pranav', 'Keerthana', 'Dinesh', 'Sowmya', 'Yash', 'Revathi', 'Tarun', 'Bhavana', 'Suresh', 'Aishwarya'];
const LAST = ['Menon', 'Nair', 'Sharma', 'Iyer', 'Reddy', 'Pillai', 'Kumar', 'Subramanian', 'Das', 'Gupta', 'Natarajan', 'Raman', 'Krishnan', 'Joseph', 'Patel', 'Bose'];
const SKILLS_BY_DEPT: Record<string, string[]> = {
  d_cse: ['React', 'TypeScript', 'Python', 'SQL', 'Java', 'C++', 'Data Structures', 'Algorithms', 'Node.js', 'Cloud'],
  d_it: ['Java', 'SQL', 'Python', 'JavaScript', 'Data Structures', 'Cloud', 'React', 'Microservices'],
  d_aids: ['Python', 'Machine Learning', 'SQL', 'Statistics', 'Data Structures', 'Deep Learning', 'Algorithms'],
  d_ece: ['C', 'Embedded Systems', 'Microcontrollers', 'VHDL', 'RTOS', 'Python', 'Signal Processing'],
  d_eee: ['MATLAB', 'Embedded Systems', 'Power Systems', 'C', 'PLC', 'Microcontrollers'],
  d_mech: ['AutoCAD', 'SolidWorks', 'Project Management', 'CAD', 'Thermodynamics'],
  d_civil: ['AutoCAD', 'STAAD Pro', 'Site Execution', 'Project Management', 'Surveying'],
};

export function computeCompletion(s: Student): number {
  const parts = [
    !!s.phone, s.academic.cgpa != null, s.skills.length >= 3, s.interests.length > 0, s.preferredRoles.length > 0,
    !!s.resumeFile, !!s.portfolioUrl, !!s.degree, !!s.studentCode,
  ];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}

const mkStudent = (n: number, o: Partial<Student> = {}): Student => {
  const deptId = o.departmentId ?? departments[n % departments.length].id;
  const first = FIRST[n % FIRST.length];
  const last = LAST[(n * 7 + 3) % LAST.length];
  const name = `${first} ${last}`;
  const pool = SKILLS_BY_DEPT[deptId];
  const skillCount = 2 + Math.floor(rand() * 4);
  const skills = [...new Set(Array.from({ length: skillCount }, () => pick(pool)))];
  const gradYear = chance(0.12) ? 2028 : 2027;
  const hasCgpa = !chance(0.08);
  const s: Student = {
    id: `s_${n}`, userId: `u_s${n}`,
    studentCode: `${gradYear - 4 - 2000}${departments.find((d) => d.id === deptId)!.code.replace('&', '').slice(0, 3)}${String(100 + n)}`,
    name, email: `${first}.${last}${n}@campus.demo`.toLowerCase(), phone: chance(0.85) ? `+91 9${Math.floor(100000000 + rand() * 899999999)}` : undefined,
    departmentId: deptId, degree: deptId === 'd_it' ? 'B.Tech' : 'B.E.', currentYear: gradYear === 2027 ? 4 : 3, graduationYear: gradYear,
    academic: {
      cgpa: hasCgpa ? Math.round((6 + rand() * 3.6) * 100) / 100 : undefined,
      cgpaVerified: hasCgpa && !chance(0.12),
      activeArrears: chance(0.12) ? 1 + Math.floor(rand() * 2) : 0,
      arrearHistory: chance(0.2) ? 1 + Math.floor(rand() * 3) : 0,
    },
    skills, interests: [pick(['Web Development', 'Data Science', 'Cloud', 'Embedded', 'Core Engineering', 'Product'])],
    preferredRoles: [pick(['Software Engineer', 'Data Analyst', 'Graduate Engineer Trainee', 'Full Stack Developer'])],
    resumeFile: chance(0.85) ? `${first.toLowerCase()}_${last.toLowerCase()}_resume.pdf` : undefined,
    portfolioUrl: chance(0.4) ? `https://github.com/${first.toLowerCase()}${last.toLowerCase()}` : undefined,
    profileCompletion: 0, placementStatus: 'unplaced',
    ...o,
  };
  s.profileCompletion = computeCompletion(s);
  return s;
};

// Demo personas
students.push(mkStudent(1, {
  name: 'Aarav Menon', email: 'student@campus.demo', studentCode: '23CSE101', departmentId: 'd_cse', degree: 'B.E.', currentYear: 4, graduationYear: 2027,
  phone: '+91 98400 12345', academic: { cgpa: 8.42, cgpaVerified: true, activeArrears: 0, arrearHistory: 0 },
  skills: ['React', 'TypeScript', 'Python', 'SQL', 'Data Structures', 'Java'], interests: ['Web Development', 'Cloud'], preferredRoles: ['Software Engineer', 'Full Stack Developer'],
  resumeFile: 'aarav_menon_resume.pdf', portfolioUrl: 'https://github.com/aaravmenon',
}));
students.push(mkStudent(2, {
  name: 'Meera Nair', email: 'newstudent@campus.demo', studentCode: '', departmentId: 'd_it', degree: '', currentYear: 4, graduationYear: 2027,
  phone: undefined, academic: { cgpa: undefined, cgpaVerified: false, activeArrears: 0, arrearHistory: 0 }, skills: [], interests: [], preferredRoles: [], resumeFile: undefined, portfolioUrl: undefined,
}));
for (let n = 3; n <= 38; n++) students.push(mkStudent(n));
students.forEach((s) => (s.profileCompletion = computeCompletion(s)));

users.push(
  { id: 'u_a1', userCode: 'ADM001', name: 'Rahul Verma', email: 'admin@campus.demo', role: 'admin', status: 'active', createdAt: day(-400), lastLoginAt: day(0, 8) },
  { id: 'u_a2', userCode: 'ADM002', name: 'Sunita Rao', email: 'sunita.rao@campus.demo', role: 'admin', status: 'active', createdAt: day(-380), lastLoginAt: day(-3) },
  { id: 'u_f1', userCode: 'FAC101', name: 'Dr. Priya Raman', email: 'faculty@campus.demo', role: 'faculty', departmentId: 'd_cse', status: 'active', createdAt: day(-390), lastLoginAt: day(0, 9) },
  { id: 'u_f2', userCode: 'FAC102', name: 'Prof. Manoj Bhat', email: 'manoj.bhat@campus.demo', role: 'faculty', departmentId: 'd_ece', status: 'active', createdAt: day(-350), lastLoginAt: day(-2) },
  { id: 'u_f3', userCode: 'FAC103', name: 'Dr. Fatima Sheikh', email: 'fatima.sheikh@campus.demo', role: 'faculty', departmentId: 'd_mech', status: 'active', createdAt: day(-340), lastLoginAt: day(-6) },
  { id: 'u_f4', userCode: 'FAC104', name: 'Prof. Gopal Krishnan', email: 'gopal.k@campus.demo', role: 'faculty', departmentId: 'd_it', status: 'inactive', createdAt: day(-330) },
  { id: 'u_f5', userCode: 'FAC105', name: 'Dr. Latha Menon', email: 'latha.menon@campus.demo', role: 'faculty', departmentId: 'd_eee', status: 'invited', createdAt: day(-4) },
);
students.forEach((s, i) => users.push({
  id: s.userId, userCode: s.studentCode || `NEW${s.id.slice(2)}`, name: s.name, email: s.email, role: 'student', departmentId: s.departmentId,
  status: i === 37 ? 'inactive' : 'active', createdAt: day(-200 + i), lastLoginAt: i % 3 === 0 ? day(-(i % 9)) : undefined, onboardingComplete: s.id !== 's_2',
}));

export const rolePermissions: Record<Role, Permission[]> = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));

// ---------------- Eligibility context (shared) ----------------
export const offers: Offer[] = [];
export const eligibilityCtx = (): EligibilityContext => ({ policies, offers, companies, departmentName: deptName });
export const evalFor = (s: Student, j: Job) => evaluateEligibility(s, j, eligibilityCtx());

// ---------------- Applications ----------------
export const applications: Application[] = [];
const CHAIN: ApplicationStatus[] = ['applied', 'shortlisted', 'interview', 'selected', 'offer_received'];

function buildApp(s: Student, j: Job, status: ApplicationStatus, appliedDaysAgo: number): Application {
  const appliedAt = day(-appliedDaysAgo, 11);
  const idx = status === 'rejected' || status === 'withdrawn' ? Math.floor(rand() * 3) : CHAIN.indexOf(status);
  const history = CHAIN.slice(0, idx + 1).map((st, i) => ({
    status: st, at: day(-appliedDaysAgo + i * 2, 12), by: i === 0 ? s.name : 'Placement Cell',
    note: st === 'applied' ? 'Application submitted' : st === 'shortlisted' ? 'Shortlisted after resume screening' : st === 'interview' ? 'Invited for interview rounds' : st === 'selected' ? 'Selected after final round' : 'Official offer issued',
  }));
  if (status === 'rejected') history.push({ status, at: day(-Math.max(appliedDaysAgo - 6, 0), 15), by: 'Placement Cell', note: 'Not selected after the assessment round' });
  if (status === 'withdrawn') history.push({ status, at: day(-Math.max(appliedDaysAgo - 3, 0), 15), by: s.name, note: 'Withdrawn by student' });
  const round = status === 'interview' || status === 'shortlisted' ? j.rounds[Math.min(1, j.rounds.length - 1)]?.name : undefined;
  return {
    id: uid('app'), studentId: s.id, jobId: j.id, status, appliedAt, updatedAt: history[history.length - 1].at, history,
    eligibilitySnapshot: { ...evaluateEligibility(s, { ...j, status: 'published', deadline: day(30) }, eligibilityCtx()), evaluatedAt: appliedAt }, currentRound: round,
  };
}
function addOffer(a: Application, status: Offer['status'], ctcOverride?: number) {
  const j = jobs.find((x) => x.id === a.jobId)!;
  offers.push({
    id: uid('off'), studentId: a.studentId, jobId: a.jobId, applicationId: a.id, companyId: j.companyId,
    ctcLpa: ctcOverride ?? j.ctcLpa ?? 4, offeredAt: a.updatedAt, acceptBy: status === 'received' || status === 'pending' ? day(10) : day(-2), status,
    policyChecks: [
      { label: 'Within accepted-offer limit', passed: true, detail: 'Within the college limit at the time of issue.' },
      { label: 'Company tier rule', passed: true, detail: 'Tier rule satisfied.' },
    ],
  });
}

const s1 = students[0];
const sById = (id: string) => students.find((s) => s.id === id)!;
const jById = (id: string) => jobs.find((j) => j.id === id)!;
// Persona applications with a spread of lifecycle states
const persona: [string, ApplicationStatus, number][] = [
  ['j_tcs_ninja', 'offer_received', 30], ['j_tcs_digital', 'interview', 8], ['j_zoho_sde', 'shortlisted', 6],
  ['j_infosys_se', 'applied', 2], ['j_wipro_elite', 'rejected', 18],
];
persona.forEach(([jid, st, ago]) => applications.push(buildApp(s1, jById(jid), st, ago)));
addOffer(applications[0], 'received');
applications[1].currentRound = 'Technical Interview';
applications[2].currentRound = 'Programming Round 2';

// Other students: random applications to open/closed jobs they basically qualify for
const appliable = jobs.filter((j) => j.status !== 'draft' && j.status !== 'cancelled');
students.slice(2).forEach((s) => {
  if (s.academic.cgpa == null) return;
  const n = 1 + Math.floor(rand() * 5);
  const picked = new Set<string>();
  for (let i = 0; i < n; i++) {
    const closedPool = appliable.filter((x) => x.status === 'closed');
    const j = chance(0.45) ? pick(closedPool) : pick(appliable);
    if (picked.has(j.id)) continue;
    picked.add(j.id);
    const base = evaluateEligibility(s, { ...j, status: 'published', deadline: day(30) }, { ...eligibilityCtx(), offers: [] });
    if (base.state === 'not_eligible') continue;
    const r = rand();
    const status: ApplicationStatus = j.status === 'closed'
      ? r < 0.4 ? 'offer_received' : r < 0.5 ? 'selected' : r < 0.9 ? 'rejected' : 'withdrawn'
      : r < 0.35 ? 'applied' : r < 0.6 ? 'shortlisted' : r < 0.8 ? 'interview' : r < 0.9 ? 'rejected' : 'withdrawn';
    const openDays = Math.max(4, Math.floor((Date.now() - +new Date(j.openDate)) / 86400000));
    const app = buildApp(s, j, status, 1 + Math.floor(rand() * (openDays - 2)));
    applications.push(app);
    if (status === 'offer_received') {
      const mine = offers.filter((o) => o.studentId === s.id).length;
      if (mine < 2) addOffer(app, pick(['accepted', 'accepted', 'received', 'declined']));
    }
  }
});
// Applicants whose CGPA became unverified after applying (e.g. profile edited): shortlisting them needs an approved exception.
students.slice(2).filter((x) => x.academic.cgpa != null && !x.academic.cgpaVerified).slice(0, 3).forEach((x, i) => {
  const j = jById(['j_zoho_sde', 'j_acc_ase', 'j_tcs_digital'][i]);
  if (applications.some((a) => a.studentId === x.id && a.jobId === j.id)) return;
  const a = buildApp(x, j, 'applied', 2 + i);
  a.eligibilitySnapshot = { ...evalFor(x, j), evaluatedAt: a.appliedAt };
  applications.push(a);
});
// derive placement status
students.forEach((s) => {
  const acc = offers.some((o) => o.studentId === s.id && o.status === 'accepted');
  const hasApps = applications.some((a) => a.studentId === s.id);
  s.placementStatus = acc ? 'placed' : hasApps ? 'in_process' : 'unplaced';
});
sById('s_37').placementStatus = 'opted_out';

// ---------------- Interviews ----------------
export const interviews: Interview[] = [];
const byJob = new Map<string, Application[]>();
applications.filter((a) => a.status === 'interview' || a.status === 'shortlisted').forEach((a) => byJob.set(a.jobId, [...(byJob.get(a.jobId) ?? []), a]));
let off = 2;
byJob.forEach((apps, jobId) => {
  const j = jById(jobId);
  if (j.status !== 'published') return;
  interviews.push({
    id: uid('int'), jobId, applicationIds: apps.map((a) => a.id), round: j.rounds[1]?.name ?? 'Interview', at: day(off, 10), durationMins: 45,
    location: off % 2 ? 'Placement Cell, Block C — Room 204' : 'https://meet.campus.demo/' + jobId, status: 'scheduled', notified: off % 3 !== 0,
  });
  off += 2;
});
interviews.push({ id: uid('int'), jobId: 'j_wipro_elite', applicationIds: applications.filter((a) => a.jobId === 'j_wipro_elite').map((a) => a.id), round: 'Online Assessment', at: day(-3, 10), durationMins: 90, location: 'Computer Lab 1', status: 'completed', notified: true });

// ---------------- Documents ----------------
export const documents: DocumentRecord[] = [
  { id: 'doc_res1', title: 'Aarav Menon — Resume.pdf', type: 'resume', uploadedAt: day(-40), uploadedBy: 'Aarav Menon', ownerStudentId: 's_1', access: ['student', 'faculty', 'admin'], sizeKb: 182, processing: 'indexed', pages: 2, version: 3 },
  { id: 'doc_cert1', title: 'AWS Cloud Practitioner Certificate', type: 'certificate', uploadedAt: day(-75), uploadedBy: 'Aarav Menon', ownerStudentId: 's_1', access: ['student', 'faculty', 'admin'], sizeKb: 410, processing: 'indexed', pages: 1, version: 1 },
  { id: 'doc_cert2', title: 'NPTEL Data Structures — Elite', type: 'certificate', uploadedAt: day(-120), uploadedBy: 'Aarav Menon', ownerStudentId: 's_1', access: ['student', 'faculty', 'admin'], sizeKb: 295, processing: 'indexed', pages: 1, version: 1 },
  { id: 'doc_tcs_elig', title: 'TCS 2027 Batch — Eligibility Criteria', type: 'eligibility', uploadedAt: day(-35), uploadedBy: 'Dr. Priya Raman', companyId: 'co_tcs', access: ['student', 'faculty', 'admin'], sizeKb: 128, processing: 'indexed', pages: 4, version: 1,
    extractedExcerpts: [
      { page: 1, text: 'TCS Ninja: minimum aggregate 6.0 CGPA, up to one standing arrear permitted at the time of the drive. All engineering departments are eligible.' },
      { page: 2, text: 'TCS Digital: minimum 7.5 CGPA, no standing arrears and not more than two cleared arrears in history. Open to CSE, IT, AI&DS and ECE.' },
      { page: 3, text: 'TCS Prime: minimum 8.0 CGPA with no history of arrears. Open to CSE, IT and AI&DS only.' },
    ] },
  { id: 'doc_tcs_circ', title: 'TCS Digital — Drive Circular', type: 'circular', uploadedAt: day(-6), uploadedBy: 'Dr. Priya Raman', companyId: 'co_tcs', jobId: 'j_tcs_digital', access: ['student', 'faculty', 'admin'], sizeKb: 96, processing: 'indexed', pages: 2, version: 2,
    extractedExcerpts: [{ page: 1, text: 'The TCS Digital drive will be conducted on campus. Students must update their resumes and carry a college ID card. Reporting time is 9:00 AM at the Placement Cell.' }] },
  { id: 'doc_zoho_bro', title: 'Zoho — Company Brochure', type: 'brochure', uploadedAt: day(-12), uploadedBy: 'Dr. Priya Raman', companyId: 'co_zoho', access: ['student', 'faculty', 'admin'], sizeKb: 2310, processing: 'indexed', pages: 12, version: 1,
    extractedExcerpts: [{ page: 3, text: 'Zoho hires software developers through multiple programming rounds followed by technical and HR interviews. Strong data structures and problem-solving skills are expected.' }] },
  { id: 'doc_fw_circ', title: 'Freshworks SDE — Hiring Circular', type: 'circular', uploadedAt: day(-3), uploadedBy: 'Dr. Priya Raman', companyId: 'co_freshworks', jobId: 'j_fw_sde', access: ['student', 'faculty', 'admin'], sizeKb: 88, processing: 'processing', pages: 3, version: 1 },
  { id: 'doc_bosch_elig', title: 'Bosch Embedded — Eligibility', type: 'eligibility', uploadedAt: day(-9), uploadedBy: 'Prof. Manoj Bhat', companyId: 'co_bosch', jobId: 'j_bosch_emb', access: ['student', 'faculty', 'admin'], sizeKb: 74, processing: 'indexed', pages: 2, version: 1,
    extractedExcerpts: [{ page: 1, text: 'Bosch Embedded Software Engineer: minimum 7.5 CGPA, no standing arrears. ECE, EEE and CSE (batch 2027) are eligible. Drive includes an online test, technical panel and HR round.' }] },
  { id: 'doc_policy', title: 'Placement Policy 2026-27', type: 'circular', uploadedAt: day(-90), uploadedBy: 'Rahul Verma', access: ['student', 'faculty', 'admin'], sizeKb: 240, processing: 'indexed', pages: 6, version: 2,
    extractedExcerpts: [{ page: 2, text: 'Students may hold at most the number of accepted offers configured in the active placement policy. After accepting an offer, students may only apply to companies in a higher tier.' }] },
  { id: 'doc_lt_bro', title: 'L&T GET — Brochure', type: 'brochure', uploadedAt: day(-8), uploadedBy: 'Dr. Fatima Sheikh', companyId: 'co_lt', access: ['faculty', 'admin'], sizeKb: 1840, processing: 'failed', pages: 8, version: 1 },
  { id: 'doc_old', title: 'Wipro Elite — Eligibility (2025 batch)', type: 'eligibility', uploadedAt: day(-380), uploadedBy: 'Dr. Priya Raman', companyId: 'co_wipro', access: ['faculty', 'admin'], sizeKb: 60, processing: 'indexed', pages: 2, version: 1 },
];

// ---------------- Reminders / notifications ----------------
export const reminders: Reminder[] = [
  { id: 'rem_1', studentId: 's_1', title: 'Update resume before the Zoho drive', at: day(6, 9), jobId: 'j_zoho_sde', kind: 'drive', done: false },
  { id: 'rem_2', studentId: 's_1', title: 'Respond to TCS Ninja offer', at: day(8, 10), jobId: 'j_tcs_ninja', kind: 'deadline', done: false },
  { id: 'rem_3', studentId: 's_1', title: 'Practise system design questions', at: day(2, 18), kind: 'custom', done: false },
  { id: 'rem_4', studentId: 's_1', title: 'Submit Infosys documents', at: day(-3, 10), jobId: 'j_infosys_se', kind: 'deadline', done: true },
];
export const notifications: AppNotification[] = [
  { id: 'n_1', userId: 'u_s1', title: 'Interview scheduled — TCS Digital', body: 'Technical Interview is scheduled. Check the interview schedule on your application.', kind: 'interview', at: day(-0, 8), read: false, link: '/student/applications' },
  { id: 'n_2', userId: 'u_s1', title: 'Offer received from TCS', body: 'You have an official offer for TCS Ninja. Respond before the acceptance deadline.', kind: 'offer', at: day(-1, 16), read: false, link: '/student/offers' },
  { id: 'n_3', userId: 'u_s1', title: 'Deadline approaching — Zoho Software Developer', body: 'Applications for Zoho close in 3 days.', kind: 'deadline', at: day(-1, 9), read: true, link: '/student/jobs/j_zoho_sde' },
  { id: 'n_4', userId: 'u_s1', title: 'Shortlisted — Zoho', body: 'You have been shortlisted for Programming Round 2.', kind: 'application', at: day(-2, 13), read: true, link: '/student/applications' },
  { id: 'n_5', userId: 'u_s1', title: 'New circular: Freshworks SDE', body: 'A hiring circular has been published for the Freshworks SDE role.', kind: 'system', at: day(-3, 11), read: true, link: '/student/documents' },
  { id: 'n_6', userId: 'u_s2', title: 'Welcome to Campus Assistant', body: 'Complete your profile so we can evaluate your eligibility for jobs.', kind: 'system', at: day(0, 8), read: false },
  { id: 'n_7', userId: 'u_f1', title: '3 hiring drives need attention', body: 'Deadlines close within 5 days for TCS Digital, Zoho and Freshworks.', kind: 'deadline', at: day(0, 8), read: false, link: '/faculty/jobs' },
  { id: 'n_8', userId: 'u_f1', title: 'Document processing failed', body: 'L&T GET — Brochure could not be processed. Re-upload a text-based PDF.', kind: 'system', at: day(-1, 10), read: false, link: '/faculty/documents' },
  { id: 'n_9', userId: 'u_f1', title: '12 new applications', body: 'New applications received for TCS Digital and Zoho.', kind: 'application', at: day(-1, 14), read: true, link: '/faculty/applications' },
  { id: 'n_10', userId: 'u_a1', title: 'Weekly audit summary ready', body: 'No denied access attempts were recorded in the last 7 days.', kind: 'system', at: day(0, 7), read: false, link: '/admin/audit-logs' },
  { id: 'n_11', userId: 'u_a1', title: 'Invitation pending', body: 'Dr. Latha Menon has not yet activated their account.', kind: 'system', at: day(-2, 12), read: true, link: '/admin/users' },
];
export const defaultPrefs = (): NotificationPrefs => ({ email: true, push: false, driveReminders: true, deadlineReminders: true, interviewAlerts: true, offerUpdates: true });
export const prefs: Record<string, NotificationPrefs> = {};
export const conversations: Record<string, Conversation[]> = {};

// ---------------- Audit ----------------
export const auditLogs: AuditLog[] = [];
export function audit(actor: string, actorRole: AuditLog['actorRole'], action: string, resource: string, result: AuditLog['result'] = 'success', reason?: string) {
  auditLogs.unshift({ id: uid('aud'), actor, actorRole, action, resource, at: new Date().toISOString(), result, reason });
}
(() => {
  const seed: [string, AuditLog['actorRole'], string, string, AuditLog['result'], string?][] = [
    ['Dr. Priya Raman', 'faculty', 'job.publish', 'Job TCS Digital', 'success'],
    ['Dr. Priya Raman', 'faculty', 'application.shortlist', 'Application (Zoho · 6 students)', 'success'],
    ['Rahul Verma', 'admin', 'policy.update', 'Policy: Maximum accepted offers', 'success', 'Reviewed for 2026-27 placement season'],
    ['Aarav Menon', 'student', 'application.create', 'Application TCS Digital', 'success'],
    ['Aarav Menon', 'student', 'offer.update', 'Offer (attempted direct edit)', 'denied', 'Students cannot modify official offer records'],
    ['Prof. Manoj Bhat', 'faculty', 'document.upload', 'Bosch Embedded — Eligibility', 'success'],
    ['Rahul Verma', 'admin', 'user.create', 'User Dr. Latha Menon', 'success'],
    ['Rahul Verma', 'admin', 'user.deactivate', 'User Prof. Gopal Krishnan', 'success', 'Left the institution'],
    ['system', 'system', 'document.process', 'L&T GET — Brochure', 'failed', 'No extractable text found'],
    ['Dr. Fatima Sheikh', 'faculty', 'job.cancel', 'Job Support Engineer (Night shift)', 'success', 'Company withdrew the requirement'],
    ['Dr. Priya Raman', 'faculty', 'eligibility.exception', 'Application (student 23CSE117 · TCS Digital)', 'success', 'CGPA verification delayed by exam cell; approved by HoD'],
    ['Sunita Rao', 'admin', 'role.permissions.update', 'Role faculty', 'success', 'Granted reports.view'],
    ['Meera Nair', 'student', 'auth.login', 'Session', 'success'],
    ['unknown', 'system', 'auth.login', 'Session (admin@campus.demo)', 'denied', 'Invalid credentials'],
    ['Dr. Priya Raman', 'faculty', 'offer.create', 'Offer TCS Ninja', 'success'],
  ];
  seed.forEach(([a, r, ac, res, st, why], i) => {
    auditLogs.push({ id: uid('aud'), actor: a, actorRole: r, action: ac, resource: res, at: day(-Math.floor(i / 2), 17 - (i % 8)), result: st, reason: why });
  });
})();

export const systemSettings = {
  collegeName: 'Riverstone Institute of Technology (Demo)',
  collegeEmail: 'placements@campus.demo',
  academicYear: '2026-27',
  placementSeason: 'Aug 2026 – Apr 2027',
  notifyEmailEnabled: true,
  notifyDigestHour: 8,
  aiProvider: { configured: true, provider: 'Configured server-side', model: 'LLM with tool calling', ragIndexed: 9, ragFailed: 1 },
  maintenanceBanner: false,
  sessionTimeoutMins: 60,
};
