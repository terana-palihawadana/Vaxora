// Leading titles a user may have typed into their name: "Dr.", "dr ", "Doctor ", "Nurse " (repeated, any case).
const TITLE_PREFIX = /^(?:(?:dr\.|dr\s|doctor\s|nurse\s)\s*)+/i;

export function stripStaffTitle(name) {
  return (name || '').trim().replace(TITLE_PREFIX, '').trim();
}

/** Same rule as the API's StaffNameFormatter: drop any typed title, then add exactly one. */
export function withStaffTitle(name, title, fallback = title) {
  const bare = stripStaffTitle(name);
  return bare ? `${title} ${bare}` : fallback;
}
