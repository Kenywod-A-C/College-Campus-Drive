// Demo-only credentials for the in-browser mock. Never used when VITE_USE_MOCK is not 'true'.
// All mock accounts share this password; the real backend stores salted hashes only.
export const DEMO_PASSWORD = 'demo1234';
export const DEMO_ACCOUNTS = [
  { label: 'Student', email: 'student@campus.demo' },
  { label: 'New student (onboarding)', email: 'newstudent@campus.demo' },
  { label: 'Faculty', email: 'faculty@campus.demo' },
  { label: 'Admin', email: 'admin@campus.demo' },
];
