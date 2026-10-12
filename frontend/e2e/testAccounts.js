// Logins for the accounts the API seeds for testing. Passwords come from the
// environment (frontend/.env.e2e or the shell) so none are kept in the repository.

function fromEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to frontend/.env.e2e (see frontend/.env.example).`);
  }
  return value;
}

export const TEST_ACCOUNTS = {
  patient: {
    email: process.env.PATIENT_EMAIL || 'patient1@vaxora.lk',
    get password() {
      return fromEnv('PATIENT_PASSWORD');
    },
  },
  hospital: {
    email: process.env.HOSPITAL_EMAIL || 'hospital@vaxora.local',
    get password() {
      return fromEnv('HOSPITAL_PASSWORD');
    },
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@vaxora.health.gov.lk',
    get password() {
      return fromEnv('ADMIN_PASSWORD');
    },
  },
};
